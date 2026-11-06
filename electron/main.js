// URBANITO — proceso principal del programa de escritorio.

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const { Sistema } = require('./servicios/sistema')
const { despachar, CON_ARCHIVO } = require('./servicios/api')
const { ServidorRed, llamarRemoto, probarServidor, ipsLocales } = require('./servidorRed')
const { generarExcel, generarPdf, imprimir } = require('./exportar')

// --------------------------------------------------------------- rutas
const CARPETA_DATOS = process.env.URBANITO_DATOS || path.join(app.getPath('userData'), 'datos')
const RUTA_BD = path.join(CARPETA_DATOS, 'urbanito.db')
const CARPETA_RESPALDOS = path.join(CARPETA_DATOS, 'respaldos')
const RUTA_CONFIG = path.join(CARPETA_DATOS, 'configuracion-equipo.json')
const RUTA_REGISTRO = path.join(CARPETA_DATOS, 'registro.log')
const SEMILLA = app.isPackaged
  ? path.join(process.resourcesPath, 'semilla', 'urbanito.db')
  : path.join(__dirname, '..', 'semilla', 'urbanito.db')
const PUERTO_DEFECTO = 7301

fs.mkdirSync(CARPETA_DATOS, { recursive: true })

// Calendarios, fechas y números en español del Perú, sin importar el idioma de Windows
app.commandLine.appendSwitch('lang', 'es-PE')

function registrar(msg) {
  try { fs.appendFileSync(RUTA_REGISTRO, `[${new Date().toISOString()}] ${msg}\n`) } catch (_) { /* sin disco */ }
}
const consolaError = console.error
console.error = (...a) => { registrar(a.map(x => (x && x.stack) || String(x)).join(' ')); consolaError(...a) }
process.on('uncaughtException', (e) => registrar(`excepción no controlada: ${e.stack || e}`))
process.on('unhandledRejection', (e) => registrar(`promesa rechazada: ${(e && e.stack) || e}`))

function leerConfig() {
  try { return JSON.parse(fs.readFileSync(RUTA_CONFIG, 'utf8')) } catch (_) { return {} }
}
function guardarConfig(c) {
  fs.writeFileSync(RUTA_CONFIG, JSON.stringify(c, null, 2))
}

let config = leerConfig()
if (process.env.URBANITO_MODO) config.modo = process.env.URBANITO_MODO

let sistema = null
let red = null
let ventana = null

// --------------------------------------------------------------- arranque de datos
async function iniciarSistema() {
  if (sistema) return
  if (!fs.existsSync(RUTA_BD)) {
    if (!fs.existsSync(SEMILLA)) throw new Error(`No se encontró la base inicial (${SEMILLA}).`)
    fs.copyFileSync(SEMILLA, RUTA_BD)
    registrar('Base de datos creada a partir de la base inicial')
  }
  const s = new Sistema({ rutaBd: RUTA_BD, carpetaRespaldos: CARPETA_RESPALDOS,
                          fechaFija: process.env.URBANITO_HOY || null })
  try {
    await s.iniciar()
  } catch (err) {
    registrar(`fallo al abrir la base: ${err.stack || err}`)
    const autos = fs.existsSync(CARPETA_RESPALDOS)
      ? fs.readdirSync(CARPETA_RESPALDOS).filter(f => f.endsWith('.db')).sort().reverse() : []
    const r = await dialog.showMessageBox({
      type: 'error', title: 'URBANITO',
      message: 'No se pudo abrir la base de datos.',
      detail: `${err.message}\n\n${autos.length ? `Último respaldo disponible: ${autos[0]}` : 'No hay respaldos disponibles.'}`,
      buttons: autos.length ? ['Restaurar el último respaldo', 'Salir'] : ['Salir'],
      defaultId: 0, cancelId: autos.length ? 1 : 0,
    })
    if (autos.length && r.response === 0) {
      fs.copyFileSync(RUTA_BD, `${RUTA_BD}.danada-${Date.now()}`)
      fs.copyFileSync(path.join(CARPETA_RESPALDOS, autos[0]), RUTA_BD)
      return iniciarSistema()
    }
    app.exit(1)
    return
  }
  sistema = s
  red = new ServidorRed(sistema, registrar)
  if (config.red_habilitada) {
    try { await red.iniciar(config.puerto || PUERTO_DEFECTO) } catch (err) { registrar(err.message) }
  }
}

