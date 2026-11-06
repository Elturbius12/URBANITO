// ===========================================================================
// MOTOR DE MODELOS — URBANITO
// ---------------------------------------------------------------------------
// Modelo 2 (MTA): estadística descriptiva de los tiempos reales de atención,
//   calculada sobre los expedientes cerrados con trayectoria registrada.
// Modelo 1 (IUA): índice de urgencia de cada expediente en trámite, con
//   pesos obtenidos por AHP y plazos de referencia del TUPA o del MTA.
//
// Se recalcula completo cada vez que cambian los datos (registro, derivación,
// cierre de un expediente, cambio de pesos o de feriados) y al cambiar el día.
// La implementación de referencia en Python (herramientas/referencia_modelos.py)
// calcula lo mismo; pruebas/validar_motor.js compara ambas.
// ===========================================================================

const { medidas, interpretar } = require('./estadistica')
const { cuantil } = require('./estadistica')
const { calcularAhp } = require('./ahp')

const ACTIVOS = new Set(['EN_TRAMITE', 'OBSERVADO'])
const BASE_MTA = new Set(['CERRADO_HISTORICO', 'FINALIZADO'])

function normalizarTexto(s) {
  if (s === null || s === undefined) return ''
  return String(s).normalize('NFD').replace(/\p{Mn}/gu, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ').trim()
}

function claveDestino(m) {
  if (!m.destino_tipo || m.destino_tipo === 'SIN DATO') return null
  if (m.destino_codigo !== null && m.destino_codigo !== undefined && m.destino_codigo !== '') {
    return `${m.destino_tipo}:${m.destino_codigo}`
  }
  const t = normalizarTexto(m.destino_texto)
  return t ? `TXT:${t}` : null
}

function claveUbicacion(e) {
  if (!e.ubicacion_tipo || e.ubicacion_codigo === null || e.ubicacion_codigo === undefined ||
      e.ubicacion_codigo === '') return 'SIN UBICACION'
  return `${e.ubicacion_tipo}:${e.ubicacion_codigo}`
}

// Días hábiles en que el expediente estuvo observado (plazo suspendido,
// art. 136 de la Ley 27444): de cada OBSERVACION a su SUBSANACION.
function diasSuspendidos(cal, movs, hasta) {
  let dias = 0, abierta = null
  for (const m of movs) {
    if (m.tipo === 'OBSERVACION') abierta = m.fecha
    else if (m.tipo === 'SUBSANACION' && abierta !== null) {
      dias += cal.diasHabiles(abierta, m.fecha)
      abierta = null
    }
  }
  if (abierta !== null && hasta) dias += cal.diasHabiles(abierta, hasta)
  return dias
}

function nivelDe(valor, vencido, cortes) {
  if (vencido) return ['CRÍTICO', 'Plazo TUPA vencido — atender hoy']
  for (const [nivel, corte, accion] of cortes) if (valor >= corte) return [nivel, accion]
  return ['BAJO', 'Sin apremio']
}

/**
 * @param {object} almacen  { expedientes: Map<id, fila>, movimientos: Map<id, fila[]>,
 *                            procedimientos: Map<codigo, fila>, configuracion: {...} }
 * @param {Calendario} cal
 * @param {string} hoy  AAAA-MM-DD
 */
function calcularModelos(almacen, cal, hoy) {
  const inicio = Date.now()
  const cfg = almacen.configuracion
  const par = cfg.parametros
  const procs = almacen.procedimientos

  // ------------------------------------------------ derivados por expediente
  const derivados = new Map()
  for (const [id, e] of almacen.expedientes) {
    const movs = (almacen.movimientos.get(id) || []).filter(m => m.fecha_valida && m.fecha)
    const claves = new Set()
    for (const m of movs) {
      const k = claveDestino(m)
      if (k) claves.add(k)
    }
    derivados.set(id, {
      movs,
      n_mov: movs.length,
      n_oficinas: claves.size,
      ultima_fecha: movs.length ? movs[movs.length - 1].fecha : null,
    })
  }

  // ------------------------------------------------ MTA: base de cálculo
  const diasCierre = new Map()        // id -> días hábiles efectivos de atención
  for (const [id, e] of almacen.expedientes) {
    if (!BASE_MTA.has(e.estado)) continue
    const d = derivados.get(id)
    if (d.n_mov < par.mov_minimo || e.fecha_invalida || !e.fecha_ingreso || !e.fecha_cierre) continue
    if (e.fecha_cierre < e.fecha_ingreso) continue
    const dias = cal.diasHabiles(e.fecha_ingreso, e.fecha_cierre) - diasSuspendidos(cal, d.movs, null)
    if (dias === null || Number.isNaN(dias)) continue
    diasCierre.set(id, dias)
  }

  // MTA por trámite
  const porTramite = new Map()
  for (const [id, dias] of diasCierre) {
    const cod = almacen.expedientes.get(id).procedimiento_codigo
    if (!cod) continue
    if (!porTramite.has(cod)) porTramite.set(cod, [])
    porTramite.get(cod).push(dias)
  }
  const mtaTramite = new Map()
  const distribuciones = new Map()
  for (const [cod, valores] of porTramite) {
    const p = procs.get(cod)
    const plazo = p && p.plazo_tupa !== null && p.plazo_tupa !== undefined ? p.plazo_tupa : null
    const m = medidas(valores, plazo)
    m.datos_suficientes = m.n >= par.n_minimo
    m.interpretacion = m.datos_suficientes ? interpretar(m.coef_variacion) : 'sin datos suficientes'
    m.codigo = cod
    m.nombre = p ? p.nombre : cod
    m.departamento_codigo = p ? p.departamento_codigo : null
    mtaTramite.set(cod, m)
    distribuciones.set(cod, [...valores].sort((a, b) => a - b))
  }

  // MTA por destino: permanencia en cada paso (del movimiento i al i+1),
  // atribuida al destino del movimiento i.
  const permanencia = new Map()
  for (const id of diasCierre.keys()) {
    const movs = derivados.get(id).movs
    for (let i = 0; i < movs.length - 1; i++) {
      const a = movs[i], b = movs[i + 1]
      let ambito
      if (a.destino_tipo === 'UNIDAD ORGANICA' || a.destino_tipo === 'DEPARTAMENTO') ambito = 'unidad'
      else if (a.destino_tipo === 'RESPONSABLE' || a.destino_tipo === 'USUARIO') ambito = 'responsable'
      else continue
      const k = `${ambito}|${a.destino_tipo}:${a.destino_codigo}`
      if (!permanencia.has(k)) {
        permanencia.set(k, { ambito, tipo: a.destino_tipo, codigo: a.destino_codigo,
                             nombre: a.destino_nombre, dias: [], exp: new Set() })
      }
      const r = permanencia.get(k)
      r.dias.push(cal.diasHabiles(a.fecha, b.fecha))
      r.exp.add(id)
    }
  }
  const mtaDestino = new Map()
  for (const [k, r] of permanencia) {
    const m = medidas(r.dias)
    if (m.n < par.n_minimo) continue
    m.expedientes_atendidos = r.exp.size
    m.ambito = r.ambito
    m.tipo = r.tipo
    m.codigo = r.codigo
    m.nombre = r.nombre
    m.interpretacion = interpretar(m.coef_variacion)
    mtaDestino.set(k, m)
  }

  // Plazo de referencia para el IUA: el TUPA manda; si el trámite no tiene
  // plazo legal, se usa el P80 observado (si hay datos suficientes).
  const plazoRef = new Map()
  for (const [cod, p] of procs) {
    if (p.plazo_tupa !== null && p.plazo_tupa !== undefined) {
      plazoRef.set(cod, { valor: p.plazo_tupa, origen: 'TUPA' })
    } else if (mtaTramite.has(cod) && mtaTramite.get(cod).datos_suficientes) {
      plazoRef.set(cod, { valor: mtaTramite.get(cod).p80, origen: 'P80 OBSERVADO' })
    } else {
      plazoRef.set(cod, { valor: null, origen: 'SIN DATOS' })
    }
  }

  // ------------------------------------------------ AHP
  const ahp = calcularAhp(cfg.ahp.matriz)
  const codigosFactor = cfg.ahp.factores.map(f => f.codigo)
  const pesos = {}
  codigosFactor.forEach((c, i) => { pesos[c] = ahp.pesos[i] })

  // ------------------------------------------------ IUA: referencias
  const oficinasPorProc = new Map()
  for (const [id, e] of almacen.expedientes) {
    if (!e.procedimiento_codigo) continue
    if (!oficinasPorProc.has(e.procedimiento_codigo)) oficinasPorProc.set(e.procedimiento_codigo, [])
    oficinasPorProc.get(e.procedimiento_codigo).push(derivados.get(id).n_oficinas)
  }
  const refOficinas = new Map()
  for (const [cod, v] of oficinasPorProc) {
    v.sort((a, b) => a - b)
    refOficinas.set(cod, Math.max(cuantil(v, par.percentil_complejidad), par.piso_complejidad))
  }

  const activos = []
  for (const [id, e] of almacen.expedientes) {
    if (!ACTIVOS.has(e.estado)) continue
    const d = derivados.get(id)
    let dias = null, suspendidos = 0
    if (!e.fecha_invalida && e.fecha_ingreso && e.fecha_ingreso <= hoy) {
      suspendidos = diasSuspendidos(cal, d.movs, hoy)
      dias = Math.max(0, cal.diasHabiles(e.fecha_ingreso, hoy) - suspendidos)
    }
    const diasSin = d.ultima_fecha ? cal.diasHabiles(d.ultima_fecha, hoy) : null
    activos.push({ id, e, d, dias, diasSin, suspendidos, ubic: claveUbicacion(e) })
  }

  const valoresAnt = activos.filter(a => a.dias !== null).map(a => a.dias).sort((a, b) => a - b)
  const refAntiguedad = valoresAnt.length
    ? Math.max(cuantil(valoresAnt, par.percentil_antiguedad), 1) : 1

  const carga = new Map()
  for (const a of activos) carga.set(a.ubic, (carga.get(a.ubic) || 0) + 1)
  const maxCarga = carga.size ? Math.max(...carga.values()) : 1

  const norm = (v, ref) => (v === null || v === undefined || ref === null || ref === undefined || ref <= 0)
    ? null : Math.min(1, Math.max(0, v / ref))

  // ------------------------------------------------ IUA: cálculo
  const esc = par.escala_tipo
  const iua = new Map()
  for (const a of activos) {
    const e = a.e
    const p = procs.get(e.procedimiento_codigo) || {}
    const ref = plazoRef.get(e.procedimiento_codigo) || { valor: null, origen: 'SIN DATOS' }
    const plazoTupa = p.plazo_tupa !== null && p.plazo_tupa !== undefined ? p.plazo_tupa : null

    let fu = null
    if (a.dias !== null && ref.valor !== null) {
      fu = ref.valor === 0 ? (a.dias > 0 ? 1 : 0) : Math.min(1, Math.max(0, a.dias / ref.valor))
    }
    const refOf = refOficinas.has(e.procedimiento_codigo)
      ? refOficinas.get(e.procedimiento_codigo) : par.piso_complejidad
    const fc = norm(a.d.n_oficinas, refOf)
    const fa = norm(a.dias, refAntiguedad)
    const ft = plazoTupa !== null ? esc.con_plazo_tupa
      : (p.es_tramite === 1 ? esc.tramite_ciudadano : esc.acto_interno)
    const fcar = norm(carga.get(a.ubic), maxCarga)

    const factores = { urgencia_temporal: fu, complejidad: fc, antiguedad: fa,
                       tipo_procedimiento: ft, carga_trabajo: fcar }
    let pesoDisp = 0
    for (const k of codigosFactor) if (factores[k] !== null) pesoDisp += pesos[k]
    let valor = 0
    const aportes = {}
    for (const k of codigosFactor) {
      if (factores[k] === null) { aportes[k] = null; continue }
      aportes[k] = (pesos[k] * factores[k]) / pesoDisp
      valor += aportes[k]
    }
    const vencido = plazoTupa !== null && a.dias !== null && a.dias > plazoTupa
    const [nivel, accion] = nivelDe(valor, vencido, par.cortes)
    const omitidos = codigosFactor.filter(k => factores[k] === null)

    let fechaLimite = null
    if (plazoTupa !== null && e.fecha_ingreso && !e.fecha_invalida) {
      fechaLimite = cal.fechaLimite(e.fecha_ingreso, plazoTupa + a.suspendidos)
    }

    iua.set(a.id, {
      iua: valor, nivel, accion, vencido,
      dias: a.dias, dias_sin_movimiento: a.diasSin, dias_suspendidos: a.suspendidos,
      plazo_tupa: plazoTupa,
      dias_restantes: plazoTupa !== null && a.dias !== null ? plazoTupa - a.dias : null,
      fecha_limite: fechaLimite,
      plazo_referencia: ref.valor, origen_plazo: ref.origen,
      n_movimientos: a.d.n_mov, n_oficinas: a.d.n_oficinas,
      referencia_oficinas: refOf,
      carga_ubicacion: carga.get(a.ubic),
      factores, aportes, factores_omitidos: omitidos,
    })
  }

  // prioridad (1 = más urgente)
  const orden = [...iua.entries()].sort((x, y) => y[1].iua - x[1].iua || x[0] - y[0])
  orden.forEach(([, v], i) => { v.prioridad = i + 1 })

  return {
    hoy,
    calculado_en: new Date().toISOString(),
    duracion_ms: Date.now() - inicio,
    ahp: { ...ahp, pesos_por_factor: pesos, factores: cfg.ahp.factores },
    mta: {
      base_n: diasCierre.size,
      tramite: mtaTramite,
      destino: mtaDestino,
      distribuciones,
    },
    plazoRef,
    referencias: { antiguedad: refAntiguedad, max_carga: maxCarga, carga, oficinas: refOficinas },
    iua,
    derivados,
    diasCierre,
  }
}

module.exports = { calcularModelos, normalizarTexto, claveDestino, claveUbicacion, diasSuspendidos, ACTIVOS }
