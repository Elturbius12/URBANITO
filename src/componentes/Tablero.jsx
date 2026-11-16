// Tablero gerencial: indicadores para decidir.
import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line, Cell } from 'recharts'
import { useDatos } from '../api'
import { useApp, Panel, Indicador, Cargando, ErrorCarga, Nivel, Aviso, BarraProporcion, Pestanas } from './Comunes'
import { Finalizados, AntesDespues } from './TableroFinalizados'
import { numero, porcentaje, mes, fecha, fechaHora, restantes } from '../formato'
import { exportarPdf, documentoHtml, tablaHtml } from '../exportar'

const COLOR = { 'CRÍTICO': '#dc2626', ALTO: '#ea580c', MEDIO: '#ca8a04', BAJO: '#16a34a' }

export default function Tablero() {
  const [pestana, setPestana] = useState('general')
  return (
    <>
      <Pestanas activa={pestana} alCambiar={setPestana} opciones={[
        { clave: 'general', etiqueta: 'General' },
        { clave: 'finalizados', etiqueta: 'Finalizados' },
        { clave: 'antes_despues', etiqueta: 'Antes vs. después de URBANITO' },
      ]} />
      {pestana === 'general' && <TableroGeneral />}
      {pestana === 'finalizados' && <Finalizados />}
      {pestana === 'antes_despues' && <AntesDespues />}
    </>
  )
}