// --------------------------------------------------------------- archivos de importación
// El archivo elegido se lee aquí (en la PC que importa) y se guarda en memoria;
// la interfaz solo recibe un identificador. Al llamar a una acción de
// importación se adjunta el contenido en base64, para el servidor local o el
// remoto (que nunca ve el disco de esta PC).
const LIMITE_ARCHIVO = 50 * 1024 * 1024
const archivosImportacion = new Map()

function adjuntarArchivos(accion, datos) {
  if (!CON_ARCHIVO.has(accion) || !datos || !Array.isArray(datos.archivos_ids)) return datos
  const archivos = datos.archivos_ids.map(id => archivosImportacion.get(String(id))).filter(Boolean)
  const { archivos_ids, ...resto } = datos
  if (archivos.length !== archivos_ids.length) return { ...resto, archivos: [] }
  return { ...resto, archivos: archivos.map(a => ({ nombre: a.nombre, base64: a.contenido.toString('base64') })) }
}

// --------------------------------------------------------------- llamadas de la interfaz
async function llamar(accion, datos, token) {
  datos = adjuntarArchivos(accion, datos)
  if (config.modo === 'cliente') return llamarRemoto(config.servidor_url, accion, datos, token)
  if (!sistema) return { ok: false, error: 'El sistema no está iniciado.', codigo: 'INTERNO' }
  const progreso = (p) => { if (ventana && !ventana.isDestroyed()) ventana.webContents.send('urbanito:progreso', p) }
  return despachar(sistema, accion, datos, token, { local: true, progreso })
}

function esAdministrador(token) {
  try {
    const u = sistema.usuarioDeSesion(token)
    return u.rol === 'ADMINISTRADOR'
  } catch (_) {
    return false
  }
}

function infoEquipo() {
  return {
    version: app.getVersion(),
    modo: config.modo || null,
    servidor_url: config.servidor_url || null,
    red_habilitada: !!(red && red.activo()),
    puerto: (red && red.puerto) || config.puerto || PUERTO_DEFECTO,
    ips: ipsLocales(),
    carpeta_datos: CARPETA_DATOS,
    plataforma: process.platform,
  }
}

