// Configuración: red, respaldos, feriados, procedimientos y parámetros.
import { useEffect, useState } from 'react'
import { useDatos, llamar, obtenerToken } from '../api'
import { useApp, Panel, Cargando, ErrorCarga, Aviso, Modal, Campo, Insignia, Pestanas, useAccion } from './Comunes'
import { numero, fecha, fechaHora, fechaLarga, capitalizar } from '../formato'

export default function Configuracion() {
  const [pestana, setPestana] = useState('red')
  return (
    <>
      <Pestanas activa={pestana} alCambiar={setPestana} opciones={[
        { clave: 'red', etiqueta: 'Red y equipo' }, { clave: 'respaldos', etiqueta: 'Respaldos' },
        { clave: 'feriados', etiqueta: 'Feriados' }, { clave: 'procedimientos', etiqueta: 'Procedimientos y plazos TUPA' },
        { clave: 'parametros', etiqueta: 'Parámetros' }, { clave: 'plantillas', etiqueta: 'Plantillas de observación' },
      ]} />
      {pestana === 'red' && <Red />}
      {pestana === 'respaldos' && <Respaldos />}
      {pestana === 'feriados' && <Feriados />}
      {pestana === 'procedimientos' && <Procedimientos />}
      {pestana === 'parametros' && <Parametros />}
      {pestana === 'plantillas' && <Plantillas />}
    </>
  )
}

function Red() {
  const { notificar } = useApp()
  const [eq, setEq] = useState(null)
  const [puerto, setPuerto] = useState('')
  const [error, setError] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => { window.urbanito.equipo().then(e => { setEq(e); setPuerto(String(e.puerto)) }) }, [])
  if (!eq) return <Cargando />

  const cambiar = async (habilitar) => {
    setOcupado(true); setError(null)
    const r = await window.urbanito.red({ token: obtenerToken(), habilitar, puerto })
    setOcupado(false)
    if (!r.ok) return setError(r.error)
    setEq(r)
    notificar(habilitar ? 'Conexión en red activada' : 'Conexión en red desactivada', 'exito')
  }

  if (eq.modo === 'cliente') {
    return (
      <Panel titulo="Esta PC está conectada a un servidor">
        <p>Servidor: <b className="mono">{eq.servidor_url}</b></p>
        <p className="texto-suave" style={{ fontSize: 13, margin: '8px 0 14px' }}>Los datos, respaldos y la configuración de red se administran en la PC servidor.</p>
        <button className="boton" onClick={() => { if (window.confirm('¿Cambiar el modo de esta PC? Deberá volver a elegir servidor o conexión.')) window.urbanito.cambiarModo() }}>Cambiar modo de esta PC</button>
      </Panel>
    )
  }
  return (
    <div className="dos-columnas">
      <Panel titulo="Uso en red local" descripcion="Permite que otras PCs de la oficina trabajen con URBANITO sobre los datos de esta PC">
        <p style={{ marginBottom: 10 }}>Estado: {eq.red_habilitada ? <Insignia tipo="BAJO">Activada</Insignia> : <Insignia>Desactivada</Insignia>}</p>
        <Campo etiqueta="Puerto" ayuda="Normalmente no hace falta cambiarlo (7301)"><input value={puerto} onChange={e => setPuerto(e.target.value)} style={{ maxWidth: 120 }} /></Campo>
        <div className="grupo-botones" style={{ marginTop: 12 }}>
          {!eq.red_habilitada
            ? <button className="boton primario" disabled={ocupado} onClick={() => cambiar(true)}>Activar conexión en red</button>
            : <><button className="boton" disabled={ocupado} onClick={() => cambiar(true)}>Aplicar puerto</button>
                <button className="boton peligro" disabled={ocupado} onClick={() => cambiar(false)}>Desactivar</button></>}
        </div>
        {error && <div style={{ marginTop: 10 }}><Aviso tipo="error">{error}</Aviso></div>}
        {eq.red_habilitada && (
          <>
            <div className="separador" />
            <div className="etiqueta-campo">En las demás PCs, instale URBANITO, elija «Conectarse a la PC servidor» y escriba:</div>
            {eq.ips.length ? eq.ips.map(i => <div key={i.ip} className="mono resaltado" style={{ fontSize: 18, marginTop: 6 }}>{i.ip}:{eq.puerto} <span className="texto-tenue" style={{ fontSize: 11 }}>({i.interfaz})</span></div>)
              : <Aviso>Esta PC no tiene una red activa.</Aviso>}
            <p className="texto-suave" style={{ fontSize: 12.5, marginTop: 10 }}>Si Windows pregunta por el Firewall, elija «Permitir acceso» en redes privadas.
              Esta PC debe permanecer encendida y con URBANITO abierto mientras otros trabajen.</p>
          </>
        )}
      </Panel>
      <Panel titulo="Este equipo">
        <table className="tabla"><tbody>
          <tr><td>Versión de URBANITO</td><td className="mono">{eq.version}</td></tr>
          <tr><td>Modo</td><td>PC servidor (guarda los datos)</td></tr>
          <tr><td>Carpeta de datos</td><td className="mono" style={{ fontSize: 11.5, wordBreak: 'break-all' }}>{eq.carpeta_datos}</td></tr>
        </tbody></table>
        <div className="grupo-botones" style={{ marginTop: 10 }}>
          <button className="boton pequeno" onClick={() => window.urbanito.abrirCarpetaDatos({ token: obtenerToken() })}>Abrir carpeta de datos</button>
        </div>
      </Panel>
    </div>
  )
}

