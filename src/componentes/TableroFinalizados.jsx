// Tablero › Finalizados y Tablero › Antes vs después de URBANITO.
import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend } from 'recharts'
import { useDatos, llamar } from '../api'
import { useApp, Panel, Indicador, Cargando, ErrorCarga, Aviso, Vacio } from './Comunes'
import { numero, porcentaje, mes, fecha } from '../formato'
import { exportarExcel, exportarPdf, documentoHtml, tablaHtml } from '../exportar'

// paleta categórica (azules y complementarios del programa)
const PALETA = ['#1a3c6e', '#2d5a9e', '#16a34a', '#ea580c', '#ca8a04', '#7c3aed', '#0891b2', '#db2777', '#64748b', '#65a30d']
const corto = (s, n = 30) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s)

const COLUMNAS = [
  { titulo: 'Expediente', clave: 'numero', ancho: 18 }, { titulo: 'Sistema', clave: 'sistema', ancho: 12 },
  { titulo: 'Solicitante', clave: 'solicitante', ancho: 30 }, { titulo: 'Trámite', clave: 'procedimiento', ancho: 32 },
  { titulo: 'Departamento', clave: 'departamento', ancho: 30 }, { titulo: 'Ingreso', clave: 'fecha_ingreso', formato: 'fecha' },
  { titulo: 'Cierre', clave: 'fecha_cierre', formato: 'fecha' }, { titulo: 'Días hábiles de atención', clave: 'dias_atencion', formato: 'numero' },
  { titulo: 'Plazo TUPA', clave: 'plazo_tupa', formato: 'numero' }, { titulo: 'Finalizado por', clave: 'finalizado_por', ancho: 28 },
]