function registrarIpc() {
  ipcMain.handle('urbanito:api', (_e, accion, datos, token) => llamar(accion, datos, token))

  ipcMain.handle('urbanito:equipo', () => infoEquipo())

  ipcMain.handle('urbanito:elegir-modo', async (_e, { modo, servidor_url }) => {
    if (modo === 'servidor') {
      config = { ...config, modo: 'servidor' }
      guardarConfig(config)
      await iniciarSistema()
      return { ok: true }
    }
    if (modo === 'cliente') {
      let url = String(servidor_url || '').trim()
      if (!/^https?:\/\//.test(url)) url = `http://${url}`
      if (!/:\d+$/.test(url.replace(/\/$/, ''))) url = `${url.replace(/\/$/, '')}:${PUERTO_DEFECTO}`
      if (!(await probarServidor(url))) {
        return { ok: false, error: `No se encontró un servidor URBANITO en ${url}. Verifique la dirección y que la PC servidor tenga activada la conexión en red.` }
      }
      config = { ...config, modo: 'cliente', servidor_url: url }
      guardarConfig(config)
      return { ok: true, servidor_url: url }
    }
    return { ok: false, error: 'Modo inválido' }
  })

  ipcMain.handle('urbanito:cambiar-modo', async () => {
    // vuelve a la pantalla de elección (no borra datos)
    config = { ...config, modo: null }
    guardarConfig(config)
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle('urbanito:red', async (_e, { token, habilitar, puerto }) => {
    if (config.modo !== 'servidor' || !esAdministrador(token)) {
      return { ok: false, error: 'Solo el administrador, en la PC servidor, puede cambiar esto.' }
    }
    const p = Number(puerto) || PUERTO_DEFECTO
    if (p < 1024 || p > 65535) return { ok: false, error: 'Puerto inválido (1024 a 65535).' }
    try {
      if (habilitar) {
        if (red.activo() && red.puerto !== p) await red.detener()
        await red.iniciar(p)
      } else {
        await red.detener()
      }
      config = { ...config, red_habilitada: !!habilitar, puerto: p }
      guardarConfig(config)
      return { ok: true, ...infoEquipo() }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('urbanito:excel', async (_e, spec) => {
    const r = await dialog.showSaveDialog(ventana, {
      title: 'Guardar reporte en Excel', defaultPath: `${spec.archivo || 'reporte'}.xlsx`,
      filters: [{ name: 'Libro de Excel', extensions: ['xlsx'] }],
    })
    if (r.canceled || !r.filePath) return { ok: false, cancelado: true }
    try {
      await generarExcel(spec, r.filePath)
      return { ok: true, ruta: r.filePath }
    } catch (err) {
      registrar(`excel: ${err.stack}`)
      return { ok: false, error: `No se pudo guardar el archivo: ${err.message}` }
    }
  })

  ipcMain.handle('urbanito:pdf', async (_e, { html, archivo, horizontal }) => {
    const r = await dialog.showSaveDialog(ventana, {
      title: 'Guardar como PDF', defaultPath: `${archivo || 'documento'}.pdf`,
      filters: [{ name: 'Documento PDF', extensions: ['pdf'] }],
    })
    if (r.canceled || !r.filePath) return { ok: false, cancelado: true }
    try {
      await generarPdf(html, r.filePath, { horizontal })
      return { ok: true, ruta: r.filePath }
    } catch (err) {
      registrar(`pdf: ${err.stack}`)
      return { ok: false, error: `No se pudo generar el PDF: ${err.message}` }
    }
  })

  ipcMain.handle('urbanito:imprimir', async (_e, { html }) => imprimir(html))

  ipcMain.handle('urbanito:abrir-archivo', async (_e, ruta) => {
    const err = await shell.openPath(ruta)
    return { ok: !err, error: err || null }
  })

  ipcMain.handle('urbanito:exportar-respaldo', async (_e, { token, nombre }) => {
    if (config.modo !== 'servidor' || !esAdministrador(token)) return { ok: false, error: 'Solo el administrador en la PC servidor.' }
    let origen
    try { origen = sistema.rutaRespaldo(nombre) } catch (err) { return { ok: false, error: err.message } }
    const r = await dialog.showSaveDialog(ventana, {
      title: 'Copiar respaldo a…', defaultPath: nombre, filters: [{ name: 'Base URBANITO', extensions: ['db'] }],
    })
    if (r.canceled || !r.filePath) return { ok: false, cancelado: true }
    fs.copyFileSync(origen, r.filePath)
    return { ok: true, ruta: r.filePath }
  })

  ipcMain.handle('urbanito:restaurar-respaldo', async (_e, { token, nombre }) => {
    if (config.modo !== 'servidor' || !esAdministrador(token)) return { ok: false, error: 'Solo el administrador en la PC servidor.' }
    let ruta
    if (nombre) {
      try { ruta = sistema.rutaRespaldo(nombre) } catch (err) { return { ok: false, error: err.message } }
    } else {
      const r = await dialog.showOpenDialog(ventana, {
        title: 'Elegir archivo de respaldo', properties: ['openFile'],
        filters: [{ name: 'Base URBANITO', extensions: ['db'] }],
      })
      if (r.canceled || !r.filePaths.length) return { ok: false, cancelado: true }
      ruta = r.filePaths[0]
    }
    const conf = await dialog.showMessageBox(ventana, {
      type: 'warning', title: 'Restaurar respaldo',
      message: 'Se reemplazarán TODOS los datos actuales por los del respaldo.',
      detail: 'Antes de restaurar se guardará automáticamente una copia de los datos actuales. Todos los usuarios deberán volver a ingresar.',
      buttons: ['Restaurar', 'Cancelar'], defaultId: 1, cancelId: 1,
    })
    if (conf.response !== 0) return { ok: false, cancelado: true }
    return despachar(sistema, 'restaurar_respaldo', { ruta }, token, { local: true })
  })

  ipcMain.handle('urbanito:elegir-archivo-importacion', async () => {
    const r = await dialog.showOpenDialog(ventana, {
      title: 'Elegir archivo de expedientes', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Excel o CSV', extensions: ['xlsx', 'csv'] }],
    })
    if (r.canceled || !r.filePaths.length) return { ok: false, cancelado: true }
    if (r.filePaths.length > 2) return { ok: false, error: 'Seleccione un solo Excel, o hasta dos CSV (expedientes y movimientos).' }
    archivosImportacion.clear()
    const lista = []
    for (const ruta of r.filePaths) {
      const nombre = path.basename(ruta)
      if (!/\.(xlsx|csv)$/i.test(nombre)) return { ok: false, error: `"${nombre}": solo se aceptan archivos .xlsx o .csv.` }
      const st = fs.statSync(ruta)
      if (!st.size) return { ok: false, error: `"${nombre}" está vacío.` }
      if (st.size > LIMITE_ARCHIVO) {
        return { ok: false, error: `"${nombre}" pesa ${(st.size / 1048576).toFixed(1)} MB; el máximo es 50 MB. Divídalo en partes más pequeñas.` }
      }
      const id = crypto.randomBytes(8).toString('hex')
      archivosImportacion.set(id, { nombre, contenido: fs.readFileSync(ruta) })
      lista.push({ id, nombre, tamano: st.size })
    }
    return { ok: true, archivos: lista }
  })

  // Guarda un archivo generado por el núcleo (plantilla de importación): { nombre, base64 }
  ipcMain.handle('urbanito:guardar-archivo', async (_e, { nombre, base64, titulo }) => {
    const ext = ((String(nombre).match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase()
    if (!['xlsx', 'csv'].includes(ext)) return { ok: false, error: 'Tipo de archivo no permitido.' }
    const r = await dialog.showSaveDialog(ventana, {
      title: titulo || 'Guardar archivo', defaultPath: String(nombre).replace(/[\\/:*?"<>|]/g, ' '),
      filters: [{ name: ext === 'xlsx' ? 'Libro de Excel' : 'CSV', extensions: [ext] }],
    })
    if (r.canceled || !r.filePath) return { ok: false, cancelado: true }
    try {
      fs.writeFileSync(r.filePath, Buffer.from(String(base64 || ''), 'base64'))
      return { ok: true, ruta: r.filePath }
    } catch (err) {
      return { ok: false, error: `No se pudo guardar el archivo: ${err.message}` }
    }
  })

  ipcMain.handle('urbanito:abrir-carpeta-datos', async (_e, { token }) => {
    if (config.modo !== 'servidor' || !esAdministrador(token)) return { ok: false }
    await shell.openPath(CARPETA_DATOS)
    return { ok: true }
  })
}

// --------------------------------------------------------------- ventana
function crearVentana() {
  ventana = new BrowserWindow({
    width: 1400, height: 860, minWidth: 1100, minHeight: 680,
    title: 'URBANITO', show: false, backgroundColor: '#f4f6f9',
    icon: path.join(__dirname, '..', 'recursos', 'icono.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
    },
  })
  ventana.once('ready-to-show', () => {
    if (!process.env.URBANITO_PRUEBA) ventana.maximize()
    ventana.show()
  })
  ventana.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  ventana.webContents.on('will-navigate', (e) => e.preventDefault())
  ventana.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && process.env.URBANITO_DEPURAR) ventana.webContents.openDevTools()
  })
  ventana.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

// Autoprueba del ejecutable empaquetado (para verificar el instalador antes de entregarlo).
// Se activa solo con la variable URBANITO_AUTOPRUEBA=<archivo de resultado>.
async function autoprueba(salida) {
  const r = { plataforma: process.platform, version: app.getVersion(), empaquetado: app.isPackaged, pasos: [] }
  const paso = (nombre, ok, detalle) => r.pasos.push({ nombre, ok, detalle })
  try {
    config = { modo: 'servidor' }
    await iniciarSistema()
    paso('abre la base inicial y calcula los modelos', !!sistema, `${sistema.almacen.expedientes.size} expedientes, IUA de ${sistema.r.iua.size}, base MTA ${sistema.r.mta.base_n}, ${sistema.r.duracion_ms} ms`)
    const conf = await despachar(sistema, 'configuracion_inicial', { nombre_completo: 'Autoprueba', usuario: 'autoprueba', clave: 'Autoprueba2026', crear_demo: false })
    paso('configuración inicial', conf.ok, conf.error)
    const lg = await despachar(sistema, 'login', { usuario: 'autoprueba', clave: 'Autoprueba2026' })
    paso('inicio de sesión', lg.ok, lg.error)
    const t = lg.datos.token
    const b = await despachar(sistema, 'bandeja', {}, t)
    paso('bandeja priorizada', b.ok && b.datos.filas.length > 0, b.ok ? `${b.datos.filas.length} expedientes; primero IUA ${b.datos.filas[0].iua.toFixed(3)}` : b.error)
    const reg = await despachar(sistema, 'registrar_expediente', { solicitante: 'Autoprueba Windows', documento_identidad: '40000000', procedimiento_codigo: 'NUM_PREDIAL', folios: 1 }, t)
    paso('registro de expediente y guardado en disco', reg.ok && fs.statSync(RUTA_BD).size > 1e6, reg.ok ? reg.datos.numero : reg.error)
    const m = await despachar(sistema, 'modelos', {}, t)
    paso('modelos IUA/MTA', m.ok && m.datos.ahp.consistente, m.ok ? `RC=${m.datos.ahp.rc.toFixed(6)}` : m.error)
    // interfaz
    crearVentana()
    await new Promise(res => ventana.webContents.once('did-finish-load', res))
    await new Promise(res => setTimeout(res, 4000))
    const img = await ventana.webContents.capturePage()
    fs.writeFileSync(`${salida}.png`, img.toPNG())
    const texto = await ventana.webContents.executeJavaScript('document.body.textContent')
    paso('la interfaz carga', texto.includes('URBANITO') && texto.includes('Ingresar'), texto.slice(0, 80).replace(/\n/g, ' | '))
  } catch (err) {
    paso('excepción', false, err.stack || String(err))
  }
  r.ok = r.pasos.every(p => p.ok)
  fs.writeFileSync(salida, JSON.stringify(r, null, 2))
  app.exit(r.ok ? 0 : 1)
}

const unica = (process.env.URBANITO_PRUEBA || process.env.URBANITO_AUTOPRUEBA) ? true : app.requestSingleInstanceLock()
if (process.env.URBANITO_AUTOPRUEBA) {
  app.whenReady().then(() => { Menu.setApplicationMenu(null); registrarIpc(); autoprueba(process.env.URBANITO_AUTOPRUEBA) })
} else if (!unica) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (ventana) { if (ventana.isMinimized()) ventana.restore(); ventana.focus() }
  })
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    registrarIpc()
    if (config.modo === 'servidor') {
      try { await iniciarSistema() } catch (err) {
        registrar(err.stack || String(err))
        dialog.showErrorBox('URBANITO', `No se pudo iniciar: ${err.message}`)
        app.exit(1)
        return
      }
    }
    crearVentana()
  })
  app.on('window-all-closed', async () => {
    if (red) await red.detener()
    if (sistema) sistema.detener()
    app.quit()
  })
}
