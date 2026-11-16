// Pruebas de la migración al esquema v2 (asignación óptima y seguimiento):
// tablas nuevas, columnas agregadas, versión de esquema, es_principal,
// límite de 2 departamentos, capacidad máxima y permisos nuevos.
//   node pruebas/prueba_esquema_v2.js <semilla.db>
const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')
const { Sistema } = require('../electron/servicios/sistema')
const { despachar } = require('../electron/servicios/api')
const { VERSION_ESQUEMA } = require('../electron/bd')
const seg = require('../electron/servicios/seguridad')

const semilla = process.argv[2]
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'urbanito-esquema-v2-'))
const ruta = path.join(dir, 'urbanito.db')
fs.copyFileSync(semilla, ruta)

let pasos = 0
const ok = (cond, msg) => { assert.ok(cond, msg); pasos++; console.log(`  ✓ ${msg}`) }

;(async () => {
  const mtimeSemilla = fs.statSync(semilla).mtimeMs
  const s = new Sistema({ rutaBd: ruta, carpetaRespaldos: null, fechaFija: '2026-11-05' })
  await s.iniciar()

  console.log('Migración al esquema v2')
  const tabla = (t) => !!s.bd.una("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [t])
  for (const t of ['asignaciones', 'eficiencia_trabajador', 'reportes_semanales', 'notificaciones', 'administrados', 'tupa_documento']) {
    ok(tabla(t), `existe la tabla ${t}`)
  }
  for (const i of ['idx_asig_exp', 'idx_asig_usr', 'idx_asig_estado', 'idx_notif_usr', 'idx_admin_dni', 'idx_rep_sem']) {
    ok(!!s.bd.una("SELECT name FROM sqlite_master WHERE type='index' AND name = ?", [i]), `existe el índice ${i}`)
  }
  ok(s.bd.columnas('usuarios').has('capacidad_maxima'), 'usuarios.capacidad_maxima')
  ok(s.bd.columnas('usuario_departamentos').has('es_principal'), 'usuario_departamentos.es_principal')
  ok(s.bd.columnas('importaciones').has('anio_filtro'), 'importaciones.anio_filtro')
  ok(s.bd.versionEsquema() === VERSION_ESQUEMA && s.migraciones.some(m => m.startsWith('versión de esquema')),
     `versión de esquema ${VERSION_ESQUEMA} registrada (${s.migraciones.join(', ')})`)
  ok(s.bd.migrar().length === 0, 'la migración es idempotente')
  ok(s.r.iua.size > 0, `los modelos MTA/IUA siguen calculándose (IUA de ${s.r.iua.size} expedientes)`)

  console.log('\nUsuarios multi-departamento y capacidad')
  const api = (accion, datos, token) => despachar(s, accion, datos, token)
  const conf = await api('configuracion_inicial', { nombre_completo: 'Administrador de prueba', usuario: 'admin', clave: 'Prueba2026' })
  if (!conf.ok) throw new Error(conf.error)
  const adm = (await api('login', { usuario: 'admin', clave: 'Prueba2026' })).datos.token
  const nuevo = await api('crear_usuario', { usuario: 'tec.doble', nombre_completo: 'Técnico de dos departamentos', rol: 'TECNICO',
    departamento_codigo: 'DEP_NUMERACION', departamentos: ['DEP_NUMERACION', 'DEP_PARAMETROS'], capacidad_maxima: 15 }, adm)
  ok(nuevo.ok, 'se crea un técnico con 2 departamentos y capacidad 15')
  const filas = s.bd.todas('SELECT departamento_codigo, es_principal FROM usuario_departamentos WHERE usuario_id = ? ORDER BY departamento_codigo', [nuevo.datos.id])
  ok(filas.length === 2 && filas.find(f => f.departamento_codigo === 'DEP_NUMERACION').es_principal === 1 &&
     filas.find(f => f.departamento_codigo === 'DEP_PARAMETROS').es_principal === 0, 'es_principal marca solo el departamento principal')
  ok(s.usuarios.get(nuevo.datos.id).capacidad_maxima === 15, 'se guarda la capacidad máxima')
  const tres = await api('editar_usuario', { id: nuevo.datos.id, departamentos: ['DEP_NUMERACION', 'DEP_PARAMETROS', 'DEP_TELECOM'] }, adm)
  ok(!tres.ok && tres.error.includes('máximo en 2'), 'no se permiten 3 departamentos')
  const malaCap = await api('editar_usuario', { id: nuevo.datos.id, capacidad_maxima: 0 }, adm)
  ok(!malaCap.ok && malaCap.error.includes('Capacidad'), 'capacidad inválida rechazada')
  const cambio = await api('editar_usuario', { id: nuevo.datos.id, departamento_codigo: 'DEP_PARAMETROS', capacidad_maxima: 8 }, adm)
  ok(cambio.ok && s.bd.una('SELECT es_principal p FROM usuario_departamentos WHERE usuario_id = ? AND departamento_codigo = ?',
     [nuevo.datos.id, 'DEP_PARAMETROS']).p === 1 && s.usuarios.get(nuevo.datos.id).capacidad_maxima === 8,
     'cambiar el principal actualiza es_principal; la capacidad se edita')
  const aud = s.bd.una("SELECT detalle FROM auditoria WHERE accion = 'EDITAR_USUARIO' ORDER BY id DESC LIMIT 1")
  ok(JSON.parse(aud.detalle).despues.capacidad_maxima === 8, 'la auditoría registra la capacidad')
  const lista = await api('usuarios', {}, adm)
  ok(lista.datos.find(x => x.id === nuevo.datos.id).capacidad_maxima === 8, 'la lista de usuarios informa la capacidad')

  console.log('\nPermisos v2')
  ok(seg.tienePermiso('ADMINISTRADOR', 'asignaciones') && seg.tienePermiso('ADMINISTRADOR', 'seguimiento'), 'administrador: todo')
  ok(seg.tienePermiso('GERENTE', 'seguimiento') && seg.tienePermiso('GERENTE', 'asignaciones_ver') && !seg.tienePermiso('GERENTE', 'asignaciones'),
     'gerente: seguimiento y ver asignaciones, no ejecutar el modelo')
  ok(seg.tienePermiso('JEFE_DEPARTAMENTO', 'asignaciones_ver') && !seg.tienePermiso('JEFE_DEPARTAMENTO', 'seguimiento'), 'jefe: ver asignaciones')
  ok(seg.tienePermiso('TECNICO', 'mis_asignaciones') && seg.tienePermiso('TECNICO', 'reporte_semanal') && !seg.tienePermiso('TECNICO', 'asignaciones_ver'),
     'técnico: mis asignaciones y reporte semanal')
  ok(!seg.tienePermiso('MESA_PARTES', 'mis_asignaciones') && seg.tienePermiso('MESA_PARTES', 'registrar'), 'mesa de partes sin cambios')

  s.detener()
  ok(fs.statSync(semilla).mtimeMs === mtimeSemilla, 'la base inicial (semilla) no se modificó')
  fs.rmSync(dir, { recursive: true, force: true })
  console.log(`\n${pasos} comprobaciones correctas`)
})().catch(err => { console.error(err); process.exit(1) })
