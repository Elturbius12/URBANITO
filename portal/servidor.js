// ===========================================================================
// URBANITO — PORTAL CIUDADANO (estructura lista; NO desplegado todavía)
// ---------------------------------------------------------------------------
// Servidor Express que sirve la página pública (carpeta publico/) y una API
// mínima. NO abre la base de datos: reenvía cada consulta al servidor de red
// de URBANITO (la PC servidor, con «Uso en red local» activado), que valida la
// sesión del ciudadano y devuelve SOLO sus datos públicos.
//
//   POST /api/ingresar          { usuario, clave }       → { token, nombre, debe_cambiar_clave }
//   POST /api/cambiar-clave     { actual, nueva }        (Authorization: Bearer <token>)
//   GET  /api/mis-tramites                                (Authorization: Bearer <token>)
//   GET  /api/consulta/:dni     solo el DNI del ciudadano autenticado
//   POST /api/salir
//
// Variables de entorno:
//   URBANITO_URL  dirección del servidor de URBANITO (por defecto http://127.0.0.1:7301)
//   PORT          puerto del portal (por defecto 7302)
// ===========================================================================

const path = require('path')
const express = require('express')

const URBANITO = (process.env.URBANITO_URL || 'http://127.0.0.1:7301').replace(/\/$/, '')
const PUERTO = Number(process.env.PORT || 7302)

async function urbanito(accion, datos) {
  try {
    const r = await fetch(`${URBANITO}/urbanito/api`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion, datos }), signal: AbortSignal.timeout(15000),
    })
    return await r.json()
  } catch (_) {
    return { ok: false, codigo: 'RED', error: 'El servicio de consulta no está disponible en este momento. Intente más tarde.' }
  }
}

const token = (req) => {
  const a = req.headers.authorization || ''
  return a.startsWith('Bearer ') ? a.slice(7) : null
}

const responder = (res, r) => {
  const estado = r.ok ? 200 : r.codigo === 'SESION' ? 401 : r.codigo === 'PERMISO' ? 403 : r.codigo === 'RED' ? 503 : 400
  res.status(estado).json(r.ok ? r.datos : { error: r.error, codigo: r.codigo })
}

function crearApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '10kb' }))
  // cabeceras de seguridad básicas (la página no carga nada externo)
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
    })
    next()
  })

  // límite simple de intentos por IP para el ingreso (además del bloqueo por usuario en URBANITO)
  const intentos = new Map()
  const limitar = (req, res, next) => {
    const ip = req.ip
    const ahora = Date.now()
    const r = (intentos.get(ip) || []).filter(t => ahora - t < 10 * 60000)
    if (r.length >= 20) return res.status(429).json({ error: 'Demasiados intentos. Espere unos minutos.' })
    r.push(ahora); intentos.set(ip, r)
    next()
  }

  app.post('/api/ingresar', limitar, async (req, res) => {
    const { usuario, clave } = req.body || {}
    responder(res, await urbanito('portal_ingresar', { usuario: String(usuario || '').slice(0, 120), clave: String(clave || '').slice(0, 100) }))
  })
  app.post('/api/cambiar-clave', async (req, res) => {
    const { actual, nueva } = req.body || {}
    responder(res, await urbanito('portal_cambiar_clave', { token: token(req), actual, nueva }))
  })
  app.get('/api/mis-tramites', async (req, res) => responder(res, await urbanito('portal_mis_tramites', { token: token(req) })))
  app.get('/api/consulta/:dni', async (req, res) => {
    if (!/^\d{8}$/.test(req.params.dni)) return res.status(400).json({ error: 'DNI inválido.' })
    responder(res, await urbanito('portal_consulta_dni', { token: token(req), dni: req.params.dni }))
  })
  app.post('/api/salir', async (req, res) => responder(res, await urbanito('portal_salir', { token: token(req) })))

  app.use(express.static(path.join(__dirname, 'publico'), { index: 'index.html' }))
  return app
}

if (require.main === module) {
  crearApp().listen(PUERTO, () => {
    console.log(`Portal ciudadano de URBANITO en http://localhost:${PUERTO} (consulta a ${URBANITO})`)
  })
}

module.exports = { crearApp }
