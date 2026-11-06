// Tabla estándar de expedientes con columnas configurables.
import { useApp, Nivel, Vacio } from './Comunes'
import { numero, fecha, restantes } from '../formato'

const COLUMNAS = {
  numero: { t: 'Expediente', r: x => <><div className="destacado mono">{x.numero}</div><div className="suave">{x.sistema}</div></> },
  solicitante: { t: 'Solicitante', r: x => x.solicitante || '—' },
  tramite: { t: 'Trámite', r: x => <><div>{x.procedimiento}</div>{x.departamento && <div className="suave">{x.departamento.replace('Departamento de ', '')}</div>}</> },
  ubicacion: { t: 'Ubicación', r: x => x.ubicacion },
  estado: { t: 'Estado', r: x => x.estado_nombre },
  ingreso: { t: 'Ingreso', r: x => fecha(x.fecha_ingreso) },
  plazo: { t: 'Plazo TUPA', r: x => <span style={{ color: x.vencido ? 'var(--critico)' : undefined, fontWeight: x.vencido ? 600 : undefined }}>{restantes(x.dias_restantes)}<div className="suave">{x.fecha_limite ? `límite ${fecha(x.fecha_limite)}` : ''}</div></span> },
  sin_mov: { t: 'Sin movimiento', num: true, r: x => (x.dias_sin_movimiento === null || x.dias_sin_movimiento === undefined) ? '—' : <>{numero(x.dias_sin_movimiento)} d.h.{x.p80_permanencia_ubicacion ? <div className="suave">P80 de su ubicación: {numero(x.p80_permanencia_ubicacion)}</div> : null}</> },
  dias: { t: 'Días', num: true, r: x => x.dias === null || x.dias === undefined ? '—' : numero(x.dias) },
  iua: { t: 'IUA', num: true, r: x => x.iua === undefined ? '—' : <b>{x.iua.toFixed(3)}</b> },
  nivel: { t: 'Nivel', r: x => <Nivel nivel={x.nivel} /> },
  cierre: { t: 'Cierre', r: x => fecha(x.fecha_cierre) },
}

export default function TablaExpedientes({ filas, columnas, vacio = 'No hay expedientes', seleccion, alSeleccionar, alto }) {
  const { abrirFicha } = useApp()
  if (!filas.length) return <Vacio texto={vacio} />
  const todos = seleccion && filas.every(f => seleccion.has(f.id))
  return (
    <div className="tabla-contenedor" style={alto ? { maxHeight: alto } : undefined}>
      <table className="tabla">
        <thead>
          <tr>
            {seleccion && <th style={{ width: 30 }}><input type="checkbox" checked={todos} aria-label="Seleccionar todos"
              onChange={() => alSeleccionar(todos ? new Set() : new Set(filas.map(f => f.id)))} /></th>}
            {columnas.map(c => <th key={c} className={COLUMNAS[c].num ? 'num' : ''}>{COLUMNAS[c].t}</th>)}
          </tr>
        </thead>
        <tbody>
          {filas.map(x => (
            <tr key={x.id} className="clicable" onClick={() => abrirFicha(x.id)}>
              {seleccion && (
                <td onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={seleccion.has(x.id)} onChange={() => {
                    const s = new Set(seleccion)
                    if (s.has(x.id)) s.delete(x.id); else s.add(x.id)
                    alSeleccionar(s)
                  }} />
                </td>
              )}
              {columnas.map(c => <td key={c} className={COLUMNAS[c].num ? 'num' : ''}>{COLUMNAS[c].r(x)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
