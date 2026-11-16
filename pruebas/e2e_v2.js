// Prueba de punta a punta de las pantallas de la v2 (Electron real).
//   node pruebas/e2e_v2.js [carpeta_capturas]        (Linux: xvfb-run -a node …)
// Prepara una base con usuarios y un Control 2026 sintético, abre el programa
// un jueves a las 09:00 y recorre: asignaciones (MILP), seguimiento, tablero
// de finalizados, antes/después, importación 2026, alertas, ficha, búsqueda
// universal, campana, reporte semanal obligatorio y mesa de partes con portal.
const { _electron: electron } = require('playwright')
const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')
const ExcelJS = require('exceljs')
const { Sistema } = require('../electron/servicios/sistema')
const { despachar } = require('../electron/servicios/api')

const RAIZ = path.join(__dirname, '..')
const CAPTURAS = process.argv[2] || path.join(os.tmpdir(), 'urbanito-capturas-v2')
fs.mkdirSync(CAPTURAS, { recursive: true })
const DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'urbanito-e2e-v2-'))
const HOY = '2026-11-12'
const CLAVE = 'Prueba2026'

let n = 0, capturaN = 0
const errores = []
const ok = (c, m) => { assert.ok(c, m); n++; console.log(`  ✓ ${m}`) }

async function preparar() {
  fs.copyFileSync(path.join(RAIZ, 'semilla', 'urbanito.db'), path.join(DATOS, 'urbanito.db'))
  const s = new Sistema({ rutaBd: path.join(DATOS, 'urbanito.db'), carpetaRespaldos: null, fechaFija: HOY })
  await s.iniciar()
  const api = async (a, d, t) => { const r = await despachar(s, a, d, t); if (!r.ok) throw new Error(`${a}: ${r.error}`); return r.datos }
  const conf = await api('configuracion_inicial', { nombre_completo: 'Administrador de prueba', usuario: 'admin', clave: CLAVE, crear_por_departamento: true })
  for (const c of conf.usuarios_demo) {
    if (!['tecnico.numeracion', 'mesa.partes'].includes(c.usuario)) continue
    const tk = (await api('login', { usuario: c.usuario, clave: c.clave_temporal })).token
    await api('cambiar_clave', { actual: c.clave_temporal, nueva: CLAVE }, tk)
  }
  const adm = (await api('login', { usuario: 'admin', clave: CLAVE })).token
  // Control 2026 sintético: reabre 30 expedientes cerrados por inactividad de Numeración
  const cerrados = s.bd.todas(`SELECT e.* FROM expedientes e WHERE e.sistema = 'SGAU' AND e.estado = 'CERRADO_HISTORICO' AND e.procedimiento_codigo = 'NUM_PREDIAL'
                               AND e.fecha_ingreso LIKE '2026-%' LIMIT 30`)
  const wb = new ExcelJS.Workbook()
  const c = wb.addWorksheet('Control 2026')
  c.addRow(['Fila Excel', 'Expediente / documento (Excel)', 'Referencia (RUT / RUC / EXP)', 'Solicitante', 'Tipo de trámite', 'Fecha de ingreso',
            'Última derivación (Excel)', 'Fecha de salida (ZIP)', 'Días transcurridos', 'Estado', 'Archivo de salida encontrado', 'Archivo ZIP', 'Criterio de cruce', 'Observaciones'])
  cerrados.forEach((e, k) => c.addRow([k + 3, e.numero, null, e.solicitante, 'NUMERACION MUNICIPAL', new Date(`${e.fecha_ingreso}T00:00:00Z`), null, null, 100, 'PENDIENTE']))
  const buf = await wb.xlsx.writeBuffer()
  fs.writeFileSync(path.join(DATOS, 'CONTROL_EXPEDIENTES_2026.xlsx'), Buffer.from(buf))
  await api('importar2026_confirmar', { archivos: [{ nombre: 'CONTROL_EXPEDIENTES_2026.xlsx', base64: Buffer.from(buf).toString('base64') }] }, adm)
  s.detener()
}

