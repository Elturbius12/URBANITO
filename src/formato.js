// Formatos para mostrar datos en pantalla (es-PE).

export function numero(v, dec = 0) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  return Number(v).toLocaleString('es-PE', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

export function porcentaje(v, dec = 1) {
  if (v === null || v === undefined) return '—'
  return `${(Number(v) * 100).toFixed(dec)}%`
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

export function fecha(v) {
  if (!v) return '—'
  const s = String(v).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—'
  const [a, m, d] = s.split('-')
  return `${d}/${m}/${a}`
}

export function fechaLarga(v) {
  if (!v) return '—'
  const [a, m, d] = String(v).slice(0, 10).split('-').map(Number)
  const dia = new Date(Date.UTC(a, m - 1, d)).getUTCDay()
  return `${DIAS[dia]}, ${d} de ${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][m - 1]} de ${a}`
}

export function capitalizar(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

export function mes(v) {
  const [a, m] = String(v).split('-')
  return `${MESES[Number(m) - 1]} ${a.slice(2)}`
}

export function fechaHora(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function dias(v, sufijo = 'd.h.') {
  if (v === null || v === undefined) return '—'
  return `${numero(v, Number.isInteger(Number(v)) ? 0 : 1)} ${sufijo}`
}

export function restantes(v) {
  if (v === null || v === undefined) return 'Sin plazo TUPA'
  if (v < 0) return `Vencido hace ${Math.abs(v)} d.h.`
  if (v === 0) return 'Vence hoy'
  return `Quedan ${v} d.h.`
}

export function escaparHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
