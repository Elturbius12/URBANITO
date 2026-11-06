// Proceso Analítico Jerárquico (Saaty): pesos por el vector propio principal
// y verificación de consistencia.

const INDICE_ALEATORIO = { 1: 0, 2: 0, 3: 0.58, 4: 0.90, 5: 1.12, 6: 1.24, 7: 1.32, 8: 1.41, 9: 1.45 }
const ESCALA_SAATY = [1 / 9, 1 / 8, 1 / 7, 1 / 6, 1 / 5, 1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4, 5, 6, 7, 8, 9]

function validarMatriz(A) {
  const errores = []
  const n = A.length
  if (n < 2 || n > 9) errores.push('La matriz debe tener entre 2 y 9 factores.')
  for (let i = 0; i < n; i++) {
    if (!Array.isArray(A[i]) || A[i].length !== n) {
      errores.push('La matriz debe ser cuadrada.')
      return errores
    }
    for (let j = 0; j < n; j++) {
      const v = Number(A[i][j])
      if (!(v > 0) || !Number.isFinite(v)) errores.push(`Valor inválido en la fila ${i + 1}, columna ${j + 1}.`)
      if (i === j && Math.abs(v - 1) > 1e-9) errores.push('La diagonal debe ser 1.')
      if (Math.abs(v * Number(A[j][i]) - 1) > 1e-6) {
        errores.push(`La matriz no es recíproca en (${i + 1},${j + 1}).`)
      }
      if (!ESCALA_SAATY.some(s => Math.abs(s - v) < 1e-6)) {
        errores.push(`El valor ${v} en (${i + 1},${j + 1}) no pertenece a la escala de Saaty (1/9 … 9).`)
      }
    }
  }
  return [...new Set(errores)]
}

function calcularAhp(A) {
  const n = A.length
  let w = new Array(n).fill(1 / n)
  for (let iter = 0; iter < 10000; iter++) {
    const nw = A.map(fila => fila.reduce((s, v, j) => s + v * w[j], 0))
    const suma = nw.reduce((s, v) => s + v, 0)
    const norm = nw.map(v => v / suma)
    const dif = norm.reduce((s, v, i) => Math.max(s, Math.abs(v - w[i])), 0)
    w = norm
    if (dif < 1e-15) break
  }
  const Aw = A.map(fila => fila.reduce((s, v, j) => s + v * w[j], 0))
  const lambdaMax = Aw.reduce((s, v, i) => s + v / w[i], 0) / n
  const ic = n > 1 ? (lambdaMax - n) / (n - 1) : 0
  const ia = INDICE_ALEATORIO[n] || 0
  const rc = ia ? ic / ia : 0
  return { pesos: w, lambda_max: lambdaMax, ic, ia, rc, consistente: rc < 0.10 }
}

module.exports = { calcularAhp, validarMatriz, ESCALA_SAATY }
