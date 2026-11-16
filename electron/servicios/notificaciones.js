// ===========================================================================
// NOTIFICACIONES — campana de la cabecera
// Se agregan como métodos de Sistema (ver sistema.js).
//   ASIGNACION   al confirmar una asignación del modelo MILP
//   DERIVACION   al derivar un expediente a una persona o a un departamento
//   RECORDATORIO una vez al día, al abrir el sistema, si tiene asignaciones pendientes
//   REPORTE      jueves: llenar el reporte semanal · viernes (admin): consolidado listo
//   SISTEMA      avisos generales (p. ej. un trabajador pide apoyo)
// En modo red los clientes consultan cada 10 s «notificaciones_nuevas» con la
// marca de tiempo de la última que recibieron (polling).
// ===========================================================================

const { Sistema, ErrorUsuario, texto, ahoraIso } = require('./sistema')
const seg = require('./seguridad')

const P = Sistema.prototype

const TIPOS = new Set(['ASIGNACION', 'DERIVACION', 'REPORTE', 'RECORDATORIO', 'SISTEMA'])
const MAX_LISTA = 100

// ---------------------------------------------------------------- utilidades de fecha
// Semana ISO 8601 de una fecha AAAA-MM-DD, p. ej. "2026-W47"
function semanaIso(fecha) {
  const [a, m, d] = fecha.split('-').map(Number)
  const t = new Date(Date.UTC(a, m - 1, d))
  const dia = t.getUTCDay() || 7                 // lunes = 1 … domingo = 7
  t.setUTCDate(t.getUTCDate() + 4 - dia)         // jueves de la misma semana
  const inicioAnio = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const n = Math.ceil(((t - inicioAnio) / 86400000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(n).padStart(2, '0')}`
}

// Lunes de la semana de una fecha (AAAA-MM-DD)
function lunesDe(fecha) {
  const [a, m, d] = fecha.split('-').map(Number)
  const t = new Date(Date.UTC(a, m - 1, d))
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() || 7) - 1))
  return t.toISOString().slice(0, 10)
}

// 0 = domingo … 4 = jueves, 5 = viernes
function diaSemana(fecha) {
  const [a, m, d] = fecha.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay()
}

P.horaActual = function () {
  if (process.env.URBANITO_HORA) return Number(process.env.URBANITO_HORA)
  return this.fechaFija ? 9 : new Date().getHours()
}

// Medianoche local de hoy en ISO (para comparar con creado_en)
P.inicioDelDia = function () {
  return new Date(`${this.hoy()}T00:00:00`).toISOString()
}

// ---------------------------------------------------------------- crear
// Debe llamarse DENTRO de una transacción. Devuelve el id.
P.notificar = function (usuarioId, { tipo, titulo, mensaje = null, referencia_tipo = null, referencia_id = null }) {
  if (!usuarioId || !TIPOS.has(tipo)) return null
  const u = this.usuarios.get(Number(usuarioId))
  if (!u || !u.activo) return null
  return this.bd.ejecutar(
    `INSERT INTO notificaciones(usuario_id, tipo, titulo, mensaje, referencia_tipo, referencia_id, leida, creado_en)
     VALUES (?,?,?,?,?,?,0,?)`,
    [u.id, tipo, texto(titulo, 200), mensaje ? texto(mensaje, 1000) : null, referencia_tipo,
     referencia_id === null || referencia_id === undefined ? null : Number(referencia_id), ahoraIso()]).ultimoId
}

// Destinatarios de una derivación: la persona, o el personal del departamento
P.destinatariosDerivacion = function (destino, actorId) {
  if (!destino) return []
  if (destino.tipo === 'USUARIO') return destino.usuario_id && destino.usuario_id !== actorId ? [destino.usuario_id] : []
  if (destino.tipo === 'DEPARTAMENTO') {
    return [...this.usuarios.values()]
      .filter(x => x.activo && x.id !== actorId && ['JEFE_DEPARTAMENTO', 'TECNICO'].includes(x.rol) &&
                   (x.departamentos || []).includes(destino.codigo))
      .map(x => x.id)
  }
  return []
}

// Dentro de la transacción de una derivación
P.notificarDerivacion = function (e, u, destino) {
  const p = this.almacen.procedimientos.get(e.procedimiento_codigo)
  const para = destino.tipo === 'USUARIO' ? 'a usted' : 'a su departamento'
  for (const id of this.destinatariosDerivacion(destino, u.id)) {
    this.notificar(id, {
      tipo: 'DERIVACION', titulo: `Expediente ${e.numero} derivado ${para}`,
      mensaje: `El expediente ${e.numero}${p ? ` (${p.nombre})` : ''} fue derivado ${para}${destino.tipo === 'DEPARTAMENTO' ? ` (${destino.nombre})` : ''} por ${u.nombre_completo}. Confirme la recepción en su bandeja.`,
      referencia_tipo: 'expediente', referencia_id: e.id,
    })
  }
}

// A todos los administradores activos (dentro de una transacción)
P.notificarAdministradores = function (datos, excepto = null) {
  for (const x of this.usuarios.values()) {
    if (x.activo && x.rol === 'ADMINISTRADOR' && x.id !== excepto) this.notificar(x.id, datos)
  }
}

// ---------------------------------------------------------------- consultar
function publica(n) {
  return { ...n, leida: !!n.leida }
}

P.notificacionesListar = function (u, { solo_no_leidas } = {}) {
  const filas = this.bd.todas(
    `SELECT * FROM notificaciones WHERE usuario_id = ? ${solo_no_leidas ? 'AND leida = 0' : ''} ORDER BY id DESC LIMIT ?`,
    [u.id, MAX_LISTA])
  const noLeidas = this.bd.una('SELECT COUNT(*) n FROM notificaciones WHERE usuario_id = ? AND leida = 0', [u.id]).n
  return { filas: filas.map(publica), no_leidas: noLeidas, ahora: ahoraIso() }
}

// Polling: notificaciones creadas después de «desde» (ISO). Devuelve también la
// marca de tiempo del último cambio de datos para que la interfaz se refresque.
P.notificacionesNuevas = function (u, { desde } = {}) {
  const d = texto(desde, 40) || '1970-01-01T00:00:00.000Z'
  const filas = this.bd.todas('SELECT * FROM notificaciones WHERE usuario_id = ? AND creado_en > ? ORDER BY id ASC LIMIT ?',
    [u.id, d, MAX_LISTA])
  const noLeidas = this.bd.una('SELECT COUNT(*) n FROM notificaciones WHERE usuario_id = ? AND leida = 0', [u.id]).n
  return { filas: filas.map(publica), no_leidas: noLeidas, ahora: ahoraIso(), datos_cambiados: this.ultimoCambio || null }
}

P.notificacionMarcarLeida = function (u, { id, todas } = {}) {
  this.bd.transaccion(() => {
    if (todas) this.bd.ejecutar('UPDATE notificaciones SET leida = 1 WHERE usuario_id = ? AND leida = 0', [u.id])
    else {
      const n = this.bd.una('SELECT id FROM notificaciones WHERE id = ? AND usuario_id = ?', [Number(id), u.id])
      if (!n) throw new ErrorUsuario('La notificación no existe.', 'NO_EXISTE')
      this.bd.ejecutar('UPDATE notificaciones SET leida = 1 WHERE id = ?', [n.id])
    }
  })
  return this.notificacionesListar(u)
}

// ---------------------------------------------------------------- al abrir el sistema
// Recordatorio diario, aviso de reporte semanal (jueves) y consolidado (viernes, admin).
// Idempotente: cada aviso se crea a lo sumo una vez por día y usuario.
P.notificacionesAlAbrir = function (u) {
  const hoy = this.hoy()
  const inicio = this.inicioDelDia()
  const yaHoy = (tipo, refTipo) => !!this.bd.una(
    `SELECT id FROM notificaciones WHERE usuario_id = ? AND tipo = ? AND IFNULL(referencia_tipo, '') = ? AND creado_en >= ?`,
    [u.id, tipo, refTipo || '', inicio])
  const creadas = []
  this.bd.transaccion(() => {
    // 1. recordatorio de asignaciones pendientes
    const activas = this.bd.todas(`SELECT a.*, e.numero FROM asignaciones a JOIN expedientes e ON e.id = a.expediente_id
                                   WHERE a.usuario_id = ? AND a.estado IN ('PENDIENTE','EN_PROGRESO')`, [u.id])
    if (activas.length && !yaHoy('RECORDATORIO', 'asignacion')) {
      let urgente = null
      for (const a of activas) {
        if (!a.fecha_limite) continue
        const dias = this.cal.diasHabiles(hoy, a.fecha_limite)
        if (dias !== null && (urgente === null || dias < urgente.dias)) urgente = { dias, numero: a.numero }
      }
      const detalle = urgente === null ? '' : urgente.dias < 0
        ? ` La más urgente (${urgente.numero}) venció hace ${Math.abs(urgente.dias)} día(s) hábil(es).`
        : ` La más urgente (${urgente.numero}) vence en ${urgente.dias} día(s) hábil(es).`
      creadas.push(this.notificar(u.id, { tipo: 'RECORDATORIO', titulo: `Tiene ${activas.length} asignación(es) pendiente(s)`,
        mensaje: `Tiene ${activas.length} asignaciones pendientes.${detalle}`, referencia_tipo: 'asignacion' }))
    }
    // 2. jueves: reporte semanal
    const dia = diaSemana(hoy)
    if (dia === 4 && seg.tienePermiso(u.rol, 'reporte_semanal') && !yaHoy('REPORTE', 'reporte')) {
      const lleno = this.bd.una('SELECT id FROM reportes_semanales WHERE usuario_id = ? AND semana = ?', [u.id, semanaIso(hoy)])
      if (!lleno) {
        creadas.push(this.notificar(u.id, { tipo: 'REPORTE', titulo: 'Es día de reporte semanal',
          mensaje: 'Es día de reporte semanal. Complete su avance.', referencia_tipo: 'reporte' }))
      }
    }
    // 3. viernes: consolidado listo (administrador y quienes tienen «seguimiento»)
    if (dia === 5 && seg.tienePermiso(u.rol, 'seguimiento') && !yaHoy('REPORTE', 'reporte')) {
      const n = this.bd.una('SELECT COUNT(*) n FROM reportes_semanales WHERE semana = ?', [semanaIso(hoy)]).n
      creadas.push(this.notificar(u.id, { tipo: 'REPORTE', titulo: 'El reporte semanal consolidado está listo',
        mensaje: `El reporte semanal consolidado está listo (${n} reporte(s) recibidos esta semana).`, referencia_tipo: 'reporte' }))
    }
  })
  return { creadas: creadas.filter(Boolean).length, ...this.notificacionesListar(u) }
}

module.exports = { semanaIso, lunesDe, diaSemana }