function Respaldos() {
  const { notificar, version, refrescar } = useApp()
  const { datos, error, recargar } = useDatos('respaldos', {}, [version])
  const { ocupado, ejecutar } = useAccion()
  const [esCliente, setEsCliente] = useState(false)
  useEffect(() => { window.urbanito.equipo().then(e => setEsCliente(e.modo === 'cliente')) }, [])
  if (error) return <ErrorCarga error={error} reintentar={recargar} />
  if (!datos) return <Cargando />

  const restaurar = async (nombre) => {
    const r = await window.urbanito.restaurarRespaldo({ token: obtenerToken(), nombre })
    if (r.ok) { notificar('Respaldo restaurado. Vuelva a ingresar.', 'exito'); refrescar() }
    else if (!r.cancelado) notificar(r.error, 'error')
  }
  const exportar = async (nombre) => {
    const r = await window.urbanito.exportarRespaldo({ token: obtenerToken(), nombre })
    if (r.ok) notificar(`Copiado a ${r.ruta}`, 'exito')
    else if (!r.cancelado) notificar(r.error, 'error')
  }

  return (
    <>
      <Aviso tipo="informativo">URBANITO guarda un respaldo automático cada día al abrirse (conserva los últimos 15). Recomendación: copie un respaldo
        a una memoria USB o a otra computadora al menos una vez por semana.</Aviso>
      <div className="grupo-botones" style={{ marginBottom: 12 }}>
        <button className="boton primario" disabled={ocupado} onClick={async () => { await ejecutar(() => llamar('crear_respaldo'), 'Respaldo creado'); recargar() }}>Crear respaldo ahora</button>
        {!esCliente && <button className="boton" onClick={() => restaurar(null)}>Restaurar desde un archivo…</button>}
      </div>
      <Panel sinRelleno titulo={`${datos.length} respaldo(s) en esta PC`}>
        <table className="tabla">
          <thead><tr><th>Archivo</th><th>Tipo</th><th>Fecha</th><th className="num">Tamaño</th><th></th></tr></thead>
          <tbody>{datos.map(r => (
            <tr key={r.nombre}><td className="mono" style={{ fontSize: 12 }}>{r.nombre}</td><td>{r.tipo}</td><td>{fechaHora(r.fecha)}</td>
              <td className="num">{numero(r.tamano / 1048576, 1)} MB</td>
              <td style={{ whiteSpace: 'nowrap' }}>{!esCliente && <>
                <button className="boton pequeno" onClick={() => exportar(r.nombre)}>Copiar a…</button>{' '}
                <button className="boton pequeno" onClick={() => restaurar(r.nombre)}>Restaurar</button></>}</td></tr>))}
          </tbody>
        </table>
      </Panel>
    </>
  )
}

