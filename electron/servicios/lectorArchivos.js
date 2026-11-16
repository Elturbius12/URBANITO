// Lectura de archivos de importación: Excel (.xlsx) y CSV.
// - Excel: con exceljs, SOLO valores (de una celda con fórmula se toma el
//   último resultado guardado; nunca se evalúa nada).
// - CSV: parser propio (comillas, separador ; o , detectado, UTF-8 con o sin BOM).
// Cada hoja/archivo se identifica por sus ENCABEZADOS, no por el nombre:
//   plantilla URBANITO (EXPEDIENTES / MOVIMIENTOS) o formato consolidado (SGCUC / SGAU).

const ExcelJS = require('exceljs')
const { normalizarOrigen } = require('../motor/clasificacion')

const LIMITE_BYTES = 50 * 1024 * 1024
const LIMITE_FILAS = 200000
const LIMITE_ARCHIVOS = 2

class ErrorArchivo extends Error {
  constructor(m) { super(m); this.esDeUsuario = true; this.codigo = 'VALIDACION' }
}

// ------------------------------------------------------------------ encabezados
// Clave interna -> encabezado de la plantilla (el asterisco marca obligatorio)
const COL_EXPEDIENTES = [
  ['numero', 'N° EXPEDIENTE*'], ['fecha_ingreso', 'FECHA INGRESO*'], ['solicitante', 'SOLICITANTE*'],
  ['documento', 'DNI / RUC / CE*'], ['telefono', 'TELÉFONO'], ['direccion', 'DIRECCIÓN / UBICACIÓN'],
  ['procedimiento', 'CÓDIGO PROCEDIMIENTO*'], ['asunto', 'ASUNTO'], ['folios', 'FOLIOS*'],
  ['recibo', 'N° RECIBO'], ['monto', 'MONTO S/.'], ['estado', 'ESTADO*'], ['fecha_cierre', 'FECHA CIERRE'],
  ['responsable', 'RESPONSABLE (usuario)'], ['observaciones', 'OBSERVACIONES'],
]
const COL_MOVIMIENTOS = [
  ['numero', 'N° EXPEDIENTE*'], ['n_mov', 'N° MOV*'], ['tipo', 'TIPO MOV*'], ['fecha', 'FECHA MOV*'],
  ['destino', 'DESTINO (unidad / departamento / usuario)'], ['documento', 'DOCUMENTO'],
  ['folios', 'FOLIOS MOV'], ['observacion', 'OBSERVACIÓN MOV'],
]
// Formato consolidado (CONSOLIDADO_LIMPIO_V5.xlsx)
const COL_SGCUC = {
  numero: 'EXPEDIENTE RUT', fecha_ingreso: 'FECHA INGRESO', folios: 'FOLIOS', solicitante: 'SOLICITANTE',
  asunto: 'ASUNTO', n_mov: 'N° MOV', tipo: 'TIPO MOV', fecha: 'FECHA MOV', responsable_mov: 'RESPONSABLE',
  folios_mov: 'FOLIOS MOV', documento: 'DOCUMENTO', destino: 'DERIVADO A', hoja_origen: 'HOJA ORIGEN',
}
const COL_SGAU = {
  numero: 'EXPEDIENTE', fecha_ingreso: 'FECHA INGRESO', folios: 'FOLIOS', solicitante: 'SOLICITANTE',
  tramite: 'TRÁMITE', tipo_tramite: 'TIPO DE TRÁMITE', direccion: 'UBICACIÓN', recibo: 'N° RECIBO',
  monto: 'MONTO S/.', observaciones: 'OBSERVACIONES', n_mov: 'N° MOV', tipo: 'TIPO MOV', fecha: 'FECHA MOV',
  destino: 'DESTINO/DEPENDENCIA', folios_mov: 'FOLIOS MOV', documento: 'DOCUMENTO', descripcion: 'DESCRIPCIÓN',
  observacion_mov: 'OBSERVACIÓN MOV', hoja_origen: 'HOJA ORIGEN',
}

// "DESTINO (unidad / departamento / usuario)" -> "DESTINO"; "N° EXPEDIENTE*" -> "N EXPEDIENTE"
const normEnc = (t) => normalizarOrigen(String(t || '').replace(/\(.*\)/, ''))

function mapaEncabezados(pares) {
  const m = new Map()
  for (const [clave, enc] of pares) m.set(normEnc(enc), clave)
  return m
}
const ENC = {
  EXPEDIENTES: mapaEncabezados(COL_EXPEDIENTES),
  MOVIMIENTOS: mapaEncabezados(COL_MOVIMIENTOS),
  SGCUC: mapaEncabezados(Object.entries(COL_SGCUC)),
  SGAU: mapaEncabezados(Object.entries(COL_SGAU)),
}

