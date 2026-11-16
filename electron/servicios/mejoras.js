// ===========================================================================
// MEJORAS DE SOFTWARE DE LA v2 (sin modelos matemáticos nuevos)
// Se agregan como métodos de Sistema (ver sistema.js).
//   · firma de recepción de derivaciones       · plantillas de observación
//   · búsqueda universal                       · log de actividad por usuario
//   · alertas de expedientes abandonados       · tablero de finalizados
//   · indicador antes vs después de URBANITO   · crear departamentos
// ===========================================================================

const { Sistema, ErrorUsuario, ESTADOS, CERRADOS, texto, ahoraIso } = require('./sistema')
const { ACTIVOS, normalizarTexto } = require('../motor/modelos')
const { medidas } = require('../motor/estadistica')
const seg = require('./seguridad')

const P = Sistema.prototype

const TIPOS_RECIBIBLES = new Set(['REGISTRO', 'DERIVACION', 'REASIGNACION', 'REAPERTURA'])
const DIAS_ABANDONO_DEFECTO = 30
const PLANTILLAS_DEFECTO = [
  { titulo: 'Falta documento', texto: 'Falta presentar el siguiente documento: ' },
  { titulo: 'Plano sin firma', texto: 'El plano presentado no cuenta con la firma y sello del profesional responsable.' },
  { titulo: 'Pago pendiente', texto: 'Falta acreditar el pago del derecho de trámite según el TUPA vigente.' },
  { titulo: 'Copia literal', texto: 'Presentar copia literal de dominio con antigüedad no mayor a 30 días.' },
  { titulo: 'DNI ilegible', texto: 'La copia del documento de identidad es ilegible; presentar una copia legible.' },
  { titulo: 'Memoria descriptiva', texto: 'Falta la memoria descriptiva firmada por el profesional responsable.' },
]

// =================================================================== RECEPCIÓN
// Un expediente derivado queda «por recibir» hasta que la persona (o alguien
// del departamento de destino) acepta la recepción con un clic. Se registra la
// fecha y hora exacta. Solo aplica a movimientos registrados en URBANITO.
P.esDestinoDe = function (u, m) {
  if (m.destino_tipo === 'USUARIO') return Number(m.destino_usuario_id || m.destino_codigo) === u.id
  if (m.destino_tipo === 'DEPARTAMENTO') {
    return ['JEFE_DEPARTAMENTO', 'TECNICO'].includes(u.rol) && (u.departamentos || []).includes(m.destino_codigo)
  }
  return false
}

P.recepcionesRegistradas = function (ids) {
  const m = new Map()
  for (let k = 0; k < ids.length; k += 500) {
    const parte = ids.slice(k, k + 500)
    if (!parte.length) continue
    for (const r of this.bd.todas(`SELECT * FROM recepciones WHERE movimiento_id IN (${parte.map(() => '?').join(',')})`, parte)) m.set(r.movimiento_id, r)
  }
  return m
}

P.pendientesRecepcion = function (u) {
  this.exigir(u, 'consultar')
  const candidatos = []
  for (const id of this.r.iua.keys()) {
    const movs = this.almacen.movimientos.get(id) || []
    const m = movs[movs.length - 1]
    if (!m || m.importado || !TIPOS_RECIBIBLES.has(m.tipo) || m.usuario_id === u.id) continue
    if (this.esDestinoDe(u, m)) candidatos.push(m)
  }
  const hechas = this.recepcionesRegistradas(candidatos.map(m => m.id))
  return candidatos.filter(m => !hechas.has(m.id)).map(m => {
    const e = this.almacen.expedientes.get(m.expediente_id)
    const f = this.filaExpediente(e)
    return { movimiento_id: m.id, expediente_id: e.id, numero: e.numero, procedimiento: f.procedimiento, nivel: f.nivel, iua: f.iua,
             tipo: m.tipo, fecha: m.fecha, registrado_en: m.registrado_en, destino: m.destino_nombre,
             derivado_por: m.usuario_id ? (this.usuarios.get(m.usuario_id) || {}).nombre_completo : null,
             documento: m.documento, observacion: m.observacion }
  }).sort((a, b) => (b.iua || 0) - (a.iua || 0))
}

