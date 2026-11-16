// Búsqueda sobre todos los expedientes (actuales e históricos).
import { useEffect, useState } from 'react'
import { useDatos } from '../api'
import { useApp, Panel, Cargando, ErrorCarga, Paginacion } from './Comunes'
import TablaExpedientes from './TablaExpedientes'
import { numero } from '../formato'

export default function Buscar({ inicial = {} }) {
  const { version } = useApp()
  const { datos: cat } = useDatos('catalogos', {})
  const [f, setF] = useState({ texto: inicial.texto || '', documento: '', estado: '', sistema: inicial.sistema || '', procedimiento: '', desde: '', hasta: '',
                                   importacion: inicial.importacion || '', pagina: 1 })
  const [entrada, setEntrada] = useState({ texto: inicial.texto || '', documento: '' })
  useEffect(() => {
    const t = setTimeout(() => setF(x => ({ ...x, ...entrada, pagina: 1 })), 350)
    return () => clearTimeout(t)
  }, [entrada])
  const { datos, error, recargar } = useDatos('buscar', f, [version])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value, pagina: 1 })

  return (
    <>
      <Panel>
        <div className="filtros" style={{ marginBottom: 8 }}>
          <input className="control" style={{ minWidth: 320 }} placeholder="N° de expediente o nombre del solicitante" autoFocus
                 value={entrada.texto} onChange={e => setEntrada({ ...entrada, texto: e.target.value })} data-campo="buscar" />
          <input className="control" placeholder="DNI / RUC exacto" value={entrada.documento}
                 onChange={e => setEntrada({ ...entrada, documento: e.target.value })} />
          <select className="control" value={f.estado} onChange={set('estado')}>
            <option value="">Cualquier estado</option>
            {cat && Object.entries(cat.estados).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="control" value={f.sistema} onChange={set('sistema')}>
            <option value="">Todos los sistemas</option>
            <option value="URBANITO">URBANITO (nuevos)</option>
            <option value="SGCUC">SGCUC (importado)</option>
            <option value="SGAU">SGAU (importado)</option>
            <option value="IMPORTADO">Importado desde Excel/CSV</option>
          </select>
          {f.importacion && (
            <button className="filtro activo" onClick={() => setF({ ...f, importacion: '', pagina: 1 })} title="Quitar filtro">
              Importación N° {f.importacion} ×
            </button>
          )}
        </div>
        <div className="filtros">
          <select className="control" value={f.procedimiento} onChange={set('procedimiento')}>
            <option value="">Todos los trámites</option>
            {cat && cat.procedimientos.map(p => <option key={p.codigo} value={p.codigo}>{p.nombre}</option>)}
          </select>
          <span className="texto-suave" style={{ fontSize: 12.5 }}>Ingreso desde</span>
          <input className="control" type="date" value={f.desde} onChange={set('desde')} />
          <span className="texto-suave" style={{ fontSize: 12.5 }}>hasta</span>
          <input className="control" type="date" value={f.hasta} onChange={set('hasta')} />
        </div>
      </Panel>
      {error && <ErrorCarga error={error} reintentar={recargar} />}
      {!datos && !error && <Cargando />}
      {datos && (
        <Panel sinRelleno titulo={`${numero(datos.total)} expediente(s)`} descripcion="Del más reciente al más antiguo. Clic para ver el detalle.">
          <TablaExpedientes filas={datos.filas} columnas={['numero', 'solicitante', 'tramite', 'estado', 'ingreso', 'ubicacion', 'cierre']}
                            vacio="No se encontraron expedientes." alto="calc(100vh - 370px)" />
          <Paginacion pagina={datos.pagina} total={datos.total} tam={datos.tam} alCambiar={(p) => setF({ ...f, pagina: p })} />
        </Panel>
      )}
    </>
  )
}
