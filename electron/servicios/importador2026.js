// ===========================================================================
// IMPORTADOR DEL CONTROL DE EXPEDIENTES 2026 (CONTROL_EXPEDIENTES_2026.xlsx)
// Se agrega como métodos de Sistema (ver sistema.js).
//
// Hojas que se leen (se reconocen por sus encabezados):
//   «Control 2026»          un registro por expediente/documento, con el estado
//                           según el cruce con los documentos de salida (ZIP)
//   «Documentos ZIP»        documentos de salida y las filas a las que se vinculan
//   «Registros incompletos» filas con fechas pero sin datos útiles
//
// CONCILIACIÓN con la base (no inserción ciega): la mayoría de estos registros
// ya existen en la base inicial (sistema SGAU / SGCUC) con el mismo número y
// fecha de ingreso. Insertarlos otra vez duplicaría expedientes y falsearía el
// IUA y el MTA. Por eso, para cada registro:
//   · no existe en la base                       → NUEVO (sistema = 'CONTROL_2026')
//   · existe, el Control lo da por FINALIZADO y
//     en la base sigue abierto o cerrado por
//     inactividad                                 → se FINALIZA con la fecha real de
//                                                   salida y el documento del ZIP
//   · existe, el Control lo da por PENDIENTE y la
//     base lo cerró solo por inactividad          → se REABRE como EN_TRÁMITE
//                                                   (opcional, marcado por defecto)
//   · ya trabajado en URBANITO, sin cambios o en
//     conflicto (finalizado en la base)           → se OMITE (con motivo)
// Los registros incompletos se importan con estado INCOMPLETO (no entran a
// los modelos) para que no se pierdan. Todo queda en «importaciones»
// (formato CONTROL_2026) y se puede deshacer como cualquier otro lote.
// ===========================================================================

const ExcelJS = require('exceljs')
const { Sistema, ErrorUsuario, ESTADOS, texto, ahoraIso } = require('./sistema')
const { leerFecha } = require('./importacion')
const { normalizarOrigen, clasificarTramite } = require('../motor/clasificacion')
const { normalizarTexto } = require('../motor/modelos')
const { medidas } = require('../motor/estadistica')
const { LIMITE_BYTES } = require('./lectorArchivos')

const P = Sistema.prototype

const SISTEMA = 'CONTROL_2026'
const FORMATO = 'CONTROL_2026'
const TAM_LOTE = 500
const MUESTRA = 150
const COLUMNAS_SNAPSHOT = ['solicitante', 'documento_identidad', 'telefono', 'direccion', 'procedimiento_codigo', 'asunto',
  'folios', 'fecha_ingreso', 'estado', 'fecha_cierre', 'motivo_cierre', 'responsable_usuario_id', 'ubicacion_tipo',
  'ubicacion_codigo', 'ubicacion_nombre', 'fecha_invalida', 'recibo_numero', 'recibo_monto', 'observaciones']
const ceder = () => new Promise(r => setImmediate(r))

// encabezado normalizado → clave (se compara por prefijo, en este orden)
const ENC_CONTROL = [
  ['FILA EXCEL', 'fila'], ['EXPEDIENTE DOCUMENTO', 'numero'], ['REFERENCIA', 'referencia'], ['SOLICITANTE', 'solicitante'],
  ['TIPO DE TRAMITE', 'tipo'], ['FECHA DE INGRESO', 'fecha_ingreso'], ['ULTIMA DERIVACION', 'ultima_derivacion'],
  ['FECHA DE SALIDA', 'fecha_salida'], ['DIAS TRANSCURRIDOS', 'dias_excel'], ['ESTADO', 'estado'],
  ['ARCHIVO DE SALIDA', 'archivo_salida'], ['ARCHIVO ZIP', 'archivo_zip'], ['CRITERIO DE CRUCE', 'criterio'],
  ['OBSERVACIONES', 'observaciones'],
]
const ENC_ZIP = [
  ['ARCHIVO ZIP', 'zip'], ['TIPO DE TRAMITE', 'tipo'], ['NOMBRE DEL DOCUMENTO', 'documento'],
  ['EXPEDIENTE RUT DETECTADO', 'expediente_detectado'], ['FECHA DE SALIDA DETECTADA', 'fecha_salida'],
  ['FUENTE DE FECHA', 'fuente_fecha'], ['ESTADO DEL DOCUMENTO', 'estado'], ['CRUCE CON EXCEL', 'cruce'],
  ['FILA EXCEL VINCULADAS', 'filas'], ['METODO DE CRUCE', 'metodo'], ['OBSERVACION', 'observacion'],
]
const ENC_INCOMPLETOS = [
  ['FILA EXCEL', 'fila'], ['FECHA DE INGRESO', 'fecha_ingreso'], ['ULTIMA DERIVACION', 'ultima_derivacion'], ['OBSERVACION', 'observacion'],
]

