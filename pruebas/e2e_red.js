// Prueba del uso en red: una PC servidor y una PC cliente (dos programas reales).
//   xvfb-run -a node pruebas/e2e_red.js <capturas>
const { _electron: electron } = require('playwright')
const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')

const RAIZ = path.join(__dirname, '..')
const CAPTURAS = process.argv[2] || path.join(os.tmpdir(), 'urbanito-red')
fs.mkdirSync(CAPTURAS, { recursive: true })
let n = 0
const ok = (c, m) => { assert.ok(c, m); n++; console.log(`  ✓ ${m}`) }

async function abrir(datos) {
  const app = await electron.launch({
    executablePath: require(path.join(RAIZ, 'node_modules', 'electron')),
    args: [RAIZ, '--no-sandbox'], cwd: RAIZ,
    env: { ...process.env, URBANITO_DATOS: datos, URBANITO_HOY: '2026-11-05', URBANITO_PRUEBA: '1' },
  })
  const v = await app.firstWindow()
  await v.setViewportSize({ width: 1440, height: 900 })
  return { app, v }
}
const ingresar = async (v, u, c) => {
  await v.fill('input[autocomplete="username"]', u)
  await v.fill('input[type="password"]', c)
  await v.click('button[type="submit"]')
  await v.waitForSelector('.barra-lateral')
}

;(async () => {
  const dA = fs.mkdtempSync(path.join(os.tmpdir(), 'urbanito-servidor-'))
  const dB = fs.mkdtempSync(path.join(os.tmpdir(), 'urbanito-cliente-'))

  console.log('PC servidor')
  const A = await abrir(dA)
  await A.v.click('button:has-text("Continuar")')
  await A.v.waitForSelector('text=Configuración inicial', { timeout: 60000 })
  const c = A.v.locator('.tarjeta-acceso input')
  await c.nth(0).fill('Administrador'); await c.nth(2).fill('Urbanito2026'); await c.nth(3).fill('Urbanito2026')
  await A.v.click('button:has-text("Crear administrador")')
  await ingresar(A.v, 'admin', 'Urbanito2026')
  await A.v.click('[data-seccion="configuracion"]')
  await A.v.click('button:has-text("Activar conexión en red")')
  await A.v.waitForSelector('text=Activada')
  ok(true, 'el administrador activa la conexión en red')
  await A.v.screenshot({ path: path.join(CAPTURAS, 'red_servidor_activado.png') })
  // crear un usuario de mesa de partes para la otra PC
  await A.v.click('[data-seccion="usuarios"]')
  await A.v.click('[data-accion="nuevo-usuario"]')
  await A.v.fill('[data-campo="usuario"]', 'mesa.red')
  await A.v.fill('[data-campo="nombre"]', 'Mesa de partes (PC 2)')
  await A.v.selectOption('[data-campo="rol"]', 'MESA_PARTES')
  await A.v.click('[data-accion="guardar-usuario"]')
  await A.v.waitForSelector('[data-prueba="clave-temporal"]')
  const clave = (await A.v.locator('[data-prueba="clave-temporal"]').innerText()).trim()
  await A.v.click('button:has-text("Listo")')

  console.log('\nPC cliente')
  const B = await abrir(dB)
  await B.v.click('button:has-text("Conectarse a la PC servidor")')
  await B.v.fill('input[placeholder="192.168.1.20"]', '127.0.0.1:9999')
  await B.v.click('button:has-text("Continuar")')
  await B.v.waitForSelector('text=No se encontró un servidor URBANITO')
  ok(true, 'con una dirección equivocada avisa que no encuentra el servidor')
  await B.v.fill('input[placeholder="192.168.1.20"]', '127.0.0.1')
  await B.v.click('button:has-text("Continuar")')
  await B.v.waitForSelector('input[autocomplete="username"]', { timeout: 30000 })
  ok(await B.v.locator('text=Conectado a http://127.0.0.1:7301').count() === 1, 'se conecta al servidor (puerto por defecto 7301)')
  ok(!fs.existsSync(path.join(dB, 'urbanito.db')), 'la PC cliente no guarda una base de datos propia')
  await B.v.fill('input[autocomplete="username"]', 'mesa.red')
  await B.v.fill('input[type="password"]', clave)
  await B.v.click('button[type="submit"]')
  await B.v.waitForSelector('text=debe cambiar su contraseña temporal')
  const p = B.v.locator('input[type="password"]')
  await p.nth(0).fill(clave); await p.nth(1).fill('MesaRed2026'); await p.nth(2).fill('MesaRed2026')
  await B.v.click('button:has-text("Cambiar contraseña")')
  await B.v.waitForSelector('.barra-lateral')
  ok(await B.v.locator('text=Conectado en red').count() === 1, 'el usuario de la PC cliente ingresa con la cuenta creada en el servidor')
  await B.v.click('[data-seccion="mesa"]')
  await B.v.fill('[data-campo="solicitante"]', 'Registro desde la PC 2')
  await B.v.fill('[data-campo="documento"]', '45678912')
  await B.v.selectOption('[data-campo="procedimiento"]', 'VISADO_PLANO')
  await B.v.fill('[data-campo="folios"]', '6')
  await B.v.waitForSelector('text=Lo que realmente tarda (MTA)')
  await B.v.click('[data-accion="registrar"]')
  await B.v.waitForSelector('[data-prueba="numero-registrado"]')
  const numero = (await B.v.locator('[data-prueba="numero-registrado"]').innerText()).trim()
  ok(/^\d{6}-2026$/.test(numero), `registra el expediente ${numero} desde la PC cliente`)
  await B.v.screenshot({ path: path.join(CAPTURAS, 'red_cliente_registro.png') })
  await B.v.click('button:has-text("Registrar otro")')

  console.log('\nVerificación en el servidor')
  await A.v.click('[data-seccion="buscar"]')
  await A.v.fill('[data-campo="buscar"]', numero)
  await A.v.waitForSelector(`td:has-text("${numero}")`)
  ok(true, 'el expediente registrado en la PC cliente aparece en el servidor')
  await A.v.screenshot({ path: path.join(CAPTURAS, 'red_servidor_ve_registro.png') })

  console.log('\nCorte de conexión')
  await A.app.close()
  await B.v.click('[data-seccion="buscar"]')
  try {
    await B.v.waitForSelector('text=No se pudo conectar con el servidor URBANITO', { timeout: 30000 })
  } catch (e) {
    await B.v.screenshot({ path: path.join(CAPTURAS, 'red_fallo.png') })
    throw e
  }
  ok(true, 'si el servidor se apaga, la PC cliente lo informa con un mensaje claro')
  await B.v.screenshot({ path: path.join(CAPTURAS, 'red_servidor_apagado.png') })
  await B.app.close()

  console.log(`\n${n} verificaciones superadas`)
  fs.rmSync(dA, { recursive: true, force: true }); fs.rmSync(dB, { recursive: true, force: true })
})().catch(err => { console.error('\nFALLÓ:', err.message); process.exit(1) })
