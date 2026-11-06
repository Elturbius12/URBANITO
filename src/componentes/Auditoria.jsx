// Auditoría: quién hizo qué y cuándo.
import { useState } from 'react'
import { useDatos, llamar } from '../api'
import { useApp, Panel, Cargando, ErrorCarga, Paginacion } from './Comunes'
import { fechaHora } from '../formato'
import { exportarExcel } from '../exportar'

function detalleLegible(d) {
  if (!d) return ''
  try {
    const j = JSON.parse(d)
    if (j && typeof j === 'object') {
      if (j.antes && j.despues) {
        const cambios = Object.keys(j.despues).filter(k => JSON.stringify(j.antes[k]) !== JSON.stringify(j.despues[k]))
          .map(k => `${k}: «${j.antes[k] ?? '—'}» → «${j.despues[k] ?? '—'}»`)
        return `${j.motivo ? `${j.motivo}. ` : ''}${cambios.join('; ')}`
      }
      if (j.justificacion) return `${j.justificacion} (RC ${Number(j.rc).toFixed(4)})`
      return JSON.stringify(j)
    }
  } catch (_) { /* texto plano */ }
  return d
}

export default function Auditoria() {
  const { version, notificar } = useApp()
  const [f, setF] = useState({ desde: '', hasta: '', usuario: '', accion: '', texto: '', pagina: 1 })
  const { datos, error, recargar } = useDatos('auditoria', f, [version])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value, pagina: 1 })
  if (error) return <ErrorCarga error={error} reintentar={recargar} />

  const exportar = async () => {
    const todas = []
    let p = 1
    for (;;) {
      const r = await llamar('auditoria', { ...f, pagina: p })
      todas.push(...r.filas)
      if (todas.length >= r.total || !r.filas.length) break
      p++
    }
    await exportarExcel(notificar, 'auditoria', [{ nombre: 'Auditoría', titulo: 'Registro de auditoría', subtitulo: `${todas.length} registros`,
      columnas: [{ titulo: 'Fecha y hora', clave: 'fh', ancho: 18 }, { titulo: 'Usuario', clave: 'usuario', ancho: 18 }, { titulo: 'Acción', clave: 'accion', ancho: 24 },
        { titulo: 'Entidad', clave: 'entidad', ancho: 14 }, { titulo: 'Id', clave: 'entidad_id', ancho: 12 }, { titulo: 'Detalle', clave: 'det', ancho: 80 }],
      filas: todas.map(r => ({ ...r, fh: fechaHora(r.fecha_hora), det: detalleLegible(r.detalle) })) }])
  }

  return (
    <>
      <Panel>
        <div className="filtros">
          <input className="control" type="date" value={f.desde} onChange={set('desde')} title="Desde" />
          <input className="control" type="date" value={f.hasta} onChange={set('hasta')} title="Hasta" />
          <input className="control" placeholder="Usuario exacto" value={f.usuario} onChange={set('usuario')} />
          <select className="control" value={f.accion} onChange={set('accion')}>
            <option value="">Todas las acciones</option>
            {(datos?.acciones || []).map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <input className="control" placeholder="Texto en el detalle o N° de expediente" value={f.texto} onChange={set('texto')} />
          <button className="boton pequeno" style={{ marginLeft: 'auto' }} onClick={exportar}>⬇ Excel</button>
        </div>
      </Panel>
      {!datos ? <Cargando /> : (
        <Panel sinRelleno titulo={`${datos.total} registro(s)`}>
          <div className="tabla-contenedor" style={{ maxHeight: 'calc(100vh - 330px)' }}>
            <table className="tabla">
              <thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Detalle</th></tr></thead>
              <tbody>{datos.filas.map(r => (
                <tr key={r.id}><td style={{ whiteSpace: 'nowrap' }}>{fechaHora(r.fecha_hora)}</td><td className="mono">{r.usuario || '—'}</td>
                  <td className="destacado">{r.accion}</td><td className="suave">{r.entidad}{r.entidad_id ? ` ${r.entidad_id}` : ''}</td>
                  <td style={{ fontSize: 12.5 }}>{detalleLegible(r.detalle)}</td></tr>))}
              </tbody>
            </table>
          </div>
          <Paginacion pagina={datos.pagina} total={datos.total} tam={datos.tam} alCambiar={(p) => setF({ ...f, pagina: p })} />
        </Panel>
      )}
    </>
  )
}
