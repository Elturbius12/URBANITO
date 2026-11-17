// Comunicación de la interfaz con el núcleo (servidor web URBANITO).
import { useCallback, useEffect, useRef, useState } from 'react'

let token = null
let alExpirar = null
let departamentoActivo = null

// «Departamento activo» elegido en la cabecera (estado de la interfaz, no de la base).
// Se envía en cada llamada; el núcleo lo valida y lo aplica a las consultas.
export function fijarDepartamentoActivo(c) { departamentoActivo = c || null }

export function fijarToken(t) { token = t }
export function obtenerToken() { return token }
export function alExpirarSesion(fn) { alExpirar = fn }

// Acciones que llevan un archivo en base64 (usan el canal de mayor tamaño)
const CON_ARCHIVO = new Set(['importar_previsualizar', 'importar_confirmar', 'importar2026_previsualizar', 'importar2026_confirmar', 'subir_tupa'])

async function enviar(accion, datos) {
  try {
    const res = await fetch(CON_ARCHIVO.has(accion) ? '/urbanito/importar' : '/urbanito/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ accion, datos }),
    })
    if (res.status === 413) return { ok: false, error: 'El archivo es demasiado grande para enviarlo al servidor (máximo 50 MB).', codigo: 'VALIDACION' }
    if (!res.ok) return { ok: false, error: `El servidor respondió con un error (${res.status}).`, codigo: 'RED' }
    return await res.json()
  } catch (_) {
    return { ok: false, error: 'No se pudo conectar con el servidor URBANITO.', codigo: 'RED' }
  }
}

export async function llamar(accion, datos) {
  const d = departamentoActivo ? { ...(datos || {}), departamento_activo: departamentoActivo } : (datos || {})
  const r = await enviar(accion, d)
  if (!r.ok) {
    if (r.codigo === 'SESION' && alExpirar) alExpirar(r.error)
    const e = new Error(r.error || 'Error desconocido')
    e.codigo = r.codigo
    throw e
  }
  return r.datos
}

// Carga datos y los vuelve a pedir cuando cambian las dependencias.
export function useDatos(accion, datos, deps = []) {
  const [estado, setEstado] = useState({ datos: null, error: null, cargando: true })
  const vivo = useRef(true)
  const clave = JSON.stringify(datos || {})
  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setEstado(s => ({ ...s, cargando: true, error: null }))
    try {
      const d = await llamar(accion, datos)
      if (vivo.current) setEstado({ datos: d, error: null, cargando: false })
    } catch (e) {
      if (vivo.current) setEstado(s => ({ datos: silencioso ? s.datos : null, error: e.message, cargando: false }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accion, clave])
  useEffect(() => {
    vivo.current = true
    cargar()
    return () => { vivo.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargar, ...deps])
  return { ...estado, recargar: cargar }
}