function TableroGeneral() {
  const { usuario, version, abrirFicha, notificar, estado } = useApp()
  const [dep, setDep] = useState('')
  const { datos: cat } = useDatos('catalogos', {})
  const { datos: t, error, recargar } = useDatos('tablero', { departamento: dep || undefined }, [version])
  if (error) return <ErrorCarga error={error} reintentar={recargar} />
  if (!t) return <Cargando />

  const k = t.kpis
  const niveles = Object.entries(t.niveles).map(([nivel, n]) => ({ nivel, n }))
  const cump = t.cumplimiento.map(c => ({ ...c, corto: c.nombre.length > 34 ? `${c.nombre.slice(0, 32)}…` : c.nombre, pct: Math.round(c.tasa_cumplimiento * 100) }))
  const peor = t.cumplimiento[0]
  const maxCarga = Math.max(1, ...t.carga.map(c => c.expedientes))

  const pdf = () => {
    const cuerpo = `
      <h2>Indicadores</h2>
      ${tablaHtml([{ titulo: 'Indicador', clave: 'k' }, { titulo: 'Valor', clave: 'v' }], [
        { k: 'Expedientes en trámite', v: numero(k.en_tramite) }, { k: 'Críticos', v: numero(k.criticos) },
        { k: 'Con plazo TUPA vencido', v: numero(k.vencidos) }, { k: 'Estancados', v: numero(k.estancados) },
        { k: 'Observados', v: numero(k.observados) }, { k: 'IUA promedio', v: k.iua_promedio === null ? '—' : k.iua_promedio.toFixed(3) },
        { k: 'Registrados en URBANITO', v: numero(k.registrados_urbanito) }, { k: 'Finalizados en URBANITO', v: numero(k.finalizados_urbanito) }])}
      <h2>Cumplimiento del plazo TUPA (Modelo 2, expedientes cerrados)</h2>
      ${tablaHtml([{ titulo: 'Trámite', clave: 'nombre' }, { titulo: 'Casos', clave: 'n', formato: 'numero' }, { titulo: 'Mediana', clave: 'mediana', formato: 'decimal1' },
        { titulo: 'P80', clave: 'p80', formato: 'decimal1' }, { titulo: 'TUPA', clave: 'plazo_tupa', formato: 'numero' }, { titulo: 'Cumple', clave: 'tasa_cumplimiento', formato: 'porcentaje' }], t.cumplimiento)}
      <h2>Carga por ubicación (expedientes en trámite)</h2>
      ${tablaHtml([{ titulo: 'Ubicación', clave: 'ubicacion' }, { titulo: 'En trámite', clave: 'expedientes', formato: 'numero' },
        { titulo: 'Críticos', clave: 'criticos', formato: 'numero' }, { titulo: 'Vencidos', clave: 'vencidos', formato: 'numero' },
        { titulo: 'IUA promedio', clave: 'iua_promedio', formato: 'decimal' }], t.carga)}
      <h2>Los 10 más urgentes</h2>
      ${tablaHtml([{ titulo: '#', clave: 'prioridad', formato: 'numero' }, { titulo: 'Expediente', clave: 'numero' }, { titulo: 'Trámite', clave: 'procedimiento' },
        { titulo: 'Ubicación', clave: 'ubicacion' }, { titulo: 'Restantes', clave: 'dias_restantes', formato: 'numero' }, { titulo: 'IUA', clave: 'iua', formato: 'decimal' },
        { titulo: 'Nivel', clave: 'nivel' }], t.criticos_top)}`
    exportarPdf(notificar, `tablero_gerencial_${new Date().toISOString().slice(0, 10)}`,
      documentoHtml({ titulo: 'Reporte gerencial', subtitulo: t.departamento_nombre || 'Todos los departamentos', institucion: estado.institucion, cuerpo, usuario }))
  }

  return (
    <>
      <div className="filtros" style={{ marginBottom: 14 }}>
        {usuario.departamentos_elegibles.length > 1 && (
          <select className="control" value={dep} onChange={e => setDep(e.target.value)}>
            <option value="">{usuario.rol === 'JEFE_DEPARTAMENTO' ? 'Todos mis departamentos' : 'Todos los departamentos'}</option>
            {usuario.departamentos_elegibles.map(d => <option key={d.codigo} value={d.codigo}>{d.nombre}</option>)}
          </select>
        )}
        {usuario.departamentos_elegibles.length <= 1 && t.departamento_nombre && <b>{t.departamento_nombre}</b>}
        <span className="texto-tenue" style={{ fontSize: 12 }}>Actualizado {fechaHora(t.calculado_en)}</span>
        <button className="boton pequeno" style={{ marginLeft: 'auto' }} onClick={pdf}>⎙ Reporte gerencial en PDF</button>
      </div>

      <div className="rejilla-indicadores">
        <Indicador etiqueta="En trámite" valor={numero(k.en_tramite)} />
        <Indicador etiqueta="Críticos" valor={numero(k.criticos)} tono="critico" nota={k.en_tramite ? `${porcentaje(k.criticos / k.en_tramite, 0)} del total` : ''} />
        <Indicador etiqueta="Plazo vencido" valor={numero(k.vencidos)} tono="critico" />
        <Indicador etiqueta="Estancados" valor={numero(k.estancados)} tono="medio" />
        <Indicador etiqueta="IUA promedio" valor={k.iua_promedio === null ? '—' : k.iua_promedio.toFixed(3)} />
        <Indicador etiqueta="Finalizados en URBANITO" valor={numero(k.finalizados_urbanito)}
                   nota={k.cumplimiento_urbanito === null ? 'Aún sin cierres con plazo TUPA' : `${porcentaje(k.cumplimiento_urbanito, 0)} dentro del plazo TUPA`} />
      </div>

      {peor && (
        <Aviso>
          <b>Hallazgo del Modelo 2:</b> «{peor.nombre}» es el trámite con menor cumplimiento: solo el {porcentaje(peor.tasa_cumplimiento, 0)} de
          {' '}{numero(peor.n)} casos se atendió dentro de los {peor.plazo_tupa} días hábiles del TUPA; el 80% tardó hasta {numero(peor.p80)} días hábiles.
        </Aviso>
      )}

      <div className="dos-columnas">
        <Panel titulo="Expedientes en trámite por nivel de urgencia (IUA)">
          <div className="grafico">
            <ResponsiveContainer>
              <BarChart data={niveles} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="nivel" /><YAxis allowDecimals={false} />
                <Tooltip formatter={(v) => [`${v} expedientes`, 'Cantidad']} />
                <Bar dataKey="n" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {niveles.map(n => <Cell key={n.nivel} fill={COLOR[n.nivel]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel titulo="Ingresos y cierres por mes" descripcion="Últimos 24 meses. Los meses posteriores al corte de importación solo incluyen lo registrado en URBANITO.">
          <div className="grafico">
            <ResponsiveContainer>
              <LineChart data={t.serie} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="mes" tickFormatter={mes} interval={2} fontSize={11} /><YAxis fontSize={11} />
                <Tooltip labelFormatter={mes} /><Legend />
                <Line type="monotone" dataKey="ingresos" name="Ingresos" stroke="#2d5a9e" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="cierres" name="Cierres" stroke="#16a34a" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel titulo="Cumplimiento del plazo TUPA por trámite" descripcion="Modelo 2 (MTA): % de expedientes cerrados que se atendieron dentro del plazo legal. Solo trámites con 30 o más casos.">
        {!cump.length ? <div className="texto-suave">No hay trámites con plazo TUPA y datos suficientes en este alcance.</div> : (
          <div style={{ height: Math.max(180, cump.length * 34) }}>
            <ResponsiveContainer>
              <BarChart data={cump} layout="vertical" margin={{ top: 0, right: 30, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis type="number" domain={[0, 100]} unit="%" fontSize={11} />
                <YAxis type="category" dataKey="corto" width={250} fontSize={11} />
                <Tooltip formatter={(v, n, p) => [`${v}% (${p.payload.n} casos; TUPA ${p.payload.plazo_tupa} d.h., P80 real ${numero(p.payload.p80)} d.h.)`, 'Cumplimiento']} />
                <Bar dataKey="pct" isAnimationActive={false} radius={[0, 4, 4, 0]}>
                  {cump.map(c => <Cell key={c.codigo} fill={c.pct < 30 ? '#dc2626' : c.pct < 60 ? '#ea580c' : '#16a34a'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <div className="dos-columnas">
        <Panel titulo="Carga de trabajo por ubicación" sinRelleno descripcion="Dónde están hoy los expedientes en trámite">
          <div className="tabla-contenedor" style={{ maxHeight: 420 }}>
            <table className="tabla">
              <thead><tr><th>Ubicación</th><th className="num">En trámite</th><th></th><th className="num">Críticos</th><th className="num">Vencidos</th><th className="num">IUA prom.</th></tr></thead>
              <tbody>{t.carga.map(c => (
                <tr key={c.ubicacion}><td>{c.ubicacion}</td><td className="num destacado">{c.expedientes}</td>
                  <td><BarraProporcion valor={c.expedientes} maximo={maxCarga} ancho={80} /></td>
                  <td className="num">{c.criticos}</td><td className="num">{c.vencidos}</td><td className="num">{c.iua_promedio.toFixed(3)}</td></tr>))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel titulo="Los 10 más urgentes" sinRelleno>
          <table className="tabla">
            <thead><tr><th>Expediente</th><th>Trámite</th><th>Plazo</th><th className="num">IUA</th><th>Nivel</th></tr></thead>
            <tbody>{t.criticos_top.map(x => (
              <tr key={x.id} className="clicable" onClick={() => abrirFicha(x.id)}>
                <td className="mono destacado">{x.numero}</td><td>{x.procedimiento}</td>
                <td style={{ color: x.vencido ? 'var(--critico)' : undefined }}>{restantes(x.dias_restantes)}</td>
                <td className="num">{x.iua.toFixed(3)}</td><td><Nivel nivel={x.nivel} /></td></tr>))}
            </tbody>
          </table>
        </Panel>
      </div>

      {t.por_departamento && (
        <Panel titulo="Por departamento" sinRelleno>
          <table className="tabla">
            <thead><tr><th>Departamento</th><th className="num">En trámite</th><th className="num">Críticos</th><th className="num">Vencidos</th></tr></thead>
            <tbody>{t.por_departamento.map(d => (
              <tr key={d.departamento}><td>{d.departamento}</td><td className="num">{d.en_tramite}</td><td className="num">{d.criticos}</td><td className="num">{d.vencidos}</td></tr>))}</tbody>
          </table>
        </Panel>
      )}
      <p className="texto-tenue" style={{ fontSize: 11.5 }}>Fecha de hoy según el sistema: {fecha(new Date().toISOString())}.</p>
    </>
  )
}
