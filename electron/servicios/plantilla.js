// Plantilla única de importación (.xlsx), generada con los catálogos actuales
// de la base para que siempre esté al día. Mismo estilo que los reportes
// (electron/exportar.js): título azul, encabezados azules con letra blanca.

const ExcelJS = require('exceljs')
const { COL_EXPEDIENTES, COL_MOVIMIENTOS } = require('./lectorArchivos')

const AZUL = 'FF1F3A68'
const FILAS = 5000            // filas preparadas con validación de datos
const ANCHOS_EXP = [18, 15, 34, 15, 13, 34, 26, 36, 9, 14, 11, 15, 14, 20, 36]
const ANCHOS_MOV = [18, 9, 16, 14, 30, 26, 11, 40]

function encabezados(h, columnas, anchos) {
  const fila = h.getRow(1)
  columnas.forEach(([, titulo], i) => {
    const c = fila.getCell(i + 1)
    c.value = titulo
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: titulo.includes('*') ? AZUL : 'FF4A6491' } }
    c.alignment = { vertical: 'middle', wrapText: true }
    h.getColumn(i + 1).width = anchos[i] || 16
  })
  fila.height = 32
  h.views = [{ state: 'frozen', ySplit: 1 }]
}

const letra = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
const rango = (col, h = FILAS + 1) => `${letra(col)}2:${letra(col)}${h}`
const lista = (h, col, ref, titulo) => h.dataValidations.add(rango(col), {
  type: 'list', allowBlank: true, formulae: [ref], showErrorMessage: true, errorStyle: 'error',
  errorTitle: titulo, error: `Elija un valor de la lista (${titulo}).`,
})
const fecha = (h, col) => {
  h.getColumn(col).numFmt = 'dd/mm/yyyy'
  h.dataValidations.add(rango(col), {
    type: 'date', operator: 'between', allowBlank: true, showErrorMessage: true,
    formulae: [new Date(Date.UTC(2000, 0, 1)), new Date(Date.UTC(2045, 11, 31))],
    errorTitle: 'Fecha', error: 'Escriba una fecha válida en formato dd/mm/aaaa.',
  })
}
const enteroMin1 = (h, col) => h.dataValidations.add(rango(col), {
  type: 'whole', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [1], showErrorMessage: true,
  errorTitle: 'Número', error: 'Escriba un número entero mayor o igual a 1.',
})
const largo = (h, col, max) => h.dataValidations.add(rango(col), {
  type: 'textLength', operator: 'lessThanOrEqual', allowBlank: true, formulae: [max], showErrorMessage: true,
  errorTitle: 'Texto demasiado largo', error: `Máximo ${max} caracteres.`,
})
const comoTexto = (h, col) => { h.getColumn(col).numFmt = '@' }

