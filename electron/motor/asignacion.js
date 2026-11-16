// ===========================================================================
// MODELO 3 — ASIGNACIÓN ÓPTIMA DE EXPEDIENTES A TRABAJADORES (MILP)
// ---------------------------------------------------------------------------
// Variables:  x_ij ∈ {0,1} = 1 si el expediente i se asigna al trabajador j
// Objetivo:   max Z = Σ_i Σ_j w_i · e_ij · x_ij
//               w_i  = IUA del expediente i (Modelo 1, ya calculado)
//               e_ij = eficiencia histórica del trabajador j en el trámite de i
// Restricciones:
//   (1) Σ_j x_ij = 1                ∀i   cada expediente a exactamente un trabajador
//   (2) Σ_i x_ij ≤ C_j              ∀j   capacidad máxima (descontando lo que ya tiene)
//   (3) x_ij = 0 si j no pertenece al departamento del expediente i
//       (se implementa no creando la variable: solo existen los pares compatibles)
//   (4) |Σ_i x_ij − promedio| ≤ δ   ∀j   equidad (dos desigualdades lineales)
//
// Cuando la capacidad total es menor que el número de expedientes, (1) es
// infactible por construcción; entonces se resuelve la versión relajada
// Σ_j x_ij ≤ 1 (cada expediente a lo sumo a un trabajador) y el objetivo
// elige los más urgentes. La equidad se ajusta a lo que cada trabajador puede
// recibir (min(capacidad, expedientes compatibles)). Si aun así no hay
// solución, se elimina la restricción de equidad. Cada relajación se informa.
//
// Score de eficiencia (por trabajador j y tipo de trámite t):
//   e_jt = 0.40·tasa_a_tiempo + 0.35·velocidad_relativa + 0.25·experiencia
//   tasa_a_tiempo   = finalizados dentro del plazo de referencia / finalizados
//   velocidad       = 1 − r/2, con r = tiempo_promedio_jt / tiempo_promedio_global_t
//                     (reescala lineal de 1 − r ∈ [−1, 1] a [0, 1]; 0.5 = promedio)
//   experiencia     = min(1, atendidos_jt / umbral)
// Sin historial en un componente se usa el valor neutro 0.5 (tasa y
// velocidad) y 0 (experiencia): un trabajador nuevo no es ni mejor ni peor.
//
// Solver: GLPK (glpk.js, compilado a WebAssembly). Si no carga o falla, se
// usa la HEURÍSTICA VORAZ: expedientes por w_i descendente, cada uno al
// trabajador compatible de mayor e_ij con capacidad disponible. Siempre se
// calcula también la voraz para comparar ambas soluciones.
// ===========================================================================

const PESOS_EFICIENCIA = { tasa: 0.40, velocidad: 0.35, experiencia: 0.25 }
const NEUTRO = 0.5

const limitar = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))

function scoreEficiencia({ tasa, velocidad, experiencia }) {
  return PESOS_EFICIENCIA.tasa * tasa + PESOS_EFICIENCIA.velocidad * velocidad + PESOS_EFICIENCIA.experiencia * experiencia
}

/**
 * Eficiencia histórica por (trabajador, trámite).
 * @param {Array} registros  [{ usuario_id, procedimiento_codigo, expediente_id, dias_paso,
 *                              finalizo: bool, a_tiempo: bool|null }]
 *   Un registro por cada paso (permanencia) de un expediente cerrado en manos del trabajador.
 *   finalizo = el trabajador fue el último responsable antes del cierre.
 * @param {number} umbral  casos para considerar experiencia plena
 * @returns Map<'usuario|proc', fila>
 */
function calcularEficiencia(registros, umbral = 30) {
  const global = new Map()            // proc -> { suma, n }
  const grupos = new Map()            // 'u|proc' -> acumulado
  for (const r of registros) {
    if (r.dias_paso !== null && r.dias_paso !== undefined && r.dias_paso >= 0) {
      const g = global.get(r.procedimiento_codigo) || { suma: 0, n: 0 }
      g.suma += r.dias_paso; g.n++
      global.set(r.procedimiento_codigo, g)
    }
    const k = `${r.usuario_id}|${r.procedimiento_codigo}`
    let a = grupos.get(k)
    if (!a) {
      a = { usuario_id: r.usuario_id, procedimiento_codigo: r.procedimiento_codigo, expedientes: new Set(),
            suma: 0, n: 0, finalizados: 0, a_tiempo: 0 }
      grupos.set(k, a)
    }
    a.expedientes.add(r.expediente_id)
    if (r.dias_paso !== null && r.dias_paso !== undefined && r.dias_paso >= 0) { a.suma += r.dias_paso; a.n++ }
    if (r.finalizo && r.a_tiempo !== null && r.a_tiempo !== undefined) {
      a.finalizados++
      if (r.a_tiempo) a.a_tiempo++
    }
  }
  const salida = new Map()
  for (const [k, a] of grupos) {
    const g = global.get(a.procedimiento_codigo)
    const tProm = a.n ? a.suma / a.n : null
    const tGlobal = g && g.n ? g.suma / g.n : null
    const tasa = a.finalizados ? a.a_tiempo / a.finalizados : NEUTRO
    let velocidad = NEUTRO
    if (tProm !== null && tGlobal) velocidad = limitar(1 - (tProm / tGlobal) / 2)
    else if (tProm !== null && tGlobal === 0) velocidad = tProm === 0 ? NEUTRO : 0
    const atendidos = a.expedientes.size
    const experiencia = limitar(atendidos / Math.max(1, umbral))
    salida.set(k, {
      usuario_id: a.usuario_id, procedimiento_codigo: a.procedimiento_codigo,
      total_atendidos: atendidos, finalizados: a.finalizados, finalizados_a_tiempo: a.a_tiempo,
      tiempo_promedio_dias: tProm, tiempo_promedio_global: tGlobal,
      tasa_finalizacion: tasa, velocidad_relativa: velocidad, experiencia,
      score_eij: scoreEficiencia({ tasa, velocidad, experiencia }),
    })
  }
  return salida
}

