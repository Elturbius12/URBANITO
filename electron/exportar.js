// Generación de archivos de reporte en la PC del usuario: Excel y PDF.

const ExcelJS = require('exceljs')
const { BrowserWindow } = require('electron')

const AZUL = 'FF1F3A68'

function valorCelda(v, formato) {
  if (v === null || v === undefined || v === '') return null
  if (formato === 'fecha' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [a, m, d] = v.split('-').map(Number)
    return new Date(Date.UTC(a, m - 1, d))
  }
  return v
}

async function generarExcel(spec, ruta) {
  const libro = new ExcelJS.Workbook()
  libro.creator = 'URBANITO'
  libro.created = new Date()
  for (const hoja of spec.hojas) {
    const h = libro.addWorksheet(hoja.nombre.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))
    const ncol = hoja.columnas.length
    h.mergeCells(1, 1, 1, Math.max(1, ncol))
    h.getCell(1, 1).value = hoja.titulo || hoja.nombre
    h.getCell(1, 1).font = { bold: true, size: 14, color: { argb: AZUL } }
    h.mergeCells(2, 1, 2, Math.max(1, ncol))
    h.getCell(2, 1).value = hoja.subtitulo || ''
    h.getCell(2, 1).font = { italic: true, size: 10, color: { argb: 'FF555555' } }
    const enc = h.getRow(4)
    hoja.columnas.forEach((c, i) => {
      const cel = enc.getCell(i + 1)
      cel.value = c.titulo
      cel.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
      cel.alignment = { vertical: 'middle', wrapText: true }
      h.getColumn(i + 1).width = c.ancho || Math.min(45, Math.max(10, c.titulo.length + 2))
    })
    enc.height = 30
    hoja.filas.forEach((f, r) => {
      const fila = h.getRow(5 + r)
      hoja.columnas.forEach((c, i) => {
        const cel = fila.getCell(i + 1)
        cel.value = valorCelda(f[c.clave], c.formato)
        if (c.formato === 'porcentaje') cel.numFmt = '0.0%'
        else if (c.formato === 'decimal') cel.numFmt = '0.000'
        else if (c.formato === 'decimal1') cel.numFmt = '0.0'
        else if (c.formato === 'numero') cel.numFmt = '#,##0'
        else if (c.formato === 'fecha') cel.numFmt = 'dd/mm/yyyy'
      })
    })
    h.views = [{ state: 'frozen', ySplit: 4 }]
    if (hoja.filas.length) h.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + hoja.filas.length, column: ncol } }
  }
  await libro.xlsx.writeFile(ruta)
}

async function ventanaOculta(html) {
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } })
  await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  return w
}

async function generarPdf(html, ruta, { horizontal = false } = {}) {
  const w = await ventanaOculta(html)
  try {
    const datos = await w.webContents.printToPDF({
      pageSize: 'A4', landscape: horizontal, printBackground: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    })
    require('fs').writeFileSync(ruta, datos)
  } finally {
    w.destroy()
  }
}

async function imprimir(html) {
  const w = await ventanaOculta(html)
  return new Promise((resolve) => {
    w.webContents.print({ silent: false, printBackground: true }, (exito, motivo) => {
      w.destroy()
      resolve({ ok: exito, motivo: exito ? null : motivo })
    })
  })
}

module.exports = { generarExcel, generarPdf, imprimir }