async function generarPlantilla(spec) {
  const { departamento, alcance, procedimientos, departamentos, unidades, usuarios, tipos, estados, institucion } = spec
  const libro = new ExcelJS.Workbook()
  libro.creator = 'URBANITO'
  libro.created = new Date()

  // ------------------------------------------------ INSTRUCCIONES
  const ins = libro.addWorksheet('INSTRUCCIONES', { properties: { tabColor: { argb: AZUL } } })
  ins.getColumn(1).width = 4
  ins.getColumn(2).width = 120
  ins.getCell('B1').value = 'URBANITO — Plantilla de importación de expedientes'
  ins.getCell('B1').font = { bold: true, size: 14, color: { argb: AZUL } }
  ins.getCell('B2').value = `${(institucion && institucion.area) || ''} — ${(institucion && institucion.nombre) || ''}`
  ins.getCell('B2').font = { italic: true, size: 10, color: { argb: 'FF555555' } }
  ins.getCell('B3').value = departamento ? `Departamento: ${departamento.nombre}`
    : (alcance ? `Departamentos: ${alcance.join(', ')}` : 'Todos los departamentos')
  ins.getCell('B3').font = { bold: true, size: 11 }
  const ej = procedimientos[0] ? procedimientos[0].codigo : 'NUM_PREDIAL'
  const depEj = departamento ? departamento.codigo : (departamentos[0] || {}).codigo
  const secciones = [
    ['Para qué sirve', [
      'Cargar a URBANITO los expedientes de su departamento que todavía no están en el programa (por ejemplo, los llevados en un cuaderno o en otro Excel).',
      'Se importan desde «Importar expedientes». Antes de guardar nada, el programa muestra una vista previa con los errores encontrados.',
    ]],
    ['Orden de llenado', [
      '1. Hoja EXPEDIENTES: una fila por expediente (datos del solicitante, trámite, folios y estado).',
      '2. Hoja MOVIMIENTOS: una fila por cada movimiento del expediente (derivaciones, observaciones, etc.), enlazada por el N° EXPEDIENTE.',
      '3. Las columnas con asterisco (*) son obligatorias. Las listas desplegables muestran los valores válidos (hoja CATÁLOGOS).',
      '4. Guarde el archivo como .xlsx y súbalo en «Importar expedientes». También puede usar dos CSV (uno por hoja) con los mismos encabezados.',
    ]],
    ['Regla «una fila por movimiento»', [
      'Si un expediente tuvo 3 movimientos, va 1 fila en EXPEDIENTES y 3 filas en MOVIMIENTOS con el mismo N° EXPEDIENTE y N° MOV 1, 2 y 3.',
      'El N° MOV es el orden del movimiento y no puede repetirse dentro del mismo expediente.',
    ]],
    ['Formatos', [
      'Fechas: dd/mm/aaaa (por ejemplo 05/11/2026). También se acepta aaaa-mm-dd y las fechas nativas de Excel.',
      'Una fecha posterior a hoy se guarda marcada como inválida y no entra a los cálculos de plazos (se avisa en la vista previa).',
      'DNI / RUC / CE: DNI de 8 dígitos, RUC de 11 dígitos o carné de extranjería de 9 a 12 caracteres. Escríbalo como texto para no perder los ceros iniciales.',
      'Folios y N° MOV: números enteros mayores o iguales a 1. MONTO S/.: número con punto decimal (36.50).',
      `ESTADO: ${estados.join(', ')}. Si es FINALIZADO o ARCHIVADO indique la FECHA CIERRE (si la deja vacía se usa la fecha del último movimiento).`,
      `TIPO MOV: ${tipos.join(', ')}. «DERIVADO» se convierte en DERIVACION; «RECIBIDO» se conserva como tipo importado.`,
      'DESTINO: código de una unidad orgánica (SGAU, GEDU…), de un departamento (DEP_…) o el usuario de una persona (jefe.numeracion…). Si no se reconoce se guarda el texto como «SIN DATO» y se avisa.',
    ]],
    ['Ejemplos (ver la hoja EJEMPLO)', [
      `En trámite: IMP-0001-2026, ingresó el 03/11/2026, trámite ${ej}, estado EN_TRAMITE; movimiento 1 REGISTRO a ${depEj}; movimiento 2 DERIVACION a un técnico.`,
      `Finalizado: IMP-0002-2026, estado FINALIZADO, FECHA CIERRE 28/10/2026; último movimiento FINALIZACION con el documento que lo resuelve.`,
      `Observado: IMP-0003-2026, estado OBSERVADO; último movimiento OBSERVACION con lo que debe subsanar el administrado (el plazo queda suspendido).`,
    ]],
    ['Duplicados', [
      'Un expediente se identifica por su N° EXPEDIENTE. Si ya existe en URBANITO, por defecto NO se importa (se informa como omitido).',
      'Opcionalmente puede pedir que se actualicen los que ya fueron importados antes. Los registrados en Mesa de partes nunca se modifican.',
      'Si el mismo número aparece dos veces en EXPEDIENTES con datos distintos, esas filas se rechazan como error.',
      'Cada importación queda registrada y puede deshacerse mientras nadie haya trabajado sobre esos expedientes en URBANITO.',
    ]],
    ['IMPORTANTE', [
      'NO cambie, mueva ni borre los encabezados de las hojas EXPEDIENTES y MOVIMIENTOS: el programa reconoce las columnas por su nombre.',
      'No escriba fórmulas: el programa solo lee los valores. Borre las filas de la hoja EJEMPLO antes de usarla como modelo.',
      departamento ? `Esta plantilla solo lista los procedimientos del ${departamento.nombre}. Un trámite de otro departamento será rechazado.`
        : 'Un jefe de departamento solo puede importar trámites de sus departamentos; las filas de otros departamentos se rechazan.',
    ]],
  ]
  let r = 5
  for (const [titulo, lineas] of secciones) {
    const c = ins.getCell(`B${r}`)
    c.value = titulo
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
    r++
    for (const l of lineas) {
      ins.getCell(`B${r}`).value = l
      ins.getCell(`B${r}`).alignment = { wrapText: true, vertical: 'top' }
      r++
    }
    r++
  }
  ins.getCell(`B${r}`).value = `Generada por URBANITO el ${spec.hoy.split('-').reverse().join('/')} con los catálogos vigentes.`
  ins.getCell(`B${r}`).font = { italic: true, size: 9, color: { argb: 'FF777777' } }

  // ------------------------------------------------ CATÁLOGOS (protegida)
  const cat = libro.addWorksheet('CATALOGOS', { properties: { tabColor: { argb: 'FF888888' } } })
  const bloques = [
    [1, ['CÓDIGO PROCEDIMIENTO', 'NOMBRE', 'GRUPO', 'PLAZO TUPA (d.h.)', 'DEPARTAMENTO'],
      procedimientos.map(p => [p.codigo, p.nombre, p.grupo, p.plazo_tupa === null ? 'Sin plazo TUPA' : p.plazo_tupa, p.departamento])],
    [7, ['CÓDIGO DEPARTAMENTO', 'DEPARTAMENTO'], departamentos.map(d => [d.codigo, d.nombre])],
    [10, ['CÓDIGO UNIDAD', 'UNIDAD ORGÁNICA'], unidades.map(x => [x.codigo, x.nombre])],
    [13, ['USUARIO', 'NOMBRE', 'ROL'], usuarios.map(x => [x.usuario, x.nombre_completo, x.rol])],
    [17, ['TIPO MOV'], tipos.map(t => [t])],
    [19, ['ESTADO'], estados.map(t => [t])],
    [21, ['DESTINOS VÁLIDOS'], [...unidades.map(x => [x.codigo]), ...departamentos.map(d => [d.codigo]), ...usuarios.map(x => [x.usuario])]],
  ]
  for (const [col, titulos, filas] of bloques) {
    titulos.forEach((t, i) => {
      const c = cat.getCell(1, col + i)
      c.value = t
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
      cat.getColumn(col + i).width = i === 1 ? 40 : 20
    })
    filas.forEach((f, k) => f.forEach((v, i) => { cat.getCell(k + 2, col + i).value = v === undefined ? null : v }))
  }
  cat.views = [{ state: 'frozen', ySplit: 1 }]
  const fin = (n) => Math.max(2, n + 1)
  const refProc = `CATALOGOS!$A$2:$A$${fin(procedimientos.length)}`
  const refTipos = `CATALOGOS!$Q$2:$Q$${fin(tipos.length)}`
  const refEstados = `CATALOGOS!$S$2:$S$${fin(estados.length)}`
  const refUsuarios = `CATALOGOS!$M$2:$M$${fin(usuarios.length)}`
  const refDestinos = `CATALOGOS!$U$2:$U$${fin(unidades.length + departamentos.length + usuarios.length)}`
  await cat.protect('', { selectLockedCells: true, selectUnlockedCells: true })

  // ------------------------------------------------ EXPEDIENTES
  const exp = libro.addWorksheet('EXPEDIENTES', { properties: { tabColor: { argb: 'FF16A34A' } } })
  encabezados(exp, COL_EXPEDIENTES, ANCHOS_EXP)
  const ci = (clave) => COL_EXPEDIENTES.findIndex(([c]) => c === clave) + 1
  comoTexto(exp, ci('numero')); largo(exp, ci('numero'), 30)
  fecha(exp, ci('fecha_ingreso'))
  largo(exp, ci('solicitante'), 200)
  comoTexto(exp, ci('documento')); largo(exp, ci('documento'), 12)
  comoTexto(exp, ci('telefono')); largo(exp, ci('telefono'), 20)
  largo(exp, ci('direccion'), 200)
  lista(exp, ci('procedimiento'), refProc, 'Procedimiento')
  largo(exp, ci('asunto'), 1000)
  enteroMin1(exp, ci('folios'))
  comoTexto(exp, ci('recibo'))
  exp.dataValidations.add(rango(ci('monto')), { type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0],
    showErrorMessage: true, errorTitle: 'Monto', error: 'Escriba un número mayor o igual a 0.' })
  lista(exp, ci('estado'), refEstados, 'Estado')
  fecha(exp, ci('fecha_cierre'))
  lista(exp, ci('responsable'), refUsuarios, 'Responsable')
  largo(exp, ci('observaciones'), 2000)

  // ------------------------------------------------ MOVIMIENTOS
  const mov = libro.addWorksheet('MOVIMIENTOS', { properties: { tabColor: { argb: 'FF16A34A' } } })
  encabezados(mov, COL_MOVIMIENTOS, ANCHOS_MOV)
  const cm = (clave) => COL_MOVIMIENTOS.findIndex(([c]) => c === clave) + 1
  comoTexto(mov, cm('numero')); largo(mov, cm('numero'), 30)
  enteroMin1(mov, cm('n_mov'))
  lista(mov, cm('tipo'), refTipos, 'Tipo de movimiento')
  fecha(mov, cm('fecha'))
  // DESTINO: lista sugerida, pero se admite otro texto (se guarda como SIN DATO con aviso)
  mov.dataValidations.add(rango(cm('destino')), { type: 'list', allowBlank: true, formulae: [refDestinos],
    showErrorMessage: true, errorStyle: 'warning', errorTitle: 'Destino', error: 'El destino no está en el catálogo. Si continúa, se guardará como texto sin reconocer.' })
  largo(mov, cm('documento'), 120)
  largo(mov, cm('observacion'), 2000)

  // ------------------------------------------------ EJEMPLO
  const ejh = libro.addWorksheet('EJEMPLO', { properties: { tabColor: { argb: 'FFDC2626' } } })
  const aviso = (fila, n) => {
    ejh.mergeCells(fila, 1, fila, n)
    const c = ejh.getCell(fila, 1)
    c.value = 'BORRAR ESTAS FILAS — son expedientes ficticios de ejemplo (esta hoja no se importa)'
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } }
  }
  const tecnico = usuarios.find(x => x.rol === 'TECNICO' && (!departamento || (x.departamentos || [x.departamento_codigo]).includes(departamento.codigo)))
  const dest2 = tecnico ? tecnico.usuario : (unidades[0] || {}).codigo || depEj
  const d = (s) => { const [dd, mm, aa] = s.split('/').map(Number); return new Date(Date.UTC(aa, mm - 1, dd)) }
  aviso(1, COL_EXPEDIENTES.length)
  COL_EXPEDIENTES.forEach(([, t], i) => { const c = ejh.getCell(2, i + 1); c.value = t; c.font = { bold: true }; ejh.getColumn(i + 1).width = ANCHOS_EXP[i] })
  const ejemplosExp = [
    ['IMP-0001-2026', d('03/11/2026'), 'QUISPE MAMANI JUAN CARLOS', '40123456', '951000111', 'JR. LIMA 123, JULIACA', ej, 'Solicitud de ejemplo', 5, '00012345', 36.5, 'EN_TRAMITE', null, tecnico ? tecnico.usuario : null, 'Ejemplo: en trámite'],
    ['IMP-0002-2026', d('06/10/2026'), 'CONSTRUCTORA EJEMPLO S.A.C.', '20123456789', null, 'AV. CIRCUNVALACIÓN S/N', ej, null, 12, null, null, 'FINALIZADO', d('28/10/2026'), null, 'Ejemplo: finalizado'],
    ['IMP-0003-2026', d('20/10/2026'), 'CONDORI APAZA ROSA', '41234567', null, null, ej, null, 3, null, null, 'OBSERVADO', null, null, 'Ejemplo: observado'],
  ]
  ejemplosExp.forEach((f, k) => f.forEach((v, i) => { const c = ejh.getCell(3 + k, i + 1); c.value = v; if (v instanceof Date) c.numFmt = 'dd/mm/yyyy' }))
  aviso(8, COL_MOVIMIENTOS.length)
  COL_MOVIMIENTOS.forEach(([, t], i) => { const c = ejh.getCell(9, i + 1); c.value = t; c.font = { bold: true } })
  const ejemplosMov = [
    ['IMP-0001-2026', 1, 'REGISTRO', d('03/11/2026'), depEj, null, 5, 'Ingreso por mesa de partes'],
    ['IMP-0001-2026', 2, 'DERIVACION', d('04/11/2026'), dest2, 'PROVEÍDO N° 001-2026', 5, 'Para evaluación técnica'],
    ['IMP-0002-2026', 1, 'REGISTRO', d('06/10/2026'), depEj, null, 12, null],
    ['IMP-0002-2026', 2, 'DERIVACION', d('08/10/2026'), dest2, 'PROVEÍDO N° 002-2026', 12, null],
    ['IMP-0002-2026', 3, 'FINALIZACION', d('28/10/2026'), 'FINALIZADO', 'CERTIFICADO N° 010-2026', 12, 'APROBADO / PROCEDENTE'],
    ['IMP-0003-2026', 1, 'REGISTRO', d('20/10/2026'), depEj, null, 3, null],
    ['IMP-0003-2026', 2, 'OBSERVACION', d('27/10/2026'), null, 'NOTIFICACIÓN N° 005-2026', 3, 'Falta copia literal de dominio actualizada'],
  ]
  ejemplosMov.forEach((f, k) => f.forEach((v, i) => { const c = ejh.getCell(10 + k, i + 1); c.value = v; if (v instanceof Date) c.numFmt = 'dd/mm/yyyy' }))

  libro.views = [{ activeTab: 0 }]
  return Buffer.from(await libro.xlsx.writeBuffer())
}

module.exports = { generarPlantilla }