P.recibirExpedientes = function (u, { movimiento_ids } = {}) {
  this.exigir(u, 'consultar')
  const ids = (Array.isArray(movimiento_ids) ? movimiento_ids : [movimiento_ids]).map(Number).filter(Boolean)
  if (!ids.length) throw new ErrorUsuario('Seleccione al menos un expediente por recibir.')
  const pendientes = new Map(this.pendientesRecepcion(u).map(p => [p.movimiento_id, p]))
  const ahora = ahoraIso()
  const recibidos = []
  this.bd.transaccion(() => {
    for (const id of ids) {
      const p = pendientes.get(id)
      if (!p) throw new ErrorUsuario('Uno de los expedientes ya fue recibido o no está dirigido a usted.')
      this.bd.ejecutar('INSERT INTO recepciones(movimiento_id, expediente_id, usuario_id, recibido_en) VALUES (?,?,?,?)', [id, p.expediente_id, u.id, ahora])
      this.auditar(u, 'RECIBIR_EXPEDIENTE', 'expedientes', p.expediente_id, `${p.numero}: recepción firmada (${ahora})`)
      recibidos.push(p.numero)
      // recibir su asignación cuenta como inicio del trabajo
      this.bd.ejecutar(`UPDATE asignaciones SET estado = 'EN_PROGRESO', actualizado_en = ?
                        WHERE expediente_id = ? AND usuario_id = ? AND estado = 'PENDIENTE'`, [ahora, p.expediente_id, u.id])
    }
  })
  this.ultimoCambio = ahoraIso()
  return { ok: true, recibidos: recibidos.length, recibido_en: ahora, numeros: recibidos }
}

// La ficha muestra quién recibió cada derivación y las asignaciones del expediente
const fichaOriginal = P.ficha
P.ficha = function (u, id) {
  const f = fichaOriginal.call(this, u, id)
  const rec = this.recepcionesRegistradas(f.movimientos.filter(m => !m.importado).map(m => m.id))
  for (const m of f.movimientos) {
    const r = rec.get(m.id)
    if (r) { m.recibido_en = r.recibido_en; m.recibido_por = (this.usuarios.get(r.usuario_id) || {}).nombre_completo || null }
    else if (!m.importado && TIPOS_RECIBIBLES.has(m.tipo)) m.por_recibir = true
  }
  const ult = f.movimientos[f.movimientos.length - 1]
  f.puede_recibir = !!(ult && ult.por_recibir && ACTIVOS.has(f.expediente.estado) && this.esDestinoDe(u, ult) && ult.usuario_id !== u.id)
  f.movimiento_por_recibir = f.puede_recibir ? ult.id : null
  f.asignaciones = this.bd.todas('SELECT * FROM asignaciones WHERE expediente_id = ? ORDER BY id DESC', [f.expediente.id])
    .map(a => ({ ...a, usuario: (this.usuarios.get(a.usuario_id) || {}).nombre_completo }))
  // tiempo por escritorio (para el historial visual): días hábiles por destino
  const porDestino = new Map()
  for (const m of f.movimientos) {
    if (m.dias_en_paso === null || m.dias_en_paso === undefined) continue
    const k = m.destino_nombre || m.destino_texto || 'Sin destino registrado'
    porDestino.set(k, (porDestino.get(k) || 0) + m.dias_en_paso)
  }
  f.tiempo_por_destino = [...porDestino.entries()].map(([destino, dias]) => ({ destino, dias })).sort((a, b) => b.dias - a.dias)
  return f
}

// =================================================================== PLANTILLAS DE OBSERVACIÓN
P.plantillasObservacion = function (u) {
  this.exigir(u, 'consultar')
  const v = this.almacen.configuracion.plantillas_observacion
  return Array.isArray(v) ? v : PLANTILLAS_DEFECTO
}

P.guardarPlantillasObservacion = function (u, { plantillas } = {}) {
  this.exigir(u, 'usuarios')
  if (!Array.isArray(plantillas)) throw new ErrorUsuario('Lista de plantillas inválida.')
  if (plantillas.length > 30) throw new ErrorUsuario('Máximo 30 plantillas.')
  const lista = plantillas.map(p => ({ titulo: texto(p && p.titulo, 40), texto: texto(p && p.texto, 500) }))
  for (const p of lista) {
    if (p.titulo.length < 2) throw new ErrorUsuario('Cada plantilla necesita un nombre corto (botón).')
    if (p.texto.length < 10) throw new ErrorUsuario(`El texto de «${p.titulo}» debe tener al menos 10 caracteres.`)
  }
  const anterior = this.plantillasObservacion(u)
  this.bd.transaccion(() => {
    this.bd.ejecutar("INSERT OR REPLACE INTO configuracion(clave, valor) VALUES ('plantillas_observacion', ?)", [JSON.stringify(lista)])
    this.auditar(u, 'CAMBIAR_PLANTILLAS_OBSERVACION', 'configuracion', 'plantillas_observacion', { antes: anterior, despues: lista })
  })
  this.almacen.configuracion.plantillas_observacion = lista
  return { ok: true, plantillas: lista }
}

