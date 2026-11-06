// Pruebas de: importación de expedientes (plantilla, CSV y consolidado),
// deshacer, permisos, usuarios multi-departamento, usuarios por departamento
// y modo red.
//   node pruebas/prueba_importacion.js <semilla.db>
const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')
const { execFileSync } = require('child_process')
const ExcelJS = require('exceljs')
const { Sistema } = require('../electron/servicios/sistema')
const { despachar } = require('../electron/servicios/api')
const { BaseDatos } = require('../electron/bd')
const { ServidorRed, llamarRemoto } = require('../electron/servidorRed')
const { clasificarTramite, clasificarDestino } = require('../electron/motor/clasificacion')
const { parsearCsv } = require('../electron/servicios/lectorArchivos')
const seg = require('../electron/servicios/seguridad')

const semilla = process.argv[2]
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'urbanito-importacion-'))
const ruta = path.join(dir, 'urbanito.db')
fs.copyFileSync(semilla, ruta)
const HOY = '2026-11-05'
const MUESTRA = path.join(__dirname, 'datos', 'consolidado_muestra.xlsx')

let pasos = 0
const ok = (cond, msg) => { assert.ok(cond, msg); pasos++; console.log(`  ✓ ${msg}`) }
const b64 = (buf) => Buffer.from(buf).toString('base64')

