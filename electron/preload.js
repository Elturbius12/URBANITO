// Puente seguro entre la interfaz y el proceso principal.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('urbanito', {
  api: (accion, datos, token) => ipcRenderer.invoke('urbanito:api', accion, datos, token),
  equipo: () => ipcRenderer.invoke('urbanito:equipo'),
  elegirModo: (opciones) => ipcRenderer.invoke('urbanito:elegir-modo', opciones),
  cambiarModo: () => ipcRenderer.invoke('urbanito:cambiar-modo'),
  red: (opciones) => ipcRenderer.invoke('urbanito:red', opciones),
  excel: (spec) => ipcRenderer.invoke('urbanito:excel', spec),
  pdf: (opciones) => ipcRenderer.invoke('urbanito:pdf', opciones),
  imprimir: (opciones) => ipcRenderer.invoke('urbanito:imprimir', opciones),
  abrirArchivo: (ruta) => ipcRenderer.invoke('urbanito:abrir-archivo', ruta),
  exportarRespaldo: (opciones) => ipcRenderer.invoke('urbanito:exportar-respaldo', opciones),
  restaurarRespaldo: (opciones) => ipcRenderer.invoke('urbanito:restaurar-respaldo', opciones),
  abrirCarpetaDatos: (opciones) => ipcRenderer.invoke('urbanito:abrir-carpeta-datos', opciones),
  // importación: el archivo lo lee el proceso principal de ESTA PC (nunca el renderer)
  elegirArchivoImportacion: () => ipcRenderer.invoke('urbanito:elegir-archivo-importacion'),
  guardarArchivo: (opciones) => ipcRenderer.invoke('urbanito:guardar-archivo', opciones),
  alProgreso: (fn) => {
    const oyente = (_e, p) => fn(p)
    ipcRenderer.on('urbanito:progreso', oyente)
    return () => ipcRenderer.removeListener('urbanito:progreso', oyente)
  },
})
