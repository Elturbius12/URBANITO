// URBANITO — servidor web (sirve la interfaz y la API sobre HTTP).
//   npm run build && npm start
// Variables de entorno:
//   PORT     puerto de escucha (por defecto 3000)
//   DB_PATH  ruta del archivo urbanito.db (por defecto ./urbanito.db). En Railway,
//            apúntela al Volume, p. ej. /data/urbanito.db. Los respaldos se guardan
//            en la carpeta «respaldos» junto a la base.

const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const { Sistema } = require('./electron/servicios/sistema')
const { despachar, CON_ARCHIVO } = require('./electron/servicios/api')
const { generarExcel } = require('./electron/exportar')

const RAIZ = __dirname
const RUTA_BD = path.resolve(process.env.DB_PATH || path.join(RAIZ, 'urbanito.db'))
const CARPETA_DATOS = path.dirname(RUTA_BD)
const CARPETA_RESPALDOS = path.join(CARPETA_DATOS, 'respaldos')
const RUTA_REGISTRO = path.join(CARPETA_DATOS, 'registro.log')
const SEMILLA = path.join(RAIZ, 'semilla', 'urbanito.db')
const DIST = path.join(RAIZ, 'dist')
const PUERTO = Number(process.env.PORT) || 3000

const LIMITE_CUERPO = 2 * 1024 * 1024
// Importación / restauración: el archivo (hasta 50 MB) viaja en base64 dentro del JSON
const LIMITE_ARCHIVO = 72 * 1024 * 1024
const LIMITE_EXCEL = 20 * 1024 * 1024

fs.mkdirSync(CARPETA_DATOS, { recursive: true })

function registrar(msg) {
  try { fs.appendFileSync(RUTA_REGISTRO, `[${new Date().toISOString()}] ${msg}\n`) } catch (_) { /* sin disco */ }
}
const consolaError = console.error
console.error = (...a) => { registrar(a.map(x => (x && x.stack) || String(x)).join(' ')); consolaError(...a) }
process.on('uncaughtException', (e) => registrar(`excepción no controlada: ${e.stack || e}`))
process.on('unhandledRejection', (e) => registrar(`promesa rechazada: ${(e && e.stack) || e}`))

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.map': 'application/json',
}

let sistema = null

async function iniciarSistema() {
  if (!fs.existsSync(RUTA_BD)) {
    if (!fs.existsSync(SEMILLA)) throw new Error(`No se encontró la base inicial (${SEMILLA}).`)
    fs.copyFileSync(SEMILLA, RUTA_BD)
    registrar('Base de datos creada a partir de la base inicial')
  }
  const s = new Sistema({ rutaBd: RUTA_BD, carpetaRespaldos: CARPETA_RESPALDOS, fechaFija: process.env.URBANITO_HOY || null })
  await s.iniciar()
  sistema = s
}

function tokenDe(req) {
  const auth = req.headers.authorization || ''
  return auth.startsWith('Bearer ') ? auth.slice(7) : null
}

function esAdministrador(token) {
  try { return sistema.usuarioDeSesion(token).rol === 'ADMINISTRADOR' } catch (_) { return false }
}

function sesionValida(token) {
  try { sistema.usuarioDeSesion(token); return true } catch (_) { return false }
}

function responder(res, codigo, obj) {
  const cuerpo = JSON.stringify(obj)
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(cuerpo) })
  res.end(cuerpo)
}

function leerJson(req, res, limite, mensajeGrande) {
  return new Promise((resolve) => {
    let tam = 0
    const partes = []
    req.on('data', (c) => {
      tam += c.length
      if (tam > limite) {
        responder(res, 413, { ok: false, error: mensajeGrande || 'Solicitud demasiado grande' })
        req.destroy()
        resolve(null)
      } else partes.push(c)
    })
    req.on('end', () => {
      if (res.writableEnded) return resolve(null)
      try { resolve(JSON.parse(Buffer.concat(partes).toString('utf8'))) } catch (_) {
        responder(res, 400, { ok: false, error: 'Solicitud inválida' })
        resolve(null)
      }
    })
  })
}