const normEnc = (t) => normalizarOrigen(String(t || '').replace(/\(.*?\)/g, ' '))

function valor(v) {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('')
    if ('result' in v || 'formula' in v || 'sharedFormula' in v) return v.result === undefined || (v.result && v.result.error) ? null : valor(v.result)
    if (v.text !== undefined) return String(v.text)
    return null
  }
  return v
}

// Lee una hoja con encabezados conocidos (en las 10 primeras filas)
function leerHoja(ws, mapa, obligatorias) {
  const filas = []
  ws.eachRow({ includeEmpty: false }, (row, r) => { filas.push({ r, v: row.values.slice(1).map(valor) }) })
  for (let k = 0; k < Math.min(10, filas.length); k++) {
    const enc = filas[k].v.map(normEnc)
    const columnas = enc.map(e => { const m = mapa.find(([p]) => e === p || e.startsWith(`${p} `) || e.startsWith(p)); return m ? m[1] : null })
    if (!obligatorias.every(c => columnas.includes(c))) continue
    const usadas = new Set()
    const cols = columnas.map(c => { if (!c || usadas.has(c)) return null; usadas.add(c); return c })
    const datos = []
    for (const f of filas.slice(k + 1)) {
      if (!f.v.some(x => x !== null && x !== undefined && String(x).trim() !== '')) continue
      const o = { __fila: f.r }
      cols.forEach((c, j) => { if (c) o[c] = f.v[j] === undefined ? null : f.v[j] })
      datos.push(o)
    }
    return datos
  }
  return null
}

// Lee el libro. Devuelve { control, zip, incompletos } (zip/incompletos pueden ser [])
async function leerControl2026(nombre, buf) {
  if (!Buffer.isBuffer(buf) || buf.slice(0, 4).toString('hex') !== '504b0304') {
    throw new ErrorUsuario(`"${nombre}" no es un libro de Excel válido (.xlsx).`)
  }
  const libro = new ExcelJS.Workbook()
  try {
    // 'tableParts': las «tablas» de Excel del archivo no se necesitan y exceljs falla al leerlas
    await libro.xlsx.load(buf, { ignoreNodes: ['dataValidations', 'conditionalFormatting', 'drawing', 'picture', 'tableParts'] })
  } catch (_) {
    throw new ErrorUsuario(`No se pudo leer "${nombre}". El archivo está dañado o no es un Excel válido.`)
  }
  let control = null, zip = [], incompletos = []
  for (const ws of libro.worksheets) {
    const n = normalizarOrigen(ws.name)
    if (n === 'RESUMEN') continue
    if (!control) {
      const c = leerHoja(ws, ENC_CONTROL, ['numero', 'solicitante', 'tipo', 'fecha_ingreso', 'estado'])
      if (c) { control = c; continue }
    }
    const z = leerHoja(ws, ENC_ZIP, ['zip', 'documento', 'filas'])
    if (z) { zip = z; continue }
    const i = leerHoja(ws, ENC_INCOMPLETOS, ['fila', 'fecha_ingreso', 'observacion'])
    if (i && n.includes('INCOMPLETO')) { incompletos = i; continue }
  }
  if (!control) {
    throw new ErrorUsuario('No se encontró la hoja «Control 2026» (encabezados: Expediente / documento, Solicitante, Tipo de trámite, Fecha de ingreso, Estado).')
  }
  return { control, zip, incompletos }
}

const txt = (v, max = 500) => (v instanceof Date ? v.toISOString().slice(0, 10) : texto(v, max)) || null
const fechaDe = (v) => leerFecha(v).fecha

