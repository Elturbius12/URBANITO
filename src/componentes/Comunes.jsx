// Piezas reutilizables de la interfaz.
import { createContext, useContext, useEffect, useState, useCallback } from 'react'

// ------------------------------------------------------------ contexto global
export const Contexto = createContext(null)
export const useApp = () => useContext(Contexto)

export function puede(usuario, permiso) {
  if (!usuario) return false
  return usuario.permisos.includes('*') || usuario.permisos.includes(permiso)
}

// ------------------------------------------------------------ notificaciones
export function useNotificaciones() {
  const [lista, setLista] = useState([])
  const notificar = useCallback((texto, tipo = 'info') => {
    const id = Math.random()
    setLista(l => [...l, { id, texto, tipo }])
    setTimeout(() => setLista(l => l.filter(n => n.id !== id)), tipo === 'error' ? 7000 : 4000)
  }, [])
  const vista = (
    <div className="notificaciones" role="status">
      {lista.map(n => <div key={n.id} className={`notificacion ${n.tipo}`}>{n.texto}</div>)}
    </div>
  )
  return { notificar, vista }
}

// ------------------------------------------------------------ bloques
export function Indicador({ etiqueta, valor, nota, tono, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className={`indicador ${tono || ''}`} onClick={onClick}>
      <div className="etiqueta">{etiqueta}</div>
      <div className="valor">{valor}</div>
      {nota && <div className="nota">{nota}</div>}
    </Tag>
  )
}

export function Panel({ titulo, descripcion, acciones, children, sinRelleno }) {
  return (
    <div className="panel">
      {(titulo || acciones) && (
        <div className="panel-cabecera">
          <div style={{ minWidth: 0 }}>
            {titulo && <h3>{titulo}</h3>}
            {descripcion && <div className="descripcion">{descripcion}</div>}
          </div>
          {acciones && <div style={{ marginLeft: 'auto' }}>{acciones}</div>}
        </div>
      )}
      <div className={`panel-cuerpo${sinRelleno ? ' sin-relleno' : ''}`}>{children}</div>
    </div>
  )
}

export function Nivel({ nivel }) {
  if (!nivel) return <span className="insignia neutra">—</span>
  return <span className={`insignia ${nivel}`}>{nivel}</span>
}

export function Insignia({ tipo = 'neutra', children }) {
  return <span className={`insignia ${tipo}`}>{children}</span>
}

export function Aviso({ tipo = 'advertencia', icono, children }) {
  const ic = icono || { advertencia: '⚠', informativo: 'ℹ', error: '✖', exito: '✔' }[tipo]
  return (
    <div className={`aviso ${tipo === 'advertencia' ? '' : tipo}`}>
      <span className="icono">{ic}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

export function Cargando({ texto = 'Cargando…' }) {
  return <div className="cargando">{texto}</div>
}

export function Vacio({ texto = 'No hay resultados' }) {
  return <div className="vacio">{texto}</div>
}

export function ErrorCarga({ error, reintentar }) {
  return (
    <Aviso tipo="error">
      {error} {reintentar && <button className="boton pequeno" style={{ marginLeft: 8 }} onClick={() => reintentar()}>Reintentar</button>}
    </Aviso>
  )
}

export function Modal({ titulo, children, pie, alCerrar, tamano = '' }) {
  useEffect(() => {
    const f = (e) => { if (e.key === 'Escape' && alCerrar) alCerrar() }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [alCerrar])
  return (
    <div className="fondo-modal" onMouseDown={(e) => { if (e.target === e.currentTarget && alCerrar) alCerrar() }}>
      <div className={`modal ${tamano}`} role="dialog" aria-modal="true" aria-label={typeof titulo === 'string' ? titulo : undefined}>
        <div className="modal-cabecera">
          {typeof titulo === 'string' ? <h3>{titulo}</h3> : titulo}
          {alCerrar && <button className="cerrar" onClick={alCerrar} aria-label="Cerrar">×</button>}
        </div>
        <div className="modal-cuerpo">{children}</div>
        {pie && <div className="modal-pie">{pie}</div>}
      </div>
    </div>
  )
}

export function Campo({ etiqueta, requerido, ayuda, children, completo }) {
  return (
    <div className={`campo${completo ? ' completo' : ''}`}>
      <label>{etiqueta}{requerido && <span className="req"> *</span>}</label>
      {children}
      {ayuda && <div className="ayuda">{ayuda}</div>}
    </div>
  )
}

export function Pestanas({ opciones, activa, alCambiar }) {
  return (
    <div className="pestanas" role="tablist">
      {opciones.map(o => (
        <button key={o.clave} role="tab" aria-selected={activa === o.clave}
                className={`pestana${activa === o.clave ? ' activa' : ''}`} onClick={() => alCambiar(o.clave)}>
          {o.etiqueta}
        </button>
      ))}
    </div>
  )
}

export function Paginacion({ pagina, total, tam, alCambiar }) {
  const paginas = Math.max(1, Math.ceil(total / tam))
  if (paginas <= 1) return null
  return (
    <div className="paginacion">
      <span>Página {pagina} de {paginas}</span>
      <button className="boton pequeno" disabled={pagina <= 1} onClick={() => alCambiar(pagina - 1)}>‹ Anterior</button>
      <button className="boton pequeno" disabled={pagina >= paginas} onClick={() => alCambiar(pagina + 1)}>Siguiente ›</button>
    </div>
  )
}

export function BarraProporcion({ valor, maximo, ancho = 90, color }) {
  const w = maximo > 0 ? Math.max(2, (valor / maximo) * ancho) : 2
  return <span className="barra-tabla" style={{ width: `${w}px`, background: color }} />
}

// Ejecuta una acción con estado de "guardando" y manejo de errores visible.
export function useAccion() {
  const { notificar } = useApp()
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState(null)
  const ejecutar = async (fn, mensajeExito) => {
    setOcupado(true)
    setError(null)
    try {
      const r = await fn()
      if (mensajeExito) notificar(mensajeExito, 'exito')
      return r
    } catch (e) {
      setError(e.message)
      return undefined
    } finally {
      setOcupado(false)
    }
  }
  return { ocupado, error, setError, ejecutar }
}