// Detecta el tipo de tabla por sus encabezados normalizados
function tipoTabla(encabezados) {
  const h = new Set(encabezados)
  if (h.has('EXPEDIENTE RUT') && h.has('ASUNTO') && h.has('DERIVADO A')) return 'SGCUC'
  if (h.has('EXPEDIENTE') && h.has('TRAMITE') && h.has('DESTINO DEPENDENCIA')) return 'SGAU'
  if (h.has('N EXPEDIENTE') && h.has('SOLICITANTE') && h.has('CODIGO PROCEDIMIENTO')) return 'EXPEDIENTES'
  if (h.has('N EXPEDIENTE') && h.has('N MOV') && h.has('TIPO MOV') && h.has('FECHA MOV')) return 'MOVIMIENTOS'
  return null
}

// ------------------------------------------------------------------ valores
function valorExcel(v) {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('')
    if ('result' in v || 'formula' in v || 'sharedFormula' in v) {   // fórmula: solo el resultado guardado
      const r = v.result
      return r === undefined || (r && typeof r === 'object' && r.error) ? null : valorExcel(r)
    }
    if (v.text !== undefined) return String(v.text)                  // hipervínculo
    if (v.error) return null
    return null
  }
  return v
}

// ------------------------------------------------------------------ CSV
function decodificarTexto(buf) {
  let t = buf.toString('utf8')
  if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1)
  if (t.includes('�')) t = buf.toString('latin1')      // no era UTF-8: Windows-1252/latin1
  return t
}

function parsearCsv(textoCsv) {
  // separador: el que más aparece en la primera línea fuera de comillas
  const primera = textoCsv.slice(0, textoCsv.search(/\r?\n|$/))
  const cuenta = (c) => primera.split('"').filter((_, i) => i % 2 === 0).join('').split(c).length
  const sep = cuenta(';') >= cuenta(',') ? ';' : ','
  const filas = []
  let fila = [], campo = '', comillas = false
  for (let i = 0; i < textoCsv.length; i++) {
    const c = textoCsv[i]
    if (comillas) {
      if (c === '"') {
        if (textoCsv[i + 1] === '"') { campo += '"'; i++ } else comillas = false
      } else campo += c
    } else if (c === '"' && campo === '') comillas = true
    else if (c === sep) { fila.push(campo); campo = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && textoCsv[i + 1] === '\n') i++
      fila.push(campo); filas.push(fila); fila = []; campo = ''
      if (filas.length > LIMITE_FILAS + 1) throw new ErrorArchivo(`El archivo tiene más de ${LIMITE_FILAS.toLocaleString('es-PE')} filas. Divídalo en partes más pequeñas.`)
    } else campo += c
  }
  if (comillas) throw new ErrorArchivo('El CSV tiene comillas sin cerrar. Revise el archivo.')
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila) }
  return filas
}

// ------------------------------------------------------------------ lectura
function tablaDesdeFilas(nombreHoja, filas, primeraFila = 1) {
  // encabezado: la primera fila (de las 10 primeras) donde se reconoce un tipo de tabla
  for (let i = 0; i < Math.min(10, filas.length); i++) {
    const enc = (filas[i] || []).map(normEnc)
    const tipo = tipoTabla(enc)
    if (!tipo) continue
    const mapa = ENC[tipo]
    const columnas = enc.map(e => mapa.get(e) || null)
    const encOriginal = (filas[i] || []).map(x => String(x || '').trim())
    const datos = []
    for (let k = i + 1; k < filas.length; k++) {
      const f = filas[k] || []
      if (!f.some(v => v !== null && v !== undefined && String(v).trim() !== '')) continue   // fila vacía
      const o = { __fila: primeraFila + k, __hoja: nombreHoja }
      columnas.forEach((c, j) => { if (c) o[c] = f[j] === undefined ? null : f[j] })
      datos.push(o)
    }
    const faltan = [...mapa.entries()].filter(([e]) => !enc.includes(e)).map(([, c]) => c)
    return { hoja: nombreHoja, tipo, filas: datos, encabezados: encOriginal, columnas_faltantes: faltan }
  }
  return null
}