// ------------------------------------------------------------------ análisis (no escribe)
P.analizarControl2026 = async function (u, datos = {}, avisar = () => {}) {
  this.exigir(u, 'usuarios')
  const archivo = (datos.archivos || [])[0]
  if (!archivo) throw new ErrorUsuario('Seleccione el archivo CONTROL_EXPEDIENTES_2026.xlsx.')
  const b64 = typeof archivo.base64 === 'string' ? archivo.base64 : ''
  if (b64.length > Math.ceil(LIMITE_BYTES * 4 / 3) + 8) throw new ErrorUsuario(`El archivo pesa más de ${LIMITE_BYTES / 1048576} MB.`)
  const nombre = texto(archivo.nombre, 200) || 'archivo.xlsx'
  avisar('Leyendo el archivo…', 0, 1)
  const libro = await leerControl2026(nombre, Buffer.from(b64, 'base64'))
  const hoy = this.hoy()
  const reabrir = datos.reabrir_pendientes !== false
  const conIncompletos = datos.incluir_incompletos !== false
  const advertencias = []
  const adv = (fila, motivo, numero = null) => { if (advertencias.length < 3000) advertencias.push({ fila, numero, motivo }) }

  // ---------- documentos de salida (ZIP) por fila del Control
  const docsPorFila = new Map()
  let docsCruzados = 0
  for (const d of libro.zip) {
    const filas = String(d.filas || '').split(/[^0-9]+/).filter(Boolean).map(Number)
    if (filas.length) docsCruzados++
    for (const f of filas) {
      if (!docsPorFila.has(f)) docsPorFila.set(f, [])
      docsPorFila.get(f).push({ documento: txt(d.documento, 200), fecha: fechaDe(d.fecha_salida), estado: txt(d.estado, 40), zip: txt(d.zip, 200) })
    }
  }

  // ---------- años disponibles y filtro
  const anioDe = (f) => (f ? Number(f.slice(0, 4)) : null)
  const porAnio = {}
  for (const c of libro.control) { const a = anioDe(fechaDe(c.fecha_ingreso)); porAnio[a ?? 'sin fecha'] = (porAnio[a ?? 'sin fecha'] || 0) + 1 }
  const anios = Array.isArray(datos.anios) && datos.anios.length ? new Set(datos.anios.map(Number)) : null

  // ---------- existentes en la base, por número normalizado
  const porNumero = new Map()
  for (const e of this.almacen.expedientes.values()) {
    const k = normalizarTexto(e.numero)
    if (!porNumero.has(k)) porNumero.set(k, [])
    porNumero.get(k).push(e)
  }
  const conMovUsuario = new Set(this.bd.todas('SELECT DISTINCT expediente_id id FROM movimientos WHERE importado = 0').map(r => r.id))
  const idxProc = new Map()
  for (const p of this.almacen.procedimientos.values()) idxProc.set(normalizarTexto(p.nombre), p)

  // ---------- registro por registro
  const registros = []
  const numerosArchivo = new Map()
  const conteo = { NUEVO: 0, FINALIZAR: 0, REABRIR: 0, ACTUALIZAR: 0, OMITIR: 0, FUERA_DE_ANIO: 0, INCOMPLETO: 0 }
  const motivosOmision = {}
  const diasPorEstado = { PENDIENTE: [], FINALIZADO: [] }
  const diasExcel = { PENDIENTE: [], FINALIZADO: [] }
  let vistos = 0
  for (const c of libro.control) {
    if (++vistos % 1000 === 0) { avisar('Analizando registros…', vistos, libro.control.length); await ceder() }
    const fila = Number(c.fila) || c.__fila
    const fechaIngreso = fechaDe(c.fecha_ingreso)
    if (anios && !anios.has(anioDe(fechaIngreso))) { conteo.FUERA_DE_ANIO++; continue }
    let numero = (txt(c.numero, 80) || txt(c.referencia, 80) || '').toUpperCase().replace(/\s+/g, ' ')
    const solicitante = txt(c.solicitante, 200)
    const tipo = txt(c.tipo, 200)
    if (!numero && !solicitante && !tipo) { conteo.OMITIR++; motivosOmision['Sin número, solicitante ni trámite'] = (motivosOmision['Sin número, solicitante ni trámite'] || 0) + 1; continue }
    if (!numero) numero = `CTRL-F${fila}`
    const estadoTxt = normalizarOrigen(c.estado)
    const finalizado = estadoTxt.startsWith('FINALIZADO')
    const docs = docsPorFila.get(fila) || []
    let fechaSalida = fechaDe(c.fecha_salida) || (docs.find(d => d.fecha) || {}).fecha || null
    const documento = txt(c.archivo_salida, 120) || (docs[0] && docs[0].documento ? docs[0].documento.slice(0, 120) : null)
    if (fechaSalida && fechaIngreso && fechaSalida < fechaIngreso) { adv(fila, 'La fecha de salida es anterior a la fecha de ingreso: se ignora.', numero); fechaSalida = null }
    if (fechaSalida && fechaSalida > hoy) { adv(fila, 'La fecha de salida es posterior a hoy: se ignora.', numero); fechaSalida = null }
    if (finalizado && !fechaSalida) adv(fila, `Finalizado sin fecha de salida legible (${txt(c.estado, 40)}): se registra sin fecha de cierre y no entra al MTA.`, numero)
    // días transcurridos con el calendario de días hábiles y feriados
    const hasta = finalizado ? fechaSalida : hoy
    const dh = fechaIngreso && hasta && this.cal.indice(fechaIngreso) && this.cal.indice(hasta) ? this.cal.diasHabiles(fechaIngreso, hasta) : null
    if (dh !== null) diasPorEstado[finalizado ? 'FINALIZADO' : 'PENDIENTE'].push(dh)
    if (typeof c.dias_excel === 'number') diasExcel[finalizado ? 'FINALIZADO' : 'PENDIENTE'].push(c.dias_excel)

    // trámite
    let codigo = clasificarTramite(tipo)
    if (['SIN_CLASIFICAR', 'VACIO'].includes(codigo) && tipo) {
      const p = idxProc.get(normalizarTexto(tipo))
      if (p) codigo = p.codigo
    }
    const proc = this.almacen.procedimientos.get(codigo) || this.almacen.procedimientos.get('SIN_CLASIFICAR')

    // número repetido dentro del archivo
    const kNum = normalizarTexto(numero)
    if (numerosArchivo.has(kNum)) {
      adv(fila, `El número ${numero} se repite en el archivo (fila ${numerosArchivo.get(kNum)}).`, numero)
      numero = `${numero} [F${fila}]`
    } else numerosArchivo.set(kNum, fila)

    const reg = { fila, numero, solicitante, tipo, codigo: proc ? proc.codigo : 'SIN_CLASIFICAR', fecha_ingreso: fechaIngreso,
                  finalizado, fecha_salida: fechaSalida, documento, estado_control: txt(c.estado, 40),
                  observacion: txt(c.observaciones, 500), criterio: txt(c.criterio, 80), zip: txt(c.archivo_zip, 200) }

    // ---- conciliación con la base
    const candidatos = porNumero.get(normalizarTexto(numero)) || []
    const existente = candidatos.find(e => e.fecha_ingreso === fechaIngreso) || (candidatos.length === 1 ? candidatos[0] : null)
    const omitir = (motivo) => { reg.situacion = 'OMITIR'; reg.motivo = motivo; conteo.OMITIR++; motivosOmision[motivo] = (motivosOmision[motivo] || 0) + 1 }
    if (!existente) {
      if (candidatos.length > 1) { omitir('Número repetido en la base con otra fecha de ingreso'); registros.push(reg); continue }
      reg.situacion = 'NUEVO'; conteo.NUEVO++
    } else {
      reg.existente_id = existente.id
      reg.existente_sistema = existente.sistema
      reg.estado_base = existente.estado
      if (!existente.importado) omitir('Registrado en URBANITO: no se modifica')
      else if (conMovUsuario.has(existente.id)) omitir('Ya tiene movimientos registrados en URBANITO')
      else if (finalizado) {
        if (existente.estado === 'FINALIZADO' && (existente.fecha_cierre === fechaSalida || !fechaSalida)) omitir('Ya figura finalizado')
        else if (['EN_TRAMITE', 'OBSERVADO', 'CERRADO_HISTORICO', 'SIN_FECHA', 'FINALIZADO'].includes(existente.estado)) {
          reg.situacion = 'FINALIZAR'; conteo.FINALIZAR++
        } else omitir(`En la base está ${(ESTADOS[existente.estado] || existente.estado).toLowerCase()}`)
      } else if (existente.estado === 'CERRADO_HISTORICO' && reabrir) { reg.situacion = 'REABRIR'; conteo.REABRIR++ }
      else if (existente.estado === 'CERRADO_HISTORICO') omitir('Cerrado por inactividad en la base (no se eligió reabrir)')
      else if (existente.estado === 'FINALIZADO') omitir('Pendiente en el Control 2026 pero finalizado en la base (conflicto: revisar)')
      else if (['EN_TRAMITE', 'OBSERVADO'].includes(existente.estado)) omitir('Ya figura en trámite')
      else omitir(`En la base está ${(ESTADOS[existente.estado] || existente.estado).toLowerCase()}`)
    }
    registros.push(reg)
  }

  // ---------- registros incompletos
  const incompletos = []
  if (conIncompletos) {
    for (const i of libro.incompletos) {
      const fi = fechaDe(i.fecha_ingreso)
      if (anios && !anios.has(anioDe(fi))) continue
      const numero = `INCOMPLETO-F${Number(i.fila) || i.__fila}`
      if (this.bd.una('SELECT id FROM expedientes WHERE sistema = ? AND numero = ?', [SISTEMA, numero])) continue
      incompletos.push({ fila: Number(i.fila) || i.__fila, numero, fecha_ingreso: fi, ultima: fechaDe(i.ultima_derivacion),
                         observacion: txt(i.observacion, 500) })
    }
    conteo.INCOMPLETO = incompletos.length
  }

  const est = (v) => { const m = medidas(v); return m ? { n: m.n, minimo: m.minimo, maximo: m.maximo, mediana: m.mediana, media: m.media } : null }
  const nombreProc = (c) => (this.almacen.procedimientos.get(c) || {}).nombre || c
  const porTramite = {}
  for (const r of registros) porTramite[r.codigo] = (porTramite[r.codigo] || 0) + 1
  return {
    nombre_archivo: nombre, hoy,
    hojas: { control: libro.control.length, documentos_zip: libro.zip.length, documentos_zip_cruzados: docsCruzados, incompletos: libro.incompletos.length },
    anios_disponibles: Object.entries(porAnio).map(([a, n]) => ({ anio: a, n })).sort((a, b) => String(a.anio).localeCompare(String(b.anio))),
    anios_filtro: anios ? [...anios] : null, reabrir_pendientes: reabrir, incluir_incompletos: conIncompletos,
    totales: {
      leidos: libro.control.length, considerados: registros.length, nuevos: conteo.NUEVO, finalizar: conteo.FINALIZAR,
      reabrir: conteo.REABRIR, actualizados: conteo.FINALIZAR + conteo.REABRIR, omitidos: conteo.OMITIR,
      fuera_de_anio: conteo.FUERA_DE_ANIO, incompletos: conteo.INCOMPLETO,
      pendientes: registros.filter(r => !r.finalizado).length, finalizados: registros.filter(r => r.finalizado).length,
    },
    motivos_omision: Object.entries(motivosOmision).map(([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n),
    estadisticas: {
      dias_habiles: { PENDIENTE: est(diasPorEstado.PENDIENTE), FINALIZADO: est(diasPorEstado.FINALIZADO) },
      dias_calendario_excel: { PENDIENTE: est(diasExcel.PENDIENTE), FINALIZADO: est(diasExcel.FINALIZADO) },
    },
    tramites: Object.entries(porTramite).map(([codigo, n]) => ({ codigo, nombre: nombreProc(codigo), n })).sort((a, b) => b.n - a.n).slice(0, 25),
    advertencias, advertencias_total: advertencias.length,
    muestra: registros.filter(r => r.situacion !== 'OMITIR').slice(0, MUESTRA).concat(registros.filter(r => r.situacion === 'OMITIR').slice(0, 30))
      .map(r => ({ fila: r.fila, numero: r.numero, solicitante: r.solicitante, procedimiento: nombreProc(r.codigo), fecha_ingreso: r.fecha_ingreso,
                   estado_control: r.estado_control, fecha_salida: r.fecha_salida, situacion: r.situacion, motivo: r.motivo || null,
                   estado_base: r.estado_base ? (ESTADOS[r.estado_base] || r.estado_base) : null, sistema_base: r.existente_sistema || null })),
    _registros: registros, _incompletos: incompletos,
  }
}

function publico(a) {
  const { _registros, _incompletos, ...resto } = a
  return resto
}

const progresoDe = (progreso) => (fase, hechos, total) => {
  if (progreso) { try { progreso({ fase, hechos, total, porcentaje: total ? Math.round((hechos / total) * 100) : 0 }) } catch (_) { /* sin ventana */ } }
}

P.importar2026Previsualizar = async function (u, datos, { progreso } = {}) {
  const a = await this.analizarControl2026(u, datos || {}, progresoDe(progreso))
  this.bd.transaccion(() => this.auditar(u, 'IMPORTAR_2026_PREVISUALIZAR', 'importaciones', null, { archivo: a.nombre_archivo, totales: a.totales }))
  return publico(a)
}

P.importar2026Confirmar = async function (u, datos = {}, { progreso } = {}) {
  const avisar = progresoDe(progreso)
  const a = await this.analizarControl2026(u, datos, avisar)
  const hoy = this.hoy()
  const ahora = ahoraIso()
  const nuevos = a._registros.filter(r => r.situacion === 'NUEVO')
  const cambios = a._registros.filter(r => r.situacion === 'FINALIZAR' || r.situacion === 'REABRIR')
  const total = nuevos.length + cambios.length + a._incompletos.length
  const detalle = { actualizados: [], finalizados: 0, reabiertos: 0, incompletos: a._incompletos.length,
                    motivos_omision: a.motivos_omision, advertencias: a.advertencias.slice(0, 500) }
  let loteId = null, movCreados = 0
  const destinoProc = (codigo) => {
    const p = this.almacen.procedimientos.get(codigo)
    const d = p && p.departamento_codigo ? this.departamentos.get(p.departamento_codigo) : null
    return d ? { tipo: 'DEPARTAMENTO', codigo: d.codigo, nombre: d.nombre } : { tipo: 'SIN DATO', codigo: null, nombre: null }
  }

  await this.bd.transaccionLarga('importación del Control 2026', async () => {
    loteId = this.bd.ejecutar(
      `INSERT INTO importaciones(fecha_hora, usuario_id, departamento_codigo, nombre_archivo, formato, filas_leidas,
       expedientes_creados, expedientes_omitidos, expedientes_actualizados, movimientos_creados, errores, estado, anio_filtro)
       VALUES (?,?,NULL,?,?,?,0,0,0,0,0,'EN_CURSO',?)`,
      [ahora, u.id, a.nombre_archivo, FORMATO, a.totales.leidos, a.anios_filtro ? JSON.stringify(a.anios_filtro) : null]).ultimoId
    const insMov = this.bd.preparar(
      `INSERT INTO movimientos(expediente_id, orden, fecha, tipo, destino_texto, destino_tipo, destino_codigo, destino_nombre,
       destino_usuario_id, documento, folios, observacion, usuario_id, registrado_en, fecha_valida, importado, importacion_id)
       VALUES (?,?,?,?,?,?,?,?,NULL,?,NULL,?,NULL,?,?,1,?)`)
    const mov = (expId, orden, fecha, tipo, destino, documento, observacion) => {
      insMov.ejecutar([expId, orden, fecha, tipo, destino.nombre || destino.texto || null, destino.tipo, destino.codigo, destino.nombre,
        documento, observacion, ahora, fecha && fecha <= hoy ? 1 : 0, loteId])
      movCreados++
    }
    let hechos = 0
    try {
      // ---- nuevos
      for (const r of nuevos) {
        const dest = destinoProc(r.codigo)
        const cierre = r.finalizado ? r.fecha_salida : null
        const ub = r.finalizado ? { tipo: 'ESTADO', codigo: 'FINALIZADO', nombre: 'Finalizado' } : dest
        const fechaInvalida = r.fecha_ingreso && r.fecha_ingreso > hoy ? 1 : 0
        const id = this.bd.ejecutar(`INSERT INTO expedientes(numero, sistema, solicitante, procedimiento_codigo, asunto, fecha_ingreso,
            estado, fecha_cierre, motivo_cierre, ubicacion_tipo, ubicacion_codigo, ubicacion_nombre, importado, fecha_invalida,
            registrado_por, creado_en, importacion_id, observaciones) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)`,
          [r.numero, SISTEMA, r.solicitante, r.codigo, r.tipo, r.fecha_ingreso, r.finalizado ? 'FINALIZADO' : (r.fecha_ingreso ? 'EN_TRAMITE' : 'SIN_FECHA'),
           cierre, r.finalizado ? `Finalizado según el Control 2026${r.documento ? ` — ${r.documento}` : ''}${cierre ? '' : ' (sin fecha de salida legible)'}` : null,
           ub.tipo, ub.codigo, ub.nombre, fechaInvalida, u.id, ahora, loteId,
           [r.observacion, r.criterio ? `Cruce: ${r.criterio}` : null].filter(Boolean).join(' · ') || null]).ultimoId
        let orden = 1
        if (r.fecha_ingreso) mov(id, orden++, r.fecha_ingreso, 'REGISTRO', dest, null, 'Registro según el Control de Expedientes 2026')
        if (r.finalizado && cierre) mov(id, orden++, cierre, 'FINALIZACION', { tipo: 'ESTADO', codigo: 'FINALIZADO', nombre: 'Finalizado' },
          r.documento, r.zip ? `Documento de salida en ${r.zip}` : null)
        if (++hechos % TAM_LOTE === 0) { avisar('Guardando expedientes nuevos…', hechos, total); await ceder() }
      }
      // ---- conciliados (finalizar / reabrir)
      for (const r of cambios) {
        const antes = this.bd.una(`SELECT ${COLUMNAS_SNAPSHOT.join(', ')} FROM expedientes WHERE id = ?`, [r.existente_id])
        detalle.actualizados.push({ id: r.existente_id, numero: r.numero, antes, accion: r.situacion })
        const orden = (this.bd.una('SELECT MAX(orden) m FROM movimientos WHERE expediente_id = ?', [r.existente_id]).m || 0) + 1
        if (r.situacion === 'FINALIZAR') {
          this.bd.ejecutar(`UPDATE expedientes SET estado = 'FINALIZADO', fecha_cierre = ?, motivo_cierre = ?,
                            ubicacion_tipo = 'ESTADO', ubicacion_codigo = 'FINALIZADO', ubicacion_nombre = 'Finalizado' WHERE id = ?`,
            [r.fecha_salida, `Finalizado según el Control 2026${r.documento ? ` — ${r.documento}` : ''}${r.fecha_salida ? '' : ' (sin fecha de salida legible)'}`, r.existente_id])
          if (r.fecha_salida) {
            mov(r.existente_id, orden, r.fecha_salida, 'FINALIZACION', { tipo: 'ESTADO', codigo: 'FINALIZADO', nombre: 'Finalizado' },
              r.documento, `Conciliación con el Control 2026${r.zip ? ` (documento en ${r.zip})` : ''}`)
          }
          detalle.finalizados++
        } else {
          // reabrir: sigue donde estaba (destino de su último movimiento) o en el departamento de su trámite
          const ultimo = this.bd.una(`SELECT destino_tipo, destino_codigo, destino_nombre FROM movimientos WHERE expediente_id = ? AND fecha_valida = 1
                                      ORDER BY orden DESC, id DESC LIMIT 1`, [r.existente_id])
          const ub = ultimo && ultimo.destino_tipo && !['SIN DATO', 'ESTADO'].includes(ultimo.destino_tipo)
            ? { tipo: ultimo.destino_tipo, codigo: ultimo.destino_codigo, nombre: ultimo.destino_nombre } : destinoProc(antes.procedimiento_codigo)
          this.bd.ejecutar(`UPDATE expedientes SET estado = 'EN_TRAMITE', fecha_cierre = NULL, motivo_cierre = NULL,
                            ubicacion_tipo = ?, ubicacion_codigo = ?, ubicacion_nombre = ?,
                            observaciones = TRIM(COALESCE(observaciones || ' · ', '') || ?) WHERE id = ?`,
            [ub.tipo, ub.codigo, ub.nombre, 'Pendiente según el Control 2026 (sin documento de salida)', r.existente_id])
          detalle.reabiertos++
        }
        if (++hechos % TAM_LOTE === 0) { avisar('Conciliando expedientes existentes…', hechos, total); await ceder() }
      }
      // ---- incompletos (no entran a los modelos)
      for (const i of a._incompletos) {
        const id = this.bd.ejecutar(`INSERT INTO expedientes(numero, sistema, procedimiento_codigo, fecha_ingreso, estado, ubicacion_tipo,
            importado, fecha_invalida, registrado_por, creado_en, importacion_id, observaciones)
            VALUES (?,?,'VACIO',?,'INCOMPLETO','SIN DATO',1,0,?,?,?,?)`,
          [i.numero, SISTEMA, i.fecha_ingreso, u.id, ahora, loteId, `REGISTRO INCOMPLETO (fila ${i.fila} del Control 2026): ${i.observacion || 'sin datos'}`]).ultimoId
        if (i.fecha_ingreso) mov(id, 1, i.fecha_ingreso, 'REGISTRO', { tipo: 'SIN DATO', codigo: null, nombre: null }, null, 'Registro incompleto')
        if (++hechos % TAM_LOTE === 0) { avisar('Guardando registros incompletos…', hechos, total); await ceder() }
      }
    } finally { insMov.liberar() }
    this.bd.ejecutar(`UPDATE importaciones SET expedientes_creados = ?, expedientes_omitidos = ?, expedientes_actualizados = ?,
                      movimientos_creados = ?, estado = 'COMPLETADO', detalle = ? WHERE id = ?`,
      [nuevos.length + a._incompletos.length, a.totales.omitidos, cambios.length, movCreados, JSON.stringify(detalle), loteId])
    this.auditar(u, 'IMPORTAR_2026_CONFIRMAR', 'importaciones', loteId, {
      archivo: a.nombre_archivo, anios: a.anios_filtro, nuevos: nuevos.length, finalizados: detalle.finalizados,
      reabiertos: detalle.reabiertos, incompletos: a._incompletos.length, omitidos: a.totales.omitidos, movimientos: movCreados })
  })
  avisar('Recalculando prioridades (IUA) y tiempos (MTA)…', total, total)
  await ceder()
  this.cargar()
  avisar('Listo', total, total)
  return {
    ok: true, importacion_id: loteId, nombre_archivo: a.nombre_archivo, nuevos: nuevos.length, finalizados: detalle.finalizados,
    reabiertos: detalle.reabiertos, actualizados: cambios.length, incompletos: a._incompletos.length, omitidos: a.totales.omitidos,
    movimientos_creados: movCreados, en_tramite_ahora: this.r.iua.size,
    mensaje: `${nuevos.length} expedientes nuevos, ${cambios.length} actualizados (${detalle.finalizados} finalizados, ${detalle.reabiertos} reabiertos), ${a.totales.omitidos} omitidos.`,
  }
}

// ------------------------------------------------------------------ documento TUPA de referencia
const EXT_TUPA = ['pdf', 'xlsx']

P.tupaSubir = function (u, datos = {}) {
  this.exigir(u, 'usuarios')
  const a = (datos.archivos || [])[0]
  if (!a) throw new ErrorUsuario('Seleccione el documento TUPA (PDF o Excel).')
  const nombre = texto(a.nombre, 200)
  const ext = ((nombre.match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase()
  if (!EXT_TUPA.includes(ext)) throw new ErrorUsuario('El TUPA debe ser un PDF o un Excel (.xlsx).')
  const buf = Buffer.from(String(a.base64 || ''), 'base64')
  if (!buf.length) throw new ErrorUsuario('El archivo está vacío.')
  if (buf.length > LIMITE_BYTES) throw new ErrorUsuario(`El archivo pesa más de ${LIMITE_BYTES / 1048576} MB.`)
  const firma = buf.slice(0, 4).toString('hex')
  if ((ext === 'pdf' && firma !== '25504446') || (ext === 'xlsx' && firma !== '504b0304')) throw new ErrorUsuario('El contenido no corresponde a la extensión del archivo.')
  let id
  this.bd.transaccion(() => {
    id = this.bd.ejecutar('INSERT INTO tupa_documento(nombre_archivo, contenido, subido_por, creado_en) VALUES (?,?,?,?)',
      [nombre, new Uint8Array(buf), u.id, ahoraIso()]).ultimoId
    this.auditar(u, 'SUBIR_TUPA', 'tupa_documento', id, { archivo: nombre, bytes: buf.length })
  })
  return { ok: true, id, nombre_archivo: nombre }
}

P.tupaListar = function (u) {
  this.exigir(u, 'consultar')
  return this.bd.todas('SELECT id, nombre_archivo, length(contenido) tamano, subido_por, creado_en FROM tupa_documento ORDER BY id DESC')
    .map(t => ({ ...t, subido_por_nombre: (this.usuarios.get(t.subido_por) || {}).nombre_completo || '—' }))
}

P.tupaDescargar = function (u, { id } = {}) {
  this.exigir(u, 'consultar')
  const t = this.bd.una('SELECT nombre_archivo, contenido FROM tupa_documento WHERE id = ?', [Number(id)])
  if (!t) throw new ErrorUsuario('El documento no existe.', 'NO_EXISTE')
  return { nombre_archivo: t.nombre_archivo, base64: Buffer.from(t.contenido).toString('base64') }
}

module.exports = { leerControl2026, SISTEMA: SISTEMA }