// =================================================================== BÚSQUEDA UNIVERSAL
P.busquedaUniversal = function (u, { q } = {}) {
  this.exigir(u, 'consultar')
  const t = texto(q, 80).toUpperCase()
  if (t.length < 2) return { filas: [], total: 0 }
  const tn = normalizarTexto(t)
  const esDoc = /^\d{6,12}$/.test(t)
  const res = []
  for (const e of this.almacen.expedientes.values()) {
    const num = String(e.numero).toUpperCase()
    let puntaje = 0
    if (num === t) puntaje = 100
    else if (num.startsWith(t)) puntaje = 80
    else if (num.includes(t)) puntaje = 60
    if (esDoc && e.documento_identidad && String(e.documento_identidad).startsWith(t)) puntaje = Math.max(puntaje, e.documento_identidad === t ? 95 : 70)
    if (!puntaje && tn.length >= 3 && e.solicitante && normalizarTexto(e.solicitante).includes(tn)) puntaje = 40
    if (puntaje) res.push([puntaje, e])
  }
  res.sort((a, b) => b[0] - a[0] || (b[1].fecha_ingreso || '').localeCompare(a[1].fecha_ingreso || ''))
  return {
    total: res.length,
    filas: res.slice(0, 12).map(([, e]) => {
      const f = this.filaExpediente(e)
      return { id: e.id, numero: e.numero, sistema: e.sistema, solicitante: e.solicitante, documento_identidad: e.documento_identidad,
               procedimiento: f.procedimiento, estado_nombre: f.estado_nombre, nivel: f.nivel || null, fecha_ingreso: e.fecha_ingreso }
    }),
  }
}

// =================================================================== LOG DE ACTIVIDAD
const ACCIONES_EXPEDIENTE = ['REGISTRAR_EXPEDIENTE', 'DERIVAR', 'OBSERVAR', 'SUBSANAR', 'FINALIZAR', 'ARCHIVAR', 'REABRIR',
  'CORREGIR_EXPEDIENTE', 'RECIBIR_EXPEDIENTE', 'DEPURAR_IMPORTADO', 'CLASIFICAR_TRAMITE']

P.actividadUsuarios = function (u, { desde, hasta, usuario_id, detalle } = {}) {
  this.exigir(u, 'seguimiento')
  const hoy = this.hoy()
  const d = texto(desde, 10) || hoy
  const h = texto(hasta, 10) || hoy
  if (d > h) throw new ErrorUsuario('La fecha inicial es posterior a la final.')
  const ini = new Date(`${d}T00:00:00`).toISOString()
  const fin = new Date(new Date(`${h}T00:00:00`).getTime() + 86400000).toISOString()
  const cond = ['fecha_hora >= ?', 'fecha_hora < ?', 'usuario_id IS NOT NULL', "accion NOT IN ('LOGIN_FALLIDO')"]
  const p = [ini, fin]
  if (usuario_id) { cond.push('usuario_id = ?'); p.push(Number(usuario_id)) }
  const filas = this.bd.todas(`SELECT * FROM auditoria WHERE ${cond.join(' AND ')} ORDER BY id`, p)
  const local = (iso) => { const x = new Date(iso); const z = (n) => String(n).padStart(2, '0'); return `${x.getFullYear()}-${z(x.getMonth() + 1)}-${z(x.getDate())}` }
  const grupos = new Map()
  for (const a of filas) {
    const dia = local(a.fecha_hora)
    const k = `${a.usuario_id}|${dia}`
    if (!grupos.has(k)) {
      const usr = this.usuarios.get(a.usuario_id)
      grupos.set(k, { usuario_id: a.usuario_id, usuario: usr ? usr.nombre_completo : a.usuario, rol: usr ? seg.ROLES[usr.rol].nombre : '', dia,
                      acciones: 0, expedientes: new Set(), finalizados: 0, derivados: 0, observados: 0, registrados: 0, recibidos: 0,
                      ingresos: 0, primera: a.fecha_hora, ultima: a.fecha_hora })
    }
    const g = grupos.get(k)
    g.ultima = a.fecha_hora
    if (a.accion === 'LOGIN') { g.ingresos++; continue }
    if (a.accion === 'LOGOUT') continue
    g.acciones++
    if (a.entidad === 'expedientes' && a.entidad_id && ACCIONES_EXPEDIENTE.includes(a.accion)) g.expedientes.add(a.entidad_id)
    if (a.accion === 'FINALIZAR') g.finalizados++
    if (a.accion === 'DERIVAR') g.derivados++
    if (a.accion === 'OBSERVAR') g.observados++
    if (a.accion === 'REGISTRAR_EXPEDIENTE') g.registrados++
    if (a.accion === 'RECIBIR_EXPEDIENTE') g.recibidos++
  }
  const resumen = [...grupos.values()].map(g => ({ ...g, expedientes: g.expedientes.size }))
    .sort((a, b) => b.dia.localeCompare(a.dia) || b.acciones - a.acciones)
  let lista = null
  if (detalle && usuario_id) {
    lista = filas.filter(a => !['LOGIN', 'LOGOUT'].includes(a.accion)).slice(-500).reverse().map(a => {
      const e = a.entidad === 'expedientes' && a.entidad_id ? this.almacen.expedientes.get(Number(a.entidad_id)) : null
      return { id: a.id, fecha_hora: a.fecha_hora, accion: a.accion, numero: e ? e.numero : null, expediente_id: e ? e.id : null,
               detalle: a.detalle && a.detalle.length > 300 ? `${a.detalle.slice(0, 300)}…` : a.detalle }
    })
  }
  return { desde: d, hasta: h, resumen, detalle: lista,
           usuarios: [...this.usuarios.values()].filter(x => x.activo).map(x => ({ id: x.id, nombre: x.nombre_completo }))
             .sort((a, b) => a.nombre.localeCompare(b.nombre)) }
}

