// Seguimiento (administrador y gerente): avance de cada trabajador y sus
// asignaciones, consolidado de reportes semanales y actividad por usuario.
// Se actualiza solo: la campana detecta cambios de datos cada 10 segundos.
import { Fragment, useState } from 'react'
import { useDatos } from '../api'
import { useApp, Panel, Cargando, ErrorCarga, Aviso, Indicador, Insignia, Nivel, Pestanas, Vacio, Semaforo } from './Comunes'
import { numero, fecha, fechaHora, porcentaje } from '../formato'
import { exportarExcel, exportarPdf, documentoHtml, tablaHtml } from '../exportar'
import { escaparHtml as h } from '../formato'

export default function Seguimiento({ inicial = {} }) {
  const [pestana, setPestana] = useState(inicial.pestana || 'trabajadores')
  return (
    <>
      <Pestanas activa={pestana} alCambiar={setPestana} opciones={[
        { clave: 'trabajadores', etiqueta: 'Trabajadores y asignaciones' },
        { clave: 'reportes', etiqueta: 'Reportes semanales' },
        { clave: 'actividad', etiqueta: 'Actividad por usuario' },
      ]} />
      {pestana === 'trabajadores' && <Trabajadores />}
      {pestana === 'reportes' && <Consolidado />}
      {pestana === 'actividad' && <Actividad />}
    </>
  )
}

