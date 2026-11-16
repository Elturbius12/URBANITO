// ===========================================================================
// ASIGNACIONES (Modelo 3, MILP) Y PANEL DE SEGUIMIENTO
// Se agregan como métodos de Sistema (ver sistema.js).
//
// Flujo: el administrador ejecuta el modelo → se calcula la eficiencia e_ij
// con el historial → se resuelve el MILP (y la heurística voraz para comparar)
// → PROPUESTA editable (no guarda asignaciones) → «Validar y asignar»: se
// valida de nuevo todo en el núcleo, se crean las asignaciones, se mueve el
// expediente al trabajador, se notifica a cada uno y se audita.
// ===========================================================================

const crypto = require('crypto')
const { Sistema, ErrorUsuario, CERRADOS, texto, ahoraIso } = require('./sistema')
const { ACTIVOS } = require('../motor/modelos')
const { calcularEficiencia, resolverMilp, resolverVoraz, valorObjetivo, EIJ_SIN_HISTORIAL, PESOS_EFICIENCIA } = require('../motor/asignacion')
const seg = require('./seguridad')
const { semanaIso, lunesDe } = require('./notificaciones')

const P = Sistema.prototype

const ESTADOS_ASIGNACION = {
  PENDIENTE: 'Pendiente', EN_PROGRESO: 'En progreso', COMPLETADA: 'Completada', REASIGNADA: 'Reasignada',
}
const ACTIVAS = ['PENDIENTE', 'EN_PROGRESO']
const ROLES_TRABAJADOR = ['TECNICO', 'JEFE_DEPARTAMENTO']
const NIVELES = ['CRÍTICO', 'ALTO', 'MEDIO', 'BAJO']
const PLAZO_ASIGNACION_DEFECTO = 10          // días hábiles para atender una asignación
const MAX_PROPUESTAS = 5
const VIGENCIA_PROPUESTA_MS = 3 * 3600 * 1000

// ---------------------------------------------------------------- quién es quién en el historial
// Trabajador (usuario de URBANITO) al que corresponde el destino de un movimiento:
// USUARIO → su id; RESPONSABLE (registro importado) → el usuario con ese alias histórico.
P.trabajadorDeMovimiento = function (m, porAlias) {
  if (m.destino_tipo === 'USUARIO') {
    const id = m.destino_usuario_id || Number(m.destino_codigo)
    return this.usuarios.has(id) ? id : null
  }
  if (m.destino_tipo === 'RESPONSABLE' && m.destino_codigo) {
    return porAlias.get(String(m.destino_codigo).toUpperCase()) || null
  }
  return null
}

P.mapaAlias = function () {
  const m = new Map()
  for (const u of this.usuarios.values()) if (u.alias_historico) m.set(u.alias_historico.toUpperCase(), u.id)
  return m
}

// ---------------------------------------------------------------- e_ij
// Registros de permanencia por trabajador sobre los expedientes cerrados que
// forman la base del MTA (mismas reglas: fechas válidas, ≥ 2 movimientos).
P.registrosEficiencia = function () {
  const porAlias = this.mapaAlias()
  const registros = []
  for (const [id, diasTotal] of this.r.diasCierre) {
    const e = this.almacen.expedientes.get(id)
    const movs = this.r.derivados.get(id).movs
    const proc = e.procedimiento_codigo
    if (!proc) continue
    const ref = this.r.plazoRef.get(proc)
    const aTiempo = ref && ref.valor !== null && ref.valor !== undefined ? diasTotal <= ref.valor : null
    // quién finalizó: el usuario que registró la FINALIZACION en URBANITO o, en los
    // importados, el último trabajador que tuvo el expediente
    const ultimo = movs[movs.length - 1]
    let finalizador = ultimo && ultimo.tipo === 'FINALIZACION' && ultimo.usuario_id && this.usuarios.has(ultimo.usuario_id) ? ultimo.usuario_id : null
    const pasos = []
    for (let k = 0; k < movs.length; k++) {
      const j = this.trabajadorDeMovimiento(movs[k], porAlias)
      if (!j) continue
      const sig = movs[k + 1]
      pasos.push({ j, dias: sig ? this.cal.diasHabiles(movs[k].fecha, sig.fecha) : null })
    }
    if (!finalizador && pasos.length) finalizador = pasos[pasos.length - 1].j
    // el finalizador se marca una sola vez: en su último paso por el expediente
    const ultimoPaso = pasos.map(x => x.j).lastIndexOf(finalizador)
    pasos.forEach((p, k) => {
      registros.push({ usuario_id: p.j, procedimiento_codigo: proc, expediente_id: id, dias_paso: p.dias,
                       finalizo: k === ultimoPaso, a_tiempo: aTiempo })
    })
    if (finalizador && ultimoPaso < 0) {
      registros.push({ usuario_id: finalizador, procedimiento_codigo: proc, expediente_id: id, dias_paso: null, finalizo: true, a_tiempo: aTiempo })
    }
  }
  return registros
}

