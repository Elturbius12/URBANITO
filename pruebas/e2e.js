// Prueba de punta a punta del programa de escritorio (Electron real).
//   xvfb-run -a node pruebas/e2e.js <carpeta_capturas>
const { _electron: electron } = require('playwright')
const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')

const RAIZ = path.join(__dirname, '..')
const CAPTURAS = process.argv[2] || path.join(os.tmpdir(), 'urbanito-capturas')
fs.mkdirSync(CAPTURAS, { recursive: true })
const DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'urbanito-e2e-'))

let n = 0
const errores = []
const ok = (c, m) => { assert.ok(c, m); n++; console.log(`  ✓ ${m}`) }

async function abrir() {
  const app = await electron.launch({
    executablePath: require(path.join(RAIZ, 'node_modules', 'electron')),
    args: [RAIZ, '--no-sandbox'],
    cwd: RAIZ,
    env: { ...process.env, URBANITO_DATOS: DATOS, URBANITO_HOY: '2026-11-05', URBANITO_PRUEBA: '1' },
  })
  const v = await app.firstWindow()
  await v.setViewportSize({ width: 1440, height: 900 })
  v.on('pageerror', e => errores.push(`pageerror: ${e.message}`))
  v.on('console', m => { if (m.type() === 'error') errores.push(`console: ${m.text()}`) })
  return { app, v }
}

async function captura(v, nombre) {
  await v.waitForTimeout(350)
  await v.screenshot({ path: path.join(CAPTURAS, `${String(++capturaN).padStart(2, '0')}_${nombre}.png`) })
}
let capturaN = 0

async function sinErroresVisibles(v, donde) {
  const fallo = await v.locator('text=Ocurrió un error en la pantalla').count()
  ok(fallo === 0, `${donde}: sin errores de interfaz`)
  const errorCarga = await v.locator('.aviso.error').count()
  ok(errorCarga === 0, `${donde}: sin errores de carga de datos`)
}

async function ingresar(v, usuario, clave) {
  await v.fill('input[autocomplete="username"]', usuario)
  await v.fill('input[type="password"]', clave)
  await v.click('button[type="submit"]')
}

async function cambiarClaveObligatoria(v, temporal, nueva) {
  await v.waitForSelector('text=debe cambiar su contraseña temporal')
  const p = v.locator('input[type="password"]')
  await p.nth(0).fill(temporal); await p.nth(1).fill(nueva); await p.nth(2).fill(nueva)
  await v.click('button:has-text("Cambiar contraseña")')
  await v.waitForSelector('.barra-lateral')
}

async function salir(v) {
  await v.click('[data-accion="salir"]')
  await v.waitForSelector('input[autocomplete="username"]')
}

async function ir(v, seccion) {
  await v.click(`[data-seccion="${seccion}"]`)
  await v.waitForTimeout(250)
  await v.waitForFunction(() => !document.querySelector('.cargando'), null, { timeout: 20000 })
}