// e_ij de un trabajador sin historial en ese trámite
const EIJ_SIN_HISTORIAL = scoreEficiencia({ tasa: NEUTRO, velocidad: NEUTRO, experiencia: 0 })

// ---------------------------------------------------------------- heurística voraz
/**
 * @param {object} p  { expedientes: [{ id, w, candidatos: [{ j, e }] }], trabajadores: [{ j, capacidad }] }
 */
function resolverVoraz(p) {
  const inicio = Date.now()
  const libre = new Map(p.trabajadores.map(t => [t.j, t.capacidad]))
  const asignacion = new Map()
  const orden = [...p.expedientes].sort((a, b) => b.w - a.w || a.id - b.id)
  for (const x of orden) {
    const cands = [...x.candidatos].sort((a, b) => b.e - a.e || (libre.get(b.j) - libre.get(a.j)) || a.j - b.j)
    const elegido = cands.find(c => (libre.get(c.j) || 0) > 0)
    if (!elegido) continue
    asignacion.set(x.id, elegido.j)
    libre.set(elegido.j, libre.get(elegido.j) - 1)
  }
  return { metodo: 'VORAZ', estado: 'HEURISTICA', asignacion, z: valorObjetivo(p, asignacion),
           relajaciones: [], duracion_ms: Date.now() - inicio }
}

function valorObjetivo(p, asignacion) {
  const porId = new Map(p.expedientes.map(x => [x.id, x]))
  let z = 0
  for (const [i, j] of asignacion) {
    const x = porId.get(i)
    const c = x && x.candidatos.find(k => k.j === j)
    if (c) z += x.w * c.e
  }
  return z
}

// ---------------------------------------------------------------- GLPK
let glpkPromesa = null

// Carga glpk.js una sola vez. Emscripten registra manejadores globales de
// process ('uncaughtException' / 'unhandledRejection') que relanzan el error y
// tumbarían el programa: se retiran después de cargar.
function cargarGlpk() {
  if (glpkPromesa) return glpkPromesa
  glpkPromesa = (async () => {
    const antes = {
      uncaughtException: process.listeners('uncaughtException'),
      unhandledRejection: process.listeners('unhandledRejection'),
    }
    try {
      const fabrica = require('glpk.js')
      const glpk = await (typeof fabrica === 'function' ? fabrica() : fabrica)
      return glpk
    } finally {
      for (const ev of Object.keys(antes)) {
        for (const l of process.listeners(ev)) if (!antes[ev].includes(l)) process.removeListener(ev, l)
      }
    }
  })()
  glpkPromesa.catch(() => { glpkPromesa = null })
  return glpkPromesa
}

// Arma el modelo en el formato de glpk.js
function modeloGlpk(glpk, p, { exacta, equidad }) {
  const nombre = (i, j) => `x_${i}_${j}`
  const vars = []
  const porTrabajador = new Map(p.trabajadores.map(t => [t.j, []]))
  const subjectTo = []
  for (const x of p.expedientes) {
    const fila = []
    for (const c of x.candidatos) {
      if (!porTrabajador.has(c.j)) continue
      const n = nombre(x.id, c.j)
      vars.push({ name: n, coef: x.w * c.e })
      fila.push({ name: n, coef: 1 })
      porTrabajador.get(c.j).push(n)
    }
    if (!fila.length) continue
    subjectTo.push({ name: `uno_${x.id}`, vars: fila,
                     bnds: exacta ? { type: glpk.GLP_FX, lb: 1, ub: 1 } : { type: glpk.GLP_UP, lb: 0, ub: 1 } })
  }
  for (const t of p.trabajadores) {
    const lista = porTrabajador.get(t.j)
    if (!lista.length) continue
    let lb = 0, ub = t.capacidad
    if (equidad) {
      lb = Math.max(0, Math.min(equidad.lb, t.alcanzable))
      ub = Math.min(ub, equidad.ub)
    }
    const fila = lista.map(n => ({ name: n, coef: 1 }))
    // GLPK exige lb < ub en una cota doble: si coinciden, la fila es fija (GLP_FX)
    const bnds = lb <= 0 ? { type: glpk.GLP_UP, lb: 0, ub }
      : lb >= ub ? { type: glpk.GLP_FX, lb, ub: lb }
        : { type: glpk.GLP_DB, lb, ub }
    subjectTo.push({ name: `cap_${t.j}`, vars: fila, bnds })
  }
  return {
    name: 'asignacion_urbanito',
    objective: { direction: glpk.GLP_MAX, name: 'Z', vars },
    subjectTo,
    binaries: vars.map(v => v.name),
  }
}