function Feriados() {
  const { version, refrescar } = useApp()
  const [anio, setAnio] = useState(new Date().getFullYear())
  const { datos, error, recargar } = useDatos('feriados', { anio }, [version])
  const [nuevo, setNuevo] = useState({ fecha: '', nombre: '' })
  const { ocupado, error: err, ejecutar } = useAccion()
  if (error) return <ErrorCarga error={error} reintentar={recargar} />

  const agregar = async () => {
    const r = await ejecutar(() => llamar('agregar_feriado', nuevo), 'Fecha agregada: plazos recalculados')
    if (r) { setNuevo({ fecha: '', nombre: '' }); refrescar() }
  }
  const quitar = async (f) => {
    if (!window.confirm(`¿Quitar ${fecha(f.fecha)} (${f.nombre})?`)) return
    const r = await ejecutar(() => llamar('eliminar_feriado', { fecha: f.fecha }), 'Fecha quitada: plazos recalculados')
    if (r) refrescar()
  }

  return (
    <div className="dos-columnas">
      <Panel titulo="Días no hábiles" sinRelleno acciones={
        <select className="control" value={anio} onChange={e => setAnio(Number(e.target.value))}>
          {Array.from({ length: 17 }, (_, i) => 2014 + i).map(a => <option key={a} value={a}>{a}</option>)}
        </select>}>
        {!datos ? <Cargando /> : (
          <table className="tabla">
            <thead><tr><th>Fecha</th><th>Motivo</th><th>Origen</th><th></th></tr></thead>
            <tbody>{datos.map(f => (
              <tr key={f.fecha}><td>{capitalizar(fechaLarga(f.fecha))}</td><td>{f.nombre}</td>
                <td>{f.origen === 'LEY' ? <Insignia tipo="azul">Ley</Insignia> : <Insignia>Agregado</Insignia>}</td>
                <td>{f.origen !== 'LEY' && <button className="boton pequeno" onClick={() => quitar(f)}>Quitar</button>}</td></tr>))}
            </tbody>
          </table>
        )}
      </Panel>
      <Panel titulo="Agregar día no laborable" descripcion="Por ejemplo, los días no laborables que decreta el Poder Ejecutivo cada año para el sector público">
        <div className="formulario">
          <Campo etiqueta="Fecha" requerido><input type="date" value={nuevo.fecha} onChange={e => setNuevo({ ...nuevo, fecha: e.target.value })} /></Campo>
          <Campo etiqueta="Motivo / norma" requerido><input value={nuevo.nombre} onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Ej.: D.S. N° …-2026-PCM" /></Campo>
        </div>
        {err && <div style={{ marginTop: 10 }}><Aviso tipo="error">{err}</Aviso></div>}
        <button className="boton primario" style={{ marginTop: 12 }} disabled={ocupado} onClick={agregar}>Agregar</button>
        <p className="texto-suave" style={{ fontSize: 12.5, marginTop: 12 }}>Al cambiar el calendario se recalculan todos los plazos, fechas límite y los dos modelos.
          Los feriados nacionales cargados de fábrica (D. Leg. 713, Leyes 31381, 31530 y 31788, entre otras) no se pueden quitar.</p>
      </Panel>
    </div>
  )
}

