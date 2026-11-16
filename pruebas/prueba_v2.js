// Pruebas de la v2: importador del Control 2026, Modelo 3 (MILP de asignación),
// notificaciones, reportes semanales, recepción, mejoras, portal ciudadano y red.
//   node pruebas/prueba_v2.js <semilla.db>
// El Control 2026 se genera aquí con la misma estructura que el archivo real
// (el real contiene datos personales y no se guarda en el repositorio).
const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')
const ExcelJS = require('exceljs')
const { Sistema } = require('../electron/servicios/sistema')
const { despachar } = require('../electron/servicios/api')
const { ServidorRed } = require('../electron/servidorRed')
const { resolverMilp, resolverVoraz, calcularEficiencia, scoreEficiencia, EIJ_SIN_HISTORIAL } = require('../electron/motor/asignacion')
const { generarCredenciales } = require('../electron/servicios/portalCiudadano')
const { semanaIso, diaSemana } = require('../electron/servicios/notificaciones')

const semilla = process.argv[2]
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'urbanito-v2-'))
const ruta = path.join(dir, 'urbanito.db')
fs.copyFileSync(semilla, ruta)
const HOY = '2026-11-12'                 // jueves
const CLAVE = 'Prueba2026'

let pasos = 0
const ok = (cond, msg) => { assert.ok(cond, msg); pasos++; console.log(`  ✓ ${msg}`) }
const b64 = (buf) => Buffer.from(buf).toString('base64')
const d = (s) => new Date(`${s}T00:00:00Z`)

async function generarControl(filas, zip, incompletos) {
  const wb = new ExcelJS.Workbook()
  const r = wb.addWorksheet('Resumen'); r.addRow(['CONTROL DE EXPEDIENTES — AÑO 2026'])
  const c = wb.addWorksheet('Control 2026')
  c.addRow(['Fila Excel', 'Expediente / documento (Excel)', 'Referencia (RUT / RUC / EXP)', 'Solicitante', 'Tipo de trámite', 'Fecha de ingreso',
            'Última derivación (Excel)', 'Fecha de salida (ZIP)', 'Días transcurridos', 'Estado', 'Archivo de salida encontrado', 'Archivo ZIP',
            'Criterio de cruce', 'Observaciones'])
  for (const f of filas) c.addRow(f)
  const z = wb.addWorksheet('Documentos ZIP')
  z.addRow(['Archivo ZIP', 'Tipo de trámite (según ZIP)', 'Nombre del documento', 'Expediente / RUT detectado', 'Fecha de salida detectada', 'Fuente de fecha',
            'Estado del documento', 'Cruce con Excel 2026', 'Fila(s) Excel vinculadas', 'Método de cruce', 'Observación'])
  for (const f of zip) z.addRow(f)
  const i = wb.addWorksheet('Registros incompletos')
  i.addRow(['Fila Excel', 'Fecha de ingreso', 'Última derivación (Excel)', 'Observación'])
  for (const f of incompletos) i.addRow(f)
  return wb.xlsx.writeBuffer()
}

