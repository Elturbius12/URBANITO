// Genera pruebas/datos/consolidado_muestra.xlsx: un trozo del consolidado real
// (mismas hojas y encabezados que CONSOLIDADO_LIMPIO_V5.xlsx) para probar la
// autodetección del formato antiguo.
//   node pruebas/generar_muestra_consolidado.js <CONSOLIDADO_LIMPIO_V5.xlsx> [expedientes_por_hoja]
// Toma todas las filas de los primeros N expedientes de cada hoja, más el
// expediente con el movimiento más reciente (para que la fecha de corte sea la
// misma de la base inicial).
const path = require('path')
const ExcelJS = require('exceljs')

async function main() {
  const [origen, nTxt = '150'] = process.argv.slice(2)
  const N = Number(nTxt)
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.readFile(origen)
  const salida = new ExcelJS.Workbook()
  for (const nombre of ['SGCUC', 'SGAU']) {
    const ws = libro.getWorksheet(nombre)
    const enc = ws.getRow(1).values.slice(1)
    const colNum = enc.indexOf(nombre === 'SGCUC' ? 'EXPEDIENTE RUT' : 'EXPEDIENTE')
    const colFecha = enc.indexOf('FECHA MOV')
    const filas = []
    let ultimo = null, fechaMax = ''
    ws.eachRow((row, r) => {
      if (r === 1) return
      const v = row.values.slice(1)
      filas.push(v)
      const f = v[colFecha] instanceof Date ? v[colFecha].toISOString().slice(0, 10) : ''
      if (f && f <= '2026-11-05' && f > fechaMax && v[colNum]) { fechaMax = f; ultimo = v[colNum] }
    })
    const elegidos = new Set()
    for (const v of filas) {
      if (v[colNum] && elegidos.size < N) elegidos.add(v[colNum])
    }
    if (ultimo) elegidos.add(ultimo)
    const h = salida.addWorksheet(nombre)
    h.addRow(enc)
    for (const v of filas) if (elegidos.has(v[colNum])) h.addRow(v)
    console.log(`${nombre}: ${elegidos.size} expedientes, último movimiento ${fechaMax} (${ultimo})`)
  }
  const destino = path.join(__dirname, 'datos', 'consolidado_muestra.xlsx')
  require('fs').mkdirSync(path.dirname(destino), { recursive: true })
  await salida.xlsx.writeFile(destino)
  console.log('Muestra guardada en', destino)
}

main().catch(e => { console.error(e); process.exit(1) })