async function abrir() {
  const app = await electron.launch({
    executablePath: require(path.join(RAIZ, 'node_modules', 'electron')),
    args: [RAIZ, '--no-sandbox'], cwd: RAIZ,
    env: { ...process.env, URBANITO_DATOS: DATOS, URBANITO_HOY: HOY, URBANITO_HORA: '9', URBANITO_PRUEBA: '1', URBANITO_MODO: 'servidor' },
  })
  const v = await app.firstWindow()
  await v.setViewportSize({ width: 1440, height: 900 })
  v.on('pageerror', e => errores.push(`pageerror: ${e.message}`))
  v.on('console', m => { if (m.type() === 'error') errores.push(`console: ${m.text()}`) })
  return { app, v }
}
const captura = async (v, nombre) => { await v.waitForTimeout(400); await v.screenshot({ path: path.join(CAPTURAS, `${String(++capturaN).padStart(2, '0')}_${nombre}.png`) }) }
async function sinErrores(v, donde) {
  ok(await v.locator('text=Ocurrió un error en la pantalla').count() === 0, `${donde}: sin errores de interfaz`)
  ok(await v.locator('.aviso.error').count() === 0, `${donde}: sin errores de carga`)
}
async function ingresar(v, usuario) {
  await v.waitForSelector('input[autocomplete="username"]')
  await v.fill('input[autocomplete="username"]', usuario)
  await v.fill('input[type="password"]', CLAVE)
  await v.click('button[type="submit"]')
  await v.waitForSelector('.barra-lateral')
}
const ir = async (v, seccion) => { await v.click(`[data-seccion="${seccion}"]`); await v.waitForTimeout(500) }
const pestana = async (v, texto) => { await v.click(`.pestana:has-text("${texto}")`); await v.waitForTimeout(600) }