// =================================================================== ABANDONADOS
P.diasAbandono = function () {
  const v = Number((this.almacen.configuracion.parametros || {}).dias_abandono)
  return Number.isInteger(v) && v > 0 ? v : DIAS_ABANDONO_DEFECTO
}

const alertasOriginal = P.alertas
P.alertas = function (u) {
  const r = alertasOriginal.call(this, u)
  const x = this.diasAbandono()
  r.dias_abandono = x
  r.abandonados = this.expedientesEnAlcance(u).map(e => this.filaExpediente(e))
    .filter(f => f.dias_sin_movimiento !== null && f.dias_sin_movimiento !== undefined && f.dias_sin_movimiento >= x)
    .sort((a, b) => b.dias_sin_movimiento - a.dias_sin_movimiento)
  return r
}

// =================================================================== FINALIZADOS
// Quién finalizó: el usuario que registró el cierre en URBANITO o, en los
// registros importados, el último responsable que tuvo el expediente.
P.finalizadorDe = function (e, porAlias) {
  const movs = this.almacen.movimientos.get(e.id) || []
  for (let k = movs.length - 1; k >= 0; k--) {
    const m = movs[k]
    if (['FINALIZACION', 'ARCHIVO'].includes(m.tipo) && m.usuario_id && this.usuarios.has(m.usuario_id)) {
      return { clave: `U${m.usuario_id}`, nombre: this.usuarios.get(m.usuario_id).nombre_completo }
    }
    if (m.destino_tipo === 'USUARIO' || m.destino_tipo === 'RESPONSABLE') {
      const j = this.trabajadorDeMovimiento(m, porAlias)
      if (j) return { clave: `U${j}`, nombre: this.usuarios.get(j).nombre_completo }
      if (m.destino_nombre) return { clave: `R${String(m.destino_codigo || m.destino_nombre).toUpperCase()}`, nombre: m.destino_nombre }
    }
  }
  return { clave: 'SIN', nombre: 'Sin responsable registrado' }
}

