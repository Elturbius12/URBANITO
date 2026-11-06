// Depuración de expedientes importados que figuran en trámite.
import { useState } from 'react'
import { useDatos, llamar } from '../api'
import { useApp, Panel, Cargando, ErrorCarga, Aviso, Modal, Campo, useAccion } from './Comunes'
import TablaExpedientes from './TablaExpedientes'
import { numero, fecha } from '../formato'

export default function Depuracion() {
  const { version, refrescar, estado } = useApp()
  const [f, setF] = useState({ min_dias_sin_movimiento: '0', procedimiento: '', sin_tramite: false })
  const [sel, setSel] = useState(new Set())
  const [accion, setAccion] = useState(null)
  const [obs, setObs] = useState('')
  const [proc, setProc] = useState('')
  const { datos, error, recargar } = useDatos('importados_en_tramite', f, [version])
  const { datos: cat } = useDatos('catalogos', {})
  const { ocupado, error: errAccion, setError, ejecutar } = useAccion()

  if (error) return <ErrorCarga error={error} reintentar={recargar} />
  if (!datos) return <Cargando />
  const procs = [...new Map(datos.map(x => [x.procedimiento_codigo, x.procedimiento])).entries()]

  const confirmar = async () => {
    const r = await ejecutar(() => llamar('depurar_importados', { ids: [...sel], accion, observacion: obs, procedimiento_codigo: proc }),
      accion === 'CLASIFICAR' ? `${sel.size} expediente(s) clasificado(s): pasan a su departamento con su plazo TUPA` : `${sel.size} expediente(s) cerrado(s)`)
    if (r) { setSel(new Set()); setAccion(null); setObs(''); setProc(''); refrescar() }
  }

  return (
    <>
      <Aviso tipo="informativo">
        Estos expedientes vienen del sistema anterior y estaban en trámite al {fecha(estado.importacion.fecha_corte)}. Algunos pueden haberse atendido sin que
        se registrara el cierre, y otros no tienen el trámite anotado en el sistema anterior. <b>Verifique cada uno</b> (archivo físico, cargo de entrega,
        resolución) antes de actuar. «Asignar trámite» completa el dato que faltaba. «Ya fue atendido» lo cierra con la fecha de su último movimiento
        registrado, que es la mejor información disponible, y pasa a la base del MTA.
      </Aviso>
      <Panel>
        <div className="filtros">
          <span className="texto-suave" style={{ fontSize: 13 }}>Sin movimiento hace al menos</span>
          <input className="control" style={{ minWidth: 70, width: 80 }} type="number" min="0" value={f.min_dias_sin_movimiento}
                 onChange={e => setF({ ...f, min_dias_sin_movimiento: e.target.value })} />
          <span className="texto-suave" style={{ fontSize: 13 }}>días hábiles</span>
          <select className="control" value={f.procedimiento} onChange={e => setF({ ...f, procedimiento: e.target.value })}>
            <option value="">Todos los trámites</option>
            {procs.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
          <label className="casilla"><input type="checkbox" checked={f.sin_tramite} onChange={e => setF({ ...f, sin_tramite: e.target.checked })} />
            Solo sin trámite identificado</label>
          <div className="grupo-botones" style={{ marginLeft: 'auto' }}>
            <span className="texto-suave">{sel.size} seleccionado(s)</span>
            <button className="boton primario" disabled={!sel.size} onClick={() => { setError(null); setAccion('CLASIFICAR') }}>Asignar trámite…</button>
            <button className="boton exito" disabled={!sel.size} onClick={() => { setError(null); setAccion('ATENDIDO') }}>Ya fue atendido</button>
            <button className="boton" disabled={!sel.size} onClick={() => { setError(null); setAccion('ARCHIVAR') }}>Archivar</button>
          </div>
        </div>
      </Panel>
      <Panel sinRelleno titulo={`${numero(datos.length)} importado(s) en trámite`} descripcion="Ordenados por días sin movimiento (mayor primero). Clic en la fila para ver la ficha.">
        <TablaExpedientes filas={datos} seleccion={sel} alSeleccionar={setSel} alto="calc(100vh - 380px)"
                          columnas={['numero', 'solicitante', 'tramite', 'ingreso', 'ubicacion', 'sin_mov', 'nivel']} vacio="No hay importados en trámite con estos filtros." />
      </Panel>
      {accion && (
        <Modal titulo={{ ATENDIDO: 'Cerrar como atendidos', ARCHIVAR: 'Archivar', CLASIFICAR: 'Asignar el trámite' }[accion]} alCerrar={() => setAccion(null)}
               pie={<><button className="boton" onClick={() => setAccion(null)}>Cancelar</button>
                 <button className="boton primario" disabled={ocupado} onClick={confirmar} data-accion="confirmar-depuracion">Confirmar ({sel.size})</button></>}>
          {accion === 'CLASIFICAR' ? (
            <>
              <p style={{ marginBottom: 10 }}>Asigne el trámite a <b>{sel.size}</b> expediente(s), según el documento físico. Con eso pasan al departamento que corresponde
                y el IUA incorpora su plazo TUPA. Quedará registrado en la auditoría.</p>
              <Campo etiqueta="Trámite" requerido>
                <select value={proc} onChange={e => setProc(e.target.value)} data-campo="tramite-depuracion">
                  <option value="">— Seleccione —</option>
                  {(cat?.procedimientos || []).filter(p => p.seleccionable && p.activo).map(p => <option key={p.codigo} value={p.codigo}>{p.nombre}</option>)}
                </select>
              </Campo>
              <div style={{ height: 10 }} />
            </>
          ) : <p style={{ marginBottom: 10 }}>Se cerrarán <b>{sel.size}</b> expediente(s). Quedará registrado en la auditoría a su nombre.</p>}
          <Campo etiqueta="¿Cómo se verificó?" requerido><textarea value={obs} onChange={e => setObs(e.target.value)}
            placeholder="Ej.: Revisado con el archivo físico del departamento el 05/11/2026" /></Campo>
          {errAccion && <div style={{ marginTop: 10 }}><Aviso tipo="error">{errAccion}</Aviso></div>}
        </Modal>
      )}
    </>
  )
}
