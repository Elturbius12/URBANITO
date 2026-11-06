// Calendario de días hábiles: lunes a viernes, sin feriados.
// Convención (la misma de numpy.busday_count): diasHabiles(a, b) cuenta los
// días hábiles del intervalo [a, b). El día de ingreso cuenta como día 1.

const MS_DIA = 86400000
const INICIO = Date.UTC(2000, 0, 1) / MS_DIA
const FIN = Date.UTC(2045, 11, 31) / MS_DIA

function aNumero(fecha) {
  if (!fecha || typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null
  const [a, m, d] = fecha.split('-').map(Number)
  const t = Date.UTC(a, m - 1, d)
  const f = new Date(t)
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null
  return t / MS_DIA
}

function aFecha(numero) {
  return new Date(numero * MS_DIA).toISOString().slice(0, 10)
}

// 1970-01-01 fue jueves. Lunes = 0 ... domingo = 6
function diaSemana(numero) {
  return ((numero % 7) + 7 + 3) % 7
}

class Calendario {
  constructor(feriados = []) {
    this.feriados = new Set(feriados)
    const total = FIN - INICIO + 2
    this.acumulado = new Int32Array(total)
    let suma = 0
    for (let i = 0; i < total - 1; i++) {
      this.acumulado[i] = suma
      const n = INICIO + i
      if (diaSemana(n) < 5 && !this.feriados.has(aFecha(n))) suma++
    }
    this.acumulado[total - 1] = suma
  }

  indice(fecha) {
    const n = aNumero(fecha)
    if (n === null || n < INICIO || n > FIN) return null
    return n - INICIO
  }

  esHabil(fecha) {
    const n = aNumero(fecha)
    return n !== null && diaSemana(n) < 5 && !this.feriados.has(fecha)
  }

  // Días hábiles en [a, b). Si b < a devuelve un número negativo.
  diasHabiles(a, b) {
    const ia = this.indice(a)
    const ib = this.indice(b)
    if (ia === null || ib === null) return null
    return this.acumulado[ib] - this.acumulado[ia]
  }

  // Último día calendario que todavía está dentro de un plazo de `plazo` días
  // hábiles contados desde `inicio` (con la misma convención). Plazo 0 = el
  // mismo día de inicio.
  fechaLimite(inicio, plazo) {
    const ia = this.indice(inicio)
    if (ia === null || plazo === null || plazo === undefined) return null
    const objetivo = this.acumulado[ia] + plazo
    // búsqueda binaria del último índice con acumulado <= objetivo
    let lo = ia, hi = this.acumulado.length - 1
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (this.acumulado[mid] <= objetivo) lo = mid
      else hi = mid - 1
    }
    // lo es el último índice cuyo acumulado (= días hábiles en [inicio, lo)) <= objetivo
    return aFecha(INICIO + lo)
  }
}

function hoyLocal() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

module.exports = { Calendario, aNumero, aFecha, diaSemana, hoyLocal }