;(async () => {
  const mtimeSemilla = fs.statSync(semilla).mtimeMs

  console.log('Motor del Modelo 3 (MILP y heurística voraz)')
  {
    const p = { expedientes: [{ id: 1, w: 0.9, candidatos: [{ j: 1, e: 0.5 }, { j: 2, e: 0.8 }] }, { id: 2, w: 0.6, candidatos: [{ j: 2, e: 0.9 }] },
                              { id: 3, w: 0.5, candidatos: [{ j: 1, e: 0.4 }, { j: 2, e: 0.7 }] }],
                trabajadores: [{ j: 1, capacidad: 2 }, { j: 2, capacidad: 1 }], delta: 5 }
    const m = await resolverMilp(p)
    const v = resolverVoraz(p)
    ok(m.estado === 'OPTIMO' && m.restriccion_uno === 'Σⱼ xᵢⱼ = 1' && m.asignacion.size === 3, 'GLPK resuelve el MILP con Σⱼ xᵢⱼ = 1 (cada expediente a un trabajador)')
    ok(Math.abs(m.z - (0.9 * 0.5 + 0.6 * 0.9 + 0.5 * 0.4)) < 1e-9 && m.z > v.z, `el óptimo (Z=${m.z.toFixed(3)}) supera a la voraz (Z=${v.z.toFixed(3)})`)
    ok([...m.asignacion.values()].filter(j => j === 2).length <= 1, 'respeta la capacidad máxima (restricción 2)')
    ok(process.listeners('unhandledRejection').length === 0, 'GLPK no deja manejadores globales que tumben el programa')
    const p2 = { ...p, trabajadores: [{ j: 1, capacidad: 1 }, { j: 2, capacidad: 1 }] }
    const m2 = await resolverMilp(p2)
    ok(m2.restriccion_uno === 'Σⱼ xᵢⱼ ≤ 1' && m2.asignacion.size === 2 && m2.relajaciones.length === 1, 'con capacidad insuficiente se relaja a Σⱼ xᵢⱼ ≤ 1 y se informa')
    // equidad con δ = 0: la cota inferior coincide con la capacidad (fila fija GLP_FX)
    const p3 = { expedientes: [1, 2, 3, 4].map(i => ({ id: i, w: 1 - i / 10, candidatos: [{ j: 1, e: 0.9 }, { j: 2, e: 0.3 }] })),
                 trabajadores: [{ j: 1, capacidad: 2 }, { j: 2, capacidad: 2 }], delta: 0 }
    const m3 = await resolverMilp(p3)
    ok(m3.estado === 'OPTIMO' && m3.equidad && m3.relajaciones.length === 0 &&
       [...m3.asignacion.values()].filter(j => j === 1).length === 2, 'equidad estricta (δ = 0): 2 y 2 aunque uno sea más eficiente')
    const ef = calcularEficiencia([
      { usuario_id: 1, procedimiento_codigo: 'T', expediente_id: 1, dias_paso: 2, finalizo: true, a_tiempo: true },
      { usuario_id: 2, procedimiento_codigo: 'T', expediente_id: 2, dias_paso: 6, finalizo: true, a_tiempo: false },
    ], 2)
    const e1 = ef.get('1|T'), e2 = ef.get('2|T')
    ok(Math.abs(e1.velocidad_relativa - (1 - (2 / 4) / 2)) < 1e-9 && e1.tasa_finalizacion === 1 && e1.experiencia === 0.5,
       'eᵢⱼ: velocidad = 1 − r/2, tasa a tiempo y experiencia = atendidos/umbral')
    ok(Math.abs(e1.score_eij - (0.4 * 1 + 0.35 * 0.75 + 0.25 * 0.5)) < 1e-9 && e1.score_eij > e2.score_eij, 'eᵢⱼ = 0.40·tasa + 0.35·velocidad + 0.25·experiencia')
    ok(Math.abs(EIJ_SIN_HISTORIAL - scoreEficiencia({ tasa: 0.5, velocidad: 0.5, experiencia: 0 })) < 1e-12, 'sin historial: valores neutros')
  }

  console.log('\nPreparación')
  const s = new Sistema({ rutaBd: ruta, carpetaRespaldos: path.join(dir, 'respaldos'), fechaFija: HOY })
  await s.iniciar()
  ok(diaSemana(HOY) === 4 && semanaIso(HOY) === '2026-W46', `${HOY} es jueves de la semana ISO 2026-W46`)
  ok(fs.readdirSync(path.join(dir, 'respaldos')).some(f => f.startsWith('urbanito_automatico_')), 'respaldo automático diario al iniciar')
  const api = (accion, datos, token) => despachar(s, accion, datos, token)
  const exito = async (accion, datos, token) => { const r = await api(accion, datos, token); if (!r.ok) throw new Error(`${accion}: ${r.error} ${r.detalle || ''}`); return r.datos }
  const falla = async (accion, datos, token) => { const r = await api(accion, datos, token); if (r.ok) throw new Error(`${accion} debía fallar`); return r }
  const conf = await exito('configuracion_inicial', { nombre_completo: 'Administrador de prueba', usuario: 'admin', clave: CLAVE, crear_por_departamento: true })
  const adm = (await exito('login', { usuario: 'admin', clave: CLAVE })).token
  const t = {}
  for (const c of conf.usuarios_demo) {
    if (!['jefe.numeracion', 'tecnico.numeracion', 'mesa.partes', 'gerente', 'tecnico.parametros'].includes(c.usuario)) continue
    const tk = (await exito('login', { usuario: c.usuario, clave: c.clave_temporal })).token
    await exito('cambiar_clave', { actual: c.clave_temporal, nueva: CLAVE }, tk)
    t[c.usuario] = tk
  }
  const id = (u) => s.bd.una('SELECT id FROM usuarios WHERE usuario = ?', [u]).id
  // un técnico que cubre dos departamentos y con alias histórico (para eᵢⱼ)
  const alias = s.bd.una(`SELECT destino_codigo c, COUNT(*) n FROM movimientos m JOIN expedientes e ON e.id = m.expediente_id
                          WHERE m.destino_tipo = 'RESPONSABLE' AND e.procedimiento_codigo = 'NUM_PREDIAL' GROUP BY destino_codigo ORDER BY n DESC LIMIT 1`).c
  await exito('editar_usuario', { id: id('tecnico.numeracion'), departamentos: ['DEP_NUMERACION', 'DEP_PARAMETROS'], alias_historico: alias, capacidad_maxima: 4 }, adm)
  ok(s.usuarios.get(id('tecnico.numeracion')).departamentos.length === 2, `técnico de Numeración también cubre Parámetros (alias histórico ${alias})`)

  console.log('\nImportador del Control 2026 (conciliación)')
  const libres = s.bd.todas(`SELECT e.* FROM expedientes e WHERE e.sistema = 'SGAU' AND e.importado = 1 AND e.fecha_ingreso LIKE '2026-%'
    AND NOT EXISTS (SELECT 1 FROM movimientos m WHERE m.expediente_id = e.id AND m.importado = 0)`)
  const enTramite = libres.filter(e => e.estado === 'EN_TRAMITE').slice(0, 4)
  const cerrados = libres.filter(e => e.estado === 'CERRADO_HISTORICO').slice(0, 3)
  const fila = (n, e, estado, salida = null, archivo = null) => [n, e.numero, null, e.solicitante, 'NUMERACION MUNICIPAL', d(e.fecha_ingreso), null,
    salida ? d(salida) : null, 10, estado, archivo, archivo ? 'NUMERACION.zip' : null, archivo ? 'ID expediente/RUT' : null, null]
  const salidaDe = (e) => (e.fecha_ingreso < '2026-10-01' ? '2026-10-20' : HOY)
  const filas = [
    fila(3, enTramite[0], 'FINALIZADO', salidaDe(enTramite[0]), 'CERT. NUMERACION 001-2026.docx'),
    fila(4, enTramite[1], 'FINALIZADO', null, null),                          // documento y fecha vienen de la hoja ZIP
    fila(5, enTramite[2], 'PENDIENTE'),                                       // ya en trámite → se omite
    fila(6, cerrados[0], 'PENDIENTE'), fila(7, cerrados[1], 'PENDIENTE'),     // cerrados por inactividad → se reabren
    [8, 'CTRL-NUEVO-1', null, 'PEREZ QUISPE ANA', 'NUMERACION MUNICIPAL', d('2026-09-01'), null, null, 70, 'PENDIENTE', null, null, null, null],
    [9, 'CTRL-NUEVO-2', null, 'MAMANI COA LUIS', 'PARAMETROS URBANISTICOS', d('2026-08-03'), null, d('2026-08-20'), 17, 'FINALIZADO', 'PARAM 77.docx', 'PARAM.zip', 'ID expediente/RUT', null],
    [10, 'CTRL-2025-1', null, 'COPA RUIZ', 'NUMERACION MUNICIPAL', d('2025-12-01'), null, null, 300, 'PENDIENTE', null, null, null, null],
  ]
  const zip = [['NUMERACION.zip', 'NUMERACION', 'CERT. NUMERACION 002-2026.docx', enTramite[1].numero, d(salidaDe(enTramite[1])), 'última página', 'FINALIZADO', 'SÍ', '4', 'ID expediente/RUT', null]]
  const incompletos = [[5492, d('2026-08-11'), null, 'Fila sin expediente/documento, referencia, solicitante ni tipo de trámite.']]
  const buf = await generarControl(filas, zip, incompletos)
  const archivo = [{ nombre: 'CONTROL_EXPEDIENTES_2026.xlsx', base64: b64(buf) }]
  ok((await falla('importar2026_previsualizar', { archivos: archivo }, t['jefe.numeracion'])).codigo === 'PERMISO', 'solo el administrador importa el Control 2026')
  const pv = await exito('importar2026_previsualizar', { archivos: archivo }, adm)
  ok(pv.anios_disponibles.map(a => a.anio).join() === '2025,2026', 'detecta los años disponibles (2025, 2026)')
  const pv26 = await exito('importar2026_previsualizar', { archivos: archivo, anios: [2026] }, adm)
  ok(pv26.totales.fuera_de_anio === 1 && pv26.totales.nuevos === 2 && pv26.totales.finalizar === 2 && pv26.totales.reabrir === 2 && pv26.totales.omitidos === 1,
     `filtro 2026: ${pv26.totales.nuevos} nuevos, ${pv26.totales.finalizar} se finalizan, ${pv26.totales.reabrir} se reabren, ${pv26.totales.omitidos} omitido, 1 fuera de año`)
  ok(pv26.totales.incompletos === 1 && pv26.estadisticas.dias_habiles.PENDIENTE.n === 4, 'registros incompletos detectados; días hábiles calculados con el calendario')
  ok(pv26.motivos_omision[0].motivo === 'Ya figura en trámite', 'motivo de omisión informado')
  const nAntes = s.almacen.expedientes.size
  const cf = await exito('importar2026_confirmar', { archivos: archivo, anios: [2026] }, adm)
  const e0 = s.almacen.expedientes.get(enTramite[0].id), e1 = s.almacen.expedientes.get(enTramite[1].id)
  ok(e0.estado === 'FINALIZADO' && e0.fecha_cierre === salidaDe(enTramite[0]) && e0.motivo_cierre.includes('CERT. NUMERACION 001-2026'),
     'finalizado con la fecha real de salida y el documento del ZIP')
  ok(e1.estado === 'FINALIZADO' && e1.motivo_cierre.includes('002-2026'), 'el documento de la hoja «Documentos ZIP» completa el registro')
  ok(cerrados.slice(0, 2).every(c => s.almacen.expedientes.get(c.id).estado === 'EN_TRAMITE' && s.r.iua.has(c.id)), 'los pendientes cerrados por inactividad vuelven a trámite y reciben IUA')
  const nuevo1 = s.bd.una("SELECT * FROM expedientes WHERE sistema = 'CONTROL_2026' AND numero = 'CTRL-NUEVO-1'")
  ok(nuevo1 && nuevo1.procedimiento_codigo === 'NUM_PREDIAL' && nuevo1.ubicacion_codigo === 'DEP_NUMERACION', 'nuevo con sistema CONTROL_2026, trámite mapeado y en su departamento')
  ok(s.bd.una("SELECT estado FROM expedientes WHERE numero = 'INCOMPLETO-F5492'").estado === 'INCOMPLETO' && !s.r.iua.has(s.bd.una("SELECT id FROM expedientes WHERE numero = 'INCOMPLETO-F5492'").id),
     'registro incompleto conservado y fuera de los modelos')
  ok(s.almacen.expedientes.size === nAntes + 3 && cf.actualizados === 4, 'no duplica los expedientes existentes')
  const lote = s.bd.una('SELECT * FROM importaciones WHERE id = ?', [cf.importacion_id])
  ok(lote.formato === 'CONTROL_2026' && lote.anio_filtro === '[2026]' && s.bd.una("SELECT id FROM auditoria WHERE accion = 'IMPORTAR_2026_CONFIRMAR'"),
     'registrado en importaciones (formato, años) y en la auditoría')
  const repetida = await exito('importar2026_previsualizar', { archivos: archivo, anios: [2026] }, adm)
  ok(repetida.totales.nuevos === 0 && repetida.totales.actualizados === 0, 'reimportar el mismo archivo no cambia nada (idempotente)')
  await exito('importar_deshacer', { id: cf.importacion_id }, adm)
  ok(s.almacen.expedientes.get(enTramite[0].id).estado === 'EN_TRAMITE' && s.almacen.expedientes.get(cerrados[0].id).estado === 'CERRADO_HISTORICO' &&
     s.almacen.expedientes.size === nAntes, 'deshacer restaura los estados previos y borra lo creado')
  const cf2 = await exito('importar2026_confirmar', { archivos: archivo, anios: [2026] }, adm)
  ok(cf2.nuevos === 2, 'se vuelve a importar')
  const tupa = await exito('subir_tupa', { archivos: [{ nombre: 'TUPA.pdf', base64: b64(Buffer.from('%PDF-1.4 prueba')) }] }, adm)
  ok(tupa.id && (await exito('descargar_tupa', { id: tupa.id }, adm)).base64 === b64(Buffer.from('%PDF-1.4 prueba')), 'documento TUPA guardado y recuperable')
  ok((await falla('subir_tupa', { archivos: [{ nombre: 'x.pdf', base64: b64(Buffer.from('no es pdf')) }] }, adm)).error.includes('no corresponde'), 'TUPA con contenido inválido rechazado')

  console.log('\nModelo 3 en el sistema: propuesta, edición y confirmación')
  ok((await falla('asignacion_ejecutar', {}, t['gerente'])).codigo === 'PERMISO', 'solo el administrador ejecuta el modelo')
  const pr = await exito('asignacion_ejecutar', { niveles: ['CRÍTICO', 'ALTO', 'MEDIO', 'BAJO'], limite: 300 }, adm)
  ok(pr.metodo === 'MILP' && ['OPTIMO', 'FACTIBLE'].includes(pr.milp.estado) && pr.milp.z >= pr.voraz.z - 1e-9,
     `MILP ${pr.milp.estado}: Z=${pr.milp.z.toFixed(3)} ≥ voraz Z=${pr.voraz.z.toFixed(3)} (${pr.milp.variables} variables)`)
  const filasProp = pr.filas.filter(f => f.usuario_id)
  ok(filasProp.every(f => f.candidatos.some(c => c.usuario_id === f.usuario_id)) &&
     filasProp.every(f => (s.usuarios.get(f.usuario_id).departamentos || []).includes(f.departamento_codigo)), 'toda asignación respeta la compatibilidad departamental')
  const tec = id('tecnico.numeracion')
  ok(pr.resumen.find(r => r.usuario_id === tec).propuestos <= 4, 'el técnico no supera su capacidad (4)')
  ok(s.bd.una('SELECT COUNT(*) n FROM eficiencia_trabajador WHERE usuario_id = ?', [tec]).n > 0, 'eᵢⱼ del técnico calculado desde su historial (alias)')
  ok(s.bd.una('SELECT COUNT(*) n FROM asignaciones').n === 0, 'ejecutar el modelo no asigna nada (solo propuesta)')
  // el administrador cambia una fila a un trabajador incompatible → se rechaza
  const fNum = filasProp.find(f => f.departamento_codigo === 'DEP_NUMERACION')
  const incompatible = id('jefe.parametros')
  const malo = filasProp.map(f => ({ expediente_id: f.expediente_id, usuario_id: f === fNum ? incompatible : f.usuario_id }))
  ok((await falla('asignacion_confirmar', { lote_id: pr.lote_id, asignaciones: malo }, adm)).error.includes('compatibilidad'), 'se rechaza un trabajador fuera del departamento')
  const exceso = pr.filas.filter(f => f.candidatos.some(c => c.usuario_id === tec)).slice(0, 5).map(f => ({ expediente_id: f.expediente_id, usuario_id: tec }))
  ok(exceso.length < 5 || (await falla('asignacion_confirmar', { lote_id: pr.lote_id, asignaciones: exceso }, adm)).error.includes('capacidad'), 'se rechaza superar la capacidad máxima')
  // asignación final: la propuesta, pero el expediente fNum pasa al técnico
  const finales = filasProp.filter(f => f.usuario_id !== tec).slice(0, 12).map(f => ({ expediente_id: f.expediente_id, usuario_id: f.usuario_id }))
  const paraTec = pr.filas.filter(f => f.candidatos.some(c => c.usuario_id === tec) && !finales.some(x => x.expediente_id === f.expediente_id)).slice(0, 3)
  for (const f of paraTec) finales.push({ expediente_id: f.expediente_id, usuario_id: tec })
  const c = await exito('asignacion_confirmar', { lote_id: pr.lote_id, asignaciones: finales, plazo_dias: 10 }, adm)
  ok(c.asignados === finales.length && c.mensaje.startsWith(`Se asignaron ${finales.length} expedientes a`), `«${c.mensaje}»`)
  const a0 = s.bd.una('SELECT * FROM asignaciones WHERE usuario_id = ? ORDER BY id LIMIT 1', [tec])
  const exp0 = s.almacen.expedientes.get(a0.expediente_id)
  ok(exp0.responsable_usuario_id === tec && exp0.ubicacion_tipo === 'USUARIO', 'el expediente pasa a la bandeja del trabajador')
  ok(a0.fecha_limite && a0.fecha_limite >= HOY && a0.estado === 'PENDIENTE' && a0.lote_id === pr.lote_id, 'asignación guardada con fecha límite, estado y lote')
  const nTec = s.bd.todas("SELECT * FROM notificaciones WHERE usuario_id = ? AND tipo = 'ASIGNACION'", [tec])
  ok(nTec.length === paraTec.length && nTec.some(x => x.mensaje.includes('Plazo: 10 días hábiles')), 'cada trabajador recibe su notificación con el plazo pedido (10 días hábiles)')
  const detLote = JSON.parse(s.bd.una("SELECT detalle FROM auditoria WHERE accion = 'CONFIRMAR_ASIGNACIONES'").detalle)
  ok(s.bd.una("SELECT COUNT(*) n FROM auditoria WHERE accion = 'ASIGNAR_EXPEDIENTE'").n === finales.length &&
     Number.isInteger(detLote.modificadas_por_admin) && detLote.quitadas_por_admin > 0, 'auditoría por asignación y del lote (con los cambios del administrador)')
  ok((await falla('asignacion_confirmar', { lote_id: pr.lote_id, asignaciones: finales }, adm)).error.includes('ya no está disponible'), 'una propuesta no se confirma dos veces')
  const b = await exito('bandeja', {}, t['tecnico.numeracion'])
  ok(paraTec.every(f => b.filas.some(x => x.id === f.expediente_id)), 'el técnico ve sus expedientes asignados en su bandeja')
  const mis = await exito('asignaciones', { estado: 'ACTIVAS' }, t['tecnico.numeracion'])
  ok(mis.filas.length === paraTec.length && mis.filas.every(a => a.usuario_id === tec), 'el técnico ve solo sus asignaciones')
  const pr2 = await exito('asignacion_ejecutar', { niveles: ['CRÍTICO', 'ALTO', 'MEDIO', 'BAJO'], limite: 300 }, adm)
  ok(!pr2.filas.some(f => finales.some(x => x.expediente_id === f.expediente_id)) && pr2.resumen.find(r => r.usuario_id === tec).disponible === 4 - paraTec.length,
     'una nueva corrida excluye lo ya asignado y descuenta la carga actual')

  console.log('\nRecepción, sincronización de asignaciones y notificaciones')
  const pend = await exito('pendientes_recepcion', {}, t['tecnico.numeracion'])
  ok(pend.length === paraTec.length, `«Por recibir»: ${pend.length} expedientes asignados esperan su firma de recepción`)
  const rec = await exito('recibir', { movimiento_ids: [pend[0].movimiento_id] }, t['tecnico.numeracion'])
  ok(rec.recibidos === 1 && s.bd.una('SELECT recibido_en FROM recepciones WHERE movimiento_id = ?', [pend[0].movimiento_id]).recibido_en === rec.recibido_en,
     'firma de recepción con fecha y hora exacta')
  ok(s.bd.una('SELECT estado FROM asignaciones WHERE expediente_id = ? AND usuario_id = ?', [pend[0].expediente_id, tec]).estado === 'EN_PROGRESO', 'recibir inicia la asignación (EN_PROGRESO)')
  const fichaRec = await exito('ficha', { id: pend[0].expediente_id }, t['tecnico.numeracion'])
  ok(fichaRec.movimientos.some(m => m.recibido_por) && fichaRec.tiempo_por_destino.length > 0 && fichaRec.asignaciones.length === 1, 'la ficha muestra la recepción, el tiempo por escritorio y la asignación')
  ok((await falla('recibir', { movimiento_ids: [pend[0].movimiento_id] }, t['tecnico.numeracion'])).error.includes('ya fue recibido'), 'no se recibe dos veces')
  const otro = pend[1].expediente_id
  await exito('derivar', { id: otro, destino: { tipo: 'DEPARTAMENTO', codigo: 'DEP_NUMERACION' }, observacion: 'Para firma', fecha: HOY }, t['tecnico.numeracion'])
  ok(s.bd.una('SELECT estado FROM asignaciones WHERE expediente_id = ?', [otro]).estado === 'EN_PROGRESO', 'derivar cuenta como avance (EN_PROGRESO)')
  const nJefe = s.bd.una("SELECT * FROM notificaciones WHERE usuario_id = ? AND tipo = 'DERIVACION' ORDER BY id DESC", [id('jefe.numeracion')])
  ok(nJefe && nJefe.referencia_id === otro && nJefe.mensaje.includes('fue derivado a su departamento'), 'el departamento receptor recibe la notificación de derivación')
  const nuevas = await exito('notificaciones_nuevas', { desde: '2000-01-01T00:00:00Z' }, t['jefe.numeracion'])
  ok(nuevas.no_leidas >= 1 && nuevas.datos_cambiados, 'polling: notificaciones nuevas y marca de cambio de datos')
  await exito('finalizar', { id: otro, resultado: 'ATENDIDO', documento: 'Certificado 99-2026', fecha: HOY }, t['jefe.numeracion'])
  ok(s.bd.una('SELECT estado FROM asignaciones WHERE expediente_id = ?', [otro]).estado === 'COMPLETADA', 'finalizar el expediente completa la asignación')
  const r0 = await exito('al_abrir', {}, t['tecnico.numeracion'])
  const r1 = await exito('al_abrir', {}, t['tecnico.numeracion'])
  ok(r0.creadas === 2 && r1.creadas === 0, 'al abrir: recordatorio diario y aviso del jueves, una sola vez por día')
  ok(s.bd.una("SELECT mensaje FROM notificaciones WHERE usuario_id = ? AND tipo = 'RECORDATORIO'", [tec]).mensaje.match(/^Tiene \d+ asignaciones pendientes\. La más urgente/),
     '«Tiene X asignaciones pendientes. La más urgente vence en Y días.»')
  const leidas = await exito('notificacion_leida', { todas: true }, t['tecnico.numeracion'])
  ok(leidas.no_leidas === 0, 'marcar todas como leídas')

  console.log('\nReporte semanal (jueves)')
  const est = await exito('reporte_semanal_estado', {}, t['tecnico.numeracion'])
  ok(est.requerido && est.semana === '2026-W46' && est.asignaciones.length === paraTec.length, 'jueves 09:00: el reporte es obligatorio y trae sus asignaciones')
  ok(!(await exito('reporte_semanal_estado', {}, adm)).aplica, 'el administrador no llena reporte')
  const resp = est.asignaciones.map((a, k) => ({ asignacion_id: a.id, estado: k === 0 ? 'En proceso' : a.estado === 'COMPLETADA' ? 'Finalizado' : 'Observado', avance: '' }))
  ok((await falla('reporte_semanal_enviar', { asignaciones: resp }, t['tecnico.numeracion'])).error.includes('avance'), '«En proceso» exige describir el avance')
  ok((await falla('reporte_semanal_enviar', { asignaciones: resp.slice(1) }, t['tecnico.numeracion'])).error.includes('Falta'), 'no se puede omitir una asignación')
  resp[0].avance = 'Se realizó la inspección ocular del predio'
  await exito('reporte_semanal_enviar', { asignaciones: resp, dificultades: 'Falta plano del administrado', necesita_apoyo: true }, t['tecnico.numeracion'])
  ok(!(await exito('reporte_semanal_estado', {}, t['tecnico.numeracion'])).requerido, 'enviado: el modal ya no aparece')
  ok(s.bd.una("SELECT id FROM notificaciones WHERE usuario_id = ? AND titulo LIKE '%pide apoyo%'", [id('jefe.numeracion')]), 'pedir apoyo notifica al jefe del departamento')
  const cons = await exito('reportes_consolidado', {}, adm)
  const fTec = cons.filas.find(f => f.usuario_id === tec)
  ok(fTec.semaforo.color === 'AMARILLO' && cons.filas.some(f => f.semaforo.color === 'ROJO' && !f.reporte), 'consolidado: amarillo (dificultades/apoyo) y rojo (no llenó)')
  ok((await falla('reportes_consolidado', {}, t['jefe.numeracion'])).codigo === 'PERMISO', 'el consolidado es del administrador y el gerente')

  console.log('\nSeguimiento, actividad y mejoras')
  const sg = await exito('seguimiento', {}, t['gerente'])
  const sTec = sg.trabajadores.find(x => x.usuario_id === tec)
  ok(sTec.departamentos.length === 2 && sTec.asignadas === paraTec.length && sTec.completadas === 1 && sTec.reporte_semana === HOY,
     'seguimiento por trabajador: departamentos, asignadas, completadas y reporte')
  ok(sTec.asignaciones.every(a => a.numero && a.ultimo_movimiento), 'cada asignación muestra número, IUA y último movimiento')
  const act = await exito('actividad_usuarios', { desde: '2000-01-01', hasta: '2100-01-01', usuario_id: tec, detalle: true }, adm)
  ok(act.resumen.length && act.resumen[0].derivados === 1 && act.resumen[0].recibidos === 1 && act.detalle.length, 'log de actividad por usuario y día')
  const bu = await exito('busqueda_universal', { q: enTramite[2].numero }, t['mesa.partes'])
  ok(bu.filas[0].numero === enTramite[2].numero, 'búsqueda universal por número')
  const conDni = s.bd.una("SELECT documento_identidad d FROM expedientes WHERE documento_identidad GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' LIMIT 1")
  ok(!conDni || (await exito('busqueda_universal', { q: conDni.d }, adm)).filas.some(f => f.documento_identidad === conDni.d), 'búsqueda universal por DNI')
  const fin = await exito('finalizados', {}, adm)
  ok(fin.total > 0 && fin.por_mes.length && fin.por_departamento.length && fin.por_trabajador.length && fin.kpis.mediana_dias !== null, 'tablero de finalizados con agregados')
  const finP = await exito('finalizados', { persona: fin.por_trabajador[0].clave }, adm)
  ok(finP.total === fin.por_trabajador[0].n, 'filtro por persona que finalizó')
  const ad = await exito('antes_despues', {}, adm)
  ok(ad.antes.ingresados > 0 && ad.fecha_implementacion && 'dentro_plazo' in ad.despues, 'indicador antes vs después')
  await exito('guardar_parametros', { dias_abandono: 10, fecha_implementacion: '2026-06-01' }, adm)
  const al = await exito('alertas', {}, adm)
  ok(al.dias_abandono === 10 && al.abandonados.every(x => x.dias_sin_movimiento >= 10) && al.abandonados.length > 0, 'alertas de abandonados con días configurables')
  ok((await exito('antes_despues', {}, adm)).fecha_implementacion === '2026-06-01', 'fecha de implementación configurable')
  const pl = await exito('plantillas_observacion', {}, t['tecnico.numeracion'])
  ok(pl.length >= 3, 'plantillas de observación por defecto')
  await exito('guardar_plantillas_observacion', { plantillas: [...pl, { titulo: 'Croquis', texto: 'Adjuntar croquis de ubicación del predio.' }] }, adm)
  ok((await exito('plantillas_observacion', {}, t['tecnico.numeracion'])).some(p => p.titulo === 'Croquis'), 'el administrador configura las plantillas')
  ok((await falla('guardar_plantillas_observacion', { plantillas: [] }, t['jefe.numeracion'])).codigo === 'PERMISO', 'solo el administrador las cambia')
  const dep = await exito('crear_departamento', { nombre: 'Habilitaciones Urbanas' }, adm)
  ok(dep.codigo === 'DEP_HABILITACIONES_URBANAS' && (await exito('departamentos', {}, adm)).some(x => x.codigo === dep.codigo), 'añadir departamento')

  console.log('\nPortal ciudadano')
  const cred = generarCredenciales({ nombres: 'Julio Francisco', apellidos: 'Cruz Choquehuanca', dni: '60062237' })
  ok(cred.usuario === 'JULIOFRANCISCOCRUZCHOQUEHUANCA' && cred.clave === 'JF60062237CC', 'regla de credenciales (JF60062237CC)')
  const reg = await exito('registrar_expediente', { solicitante: 'JULIO FRANCISCO CRUZ CHOQUEHUANCA', documento_identidad: '60062237', procedimiento_codigo: 'NUM_PREDIAL',
    folios: 3, administrado: { nombres: 'JULIO FRANCISCO', apellidos: 'CRUZ CHOQUEHUANCA', whatsapp: '951234567' } }, t['mesa.partes'])
  const cp = reg.credenciales_portal
  ok(cp && cp.usuario === cred.usuario && cp.clave === cred.clave && cp.enlace_whatsapp.startsWith('https://wa.me/51951234567?text=Estimado%20JULIO'),
     'mesa de partes crea el acceso y el enlace wa.me con el mensaje')
  ok(s.bd.una('SELECT clave_portal_hash h FROM administrados WHERE documento_identidad = ?', ['60062237']).h !== cred.clave, 'la contraseña se guarda cifrada')
  const reg2 = await exito('registrar_expediente', { solicitante: 'JULIO FRANCISCO CRUZ CHOQUEHUANCA', documento_identidad: '60062237', procedimiento_codigo: 'NUM_PREDIAL',
    folios: 1, administrado: { nombres: 'JULIO FRANCISCO', apellidos: 'CRUZ CHOQUEHUANCA' } }, t['mesa.partes'])
  ok(reg2.credenciales_portal === null && (await exito('administrado_buscar', { dni: '60062237' }, t['mesa.partes'])).existe, 'un DNI ya registrado no genera otra cuenta')
  ok(s.bd.una("SELECT id FROM notificaciones WHERE usuario_id = ? AND tipo = 'DERIVACION' AND referencia_id = ?", [id('jefe.numeracion'), reg.id]),
     'el registro en mesa de partes notifica al departamento')
  const pi = await exito('portal_ingresar', { usuario: 'julio francisco cruz choquehuanca', clave: cred.clave })
  ok(pi.token && pi.debe_cambiar_clave, 'ingreso al portal (acepta espacios y minúsculas) y exige cambiar la contraseña')
  ok((await falla('portal_mis_tramites', { token: pi.token })).codigo === 'CAMBIAR_CLAVE', 'sin cambiar la contraseña no ve sus trámites')
  ok((await falla('portal_cambiar_clave', { token: pi.token, actual: cred.clave, nueva: 'Clave60062237' })).error.includes('DNI'), 'la nueva contraseña no puede contener el DNI')
  await exito('portal_cambiar_clave', { token: pi.token, actual: cred.clave, nueva: 'MiClaveSegura9' })
  const mt = await exito('portal_mis_tramites', { token: pi.token })
  ok(mt.tramites.length === 2 && mt.tramites[0].departamento_actual && mt.tramites[0].fecha_estimada, 've sus 2 trámites con departamento actual y fecha estimada')
  const claves = new Set(mt.tramites.flatMap(x => Object.keys(x)))
  ok(!['iua', 'nivel', 'responsable_id', 'observaciones', 'ubicacion', 'usuario'].some(k => claves.has(k)) && !JSON.stringify(mt).includes('Técnico'),
     'no expone IUA, trabajador ni observaciones internas')
  ok((await falla('portal_consulta_dni', { token: pi.token, dni: '40000000' })).codigo === 'PERMISO', '/api/consulta/:dni solo acepta su propio DNI')
  for (let k = 0; k < 5; k++) await falla('portal_ingresar', { usuario: cred.usuario, clave: 'mala' })
  ok((await falla('portal_ingresar', { usuario: cred.usuario, clave: 'MiClaveSegura9' })).codigo === 'BLOQUEADO', 'bloqueo tras 5 intentos fallidos')
  const res = await exito('administrado_restablecer', { dni: '60062237' }, t['mesa.partes'])
  ok(res.clave === cred.clave, 'mesa de partes puede restablecer la contraseña inicial')

  console.log('\nRed local: polling GET y portal Express')
  const red = new ServidorRed(s, () => {})
  await red.iniciar(0)
  const puerto = red.servidor.address().port
  const g = await fetch(`http://127.0.0.1:${puerto}/api/notificaciones-nuevas?desde=2000-01-01T00:00:00Z`, { headers: { Authorization: `Bearer ${t['jefe.numeracion']}` } })
  const gj = await g.json()
  ok(g.status === 200 && gj.ok && gj.datos.filas.length > 0, 'GET /api/notificaciones-nuevas?desde=… en el servidor de red')
  ok((await fetch(`http://127.0.0.1:${puerto}/api/notificaciones-nuevas`)).status === 401, 'sin sesión: 401')
  process.env.URBANITO_URL = `http://127.0.0.1:${puerto}`
  const { crearApp } = require('../portal/servidor')
  const portal = await new Promise(r => { const srv = crearApp().listen(0, () => r(srv)) })
  const P = `http://127.0.0.1:${portal.address().port}`
  // el bloqueo del usuario sigue vigente: se usa un administrado nuevo
  await exito('registrar_expediente', { solicitante: 'ROSA MARIA APAZA LIMA', documento_identidad: '41111111', procedimiento_codigo: 'NUM_PREDIAL', folios: 1,
    administrado: { nombres: 'ROSA MARIA', apellidos: 'APAZA LIMA' } }, t['mesa.partes'])
  const ing = await (await fetch(`${P}/api/ingresar`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'ROSAMARIAAPAZALIMA', clave: 'RM41111111AL' }) })).json()
  const H = { Authorization: `Bearer ${ing.token}`, 'Content-Type': 'application/json' }
  await fetch(`${P}/api/cambiar-clave`, { method: 'POST', headers: H, body: JSON.stringify({ actual: 'RM41111111AL', nueva: 'RosaClave2026' }) })
  const consulta = await fetch(`${P}/api/consulta/41111111`, { headers: H })
  ok(consulta.status === 200 && (await consulta.json()).tramites.length === 1, 'portal Express: ingresar → cambiar clave → GET /api/consulta/:dni')
  ok((await fetch(`${P}/api/consulta/60062237`, { headers: H })).status === 403, 'portal Express: otro DNI → 403')
  const pagina = await fetch(`${P}/`)
  ok(pagina.status === 200 && (await pagina.text()).includes('Consulte el estado de sus trámites') && pagina.headers.get('content-security-policy'), 'sirve la página del portal con cabeceras de seguridad')
  portal.close(); await red.detener()

  console.log('\nIntegridad')
  ok(s.bd.una('PRAGMA integrity_check').integrity_check === 'ok' && s.bd.una('PRAGMA foreign_key_check') === null, 'integridad y claves foráneas de la base')
  s.detener()
  ok(fs.statSync(semilla).mtimeMs === mtimeSemilla, 'la base inicial (semilla) no se modificó')
  fs.rmSync(dir, { recursive: true, force: true })
  console.log(`\n${pasos} comprobaciones correctas`)
  process.exit(0)
})().catch(err => { console.error(err); process.exit(1) })
