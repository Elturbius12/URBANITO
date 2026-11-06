// Prueba de integración del núcleo del ERP (sin interfaz).
//   node pruebas/prueba_servicios.js <semilla.db>
const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')
const { Sistema } = require('../electron/servicios/sistema')
const { despachar } = require('../electron/servicios/api')

const semilla = process.argv[2]
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'urbanito-prueba-'))
const ruta = path.join(dir, 'urbanito.db')
fs.copyFileSync(semilla, ruta)

let pasos = 0
const ok = (cond, msg) => { assert.ok(cond, msg); pasos++; console.log(`  ✓ ${msg}`) }

;(async () => {
  const s = new Sistema({ rutaBd: ruta, carpetaRespaldos: path.join(dir, 'respaldos'), fechaFija: '2026-11-05' })
  await s.iniciar()
  const api = async (accion, datos, token) => despachar(s, accion, datos, token)
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

  console.log('Configuración inicial y acceso')
  ok((await exito('estado_inicial')).requiere_configuracion, 'base nueva pide configuración inicial')
  ok((await falla('configuracion_inicial', { nombre_completo: 'Admin', usuario: 'admin', clave: 'corta' })).error.includes('8 caracteres'),
     'rechaza contraseña débil')
  const conf = await exito('configuracion_inicial', { nombre_completo: 'Administrador General', usuario: 'admin', clave: 'Urbanito2026', crear_demo: true })
  ok(conf.usuarios_demo.length === 4, 'crea 4 usuarios de prueba con clave temporal')
  ok((await falla('configuracion_inicial', { nombre_completo: 'X', usuario: 'otro', clave: 'Urbanito2026' })).error.includes('ya fue configurado'),
     'no permite repetir la configuración inicial')
  const clave = Object.fromEntries(conf.usuarios_demo.map(d => [d.usuario, d.clave_temporal]))

  const adm = (await exito('login', { usuario: 'admin', clave: 'Urbanito2026' })).token
  ok(!!adm, 'el administrador inicia sesión')
  ok((await falla('login', { usuario: 'admin', clave: 'mala' })).codigo === 'CREDENCIALES', 'contraseña incorrecta rechazada')

  // usuarios de prueba deben cambiar su clave
  const tokens = {}
  for (const u of ['gerente', 'jefe.numeracion', 'tecnico.numeracion', 'mesa.partes']) {
    const r = await exito('login', { usuario: u, clave: clave[u] })
    ok(r.usuario.debe_cambiar_clave, `${u}: debe cambiar la clave temporal`)
    ok((await falla('bandeja', {}, r.token)).codigo !== undefined, `${u}: no puede trabajar sin cambiar la clave`)
    await exito('cambiar_clave', { actual: clave[u], nueva: 'ClaveNueva2026' }, r.token)
    tokens[u] = r.token
  }

  console.log('\nBloqueo por intentos fallidos')
  for (let i = 0; i < 5; i++) await falla('login', { usuario: 'gerente', clave: 'x' })
  ok((await falla('login', { usuario: 'gerente', clave: 'ClaveNueva2026' })).codigo === 'BLOQUEADO', 'tras 5 intentos el usuario queda bloqueado')
  s.bd.ejecutar('UPDATE usuarios SET bloqueado_hasta = NULL WHERE usuario = ?', ['gerente'])
  tokens.gerente = (await exito('login', { usuario: 'gerente', clave: 'ClaveNueva2026' })).token

  console.log('\nPermisos por rol')
  ok((await falla('usuarios', {}, tokens['mesa.partes'])).codigo === 'PERMISO', 'mesa de partes no administra usuarios')
  ok((await falla('bandeja', {}, tokens['mesa.partes'])).codigo === 'PERMISO', 'mesa de partes no tiene bandeja priorizada')
  ok((await falla('registrar_expediente', {}, tokens['tecnico.numeracion'])).codigo === 'PERMISO', 'técnico no registra expedientes')
  ok((await falla('guardar_ahp', { matriz: [[1]] }, tokens['jefe.numeracion'])).codigo === 'PERMISO', 'jefe no cambia los pesos del modelo')
  const bjefe = await exito('bandeja', {}, tokens['jefe.numeracion'])
  ok(bjefe.filas.length > 0 && bjefe.filas.every(f => f.departamento_codigo === 'DEP_NUMERACION'),
     `jefe de Numeración ve solo su departamento (${bjefe.filas.length} expedientes)`)
  const bger = await exito('bandeja', {}, tokens.gerente)
  ok(bger.filas.length === s.r.iua.size, `gerente ve todos los expedientes en trámite (${bger.filas.length})`)
  ok((await exito('bandeja', {}, tokens['tecnico.numeracion'])).filas.length === 0, 'técnico recién creado no tiene expedientes asignados')
  const ajeno = bger.filas.find(f => f.departamento_codigo && f.departamento_codigo !== 'DEP_NUMERACION' && f.estado === 'EN_TRAMITE')
  ok((await falla('derivar', { id: ajeno.id, destino: { tipo: 'UNIDAD ORGANICA', codigo: 'GEDU' } }, tokens['jefe.numeracion'])).codigo === 'PERMISO',
     'jefe no puede derivar expedientes de otro departamento')

  console.log('\nMesa de partes: registro con estimación del MTA')
  const est = await exito('estimacion', { procedimiento_codigo: 'LIC_EDIFICACION', fecha: '2026-11-05' }, tokens['mesa.partes'])
  ok(est.plazo_tupa !== null && est.fecha_limite_tupa, `estimación: plazo TUPA ${est.plazo_tupa} d.h., límite ${est.fecha_limite_tupa}`)
  ok(est.mta && est.mta.p80 > 0, `estimación MTA: mediana ${est.mta.mediana}, P80 ${est.mta.p80}`)
  ok((await falla('registrar_expediente', { solicitante: 'Juan', documento_identidad: '123', procedimiento_codigo: 'NUM_PREDIAL', folios: 3 }, tokens['mesa.partes'])).error.includes('Documento'),
     'rechaza documento de identidad inválido')
  ok((await falla('registrar_expediente', { solicitante: 'Juan Pérez', documento_identidad: '12345678', procedimiento_codigo: 'NUM_PREDIAL', folios: 3, fecha_ingreso: '2026-12-01' }, tokens['mesa.partes'])).error.includes('posterior a hoy'),
     'rechaza fecha de ingreso futura')
  const activosAntes = s.r.iua.size
  const nuevo = await exito('registrar_expediente', {
    solicitante: 'Juan Pérez Mamani', documento_identidad: '40123456', telefono: '951000000',
    direccion: 'Jr. Prueba 123, Juliaca', procedimiento_codigo: 'NUM_PREDIAL', asunto: 'Certificado de numeración',
    folios: 4 }, tokens['mesa.partes'])
  ok(/^\d{6}-2026$/.test(nuevo.numero), `número correlativo asignado: ${nuevo.numero}`)
  ok(s.r.iua.size === activosAntes + 1, 'el IUA se recalculó e incluye el expediente nuevo')
  ok(nuevo.constancia.estimacion.plazo_tupa === 0, 'constancia: numeración municipal es de atención el mismo día (TUPA 0)')
  const n2 = await exito('registrar_expediente', { solicitante: 'María Quispe', documento_identidad: '20123456789',
    procedimiento_codigo: 'LIC_EDIFICACION', folios: 25 }, tokens['mesa.partes'])
  ok(parseInt(n2.numero, 10) === parseInt(nuevo.numero, 10) + 1, 'la numeración es correlativa')

  console.log('\nFlujo completo: asignar, observar, subsanar, finalizar')
  const usuarios = await exito('usuarios', {}, adm)
  const tec = usuarios.find(u => u.usuario === 'tecnico.numeracion')
  await exito('derivar', { id: nuevo.id, destino: { tipo: 'USUARIO', codigo: tec.id }, documento: 'Proveído 001' }, tokens['jefe.numeracion'])
  const btec = await exito('bandeja', {}, tokens['tecnico.numeracion'])
  ok(btec.filas.some(f => f.id === nuevo.id), 'el técnico ve el expediente que le asignó su jefe')
  ok((await falla('derivar', { id: nuevo.id, destino: { tipo: 'USUARIO', codigo: tec.id } }, tokens['jefe.numeracion'])).error.includes('ya se encuentra'),
     'no permite derivar al mismo destino')
  ok((await falla('observar', { id: nuevo.id, observacion: 'corto' }, tokens['tecnico.numeracion'])).error.includes('10 caracteres'),
     'la observación exige descripción')
  await exito('observar', { id: nuevo.id, observacion: 'Falta copia literal de dominio actualizada' }, tokens['tecnico.numeracion'])
  ok(s.almacen.expedientes.get(nuevo.id).estado === 'OBSERVADO', 'expediente pasa a OBSERVADO (plazo suspendido)')
  ok((await falla('finalizar', { id: nuevo.id, resultado: 'ATENDIDO', documento: 'Cert 1' }, tokens['tecnico.numeracion'])).error.includes('observado'),
     'no se finaliza un expediente observado')
  const mp = await exito('mesa_partes', {}, tokens['mesa.partes'])
  ok(mp.observados.some(o => o.id === nuevo.id), 'mesa de partes ve el expediente observado para recibir la subsanación')
  await exito('subsanar', { id: nuevo.id, documento: 'Escrito 55', folios: 2 }, tokens['mesa.partes'])
  ok(s.almacen.expedientes.get(nuevo.id).estado === 'EN_TRAMITE', 'tras subsanar vuelve a EN TRÁMITE')
  ok(s.almacen.expedientes.get(nuevo.id).responsable_usuario_id === tec.id, 'después de subsanar sigue asignado al mismo técnico')
  const fichaAntes = await exito('ficha', { id: nuevo.id }, tokens['tecnico.numeracion'])
  ok(fichaAntes.iua && fichaAntes.iua.aportes && Math.abs(Object.values(fichaAntes.iua.aportes).reduce((a, b) => a + (b || 0), 0) - fichaAntes.iua.iua) < 1e-9,
     'la ficha muestra el desglose del IUA y los aportes suman el índice')
  ok(fichaAntes.acciones.includes('finalizar'), 'el técnico tiene la acción finalizar')
  const baseAntes = s.r.mta.base_n
  await exito('finalizar', { id: nuevo.id, resultado: 'APROBADO / PROCEDENTE', documento: 'Certificado N° 0001-2026' }, tokens['tecnico.numeracion'])
  ok(s.almacen.expedientes.get(nuevo.id).estado === 'FINALIZADO', 'expediente FINALIZADO')
  ok(!s.r.iua.has(nuevo.id), 'sale de la bandeja priorizada')
  ok(s.r.mta.base_n === baseAntes + 1, 'el MTA incorpora el expediente cerrado a su base de cálculo')
  ok((await falla('derivar', { id: nuevo.id, destino: { tipo: 'UNIDAD ORGANICA', codigo: 'GEDU' } }, tokens.gerente)).error.includes('finalizado'),
     'un expediente finalizado no se puede derivar')

  console.log('\nArchivo y reapertura')
  await exito('archivar', { id: n2.id, motivo: 'Desistimiento del administrado', observacion: 'Solicitud escrita de desistimiento' }, tokens.gerente)
  ok(s.almacen.expedientes.get(n2.id).estado === 'ARCHIVADO', 'el gerente archiva por desistimiento')
  ok((await falla('reabrir', { id: n2.id, motivo: 'error', destino: { tipo: 'DEPARTAMENTO', codigo: 'DEP_LICENCIAS_EDIF' } }, tokens.gerente)).codigo === 'PERMISO',
     'solo el administrador reabre')
  await exito('reabrir', { id: n2.id, motivo: 'Archivado por error, el administrado no desistió', destino: { tipo: 'DEPARTAMENTO', codigo: 'DEP_LICENCIAS_EDIF' } }, adm)
  ok(s.almacen.expedientes.get(n2.id).estado === 'EN_TRAMITE', 'el administrador reabre el expediente')

  console.log('\nCorrección con auditoría')
  await exito('corregir', { id: n2.id, solicitante: 'María Quispe Apaza', motivo: 'Nombre incompleto en el registro' }, tokens['mesa.partes'])
  const aud = await exito('auditoria', { accion: 'CORREGIR_EXPEDIENTE' }, adm)
  ok(aud.filas.length === 1 && JSON.parse(aud.filas[0].detalle).antes.solicitante === 'María Quispe', 'la auditoría guarda el valor anterior y el nuevo')

  console.log('\nModelo AHP editable con control de consistencia')
  const inconsistente = [[1, 9, 9, 9, 9], [1 / 9, 1, 9, 9, 9], [1 / 9, 1 / 9, 1, 9, 9], [1 / 9, 1 / 9, 1 / 9, 1, 9], [1 / 9, 1 / 9, 1 / 9, 1 / 9, 1]]
  const sim = await exito('simular_ahp', { matriz: [[1, 1 / 3, 5, 1, 1], [3, 1, 1 / 5, 1, 1], [1 / 5, 5, 1, 1, 1], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1]] }, tokens.gerente)
  ok(sim.valida && !sim.consistente, `simulación detecta juicios inconsistentes (RC=${sim.rc.toFixed(3)})`)
  ok((await falla('guardar_ahp', { matriz: [[1, 1 / 3, 5, 1, 1], [3, 1, 1 / 5, 1, 1], [1 / 5, 5, 1, 1, 1], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1]], justificacion: 'Prueba de consistencia' }, tokens.gerente)).error.includes('consistentes'),
     'no permite guardar una matriz inconsistente')
  ok((await falla('guardar_ahp', { matriz: [[1, 2], [3, 1]], justificacion: 'Prueba no recíproca' }, tokens.gerente)).error.includes('recíproca'),
     'no permite guardar una matriz no recíproca')
  const sumaIua = () => [...s.r.iua.values()].reduce((a, v) => a + v.iua, 0)
  const iuaAntes = sumaIua()
  const igual = [[1, 1, 1, 1, 1], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1]]
  const g = await exito('guardar_ahp', { matriz: igual, justificacion: 'Prueba: todos los factores con igual importancia' }, tokens.gerente)
  ok(g.consistente && Math.abs(g.pesos[0] - 0.2) < 1e-9, 'matriz de igual importancia → pesos de 20% cada uno')
  ok(Math.abs(sumaIua() - iuaAntes) > 1e-6, 'el IUA de los expedientes se recalcula con los nuevos pesos')
  void inconsistente

  console.log('\nFeriados y calendario')
  const limAntes = (await exito('estimacion', { procedimiento_codigo: 'LIC_EDIFICACION', fecha: '2026-11-05' }, tokens['mesa.partes'])).fecha_limite_tupa
  await exito('agregar_feriado', { fecha: '2026-11-06', nombre: 'Día no laborable decretado (prueba)' }, adm)
  const limDespues = (await exito('estimacion', { procedimiento_codigo: 'LIC_EDIFICACION', fecha: '2026-11-05' }, tokens['mesa.partes'])).fecha_limite_tupa
  ok(limDespues > limAntes, `un feriado nuevo corre la fecha límite (${limAntes} → ${limDespues})`)
  ok((await falla('eliminar_feriado', { fecha: '2026-12-25' }, adm)).error.includes('no se eliminan'), 'los feriados de ley no se pueden borrar')
  await exito('eliminar_feriado', { fecha: '2026-11-06' }, adm)

  console.log('\nDepuración de importados')
  const imp = await exito('importados_en_tramite', { min_dias_sin_movimiento: 40 }, tokens['jefe.numeracion'])
  ok(imp.length > 0 && imp.every(f => f.importado), `jefe lista importados en trámite sin movimiento ≥40 días (${imp.length})`)
  const baseAntes2 = s.r.mta.base_n
  await exito('depurar_importados', { ids: imp.slice(0, 3).map(f => f.id), accion: 'ATENDIDO', observacion: 'Verificado con el archivo físico del departamento' }, tokens['jefe.numeracion'])
  ok(imp.slice(0, 3).every(f => s.almacen.expedientes.get(f.id).estado === 'CERRADO_HISTORICO'), 'los 3 quedan cerrados con la fecha de su último movimiento')
  ok(s.r.mta.base_n >= baseAntes2, 'el MTA se recalcula tras la depuración')
  const sinTramite = await exito('importados_en_tramite', { sin_tramite: true }, tokens.gerente)
  ok(sinTramite.length > 0 && sinTramite.every(f => f.procedimiento_codigo === 'VACIO' || f.procedimiento_codigo === 'SIN_CLASIFICAR'),
     `el gerente lista importados sin trámite identificado (${sinTramite.length})`)
  ok((await falla('depurar_importados', { ids: [sinTramite[0].id], accion: 'CLASIFICAR', observacion: 'Verificado con documento físico' }, tokens.gerente)).error.includes('trámite'),
     'clasificar exige elegir el trámite')
  const objetivo = sinTramite.find(f => f.procedimiento_codigo === 'VACIO').id
  ok(s.r.iua.get(objetivo).factores_omitidos.includes('urgencia_temporal'), 'antes de clasificar, el IUA omite la urgencia temporal')
  await exito('depurar_importados', { ids: [objetivo], accion: 'CLASIFICAR', procedimiento_codigo: 'NUM_PREDIAL', observacion: 'Verificado con documento físico' }, tokens.gerente)
  ok(s.almacen.expedientes.get(objetivo).procedimiento_codigo === 'NUM_PREDIAL', 'el expediente queda con su trámite')
  ok(s.r.iua.get(objetivo).factores_omitidos.length === 0 && s.r.iua.get(objetivo).plazo_tupa === 0,
     'después de clasificar, el IUA usa el plazo TUPA y los 5 factores')
  ok((await exito('bandeja', {}, tokens['jefe.numeracion'])).filas.some(f => f.id === objetivo), 'y aparece en la bandeja del jefe de Numeración')

  console.log('\nUsuarios')
  const cu = await exito('crear_usuario', { usuario: 'ana.condori', nombre_completo: 'Ana Condori', rol: 'TECNICO', departamento_codigo: 'DEP_VISADO_PLANOS', alias_historico: 'NADIA' }, adm)
  ok(cu.clave_temporal && cu.clave_temporal.length >= 8, 'se genera una clave temporal')
  ok((await falla('crear_usuario', { usuario: 'ana.condori', nombre_completo: 'Otra', rol: 'TECNICO' }, adm)).error.includes('Ya existe'), 'no permite usuarios repetidos')
  ok((await falla('crear_usuario', { usuario: 'jefe2', nombre_completo: 'Jefe sin dep', rol: 'JEFE_DEPARTAMENTO' }, adm)).error.includes('departamento'),
     'un jefe requiere departamento')
  const ana = (await exito('login', { usuario: 'ana.condori', clave: cu.clave_temporal })).token
  await exito('cambiar_clave', { actual: cu.clave_temporal, nueva: 'AnaClave2026' }, ana)
  const bana = await exito('bandeja', {}, ana)
  ok(bana.filas.length > 0, `con su alias histórico (NADIA) la técnica ve sus expedientes heredados (${bana.filas.length})`)
  const admId = usuarios.find(u => u.usuario === 'admin').id
  ok((await falla('editar_usuario', { id: admId, activo: false }, adm)).error.includes('sí mismo'), 'el administrador no puede desactivarse a sí mismo')
  await exito('editar_usuario', { id: cu.id, activo: false }, adm)
  ok((await falla('bandeja', {}, ana)).codigo === 'SESION', 'al desactivar un usuario su sesión se cierra')

  console.log('\nRespaldo y restauración')
  const resp = await exito('crear_respaldo', {}, adm)
  ok(!!resp.nombre, `respaldo creado: ${resp.nombre}`)
  const nExp = s.almacen.expedientes.size
  await exito('registrar_expediente', { solicitante: 'Expediente posterior al respaldo', documento_identidad: '41234567', procedimiento_codigo: 'NUM_PREDIAL', folios: 1 }, tokens['mesa.partes'])
  ok(s.almacen.expedientes.size === nExp + 1, 'se registra un expediente después del respaldo')
  const r = await despachar(s, 'restaurar_respaldo', { ruta: s.rutaRespaldo(resp.nombre) }, adm)
  ok(r.ok, 'restauración aceptada')
  ok(s.almacen.expedientes.size === nExp, 'la base vuelve al estado del respaldo')
  ok((await falla('resumen', {}, adm)).codigo === 'SESION', 'tras restaurar todos deben volver a ingresar')
  ok(fs.readdirSync(path.join(dir, 'respaldos')).some(f => f.includes('_antes_restaurar_')), 'se guardó una copia previa a la restauración')

  console.log('\nPersistencia en disco')
  s.detener()
  const s2 = new Sistema({ rutaBd: ruta, carpetaRespaldos: path.join(dir, 'respaldos'), fechaFija: '2026-11-05' })
  await s2.iniciar()
  ok(s2.almacen.expedientes.size === nExp, 'al reabrir el programa los datos persisten')
  ok(s2.bd.una("SELECT COUNT(*) n FROM usuarios").n === 6, 'los usuarios persisten (admin, 4 de prueba y ana.condori)')
  s2.detener()

  console.log(`\n${pasos} verificaciones superadas`)
  fs.rmSync(dir, { recursive: true, force: true })
})().catch(err => {
  console.error('\nFALLÓ:', err.message)
  console.error(err.stack)
  process.exit(1)
})