// ---------------------------------------------------------------- trabajadores
function Trabajadores() {
  const { version, abrirFicha } = useApp()
  const [f, setF] = useState({ usuario_id: '', departamento: '', estado: 'ACTIVAS', desde: '', hasta: '' })
  const [vista, setVista] = useState('tarjetas')
  const { datos, error, recargar } = useDatos('seguimiento', f, [version])
  if (error) return <ErrorCarga error={error} reintentar={recargar} />
  if (!datos) return <Cargando />
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const t = datos.totales

  return (
    <>
      <Panel>
        <div className="filtros">
          <select className="control" value={f.usuario_id} onChange={set('usuario_id')}>
            <option value="">Todos los trabajadores</option>
            {datos.trabajadores.concat().sort((a, b) => a.nombre.localeCompare(b.nombre)).map(x => <option key={x.usuario_id} value={x.usuario_id}>{x.nombre}</option>)}
          </select>
          <select className="control" value={f.departamento} onChange={set('departamento')}>
            <option value="">Todos los departamentos</option>
            {datos.departamentos.map(d => <option key={d.codigo} value={d.codigo}>{d.nombre}</option>)}
          </select>
          <select className="control" value={f.estado} onChange={set('estado')}>
            <option value="ACTIVAS">Asignaciones activas</option><option value="PENDIENTE">Pendientes</option>
            <option value="EN_PROGRESO">En progreso</option><option value="COMPLETADA">Completadas</option><option value="">Todas</option>
          </select>
          <label className="casilla">Desde <input type="date" className="control" value={f.desde} onChange={set('desde')} /></label>
          <label className="casilla">Hasta <input type="date" className="control" value={f.hasta} onChange={set('hasta')} /></label>
          <div style={{ marginLeft: 'auto' }} className="grupo-botones">
            <button className={`filtro${vista === 'tarjetas' ? ' activo' : ''}`} onClick={() => setVista('tarjetas')}>Tarjetas</button>
            <button className={`filtro${vista === 'tabla' ? ' activo' : ''}`} onClick={() => setVista('tabla')}>Tabla</button>
          </div>
        </div>
      </Panel>
      <div className="rejilla-indicadores">
        <Indicador etiqueta="Asignaciones activas" valor={numero(t.activas)} />
        <Indicador etiqueta="Completadas esta semana" valor={numero(t.completadas_semana)} tono="bajo" nota={`Semana ${datos.semana}`} />
        <Indicador etiqueta="Completadas (total)" valor={numero(t.completadas)} nota={`de ${numero(t.asignadas)} asignadas`} />
        <Indicador etiqueta="Vencidas" valor={numero(t.vencidas)} tono={t.vencidas ? 'critico' : ''} nota="Pasaron su fecha límite" />
      </div>
      {!datos.trabajadores.length && <Vacio texto="No hay trabajadores con estos filtros." />}
      {vista === 'tabla' ? (
        <Panel sinRelleno>
          <table className="tabla">
            <thead><tr><th>Trabajador</th><th>Departamento(s)</th><th className="num">Activas</th><th className="num">Vencidas</th><th className="num">Completadas</th>
              <th className="num">% avance semanal</th><th className="num">Prom. días por cierre</th><th>Reporte semanal</th></tr></thead>
            <tbody>{datos.trabajadores.map(x => (
              <tr key={x.usuario_id}><td className="destacado">{x.nombre}<div className="suave">{x.rol}</div></td><td className="suave">{x.departamentos.join(', ')}</td>
                <td className="num">{x.activas} / {x.capacidad_maxima}</td><td className="num">{x.vencidas || 0}</td><td className="num">{x.completadas}</td>
                <td className="num">{x.avance_semanal === null ? '—' : porcentaje(x.avance_semanal, 0)}</td>
                <td className="num">{x.promedio_dias_cierre === null ? '—' : numero(x.promedio_dias_cierre, 1)}</td>
                <td>{x.reporte_semana ? <Insignia tipo="BAJO">Enviado {fecha(x.reporte_semana)}</Insignia> : <Insignia>Pendiente</Insignia>}</td></tr>))}
            </tbody>
          </table>
        </Panel>
      ) : (
        <div className="kanban">
          {datos.trabajadores.map(x => (
            <div key={x.usuario_id} className="columna-kanban">
              <div className="cabeza-kanban">
                <div className="destacado">{x.nombre}</div>
                <div className="suave">{x.rol} · {x.departamentos.join(', ')}</div>
                <div className="metricas">
                  <span title="Activas / capacidad">{x.activas}/{x.capacidad_maxima} activas</span>
                  <span>{x.completadas} hechas</span>
                  <span title="Completadas esta semana / (activas + completadas esta semana)">{x.avance_semanal === null ? '—' : porcentaje(x.avance_semanal, 0)} semana</span>
                  <span title="Promedio de días hábiles desde la asignación hasta completarla">{x.promedio_dias_cierre === null ? '—' : `${numero(x.promedio_dias_cierre, 1)} d.h./cierre`}</span>
                </div>
                <div className="barra-progreso" style={{ margin: '6px 0 0' }}><div style={{ width: `${Math.min(100, (x.activas / Math.max(1, x.capacidad_maxima)) * 100)}%` }} /></div>
                {!x.reporte_semana && <div className="suave" style={{ color: 'var(--alto)', marginTop: 4 }}>Sin reporte semanal ({datos.semana})</div>}
              </div>
              <div className="tarjetas-kanban">
                {!x.asignaciones.length && <div className="vacio" style={{ padding: 14 }}>Sin asignaciones</div>}
                {x.asignaciones.map(a => (
                  <button key={a.id} className={`tarjeta-kanban ${a.vencida ? 'vencida' : ''}`} onClick={() => abrirFicha(a.expediente_id)}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span className="mono destacado">{a.numero}</span>{a.nivel && <Nivel nivel={a.nivel} />}
                      <span style={{ marginLeft: 'auto' }}><Insignia tipo={a.estado === 'COMPLETADA' ? 'BAJO' : a.estado === 'EN_PROGRESO' ? 'azul' : 'MEDIO'}>{a.estado_nombre}</Insignia></span>
                    </div>
                    <div className="suave">{a.procedimiento}</div>
                    <div className="suave">IUA {a.iua === null ? '—' : a.iua.toFixed(2)} · {a.dias ?? '—'} d.h. · límite {fecha(a.fecha_limite)}
                      {a.vencida && <b style={{ color: 'var(--critico)' }}> · vencida</b>}</div>
                    {a.ultimo_movimiento && <div className="suave">Último: {fecha(a.ultimo_movimiento.fecha)} {a.ultimo_movimiento.tipo}{a.ultimo_movimiento.usuario ? ` (${a.ultimo_movimiento.usuario})` : ''}</div>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="texto-tenue" style={{ fontSize: 11.5 }}>Se actualiza automáticamente cuando alguien deriva, recibe o finaliza un expediente.</p>
    </>
  )
}

// ---------------------------------------------------------------- consolidado semanal
const COLOR_SEMAFORO = { VERDE: 'verde', AMARILLO: 'amarillo', ROJO: 'rojo' }

function Consolidado() {
  const { version, notificar, estado, usuario } = useApp()
  const [semana, setSemana] = useState('')
  const [abierto, setAbierto] = useState(null)
  const { datos, error, recargar } = useDatos('reportes_consolidado', { semana: semana || undefined }, [version])
  if (error) return <ErrorCarga error={error} reintentar={recargar} />
  if (!datos) return <Cargando />
  const c = datos.conteo

  const filasPlanas = datos.filas.map(f => ({
    nombre: f.nombre, departamentos: f.departamentos.join(', '), semaforo: f.semaforo.color, motivo: f.semaforo.motivo,
    llenado: f.reporte ? f.reporte.fecha_llenado : null, asignaciones: f.reporte ? f.reporte.asignaciones.length : 0,
    en_proceso: f.reporte ? f.reporte.asignaciones.filter(a => a.estado === 'En proceso').length : 0,
    finalizados: f.reporte ? f.reporte.asignaciones.filter(a => a.estado === 'Finalizado').length : 0,
    dificultades: f.reporte?.dificultades || '', apoyo: f.reporte?.necesita_apoyo ? 'Sí' : '', adicionales: f.reporte?.adicionales || '',
  }))
  const detalle = datos.filas.flatMap(f => (f.reporte ? f.reporte.asignaciones : []).map(a => ({ nombre: f.nombre, ...a })))
  const excel = () => exportarExcel(notificar, `reporte_semanal_${datos.semana}`, [
    { nombre: 'Consolidado', titulo: `Reporte semanal consolidado — ${datos.semana}`, subtitulo: `${c.llenaron} de ${c.total} trabajadores enviaron su reporte`,
      columnas: [{ titulo: 'Trabajador', clave: 'nombre', ancho: 30 }, { titulo: 'Departamento(s)', clave: 'departamentos', ancho: 30 },
        { titulo: 'Semáforo', clave: 'semaforo' }, { titulo: 'Motivo', clave: 'motivo', ancho: 28 }, { titulo: 'Llenado', clave: 'llenado', formato: 'fecha' },
        { titulo: 'Asignaciones', clave: 'asignaciones', formato: 'numero' }, { titulo: 'En proceso', clave: 'en_proceso', formato: 'numero' },
        { titulo: 'Finalizados', clave: 'finalizados', formato: 'numero' }, { titulo: 'Dificultades', clave: 'dificultades', ancho: 50 },
        { titulo: 'Pide apoyo', clave: 'apoyo' }, { titulo: 'Fuera de asignación', clave: 'adicionales', ancho: 40 }], filas: filasPlanas },
    { nombre: 'Detalle', titulo: `Detalle por expediente — ${datos.semana}`, subtitulo: '',
      columnas: [{ titulo: 'Trabajador', clave: 'nombre', ancho: 30 }, { titulo: 'Expediente', clave: 'numero', ancho: 18 },
        { titulo: 'Trámite', clave: 'procedimiento', ancho: 32 }, { titulo: 'Estado', clave: 'estado' }, { titulo: 'Avance', clave: 'avance', ancho: 60 }], filas: detalle },
  ])
  const pdf = () => {
    const cuerpo = `<p>${c.llenaron} de ${c.total} trabajadores enviaron su reporte · Verde ${c.VERDE} · Amarillo ${c.AMARILLO} · Rojo ${c.ROJO}</p>
      ${tablaHtml([{ titulo: 'Trabajador', clave: 'nombre' }, { titulo: 'Departamento(s)', clave: 'departamentos' }, { titulo: 'Semáforo', clave: 'semaforo' },
        { titulo: 'Motivo', clave: 'motivo' }, { titulo: 'En proceso', clave: 'en_proceso', formato: 'numero' }, { titulo: 'Finalizados', clave: 'finalizados', formato: 'numero' },
        { titulo: 'Dificultades', clave: 'dificultades' }], filasPlanas)}
      ${datos.filas.filter(f => f.reporte && f.reporte.asignaciones.length).map(f => `<h2>${h(f.nombre)}</h2>${tablaHtml(
        [{ titulo: 'Expediente', clave: 'numero' }, { titulo: 'Trámite', clave: 'procedimiento' }, { titulo: 'Estado', clave: 'estado' }, { titulo: 'Avance', clave: 'avance' }],
        f.reporte.asignaciones)}`).join('')}`
    exportarPdf(notificar, `reporte_semanal_${datos.semana}`, documentoHtml({ titulo: 'Reporte semanal consolidado', subtitulo: `Semana ${datos.semana}`,
      institucion: estado.institucion, cuerpo, usuario }), true)
  }

  return (
    <>
      <div className="filtros" style={{ marginBottom: 12 }}>
        <select className="control" value={datos.semana} onChange={e => setSemana(e.target.value)}>
          {datos.semanas.map(s => <option key={s} value={s}>Semana {s}</option>)}
        </select>
        <div className="grupo-botones" style={{ marginLeft: 'auto' }}>
          <button className="boton pequeno" onClick={excel}>⬇ Excel</button>
          <button className="boton pequeno" onClick={pdf}>⎙ PDF</button>
        </div>
      </div>
      <div className="rejilla-indicadores">
        <Indicador etiqueta="Enviaron su reporte" valor={`${c.llenaron} / ${c.total}`} />
        <Indicador etiqueta="Verde — todo avanza" valor={c.VERDE} tono="bajo" />
        <Indicador etiqueta="Amarillo — dificultades" valor={c.AMARILLO} tono="medio" />
        <Indicador etiqueta="Rojo — sin avance o sin reporte" valor={c.ROJO} tono="critico" />
      </div>
      <Panel sinRelleno>
        {!datos.filas.length ? <Vacio texto="No hay trabajadores que deban reportar." /> : (
          <table className="tabla">
            <thead><tr><th>Semáforo</th><th>Trabajador</th><th>Departamento(s)</th><th>Llenado</th><th className="num">Asignaciones</th><th>Dificultades</th><th></th></tr></thead>
            <tbody>{datos.filas.map(f => (
              <Fragment key={f.usuario_id}>
                <tr className={f.reporte ? 'clicable' : ''} onClick={() => f.reporte && setAbierto(abierto === f.usuario_id ? null : f.usuario_id)}>
                  <td><Semaforo color={COLOR_SEMAFORO[f.semaforo.color]}>{f.semaforo.motivo}</Semaforo></td>
                  <td className="destacado">{f.nombre}<div className="suave">{f.rol}</div></td>
                  <td className="suave">{f.departamentos.join(', ')}</td>
                  <td>{f.reporte ? fecha(f.reporte.fecha_llenado) : '—'}</td>
                  <td className="num">{f.reporte ? f.reporte.asignaciones.length : '—'}</td>
                  <td style={{ maxWidth: 320 }}>{f.reporte?.dificultades || ''}{f.reporte?.necesita_apoyo && <div><Insignia tipo="ALTO">Pide apoyo</Insignia></div>}</td>
                  <td>{f.reporte && (abierto === f.usuario_id ? '▾' : '▸')}</td>
                </tr>
                {abierto === f.usuario_id && f.reporte && (
                  <tr><td colSpan={7} style={{ background: 'var(--fondo)' }}>
                    <table className="tabla" style={{ background: '#fff' }}>
                      <thead><tr><th>Expediente</th><th>Trámite</th><th>Estado reportado</th><th>Descripción del avance</th></tr></thead>
                      <tbody>{f.reporte.asignaciones.map(a => <tr key={a.asignacion_id}><td className="mono">{a.numero}</td><td>{a.procedimiento}</td><td>{a.estado}</td><td>{a.avance || '—'}</td></tr>)}</tbody>
                    </table>
                    {f.reporte.adicionales && <p style={{ marginTop: 8 }}><b>Fuera de asignación:</b> {f.reporte.adicionales}</p>}
                  </td></tr>
                )}
              </Fragment>
            ))}</tbody>
          </table>
        )}
      </Panel>
    </>
  )
}

// ---------------------------------------------------------------- actividad por usuario
function Actividad() {
  const { version, abrirFicha, notificar } = useApp()
  const hoy = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState({ desde: hoy, hasta: hoy, usuario_id: '' })
  const { datos, error, recargar } = useDatos('actividad_usuarios', { ...f, detalle: !!f.usuario_id }, [version])
  if (error) return <ErrorCarga error={error} reintentar={recargar} />
  if (!datos) return <Cargando />
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <>
      <Panel>
        <div className="filtros">
          <label className="casilla">Desde <input type="date" className="control" value={f.desde} onChange={set('desde')} /></label>
          <label className="casilla">Hasta <input type="date" className="control" value={f.hasta} onChange={set('hasta')} /></label>
          <select className="control" value={f.usuario_id} onChange={set('usuario_id')}>
            <option value="">Todos los usuarios</option>
            {datos.usuarios.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
          </select>
          <button className="boton pequeno" style={{ marginLeft: 'auto' }} disabled={!datos.resumen.length}
                  onClick={() => exportarExcel(notificar, `actividad_${datos.desde}_${datos.hasta}`, [{ nombre: 'Actividad', titulo: 'Actividad por usuario',
                    subtitulo: `${fecha(datos.desde)} a ${fecha(datos.hasta)}`,
                    columnas: [{ titulo: 'Día', clave: 'dia', formato: 'fecha' }, { titulo: 'Usuario', clave: 'usuario', ancho: 30 }, { titulo: 'Rol', clave: 'rol', ancho: 20 },
                      { titulo: 'Acciones', clave: 'acciones', formato: 'numero' }, { titulo: 'Expedientes tocados', clave: 'expedientes', formato: 'numero' },
                      { titulo: 'Registrados', clave: 'registrados', formato: 'numero' }, { titulo: 'Derivados', clave: 'derivados', formato: 'numero' },
                      { titulo: 'Observados', clave: 'observados', formato: 'numero' }, { titulo: 'Finalizados', clave: 'finalizados', formato: 'numero' },
                      { titulo: 'Recibidos', clave: 'recibidos', formato: 'numero' }], filas: datos.resumen }])}>⬇ Excel</button>
        </div>
      </Panel>
      <Panel sinRelleno titulo="Qué hizo cada persona cada día" descripcion="Según la auditoría: cada acción queda registrada con su usuario y hora">
        {!datos.resumen.length ? <Vacio texto="Sin actividad en el periodo." /> : (
          <table className="tabla">
            <thead><tr><th>Día</th><th>Usuario</th><th className="num">Acciones</th><th className="num">Expedientes tocados</th><th className="num">Registrados</th>
              <th className="num">Derivados</th><th className="num">Observados</th><th className="num">Finalizados</th><th className="num">Recibidos</th><th>Horario</th></tr></thead>
            <tbody>{datos.resumen.map(r => (
              <tr key={`${r.usuario_id}|${r.dia}`} className="clicable" onClick={() => setF({ ...f, usuario_id: String(r.usuario_id), desde: r.dia, hasta: r.dia })}>
                <td>{fecha(r.dia)}</td><td className="destacado">{r.usuario}<div className="suave">{r.rol}</div></td>
                <td className="num">{r.acciones}</td><td className="num destacado">{r.expedientes}</td><td className="num">{r.registrados}</td>
                <td className="num">{r.derivados}</td><td className="num">{r.observados}</td><td className="num">{r.finalizados}</td><td className="num">{r.recibidos}</td>
                <td className="suave">{fechaHora(r.primera).slice(11)}–{fechaHora(r.ultima).slice(11)}</td></tr>))}</tbody>
          </table>
        )}
      </Panel>
      {datos.detalle && (
        <Panel sinRelleno titulo="Detalle de acciones">
          <div className="tabla-contenedor" style={{ maxHeight: 420 }}>
            <table className="tabla">
              <thead><tr><th>Hora</th><th>Acción</th><th>Expediente</th><th>Detalle</th></tr></thead>
              <tbody>{datos.detalle.map(a => (
                <tr key={a.id}><td className="suave">{fechaHora(a.fecha_hora)}</td><td>{a.accion}</td>
                  <td>{a.expediente_id ? <button className="enlace mono" onClick={() => abrirFicha(a.expediente_id)}>{a.numero}</button> : '—'}</td>
                  <td className="suave" style={{ maxWidth: 520, wordBreak: 'break-word' }}>{a.detalle}</td></tr>))}</tbody>
            </table>
          </div>
        </Panel>
      )}
      {!datos.detalle && <Aviso tipo="informativo">Haga clic en una fila para ver el detalle de las acciones de esa persona ese día.</Aviso>}
    </>
  )
}