async function leerXlsx(nombre, buf) {
  if (buf.slice(0, 4).toString('hex') !== '504b0304') {
    throw new ErrorArchivo(`"${nombre}" no es un libro de Excel válido (.xlsx). Si es un .xls antiguo, ábralo en Excel y guárdelo como .xlsx.`)
  }
  const libro = new ExcelJS.Workbook()
  try {
    // 'tableParts': exceljs falla con algunas «tablas» de Excel y no se necesitan para leer valores
    await libro.xlsx.load(buf, { ignoreNodes: ['dataValidations', 'conditionalFormatting', 'drawing', 'picture', 'tableParts'] })
  } catch (_) {
    throw new ErrorArchivo(`No se pudo leer "${nombre}". El archivo está dañado o no es un Excel válido.`)
  }
  const tablas = []
  let total = 0
  for (const ws of libro.worksheets) {
    const n = normalizarOrigen(ws.name)
    if (['INSTRUCCIONES', 'CATALOGOS', 'EJEMPLO', 'RESUMEN'].includes(n)) continue
    total += ws.rowCount
    if (total > LIMITE_FILAS + 50) {
      throw new ErrorArchivo(`El archivo tiene más de ${LIMITE_FILAS.toLocaleString('es-PE')} filas. Divídalo en partes más pequeñas.`)
    }
    const filas = []
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      const vals = row.values             // índice 1 = columna A
      const f = []
      for (let c = 1; c < vals.length; c++) f.push(valorExcel(vals[c]))
      filas[r - 1] = f
    })
    for (let i = 0; i < filas.length; i++) if (!filas[i]) filas[i] = []
    const t = tablaDesdeFilas(ws.name, filas)
    if (t) tablas.push(t)
  }
  return tablas
}

function leerCsv(nombre, buf) {
  const filas = parsearCsv(decodificarTexto(buf))
  const t = tablaDesdeFilas(nombre, filas)
  return t ? [t] : []
}

// archivos: [{ nombre, contenido: Buffer }]
async function leerArchivos(archivos) {
  if (!Array.isArray(archivos) || !archivos.length) throw new ErrorArchivo('Seleccione un archivo .xlsx o .csv.')
  if (archivos.length > LIMITE_ARCHIVOS) throw new ErrorArchivo('Seleccione un solo Excel, o hasta dos CSV (expedientes y movimientos).')
  const tablas = []
  for (const a of archivos) {
    const nombre = String(a.nombre || 'archivo').slice(0, 200)
    const ext = (nombre.match(/\.([a-z0-9]+)$/i) || [])[1]
    const buf = a.contenido
    if (!Buffer.isBuffer(buf) || !buf.length) throw new ErrorArchivo(`"${nombre}" está vacío.`)
    if (buf.length > LIMITE_BYTES) throw new ErrorArchivo(`"${nombre}" pesa más de ${LIMITE_BYTES / 1024 / 1024} MB. Divídalo en partes más pequeñas.`)
    if (!ext || !['xlsx', 'csv'].includes(ext.toLowerCase())) throw new ErrorArchivo(`"${nombre}": solo se aceptan archivos .xlsx o .csv.`)
    if (ext.toLowerCase() === 'xlsx') tablas.push(...await leerXlsx(nombre, buf))
    else {
      if (buf.slice(0, 4).toString('hex') === '504b0304') throw new ErrorArchivo(`"${nombre}" parece un Excel con extensión .csv. Cámbiele la extensión a .xlsx.`)
      tablas.push(...leerCsv(nombre, buf))
    }
  }
  if (!tablas.length) {
    throw new ErrorArchivo('No se reconocieron los encabezados. Use la plantilla de URBANITO sin cambiar los encabezados, o el formato del consolidado (hojas SGCUC / SGAU).')
  }
  const total = tablas.reduce((s, t) => s + t.filas.length, 0)
  if (total > LIMITE_FILAS) throw new ErrorArchivo(`El archivo tiene más de ${LIMITE_FILAS.toLocaleString('es-PE')} filas. Divídalo en partes más pequeñas.`)
  const consolidado = tablas.some(t => t.tipo === 'SGCUC' || t.tipo === 'SGAU')
  const plantilla = tablas.some(t => t.tipo === 'EXPEDIENTES' || t.tipo === 'MOVIMIENTOS')
  if (consolidado && plantilla) throw new ErrorArchivo('El archivo mezcla el formato de la plantilla con el del consolidado. Use uno solo.')
  if (plantilla && !tablas.some(t => t.tipo === 'EXPEDIENTES')) {
    throw new ErrorArchivo('Falta la tabla EXPEDIENTES. Si usa CSV, seleccione los dos archivos (expedientes y movimientos) a la vez.')
  }
  return { formato: consolidado ? 'CONSOLIDADO' : 'PLANTILLA', tablas, filas_leidas: total }
}

module.exports = {
  leerArchivos, parsearCsv, COL_EXPEDIENTES, COL_MOVIMIENTOS, LIMITE_BYTES, LIMITE_FILAS, ErrorArchivo,
}
