// Manejo de archivos en el navegador: elegir archivos para importar y descargar archivos generados.

const LIMITE_ARCHIVO = 50 * 1024 * 1024

const CONF = {
  general: { accept: '.xlsx,.xls,.csv', rx: /\.(xlsx|xls|csv)$/i, varios: true, ext: '.xlsx o .csv' },
  control2026: { accept: '.xlsx,.xls', rx: /\.(xlsx|xls)$/i, varios: false, ext: '.xlsx' },
  tupa: { accept: '.pdf,.xlsx', rx: /\.(pdf|xlsx)$/i, varios: false, ext: '.pdf o .xlsx' },
}

function leerBase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader()
    lector.onload = () => resolve(String(lector.result).split(',')[1] || '')
    lector.onerror = () => reject(new Error(`No se pudo leer "${archivo.name}".`))
    lector.readAsDataURL(archivo)
  })
}

// Abre el selector de archivos (un <input type="file"> oculto) y devuelve
// { ok, archivos: [{ nombre, base64, tamano }] } | { cancelado } | { ok: false, error }
export function elegirArchivoImportacion(tipo = 'general') {
  const conf = CONF[tipo] || CONF.general
  return new Promise((resolve) => {
    const entrada = document.createElement('input')
    entrada.type = 'file'
    entrada.accept = conf.accept
    entrada.multiple = conf.varios
    entrada.style.display = 'none'
    entrada.addEventListener('change', async () => {
      const lista = Array.from(entrada.files || [])
      entrada.remove()
      if (!lista.length) return resolve({ ok: false, cancelado: true })
      if (lista.length > 2) return resolve({ ok: false, error: 'Seleccione un solo Excel, o hasta dos CSV (expedientes y movimientos).' })
      const archivos = []
      for (const a of lista) {
        if (!conf.rx.test(a.name)) return resolve({ ok: false, error: `"${a.name}": solo se aceptan archivos ${conf.ext}.` })
        if (!a.size) return resolve({ ok: false, error: `"${a.name}" está vacío.` })
        if (a.size > LIMITE_ARCHIVO) {
          return resolve({ ok: false, error: `"${a.name}" pesa ${(a.size / 1048576).toFixed(1)} MB; el máximo es 50 MB. Divídalo en partes más pequeñas.` })
        }
        try { archivos.push({ nombre: a.name, base64: await leerBase64(a), tamano: a.size }) } catch (e) { return resolve({ ok: false, error: e.message }) }
      }
      resolve({ ok: true, archivos })
    })
    entrada.addEventListener('cancel', () => { entrada.remove(); resolve({ ok: false, cancelado: true }) })
    document.body.appendChild(entrada)
    entrada.click()
  })
}

// Solo lo que el núcleo espera: [{ nombre, base64 }]
export const paraEnviar = (archivos) => archivos.map(({ nombre, base64 }) => ({ nombre, base64 }))

export function descargarBlob(nombre, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export function descargarBase64(nombre, base64) {
  const bin = atob(String(base64 || ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  descargarBlob(String(nombre).replace(/[\/:*?"<>|]/g, ' '), new Blob([bytes]))
  return { ok: true }
}
