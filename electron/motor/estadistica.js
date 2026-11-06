// Estadística descriptiva del Modelo 2 (MTA).
// Los percentiles usan interpolación lineal (el mismo método por defecto de
// numpy/pandas), para que los resultados coincidan con el análisis original.

function cuantil(ordenados, q) {
  const n = ordenados.length
  if (!n) return null
  const pos = (n - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return ordenados[lo] + (ordenados[hi] - ordenados[lo]) * (pos - lo)
}

function medidas(valores, plazo = null) {
  const d = valores.filter(v => v !== null && v !== undefined && !Number.isNaN(v))
                   .map(Number).sort((a, b) => a - b)
  const n = d.length
  if (!n) return null
  let suma = 0
  for (const v of d) suma += v
  const media = suma / n
  let sc = 0
  for (const v of d) sc += (v - media) ** 2
  const desviacion = n > 1 ? Math.sqrt(sc / (n - 1)) : 0
  const m = {
    n,
    media,
    mediana: cuantil(d, 0.5),
    desviacion,
    p80: cuantil(d, 0.8),
    p95: cuantil(d, 0.95),
    minimo: d[0],
    maximo: d[n - 1],
    coef_variacion: media > 0 ? desviacion / media : null,
  }
  if (plazo !== null && plazo !== undefined) {
    let dentro = 0
    for (const v of d) if (v <= plazo) dentro++
    m.plazo_tupa = plazo
    m.tasa_cumplimiento = dentro / n
    m.brecha_p80_tupa = m.p80 - plazo
  } else {
    m.plazo_tupa = null
    m.tasa_cumplimiento = null
    m.brecha_p80_tupa = null
  }
  return m
}

// Posición de un valor dentro de una distribución: % de casos históricos que
// tardaron menos o igual.
function percentilDe(ordenados, valor) {
  if (!ordenados || !ordenados.length || valor === null || valor === undefined) return null
  let lo = 0, hi = ordenados.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ordenados[mid] <= valor) lo = mid + 1
    else hi = mid
  }
  return lo / ordenados.length
}

function interpretar(cv) {
  if (cv === null || cv === undefined) return 'sin dato'
  if (cv < 0.3) return 'muy predecible'
  if (cv < 0.6) return 'predecible'
  if (cv < 1.0) return 'variable'
  return 'muy variable'
}

module.exports = { cuantil, medidas, percentilDe, interpretar }