;(async () => {
  const mtimeSemilla = fs.statSync(semilla).mtimeMs

  console.log('Clasificador JS (port de los catálogos Python) contra la base inicial')
  {
    const bd = await BaseDatos.abrir(semilla)
    let n = 0, mal = 0
    for (const e of bd.todas('SELECT asunto, procedimiento_codigo p FROM expedientes')) { n++; if (clasificarTramite(e.asunto) !== e.p) mal++ }
    ok(n > 50000 && mal === 0, `trámites: ${n} expedientes clasificados igual que preparar_semilla.py`)
    n = 0; mal = 0
    for (const m of bd.todas('SELECT destino_texto t, destino_tipo ti, destino_codigo co, destino_nombre no FROM movimientos')) {
      n++
      const r = clasificarDestino(m.t)
      if (r.tipo !== m.ti || (r.codigo || null) !== (m.co || null) || (r.nombre || null) !== (m.no || null)) mal++
    }
    ok(n > 100000 && mal === 0, `destinos: ${n} movimientos clasificados igual que preparar_semilla.py`)
    bd.cerrar()
  }
  {
    const f = parsearCsv('﻿a;b;c\n"x;1";"di""jo";\r\n2;;"multi\nlinea"\n')
    ok(f.length === 3 && f[1][0] === 'x;1' && f[1][1] === 'di"jo' && f[2][2] === 'multi\nlinea', 'CSV: comillas, ; dentro de comillas, comillas dobles y saltos de línea')
    ok(parsearCsv('a,b\n1,2')[1][1] === '2', 'CSV: separador coma detectado')
  }

  console.log('\nMigración de esquema')
  const s = new Sistema({ rutaBd: ruta, carpetaRespaldos: null, fechaFija: HOY })
  await s.iniciar()
  ok(s.migraciones.includes('expedientes.importacion_id') && s.migraciones.includes('movimientos.importacion_id'),
     `la base inicial se migra al abrir (${s.migraciones.join(', ')})`)
  ok(!!s.bd.una("SELECT name FROM sqlite_master WHERE name = 'importaciones'") && !!s.bd.una("SELECT name FROM sqlite_master WHERE name = 'usuario_departamentos'"),
     'existen las tablas importaciones y usuario_departamentos')
  ok(s.bd.migrar().length === 0, 'la migración es idempotente (segunda vez no cambia nada)')
  const iuaInicial = s.r.iua.size

  const api = (accion, datos, token) => despachar(s, accion, datos, token)
  const exito = async (accion, datos, token) => {
    const r = await api(accion, datos, token)
    if (!r.ok) throw new Error(`${accion} falló: ${r.error}`)
    return r.datos
  }
  const falla = async (accion, datos, token) => {
    const r = await api(accion, datos, token)
    assert.ok(!r.ok, `${accion} debía fallar`)
    return r
  }

  console.log('\nUsuarios por departamento (configuración inicial)')
  const conf = await exito('configuracion_inicial', { nombre_completo: 'Administrador General', usuario: 'admin', clave: 'Urbanito2026', crear_por_departamento: true })
  ok(conf.usuarios_demo.length === 24, 'crea 22 cuentas de departamento + gerente + mesa de partes')
  ok(conf.usuarios_demo.some(c => c.usuario === 'jefe.ocupvia') && conf.usuarios_demo.some(c => c.usuario === 'tecnico.compatuso'), 'usa las claves numeracion … ocupvia')
  ok(conf.usuarios_demo.every(c => !seg.validarClaveNueva(c.clave_temporal)), 'todas las claves temporales cumplen la política')
  ok(new Set(conf.usuarios_demo.map(c => c.clave_temporal)).size === 24, 'no hay dos claves temporales iguales')
  ok(s.bd.una("SELECT COUNT(*) n FROM usuarios WHERE debe_cambiar_clave = 1").n === 24, 'todas deben cambiar la clave al ingresar')
  ok(s.bd.una("SELECT COUNT(*) n FROM auditoria WHERE accion = 'CREAR_USUARIO' AND detalle LIKE '%\"lote\"%'").n === 24, 'se audita CREAR_USUARIO por cada cuenta, con el lote')
  ok(s.bd.una("SELECT nombre_completo n FROM usuarios WHERE usuario = 'jefe.numeracion'").n === 'Jefe del Departamento de Numeración Municipal', 'nombres genéricos editables')
  const clave = Object.fromEntries(conf.usuarios_demo.map(c => [c.usuario, c.clave_temporal]))
  const adm = (await exito('login', { usuario: 'admin', clave: 'Urbanito2026' })).token
  const ingresar = async (u) => {
    const r = await exito('login', { usuario: u, clave: clave[u] })
    await exito('cambiar_clave', { actual: clave[u], nueva: 'ClaveNueva2026' }, r.token)
    return r.token
  }
  const t = {}
  for (const u of ['gerente', 'mesa.partes', 'jefe.numeracion', 'tecnico.numeracion', 'jefe.licencias']) t[u] = await ingresar(u)
  const lote2 = await exito('crear_usuarios_departamento', {}, adm)
  ok(lote2.creados.length === 0 && lote2.omitidos.length === 24, 'crear usuarios por departamento es idempotente (0 creados, 24 omitidos)')
  ok((await falla('crear_usuarios_departamento', {}, t.gerente)).codigo === 'PERMISO', 'solo el administrador crea usuarios en lote')

  console.log('\nScript de consola herramientas/crear_usuarios_departamentos.js')
  {
    const otra = path.join(dir, 'otra.db')
    fs.copyFileSync(semilla, otra)
    const cred = path.join(dir, 'credenciales')
    const script = path.join(__dirname, '..', 'herramientas', 'crear_usuarios_departamentos.js')
    const salida1 = execFileSync(process.execPath, [script, otra, cred], { encoding: 'utf8' })
    const s3 = await BaseDatos.abrir(otra)
    ok(s3.una('SELECT COUNT(*) n FROM usuarios').n === 25, 'en una base sin usuarios crea también admin (25 cuentas)')
    ok(s3.una("SELECT COUNT(*) n FROM usuarios WHERE rol = 'ADMINISTRADOR' AND debe_cambiar_clave = 1").n === 1, 'el admin creado por el script también debe cambiar su clave')
    s3.cerrar()
    ok(fs.readdirSync(cred).some(f => /^credenciales_.*\.xlsx$/.test(f)) && salida1.includes('Credenciales guardadas'), 'guarda las credenciales en un Excel fuera de semilla/')
    const salida2 = execFileSync(process.execPath, [script, otra, cred], { encoding: 'utf8' })
    ok(salida2.includes('No se creó ninguna cuenta'), 'segunda ejecución: omite todo e informa')
    let rechazo = false
    try { execFileSync(process.execPath, [script, path.join(__dirname, '..', 'semilla', 'urbanito.db')], { stdio: 'pipe' }) } catch (_) { rechazo = true }
    ok(rechazo, 'el script se niega a modificar semilla/urbanito.db')
  }

  console.log('\nPermisos de importación')
  ok((await falla('importar_previsualizar', { archivos: [] }, t['tecnico.numeracion'])).codigo === 'PERMISO', 'TECNICO no importa')
  ok((await falla('plantilla_importacion', {}, t['tecnico.numeracion'])).codigo === 'PERMISO', 'TECNICO no descarga la plantilla')
  ok((await falla('plantilla_importacion', { departamento: 'DEP_LICENCIAS_EDIF' }, t['jefe.numeracion'])).codigo === 'PERMISO', 'el jefe de Numeración no elige otro departamento')
  const depsJefe = await exito('importar_departamentos', {}, t['jefe.numeracion'])
  ok(depsJefe.length === 1 && depsJefe[0].codigo === 'DEP_NUMERACION', 'el selector del jefe muestra solo su departamento')
  ok((await exito('importar_departamentos', {}, t['mesa.partes'])).length === 11, 'mesa de partes puede importar para los 11 departamentos')

  console.log('\nPlantilla única (Parte 2)')
  const pl = await exito('plantilla_importacion', { departamento: 'DEP_NUMERACION' }, t['jefe.numeracion'])
  ok(pl.nombre_archivo.includes('Numeración Municipal'), `el nombre del archivo lleva el departamento (${pl.nombre_archivo})`)
  const libroPl = new ExcelJS.Workbook()
  await libroPl.xlsx.load(Buffer.from(pl.base64, 'base64'))
  ok(['INSTRUCCIONES', 'CATALOGOS', 'EXPEDIENTES', 'MOVIMIENTOS', 'EJEMPLO'].every(n => libroPl.getWorksheet(n)), 'hojas INSTRUCCIONES, EXPEDIENTES, MOVIMIENTOS, CATÁLOGOS y EJEMPLO')
  const cat = libroPl.getWorksheet('CATALOGOS')
  const codigos = []; cat.getColumn(1).eachCell((c, r) => { if (r > 1 && c.value) codigos.push(c.value) })
  ok(codigos.length === 1 && codigos[0] === 'NUM_PREDIAL', 'con un departamento elegido, la lista de procedimientos se limita a los suyos')
  ok(!!cat.sheetProtection, 'la hoja CATÁLOGOS está protegida')
  const expH = libroPl.getWorksheet('EXPEDIENTES')
  ok(expH.getRow(1).values.includes('N° EXPEDIENTE*') && expH.getRow(1).values.includes('CÓDIGO PROCEDIMIENTO*'), 'encabezados fijos con asterisco de obligatorio')
  const xml = JSON.stringify(expH.dataValidations.model)
  ok(xml.includes('CATALOGOS!$A$2') && xml.includes('"whole"') && xml.includes('"date"') && xml.includes('textLength'), 'validación de datos: listas, enteros, fechas y longitudes')
  ok(expH.views[0].state === 'frozen', 'encabezados congelados')
  ok(String(libroPl.getWorksheet('INSTRUCCIONES').getCell('B3').value).includes('Numeración Municipal'), 'INSTRUCCIONES nombra el departamento')
  const plGen = await exito('plantilla_importacion', {}, adm)
  const lg = new ExcelJS.Workbook(); await lg.xlsx.load(Buffer.from(plGen.base64, 'base64'))
  let nProc = 0; lg.getWorksheet('CATALOGOS').getColumn(1).eachCell((c, r) => { if (r > 1 && c.value) nProc++ })
  ok(nProc > 20, `sin departamento elegido, el administrador recibe todos los procedimientos activos (${nProc})`)

  // ---------- plantilla llena con los 3 ejemplos
  const llenar = async (exps, movs) => {
    const w = new ExcelJS.Workbook(); await w.xlsx.load(Buffer.from(pl.base64, 'base64'))
    exps.forEach((f, i) => { w.getWorksheet('EXPEDIENTES').getRow(i + 2).values = f })
    movs.forEach((f, i) => { w.getWorksheet('MOVIMIENTOS').getRow(i + 2).values = f })
    return [{ nombre: 'plantilla_llena.xlsx', base64: b64(await w.xlsx.writeBuffer()) }]
  }
  const ej = libroPl.getWorksheet('EJEMPLO')
  const filasEj = (desde, hasta) => { const r = []; for (let i = desde; i <= hasta; i++) r.push(ej.getRow(i).values.slice(1)); return r }
  const archivoValido = await llenar(filasEj(3, 5), filasEj(10, 16))

  console.log('\nImportar una plantilla pequeña válida')
  const pv = await exito('importar_previsualizar', { departamento: 'DEP_NUMERACION', archivos: archivoValido }, t['jefe.numeracion'])
  ok(pv.formato === 'PLANTILLA' && pv.totales.nuevos === 3 && pv.totales.movimientos === 7 && pv.totales.filas_con_error === 0,
     'vista previa: 3 expedientes nuevos, 7 movimientos, 0 errores')
  ok(s.bd.una("SELECT COUNT(*) n FROM expedientes WHERE sistema = 'IMPORTADO'").n === 0, 'la vista previa no guarda nada')
  ok(s.bd.una("SELECT COUNT(*) n FROM auditoria WHERE accion = 'IMPORTAR_PREVISUALIZAR'").n === 1, 'la vista previa queda en la auditoría')
  const imp1 = await exito('importar_confirmar', { departamento: 'DEP_NUMERACION', archivos: archivoValido }, t['jefe.numeracion'])
  ok(imp1.expedientes_creados === 3 && imp1.movimientos_creados === 7, 'importa N = 3 expedientes y M = 7 movimientos')
  const nuevos = s.bd.todas('SELECT * FROM expedientes WHERE importacion_id = ?', [imp1.importacion_id])
  ok(nuevos.every(e => e.sistema === 'IMPORTADO' && e.importado === 1), "sistema = 'IMPORTADO' e importado = 1")
  ok(s.bd.una('SELECT COUNT(*) n FROM movimientos WHERE importacion_id = ?', [imp1.importacion_id]).n === 7, 'los movimientos llevan importacion_id')
  const porNum = Object.fromEntries(nuevos.map(e => [e.numero, e]))
  ok(porNum['IMP-0001-2026'].estado === 'EN_TRAMITE' && porNum['IMP-0002-2026'].estado === 'FINALIZADO' && porNum['IMP-0003-2026'].estado === 'OBSERVADO',
     'estados explícitos: en trámite, finalizado y observado')
  ok(porNum['IMP-0002-2026'].fecha_cierre === '2026-10-28', 'el finalizado conserva su fecha de cierre')
  ok(s.r.iua.size === iuaInicial + 2 && s.r.iua.has(porNum['IMP-0001-2026'].id) && s.r.iua.has(porNum['IMP-0003-2026'].id),
     'se recalcula el IUA: los 2 activos importados ya tienen índice')
  const bj = await exito('bandeja', {}, t['jefe.numeracion'])
  ok(bj.filas.some(f => f.numero === 'IMP-0001-2026'), 'el expediente importado aparece en la bandeja del jefe')
  ok(s.bd.una("SELECT COUNT(*) n FROM auditoria WHERE accion = 'IMPORTAR_CONFIRMAR' AND entidad_id = ?", [String(imp1.importacion_id)]).n === 1, 'IMPORTAR_CONFIRMAR auditado con el lote')

  console.log('\nReimportar el mismo archivo')
  const imp2 = await exito('importar_confirmar', { departamento: 'DEP_NUMERACION', archivos: archivoValido }, t['jefe.numeracion'])
  ok(imp2.expedientes_creados === 0 && imp2.expedientes_omitidos === 3, '0 creados y 3 omitidos')

  console.log('\nArchivo con errores')
  const archivoErrores = await llenar([
    ['IMP-0100-2026', '01/11/2026', 'VALIDO PRIMERO ANA', '40111222', null, null, 'NUM_PREDIAL', null, 2, null, null, 'EN_TRAMITE'],
    ['IMP-0101-2026', '15/12/2026', 'FECHA FUTURA LUIS', '40111223', null, null, 'NUM_PREDIAL', null, 1, null, null, 'EN_TRAMITE'],
    ['IMP-0102-2026', '02/11/2026', 'OTRO DEPARTAMENTO SAC', '20111222333', null, null, 'LIC_EDIFICACION', null, 3, null, null, 'EN_TRAMITE'],
    ['IMP-0103-2026', '02/11/2026', 'DUPLICADO UNO', '40111224', null, null, 'NUM_PREDIAL', null, 1, null, null, 'EN_TRAMITE'],
    ['IMP-0103-2026', '03/11/2026', 'DUPLICADO DOS', '40111224', null, null, 'NUM_PREDIAL', null, 1, null, null, 'EN_TRAMITE'],
    ['IMP-0104-2026', '02/11/2026', 'DNI MALO PEDRO', '1234', null, null, 'NUM_PREDIAL', null, 1, null, null, 'EN_TRAMITE'],
    ['IMP-0105-2026', '02/11/2026', 'SEGUNDO VALIDO', '40111225', null, null, 'Certificado de numeración municipal', null, 1, null, null, 'EN_TRAMITE'],
  ], [
    ['IMP-0100-2026', 1, 'REGISTRO', '01/11/2026', 'DEP_NUMERACION'],
    ['IMP-0100-2026', 2, 'DERIVADO', '03/11/2026', 'jefe.numeracion'],
    ['IMP-0105-2026', 1, 'REGISTRO', '2026-11-02', 'OFICINA INVENTADA XYZ'],
  ])
  const pe = await exito('importar_previsualizar', { departamento: 'DEP_NUMERACION', archivos: archivoErrores }, t['jefe.numeracion'])
  const motivo = (num) => pe.errores.filter(e => e.numero === num || (num === null && !e.numero)).map(e => `${e.columna}: ${e.motivo}`).join(' | ')
  ok(motivo('IMP-0102-2026').includes('CÓDIGO PROCEDIMIENTO') && motivo('IMP-0102-2026').includes('Licencias de Edificación') && motivo('IMP-0102-2026').includes('NUM_PREDIAL'),
     'procedimiento de otro departamento: error con motivo y sugerencia de códigos válidos')
  ok(motivo('IMP-0103-2026').includes('datos de cabecera distintos'), 'número repetido con datos distintos: error de fila')
  ok(motivo('IMP-0104-2026').startsWith('DNI / RUC / CE'), 'DNI inválido: error en la columna DNI / RUC / CE')
  ok(pe.errores.every(e => e.fila >= 2 && e.hoja && e.columna), 'cada error trae hoja, fila del Excel y columna')
  ok(pe.advertencias.some(a => a.numero === 'IMP-0101-2026' && a.motivo.includes('posterior a hoy')), 'fecha futura: se avisa')
  ok(pe.advertencias.some(a => a.numero === 'IMP-0105-2026' && a.motivo.includes('SIN DATO')), 'destino no reconocido: advertencia, no error')
  ok(pe.totales.nuevos === 3 && pe.totales.filas_con_error === 3, 'quedan 3 válidos (uno con fecha futura) y 3 filas con error')
  ok((await falla('importar_confirmar', { departamento: 'DEP_NUMERACION', archivos: archivoErrores }, t['jefe.numeracion'])).error.includes('filas válidas'),
     'sin «importar solo las filas válidas» no se importa nada')
  const impE = await exito('importar_confirmar', { departamento: 'DEP_NUMERACION', archivos: archivoErrores, solo_validas: true }, t['jefe.numeracion'])
  ok(impE.expedientes_creados === 3, 'con «solo las filas válidas» pasan las 3 válidas')
  const fut = s.bd.una("SELECT fecha_invalida f FROM expedientes WHERE numero = 'IMP-0101-2026'")
  ok(fut.f === 1 && !s.r.iua.get(s.bd.una("SELECT id FROM expedientes WHERE numero = 'IMP-0101-2026'").id).dias, 'la fecha futura se guarda con fecha_invalida = 1 y no entra a los cálculos')
  const dv = s.bd.una("SELECT destino_tipo t, destino_texto x FROM movimientos m JOIN expedientes e ON e.id = m.expediente_id WHERE e.numero = 'IMP-0105-2026'")
  ok(dv.t === 'SIN DATO' && dv.x === 'OFICINA INVENTADA XYZ', 'destino desconocido: SIN DATO con el texto original')
  const d100 = s.bd.una("SELECT m.tipo, m.destino_tipo FROM movimientos m JOIN expedientes e ON e.id = m.expediente_id WHERE e.numero = 'IMP-0100-2026' AND m.orden = 2")
  ok(d100.tipo === 'DERIVACION' && d100.destino_tipo === 'USUARIO', 'DERIVADO se convierte en DERIVACION y el destino se resuelve a un usuario')

  console.log('\nCSV (un archivo por tabla)')
  const csvExp = '﻿N° EXPEDIENTE*;FECHA INGRESO*;SOLICITANTE*;DNI / RUC / CE*;TELÉFONO;DIRECCIÓN / UBICACIÓN;CÓDIGO PROCEDIMIENTO*;ASUNTO;FOLIOS*;N° RECIBO;MONTO S/.;ESTADO*\n' +
    'CSV-001-2026;04/11/2026;"PEREZ; LUNA ""EL ARQUI""";40999888;;"JR. PUNO 10";NUM_PREDIAL;;4;R-1;12.5;EN_TRAMITE\n'
  const csvMov = 'N° EXPEDIENTE*;N° MOV*;TIPO MOV*;FECHA MOV*;DESTINO (unidad / departamento / usuario);DOCUMENTO;FOLIOS MOV;OBSERVACIÓN MOV\n' +
    'CSV-001-2026;1;REGISTRO;2026-11-04;DEP_NUMERACION;;4;\n'
  const impC = await exito('importar_confirmar', { archivos: [{ nombre: 'exp.csv', base64: b64(csvExp) }, { nombre: 'mov.csv', base64: b64(csvMov) }] }, t['mesa.partes'])
  const ec = s.bd.una("SELECT solicitante, recibo_monto FROM expedientes WHERE numero = 'CSV-001-2026'")
  ok(impC.expedientes_creados === 1 && ec.solicitante === 'PEREZ; LUNA "EL ARQUI"' && ec.recibo_monto === 12.5, 'mesa de partes importa dos CSV con BOM, ; y comillas')
  ok((await falla('importar_previsualizar', { archivos: [{ nombre: 'virus.exe', base64: b64('MZ') }] }, adm)).error.includes('.xlsx o .csv'), 'rechaza extensiones no permitidas')
  ok((await falla('importar_previsualizar', { archivos: [{ nombre: 'falso.xlsx', base64: b64('hola') }] }, adm)).error.includes('no es un libro de Excel'), 'valida el contenido, no solo la extensión')

  console.log('\nDeshacer un lote')
  ok((await falla('importar_deshacer', { id: impE.importacion_id }, t.gerente)).codigo === 'PERMISO', 'otro usuario (no administrador) no puede deshacer el lote ajeno')
  const des = await exito('importar_deshacer', { id: impE.importacion_id }, t['jefe.numeracion'])
  ok(des.expedientes_borrados === 3 && s.bd.una('SELECT COUNT(*) n FROM expedientes WHERE importacion_id = ?', [impE.importacion_id]).n === 0,
     'deshacer borra solo lo creado por el lote')
  ok(s.bd.una("SELECT estado FROM importaciones WHERE id = ?", [impE.importacion_id]).estado === 'DESHECHO' &&
     s.bd.una("SELECT COUNT(*) n FROM auditoria WHERE accion = 'IMPORTAR_DESHACER'").n === 1, 'el lote queda DESHECHO y se audita')
  ok(s.bd.una("SELECT COUNT(*) n FROM expedientes WHERE importacion_id = ?", [imp1.importacion_id]).n === 3, 'los otros lotes no se tocan')
  ok((await falla('importar_deshacer', { id: impE.importacion_id }, adm)).error.includes('ya fue deshecha'), 'no se deshace dos veces')
  // un usuario trabaja sobre un expediente importado: ya no se puede deshacer
  const e1 = porNum['IMP-0001-2026']
  const destinoTec = s.bd.una("SELECT id FROM usuarios WHERE usuario = 'tecnico.numeracion'").id
  const destinoJefe = s.bd.una("SELECT id FROM usuarios WHERE usuario = 'jefe.numeracion'").id
  await exito('derivar', { id: e1.id, destino: { tipo: 'USUARIO', codigo: String(e1.ubicacion_codigo) === String(destinoTec) ? destinoJefe : destinoTec }, fecha: HOY }, t['jefe.numeracion'])
  ok((await falla('importar_deshacer', { id: imp1.importacion_id }, adm)).error.includes('ya tienen movimientos'), 'no se deshace si un expediente del lote tiene movimientos hechos en el programa')
  const hist = await exito('importaciones', {}, t['jefe.numeracion'])
  ok(hist.length >= 3 && hist.find(h => h.id === imp1.importacion_id).puede_deshacer, 'historial de importaciones anteriores')

  console.log('\nFormato consolidado (SGCUC / SGAU) — autodetección')
  const bufMuestra = fs.readFileSync(MUESTRA)
  const pc = await exito('importar_previsualizar', { archivos: [{ nombre: 'consolidado_muestra.xlsx', base64: b64(bufMuestra) }] }, adm)
  ok(pc.formato === 'CONSOLIDADO' && pc.aviso_formato.includes('consolidado detectado'), 'detecta el formato consolidado por los encabezados')
  ok(pc.fecha_corte === '2026-10-16', 'misma fecha de corte que la base inicial (2026-10-16)')
  ok(pc.totales.duplicados > 250 && pc.totales.duplicados >= pc.totales.expedientes_validos - 5, `lo ya cargado en la base inicial se detecta como duplicado (${pc.totales.duplicados})`)
  // paridad: se borran esos expedientes de la copia y se reimportan desde el consolidado
  const claves = s.bd.todas("SELECT id, sistema, numero FROM expedientes WHERE importado = 1 AND importacion_id IS NULL")
  const enMuestra = new Set()
  const lm = new ExcelJS.Workbook(); await lm.xlsx.load(bufMuestra)
  for (const [hoja, col] of [['SGCUC', 'EXPEDIENTE RUT'], ['SGAU', 'EXPEDIENTE']]) {
    const ws = lm.getWorksheet(hoja); const c = ws.getRow(1).values.indexOf(col)
    ws.eachRow((r, i) => { if (i > 1 && r.getCell(c).value) enMuestra.add(`${hoja}|${String(r.getCell(c).value).trim().toUpperCase()}`) })
  }
  const borrar = claves.filter(x => enMuestra.has(`${x.sistema}|${x.numero}`))
  const antes = new Map(borrar.map(x => [`${x.sistema}|${x.numero}`, s.bd.una('SELECT procedimiento_codigo, estado, fecha_cierre, ubicacion_tipo, ubicacion_codigo, fecha_ingreso, fecha_invalida FROM expedientes WHERE id = ?', [x.id])]))
  s.bd.transaccion(() => {
    for (const x of borrar) { s.bd.ejecutar('DELETE FROM movimientos WHERE expediente_id = ?', [x.id]); s.bd.ejecutar('DELETE FROM expedientes WHERE id = ?', [x.id]) }
  })
  s.cargar()
  const impK = await exito('importar_confirmar', { archivos: [{ nombre: 'consolidado_muestra.xlsx', base64: b64(bufMuestra) }], solo_validas: true }, adm)
  let iguales = 0, creados = 0, excluidos = 0
  const conConflicto = new Set(pc.errores.filter(e => e.motivo.includes('cabecera distintos')).map(e => e.numero))
  for (const [k, a] of antes) {
    const [sis, num] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)]
    const d = s.bd.una('SELECT procedimiento_codigo, estado, fecha_cierre, ubicacion_tipo, ubicacion_codigo, fecha_ingreso, fecha_invalida FROM expedientes WHERE sistema = ? AND numero = ?', [sis, num])
    if (!d) { if (conConflicto.has(num)) excluidos++; continue }
    creados++
    if (JSON.stringify(d) === JSON.stringify(a)) iguales++
  }
  ok(creados > 250 && iguales === creados, `reimportados ${iguales}/${creados} expedientes idénticos a la base inicial (trámite, estado, cierre y ubicación)`)
  ok(creados + excluidos === borrar.length, `los ${excluidos} restantes se rechazan por número repetido con cabecera distinta (regla de la importación)`)
  const pj = await exito('importar_previsualizar', { archivos: [{ nombre: 'consolidado_muestra.xlsx', base64: b64(bufMuestra) }] }, t['jefe.numeracion'])
  ok(pj.totales.filas_con_error > 0 && pj.errores.some(e => e.motivo.includes('aquí solo se importan trámites de Departamento de Numeración Municipal')),
     'el jefe de Numeración no importa procedimientos de otros departamentos del consolidado')

  console.log('\nUsuarios multi-departamento')
  const idJefe = destinoJefe
  ok((await falla('editar_usuario', { id: s.bd.una("SELECT id FROM usuarios WHERE usuario='gerente'").id, departamentos: ['DEP_NUMERACION', 'DEP_TELECOM'] }, adm)).error.includes('más de un departamento'),
     'solo jefes y técnicos pueden tener varios departamentos')
  await exito('editar_usuario', { id: idJefe, departamento_codigo: 'DEP_NUMERACION', departamentos: ['DEP_NUMERACION', 'DEP_VISADO_PLANOS'] }, adm)
  ok(s.bd.una('SELECT COUNT(*) n FROM usuario_departamentos WHERE usuario_id = ?', [idJefe]).n === 2 &&
     s.usuarios.get(idJefe).departamento_codigo === 'DEP_NUMERACION', 'se guardan 2 departamentos, con Numeración como principal')
  const ses = await exito('sesion', {}, t['jefe.numeracion'])
  ok(ses.departamentos.length === 2 && ses.departamentos_elegibles.length === 2, 'la sesión informa los 2 departamentos para el selector')
  const b2 = await exito('bandeja', {}, t['jefe.numeracion'])
  const depsVistos = new Set(b2.filas.map(f => f.departamento_codigo))
  ok(depsVistos.has('DEP_NUMERACION') && depsVistos.has('DEP_VISADO_PLANOS'), `el jefe con 2 departamentos ve ambos en su bandeja (${b2.filas.length})`)
  const visado = b2.filas.find(f => f.departamento_codigo === 'DEP_VISADO_PLANOS' && f.estado === 'EN_TRAMITE')
  await exito('observar', { id: visado.id, observacion: 'Falta plano de ubicación firmado por profesional', fecha: HOY }, t['jefe.numeracion'])
  ok(s.almacen.expedientes.get(visado.id).estado === 'OBSERVADO', 'y actúa sobre un expediente de su segundo departamento')
  const licencia = [...s.almacen.expedientes.values()].find(e => e.estado === 'EN_TRAMITE' && s.departamentoDe(e) === 'DEP_LICENCIAS_EDIF' &&
    !s.delDepartamento(e, new Set(['DEP_NUMERACION', 'DEP_VISADO_PLANOS'])))
  ok((await falla('observar', { id: licencia.id, observacion: 'Intento fuera de su alcance', fecha: HOY }, t['jefe.numeracion'])).codigo === 'PERMISO',
     'NO puede actuar sobre un tercer departamento')
  const soloVisado = await exito('bandeja', { departamento_activo: 'DEP_VISADO_PLANOS' }, t['jefe.numeracion'])
  ok(soloVisado.filas.length > 0 && soloVisado.filas.length < b2.filas.length && soloVisado.filas.every(f => s.delDepartamento(s.almacen.expedientes.get(f.id), new Set(['DEP_VISADO_PLANOS']))),
     '«departamento activo» filtra la bandeja a uno de sus departamentos')
  ok((await falla('bandeja', { departamento_activo: 'DEP_LICENCIAS_EDIF' }, t['jefe.numeracion'])).codigo === 'PERMISO', 'no puede activar un departamento ajeno')
  ok((await falla('importar_previsualizar', { departamento: 'DEP_LICENCIAS_EDIF', archivos: archivoValido }, t['jefe.numeracion'])).codigo === 'PERMISO',
     'tampoco importar en un departamento ajeno')
  ok((await exito('importar_departamentos', {}, t['jefe.numeracion'])).length === 2, 'el selector de importación muestra sus 2 departamentos')
  const tabJ = await exito('tablero', {}, t['jefe.numeracion'])
  ok(tabJ.departamentos.length === 2 && tabJ.por_departamento.length >= 2, 'el tablero del jefe resume sus 2 departamentos')
  ok((await falla('tablero', { departamento: 'DEP_TELECOM' }, t['jefe.numeracion'])).codigo === 'PERMISO', 'el tablero no muestra un departamento ajeno')
  ok((await exito('departamentos', {}, t['jefe.numeracion'])).length === 2, 'la pantalla Departamentos muestra los 2')
  const tabG = await exito('tablero', { departamento_activo: 'DEP_TELECOM' }, t.gerente)
  ok(tabG.departamento === 'DEP_TELECOM', 'el gerente puede elegir cualquier departamento activo')
  const tecId = destinoTec
  await exito('editar_usuario', { id: tecId, departamentos: ['DEP_NUMERACION', 'DEP_ZONIFICACION'] }, adm)
  ok(s.usuarios.get(tecId).departamentos.length === 2 && s.usuarios.get(tecId).departamento_codigo === 'DEP_NUMERACION', 'un técnico también puede tener 2 departamentos')

  console.log('\nModo red (cliente → servidor)')
  const red = new ServidorRed(s, () => {})
  const puerto = 7400 + Math.floor(Math.random() * 400)
  await red.iniciar(puerto)
  const url = `http://127.0.0.1:${puerto}`
  try {
    const rr = await llamarRemoto(url, 'importar_previsualizar', { departamento: 'DEP_NUMERACION', archivos: archivoValido }, t['jefe.numeracion'])
    ok(rr.ok && rr.datos.totales.duplicados === 3, 'la vista previa funciona en red (el archivo viaja al servidor)')
    const rt = await llamarRemoto(url, 'importar_previsualizar', { archivos: archivoValido }, t['tecnico.numeracion'])
    ok(!rt.ok && rt.codigo === 'PERMISO', 'los permisos se verifican en el servidor')
    const rp = await llamarRemoto(url, 'plantilla_importacion', { departamento: 'DEP_NUMERACION' }, t['jefe.numeracion'])
    ok(rp.ok && rp.datos.base64.length > 1000, 'la plantilla se descarga desde el servidor')
    const grande = await fetch(`${url}/urbanito/api`, { method: 'POST', body: 'x'.repeat(3 * 1024 * 1024) }).then(r => r.status).catch(() => 413)
    ok(grande === 413, 'el canal normal mantiene su límite de 2 MB')
    const otra = await fetch(`${url}/urbanito/importar`, { method: 'POST', body: JSON.stringify({ accion: 'usuarios' }) }).then(r => r.status)
    ok(otra === 400, 'el canal de archivos solo acepta acciones de importación')
  } finally {
    await red.detener()
  }

  s.detener()
  ok(fs.statSync(semilla).mtimeMs === mtimeSemilla, 'semilla/urbanito.db no se modificó')
  console.log(`\n${pasos} verificaciones superadas`)
  fs.rmSync(dir, { recursive: true, force: true })
})().catch(err => {
  console.error('\nFALLÓ:', err.message)
  console.error(err.stack)
  process.exit(1)
})
