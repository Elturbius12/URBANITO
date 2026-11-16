// ===========================================================================
// REPORTES SEMANALES DE AVANCE
// Se agregan como métodos de Sistema (ver sistema.js).
//   Jueves desde las 08:00 (y hasta el domingo, si aún no lo llenó): el
//   trabajador con permiso «reporte_semanal» ve un formulario obligatorio con
//   sus asignaciones. Viernes: el administrador ve el consolidado con semáforo.
// ===========================================================================

const { Sistema, ErrorUsuario, texto, ahoraIso } = require('./sistema')
const seg = require('./seguridad')
const { semanaIso, lunesDe, diaSemana } = require('./notificaciones')

const P = Sistema.prototype

const ESTADOS_REPORTE = ['Sin iniciar', 'En proceso', 'Para derivar', 'Observado', 'Finalizado']
// estado del reporte → estado de la asignación
const A_ASIGNACION = { 'Sin iniciar': 'PENDIENTE', 'En proceso': 'EN_PROGRESO', 'Para derivar': 'EN_PROGRESO',
                       Observado: 'EN_PROGRESO', Finalizado: 'COMPLETADA' }
const HORA_REPORTE = 8

// ¿Debe llenar hoy el reporte? jueves ≥ 08:00, viernes, sábado o domingo de la misma semana ISO.
P.reporteSemanalEstado = function (u) {
  const hoy = this.hoy()
  const semana = semanaIso(hoy)
  const dia = diaSemana(hoy)
  const aplica = seg.tienePermiso(u.rol, 'reporte_semanal') && !seg.PERMISOS[u.rol].includes('*')
  const enVentana = (dia === 4 && this.horaActual() >= HORA_REPORTE) || dia === 5 || dia === 6 || dia === 0
  const lleno = this.bd.una('SELECT id, fecha_llenado FROM reportes_semanales WHERE usuario_id = ? AND semana = ?', [u.id, semana])
  const asignaciones = aplica
    ? this.bd.todas(`SELECT * FROM asignaciones WHERE usuario_id = ? AND (estado IN ('PENDIENTE','EN_PROGRESO')
                     OR (estado = 'COMPLETADA' AND substr(actualizado_en, 1, 10) >= ?)) ORDER BY fecha_limite, id`, [u.id, lunesDe(hoy)])
      .map(a => this.filaAsignacion(a))
    : []
  return {
    semana, hoy, aplica, requerido: aplica && enVentana && !lleno, lleno: !!lleno, fecha_llenado: lleno ? lleno.fecha_llenado : null,
    estados: ESTADOS_REPORTE, asignaciones,
  }
}

P.reporteSemanalEnviar = function (u, datos = {}) {
  this.exigir(u, 'reporte_semanal')
  const est = this.reporteSemanalEstado(u)
  if (est.lleno) throw new ErrorUsuario(`Ya envió su reporte de la semana ${est.semana}.`)
  const porId = new Map((datos.asignaciones || []).map(a => [Number(a.asignacion_id), a]))
  const items = []
  for (const a of est.asignaciones) {
    const r = porId.get(a.id)
    if (!r) throw new ErrorUsuario(`Falta el estado del expediente ${a.numero}.`)
    const estado = texto(r.estado, 30)
    if (!ESTADOS_REPORTE.includes(estado)) throw new ErrorUsuario(`Elija el estado actual del expediente ${a.numero}.`)
    const avance = texto(r.avance, 2000)
    if (estado === 'En proceso' && avance.length < 10) {
      throw new ErrorUsuario(`Describa el avance del expediente ${a.numero} (mínimo 10 caracteres).`)
    }
    items.push({ asignacion_id: a.id, expediente_id: a.expediente_id, numero: a.numero, procedimiento: a.procedimiento,
                 estado, avance: avance || null, estado_asignacion_previo: a.estado })
  }
  const dificultades = texto(datos.dificultades, 2000) || null
  const adicionales = texto(datos.adicionales, 2000) || null
  const apoyo = !!datos.necesita_apoyo
  const contenido = { semana: est.semana, asignaciones: items, dificultades, adicionales, necesita_apoyo: apoyo }
  const ahora = ahoraIso()
  let id
  this.bd.transaccion(() => {
    id = this.bd.ejecutar('INSERT INTO reportes_semanales(usuario_id, semana, fecha_llenado, datos, creado_en) VALUES (?,?,?,?,?)',
      [u.id, est.semana, this.hoy(), JSON.stringify(contenido), ahora]).ultimoId
    for (const it of items) {
      const nuevo = A_ASIGNACION[it.estado]
      if (it.estado_asignacion_previo !== 'COMPLETADA' && nuevo !== it.estado_asignacion_previo) {
        this.bd.ejecutar('UPDATE asignaciones SET estado = ?, actualizado_en = ? WHERE id = ?', [nuevo, ahora, it.asignacion_id])
      }
    }
    if (apoyo) {
      // aviso a los jefes de sus departamentos y al administrador
      const jefes = [...this.usuarios.values()].filter(x => x.activo && x.rol === 'JEFE_DEPARTAMENTO' && x.id !== u.id &&
        (x.departamentos || []).some(d => (u.departamentos || []).includes(d)))
      const aviso = { tipo: 'SISTEMA', titulo: `${u.nombre_completo} pide apoyo`,
                      mensaje: `${u.nombre_completo} indicó en su reporte semanal (${est.semana}) que necesita apoyo.${dificultades ? ` Dificultades: ${dificultades}` : ''}`,
                      referencia_tipo: 'reporte', referencia_id: id }
      for (const j of jefes) this.notificar(j.id, aviso)
      this.notificarAdministradores(aviso, u.id)
    }
    this.auditar(u, 'REPORTE_SEMANAL', 'reportes_semanales', id, { semana: est.semana, asignaciones: items.length, necesita_apoyo: apoyo })
  })
  this.ultimoCambio = ahoraIso()
  return { ok: true, id, semana: est.semana }
}

