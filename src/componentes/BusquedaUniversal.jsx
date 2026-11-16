// Búsqueda universal de la cabecera: número de expediente, solicitante o DNI/RUC.
// Resultados mientras se escribe; Enter abre el primero.
import { useEffect, useRef, useState } from 'react'
import { llamar } from '../api'
import { useApp, Nivel } from './Comunes'
import { fecha } from '../formato'

export default function BusquedaUniversal() {
  const { abrirFicha, ir } = useApp()
  const [q, setQ] = useState('')
  const [res, setRes] = useState(null)
  const [abierta, setAbierta] = useState(false)
  const [activo, setActivo] = useState(0)
  const caja = useRef(null)

  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return undefined }
    let vivo = true
    const t = setTimeout(() => {
      llamar('busqueda_universal', { q }).then(r => { if (vivo) { setRes(r); setActivo(0); setAbierta(true) } }).catch(() => {})
    }, 200)
    return () => { vivo = false; clearTimeout(t) }
  }, [q])

  useEffect(() => {
    const fuera = (e) => { if (caja.current && !caja.current.contains(e.target)) setAbierta(false) }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [])

  const elegir = (f) => { setAbierta(false); setQ(''); abrirFicha(f.id) }
  const tecla = (e) => {
    if (!res || !res.filas.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActivo(a => Math.min(res.filas.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo(a => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') elegir(res.filas[activo])
    else if (e.key === 'Escape') setAbierta(false)
  }

  return (
    <div className="busqueda-universal" ref={caja}>
      <input className="control" placeholder="⌕ Buscar expediente, solicitante o DNI…" value={q} data-campo="busqueda-universal"
             onChange={e => setQ(e.target.value)} onFocus={() => res && setAbierta(true)} onKeyDown={tecla} />
      {abierta && res && (
        <div className="resultados-busqueda">
          {!res.filas.length && <div className="vacio" style={{ padding: 14 }}>Sin resultados para «{q}».</div>}
          {res.filas.map((f, i) => (
            <button key={f.id} className={`res${i === activo ? ' activo' : ''}`} onMouseEnter={() => setActivo(i)} onClick={() => elegir(f)}>
              <span className="mono destacado">{f.numero}</span>
              <span className="suave">{f.sistema}</span>
              {f.nivel && <Nivel nivel={f.nivel} />}
              <span className="det">{f.solicitante || '—'}{f.documento_identidad ? ` · ${f.documento_identidad}` : ''}<br />
                <span className="suave">{f.procedimiento} · {f.estado_nombre} · {fecha(f.fecha_ingreso)}</span></span>
            </button>
          ))}
          {res.total > res.filas.length && (
            <button className="res mas" onClick={() => { setAbierta(false); ir('buscar', { texto: q }) }}>
              Ver los {res.total} resultados en «Buscar expediente»</button>
          )}
        </div>
      )}
    </div>
  )
}