function nombreDescarga(nombre) {
  const limpio = String(nombre || 'archivo').replace(/[\\/:*?"<>|\r\n]/g, ' ')
  return `attachment; filename="${limpio.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(limpio)}`
}

// ------------------------------------------------------------------ estáticos (SPA)
function servirEstatico(req, res) {
  let ruta
  try { ruta = decodeURIComponent(new URL(req.url, 'http://local').pathname) } catch (_) { ruta = '/' }
  let archivo = path.normalize(path.join(DIST, ruta))
  if (!archivo.startsWith(DIST)) { res.writeHead(403); return res.end() }
  if (!fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) archivo = path.join(DIST, 'index.html')
  if (!fs.existsSync(archivo)) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end('Falta la interfaz compilada (dist/). Ejecute «npm run build».')
  }
  const ext = path.extname(archivo).toLowerCase()
  const cache = archivo.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'
  res.writeHead(200, { 'Content-Type': TIPOS[ext] || 'application/octet-stream', 'Cache-Control': cache })
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(archivo).pipe(res)
}

// ------------------------------------------------------------------ rutas
async function manejar(req, res) {
  const url = new URL(req.url, 'http://local')
  const ruta = url.pathname

  if (req.method === 'GET' && ruta === '/urbanito/ping') {
    return responder(res, 200, { ok: true, servicio: 'URBANITO', version: 1 })
  }
  if (!sistema && ruta.startsWith('/urbanito/')) {
    return responder(res, 503, { ok: false, error: 'El sistema se está iniciando. Intente de nuevo en unos segundos.', codigo: 'INTERNO' })
  }

  // Polling de notificaciones: GET /api/notificaciones-nuevas?desde=ISO (con «Authorization: Bearer <token>»)
  if (req.method === 'GET' && ruta === '/api/notificaciones-nuevas') {
    const desde = url.searchParams.get('desde') || undefined
    const r = await despachar(sistema, 'notificaciones_nuevas', { desde }, tokenDe(req), { local: false })
    delete r.detalle
    return responder(res, r.ok ? 200 : (r.codigo === 'SESION' ? 401 : 400), r)
  }

  if (req.method === 'POST' && (ruta === '/urbanito/api' || ruta === '/urbanito/importar')) {
    const importar = ruta === '/urbanito/importar'
    const cuerpo = await leerJson(req, res, importar ? LIMITE_ARCHIVO : LIMITE_CUERPO,
      importar ? 'El archivo es demasiado grande (máximo 50 MB).' : null)
    if (!cuerpo) return
    const accion = String(cuerpo.accion || '')
    // el canal grande solo acepta las acciones que llevan archivo
    if (importar && !CON_ARCHIVO.has(accion)) return responder(res, 400, { ok: false, error: 'Solicitud inválida' })
    const r = await despachar(sistema, accion, cuerpo.datos, tokenDe(req), { local: false })
    if (!r.ok && r.codigo === 'INTERNO') registrar(`error en ${accion}: ${r.detalle}`)
    delete r.detalle
    return responder(res, 200, r)
  }

  // Descarga de un respaldo (solo administrador). Sin «nombre», crea uno nuevo y lo descarga.
  if (req.method === 'GET' && ruta === '/urbanito/respaldo') {
    const token = url.searchParams.get('token')
    if (!esAdministrador(token)) return responder(res, 403, { ok: false, error: 'Solo el administrador puede descargar respaldos.' })
    let nombre = url.searchParams.get('nombre')
    if (!nombre) {
      const c = await despachar(sistema, 'crear_respaldo', {}, token, { local: false })
      if (!c.ok) { delete c.detalle; return responder(res, 400, c) }
      nombre = c.datos.nombre
    }
    let origen
    try { origen = sistema.rutaRespaldo(nombre) } catch (err) { return responder(res, 404, { ok: false, error: err.message }) }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fs.statSync(origen).size,
                         'Content-Disposition': nombreDescarga(nombre) })
    return fs.createReadStream(origen).pipe(res)
  }

  // Restaurar: { nombre } (un respaldo del servidor) o { nombre_archivo, base64 } (archivo subido)
  if (req.method === 'POST' && ruta === '/urbanito/restaurar') {
    const token = tokenDe(req)
    const cuerpo = await leerJson(req, res, LIMITE_ARCHIVO, 'El archivo es demasiado grande.')
    if (!cuerpo) return
    if (!esAdministrador(token)) return responder(res, 200, { ok: false, error: 'Solo el administrador puede restaurar respaldos.', codigo: 'PERMISO' })
    let rutaArchivo
    let temporal = null
    if (cuerpo.base64) {
      temporal = path.join(os.tmpdir(), `urbanito_restaurar_${crypto.randomBytes(8).toString('hex')}.db`)
      fs.writeFileSync(temporal, Buffer.from(String(cuerpo.base64), 'base64'))
      rutaArchivo = temporal
    } else {
      try { rutaArchivo = sistema.rutaRespaldo(String(cuerpo.nombre || '')) } catch (err) { return responder(res, 200, { ok: false, error: err.message }) }
    }
    try {
      // el propio servidor es quien maneja el archivo: equivale a la «PC servidor»
      const r = await despachar(sistema, 'restaurar_respaldo', { ruta: rutaArchivo }, token, { local: true })
      if (!r.ok && r.codigo === 'INTERNO') registrar(`error en restaurar_respaldo: ${r.detalle}`)
      delete r.detalle
      return responder(res, 200, r)
    } finally {
      if (temporal) fs.rm(temporal, { force: true }, () => {})
    }
  }

  // Excel: recibe el spec { archivo, hojas } y devuelve el .xlsx como descarga
  if (req.method === 'POST' && ruta === '/urbanito/excel') {
    const cuerpo = await leerJson(req, res, LIMITE_EXCEL)
    if (!cuerpo) return
    if (!sesionValida(tokenDe(req))) return responder(res, 401, { ok: false, error: 'Su sesión terminó.', codigo: 'SESION' })
    if (!Array.isArray(cuerpo.hojas)) return responder(res, 400, { ok: false, error: 'Solicitud inválida' })
    try {
      const buf = await generarExcel(cuerpo)
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Length': buf.length,
        'Content-Disposition': nombreDescarga(`${cuerpo.archivo || 'reporte'}.xlsx`),
      })
      return res.end(buf)
    } catch (err) {
      registrar(`excel: ${err.stack}`)
      return responder(res, 500, { ok: false, error: `No se pudo generar el archivo: ${err.message}` })
    }
  }

  if (ruta.startsWith('/urbanito/') || ruta.startsWith('/api/')) return responder(res, 404, { ok: false, error: 'No encontrado' })
  if (req.method === 'GET' || req.method === 'HEAD') return servirEstatico(req, res)
  return responder(res, 405, { ok: false, error: 'Método no permitido' })
}

const servidor = http.createServer((req, res) => {
  manejar(req, res).catch((err) => {
    registrar(`fallo en ${req.method} ${req.url}: ${err.stack || err}`)
    if (!res.headersSent) responder(res, 500, { ok: false, error: 'Ocurrió un error interno.', codigo: 'INTERNO' })
    else res.end()
  })
})
servidor.requestTimeout = 15 * 60 * 1000

servidor.listen(PUERTO, () => {
  console.log(`URBANITO escuchando en el puerto ${PUERTO} (base: ${RUTA_BD})`)
})

iniciarSistema().then(() => console.log('URBANITO: base de datos lista')).catch((err) => {
  registrar(`fallo al abrir la base: ${err.stack || err}`)
  consolaError(`No se pudo abrir la base de datos: ${err.message}`)
  process.exit(1)
})

const cerrar = () => {
  try { if (sistema) sistema.detener() } catch (_) { /* ya cerrada */ }
  servidor.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 5000).unref()
}
process.on('SIGTERM', cerrar)
process.on('SIGINT', cerrar)