;(async () => {
  console.log('Preparando la base de prueba…')
  await preparar()
  const { app, v } = await abrir()
  try {
    console.log('Administrador')
    await ingresar(v, 'admin')
    ok(await v.locator('[data-seccion="asignaciones"]').count() === 1 && await v.locator('[data-seccion="seguimiento"]').count() === 1, 'menú con Asignaciones y Seguimiento')
    ok(await v.locator('[data-accion="campana"]').count() === 1 && await v.locator('[data-campo="busqueda-universal"]').count() === 1, 'cabecera con campana y búsqueda universal')
    await sinErrores(v, 'Inicio')

    await ir(v, 'asignaciones')
    await v.click('[data-accion="ejecutar-modelo"]')
    await v.waitForSelector('[data-prueba="propuesta"]', { timeout: 60000 })
    ok(await v.locator('text=MILP (GLPK)').count() === 1, 'el modelo se resuelve con MILP (GLPK) en el programa empaquetado')
    await captura(v, 'asignaciones_propuesta')
    // cambio manual válido: quitar un expediente de la propuesta («No asignar ahora»)
    await v.locator('[data-campo="trabajador"]').first().selectOption('')
    ok(await v.locator('text=cambio(s) manual(es)').count() >= 1, 'el cambio manual actualiza Z al instante')
    await v.click('[data-accion="validar-asignar"]')
    await v.click('[data-accion="confirmar-asignacion"]')
    await v.waitForSelector('text=Se asignaron', { timeout: 30000 })
    ok(true, 'propuesta validada y asignada')
    await captura(v, 'asignaciones_confirmadas')
    await pestana(v, 'Asignaciones confirmadas'); await sinErrores(v, 'Asignaciones confirmadas'); await captura(v, 'asignaciones_lista')
    await pestana(v, 'Eficiencia'); await sinErrores(v, 'Eficiencia eᵢⱼ')

    await ir(v, 'seguimiento')
    await v.waitForSelector('.kanban'); await sinErrores(v, 'Seguimiento'); await captura(v, 'seguimiento')
    await pestana(v, 'Reportes semanales'); await sinErrores(v, 'Reportes semanales'); await captura(v, 'reportes_semanales')
    await pestana(v, 'Actividad por usuario'); await sinErrores(v, 'Actividad'); await captura(v, 'actividad')

    await ir(v, 'tablero')
    await pestana(v, 'Finalizados'); await v.waitForSelector('.recharts-surface'); await sinErrores(v, 'Tablero › Finalizados'); await captura(v, 'finalizados')
    ok(await v.locator('.recharts-surface').count() >= 5, 'cinco gráficos de finalizados')
    await pestana(v, 'Antes vs.'); await sinErrores(v, 'Antes vs después'); await captura(v, 'antes_despues')

    await ir(v, 'importar'); await pestana(v, 'Control de Expedientes 2026'); await sinErrores(v, 'Importar › Control 2026'); await captura(v, 'importar_2026')
    ok(await v.locator('[data-accion="elegir-control2026"]').count() === 1 && await v.locator('[data-accion="subir-tupa"]').count() === 1,
       'pestaña del Control 2026 con selector de archivo y subida del TUPA')
    await ir(v, 'alertas'); await pestana(v, 'Abandonados'); await sinErrores(v, 'Alertas › Abandonados')
    await ir(v, 'configuracion'); await pestana(v, 'Plantillas de observación'); await sinErrores(v, 'Configuración › Plantillas'); await captura(v, 'plantillas')
    await pestana(v, 'Parámetros'); await sinErrores(v, 'Configuración › Parámetros')
    await ir(v, 'departamentos'); ok(await v.locator('[data-accion="nuevo-departamento"]').count() === 1, 'botón «Añadir departamento»')

    await v.fill('[data-campo="busqueda-universal"]', '-2026')
    await v.waitForSelector('.resultados-busqueda .res')
    await captura(v, 'busqueda_universal')
    await v.keyboard.press('Enter')
    await v.waitForSelector('.modal .pestana:has-text("Historial")')
    await v.click('.modal .pestana:has-text("Historial")')
    await v.waitForTimeout(500)
    await sinErrores(v, 'Ficha › Historial'); await captura(v, 'ficha_historial')
    await v.keyboard.press('Escape')
    await v.click('[data-accion="salir"]')

    console.log('Técnico (jueves 09:00)')
    await ingresar(v, 'tecnico.numeracion')
    await v.waitForSelector('text=Reporte semanal de avance', { timeout: 20000 })
    ok(true, 'el modal del reporte semanal aparece solo')
    await v.keyboard.press('Escape'); await v.mouse.click(10, 10); await v.waitForTimeout(300)
    ok(await v.locator('text=Reporte semanal de avance').count() === 1 && await v.locator('.modal .cerrar').count() === 0, 'no se puede cerrar (sin ×, Escape ni clic fuera)')
    await captura(v, 'reporte_semanal')
    await v.click('[data-accion="enviar-reporte"]')
    ok(await v.locator('.modal .aviso.error').count() === 1, 'no se envía incompleto')
    const estados = v.locator('[data-campo="estado-reporte"]')
    for (let k = 0; k < await estados.count(); k++) await estados.nth(k).selectOption('Sin iniciar')
    await v.click('[data-accion="enviar-reporte"]')
    await v.waitForSelector('text=Reporte semanal de avance', { state: 'detached', timeout: 15000 })
    ok(true, 'enviado el reporte, el modal desaparece')
    await ir(v, 'bandeja'); await sinErrores(v, 'Bandeja del técnico')
    ok(await v.locator('.luz').count() > 0, 'semáforo de plazo en la bandeja')
    ok(await v.locator('text=Por recibir').count() === 1, 'bloque «Por recibir» con sus asignaciones')
    await captura(v, 'bandeja_tecnico')
    await v.click('[data-accion="recibir-todos"]'); await v.waitForTimeout(800)
    ok(await v.locator('text=Por recibir').count() === 0, 'recibir todos firma la recepción')
    await v.click('[data-accion="campana"]'); await v.waitForSelector('.panel-notificaciones')
    ok(await v.locator('.panel-notificaciones .item').count() > 0, 'la campana muestra sus notificaciones de asignación')
    await captura(v, 'campana')
    await v.keyboard.press('Escape')
    await v.click('[data-accion="salir"]')

    console.log('Mesa de partes')
    await ingresar(v, 'mesa.partes')
    await ir(v, 'mesa')
    await v.fill('[data-campo="solicitante"]', 'JULIO FRANCISCO CRUZ CHOQUEHUANCA')
    await v.fill('[data-campo="documento"]', '60062237')
    await v.waitForSelector('[data-campo="crear-portal"]')
    ok(await v.inputValue('[data-campo="nombres"]') === 'JULIO FRANCISCO' && await v.inputValue('[data-campo="apellidos"]') === 'CRUZ CHOQUEHUANCA', 'propone nombres y apellidos')
    await v.fill('[data-campo="whatsapp"]', '951234567')
    await v.selectOption('[data-campo="procedimiento"]', 'NUM_PREDIAL')
    await v.fill('[data-campo="folios"]', '2')
    await v.click('[data-accion="registrar"]')
    await v.waitForSelector('[data-prueba="credenciales-portal"]')
    const txt = await v.textContent('[data-prueba="credenciales-portal"]')
    ok(txt.includes('JULIOFRANCISCOCRUZCHOQUEHUANCA') && txt.includes('JF60062237CC') && await v.locator('[data-accion="whatsapp"]').count() === 1,
       'muestra usuario, contraseña y el botón de WhatsApp')
    await captura(v, 'mesa_partes_portal')
  } finally {
    await app.close()
  }
  const reales = errores.filter(e => !/Download the React DevTools|ResizeObserver/.test(e))
  ok(!reales.length, `sin errores en la consola${reales.length ? `: ${reales.slice(0, 3).join(' | ')}` : ''}`)
  fs.rmSync(DATOS, { recursive: true, force: true })
  console.log(`\n${n} comprobaciones correctas · capturas en ${CAPTURAS}`)
})().catch(e => { console.error(e); if (errores.length) console.error(errores.slice(0, 10)); process.exit(1) })
