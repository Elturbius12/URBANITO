// Consultas de solo lectura que alimentan las pantallas.
// Se agregan como métodos de Sistema (ver sistema.js).

const { Sistema, ErrorUsuario, ESTADOS, CERRADOS, RESULTADOS_FINALIZACION, MOTIVOS_ARCHIVO } = require('./sistema')
const { ACTIVOS, claveUbicacion } = require('../motor/modelos')
const { percentilDe } = require('../motor/estadistica')
const seg = require('./seguridad')

const P = Sistema.prototype

function claveMtaUbicacion(e) {
  if (!e.ubicacion_tipo || e.ubicacion_codigo === null || e.ubicacion_codigo === undefined) return null
  const amb = (e.ubicacion_tipo === 'UNIDAD ORGANICA' || e.ubicacion_tipo === 'DEPARTAMENTO') ? 'unidad'
    : (e.ubicacion_tipo === 'RESPONSABLE' || e.ubicacion_tipo === 'USUARIO') ? 'responsable' : null
  return amb ? `${amb}|${e.ubicacion_tipo}:${e.ubicacion_codigo}` : null
}

P.filaExpediente = function (e) {
  const p = this.almacen.procedimientos.get(e.procedimiento_codigo) || {}
  const dep = p.departamento_codigo ? this.departamentos.get(p.departamento_codigo) : null
  const i = this.r.iua.get(e.id)
  const resp = e.responsable_usuario_id ? this.usuarios.get(e.responsable_usuario_id) : null
  const d = this.r.derivados.get(e.id)
  const fila = {
    id: e.id, numero: e.numero, sistema: e.sistema, solicitante: e.solicitante,
    procedimiento_codigo: e.procedimiento_codigo, procedimiento: p.nombre || e.procedimiento_codigo,
    departamento_codigo: p.departamento_codigo || null, departamento: dep ? dep.nombre : null,
    fecha_ingreso: e.fecha_ingreso, fecha_invalida: !!e.fecha_invalida, estado: e.estado,
    estado_nombre: ESTADOS[e.estado] || e.estado, fecha_cierre: e.fecha_cierre,
    ubicacion_tipo: e.ubicacion_tipo, ubicacion: resp ? resp.nombre_completo : (e.ubicacion_nombre || 'Sin ubicación registrada'),
    responsable_id: e.responsable_usuario_id, importado: !!e.importado,
    ultimo_movimiento: d ? d.ultima_fecha : null,
  }
  if (i) {
    const kMta = claveMtaUbicacion(e)
    const perm = kMta ? this.r.mta.destino.get(kMta) : null
    Object.assign(fila, {
      iua: i.iua, nivel: i.nivel, accion: i.accion, prioridad: i.prioridad, vencido: i.vencido,
      dias: i.dias, dias_sin_movimiento: i.dias_sin_movimiento, dias_restantes: i.dias_restantes,
      plazo_tupa: i.plazo_tupa, fecha_limite: i.fecha_limite, origen_plazo: i.origen_plazo,
      plazo_referencia: i.plazo_referencia, factores_omitidos: i.factores_omitidos,
      p80_permanencia_ubicacion: perm ? perm.p80 : null,
      estancado: !!(perm && i.dias_sin_movimiento !== null && i.dias_sin_movimiento > perm.p80),
    })
  }
  return fila
}

P.expedientesEnAlcance = function (u) {
  const lista = []
  for (const id of this.r.iua.keys()) {
    const e = this.almacen.expedientes.get(id)
    if (this.enAlcance(u, e)) lista.push(e)
  }
  return lista
}