P.finalizados = function (u, f = {}) {
  this.exigir(u, 'tablero')
  const estados = f.incluir_historicos ? new Set(['FINALIZADO', 'CERRADO_HISTORICO']) : new Set(['FINALIZADO'])
  const alcance = this.departamentosAlcance(u)
  const porAlias = this.mapaAlias()
  const filas = []
  for (const e of this.almacen.expedientes.values()) {
    if (!estados.has(e.estado) || !e.fecha_cierre) continue
    const dep = this.departamentoDe(e)
    if (alcance && !alcance.has(dep)) continue
    if (f.departamento && dep !== f.departamento) continue
    if (f.procedimiento && e.procedimiento_codigo !== f.procedimiento) continue
    if (f.desde && e.fecha_cierre < f.desde) continue
    if (f.hasta && e.fecha_cierre > f.hasta) continue
    const quien = this.finalizadorDe(e, porAlias)
    if (f.persona && quien.clave !== f.persona) continue
    const p = this.almacen.procedimientos.get(e.procedimiento_codigo) || {}
    const dias = this.r.diasCierre.has(e.id) ? this.r.diasCierre.get(e.id) : null
    filas.push({ id: e.id, numero: e.numero, sistema: e.sistema, solicitante: e.solicitante, procedimiento_codigo: e.procedimiento_codigo,
                 procedimiento: p.nombre || e.procedimiento_codigo, departamento_codigo: dep,
                 departamento: dep ? (this.departamentos.get(dep) || {}).nombre : 'Sin departamento',
                 fecha_ingreso: e.fecha_ingreso, fecha_cierre: e.fecha_cierre, estado_nombre: ESTADOS[e.estado],
                 dias_atencion: dias, plazo_tupa: p.plazo_tupa ?? null,
                 dentro_plazo: dias !== null && p.plazo_tupa !== null && p.plazo_tupa !== undefined ? dias <= p.plazo_tupa : null,
                 finalizado_por: quien.nombre, finalizado_por_clave: quien.clave, motivo_cierre: e.motivo_cierre })
  }
  filas.sort((a, b) => b.fecha_cierre.localeCompare(a.fecha_cierre) || b.id - a.id)
  const agrupar = (clave, nombre) => {
    const m = new Map()
    for (const x of filas) {
      const k = x[clave]
      if (!m.has(k)) m.set(k, { clave: k, nombre: nombre(x), n: 0, dias: [] })
      const g = m.get(k)
      g.n++
      if (x.dias_atencion !== null) g.dias.push(x.dias_atencion)
    }
    return [...m.values()].map(g => ({ clave: g.clave, nombre: g.nombre, n: g.n,
      mediana_dias: g.dias.length ? medidas(g.dias).mediana : null })).sort((a, b) => b.n - a.n)
  }
  const meses = new Map()
  for (const x of filas) {
    const k = x.fecha_cierre.slice(0, 7)
    if (!meses.has(k)) meses.set(k, { mes: k, n: 0, dias: [] })
    const g = meses.get(k)
    g.n++
    if (x.dias_atencion !== null) g.dias.push(x.dias_atencion)
  }
  const porMes = [...meses.values()].sort((a, b) => a.mes.localeCompare(b.mes)).slice(-36)
    .map(g => ({ mes: g.mes, finalizados: g.n, promedio_dias: g.dias.length ? g.dias.reduce((s, v) => s + v, 0) / g.dias.length : null,
                 mediana_dias: g.dias.length ? medidas(g.dias).mediana : null }))
  const conDias = filas.filter(x => x.dias_atencion !== null)
  const conPlazo = filas.filter(x => x.dentro_plazo !== null)
  const tam = f.todos ? filas.length : 1000
  return {
    total: filas.length, filas: filas.slice(0, tam), truncado: filas.length > tam,
    kpis: {
      finalizados: filas.length, con_tiempo: conDias.length,
      mediana_dias: conDias.length ? medidas(conDias.map(x => x.dias_atencion)).mediana : null,
      promedio_dias: conDias.length ? conDias.reduce((s, x) => s + x.dias_atencion, 0) / conDias.length : null,
      dentro_plazo: conPlazo.length ? conPlazo.filter(x => x.dentro_plazo).length / conPlazo.length : null,
    },
    por_mes: porMes,
    por_departamento: agrupar('departamento_codigo', x => x.departamento),
    por_trabajador: agrupar('finalizado_por_clave', x => x.finalizado_por).slice(0, 40),
    por_tramite: agrupar('procedimiento_codigo', x => x.procedimiento),
    personas: agrupar('finalizado_por_clave', x => x.finalizado_por).map(p => ({ clave: p.clave, nombre: p.nombre, n: p.n })),
  }
}

// =================================================================== ANTES vs DESPUÉS
// Compara el periodo previo a URBANITO con el posterior (fecha de
// implementación configurable; por defecto, la fecha de corte de la base
// inicial). Mismas definiciones del MTA: días hábiles efectivos de atención.
P.fechaImplementacion = function () {
  const cfg = this.almacen.configuracion
  return (cfg.parametros || {}).fecha_implementacion || (cfg.importacion || {}).fecha_corte || this.hoy()
}

