// Mesa de partes: registro de expedientes y recepción de subsanaciones.
import { useEffect, useState } from 'react'
import { useDatos, llamar } from '../api'
import { useApp, Panel, Campo, Aviso, Cargando, ErrorCarga, Pestanas, Vacio, Modal, useAccion } from './Comunes'
import { numero, fecha, fechaLarga, porcentaje } from '../formato'
import { imprimir, exportarPdf } from '../exportar'
import { constanciaHtml } from '../documentos'

const VACIO = { solicitante: '', documento_identidad: '', telefono: '', direccion: '', procedimiento_codigo: '', asunto: '',
                folios: '', fecha_ingreso: '', destino_tipo: '', destino_codigo: '', observacion: '' }

export default function MesaPartes({ inicial = {} }) {
  const { version } = useApp()
  const [pestana, setPestana] = useState(inicial.pestana || 'nuevo')
  const { datos, error, recargar } = useDatos('mesa_partes', {}, [version])
  return (
    <>
      <Pestanas activa={pestana} alCambiar={setPestana} opciones={[
        { clave: 'nuevo', etiqueta: 'Registrar expediente' },
        { clave: 'hoy', etiqueta: `Registrados hoy${datos ? ` (${datos.registrados_hoy.length})` : ''}` },
        { clave: 'observados', etiqueta: `Observados — recibir subsanación${datos ? ` (${datos.observados.length})` : ''}` },
      ]} />
      {pestana === 'nuevo' && <NuevoExpediente />}
      {pestana !== 'nuevo' && error && <ErrorCarga error={error} reintentar={recargar} />}
      {pestana !== 'nuevo' && !datos && !error && <Cargando />}
      {pestana === 'hoy' && datos && <Lista filas={datos.registrados_hoy} vacio="Hoy todavía no se registraron expedientes." />}
      {pestana === 'observados' && datos && (
        <>
          <Aviso tipo="informativo">Cuando el administrado traiga lo observado, abra el expediente y use «Registrar subsanación».
            El expediente vuelve a su responsable y el plazo continúa.</Aviso>
          <Lista filas={datos.observados} observados vacio="No hay expedientes observados." />
        </>
      )}
    </>
  )
}