// --------------------------------------------------------------- inicio
P.resumen = function (u) {
  const hoy = this.hoy()
  const par = this.almacen.configuracion.parametros
  const out = { hoy, rol: u.rol, calculado_en: this.r.calculado_en, dias_alerta: par.dias_alerta_por_vencer,
                fecha_corte_importacion: this.almacen.configuracion.importacion.fecha_corte }
  if (u.rol !== 'MESA_PARTES') {
    const filas = this.expedientesEnAlcance(u).map(e => this.filaExpediente(e))
    const niveles = { 'CRÍTICO': 0, ALTO: 0, MEDIO: 0, BAJO: 0 }
    for (const f of filas) niveles[f.nivel]++
    Object.assign(out, {
      en_tramite: filas.length,
      observados: filas.filter(f => f.estado === 'OBSERVADO').length,
      vencidos: filas.filter(f => f.vencido).length,
      por_vencer: filas.filter(f => !f.vencido && f.dias_restantes !== null && f.dias_restantes <= par.dias_alerta_por_vencer).length,
      estancados: filas.filter(f => f.estancado).length,
      niveles,
      top: filas.sort((a, b) => b.iua - a.iua).slice(0, 8),
      importados_en_tramite: filas.filter(f => f.importado).length,
      sin_tramite: filas.filter(f => ['VACIO', 'SIN_CLASIFICAR'].includes(f.procedimiento_codigo)).length,
    })
  }
  // actividad del propio usuario hoy
  out.mis_acciones_hoy = this.bd.una('SELECT COUNT(*) n FROM auditoria WHERE usuario_id = ? AND fecha_hora >= ? AND accion NOT IN (\'LOGIN\',\'LOGOUT\')',
    [u.id, new Date(`${hoy}T00:00:00`).toISOString()]).n
  if (u.rol === 'MESA_PARTES' || u.rol === 'ADMINISTRADOR') {
    out.registrados_hoy = this.bd.una("SELECT COUNT(*) n FROM expedientes WHERE sistema='URBANITO' AND fecha_ingreso = ?", [hoy]).n
    out.observados_total = [...this.almacen.expedientes.values()].filter(e => e.estado === 'OBSERVADO').length
  }
  return out
}