/**
 * Resuelve el MILP con GLPK. Devuelve null si GLPK no está disponible.
 * @param p      { expedientes, trabajadores: [{ j, capacidad }], delta }
 */
async function resolverMilp(p, { tiempoLimiteS = 30 } = {}) {
  let glpk
  try { glpk = await cargarGlpk() } catch (err) { return { error: `GLPK no disponible: ${err.message}` } }
  const inicio = Date.now()
  const n = p.expedientes.filter(x => x.candidatos.length).length
  const capacidadTotal = p.trabajadores.reduce((s, t) => s + t.capacidad, 0)
  // cuánto puede recibir cada trabajador: min(capacidad, su parte de los expedientes
  // compatibles). Si k trabajadores compiten por los mismos expedientes, a cada
  // uno se le exige a lo sumo ⌊compatibles / k⌋ en la cota inferior de equidad.
  const compatibles = new Map(p.trabajadores.map(t => [t.j, 0]))
  const competidores = new Map(p.trabajadores.map(t => [t.j, 1]))
  for (const x of p.expedientes) {
    const js = x.candidatos.filter(c => compatibles.has(c.j))
    for (const c of js) {
      compatibles.set(c.j, compatibles.get(c.j) + 1)
      competidores.set(c.j, Math.max(competidores.get(c.j), js.length))
    }
  }
  const trabajadores = p.trabajadores.map(t => ({
    ...t, alcanzable: Math.min(t.capacidad, Math.floor(compatibles.get(t.j) / competidores.get(t.j))),
  }))
  const totalAsignable = Math.min(n, capacidadTotal)
  const conTrabajo = trabajadores.filter(t => t.alcanzable > 0).length || 1
  const promedio = totalAsignable / conTrabajo
  const delta = Math.max(0, Number(p.delta ?? 2))
  const equidad = { promedio, delta, lb: Math.ceil(promedio - delta), ub: Math.floor(promedio + delta) }

  const intentos = []
  if (n <= capacidadTotal) intentos.push({ exacta: true, equidad, relajaciones: [] })
  intentos.push({ exacta: false, equidad, relajaciones: n > capacidadTotal
    ? [`Capacidad total (${capacidadTotal}) menor que los expedientes (${n}): se usa Σⱼ xᵢⱼ ≤ 1 y se asignan los de mayor w·e.`]
    : ['La restricción (1) Σⱼ xᵢⱼ = 1 no tuvo solución con la equidad pedida: se usa Σⱼ xᵢⱼ ≤ 1.'] })
  intentos.push({ exacta: false, equidad: null, relajaciones: ['Sin solución con la restricción de equidad: se resolvió sin ella (4).'] })

  const ultimo = { metodo: 'MILP', estado: 'INFACTIBLE', asignacion: new Map(), z: 0, relajaciones: [], equidad }
  for (const intento of intentos) {
    const lp = modeloGlpk(glpk, { ...p, trabajadores }, intento)
    if (!lp.objective.vars.length) break
    const r = await glpk.solve(lp, { msglev: glpk.GLP_MSG_OFF, presol: true, tmlim: tiempoLimiteS })
    const st = r.result.status
    if (st === glpk.GLP_OPT || st === glpk.GLP_FEAS) {
      const asignacion = new Map()
      for (const [nombre, v] of Object.entries(r.result.vars)) {
        if (v > 0.5) {
          const [, i, j] = nombre.split('_')
          asignacion.set(Number(i), Number(j))
        }
      }
      return {
        metodo: 'MILP', estado: st === glpk.GLP_OPT ? 'OPTIMO' : 'FACTIBLE', asignacion,
        z: valorObjetivo(p, asignacion), z_solver: r.result.z,
        relajaciones: intento === intentos[0] && intento.exacta ? [] : intento.relajaciones,
        restriccion_uno: intento.exacta ? 'Σⱼ xᵢⱼ = 1' : 'Σⱼ xᵢⱼ ≤ 1',
        equidad: intento.equidad ? { promedio, delta, minimo: equidad.lb, maximo: equidad.ub } : null,
        variables: lp.binaries.length, restricciones: lp.subjectTo.length,
        duracion_ms: Date.now() - inicio,
      }
    }
  }
  ultimo.duracion_ms = Date.now() - inicio
  return ultimo
}

module.exports = {
  calcularEficiencia, scoreEficiencia, resolverVoraz, resolverMilp, valorObjetivo, cargarGlpk,
  PESOS_EFICIENCIA, EIJ_SIN_HISTORIAL, NEUTRO,
}
