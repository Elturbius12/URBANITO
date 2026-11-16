// Servidor de red local: permite que otras PCs de la oficina usen URBANITO
// conectándose a la PC que guarda los datos.

const http = require('http')
const os = require('os')
const { despachar, CON_ARCHIVO } = require('./servicios/api')

const LIMITE_CUERPO = 2 * 1024 * 1024
// Importación: el archivo (hasta 50 MB) viaja en base64 dentro del JSON
const LIMITE_ARCHIVO = 72 * 1024 * 1024
const RUTA_API = '/urbanito/api'
const RUTA_IMPORTAR = '/urbanito/importar'

function ipsLocales() {
  const ips = []
  for (const [nombre, lista] of Object.entries(os.networkInterfaces())) {
    for (const i of lista || []) {
      if (i.family === 'IPv4' && !i.internal) ips.push({ interfaz: nombre, ip: i.address })
    }
  }
  return ips
}

function crearServidor(sistema, registrar = () => {}) {
  return http.createServer((req, res) => {
    const responder = (codigo, obj) => {
      const cuerpo = JSON.stringify(obj)
      res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8',
                              'Content-Length': Buffer.byteLength(cuerpo) })
      res.end(cuerpo)
    }
    if (req.method === 'GET' && req.url === '/urbanito/ping') {
      return responder(200, { ok: true, servicio: 'URBANITO', version: 1 })
    }
    // Polling de notificaciones: GET /api/notificaciones-nuevas?desde=ISO (con «Authorization: Bearer <token>»)
    if (req.method === 'GET' && req.url.startsWith('/api/notificaciones-nuevas')) {
      const auth = req.headers.authorization || ''
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
      const desde = new URL(req.url, 'http://local').searchParams.get('desde') || undefined
      return despachar(sistema, 'notificaciones_nuevas', { desde }, token, { local: false })
        .then(r => { delete r.detalle; responder(r.ok ? 200 : (r.codigo === 'SESION' ? 401 : 400), r) })
    }
    if (req.method !== 'POST' || (req.url !== RUTA_API && req.url !== RUTA_IMPORTAR)) return responder(404, { ok: false, error: 'No encontrado' })
    const limite = req.url === RUTA_IMPORTAR ? LIMITE_ARCHIVO : LIMITE_CUERPO

    let tam = 0
    const partes = []
    req.on('data', (c) => {
      tam += c.length
      if (tam > limite) {
        responder(413, { ok: false, error: req.url === RUTA_IMPORTAR ? 'El archivo es demasiado grande (máximo 50 MB).' : 'Solicitud demasiado grande' })
        req.destroy()
      } else partes.push(c)
    })
    req.on('end', async () => {
      if (res.writableEnded) return
      let cuerpo
      try { cuerpo = JSON.parse(Buffer.concat(partes).toString('utf8')) } catch (_) {
        return responder(400, { ok: false, error: 'Solicitud inválida' })
      }
      const auth = req.headers.authorization || ''
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
      const accion = String(cuerpo.accion || '')
      // el canal grande solo acepta las acciones que llevan archivo
      if (req.url === RUTA_IMPORTAR && !CON_ARCHIVO.has(accion)) return responder(400, { ok: false, error: 'Solicitud inválida' })
      const r = await despachar(sistema, accion, cuerpo.datos, token, { local: false })
      if (!r.ok && r.codigo === 'INTERNO') registrar(`error remoto en ${cuerpo.accion}: ${r.detalle}`)
      delete r.detalle
      responder(200, r)
    })
  })
}

class ServidorRed {
  constructor(sistema, registrar) {
    this.sistema = sistema
    this.registrar = registrar
    this.servidor = null
    this.puerto = null
  }

  activo() {
    return !!this.servidor
  }

  iniciar(puerto) {
    return new Promise((resolve, reject) => {
      if (this.servidor) return resolve()
      const srv = crearServidor(this.sistema, this.registrar)
      srv.once('error', (err) => {
        reject(new Error(err.code === 'EADDRINUSE'
          ? `El puerto ${puerto} ya está en uso por otro programa. Elija otro puerto.`
          : `No se pudo abrir el servidor de red: ${err.message}`))
      })
      srv.listen(puerto, '0.0.0.0', () => {
        this.servidor = srv
        this.puerto = puerto
        resolve()
      })
    })
  }

  detener() {
    return new Promise((resolve) => {
      if (!this.servidor) return resolve()
      this.servidor.close(() => resolve())
      this.servidor = null
    })
  }
}

// Llamada desde una PC cliente
async function llamarRemoto(url, accion, datos, token, tiempoMs = 30000) {
  const conArchivo = CON_ARCHIVO.has(accion)
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), conArchivo ? Math.max(tiempoMs, 15 * 60 * 1000) : tiempoMs)
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}${conArchivo ? RUTA_IMPORTAR : RUTA_API}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ accion, datos }),
      signal: ctrl.signal,
    })
    if (r.status === 413) return { ok: false, error: 'El archivo es demasiado grande para enviarlo al servidor (máximo 50 MB).', codigo: 'VALIDACION' }
    if (!r.ok) return { ok: false, error: `El servidor respondió con un error (${r.status}).`, codigo: 'RED' }
    return await r.json()
  } catch (err) {
    return { ok: false, codigo: 'RED',
             error: `No se pudo conectar con el servidor URBANITO (${url}). Verifique que la PC servidor esté encendida, con URBANITO abierto y en la misma red.` }
  } finally {
    clearTimeout(t)
  }
}

async function probarServidor(url) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 5000)
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/urbanito/ping`, { signal: ctrl.signal })
    const j = await r.json()
    return j && j.servicio === 'URBANITO'
  } catch (_) {
    return false
  } finally {
    clearTimeout(t)
  }
}

module.exports = { ServidorRed, llamarRemoto, probarServidor, ipsLocales }