export function Finalizados() {
  const { version, abrirFicha, notificar, estado, usuario } = useApp()
  const { datos: cat } = useDatos('catalogos', {})
  const [f, setF] = useState({ persona: '', departamento: '', procedimiento: '', desde: '', hasta: '', incluir_historicos: false })
  const { datos: d, error, recargar } = useDatos('finalizados', f, [version])
  if (error) return <ErrorCarga error={error} reintentar={recargar} />
  if (!d || !cat) return <Cargando />
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const k = d.kpis

  const excel = async () => {
    const todo = await llamar('finalizados', { ...f, todos: true })
    exportarExcel(notificar, `finalizados_${new Date().toISOString().slice(0, 10)}`, [
      { nombre: 'Finalizados', titulo: 'Expedientes finalizados', subtitulo: `${numero(todo.total)} expedientes`, columnas: COLUMNAS, filas: todo.filas },
      { nombre: 'Por mes', titulo: 'Finalizados por mes', subtitulo: '', columnas: [{ titulo: 'Mes', clave: 'mes' }, { titulo: 'Finalizados', clave: 'finalizados', formato: 'numero' },
        { titulo: 'Promedio días', clave: 'promedio_dias', formato: 'decimal1' }, { titulo: 'Mediana días', clave: 'mediana_dias', formato: 'decimal1' }], filas: todo.por_mes },
      { nombre: 'Por trabajador', titulo: 'Finalizados por trabajador', subtitulo: '', columnas: [{ titulo: 'Trabajador', clave: 'nombre', ancho: 30 },
        { titulo: 'Finalizados', clave: 'n', formato: 'numero' }, { titulo: 'Mediana días', clave: 'mediana_dias', formato: 'decimal1' }], filas: todo.por_trabajador },
      { nombre: 'Por departamento', titulo: 'Finalizados por departamento', subtitulo: '', columnas: [{ titulo: 'Departamento', clave: 'nombre', ancho: 34 },
        { titulo: 'Finalizados', clave: 'n', formato: 'numero' }, { titulo: 'Mediana días', clave: 'mediana_dias', formato: 'decimal1' }], filas: todo.por_departamento },
    ])
  }
  const pdf = () => {
    const cuerpo = `<p>Finalizados: ${numero(k.finalizados)} · mediana ${numero(k.mediana_dias, 1)} d.h. · dentro del plazo TUPA ${porcentaje(k.dentro_plazo)}</p>
      <h2>Por mes</h2>${tablaHtml([{ titulo: 'Mes', clave: 'mes' }, { titulo: 'Finalizados', clave: 'finalizados', formato: 'numero' },
        { titulo: 'Promedio días', clave: 'promedio_dias', formato: 'decimal1' }], d.por_mes)}
      <h2>Por departamento</h2>${tablaHtml([{ titulo: 'Departamento', clave: 'nombre' }, { titulo: 'Finalizados', clave: 'n', formato: 'numero' },
        { titulo: 'Mediana días', clave: 'mediana_dias', formato: 'decimal1' }], d.por_departamento)}
      <h2>Por trabajador</h2>${tablaHtml([{ titulo: 'Trabajador', clave: 'nombre' }, { titulo: 'Finalizados', clave: 'n', formato: 'numero' },
        { titulo: 'Mediana días', clave: 'mediana_dias', formato: 'decimal1' }], d.por_trabajador)}`
    exportarPdf(notificar, 'finalizados', documentoHtml({ titulo: 'Expedientes finalizados', subtitulo: [f.desde && `desde ${fecha(f.desde)}`, f.hasta && `hasta ${fecha(f.hasta)}`].filter(Boolean).join(' ') || 'Todo el periodo',
      institucion: estado.institucion, cuerpo, usuario }))
  }

  const tramites = d.por_tramite.slice(0, 8)
  const otros = d.por_tramite.slice(8).reduce((s, x) => s + x.n, 0)
  const torta = otros ? [...tramites, { clave: 'OTROS', nombre: 'Otros trámites', n: otros }] : tramites

  return (
    <>
      <Panel>
        <div className="filtros">
          <select className="control" value={f.persona} onChange={set('persona')}>
            <option value="">Todas las personas</option>
            {d.personas.map(p => <option key={p.clave} value={p.clave}>{p.nombre} ({p.n})</option>)}
          </select>
          <select className="control" value={f.departamento} onChange={set('departamento')}>
            <option value="">Todos los departamentos</option>
            {cat.departamentos.map(x => <option key={x.codigo} value={x.codigo}>{x.nombre}</option>)}
          </select>
          <select className="control" value={f.procedimiento} onChange={set('procedimiento')}>
            <option value="">Todos los trámites</option>
            {cat.procedimientos.map(p => <option key={p.codigo} value={p.codigo}>{p.nombre}</option>)}
          </select>
          <label className="casilla">Cierre desde <input type="date" className="control" value={f.desde} onChange={set('desde')} /></label>
          <label className="casilla">hasta <input type="date" className="control" value={f.hasta} onChange={set('hasta')} /></label>
          <label className="casilla"><input type="checkbox" checked={f.incluir_historicos} onChange={set('incluir_historicos')} /> Incluir cerrados del sistema anterior</label>
          <div className="grupo-botones" style={{ marginLeft: 'auto' }}>
            <button className="boton pequeno" onClick={excel} disabled={!d.total}>⬇ Excel</button>
            <button className="boton pequeno" onClick={pdf} disabled={!d.total}>⎙ PDF</button>
          </div>
        </div>
      </Panel>
      <div className="rejilla-indicadores">
        <Indicador etiqueta="Finalizados" valor={numero(k.finalizados)} />
        <Indicador etiqueta="Mediana de atención" valor={k.mediana_dias === null ? '—' : `${numero(k.mediana_dias, 1)} d.h.`} nota={`${numero(k.con_tiempo)} con trayectoria medible`} />
        <Indicador etiqueta="Promedio de atención" valor={k.promedio_dias === null ? '—' : `${numero(k.promedio_dias, 1)} d.h.`} />
        <Indicador etiqueta="Dentro del plazo TUPA" valor={porcentaje(k.dentro_plazo, 0)} tono={k.dentro_plazo !== null && k.dentro_plazo < 0.5 ? 'critico' : 'bajo'} />
      </div>
      {!d.total ? <Vacio texto="No hay expedientes finalizados con estos filtros." /> : (
        <>
          <div className="dos-columnas">
            <Panel titulo="Finalizados por mes">
              <div className="grafico"><ResponsiveContainer>
                <BarChart data={d.por_mes} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="mes" tickFormatter={mes} fontSize={11} /><YAxis allowDecimals={false} fontSize={11} />
                  <Tooltip labelFormatter={mes} formatter={(v) => [`${v} expedientes`, 'Finalizados']} />
                  <Bar dataKey="finalizados" fill="#2d5a9e" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart></ResponsiveContainer></div>
            </Panel>
            <Panel titulo="Tiempo de resolución por mes" descripcion="Promedio y mediana de días hábiles de atención de los finalizados en cada mes">
              <div className="grafico"><ResponsiveContainer>
                <LineChart data={d.por_mes} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="mes" tickFormatter={mes} fontSize={11} /><YAxis fontSize={11} unit=" d" />
                  <Tooltip labelFormatter={mes} formatter={(v, n) => [v === null ? '—' : `${numero(v, 1)} d.h.`, n]} /><Legend />
                  <Line type="monotone" dataKey="promedio_dias" name="Promedio" stroke="#1a3c6e" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                  <Line type="monotone" dataKey="mediana_dias" name="Mediana" stroke="#ea580c" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                </LineChart></ResponsiveContainer></div>
            </Panel>
          </div>
          <div className="dos-columnas">
            <Panel titulo="Finalizados por departamento">
              <div style={{ height: Math.max(220, d.por_departamento.length * 30) }}><ResponsiveContainer>
                <BarChart data={d.por_departamento.map(x => ({ ...x, corto: corto((x.nombre || '').replace(/^Departamento de /, ''), 30) }))} layout="vertical" margin={{ top: 0, right: 30, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis type="number" allowDecimals={false} fontSize={11} />
                  <YAxis type="category" dataKey="corto" width={200} fontSize={11} /><Tooltip formatter={(v) => [`${v} expedientes`, 'Finalizados']} />
                  <Bar dataKey="n" fill="#16a34a" radius={[0, 4, 4, 0]} isAnimationActive={false} />
                </BarChart></ResponsiveContainer></div>
            </Panel>
            <Panel titulo="Distribución por tipo de trámite">
              <div className="grafico"><ResponsiveContainer>
                <PieChart>
                  <Pie data={torta} dataKey="n" nameKey="nombre" outerRadius={105} innerRadius={50} isAnimationActive={false}
                       label={({ percent }) => (percent > 0.04 ? `${Math.round(percent * 100)}%` : '')}>
                    {torta.map((x, i) => <Cell key={x.clave} fill={PALETA[i % PALETA.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [`${v} expedientes`, n]} />
                  <Legend formatter={(v) => corto(v, 34)} wrapperStyle={{ fontSize: 11 }} layout="vertical" align="right" verticalAlign="middle" />
                </PieChart></ResponsiveContainer></div>
            </Panel>
          </div>
          <Panel titulo="Ranking de finalizados por trabajador" descripcion="Quién registró el cierre en URBANITO o, en los importados, el último responsable del expediente">
            <div style={{ height: Math.max(220, Math.min(25, d.por_trabajador.length) * 28) }}><ResponsiveContainer>
              <BarChart data={d.por_trabajador.slice(0, 25).map(x => ({ ...x, corto: corto(x.nombre, 28) }))} margin={{ top: 10, right: 10, left: 0, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="corto" angle={-35} textAnchor="end" interval={0} fontSize={11} height={70} />
                <YAxis allowDecimals={false} fontSize={11} /><Tooltip formatter={(v, n, p) => [`${v} finalizados · mediana ${numero(p.payload.mediana_dias, 1)} d.h.`, p.payload.nombre]} />
                <Bar dataKey="n" fill="#1a3c6e" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart></ResponsiveContainer></div>
          </Panel>
          <Panel sinRelleno titulo={`${numero(d.total)} expedientes finalizados`} descripcion={d.truncado ? 'Se muestran los 1 000 más recientes; el Excel incluye todos.' : ''}>
            <div className="tabla-contenedor" style={{ maxHeight: 460 }}>
              <table className="tabla">
                <thead><tr><th>Expediente</th><th>Trámite</th><th>Departamento</th><th>Ingreso</th><th>Cierre</th><th className="num">Días</th><th>Plazo</th><th>Finalizado por</th></tr></thead>
                <tbody>{d.filas.map(x => (
                  <tr key={x.id} className="clicable" onClick={() => abrirFicha(x.id)}>
                    <td className="mono destacado">{x.numero}<div className="suave">{x.sistema}</div></td><td>{x.procedimiento}</td>
                    <td className="suave">{(x.departamento || '').replace(/^Departamento de /, '')}</td><td>{fecha(x.fecha_ingreso)}</td><td>{fecha(x.fecha_cierre)}</td>
                    <td className="num">{x.dias_atencion ?? '—'}</td>
                    <td>{x.dentro_plazo === null ? <span className="suave">—</span> : x.dentro_plazo ? <span style={{ color: 'var(--bajo)' }}>En plazo</span> : <span style={{ color: 'var(--critico)' }}>Fuera de plazo</span>}</td>
                    <td>{x.finalizado_por}</td></tr>))}</tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </>
  )
}

export function AntesDespues() {
  const { version, ir, usuario } = useApp()
  const { datos: d, error, recargar } = useDatos('antes_despues', {}, [version])
  if (error) return <ErrorCarga error={error} reintentar={recargar} />
  if (!d) return <Cargando />
  const a = d.antes, p = d.despues
  const filas = [
    ['Expedientes ingresados', numero(a.ingresados), numero(p.ingresados)],
    ['Ingresos por mes', numero(a.ingresos_por_mes, 1), numero(p.ingresos_por_mes, 1)],
    ['Cerrados (de los ingresados en el periodo)', numero(a.cerrados), numero(p.cerrados)],
    ['Tasa de cierre', porcentaje(a.tasa_cierre), porcentaje(p.tasa_cierre)],
    ['Mediana de días hábiles de atención', numero(a.mediana_dias, 1), numero(p.mediana_dias, 1)],
    ['Promedio de días hábiles de atención', numero(a.media_dias, 1), numero(p.media_dias, 1)],
    ['Percentil 80 de días de atención', numero(a.p80_dias, 1), numero(p.p80_dias, 1)],
    ['Atendidos dentro del plazo TUPA', porcentaje(a.dentro_plazo), porcentaje(p.dentro_plazo)],
  ]
  const datosGrafico = [
    { indicador: 'Mediana (d.h.)', Antes: a.mediana_dias, Después: p.mediana_dias },
    { indicador: 'P80 (d.h.)', Antes: a.p80_dias, Después: p.p80_dias },
  ]
  const datosPct = [
    { indicador: 'Dentro del TUPA', Antes: a.dentro_plazo === null ? null : a.dentro_plazo * 100, Después: p.dentro_plazo === null ? null : p.dentro_plazo * 100 },
    { indicador: 'Tasa de cierre', Antes: a.tasa_cierre === null ? null : a.tasa_cierre * 100, Después: p.tasa_cierre === null ? null : p.tasa_cierre * 100 },
  ]
  return (
    <>
      <Aviso tipo="informativo">Compara los expedientes que <b>ingresaron</b> antes y después de la implementación de URBANITO
        ({fecha(d.fecha_implementacion)}), con las mismas definiciones del Modelo 2 (días hábiles efectivos, sin el tiempo observado).
        El periodo «antes» tiene la misma duración que el «después» (mínimo 12 meses).
        {usuario.rol === 'ADMINISTRADOR' && <> La fecha se cambia en <button className="enlace" onClick={() => ir('configuracion')}>Configuración › Parámetros</button>.</>}</Aviso>
      {d.advertencia && <Aviso>{d.advertencia}</Aviso>}
      <div className="rejilla-indicadores">
        <Indicador etiqueta="Variación de la mediana" valor={d.variaciones.mediana_dias === null ? '—' : `${d.variaciones.mediana_dias > 0 ? '+' : ''}${porcentaje(d.variaciones.mediana_dias, 0)}`}
                   tono={d.variaciones.mediana_dias !== null && d.variaciones.mediana_dias < 0 ? 'bajo' : 'medio'} nota="Negativo = se atiende más rápido" />
        <Indicador etiqueta="Cumplimiento TUPA" valor={d.variaciones.dentro_plazo === null ? '—' : `${d.variaciones.dentro_plazo > 0 ? '+' : ''}${numero(d.variaciones.dentro_plazo * 100, 1)} pp`}
                   tono={d.variaciones.dentro_plazo > 0 ? 'bajo' : 'medio'} nota="puntos porcentuales" />
        <Indicador etiqueta="Tasa de cierre" valor={d.variaciones.tasa_cierre === null ? '—' : `${d.variaciones.tasa_cierre > 0 ? '+' : ''}${numero(d.variaciones.tasa_cierre * 100, 1)} pp`} />
      </div>
      <div className="dos-columnas">
        <Panel titulo="Indicadores" sinRelleno>
          <table className="tabla">
            <thead><tr><th>Indicador</th><th className="num">Antes<div className="suave" style={{ textTransform: 'none' }}>{fecha(a.desde)} – {fecha(a.hasta)}</div></th>
              <th className="num">Después<div className="suave" style={{ textTransform: 'none' }}>desde {fecha(p.desde)}</div></th></tr></thead>
            <tbody>{filas.map(([t, x, y]) => <tr key={t}><td>{t}</td><td className="num">{x}</td><td className="num destacado">{y}</td></tr>)}</tbody>
          </table>
        </Panel>
        <Panel titulo="Comparación">
          <div style={{ height: 150 }}><ResponsiveContainer>
            <BarChart data={datosGrafico} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
              <XAxis type="number" fontSize={11} /><YAxis type="category" dataKey="indicador" width={100} fontSize={11} /><Tooltip /><Legend />
              <Bar dataKey="Antes" fill="#94a3b8" isAnimationActive={false} /><Bar dataKey="Después" fill="#1a3c6e" isAnimationActive={false} />
            </BarChart></ResponsiveContainer></div>
          <div style={{ height: 150 }}><ResponsiveContainer>
            <BarChart data={datosPct} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
              <XAxis type="number" domain={[0, 100]} unit="%" fontSize={11} /><YAxis type="category" dataKey="indicador" width={100} fontSize={11} />
              <Tooltip formatter={(v) => (v === null ? '—' : `${numero(v, 1)}%`)} /><Legend />
              <Bar dataKey="Antes" fill="#94a3b8" isAnimationActive={false} /><Bar dataKey="Después" fill="#16a34a" isAnimationActive={false} />
            </BarChart></ResponsiveContainer></div>
        </Panel>
      </div>
    </>
  )
}