// --------------------------------------------------------------- bandeja
P.bandeja = function (u, f = {}) {
  this.exigir(u, 'bandeja')
  const q = (f.texto || '').trim().toUpperCase()
  let filas = this.expedientesEnAlcance(u).map(e => this.filaExpediente(e))
  if (f.nivel) filas = filas.filter(x => x.nivel === f.nivel)
  if (f.departamento) filas = filas.filter(x => (x.departamento_codigo || 'SIN') === f.departamento)
  if (f.procedimiento) filas = filas.filter(x => x.procedimiento_codigo === f.procedimiento)
  if (f.estado) filas = filas.filter(x => x.estado === f.estado)
  if (f.solo_vencidos) filas = filas.filter(x => x.vencido)
  if (f.solo_mios) filas = filas.filter(x => this.asignadoA(u, this.almacen.expedientes.get(x.id)))
  if (f.ubicacion) filas = filas.filter(x => x.ubicacion === f.ubicacion)
  if (q) filas = filas.filter(x => String(x.numero).toUpperCase().includes(q) || String(x.solicitante || '').toUpperCase().includes(q))
  filas.sort((a, b) => b.iua - a.iua || a.id - b.id)
  const todas = this.expedientesEnAlcance(u).map(e => this.filaExpediente(e))
  const opciones = {
    departamentos: [...new Map(todas.map(x => [x.departamento_codigo || 'SIN', x.departamento || 'Sin departamento asignado'])).entries()]
      .map(([codigo, nombre]) => ({ codigo, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    procedimientos: [...new Map(todas.map(x => [x.procedimiento_codigo, x.procedimiento])).entries()]
      .map(([codigo, nombre]) => ({ codigo, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    ubicaciones: [...new Set(todas.map(x => x.ubicacion))].sort(),
  }
  return { filas, total: filas.length, opciones, calculado_en: this.r.calculado_en, hoy: this.r.hoy }
}

// --------------------------------------------------------------- alertas
P.alertas = function (u) {
  this.exigir(u, 'alertas')
  const n = this.almacen.configuracion.parametros.dias_alerta_por_vencer
  const filas = this.expedientesEnAlcance(u).map(e => this.filaExpediente(e))
  return {
    dias_alerta: n,
    vencidos: filas.filter(f => f.vencido).sort((a, b) => a.dias_restantes - b.dias_restantes),
    por_vencer: filas.filter(f => !f.vencido && f.dias_restantes !== null && f.dias_restantes <= n)
      .sort((a, b) => a.dias_restantes - b.dias_restantes),
    estancados: filas.filter(f => f.estancado)
      .sort((a, b) => (b.dias_sin_movimiento - b.p80_permanencia_ubicacion) - (a.dias_sin_movimiento - a.p80_permanencia_ubicacion)),
    observados: filas.filter(f => f.estado === 'OBSERVADO').sort((a, b) => (b.dias_sin_movimiento || 0) - (a.dias_sin_movimiento || 0)),
    sin_plazo_referencia: filas.filter(f => f.factores_omitidos && f.factores_omitidos.length),
  }
}

// --------------------------------------------------------------- buscar
P.buscar = function (u, f = {}) {
  this.exigir(u, 'consultar')
  const q = (f.texto || '').trim().toUpperCase()
  const doc = (f.documento || '').trim().toUpperCase()
  let lista = [...this.almacen.expedientes.values()]
  if (q) lista = lista.filter(e => String(e.numero).toUpperCase().includes(q) || String(e.solicitante || '').toUpperCase().includes(q))
  if (doc) lista = lista.filter(e => String(e.documento_identidad || '').toUpperCase() === doc)
  if (f.estado) lista = lista.filter(e => e.estado === f.estado)
  if (f.sistema) lista = lista.filter(e => e.sistema === f.sistema)
  if (f.importacion) lista = lista.filter(e => e.importacion_id === Number(f.importacion))
  if (f.procedimiento) lista = lista.filter(e => e.procedimiento_codigo === f.procedimiento)
  if (f.desde) lista = lista.filter(e => e.fecha_ingreso && e.fecha_ingreso >= f.desde)
  if (f.hasta) lista = lista.filter(e => e.fecha_ingreso && e.fecha_ingreso <= f.hasta)
  lista.sort((a, b) => (b.fecha_ingreso || '').localeCompare(a.fecha_ingreso || '') || b.id - a.id)
  const total = lista.length
  const tam = 100
  const pagina = Math.max(1, Number(f.pagina) || 1)
  const filas = lista.slice((pagina - 1) * tam, pagina * tam).map(e => this.filaExpediente(e))
  return { total, pagina, tam, filas }
}

// Exportación completa (sin paginar) para reportes
P.exportarBusqueda = function (u, f = {}) {
  this.exigir(u, 'reportes')
  const q = (f.texto || '').trim().toUpperCase()
  let lista = [...this.almacen.expedientes.values()]
  if (q) lista = lista.filter(e => String(e.numero).toUpperCase().includes(q) || String(e.solicitante || '').toUpperCase().includes(q))
  if (f.estado) lista = lista.filter(e => e.estado === f.estado)
  if (f.sistema) lista = lista.filter(e => e.sistema === f.sistema)
  if (f.procedimiento) lista = lista.filter(e => e.procedimiento_codigo === f.procedimiento)
  if (f.departamento) lista = lista.filter(e => this.departamentoDe(e) === f.departamento)
  if (f.desde) lista = lista.filter(e => e.fecha_ingreso && e.fecha_ingreso >= f.desde)
  if (f.hasta) lista = lista.filter(e => e.fecha_ingreso && e.fecha_ingreso <= f.hasta)
  const deps = u.rol === 'JEFE_DEPARTAMENTO' || u._depActivo ? this.departamentosAlcance(u) : null
  if (deps) lista = lista.filter(e => deps.has(this.departamentoDe(e)))
  lista.sort((a, b) => (a.fecha_ingreso || '').localeCompare(b.fecha_ingreso || '') || a.id - b.id)
  return lista.map(e => {
    const x = this.filaExpediente(e)
    x.dias_atencion = this.r.diasCierre.has(e.id) ? this.r.diasCierre.get(e.id) : null
    x.motivo_cierre = e.motivo_cierre
    return x
  })
}

// Productividad: acciones registradas en URBANITO por cada usuario (datos reales del uso del sistema)
P.productividad = function (u, { desde, hasta } = {}) {
  this.exigir(u, 'reportes')
  const d = desde || '2000-01-01'
  const h = hasta || '2100-12-31'
  const filas = this.bd.todas(`SELECT m.usuario_id, m.tipo, COUNT(*) n, COUNT(DISTINCT m.expediente_id) exps
                               FROM movimientos m WHERE m.importado = 0 AND m.usuario_id IS NOT NULL AND m.fecha BETWEEN ? AND ?
                               GROUP BY m.usuario_id, m.tipo`, [d, h])
  const por = new Map()
  const deps = u.rol === 'JEFE_DEPARTAMENTO' || u._depActivo ? this.departamentosAlcance(u) : null
  for (const f of filas) {
    const usr = this.usuarios.get(f.usuario_id)
    if (!usr) continue
    if (deps && !(usr.departamentos || []).some(d => deps.has(d))) continue
    if (!por.has(f.usuario_id)) {
      por.set(f.usuario_id, { usuario: usr.usuario, nombre: usr.nombre_completo, rol: seg.ROLES[usr.rol].nombre,
        REGISTRO: 0, DERIVACION: 0, OBSERVACION: 0, SUBSANACION: 0, FINALIZACION: 0, ARCHIVO: 0, REAPERTURA: 0, total: 0 })
    }
    const x = por.get(f.usuario_id)
    x[f.tipo] = (x[f.tipo] || 0) + f.n
    x.total += f.n
  }
  // a cargo hoy
  for (const [id, x] of por) {
    x.a_cargo = [...this.r.iua.keys()].filter(i => this.almacen.expedientes.get(i).responsable_usuario_id === id).length
  }
  return [...por.values()].sort((a, b) => b.total - a.total)
}

// --------------------------------------------------------------- ficha
P.ficha = function (u, id) {
  this.exigir(u, 'consultar')
  const e = this.almacen.expedientes.get(Number(id))
  if (!e) throw new ErrorUsuario('El expediente no existe.', 'NO_EXISTE')
  const fila = this.filaExpediente(e)
  const p = this.almacen.procedimientos.get(e.procedimiento_codigo) || {}
  const movs = (this.almacen.movimientos.get(e.id) || []).map(m => {
    const usr = m.usuario_id ? this.usuarios.get(m.usuario_id) : null
    return { ...m, usuario_nombre: usr ? usr.nombre_completo : null }
  })
  // días en cada paso (del movimiento i al i+1, en días hábiles)
  const validos = movs.filter(m => m.fecha_valida && m.fecha)
  for (let k = 0; k < validos.length; k++) {
    const sig = validos[k + 1]
    validos[k].dias_en_paso = sig ? this.cal.diasHabiles(validos[k].fecha, sig.fecha)
      : (ACTIVOS.has(e.estado) ? this.cal.diasHabiles(validos[k].fecha, this.hoy()) : null)
    validos[k].paso_actual = !sig && ACTIVOS.has(e.estado)
  }
  const i = this.r.iua.get(e.id)
  let iua = null
  if (i) {
    iua = {
      ...i,
      pesos: this.r.ahp.pesos_por_factor,
      factores_meta: this.almacen.configuracion.ahp.factores,
      referencias: { antiguedad: this.r.referencias.antiguedad, max_carga: this.r.referencias.max_carga,
                     cortes: this.almacen.configuracion.parametros.cortes,
                     escala_tipo: this.almacen.configuracion.parametros.escala_tipo },
      total_activos: this.r.iua.size,
    }
  }
  // comparación con el MTA
  const mt = this.r.mta.tramite.get(e.procedimiento_codigo)
  const dist = this.r.mta.distribuciones.get(e.procedimiento_codigo)
  let mta = null
  if (mt) {
    const propio = i ? i.dias : (this.r.diasCierre.has(e.id) ? this.r.diasCierre.get(e.id) : null)
    mta = {
      n: mt.n, media: mt.media, mediana: mt.mediana, p80: mt.p80, p95: mt.p95, datos_suficientes: mt.datos_suficientes,
      tasa_cumplimiento: mt.tasa_cumplimiento, plazo_tupa: mt.plazo_tupa, interpretacion: mt.interpretacion,
      dias_expediente: propio, en_curso: !!i,
      percentil_expediente: mt.datos_suficientes ? percentilDe(dist, propio) : null,
    }
  }
  let suspendidos = 0
  if (i) suspendidos = i.dias_suspendidos
  return {
    expediente: { ...e, ...fila, documento_identidad: e.documento_identidad, telefono: e.telefono,
                  direccion: e.direccion, asunto: e.asunto, folios: e.folios, motivo_cierre: e.motivo_cierre,
                  registrado_por: e.registrado_por ? (this.usuarios.get(e.registrado_por) || {}).nombre_completo : null,
                  creado_en: e.creado_en },
    procedimiento: p,
    movimientos: movs,
    iua, mta, dias_suspendidos: suspendidos,
    acciones: this.accionesPermitidas(u, e),
    en_alcance: this.enAlcance(u, e),
  }
}

// --------------------------------------------------------------- estimación (mesa de partes)
P.estimacion = function (codigo, fecha) {
  const p = this.almacen.procedimientos.get(codigo)
  if (!p) throw new ErrorUsuario('Procedimiento inválido.')
  const f = fecha || this.hoy()
  const mt = this.r.mta.tramite.get(codigo)
  const out = {
    procedimiento: p.nombre, tupa_codigo: p.tupa_codigo, tupa_nombre: p.tupa_nombre, plazo_tupa: p.plazo_tupa,
    fecha_ingreso: f,
    fecha_limite_tupa: p.plazo_tupa !== null && p.plazo_tupa !== undefined ? this.cal.fechaLimite(f, p.plazo_tupa) : null,
    departamento: p.departamento_codigo ? (this.departamentos.get(p.departamento_codigo) || {}).nombre : null,
    mta: null,
  }
  if (mt && mt.datos_suficientes) {
    out.mta = {
      n: mt.n, mediana: mt.mediana, p80: mt.p80, tasa_cumplimiento: mt.tasa_cumplimiento,
      interpretacion: mt.interpretacion,
      fecha_estimada_mediana: this.cal.fechaLimite(f, Math.ceil(mt.mediana)),
      fecha_estimada_p80: this.cal.fechaLimite(f, Math.ceil(mt.p80)),
    }
  } else if (mt) {
    out.mta = { n: mt.n, insuficiente: true }
  }
  return out
}

// --------------------------------------------------------------- catálogos
P.catalogos = function (u) {
  return {
    procedimientos: [...this.almacen.procedimientos.values()]
      .map(p => ({ codigo: p.codigo, nombre: p.nombre, grupo: p.grupo, plazo_tupa: p.plazo_tupa,
                   tupa_codigo: p.tupa_codigo, departamento_codigo: p.departamento_codigo,
                   seleccionable: !!p.seleccionable, activo: !!p.activo, es_tramite: !!p.es_tramite }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    departamentos: [...this.departamentos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)),
    unidades: [...this.unidades.values()].filter(x => x.activo).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    usuarios_destino: [...this.usuarios.values()]
      .filter(x => x.activo && ['JEFE_DEPARTAMENTO', 'TECNICO', 'GERENTE'].includes(x.rol))
      .map(x => ({ id: x.id, nombre: x.nombre_completo, rol: seg.ROLES[x.rol].nombre, departamento_codigo: x.departamento_codigo,
                   departamentos: x.departamentos || [] }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    estados: ESTADOS,
    resultados_finalizacion: RESULTADOS_FINALIZACION,
    motivos_archivo: MOTIVOS_ARCHIVO,
    roles: seg.ROLES,
    parametros: this.almacen.configuracion.parametros,
    institucion: this.almacen.configuracion.institucion,
    importacion: this.almacen.configuracion.importacion,
    hoy: this.hoy(),
  }
}

// --------------------------------------------------------------- departamentos
P.departamentosResumen = function (u) {
  this.exigir(u, 'departamentos')
  const filas = []
  const alcance = this.departamentosAlcance(u)
  for (const d of this.departamentos.values()) {
    if (alcance && !alcance.has(d.codigo)) continue
    const procs = [...this.almacen.procedimientos.values()].filter(p => p.departamento_codigo === d.codigo)
    const tramites = procs.map(p => {
      const mt = this.r.mta.tramite.get(p.codigo)
      let total = 0, activos = 0, criticos = 0, vencidos = 0, sumIua = 0
      for (const e of this.almacen.expedientes.values()) {
        if (e.procedimiento_codigo !== p.codigo) continue
        total++
        const i = this.r.iua.get(e.id)
        if (i) { activos++; sumIua += i.iua; if (i.nivel === 'CRÍTICO') criticos++; if (i.vencido) vencidos++ }
      }
      return {
        codigo: p.codigo, nombre: p.nombre, plazo_tupa: p.plazo_tupa, tupa_codigo: p.tupa_codigo,
        expedientes: total, en_tramite: activos, criticos, vencidos,
        iua_promedio: activos ? sumIua / activos : null,
        mta: mt ? { n: mt.n, mediana: mt.mediana, p80: mt.p80, tasa_cumplimiento: mt.tasa_cumplimiento,
                    datos_suficientes: mt.datos_suficientes } : null,
      }
    })
    const usuarios = [...this.usuarios.values()].filter(x => x.activo && (x.departamentos || []).includes(d.codigo))
      .map(x => ({ id: x.id, nombre: x.nombre_completo, rol: seg.ROLES[x.rol].nombre }))
    filas.push({
      codigo: d.codigo, nombre: d.nombre, tramites, usuarios,
      total_expedientes: tramites.reduce((s, t) => s + t.expedientes, 0),
      total_en_tramite: tramites.reduce((s, t) => s + t.en_tramite, 0),
      total_criticos: tramites.reduce((s, t) => s + t.criticos, 0),
      total_vencidos: tramites.reduce((s, t) => s + t.vencidos, 0),
    })
  }
  return filas.sort((a, b) => a.nombre.localeCompare(b.nombre))
}

// --------------------------------------------------------------- tablero gerencial
P.tablero = function (u, { departamento } = {}) {
  this.exigir(u, 'tablero')
  // Conjunto de departamentos del tablero: el elegido (si está en su alcance)
  // o todos los de su alcance. null = vista general.
  const alcance = this.departamentosAlcance(u)
  let deps = alcance
  if (departamento) {
    if (alcance && !alcance.has(departamento)) throw new ErrorUsuario('Ese departamento no está en su alcance.', 'PERMISO')
    deps = new Set([departamento])
  }
  const dep = deps && deps.size === 1 ? [...deps][0] : null
  const delDep = (e) => !deps || deps.has(this.departamentoDe(e))
  const hoy = this.hoy()

  const activos = this.expedientesEnAlcance(u).filter(delDep).map(e => this.filaExpediente(e))
  const niveles = { 'CRÍTICO': 0, ALTO: 0, MEDIO: 0, BAJO: 0 }
  for (const f of activos) niveles[f.nivel]++

  // carga por ubicación
  const carga = new Map()
  for (const f of activos) {
    if (!carga.has(f.ubicacion)) carga.set(f.ubicacion, { ubicacion: f.ubicacion, expedientes: 0, criticos: 0, vencidos: 0, suma_iua: 0 })
    const c = carga.get(f.ubicacion)
    c.expedientes++; c.suma_iua += f.iua
    if (f.nivel === 'CRÍTICO') c.criticos++
    if (f.vencido) c.vencidos++
  }
  const cargaLista = [...carga.values()].map(c => ({ ...c, iua_promedio: c.suma_iua / c.expedientes }))
    .sort((a, b) => b.expedientes - a.expedientes)

  // serie mensual: ingresos y cierres (últimos 24 meses hasta hoy)
  const meses = []
  const [ay, am] = hoy.split('-').map(Number)
  for (let k = 23; k >= 0; k--) {
    const t = new Date(Date.UTC(ay, am - 1 - k, 1))
    meses.push(t.toISOString().slice(0, 7))
  }
  const ingresos = new Map(meses.map(m => [m, 0]))
  const cierres = new Map(meses.map(m => [m, 0]))
  for (const e of this.almacen.expedientes.values()) {
    if (!delDep(e)) continue
    if (e.fecha_ingreso && !e.fecha_invalida && ingresos.has(e.fecha_ingreso.slice(0, 7))) {
      ingresos.set(e.fecha_ingreso.slice(0, 7), ingresos.get(e.fecha_ingreso.slice(0, 7)) + 1)
    }
    if (CERRADOS.has(e.estado) && e.fecha_cierre && cierres.has(e.fecha_cierre.slice(0, 7))) {
      cierres.set(e.fecha_cierre.slice(0, 7), cierres.get(e.fecha_cierre.slice(0, 7)) + 1)
    }
  }
  const serie = meses.map(m => ({ mes: m, ingresos: ingresos.get(m), cierres: cierres.get(m) }))

  // cumplimiento del TUPA (MTA)
  const cumplimiento = [...this.r.mta.tramite.values()]
    .filter(m => m.datos_suficientes && m.tasa_cumplimiento !== null && (!deps || deps.has(m.departamento_codigo)))
    .map(m => ({ codigo: m.codigo, nombre: m.nombre, n: m.n, mediana: m.mediana, p80: m.p80,
                 plazo_tupa: m.plazo_tupa, tasa_cumplimiento: m.tasa_cumplimiento, brecha_p80_tupa: m.brecha_p80_tupa }))
    .sort((a, b) => a.tasa_cumplimiento - b.tasa_cumplimiento)

  // por departamento (solo vista general)
  let porDepartamento = null
  if (!dep) {
    const m = new Map()
    for (const f of activos) {
      const k = f.departamento || 'Sin departamento asignado'
      if (!m.has(k)) m.set(k, { departamento: k, en_tramite: 0, criticos: 0, vencidos: 0 })
      const x = m.get(k)
      x.en_tramite++
      if (f.nivel === 'CRÍTICO') x.criticos++
      if (f.vencido) x.vencidos++
    }
    porDepartamento = [...m.values()].sort((a, b) => b.en_tramite - a.en_tramite)
  }

  // finalizados en URBANITO (operación real del sistema)
  const propios = [...this.almacen.expedientes.values()].filter(e => e.sistema === 'URBANITO' && delDep(e))
  const propiosCerrados = propios.filter(e => e.estado === 'FINALIZADO' && this.r.diasCierre.has(e.id))
  let dentroPlazo = 0, conPlazo = 0
  for (const e of propiosCerrados) {
    const p = this.almacen.procedimientos.get(e.procedimiento_codigo)
    if (p && p.plazo_tupa !== null && p.plazo_tupa !== undefined) {
      conPlazo++
      if (this.r.diasCierre.get(e.id) <= p.plazo_tupa) dentroPlazo++
    }
  }

  return {
    departamento: dep, departamento_nombre: dep ? (this.departamentos.get(dep) || {}).nombre : null,
    departamentos: deps ? [...deps] : null,
    kpis: {
      en_tramite: activos.length, criticos: niveles['CRÍTICO'],
      vencidos: activos.filter(f => f.vencido).length,
      observados: activos.filter(f => f.estado === 'OBSERVADO').length,
      estancados: activos.filter(f => f.estancado).length,
      iua_promedio: activos.length ? activos.reduce((s, f) => s + f.iua, 0) / activos.length : null,
      registrados_urbanito: propios.length,
      finalizados_urbanito: propiosCerrados.length,
      cumplimiento_urbanito: conPlazo ? dentroPlazo / conPlazo : null,
      finalizados_urbanito_con_plazo: conPlazo,
    },
    niveles, carga: cargaLista.slice(0, 15), serie, cumplimiento, por_departamento: porDepartamento,
    criticos_top: activos.sort((a, b) => b.iua - a.iua).slice(0, 10),
    calculado_en: this.r.calculado_en,
  }
}

// --------------------------------------------------------------- modelos (transparencia)
P.modelos = function (u) {
  this.exigir(u, 'modelos_ver')
  const cfg = this.almacen.configuracion
  const valores = [...this.r.iua.values()].map(v => v.iua).sort((a, b) => a - b)
  const hist = new Array(10).fill(0)
  for (const v of valores) hist[Math.min(9, Math.floor(v * 10))]++
  const niveles = { 'CRÍTICO': 0, ALTO: 0, MEDIO: 0, BAJO: 0 }
  let porVencimiento = 0, omitidos = 0
  for (const v of this.r.iua.values()) {
    niveles[v.nivel]++
    if (v.vencido && v.iua < cfg.parametros.cortes[0][1]) porVencimiento++
    if (v.factores_omitidos.length) omitidos++
  }
  const plazos = [...this.r.plazoRef.entries()].map(([codigo, v]) => {
    const p = this.almacen.procedimientos.get(codigo)
    const mt = this.r.mta.tramite.get(codigo)
    return { codigo, nombre: p.nombre, plazo_referencia: v.valor, origen: v.origen,
             p80_observado: mt && mt.datos_suficientes ? mt.p80 : null, n: mt ? mt.n : 0 }
  }).filter(x => x.n > 0 || x.origen !== 'SIN DATOS').sort((a, b) => b.n - a.n)

  const lista = (m) => [...m.values()]
  return {
    calculado_en: this.r.calculado_en, duracion_ms: this.r.duracion_ms, hoy: this.r.hoy,
    importacion: cfg.importacion,
    ahp: {
      matriz: cfg.ahp.matriz, factores: cfg.ahp.factores.map((f, k) => ({ ...f, peso: this.r.ahp.pesos[k] })),
      lambda_max: this.r.ahp.lambda_max, ic: this.r.ahp.ic, ia: this.r.ahp.ia, rc: this.r.ahp.rc,
      consistente: this.r.ahp.consistente, puede_editar: seg.tienePermiso(u.rol, 'modelos_editar'),
    },
    parametros: cfg.parametros,
    iua: {
      evaluados: this.r.iua.size, niveles, histograma: hist,
      minimo: valores[0] ?? null, maximo: valores[valores.length - 1] ?? null,
      criticos_por_vencimiento: porVencimiento, con_factores_omitidos: omitidos,
      referencia_antiguedad: this.r.referencias.antiguedad, carga_maxima: this.r.referencias.max_carga,
    },
    mta: {
      base_n: this.r.mta.base_n,
      total_expedientes: this.almacen.expedientes.size,
      tramites: lista(this.r.mta.tramite).sort((a, b) => b.n - a.n),
      unidades: lista(this.r.mta.destino).filter(x => x.ambito === 'unidad').sort((a, b) => b.n - a.n),
      responsables: lista(this.r.mta.destino).filter(x => x.ambito === 'responsable').sort((a, b) => b.n - a.n),
    },
    plazos,
  }
}

// --------------------------------------------------------------- mesa de partes
P.mesaPartes = function (u) {
  this.exigir(u, 'consultar')
  const hoy = this.hoy()
  const hoyLista = [...this.almacen.expedientes.values()]
    .filter(e => e.sistema === 'URBANITO' && e.fecha_ingreso === hoy)
    .sort((a, b) => b.id - a.id).map(e => this.filaExpediente(e))
  const observados = [...this.almacen.expedientes.values()].filter(e => e.estado === 'OBSERVADO')
    .map(e => {
      const movs = this.almacen.movimientos.get(e.id) || []
      const obs = [...movs].reverse().find(m => m.tipo === 'OBSERVACION')
      return { ...this.filaExpediente(e), observacion: obs ? obs.observacion : null, fecha_observacion: obs ? obs.fecha : null }
    })
  return { registrados_hoy: hoyLista, observados }
}

// --------------------------------------------------------------- depuración de importados
P.importadosEnTramite = function (u, f = {}) {
  this.exigir(u, 'depurar')
  let filas = this.expedientesEnAlcance(u).filter(e => e.importado).map(e => this.filaExpediente(e))
  if (f.min_dias_sin_movimiento) filas = filas.filter(x => (x.dias_sin_movimiento || 0) >= Number(f.min_dias_sin_movimiento))
  if (f.procedimiento) filas = filas.filter(x => x.procedimiento_codigo === f.procedimiento)
  if (f.sin_tramite) filas = filas.filter(x => ['VACIO', 'SIN_CLASIFICAR'].includes(x.procedimiento_codigo))
  return filas.sort((a, b) => (b.dias_sin_movimiento || 0) - (a.dias_sin_movimiento || 0))
}

// --------------------------------------------------------------- administración
P.listarProcedimientos = function (u) {
  this.exigir(u, 'usuarios')
  const conteo = new Map()
  for (const e of this.almacen.expedientes.values()) conteo.set(e.procedimiento_codigo, (conteo.get(e.procedimiento_codigo) || 0) + 1)
  return [...this.almacen.procedimientos.values()].map(p => ({
    ...p, expedientes: conteo.get(p.codigo) || 0,
    departamento: p.departamento_codigo ? (this.departamentos.get(p.departamento_codigo) || {}).nombre : null,
  })).sort((a, b) => b.expedientes - a.expedientes)
}

P.listarFeriados = function (u, anio) {
  this.exigir(u, 'consultar')
  const a = String(anio || this.hoy().slice(0, 4))
  return this.bd.todas('SELECT * FROM feriados WHERE fecha LIKE ? ORDER BY fecha', [`${a}-%`])
}

module.exports = { claveMtaUbicacion }