P.antesDespues = function (u) {
  this.exigir(u, 'tablero')
  const corte = this.fechaImplementacion()
  const hoy = this.hoy()
  const alcance = this.departamentosAlcance(u)
  const periodo = (desde, hasta) => {
    const ingresados = [], dias = [], plazo = []
    let cerrados = 0
    for (const e of this.almacen.expedientes.values()) {
      if (!e.fecha_ingreso || e.fecha_invalida) continue
      if (e.fecha_ingreso < desde || e.fecha_ingreso >= hasta) continue
      if (alcance && !alcance.has(this.departamentoDe(e))) continue
      ingresados.push(e)
      if (CERRADOS.has(e.estado)) cerrados++
      if (this.r.diasCierre.has(e.id)) {
        const d = this.r.diasCierre.get(e.id)
        dias.push(d)
        const p = this.almacen.procedimientos.get(e.procedimiento_codigo)
        if (p && p.plazo_tupa !== null && p.plazo_tupa !== undefined) plazo.push(d <= p.plazo_tupa)
      }
    }
    const meses = Math.max(1, (new Date(hasta) - new Date(desde)) / (30.44 * 86400000))
    const m = medidas(dias)
    return {
      desde, hasta, meses, ingresados: ingresados.length, ingresos_por_mes: ingresados.length / meses,
      cerrados, tasa_cierre: ingresados.length ? cerrados / ingresados.length : null,
      con_tiempo: dias.length, mediana_dias: m ? m.mediana : null, media_dias: m ? m.media : null, p80_dias: m ? m.p80 : null,
      dentro_plazo: plazo.length ? plazo.filter(Boolean).length / plazo.length : null, con_plazo: plazo.length,
    }
  }
  const [a, m, d] = corte.split('-').map(Number)
  // periodo «antes» de la misma duración que el «después» (mínimo 12 meses) para comparar
  const duracion = Math.max(365, (new Date(hoy) - new Date(corte)) / 86400000)
  const inicioAntes = new Date(Date.UTC(a, m - 1, d) - duracion * 86400000).toISOString().slice(0, 10)
  const antes = periodo(inicioAntes, corte)
  const despues = periodo(corte, '9999-12-31')
  const variacion = (x, y) => (x === null || y === null || x === 0 ? null : (y - x) / x)
  return {
    fecha_implementacion: corte, antes, despues,
    variaciones: {
      mediana_dias: variacion(antes.mediana_dias, despues.mediana_dias),
      dentro_plazo: antes.dentro_plazo !== null && despues.dentro_plazo !== null ? despues.dentro_plazo - antes.dentro_plazo : null,
      tasa_cierre: antes.tasa_cierre !== null && despues.tasa_cierre !== null ? despues.tasa_cierre - antes.tasa_cierre : null,
    },
    advertencia: despues.con_tiempo < 30
      ? 'El periodo posterior todavía tiene menos de 30 expedientes cerrados: la comparación aún no es concluyente.' : null,
  }
}

// =================================================================== DEPARTAMENTOS
P.crearDepartamento = function (u, { nombre, codigo } = {}) {
  this.exigir(u, 'usuarios')
  const n = texto(nombre, 120)
  if (n.length < 5) throw new ErrorUsuario('Escriba el nombre del departamento (mínimo 5 caracteres).')
  const nombreCompleto = /^departamento\b/i.test(n) ? n : `Departamento de ${n}`
  if ([...this.departamentos.values()].some(d => normalizarTexto(d.nombre) === normalizarTexto(nombreCompleto))) {
    throw new ErrorUsuario('Ya existe un departamento con ese nombre.')
  }
  let c = texto(codigo, 40).toUpperCase()
  if (!c) c = `DEP_${normalizarTexto(n.replace(/^departamento de /i, '')).replace(/ /g, '_').slice(0, 30)}`
  if (!/^[A-Z0-9_]{3,40}$/.test(c)) throw new ErrorUsuario('El código solo puede tener letras mayúsculas, números y guion bajo.')
  if (this.departamentos.has(c)) throw new ErrorUsuario(`Ya existe el código ${c}.`)
  this.bd.transaccion(() => {
    this.bd.ejecutar('INSERT INTO departamentos(codigo, nombre, activo) VALUES (?,?,1)', [c, nombreCompleto])
    this.auditar(u, 'CREAR_DEPARTAMENTO', 'departamentos', c, nombreCompleto)
  })
  this.cargarCatalogos()
  return { ok: true, codigo: c, nombre: nombreCompleto }
}

module.exports = { PLANTILLAS_DEFECTO, DIAS_ABANDONO_DEFECTO }
