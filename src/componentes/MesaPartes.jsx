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
  // portal ciudadano: si el DNI es nuevo se crea su acceso
  const [portal, setPortal] = useState(null)        // { existe, administrado } | null
  const [adm, setAdm] = useState({ crear: true, nombres: '', apellidos: '', whatsapp: '' })

  useEffect(() => {
    const dni = f.documento_identidad.trim()
    if (!/^\d{8}$/.test(dni)) { setPortal(null); return undefined }
    let vivo = true
    llamar('administrado_buscar', { dni }).then(r => { if (vivo) setPortal(r.aplica ? r : null) }).catch(() => { if (vivo) setPortal(null) })
    return () => { vivo = false }
  }, [f.documento_identidad])
  useEffect(() => {
    if (!portal || portal.existe) return
    // propuesta: los dos últimos términos son los apellidos (mesa de partes lo corrige si no es así)
    const p = f.solicitante.trim().toUpperCase().split(/\s+/).filter(Boolean)
    setAdm(a => ({ ...a, nombres: p.length > 2 ? p.slice(0, -2).join(' ') : (p[0] || ''), apellidos: p.length > 2 ? p.slice(-2).join(' ') : p.slice(1).join(' '),
                   whatsapp: a.whatsapp || f.telefono }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portal, f.solicitante])

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
      administrado: portal && !portal.existe && adm.crear ? { nombres: adm.nombres, apellidos: adm.apellidos, whatsapp: adm.whatsapp } : undefined,
    }))
    if (r) {
      setRegistrado(r)
      setF(VACIO); setPortal(null); setAdm({ crear: true, nombres: '', apellidos: '', whatsapp: '' })
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
            {portal && portal.existe && (
              <div className="completo texto-suave" style={{ fontSize: 12.5 }}>✔ Este DNI ya tiene acceso al portal ciudadano (usuario <b className="mono">{portal.administrado.usuario_portal}</b>).</div>
            )}
            {portal && !portal.existe && (
              <div className="completo resaltado">
                <label className="casilla" style={{ fontWeight: 600 }}><input type="checkbox" checked={adm.crear} onChange={e => setAdm({ ...adm, crear: e.target.checked })} data-campo="crear-portal" />
                  Solicitante nuevo: crear su acceso al portal ciudadano</label>
                {adm.crear && (
                  <div className="formulario" style={{ marginTop: 8, gridTemplateColumns: '1fr 1fr 1fr' }}>
                    <Campo etiqueta="Nombres" requerido><input value={adm.nombres} onChange={e => setAdm({ ...adm, nombres: e.target.value })} data-campo="nombres" /></Campo>
                    <Campo etiqueta="Apellidos" requerido><input value={adm.apellidos} onChange={e => setAdm({ ...adm, apellidos: e.target.value })} data-campo="apellidos" /></Campo>
                    <Campo etiqueta="WhatsApp" ayuda="Celular de 9 dígitos"><input value={adm.whatsapp} onChange={e => setAdm({ ...adm, whatsapp: e.target.value })} data-campo="whatsapp" /></Campo>
                  </div>
                )}
              </div>
            )}
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
          {registrado.credenciales_portal && <CredencialesPortal c={registrado.credenciales_portal} />}
        </Modal>
      )}
    </>
  )
}

// Credenciales del portal ciudadano: se muestran UNA vez (la contraseña se guarda cifrada)
function CredencialesPortal({ c }) {
  const { notificar } = useApp()
  const copiar = async () => {
    try { await navigator.clipboard.writeText(c.mensaje); notificar('Mensaje copiado', 'exito') } catch (_) { notificar('No se pudo copiar', 'error') }
  }
  return (
    <div className="resaltado" style={{ marginTop: 14 }} data-prueba="credenciales-portal">
      <div style={{ fontWeight: 650, marginBottom: 6 }}>Usuario creado para {c.nombre}</div>
      <table className="tabla" style={{ background: '#fff' }}><tbody>
        <tr><td>Usuario</td><td className="mono destacado">{c.usuario}</td></tr>
        <tr><td>Contraseña</td><td className="mono destacado">{c.clave}</td></tr>
        <tr><td>Portal</td><td className="mono">{c.url_portal}</td></tr>
      </tbody></table>
      <p className="texto-suave" style={{ fontSize: 12, margin: '6px 0' }}>Entréguelas al ciudadano: no se volverán a mostrar. En su primer ingreso deberá cambiar la contraseña.</p>
      <div className="grupo-botones">
        {c.enlace_whatsapp
          ? <a className="boton exito" href={c.enlace_whatsapp} target="_blank" rel="noreferrer" data-accion="whatsapp">
              Enviar credenciales por WhatsApp</a>
          : <span className="texto-suave" style={{ fontSize: 12.5 }}>Sin número de WhatsApp registrado.</span>}
        <button className="boton" onClick={copiar}>Copiar mensaje</button>
      </div>
    </div>
  )
}
