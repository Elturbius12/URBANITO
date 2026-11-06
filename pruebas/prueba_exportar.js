// Verifica la generación de Excel y PDF (se ejecuta con Electron como proceso principal).
//   xvfb-run -a node_modules/.bin/electron pruebas/prueba_exportar.js
const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const ExcelJS = require('exceljs')
const { generarExcel, generarPdf } = require('../electron/exportar')

app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'urbanito-exp-'))
  let fallas = 0
  const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fallas++ }
  try {
    const xlsx = path.join(dir, 'prueba.xlsx')
    await generarExcel({ hojas: [{
      nombre: 'Bandeja', titulo: 'Bandeja priorizada', subtitulo: 'prueba',
      columnas: [{ titulo: 'Expediente', clave: 'numero' }, { titulo: 'Ingreso', clave: 'fecha_ingreso', formato: 'fecha' },
                 { titulo: 'IUA', clave: 'iua', formato: 'decimal' }, { titulo: 'Cumple', clave: 'tasa', formato: 'porcentaje' }],
      filas: [{ numero: '000001-2026', fecha_ingreso: '2026-11-05', iua: 0.7123, tasa: 0.19 },
              { numero: 'Ñandú áéíóú', fecha_ingreso: null, iua: null, tasa: 1 }],
    }] }, xlsx)
    const libro = new ExcelJS.Workbook()
    await libro.xlsx.readFile(xlsx)
    const h = libro.getWorksheet('Bandeja')
    ok(!!h, 'el Excel se abre y tiene la hoja')
    ok(h.getCell('A5').value === '000001-2026', 'los datos están en su celda')
    ok(h.getCell('B5').value instanceof Date && h.getCell('B5').numFmt === 'dd/mm/yyyy', 'las fechas se guardan como fecha con formato dd/mm/aaaa')
    ok(h.getCell('C5').value === 0.7123 && h.getCell('D5').numFmt === '0.0%', 'los números conservan su valor y formato')
    ok(h.getCell('A6').value === 'Ñandú áéíóú', 'tildes y ñ se conservan')

    const pdf = path.join(dir, 'prueba.pdf')
    await generarPdf('<!doctype html><html><body><h1>Constancia de recepción</h1><p>Expediente 000001-2026 — Ñandú</p></body></html>', pdf)
    const b = fs.readFileSync(pdf)
    ok(b.slice(0, 5).toString() === '%PDF-' && b.length > 3000, `el PDF se genera (${b.length} bytes)`)
  } catch (e) {
    console.error(e); fallas++
  }
  fs.rmSync(dir, { recursive: true, force: true })
  console.log(fallas ? `\n${fallas} fallas` : '\nExportación correcta')
  app.exit(fallas ? 1 : 0)
})