function Procedimientos() {
  const { version, refrescar } = useApp()
  const { datos, error, recargar } = useDatos('procedimientos', {}, [version])
  const { datos: cat } = useDatos('catalogos', {})
  const [editando, setEditando] = useState(null)
  if (error) return <ErrorCarga error={error} reintentar={recargar} />
  if (!datos || !cat) return <Cargando />
  return (
    <>
      <Aviso tipo="informativo">El plazo TUPA alimenta las alertas, las fechas límite y el IUA. Cámbielo solo cuando se modifique el TUPA, indicando la norma.</Aviso>
      <Panel sinRelleno>
        <div className="tabla-contenedor" style={{ maxHeight: 'calc(100vh - 300px)' }}>
          <table className="tabla">
            <thead><tr><th>Procedimiento</th><th>Código TUPA</th><th className="num">Plazo (d.h.)</th><th>Departamento</th><th className="num">Expedientes</th><th>En mesa de partes</th><th></th></tr></thead>
            <tbody>{datos.map(p => (
              <tr key={p.codigo} style={{ opacity: p.activo ? 1 : 0.5 }}>
                <td><div className="destacado">{p.nombre}</div><div className="suave">{p.grupo}</div></td>
                <td className="mono suave">{p.tupa_codigo || '—'}</td>
                <td className="num">{p.plazo_tupa === null ? '—' : p.plazo_tupa}</td>
                <td>{p.departamento || '—'}</td><td className="num">{numero(p.expedientes)}</td>
                <td>{p.seleccionable ? 'Sí' : 'No'}</td>
                <td><button className="boton pequeno" onClick={() => setEditando(p)}>Editar</button></td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </Panel>
      {editando && <FormProcedimiento p={editando} cat={cat} alCerrar={() => setEditando(null)} alListo={() => { setEditando(null); refrescar() }} />}
    </>
  )
}

function FormProcedimiento({ p, cat, alCerrar, alListo }) {
  const [f, setF] = useState({ plazo_tupa: p.plazo_tupa === null ? '' : String(p.plazo_tupa), tupa_codigo: p.tupa_codigo || '',
    tupa_nombre: p.tupa_nombre || '', departamento_codigo: p.departamento_codigo || '', seleccionable: !!p.seleccionable, activo: !!p.activo, motivo: '' })
  const { ocupado, error, ejecutar } = useAccion()
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const guardar = async () => {
    const r = await ejecutar(() => llamar('editar_procedimiento', { codigo: p.codigo, ...f, plazo_tupa: f.plazo_tupa === '' ? null : Number(f.plazo_tupa) }), 'Procedimiento actualizado: modelos recalculados')
    if (r) alListo()
  }
  return (
    <Modal titulo={p.nombre} alCerrar={alCerrar} pie={<><button className="boton" onClick={alCerrar}>Cancelar</button><button className="boton primario" disabled={ocupado} onClick={guardar}>Guardar</button></>}>
      <div className="formulario">
        <Campo etiqueta="Plazo TUPA (días hábiles)" ayuda="Vacío si el TUPA no fija plazo; 0 = mismo día"><input value={f.plazo_tupa} onChange={set('plazo_tupa')} /></Campo>
        <Campo etiqueta="Código TUPA"><input value={f.tupa_codigo} onChange={set('tupa_codigo')} /></Campo>
        <Campo etiqueta="Nombre en el TUPA" completo><input value={f.tupa_nombre} onChange={set('tupa_nombre')} /></Campo>
        <Campo etiqueta="Departamento" completo>
          <select value={f.departamento_codigo} onChange={set('departamento_codigo')}>
            <option value="">— Ninguno —</option>
            {cat.departamentos.map(d => <option key={d.codigo} value={d.codigo}>{d.nombre}</option>)}
          </select>
        </Campo>
        <label className="casilla"><input type="checkbox" checked={f.seleccionable} onChange={set('seleccionable')} /> Se puede elegir en mesa de partes</label>
        <label className="casilla"><input type="checkbox" checked={f.activo} onChange={set('activo')} /> Activo</label>
        <Campo etiqueta="Motivo o norma que sustenta el cambio" requerido completo><input value={f.motivo} onChange={set('motivo')} /></Campo>
      </div>
      {error && <div style={{ marginTop: 10 }}><Aviso tipo="error">{error}</Aviso></div>}
    </Modal>
  )
}

function Parametros() {
  const { refrescar } = useApp()
  const { datos: cat, recargar } = useDatos('catalogos', {})
  const [v, setV] = useState(null)
  const { ocupado, error, ejecutar } = useAccion()
  useEffect(() => {
    if (cat) setV({ dias_alerta_por_vencer: String(cat.parametros.dias_alerta_por_vencer), dias_abandono: String(cat.parametros.dias_abandono ?? 30),
                    fecha_implementacion: cat.parametros.fecha_implementacion || cat.importacion?.fecha_corte || '', portal_url: cat.parametros.portal_url || 'http://localhost:7302' })
  }, [cat])
  if (!cat || !v) return <Cargando />
  const p = cat.parametros
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })
  const guardar = async () => {
    const r = await ejecutar(() => llamar('guardar_parametros', { dias_alerta_por_vencer: Number(v.dias_alerta_por_vencer), dias_abandono: Number(v.dias_abandono),
      fecha_implementacion: v.fecha_implementacion, portal_url: v.portal_url }), 'Parámetros guardados')
    if (r) { recargar(); refrescar() }
  }
  return (
    <div className="dos-columnas">
      <Panel titulo="Alertas y operación">
        <div className="formulario">
          <Campo etiqueta="Avisar «por vencer» cuando falten (días hábiles)"><input type="number" min="1" max="30" value={v.dias_alerta_por_vencer} onChange={set('dias_alerta_por_vencer')} /></Campo>
          <Campo etiqueta="Considerar abandonado tras (días hábiles sin movimiento)"><input type="number" min="5" max="365" value={v.dias_abandono} onChange={set('dias_abandono')} /></Campo>
          <Campo etiqueta="Fecha de implementación de URBANITO" ayuda="Divide el «antes» y el «después» en el tablero"><input type="date" value={v.fecha_implementacion} onChange={set('fecha_implementacion')} /></Campo>
          <Campo etiqueta="Dirección del portal ciudadano" ayuda="Se incluye en el mensaje de WhatsApp con las credenciales"><input value={v.portal_url} onChange={set('portal_url')} /></Campo>
        </div>
        {error && <div style={{ marginTop: 10 }}><Aviso tipo="error">{error}</Aviso></div>}
        <button className="boton primario" style={{ marginTop: 12 }} disabled={ocupado} onClick={guardar}>Guardar</button>
      </Panel>
      <Panel titulo="Parámetros metodológicos (fijos)" descripcion="Definen los modelos; cambiarlos alteraría la comparabilidad de los resultados">
        <table className="tabla"><tbody>
          <tr><td>Mínimo de casos para publicar estadísticas (MTA)</td><td className="num">{p.n_minimo}</td></tr>
          <tr><td>Mínimo de movimientos para medir trayectoria (MTA)</td><td className="num">{p.mov_minimo}</td></tr>
          <tr><td>Percentil de referencia de complejidad (IUA)</td><td className="num">P{p.percentil_complejidad * 100}</td></tr>
          <tr><td>Percentil de referencia de antigüedad (IUA)</td><td className="num">P{p.percentil_antiguedad * 100}</td></tr>
          <tr><td>Cortes de nivel (IUA)</td><td className="num">{p.cortes.map(c => `${c[0]} ≥ ${c[1]}`).join(' · ')}</td></tr>
          <tr><td>Escala del tipo de procedimiento</td><td className="num">1.0 / 0.6 / 0.3</td></tr>
          <tr><td>Cierre de importados por inactividad</td><td className="num">{p.dias_inactividad_cierre} d.h.</td></tr>
          <tr><td>Pesos de eficiencia eᵢⱼ (asignación MILP)</td><td className="num">0.40 / 0.35 / 0.25</td></tr>
        </tbody></table>
      </Panel>
    </div>
  )
}

// Botones rápidos con textos frecuentes para «Observar»
function Plantillas() {
  const { datos, recargar } = useDatos('plantillas_observacion', {})
  const [lista, setLista] = useState(null)
  const { ocupado, error, ejecutar } = useAccion()
  useEffect(() => { if (datos) setLista(datos.map(p => ({ ...p }))) }, [datos])
  if (!lista) return <Cargando />
  const cambiar = (i, k) => (e) => setLista(lista.map((p, j) => (j === i ? { ...p, [k]: e.target.value } : p)))
  const guardar = async () => {
    const r = await ejecutar(() => llamar('guardar_plantillas_observacion', { plantillas: lista }), 'Plantillas guardadas')
    if (r) recargar()
  }
  return (
    <Panel titulo="Plantillas de observación" descripcion="Aparecen como botones al observar un expediente. El texto se agrega a la observación y se puede completar.">
      <table className="tabla">
        <thead><tr><th style={{ width: 200 }}>Botón</th><th>Texto que se agrega</th><th /></tr></thead>
        <tbody>{lista.map((p, i) => (
          <tr key={i}><td><input className="control" value={p.titulo} onChange={cambiar(i, 'titulo')} maxLength={40} /></td>
            <td><textarea className="control" rows={2} value={p.texto} onChange={cambiar(i, 'texto')} maxLength={500} /></td>
            <td><button className="boton pequeno" onClick={() => setLista(lista.filter((_, j) => j !== i))}>Quitar</button></td></tr>))}</tbody>
      </table>
      <div className="grupo-botones" style={{ marginTop: 12 }}>
        <button className="boton" disabled={lista.length >= 30} onClick={() => setLista([...lista, { titulo: '', texto: '' }])}>+ Agregar plantilla</button>
        <button className="boton primario" disabled={ocupado} onClick={guardar}>Guardar plantillas</button>
      </div>
      {error && <div style={{ marginTop: 10 }}><Aviso tipo="error">{error}</Aviso></div>}
    </Panel>
  )
}
