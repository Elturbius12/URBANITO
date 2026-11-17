// Ayudantes para exportar a Excel y PDF desde cualquier pantalla.
import { escaparHtml as h, fecha, fechaHora } from './formato'
import { obtenerToken } from './api'
import { descargarBlob } from './archivos'

export async function exportarExcel(notificar, archivo, hojas) {
  const nombre = `${archivo || 'reporte'}.xlsx`
  let r
  try {
    const t = obtenerToken()
    const res = await fetch('/urbanito/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: JSON.stringify({ archivo, hojas }),
    })
    if (!res.ok) {
      let error = `El servidor respondió con un error (${res.status}).`
      try { error = (await res.json()).error || error } catch (_) { /* sin cuerpo */ }
      r = { ok: false, error }
    } else {
      descargarBlob(nombre, await res.blob())
      r = { ok: true, ruta: nombre }
    }
  } catch (_) {
    r = { ok: false, error: 'No se pudo conectar con el servidor URBANITO.' }
  }
  if (r.ok) notificar(`Archivo descargado: ${r.ruta}`, 'exito')
  else notificar(r.error || 'No se pudo guardar', 'error')
  return r
}

// Abre el documento en una ventana nueva y lanza el diálogo de impresión del
// navegador (desde ahí también se puede «Guardar como PDF»).
function abrirEImprimir(html, horizontal = false) {
  const w = window.open('', '_blank')
  if (!w) return { ok: false, motivo: 'El navegador bloqueó la ventana emergente. Permita ventanas emergentes para este sitio.' }
  const pagina = horizontal ? html.replace('</style>', '@page { size: A4 landscape; }</style>') : html.replace('</style>', '@page { size: A4; }</style>')
  w.document.open()
  w.document.write(pagina)
  w.document.close()
  const lanzar = () => { w.focus(); w.print() }
  if (w.document.readyState === 'complete') setTimeout(lanzar, 50)
  else w.addEventListener('load', lanzar)
  return { ok: true }
}

export async function exportarPdf(notificar, archivo, html, horizontal = false) {
  const conTitulo = html.replace('<head>', `<head><title>${h(archivo || 'documento')}</title>`)
  const r = abrirEImprimir(conTitulo, horizontal)
  if (!r.ok) notificar(r.motivo, 'error')
  return r
}

export async function imprimir(notificar, html) {
  const r = abrirEImprimir(html)
  if (!r.ok) notificar(`No se pudo imprimir: ${r.motivo}`, 'error')
  return r
}

// Columnas estándar de una lista de expedientes priorizados
export const COLUMNAS_PRIORIZADOS = [
  { titulo: 'Prioridad', clave: 'prioridad', formato: 'numero', ancho: 10 },
  { titulo: 'Expediente', clave: 'numero', ancho: 16 },
  { titulo: 'Sistema', clave: 'sistema', ancho: 10 },
  { titulo: 'Solicitante', clave: 'solicitante', ancho: 34 },
  { titulo: 'Trámite', clave: 'procedimiento', ancho: 36 },
  { titulo: 'Departamento', clave: 'departamento', ancho: 32 },
  { titulo: 'Estado', clave: 'estado_nombre', ancho: 18 },
  { titulo: 'Ubicación actual', clave: 'ubicacion', ancho: 28 },
  { titulo: 'Fecha de ingreso', clave: 'fecha_ingreso', formato: 'fecha', ancho: 14 },
  { titulo: 'Días hábiles transcurridos', clave: 'dias', formato: 'numero', ancho: 14 },
  { titulo: 'Plazo TUPA (d.h.)', clave: 'plazo_tupa', formato: 'numero', ancho: 12 },
  { titulo: 'Fecha límite', clave: 'fecha_limite', formato: 'fecha', ancho: 14 },
  { titulo: 'Días restantes', clave: 'dias_restantes', formato: 'numero', ancho: 12 },
  { titulo: 'Días sin movimiento', clave: 'dias_sin_movimiento', formato: 'numero', ancho: 12 },
  { titulo: 'IUA', clave: 'iua', formato: 'decimal', ancho: 9 },
  { titulo: 'Nivel', clave: 'nivel', ancho: 10 },
  { titulo: 'Acción sugerida', clave: 'accion', ancho: 30 },
]

const ESTILO = `
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1f2937; font-size: 11px; margin: 0; }
  .encabezado { display: flex; justify-content: space-between; border-bottom: 3px solid #1a3c6e; padding-bottom: 8px; margin-bottom: 12px; }
  .encabezado h1 { font-size: 18px; color: #1a3c6e; margin: 0; }
  .encabezado .sub { font-size: 11px; color: #555; }
  h2 { font-size: 13px; color: #1a3c6e; margin: 14px 0 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th { background: #1a3c6e; color: #fff; text-align: left; padding: 4px 6px; font-size: 9.5px; }
  td { border-bottom: 1px solid #ddd; padding: 4px 6px; vertical-align: top; }
  td.num, th.num { text-align: right; }
  .n-CRÍTICO { color: #dc2626; font-weight: bold; } .n-ALTO { color: #ea580c; font-weight: bold; }
  .n-MEDIO { color: #ca8a04; font-weight: bold; } .n-BAJO { color: #16a34a; font-weight: bold; }
  .caja { border: 1px solid #ccc; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 18px; }
  .et { color: #666; font-size: 9.5px; text-transform: uppercase; }
  .pie { margin-top: 16px; font-size: 9px; color: #777; border-top: 1px solid #ccc; padding-top: 6px; }
  .firma { margin-top: 50px; display: flex; justify-content: space-around; }
  .firma div { border-top: 1px solid #333; width: 40%; text-align: center; padding-top: 4px; }
`

export function documentoHtml({ titulo, subtitulo, institucion, cuerpo, usuario }) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>${ESTILO}</style></head><body>
    <div class="encabezado">
      <div><h1>${h(titulo)}</h1><div class="sub">${h(subtitulo || '')}</div></div>
      <div class="sub" style="text-align:right">${h(institucion?.nombre || '')}<br>${h(institucion?.area || '')}<br>URBANITO</div>
    </div>
    ${cuerpo}
    <div class="pie">Generado por URBANITO el ${h(fechaHora(new Date().toISOString()))}${usuario ? ` por ${h(usuario.nombre_completo)}` : ''}.</div>
  </body></html>`
}

export function tablaHtml(columnas, filas) {
  const cel = (c, f) => {
    const v = f[c.clave]
    let t = v
    if (v === null || v === undefined || v === '') t = '—'
    else if (c.formato === 'fecha') t = fecha(v)
    else if (c.formato === 'decimal') t = Number(v).toFixed(3)
    else if (c.formato === 'porcentaje') t = `${(Number(v) * 100).toFixed(1)}%`
    else if (c.formato === 'decimal1') t = Number(v).toFixed(1)
    const num = ['numero', 'decimal', 'porcentaje', 'decimal1'].includes(c.formato)
    const cls = c.clave === 'nivel' ? `n-${v}` : (num ? 'num' : '')
    return `<td class="${cls}">${h(t)}</td>`
  }
  return `<table><thead><tr>${columnas.map(c => `<th class="${['numero', 'decimal', 'porcentaje', 'decimal1'].includes(c.formato) ? 'num' : ''}">${h(c.titulo)}</th>`).join('')}</tr></thead>
    <tbody>${filas.map(f => `<tr>${columnas.map(c => cel(c, f)).join('')}</tr>`).join('')}</tbody></table>`
}