// Semáforo del consolidado:
//   rojo     no llenó el reporte, o todo «Sin iniciar» teniendo asignaciones
//   amarillo hay dificultades, pidió apoyo o algún expediente observado
//   verde    todo avanza
function semaforo(r) {
  if (!r) return { color: 'ROJO', motivo: 'No llenó el reporte' }
  const d = r.datos
  if (d.asignaciones.length && d.asignaciones.every(a => a.estado === 'Sin iniciar')) return { color: 'ROJO', motivo: 'Sin avance en ninguna asignación' }
  if (d.necesita_apoyo) return { color: 'AMARILLO', motivo: 'Pidió apoyo del jefe' }
  if (d.dificultades) return { color: 'AMARILLO', motivo: 'Reportó dificultades' }
  if (d.asignaciones.some(a => a.estado === 'Observado')) return { color: 'AMARILLO', motivo: 'Tiene expedientes observados' }
  return { color: 'VERDE', motivo: 'Todo avanza' }
}

P.reportesConsolidado = function (u, { semana } = {}) {
  this.exigir(u, 'seguimiento')
  const s = /^\d{4}-W\d{2}$/.test(String(semana || '')) ? semana : semanaIso(this.hoy())
  const reportes = new Map(this.bd.todas('SELECT * FROM reportes_semanales WHERE semana = ?', [s])
    .map(r => [r.usuario_id, { ...r, datos: JSON.parse(r.datos) }]))
  const deben = [...this.usuarios.values()].filter(x => x.activo && seg.tienePermiso(x.rol, 'reporte_semanal') &&
    !seg.PERMISOS[x.rol].includes('*'))
  const filas = deben.map(x => {
    const r = reportes.get(x.id) || null
    return {
      usuario_id: x.id, nombre: x.nombre_completo, rol: seg.ROLES[x.rol].nombre,
      departamentos: (x.departamentos || []).map(c => ((this.departamentos.get(c) || {}).nombre || c).replace(/^Departamento de /, '')),
      reporte: r ? { id: r.id, fecha_llenado: r.fecha_llenado, ...r.datos } : null,
      semaforo: semaforo(r),
    }
  }).sort((a, b) => ['ROJO', 'AMARILLO', 'VERDE'].indexOf(a.semaforo.color) - ['ROJO', 'AMARILLO', 'VERDE'].indexOf(b.semaforo.color) ||
                    a.nombre.localeCompare(b.nombre))
  const semanas = this.bd.todas('SELECT DISTINCT semana FROM reportes_semanales ORDER BY semana DESC LIMIT 30').map(r => r.semana)
  if (!semanas.includes(s)) semanas.unshift(s)
  return {
    semana: s, semanas, filas,
    conteo: { VERDE: filas.filter(f => f.semaforo.color === 'VERDE').length, AMARILLO: filas.filter(f => f.semaforo.color === 'AMARILLO').length,
              ROJO: filas.filter(f => f.semaforo.color === 'ROJO').length, llenaron: filas.filter(f => f.reporte).length, total: filas.length },
  }
}

module.exports = { ESTADOS_REPORTE }
