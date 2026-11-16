// Campana de notificaciones de la cabecera.
// Consulta al núcleo cada 10 segundos (también en red: el cliente pregunta al
// servidor). Si llegan notificaciones nuevas se avisan con un mensaje; si
// cambiaron los datos (otra persona derivó, finalizó, etc.) se refrescan las
// pantallas abiertas sin recargar.
import { useEffect, useRef, useState } from 'react'
import { llamar } from '../api'
import { useApp } from './Comunes'
import { fechaHora } from '../formato'

const INTERVALO_MS = 10000
const ICONO = { ASIGNACION: '⇄', DERIVACION: '➜', REPORTE: '✎', RECORDATORIO: '⏰', SISTEMA: 'ℹ' }

export default function Campana({ alAbrirReporte }) {
  const { notificar, refrescar, abrirFicha, ir, usuario } = useApp()
  const [abierta, setAbierta] = useState(false)
  const [lista, setLista] = useState([])
  const [noLeidas, setNoLeidas] = useState(0)
  const marca = useRef(null)
  const cambio = useRef(null)
  const caja = useRef(null)

  // al abrir el sistema: recordatorios del día y lista inicial
  useEffect(() => {
    let vivo = true
    llamar('al_abrir').then(r => {
      if (!vivo) return
      setLista(r.filas); setNoLeidas(r.no_leidas); marca.current = r.ahora
      if (r.creadas) notificar(`Tiene ${r.no_leidas} notificación(es) sin leer`, 'info')
    }).catch(() => {})
    return () => { vivo = false }
  }, [notificar])

  // polling
  useEffect(() => {
    const t = setInterval(async () => {
      if (!marca.current) return
      try {
        const r = await llamar('notificaciones_nuevas', { desde: marca.current })
        marca.current = r.ahora
        setNoLeidas(r.no_leidas)
        if (r.filas.length) {
          setLista(l => [...[...r.filas].reverse(), ...l].slice(0, 100))
          for (const n of r.filas.slice(-3)) notificar(`🔔 ${n.titulo}`, 'info')
        }
        if (r.datos_cambiados && cambio.current && r.datos_cambiados !== cambio.current) refrescar()
        cambio.current = r.datos_cambiados
      } catch (_) { /* sin conexión: se reintenta en el siguiente ciclo */ }
    }, INTERVALO_MS)
    return () => clearInterval(t)
  }, [notificar, refrescar])

  useEffect(() => {
    if (!abierta) return undefined
    const fuera = (e) => { if (caja.current && !caja.current.contains(e.target)) setAbierta(false) }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierta])

  const marcar = async (datos) => {
    try {
      const r = await llamar('notificacion_leida', datos)
      setLista(r.filas); setNoLeidas(r.no_leidas)
    } catch (e) { notificar(e.message, 'error') }
  }

  const abrir = (n) => {
    if (!n.leida) marcar({ id: n.id })
    setAbierta(false)
    if (n.referencia_tipo === 'expediente' && n.referencia_id) abrirFicha(n.referencia_id)
    else if (n.referencia_tipo === 'asignacion') ir('asignaciones')
    else if (n.referencia_tipo === 'reporte') {
      if (usuario.permisos.includes('*') || usuario.permisos.includes('seguimiento')) ir('seguimiento', { pestana: 'reportes' })
      else if (alAbrirReporte) alAbrirReporte()
    }
  }

  return (
    <div className="campana" ref={caja}>
      <button className="boton-campana" onClick={() => setAbierta(!abierta)} aria-label={`Notificaciones (${noLeidas} sin leer)`} data-accion="campana">
        🔔{noLeidas > 0 && <span className="globo">{noLeidas > 99 ? '99+' : noLeidas}</span>}
      </button>
      {abierta && (
        <div className="panel-notificaciones" role="dialog" aria-label="Notificaciones">
          <div className="cabeza">
            <b>Notificaciones</b>
            {noLeidas > 0 && <button className="boton pequeno" onClick={() => marcar({ todas: true })}>Marcar todas como leídas</button>}
          </div>
          <div className="lista">
            {!lista.length && <div className="vacio" style={{ padding: 20 }}>No tiene notificaciones.</div>}
            {lista.map(n => (
              <button key={n.id} className={`item${n.leida ? '' : ' nueva'}`} onClick={() => abrir(n)}>
                <span className="ic">{ICONO[n.tipo] || '•'}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="t">{n.titulo}</span>
                  {n.mensaje && <span className="m">{n.mensaje}</span>}
                  <span className="f">{fechaHora(n.creado_en)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
