// Comunicación de la interfaz con el núcleo (en esta PC o en la PC servidor).
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

export async function llamar(accion, datos) {
  const d = departamentoActivo ? { ...(datos || {}), departamento_activo: departamentoActivo } : (datos || {})
  const r = await window.urbanito.api(accion, d, token)
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