// Recalcula la tabla eficiencia_trabajador. Debe llamarse DENTRO de una transacción.
P.recalcularEficiencia = function (umbral) {
  const tabla = calcularEficiencia(this.registrosEficiencia(), umbral)
  const ahora = ahoraIso()
  this.bd.ejecutar('DELETE FROM eficiencia_trabajador')
  const ins = this.bd.preparar(`INSERT INTO eficiencia_trabajador(usuario_id, procedimiento_codigo, total_atendidos,
    finalizados_a_tiempo, tiempo_promedio_dias, tasa_finalizacion, velocidad_relativa, experiencia, score_eij, actualizado_en)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
  try {
    for (const f of tabla.values()) {
      if (!this.almacen.procedimientos.has(f.procedimiento_codigo)) continue
      ins.ejecutar([f.usuario_id, f.procedimiento_codigo, f.total_atendidos, f.finalizados_a_tiempo, f.tiempo_promedio_dias,
        f.tasa_finalizacion, f.velocidad_relativa, f.experiencia, f.score_eij, ahora])
    }
  } finally { ins.liberar() }
  return tabla
}

// Consulta de la tabla (pantalla de transparencia del modelo)
P.eficienciaListar = function (u, { usuario_id } = {}) {
  this.exigirAlguno(u, ['asignaciones', 'asignaciones_ver', 'seguimiento'])
  const filas = this.bd.todas(`SELECT * FROM eficiencia_trabajador ${usuario_id ? 'WHERE usuario_id = ?' : ''}
                               ORDER BY usuario_id, total_atendidos DESC`, usuario_id ? [Number(usuario_id)] : [])
  return {
    pesos: PESOS_EFICIENCIA, sin_historial: EIJ_SIN_HISTORIAL,
    filas: filas.map(f => ({ ...f, usuario: (this.usuarios.get(f.usuario_id) || {}).nombre_completo,
                             procedimiento: (this.almacen.procedimientos.get(f.procedimiento_codigo) || {}).nombre || f.procedimiento_codigo })),
  }
}

// ---------------------------------------------------------------- permisos
P.exigirAlguno = function (u, permisos) {
  if (!permisos.some(p => seg.tienePermiso(u.rol, p))) throw new ErrorUsuario('No tiene permiso para esta acción.', 'PERMISO')
  if (u.debe_cambiar_clave) throw new ErrorUsuario('Debe cambiar su contraseña antes de continuar.', 'CAMBIAR_CLAVE')
}

// Departamento del expediente para la compatibilidad (restricción 3)
P.departamentoAsignacion = function (e) {
  return this.departamentoDe(e) || (e.ubicacion_tipo === 'DEPARTAMENTO' ? e.ubicacion_codigo : null)
}

P.cargaActiva = function () {
  const m = new Map()
  for (const f of this.bd.todas(`SELECT usuario_id, COUNT(*) n FROM asignaciones WHERE estado IN ('PENDIENTE','EN_PROGRESO') GROUP BY usuario_id`)) {
    m.set(f.usuario_id, f.n)
  }
  return m
}

P.trabajadoresAsignables = function ({ incluir_jefes = true } = {}) {
  const roles = incluir_jefes ? ROLES_TRABAJADOR : ['TECNICO']
  return [...this.usuarios.values()].filter(x => x.activo && roles.includes(x.rol) && (x.departamentos || []).length)
}

// ---------------------------------------------------------------- 1. ejecutar el modelo (propuesta)
P.asignacionEjecutar = async function (u, datos = {}) {
  this.exigir(u, 'asignaciones')
  const niveles = Array.isArray(datos.niveles) && datos.niveles.length ? datos.niveles.filter(n => NIVELES.includes(n)) : ['CRÍTICO', 'ALTO']
  if (!niveles.length) throw new ErrorUsuario('Elija al menos un nivel de urgencia.')
  const delta = datos.delta === undefined || datos.delta === '' ? 2 : Number(datos.delta)
  if (!Number.isFinite(delta) || delta < 0 || delta > 100) throw new ErrorUsuario('La tolerancia de equidad (δ) debe ser un número entre 0 y 100.')
  const umbral = datos.umbral === undefined || datos.umbral === '' ? 30 : Number(datos.umbral)
  if (!Number.isInteger(umbral) || umbral < 1 || umbral > 1000) throw new ErrorUsuario('El umbral de experiencia debe ser un entero entre 1 y 1000.')
  const limite = datos.limite === undefined || datos.limite === '' ? 2000 : Number(datos.limite)
  if (!Number.isInteger(limite) || limite < 1 || limite > 20000) throw new ErrorUsuario('El máximo de expedientes debe ser un entero entre 1 y 20000.')

  // e_ij desde el historial (se guarda en eficiencia_trabajador)
  let tabla
  this.bd.transaccion(() => {
    tabla = this.recalcularEficiencia(umbral)
    this.auditar(u, 'CALCULAR_EFICIENCIA', 'eficiencia_trabajador', null, { umbral, pares: tabla.size })
  })

  const carga = this.cargaActiva()
  const trabajadores = this.trabajadoresAsignables(datos).map(x => ({
    j: x.id, capacidad: Math.max(0, (x.capacidad_maxima ?? 10) - (carga.get(x.id) || 0)),
    capacidad_maxima: x.capacidad_maxima ?? 10, carga_actual: carga.get(x.id) || 0, departamentos: x.departamentos,
  }))
  const porDep = new Map()
  for (const t of trabajadores) for (const d of t.departamentos) {
    if (!porDep.has(d)) porDep.set(d, [])
    porDep.get(d).push(t.j)
  }
  const yaAsignados = new Set(this.bd.todas(`SELECT DISTINCT expediente_id id FROM asignaciones WHERE estado IN ('PENDIENTE','EN_PROGRESO')`).map(r => r.id))

  const expedientes = []
  const sinCompatible = []
  const candidatosOrden = [...this.r.iua.entries()]
    .filter(([id, i]) => niveles.includes(i.nivel) && !yaAsignados.has(id))
    .sort((a, b) => b[1].iua - a[1].iua || a[0] - b[0])
  for (const [id, i] of candidatosOrden.slice(0, limite)) {
    const e = this.almacen.expedientes.get(id)
    const dep = this.departamentoAsignacion(e)
    const js = dep ? (porDep.get(dep) || []) : []
    if (!js.length) { sinCompatible.push({ id, motivo: dep ? 'Ningún trabajador activo en su departamento' : 'Sin departamento identificado' }); continue }
    expedientes.push({
      id, w: i.iua, departamento: dep,
      candidatos: js.map(j => {
        const f = tabla.get(`${j}|${e.procedimiento_codigo}`)
        return { j, e: f ? f.score_eij : EIJ_SIN_HISTORIAL, con_historial: !!f }
      }),
    })
  }
  const problema = { expedientes, trabajadores, delta }

  const voraz = resolverVoraz(problema)
  let milp = await resolverMilp(problema)
  let elegido = milp && !milp.error && milp.estado !== 'INFACTIBLE' ? milp : voraz
  const aviso = milp && milp.error ? `${milp.error}. Se usó la heurística voraz.`
    : milp.estado === 'INFACTIBLE' ? 'El MILP no encontró solución; se usó la heurística voraz.' : null

  // guardar la propuesta en memoria (se valida contra ella al confirmar)
  const lote = `ASIG-${this.hoy().replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
  if (!this.propuestas) this.propuestas = new Map()
  for (const [k, v] of this.propuestas) if (Date.now() - v.creada > VIGENCIA_PROPUESTA_MS) this.propuestas.delete(k)
  while (this.propuestas.size >= MAX_PROPUESTAS) this.propuestas.delete(this.propuestas.keys().next().value)
  this.propuestas.set(lote, { creada: Date.now(), por: u.id, problema, metodo: elegido.metodo, asignacion: elegido.asignacion })

  const nombre = (j) => (this.usuarios.get(j) || {}).nombre_completo
  const filas = expedientes.map(x => {
    const e = this.almacen.expedientes.get(x.id)
    const fila = this.filaExpediente(e)
    const j = elegido.asignacion.get(x.id) || null
    const c = j ? x.candidatos.find(k => k.j === j) : null
    return {
      expediente_id: x.id, numero: e.numero, procedimiento: fila.procedimiento, departamento: fila.departamento,
      departamento_codigo: x.departamento, iua: x.w, nivel: fila.nivel, dias: fila.dias, vencido: fila.vencido,
      usuario_id: j, usuario: j ? nombre(j) : null, eij: c ? c.e : null, aporte: c ? x.w * c.e : 0,
      voraz_usuario_id: voraz.asignacion.get(x.id) || null,
      candidatos: x.candidatos.map(k => ({ usuario_id: k.j, nombre: nombre(k.j), eij: k.e, con_historial: k.con_historial }))
        .sort((a, b) => b.eij - a.eij),
    }
  })
  const resumen = trabajadores.map(t => {
    const asignados = filas.filter(f => f.usuario_id === t.j).length
    return { usuario_id: t.j, nombre: nombre(t.j), rol: seg.ROLES[this.usuarios.get(t.j).rol].nombre,
             departamentos: t.departamentos.map(d => (this.departamentos.get(d) || {}).nombre || d),
             capacidad_maxima: t.capacidad_maxima, carga_actual: t.carga_actual, disponible: t.capacidad, propuestos: asignados }
  }).sort((a, b) => b.propuestos - a.propuestos || a.nombre.localeCompare(b.nombre))

  const comparar = (s) => ({
    metodo: s.metodo, estado: s.estado, z: s.z, asignados: s.asignacion.size, duracion_ms: s.duracion_ms,
    relajaciones: s.relajaciones || [], restriccion_uno: s.restriccion_uno || null, equidad: s.equidad || null,
    variables: s.variables || null, restricciones: s.restricciones || null,
  })
  return {
    lote_id: lote, hoy: this.hoy(), niveles, delta, umbral, metodo: elegido.metodo, aviso,
    milp: milp && !milp.error ? comparar(milp) : null, voraz: comparar(voraz),
    mejora_milp: milp && !milp.error && voraz.z > 0 ? (milp.z - voraz.z) / voraz.z : null,
    filas, resumen, sin_compatible: sinCompatible.length,
    sin_compatible_muestra: sinCompatible.slice(0, 20).map(s => ({ ...s, numero: this.almacen.expedientes.get(s.id).numero })),
    candidatos_total: candidatosOrden.length, considerados: Math.min(limite, candidatosOrden.length),
    pesos: PESOS_EFICIENCIA, eij_sin_historial: EIJ_SIN_HISTORIAL,
  }
}

// ---------------------------------------------------------------- 2. confirmar
P.asignacionConfirmar = function (u, { lote_id, asignaciones, plazo_dias } = {}) {
  this.exigir(u, 'asignaciones')
  const prop = this.propuestas && this.propuestas.get(texto(lote_id, 40))
  if (!prop) throw new ErrorUsuario('La propuesta ya no está disponible (venció o el programa se reinició). Ejecute el modelo otra vez.')
  if (!Array.isArray(asignaciones) || !asignaciones.length) throw new ErrorUsuario('No hay asignaciones que confirmar.')
  const plazo = plazo_dias === undefined || plazo_dias === '' || plazo_dias === null ? PLAZO_ASIGNACION_DEFECTO : Number(plazo_dias)
  if (!Number.isInteger(plazo) || plazo < 1 || plazo > 120) throw new ErrorUsuario('El plazo de atención debe ser un entero de 1 a 120 días hábiles.')

  const porId = new Map(prop.problema.expedientes.map(x => [x.id, x]))
  const carga = this.cargaActiva()
  const usados = new Map()
  const yaAsignados = new Set(this.bd.todas(`SELECT DISTINCT expediente_id id FROM asignaciones WHERE estado IN ('PENDIENTE','EN_PROGRESO')`).map(r => r.id))
  const vistos = new Set()
  const lista = []
  for (const a of asignaciones) {
    const i = Number(a.expediente_id), j = Number(a.usuario_id)
    if (!i || !j) continue
    if (vistos.has(i)) throw new ErrorUsuario('Un expediente aparece dos veces en la propuesta.')
    vistos.add(i)
    const x = porId.get(i)
    const e = this.almacen.expedientes.get(i)
    if (!x || !e) throw new ErrorUsuario(`El expediente ${e ? e.numero : i} no forma parte de esta propuesta.`)
    if (!ACTIVOS.has(e.estado)) throw new ErrorUsuario(`El expediente ${e.numero} ya no está en trámite.`)
    if (yaAsignados.has(i)) throw new ErrorUsuario(`El expediente ${e.numero} ya tiene una asignación activa.`)
    const c = x.candidatos.find(k => k.j === j)
    const t = this.usuarios.get(j)
    if (!c || !t || !t.activo) throw new ErrorUsuario(`${t ? t.nombre_completo : 'El trabajador'} no pertenece al departamento del expediente ${e.numero} (restricción de compatibilidad).`)
    usados.set(j, (usados.get(j) || 0) + 1)
    const cap = (t.capacidad_maxima ?? 10) - (carga.get(j) || 0)
    if (usados.get(j) > cap) throw new ErrorUsuario(`${t.nombre_completo} superaría su capacidad máxima (${t.capacidad_maxima ?? 10} expedientes; ya tiene ${carga.get(j) || 0}).`)
    lista.push({ e, x, c, t })
  }
  if (!lista.length) throw new ErrorUsuario('No hay asignaciones válidas que confirmar.')

  const hoy = this.hoy()
  const ahora = ahoraIso()
  const asignacionMap = new Map(lista.map(l => [l.e.id, l.t.id]))
  const z = valorObjetivo(prop.problema, asignacionMap)
  const porTrabajador = new Map()
  this.bd.transaccion(() => {
    for (const { e, x, c, t } of lista) {
      const i = this.r.iua.get(e.id)
      const propio = this.cal.fechaLimite(hoy, plazo)
      const limite = i && i.fecha_limite && i.fecha_limite >= hoy && i.fecha_limite < propio ? i.fecha_limite : propio
      const id = this.bd.ejecutar(`INSERT INTO asignaciones(expediente_id, usuario_id, fecha_asignacion, fecha_limite, estado,
          iua_al_asignar, eij_score, lote_id, asignado_por, observacion, creado_en, actualizado_en)
          VALUES (?,?,?,?,'PENDIENTE',?,?,?,?,?,?,?)`,
        [e.id, t.id, hoy, limite, x.w, c.e, lote_id, u.id,
         prop.metodo === 'MILP' ? 'Modelo de asignación óptima (MILP)' : 'Heurística voraz', ahora, ahora]).ultimoId
      // el expediente pasa al trabajador (así aparece en su bandeja)
      const destino = { tipo: 'USUARIO', codigo: String(t.id), nombre: t.nombre_completo, usuario_id: t.id }
      this.insertarMovimiento(e, u, { fecha: hoy, tipo: 'REASIGNACION', destino,
        observacion: `Asignado por el modelo de asignación (lote ${lote_id}). Plazo de atención: ${this.cal.diasHabiles(hoy, limite)} días hábiles.` })
      this.bd.ejecutar(`UPDATE expedientes SET ubicacion_tipo = 'USUARIO', ubicacion_codigo = ?, ubicacion_nombre = ?,
                        responsable_usuario_id = ? WHERE id = ?`, [String(t.id), t.nombre_completo, t.id, e.id])
      const p = this.almacen.procedimientos.get(e.procedimiento_codigo)
      this.notificar(t.id, { tipo: 'ASIGNACION', titulo: `Se le asignó el expediente ${e.numero}`,
        mensaje: `Se te asignó el expediente ${e.numero}${p ? ` (${p.nombre})` : ''}. Plazo: ${this.cal.diasHabiles(hoy, limite)} días hábiles (hasta el ${limite.split('-').reverse().join('/')}).`,
        referencia_tipo: 'expediente', referencia_id: e.id })
      this.auditar(u, 'ASIGNAR_EXPEDIENTE', 'asignaciones', id, { lote: lote_id, expediente: e.numero, usuario: t.usuario,
        iua: x.w, eij: c.e, metodo: prop.metodo, fecha_limite: limite })
      porTrabajador.set(t.id, (porTrabajador.get(t.id) || 0) + 1)
    }
    this.auditar(u, 'CONFIRMAR_ASIGNACIONES', 'asignaciones', lote_id, {
      expedientes: lista.length, trabajadores: porTrabajador.size, z, metodo: prop.metodo, plazo_dias: plazo,
      modificadas_por_admin: lista.filter(l => prop.asignacion.get(l.e.id) !== l.t.id).length,
      quitadas_por_admin: [...prop.asignacion.keys()].filter(i => !asignacionMap.has(i)).length })
  })
  this.propuestas.delete(lote_id)
  for (const { e } of lista) this.recargarExpediente(e.id)
  this.recalcular()
  return {
    ok: true, lote_id, asignados: lista.length, trabajadores: porTrabajador.size, z,
    mensaje: `Se asignaron ${lista.length} expedientes a ${porTrabajador.size} trabajadores.`,
    por_trabajador: [...porTrabajador.entries()].map(([j, n]) => ({ usuario_id: j, nombre: this.usuarios.get(j).nombre_completo, asignados: n })),
  }
}

// ---------------------------------------------------------------- consultar asignaciones
P.filaAsignacion = function (a) {
  const e = this.almacen.expedientes.get(a.expediente_id)
  const f = e ? this.filaExpediente(e) : {}
  const t = this.usuarios.get(a.usuario_id)
  const movs = e ? (this.almacen.movimientos.get(e.id) || []) : []
  const ult = movs.length ? movs[movs.length - 1] : null
  const hoy = this.hoy()
  const restantes = a.fecha_limite && ACTIVAS.includes(a.estado) ? this.cal.diasHabiles(hoy, a.fecha_limite) : null
  return {
    ...a, estado_nombre: ESTADOS_ASIGNACION[a.estado] || a.estado,
    numero: f.numero, procedimiento: f.procedimiento, departamento: f.departamento, departamento_codigo: f.departamento_codigo,
    estado_expediente: f.estado, estado_expediente_nombre: f.estado_nombre, iua: f.iua ?? null, nivel: f.nivel || null,
    dias: f.dias ?? null, fecha_ingreso: f.fecha_ingreso, solicitante: f.solicitante,
    usuario: t ? t.nombre_completo : '—', asignado_por_nombre: a.asignado_por ? (this.usuarios.get(a.asignado_por) || {}).nombre_completo : null,
    dias_restantes: restantes, vencida: restantes !== null && restantes < 0,
    ultimo_movimiento: ult ? { fecha: ult.fecha, tipo: ult.tipo, destino: ult.destino_nombre || ult.destino_texto,
                               usuario: ult.usuario_id ? (this.usuarios.get(ult.usuario_id) || {}).nombre_completo : null,
                               registrado_en: ult.registrado_en } : null,
  }
}

P.asignacionesListar = function (u, f = {}) {
  this.exigirAlguno(u, ['asignaciones', 'asignaciones_ver', 'seguimiento', 'mis_asignaciones'])
  const todo = seg.tienePermiso(u.rol, 'asignaciones') || seg.tienePermiso(u.rol, 'seguimiento')
  const cond = [], p = []
  if (f.estado === 'ACTIVAS') cond.push("estado IN ('PENDIENTE','EN_PROGRESO')")
  else if (f.estado && ESTADOS_ASIGNACION[f.estado]) { cond.push('estado = ?'); p.push(f.estado) }
  if (f.usuario_id) { cond.push('usuario_id = ?'); p.push(Number(f.usuario_id)) }
  if (f.lote_id) { cond.push('lote_id = ?'); p.push(texto(f.lote_id, 40)) }
  if (f.desde) { cond.push('fecha_asignacion >= ?'); p.push(texto(f.desde, 10)) }
  if (f.hasta) { cond.push('fecha_asignacion <= ?'); p.push(texto(f.hasta, 10)) }
  if (f.solo_mias || (!todo && !seg.tienePermiso(u.rol, 'asignaciones_ver'))) { cond.push('usuario_id = ?'); p.push(u.id) }
  const filas = this.bd.todas(`SELECT * FROM asignaciones ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 5000`, p)
    .map(a => this.filaAsignacion(a))
  const deps = todo ? null : this.departamentosAlcance(u)
  const visibles = filas.filter(a => a.usuario_id === u.id || !deps || deps.has(a.departamento_codigo) ||
    ((this.usuarios.get(a.usuario_id) || {}).departamentos || []).some(d => deps.has(d)))
    .filter(a => !f.departamento || a.departamento_codigo === f.departamento)
  return {
    filas: visibles, estados: ESTADOS_ASIGNACION, puede_ejecutar: seg.tienePermiso(u.rol, 'asignaciones'),
    lotes: this.bd.todas(`SELECT lote_id, MIN(fecha_asignacion) fecha, COUNT(*) n, COUNT(DISTINCT usuario_id) trabajadores
                          FROM asignaciones GROUP BY lote_id ORDER BY MIN(id) DESC LIMIT 30`),
  }
}

// El trabajador actualiza su asignación; el administrador puede reasignarla.
P.asignacionActualizar = function (u, { id, estado, observacion, usuario_id } = {}) {
  this.exigirAlguno(u, ['asignaciones', 'mis_asignaciones'])
  const a = this.bd.una('SELECT * FROM asignaciones WHERE id = ?', [Number(id)])
  if (!a) throw new ErrorUsuario('La asignación no existe.', 'NO_EXISTE')
  const admin = seg.tienePermiso(u.rol, 'asignaciones')
  if (!admin && a.usuario_id !== u.id) throw new ErrorUsuario('Solo puede actualizar sus propias asignaciones.', 'PERMISO')
  if (!ACTIVAS.includes(a.estado)) throw new ErrorUsuario('La asignación ya está cerrada.')
  const obs = texto(observacion, 1000) || null
  const e = this.almacen.expedientes.get(a.expediente_id)
  const ahora = ahoraIso()

  if (usuario_id !== undefined && usuario_id !== null && usuario_id !== '') {
    if (!admin) throw new ErrorUsuario('Solo el administrador puede reasignar.', 'PERMISO')
    const t = this.usuarios.get(Number(usuario_id))
    if (!t || !t.activo || !ROLES_TRABAJADOR.includes(t.rol)) throw new ErrorUsuario('Trabajador inválido.')
    if (t.id === a.usuario_id) throw new ErrorUsuario('La asignación ya es de ese trabajador.')
    const dep = this.departamentoAsignacion(e)
    if (!dep || !(t.departamentos || []).includes(dep)) throw new ErrorUsuario(`${t.nombre_completo} no pertenece al departamento del expediente.`)
    const carga = this.cargaActiva().get(t.id) || 0
    if (carga >= (t.capacidad_maxima ?? 10)) throw new ErrorUsuario(`${t.nombre_completo} ya alcanzó su capacidad máxima.`)
    const fila = this.bd.una('SELECT score_eij FROM eficiencia_trabajador WHERE usuario_id = ? AND procedimiento_codigo = ?', [t.id, e.procedimiento_codigo])
    let nuevoId
    this.bd.transaccion(() => {
      this.bd.ejecutar("UPDATE asignaciones SET estado = 'REASIGNADA', observacion = ?, actualizado_en = ? WHERE id = ?",
        [obs || `Reasignada a ${t.nombre_completo}`, ahora, a.id])
      nuevoId = this.bd.ejecutar(`INSERT INTO asignaciones(expediente_id, usuario_id, fecha_asignacion, fecha_limite, estado,
          iua_al_asignar, eij_score, lote_id, asignado_por, observacion, creado_en, actualizado_en)
          VALUES (?,?,?,?,'PENDIENTE',?,?,?,?,?,?,?)`,
        [a.expediente_id, t.id, this.hoy(), a.fecha_limite, (this.r.iua.get(e.id) || {}).iua ?? a.iua_al_asignar,
         fila ? fila.score_eij : EIJ_SIN_HISTORIAL, a.lote_id, u.id, `Reasignación manual${obs ? `: ${obs}` : ''}`, ahora, ahora]).ultimoId
      if (ACTIVOS.has(e.estado)) {
        const destino = { tipo: 'USUARIO', codigo: String(t.id), nombre: t.nombre_completo, usuario_id: t.id }
        this.insertarMovimiento(e, u, { fecha: this.hoy(), tipo: 'REASIGNACION', destino, observacion: `Reasignación de la asignación #${a.id}` })
        this.bd.ejecutar(`UPDATE expedientes SET ubicacion_tipo = 'USUARIO', ubicacion_codigo = ?, ubicacion_nombre = ?,
                          responsable_usuario_id = ? WHERE id = ?`, [String(t.id), t.nombre_completo, t.id, e.id])
      }
      this.notificar(t.id, { tipo: 'ASIGNACION', titulo: `Se le asignó el expediente ${e.numero}`,
        mensaje: `Se te reasignó el expediente ${e.numero}. Fecha límite: ${a.fecha_limite ? a.fecha_limite.split('-').reverse().join('/') : '—'}.`,
        referencia_tipo: 'expediente', referencia_id: e.id })
      this.notificar(a.usuario_id, { tipo: 'ASIGNACION', titulo: `El expediente ${e.numero} fue reasignado`,
        mensaje: `El expediente ${e.numero} se reasignó a ${t.nombre_completo}.`, referencia_tipo: 'expediente', referencia_id: e.id })
      this.auditar(u, 'REASIGNAR_ASIGNACION', 'asignaciones', a.id, { expediente: e.numero, de: a.usuario_id, a: t.id, nueva: nuevoId, observacion: obs })
    })
    this.recargarExpediente(e.id)
    this.recalcular()
    return { ok: true, id: nuevoId }
  }

  if (!['PENDIENTE', 'EN_PROGRESO', 'COMPLETADA'].includes(estado)) throw new ErrorUsuario('Estado inválido.')
  if (estado === a.estado && !obs) throw new ErrorUsuario('No hay cambios que guardar.')
  this.bd.transaccion(() => {
    this.bd.ejecutar('UPDATE asignaciones SET estado = ?, observacion = COALESCE(?, observacion), actualizado_en = ? WHERE id = ?',
      [estado, obs, ahora, a.id])
    this.auditar(u, 'ACTUALIZAR_ASIGNACION', 'asignaciones', a.id, { expediente: e ? e.numero : a.expediente_id, antes: a.estado, despues: estado, observacion: obs })
  })
  this.ultimoCambio = ahoraIso()
  return { ok: true }
}

// Mantiene las asignaciones al día con lo que pasa en el expediente.
// Debe llamarse DENTRO de la transacción que modificó los expedientes.
//   expediente cerrado                           → asignación COMPLETADA
//   el asignado (u otro) registró un movimiento  → PENDIENTE pasa a EN_PROGRESO
P.sincronizarAsignaciones = function (ids) {
  const ahora = ahoraIso()
  for (const id of ids) {
    const activas = this.bd.todas("SELECT * FROM asignaciones WHERE expediente_id = ? AND estado IN ('PENDIENTE','EN_PROGRESO')", [id])
    if (!activas.length) continue
    const e = this.bd.una('SELECT estado FROM expedientes WHERE id = ?', [id])
    for (const a of activas) {
      if (!e || CERRADOS.has(e.estado)) {
        this.bd.ejecutar("UPDATE asignaciones SET estado = 'COMPLETADA', actualizado_en = ?, observacion = ? WHERE id = ?",
          [ahora, `Cerrada automáticamente: el expediente quedó ${e ? e.estado.toLowerCase() : 'eliminado'}`, a.id])
        continue
      }
      if (a.estado === 'PENDIENTE') {
        const mov = this.bd.una(`SELECT id FROM movimientos WHERE expediente_id = ? AND importado = 0 AND usuario_id = ?
                                 AND registrado_en > ? LIMIT 1`, [id, a.usuario_id, a.creado_en])
        if (mov) this.bd.ejecutar("UPDATE asignaciones SET estado = 'EN_PROGRESO', actualizado_en = ? WHERE id = ?", [ahora, a.id])
      }
    }
  }
}

// ---------------------------------------------------------------- panel de seguimiento
P.seguimiento = function (u, f = {}) {
  this.exigir(u, 'seguimiento')
  const hoy = this.hoy()
  const lunes = lunesDe(hoy)
  const semana = semanaIso(hoy)
  let trabajadores = this.trabajadoresAsignables()
  if (f.usuario_id) trabajadores = trabajadores.filter(t => t.id === Number(f.usuario_id))
  if (f.departamento) trabajadores = trabajadores.filter(t => (t.departamentos || []).includes(f.departamento))
  const cond = [], p = []
  if (f.desde) { cond.push('fecha_asignacion >= ?'); p.push(texto(f.desde, 10)) }
  if (f.hasta) { cond.push('fecha_asignacion <= ?'); p.push(texto(f.hasta, 10)) }
  const todas = this.bd.todas(`SELECT * FROM asignaciones ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''} ORDER BY id DESC`, p)
  const porUsuario = new Map()
  for (const a of todas) {
    if (!porUsuario.has(a.usuario_id)) porUsuario.set(a.usuario_id, [])
    porUsuario.get(a.usuario_id).push(a)
  }
  const reportes = new Map(this.bd.todas('SELECT usuario_id, fecha_llenado FROM reportes_semanales WHERE semana = ?', [semana])
    .map(r => [r.usuario_id, r.fecha_llenado]))
  const nombreDep = (c) => ((this.departamentos.get(c) || {}).nombre || c).replace(/^Departamento de /, '')
  const salida = trabajadores.map(t => {
    const lista = porUsuario.get(t.id) || []
    const filas = lista.map(a => this.filaAsignacion(a))
      .filter(a => !f.estado || (f.estado === 'ACTIVAS' ? ACTIVAS.includes(a.estado) : a.estado === f.estado))
    const completadas = lista.filter(a => a.estado === 'COMPLETADA')
    const completadasSemana = completadas.filter(a => (a.actualizado_en || '').slice(0, 10) >= lunes)
    const activas = lista.filter(a => ACTIVAS.includes(a.estado))
    const tiempos = completadas.map(a => this.cal.diasHabiles(a.fecha_asignacion, (a.actualizado_en || a.fecha_asignacion).slice(0, 10)))
      .filter(v => v !== null && v >= 0)
    const baseSemana = activas.length + completadasSemana.length
    return {
      usuario_id: t.id, nombre: t.nombre_completo, rol: seg.ROLES[t.rol].nombre,
      departamentos: (t.departamentos || []).map(nombreDep), departamentos_codigos: t.departamentos || [],
      capacidad_maxima: t.capacidad_maxima ?? 10,
      asignadas: lista.filter(a => a.estado !== 'REASIGNADA').length, activas: activas.length,
      completadas: completadas.length, completadas_semana: completadasSemana.length,
      vencidas: activas.filter(a => a.fecha_limite && a.fecha_limite < hoy).length,
      avance_semanal: baseSemana ? completadasSemana.length / baseSemana : null,
      promedio_dias_cierre: tiempos.length ? tiempos.reduce((s, v) => s + v, 0) / tiempos.length : null,
      reporte_semana: reportes.get(t.id) || null,
      asignaciones: filas,
    }
  })
  const tot = (k) => salida.reduce((s, x) => s + x[k], 0)
  return {
    hoy, semana, lunes, trabajadores: salida, estados: ESTADOS_ASIGNACION,
    totales: { asignadas: tot('asignadas'), activas: tot('activas'), completadas: tot('completadas'),
               completadas_semana: tot('completadas_semana'), vencidas: tot('vencidas') },
    departamentos: [...this.departamentos.values()].filter(d => d.activo).map(d => ({ codigo: d.codigo, nombre: d.nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    datos_cambiados: this.ultimoCambio || null,
  }
}

module.exports = { ESTADOS_ASIGNACION, ACTIVAS }