;(async () => {
  let { app, v } = await abrir()

  console.log('Primer uso')
  await v.waitForSelector('text=¿Cómo se usará URBANITO en esta computadora?')
  await captura(v, 'elegir_modo')
  await v.click('button:has-text("Continuar")')
  await v.waitForSelector('text=Configuración inicial', { timeout: 60000 })
  ok(true, 'elige «servidor» y carga la base inicial')
  const campos = v.locator('.tarjeta-acceso input')
  await campos.nth(0).fill('Administrador General')
  await campos.nth(2).fill('Urbanito2026')
  await campos.nth(3).fill('Urbanito2026')
  await v.check('input[type="checkbox"]')
  await captura(v, 'configuracion_inicial')
  await v.click('button:has-text("Crear administrador")')
  await v.waitForSelector('text=contraseñas temporales')
  const claves = {}
  for (const fila of await v.locator('table tbody tr').all()) {
    const c = await fila.locator('td').allInnerTexts()
    claves[c[0]] = c[2]
  }
  ok(Object.keys(claves).length === 4, 'muestra las 4 claves temporales de los usuarios de prueba')
  await captura(v, 'claves_demo')
  await v.click('button:has-text("Ya las anoté")')

  console.log('\nAdministrador')
  await ingresar(v, 'admin', 'Urbanito2026')
  await v.waitForSelector('.barra-lateral')
  await v.waitForSelector('text=Lo más urgente')
  await captura(v, 'admin_inicio')
  await sinErroresVisibles(v, 'Inicio (admin)')
  const menu = await v.locator('[data-seccion]').evaluateAll(els => els.map(e => e.getAttribute('data-seccion')))
  ok(menu.includes('usuarios') && menu.includes('auditoria') && menu.includes('mesa'), 'el administrador ve todo el menú')
  for (const s of ['bandeja', 'alertas', 'buscar', 'departamentos', 'tablero', 'modelos', 'reportes', 'depuracion', 'usuarios', 'configuracion', 'auditoria', 'ayuda']) {
    await ir(v, s)
    await captura(v, `admin_${s}`)
    await sinErroresVisibles(v, s)
  }
  // pestañas de modelos
  await ir(v, 'modelos')
  for (const p of ['Modelo 2 — MTA por trámite', 'MTA por oficina y responsable', 'Plazos de referencia', 'Metodología y fuentes']) {
    await v.click(`button.pestana:has-text("${p}")`)
    await v.waitForTimeout(200)
    await captura(v, `modelos_${p.split(' ')[0]}_${p.split(' ').slice(-1)[0]}`)
    await sinErroresVisibles(v, `Modelos / ${p}`)
  }
  // configuración: pestañas
  await ir(v, 'configuracion')
  for (const p of ['Respaldos', 'Feriados', 'Procedimientos y plazos TUPA', 'Parámetros']) {
    await v.click(`button.pestana:has-text("${p}")`)
    await v.waitForTimeout(300)
    await captura(v, `config_${p.split(' ')[0]}`)
    await sinErroresVisibles(v, `Configuración / ${p}`)
  }
  // crear un técnico nuevo desde la interfaz
  await ir(v, 'usuarios')
  await v.click('[data-accion="nuevo-usuario"]')
  await v.fill('[data-campo="usuario"]', 'rosa.mamani')
  await v.fill('[data-campo="nombre"]', 'Rosa Mamani Quispe')
  await v.selectOption('[data-campo="rol"]', 'TECNICO')
  await v.selectOption('[data-campo="departamento"]', 'DEP_NUMERACION')
  await v.click('[data-accion="guardar-usuario"]')
  await v.waitForSelector('[data-prueba="clave-temporal"]')
  const claveRosa = (await v.locator('[data-prueba="clave-temporal"]').innerText()).trim()
  ok(claveRosa.length >= 8, 'crea un usuario desde la interfaz y muestra su clave temporal')
  await v.click('button:has-text("Listo")')
  await salir(v)

  console.log('\nMesa de partes')
  await ingresar(v, 'mesa.partes', claves['mesa.partes'])
  await cambiarClaveObligatoria(v, claves['mesa.partes'], 'MesaPartes2026')
  ok(true, 'cambio obligatorio de clave temporal')
  const menuMesa = await v.locator('[data-seccion]').evaluateAll(els => els.map(e => e.getAttribute('data-seccion')))
  ok(!menuMesa.includes('bandeja') && !menuMesa.includes('usuarios') && menuMesa.includes('mesa'), 'mesa de partes ve solo su menú')
  await captura(v, 'mesa_inicio')
  await ir(v, 'mesa')
  await v.fill('[data-campo="solicitante"]', 'Juan Carlos Pérez Mamani')
  await v.fill('[data-campo="documento"]', '40123456')
  await v.selectOption('[data-campo="procedimiento"]', 'NUM_PREDIAL')
  await v.fill('[data-campo="folios"]', '4')
  await v.waitForSelector('text=Lo que realmente tarda (MTA)')
  await v.waitForSelector('text=Atención el mismo día')
  await captura(v, 'mesa_formulario_con_estimacion')
  ok(true, 'al elegir el trámite muestra el plazo TUPA y la estimación del MTA')
  await v.click('[data-accion="registrar"]')
  await v.waitForSelector('[data-prueba="numero-registrado"]')
  const numero = (await v.locator('[data-prueba="numero-registrado"]').innerText()).trim()
  ok(/^\d{6}-2026$/.test(numero), `expediente registrado con número ${numero}`)
  await captura(v, 'mesa_registrado')
  await v.click('button:has-text("Registrar otro")')
  // segundo expediente: licencia de edificación
  await v.fill('[data-campo="solicitante"]', 'Constructora Altiplano S.A.C.')
  await v.fill('[data-campo="documento"]', '20601234567')
  await v.selectOption('[data-campo="procedimiento"]', 'LIC_EDIFICACION')
  await v.fill('[data-campo="folios"]', '38')
  await v.waitForSelector('text=Lo que realmente tarda (MTA)')
  await captura(v, 'mesa_licencia_estimacion')
  await v.click('[data-accion="registrar"]')
  await v.waitForSelector('[data-prueba="numero-registrado"]')
  await v.click('button:has-text("Registrar otro")')
  await salir(v)

  console.log('\nJefe de departamento')
  await ingresar(v, 'jefe.numeracion', claves['jefe.numeracion'])
  await cambiarClaveObligatoria(v, claves['jefe.numeracion'], 'JefeNumeracion2026')
  await ir(v, 'bandeja')
  await v.fill('input[placeholder^="Buscar por N°"]', numero)
  await v.waitForTimeout(800)
  await v.waitForSelector(`[data-prueba="bandeja"] >> text=${numero}`)
  ok(true, 'el jefe ve el expediente nuevo en la bandeja de su departamento')
  await v.click(`[data-prueba="bandeja"] >> text=${numero}`)
  await v.waitForSelector('.modal >> text=Índice de urgencia')
  await captura(v, 'ficha_resumen')
  await v.click('button.pestana:has-text("Prioridad (IUA)")')
  await v.waitForSelector('text=Cálculo: IUA')
  await captura(v, 'ficha_iua_explicado')
  await v.click('button.pestana:has-text("Tiempos reales (MTA)")')
  await v.waitForTimeout(300)
  await captura(v, 'ficha_mta')
  await v.click('button.pestana:has-text("Recorrido")')
  await captura(v, 'ficha_recorrido')
  await sinErroresVisibles(v, 'Ficha')
  await v.click('[data-accion="derivar"]')
  await v.waitForSelector('[data-campo="destino"]')
  const opciones = await v.locator('[data-campo="destino"] option').allInnerTexts()
  const rosa = opciones.find(o => o.includes('Rosa Mamani'))
  ok(!!rosa, 'puede asignar a la técnica creada por el administrador')
  await v.selectOption('[data-campo="destino"]', { label: rosa })
  await captura(v, 'derivar')
  await v.click('[data-accion="confirmar"]')
  await v.waitForSelector('text=Expediente derivado')
  ok(true, 'deriva el expediente a la técnica')
  await v.click('.modal-cabecera .cerrar')
  await ir(v, 'tablero')
  await captura(v, 'jefe_tablero')
  await sinErroresVisibles(v, 'Tablero (jefe)')
  await ir(v, 'depuracion')
  await captura(v, 'jefe_depuracion')
  await salir(v)

  console.log('\nTécnica')
  await ingresar(v, 'rosa.mamani', claveRosa)
  await cambiarClaveObligatoria(v, claveRosa, 'RosaMamani2026')
  await ir(v, 'bandeja')
  await v.waitForSelector(`[data-prueba="bandeja"] >> text=${numero}`)
  ok(true, 'la técnica ve el expediente que le asignaron')
  await captura(v, 'tecnico_bandeja')
  await v.click(`[data-prueba="bandeja"] >> text=${numero}`)
  await v.waitForSelector('[data-accion="observar"]')
  await v.click('[data-accion="observar"]')
  await v.fill('.modal textarea', 'Presentar plano de ubicación firmado por profesional habilitado')
  await v.click('[data-accion="confirmar"]')
  await v.waitForSelector('text=plazo suspendido')
  ok(true, 'observa el expediente')
  await v.click('.modal-cabecera .cerrar')
  await salir(v)

  console.log('\nMesa de partes recibe la subsanación')
  await ingresar(v, 'mesa.partes', 'MesaPartes2026')
  await ir(v, 'mesa')
  await v.click('button.pestana:has-text("Observados")')
  await v.waitForSelector(`text=${numero}`)
  await captura(v, 'mesa_observados')
  await v.click(`td:has-text("${numero}")`)
  await v.click('[data-accion="subsanar"]')
  await v.click('[data-accion="confirmar"]')
  await v.waitForSelector('text=Subsanación registrada')
  ok(true, 'mesa de partes registra la subsanación')
  await v.click('.modal-cabecera .cerrar')
  await salir(v)

  console.log('\nTécnica finaliza')
  await ingresar(v, 'rosa.mamani', 'RosaMamani2026')
  await ir(v, 'bandeja')
  await v.click(`[data-prueba="bandeja"] >> text=${numero}`)
  await v.click('[data-accion="finalizar"]')
  await v.selectOption('.modal select', 'APROBADO / PROCEDENTE')
  await v.fill('.modal input[placeholder^="Ej.: Certificado"]', 'Certificado N° 0001-2026-SGCUC')
  await v.click('[data-accion="confirmar"]')
  await v.waitForSelector('text=Expediente finalizado')
  ok(true, 'finaliza el expediente')
  await v.click('button.pestana:has-text("Recorrido")')
  await captura(v, 'recorrido_completo')
  const pasos = await v.locator('.paso').count()
  ok(pasos >= 5, `el recorrido muestra todos los pasos (${pasos})`)
  await v.click('.modal-cabecera .cerrar')
  await salir(v)

  console.log('\nGerente')
  await ingresar(v, 'gerente', claves.gerente)
  await cambiarClaveObligatoria(v, claves.gerente, 'Gerente2026')
  await ir(v, 'tablero')
  await captura(v, 'gerente_tablero')
  await ir(v, 'modelos')
  ok(await v.locator('[data-prueba="matriz-ahp"] select').count() === 10, 'el gerente puede editar los 10 juicios de la matriz AHP')
  await v.locator('[data-prueba="matriz-ahp"] select').first().selectOption('1/9')
  await v.waitForSelector('text=los juicios se contradicen')
  await captura(v, 'ahp_inconsistente')
  ok(await v.locator('button:has-text("Guardar nuevos pesos")').isDisabled(), 'con juicios inconsistentes no se puede guardar')
  await v.click('button:has-text("Descartar cambios")')
  await salir(v)

  console.log('\nAuditoría y persistencia')
  await ingresar(v, 'admin', 'Urbanito2026')
  await ir(v, 'auditoria')
  await v.waitForSelector('td:has-text("FINALIZAR")')
  ok(true, 'la auditoría registra la finalización')
  await captura(v, 'auditoria')
  await app.close()

  ;({ app, v } = await abrir())
  await v.waitForSelector('input[autocomplete="username"]', { timeout: 60000 })
  ok(true, 'al reabrir el programa va directo al ingreso (ya configurado)')
  await ingresar(v, 'admin', 'Urbanito2026')
  await ir(v, 'buscar')
  await v.fill('[data-campo="buscar"]', numero)
  await v.waitForSelector('td:has-text("Finalizado")')
  ok(true, 'el expediente finalizado persiste tras cerrar y abrir el programa')
  await captura(v, 'persistencia')
  await app.close()

  const relevantes = errores.filter(e => !/Autofill|DevTools|Electron Security Warning/.test(e))
  if (relevantes.length) console.log('\nErrores de consola:\n  ' + relevantes.join('\n  '))
  ok(relevantes.length === 0, 'sin errores en la consola de la interfaz')
  console.log(`\n${n} verificaciones superadas. Capturas en ${CAPTURAS}`)
  fs.rmSync(DATOS, { recursive: true, force: true })
})().catch(async (err) => {
  console.error('\nFALLÓ:', err.message)
  if (errores.length) console.error('Errores de consola:\n  ' + errores.join('\n  '))
  process.exit(1)
})