function Lista({ filas, observados, vacio }) {
  const { abrirFicha } = useApp()
  if (!filas.length) return <Vacio texto={vacio} />
  return (
    <Panel sinRelleno>
      <table className="tabla">
        <thead><tr><th>Expediente</th><th>Solicitante</th><th>Trámite</th><th>Ubicación</th>
          {observados ? <><th>Observado el</th><th>Qué debe subsanar</th></> : <th>Ingreso</th>}</tr></thead>
        <tbody>
          {filas.map(f => (
            <tr key={f.id} className="clicable" onClick={() => abrirFicha(f.id)}>
              <td className="destacado mono">{f.numero}</td><td>{f.solicitante}</td><td>{f.procedimiento}</td><td>{f.ubicacion}</td>
              {observados ? <><td>{fecha(f.fecha_observacion)}</td><td style={{ maxWidth: 360 }}>{f.observacion}</td></> : <td>{fecha(f.fecha_ingreso)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

function NuevoExpediente() {
  const { refrescar, notificar, usuario } = useApp()
  const { datos: cat, error: errCat } = useDatos('catalogos', {})
  const [f, setF] = useState(VACIO)
  const [est, setEst] = useState(null)
  const [registrado, setRegistrado] = useState(null)
  const { ocupado, error, setError, ejecutar } = useAccion()
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const proc = cat?.procedimientos.find(p => p.codigo === f.procedimiento_codigo)

  useEffect(() => {
    if (!f.procedimiento_codigo) { setEst(null); return }
    let vivo = true
    llamar('estimacion', { procedimiento_codigo: f.procedimiento_codigo, fecha: f.fecha_ingreso || undefined })
      .then(r => { if (vivo) setEst(r) }).catch(() => { if (vivo) setEst(null) })
    return () => { vivo = false }
  }, [f.procedimiento_codigo, f.fecha_ingreso])

  useEffect(() => {
    if (proc) setF(x => ({ ...x, destino_tipo: proc.departamento_codigo ? 'DEPARTAMENTO' : 'UNIDAD ORGANICA',
                           destino_codigo: proc.departamento_codigo || '' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.procedimiento_codigo])

  if (errCat) return <ErrorCarga error={errCat} />
  if (!cat) return <Cargando />

  const registrar = async () => {
    setError(null)
    const r = await ejecutar(() => llamar('registrar_expediente', {
      ...f, folios: f.folios === '' ? null : Number(f.folios), fecha_ingreso: f.fecha_ingreso || undefined,
      destino: f.destino_codigo ? { tipo: f.destino_tipo, codigo: f.destino_codigo } : undefined,
    }))
    if (r) {
      setRegistrado(r)
      setF(VACIO)
      refrescar()
    }
  }

  const tramites = cat.procedimientos.filter(p => p.seleccionable && p.activo)
  return (
    <>
      <div className="dos-columnas" style={{ gridTemplateColumns: '1.35fr 1fr' }}>
        <Panel titulo="Datos del expediente" descripcion="Los campos con * son obligatorios">
          <div className="formulario">
            <Campo etiqueta="Solicitante (nombre o razón social)" requerido completo>
              <input value={f.solicitante} onChange={set('solicitante')} autoFocus data-campo="solicitante" />
            </Campo>
            <Campo etiqueta="DNI / RUC / Carné de extranjería" requerido><input value={f.documento_identidad} onChange={set('documento_identidad')} data-campo="documento" /></Campo>
            <Campo etiqueta="Teléfono"><input value={f.telefono} onChange={set('telefono')} /></Campo>
            <Campo etiqueta="Dirección" completo><input value={f.direccion} onChange={set('direccion')} /></Campo>
            <Campo etiqueta="Trámite (procedimiento TUPA)" requerido completo>
              <select value={f.procedimiento_codigo} onChange={set('procedimiento_codigo')} data-campo="procedimiento">
                <option value="">— Seleccione el trámite —</option>
                {tramites.map(p => (
                  <option key={p.codigo} value={p.codigo}>
                    {p.nombre} — {p.plazo_tupa === null ? 'sin plazo TUPA' : p.plazo_tupa === 0 ? 'mismo día' : `${p.plazo_tupa} d.h.`}
                  </option>))}
              </select>
            </Campo>
            <Campo etiqueta="Asunto" completo ayuda="Si lo deja vacío se usa el nombre del trámite">
              <textarea value={f.asunto} onChange={set('asunto')} style={{ minHeight: 54 }} />
            </Campo>
            <Campo etiqueta="Folios" requerido><input type="number" min="1" value={f.folios} onChange={set('folios')} data-campo="folios" /></Campo>
            <Campo etiqueta="Fecha de ingreso" ayuda="Por defecto hoy"><input type="date" max={cat.hoy} value={f.fecha_ingreso} onChange={set('fecha_ingreso')} /></Campo>
            <Campo etiqueta="Derivar a" requerido completo>
              <div style={{ display: 'flex', gap: 8 }}>
                <select style={{ maxWidth: 190 }} value={f.destino_tipo} onChange={e => setF({ ...f, destino_tipo: e.target.value, destino_codigo: '' })}>
                  <option value="DEPARTAMENTO">Departamento</option>
                  <option value="UNIDAD ORGANICA">Unidad orgánica</option>
                  <option value="USUARIO">Persona</option>
                </select>
                <select value={f.destino_codigo} onChange={set('destino_codigo')}>
                  <option value="">— Seleccione —</option>
                  {f.destino_tipo === 'DEPARTAMENTO' && cat.departamentos.map(d => <option key={d.codigo} value={d.codigo}>{d.nombre}</option>)}
                  {f.destino_tipo === 'UNIDAD ORGANICA' && cat.unidades.map(u => <option key={u.codigo} value={u.codigo}>{u.nombre}</option>)}
                  {f.destino_tipo === 'USUARIO' && cat.usuarios_destino.map(u => <option key={u.id} value={u.id}>{u.nombre} — {u.rol}</option>)}
                </select>
              </div>
            </Campo>
          </div>
          {error && <div style={{ marginTop: 12 }}><Aviso tipo="error">{error}</Aviso></div>}
          <div className="grupo-botones" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
            <button className="boton" onClick={() => { setF(VACIO); setError(null) }}>Limpiar</button>
            <button className="boton primario grande" disabled={ocupado} onClick={registrar} data-accion="registrar">
              {ocupado ? 'Registrando…' : 'Registrar y generar constancia'}
            </button>
          </div>
        </Panel>

        <Panel titulo="Plazo que se informa al ciudadano" descripcion="Plazo legal del TUPA y tiempos reales del Modelo 2 (MTA)">
          {!est ? <div className="texto-suave">Seleccione el trámite para ver el plazo y la estimación.</div> : (
            <>
              <div className="etiqueta-campo">Plazo legal (TUPA)</div>
              {est.plazo_tupa === null ? <p>Este trámite no tiene plazo en el TUPA.</p> : (
                <p style={{ fontSize: 15, margin: '2px 0 10px' }}>
                  <b>{est.plazo_tupa === 0 ? 'Atención el mismo día' : `${est.plazo_tupa} días hábiles`}</b><br />
                  <span className="texto-suave">Fecha límite: <b style={{ color: 'var(--texto)' }}>{fechaLarga(est.fecha_limite_tupa)}</b></span>
                </p>
              )}
              {est.tupa_codigo && <div className="texto-tenue" style={{ fontSize: 11.5, marginBottom: 10 }}>TUPA {est.tupa_codigo}: {est.tupa_nombre}</div>}
              <div className="separador" />
              <div className="etiqueta-campo">Lo que realmente tarda (MTA)</div>
              {!est.mta ? <p className="texto-suave">No hay expedientes cerrados de este trámite para estimar.</p>
                : est.mta.insuficiente ? <p className="texto-suave">Solo {est.mta.n} caso(s) histórico(s): insuficientes para estimar (mínimo 30).</p> : (
                <>
                  <p style={{ margin: '4px 0' }}>Según <b>{numero(est.mta.n)}</b> expedientes ya atendidos:</p>
                  <ul style={{ paddingLeft: 18, fontSize: 13.5 }}>
                    <li>La mitad se resolvió en <b>{numero(est.mta.mediana)} d.h.</b> o menos (hacia el {fecha(est.mta.fecha_estimada_mediana)}).</li>
                    <li>El 80% se resolvió en <b>{numero(est.mta.p80)} d.h.</b> o menos (hacia el {fecha(est.mta.fecha_estimada_p80)}).</li>
                    {est.mta.tasa_cumplimiento !== null && <li>Se cumplió el plazo del TUPA en el <b>{porcentaje(est.mta.tasa_cumplimiento, 0)}</b> de los casos.</li>}
                  </ul>
                  {est.plazo_tupa !== null && est.mta.p80 > est.plazo_tupa && (
                    <Aviso>Históricamente este trámite suele tardar más que su plazo legal. Conviene priorizarlo desde el inicio.</Aviso>
                  )}
                </>
              )}
              {est.departamento && <><div className="separador" /><div className="etiqueta-campo">Lo atiende</div><div>{est.departamento}</div></>}
            </>
          )}
        </Panel>
      </div>

      {registrado && (
        <Modal titulo={`Expediente registrado: ${registrado.numero}`} alCerrar={() => setRegistrado(null)}
               pie={<>
                 <button className="boton" onClick={() => exportarPdf(notificar, `constancia_${registrado.numero}`, constanciaHtml(registrado.constancia, usuario))}>Guardar PDF</button>
                 <button className="boton" onClick={() => imprimir(notificar, constanciaHtml(registrado.constancia, usuario))}>⎙ Imprimir constancia</button>
                 <button className="boton primario" onClick={() => setRegistrado(null)}>Registrar otro</button>
               </>}>
          <div style={{ textAlign: 'center' }}>
            <div className="etiqueta-campo">Número de expediente</div>
            <div className="mono" style={{ fontSize: 30, fontWeight: 700, color: 'var(--azul)' }} data-prueba="numero-registrado">{registrado.numero}</div>
            <p style={{ marginTop: 8 }}>{registrado.constancia.procedimiento}<br /><span className="texto-suave">{registrado.constancia.solicitante} — derivado a {registrado.constancia.destino}</span></p>
          </div>
        </Modal>
      )}
    </>
  )
}
