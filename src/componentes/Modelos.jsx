// Modelos IUA (con AHP) y MTA: transparencia total del cálculo.
import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useDatos, llamar } from '../api'
import { useApp, Panel, Cargando, ErrorCarga, Pestanas, Aviso, Insignia, Campo, useAccion } from './Comunes'
import { numero, porcentaje, fecha, fechaHora } from '../formato'
import { exportarExcel } from '../exportar'

const SAATY = [9, 8, 7, 6, 5, 4, 3, 2, 1, 1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 6, 1 / 7, 1 / 8, 1 / 9]
const txtSaaty = (v) => (v >= 1 ? String(Math.round(v)) : `1/${Math.round(1 / v)}`)
const cercano = (v) => SAATY.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a))

export default function Modelos() {
  const { version } = useApp()
  const [pestana, setPestana] = useState('iua')
  const { datos: m, error, recargar } = useDatos('modelos', {}, [version])
  if (error) return <ErrorCarga error={error} reintentar={recargar} />
  if (!m) return <Cargando />
  return (
    <>
      <Pestanas activa={pestana} alCambiar={setPestana} opciones={[
        { clave: 'iua', etiqueta: 'Modelo 1 — IUA y pesos AHP' },
        { clave: 'mta', etiqueta: 'Modelo 2 — MTA por trámite' },
        { clave: 'oficinas', etiqueta: 'MTA por oficina y responsable' },
        { clave: 'plazos', etiqueta: 'Plazos de referencia' },
        { clave: 'metodo', etiqueta: 'Metodología y fuentes' },
      ]} />
      <p className="texto-tenue" style={{ fontSize: 11.5, marginTop: -8, marginBottom: 12 }}>
        Calculado {fechaHora(m.calculado_en)} en {m.duracion_ms} ms con la fecha {fecha(m.hoy)}. Se recalcula solo ante cada cambio en los datos.
      </p>
      {pestana === 'iua' && <ModeloIua m={m} />}
      {pestana === 'mta' && <MtaTramites m={m} />}
      {pestana === 'oficinas' && <MtaOficinas m={m} />}
      {pestana === 'plazos' && <Plazos m={m} />}
      {pestana === 'metodo' && <Metodologia m={m} />}
    </>
  )
}

function ModeloIua({ m }) {
  const a = m.ahp
  const hist = m.iua.histograma.map((n, i) => ({ rango: `${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}`, n, desde: i / 10 }))
  const color = (d) => (d >= 0.7 ? '#dc2626' : d >= 0.5 ? '#ea580c' : d >= 0.3 ? '#ca8a04' : '#16a34a')
  return (
    <>
      <div className="dos-columnas">
        <Panel titulo="Fórmula" descripcion="Índice de Urgencia Administrativa, de 0 (sin apremio) a 1 (máxima urgencia)">
          <div className="resaltado mono" style={{ fontSize: 15, textAlign: 'center', marginBottom: 12 }}>
            IUA = Σ peso<sub>i</sub> × factor<sub>i</sub>
          </div>
          <table className="tabla">
            <thead><tr><th>Factor</th><th>Pregunta que responde</th><th className="num">Peso</th></tr></thead>
            <tbody>{a.factores.map(f => (
              <tr key={f.codigo}><td className="destacado">{f.nombre}</td><td className="suave">{f.pregunta}</td><td className="num destacado">{porcentaje(f.peso)}</td></tr>))}
            </tbody>
          </table>
          <div className="separador" />
          <div style={{ fontSize: 12.5 }}>
            <b>Clasificación:</b> {m.parametros.cortes.map(([n, c, acc]) => <span key={n} style={{ marginRight: 10 }}><Insignia tipo={n}>{n}</Insignia> ≥ {c.toFixed(2)} ({acc.toLowerCase()})</span>)}
            <p style={{ marginTop: 6 }}><b>Regla de seguridad:</b> un expediente con el plazo TUPA vencido es CRÍTICO aunque su puntaje sea menor.
              Hoy esto aplica a {m.iua.criticos_por_vencimiento} expediente(s).</p>
          </div>
        </Panel>
        <Panel titulo={`Distribución actual (${numero(m.iua.evaluados)} expedientes en trámite)`}>
          <div className="rejilla-indicadores" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 8 }}>
            {Object.entries(m.iua.niveles).map(([n, v]) => (
              <div key={n} className={`indicador ${{ 'CRÍTICO': 'critico', ALTO: 'alto', MEDIO: 'medio', BAJO: 'bajo' }[n]}`}>
                <div className="etiqueta">{n}</div><div className="valor">{v}</div></div>))}
          </div>
          <div style={{ height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={hist} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="rango" fontSize={10} /><YAxis fontSize={11} allowDecimals={false} />
                <Tooltip formatter={(v) => [`${v} expedientes`, 'Cantidad']} />
                <Bar dataKey="n" isAnimationActive={false}>{hist.map(h => <Cell key={h.rango} fill={color(h.desde)} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="texto-suave" style={{ fontSize: 12 }}>
            Referencias vigentes: antigüedad P90 = {numero(m.iua.referencia_antiguedad, 1)} d.h.; ubicación más cargada = {m.iua.carga_maxima} expedientes.
            {m.iua.con_factores_omitidos > 0 && ` ${m.iua.con_factores_omitidos} expediente(s) tienen algún factor omitido (sin dato), con pesos redistribuidos.`}
          </div>
        </Panel>
      </div>
      <MatrizAhp a={a} />
    </>
  )
}

function MatrizAhp({ a }) {
  const { refrescar } = useApp()
  const n = a.factores.length
  const [matriz, setMatriz] = useState(() => a.matriz.map(f => f.map(cercano)))
  const [sim, setSim] = useState(null)
  const [just, setJust] = useState('')
  const { ocupado, error, ejecutar } = useAccion()
  const cambiada = JSON.stringify(matriz) !== JSON.stringify(a.matriz.map(f => f.map(cercano)))

  useEffect(() => {
    let vivo = true
    llamar('simular_ahp', { matriz }).then(r => { if (vivo) setSim(r) }).catch(() => {})
    return () => { vivo = false }
  }, [matriz])

  const fijar = (i, j, v) => {
    const nueva = matriz.map(f => [...f])
    nueva[i][j] = v
    nueva[j][i] = 1 / v
    setMatriz(nueva)
  }

  const guardar = async () => {
    const r = await ejecutar(() => llamar('guardar_ahp', { matriz, justificacion: just }), 'Pesos actualizados: el IUA se recalculó')
    if (r) { setJust(''); refrescar() }
  }

  const res = sim && sim.valida ? sim : null
  return (
    <Panel titulo="Matriz de comparación por pares (AHP — escala de Saaty)"
           descripcion="Cada celda responde: ¿cuánto más importante es el factor de la fila que el de la columna? 1 = igual, 3 = moderadamente, 5 = fuertemente, 7 = muy fuertemente, 9 = extremadamente. La parte inferior se completa sola (recíprocos).">
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <table className="matriz-ahp" data-prueba="matriz-ahp">
          <thead><tr><th></th>{a.factores.map(f => <th key={f.codigo}>{f.nombre}</th>)}<th>Peso</th></tr></thead>
          <tbody>
            {a.factores.map((fi, i) => (
              <tr key={fi.codigo}>
                <th style={{ textAlign: 'left' }}>{fi.nombre}</th>
                {a.factores.map((fj, j) => {
                  if (i === j) return <td key={j} className="diag">1</td>
                  if (j < i) return <td key={j} className="recip">{txtSaaty(matriz[i][j])}</td>
                  return (
                    <td key={j}>
                      {a.puede_editar ? (
                        <select value={txtSaaty(matriz[i][j])} onChange={e => fijar(i, j, SAATY.find(s => txtSaaty(s) === e.target.value))}>
                          {SAATY.map(s => <option key={s} value={txtSaaty(s)}>{txtSaaty(s)}</option>)}
                        </select>
                      ) : txtSaaty(matriz[i][j])}
                    </td>
                  )
                })}
                <td className="destacado">{res ? porcentaje(res.pesos[i]) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ minWidth: 260 }}>
          {res && (
            <>
              <div className="etiqueta-campo">Verificación de consistencia</div>
              <table className="tabla" style={{ marginTop: 4 }}>
                <tbody>
                  <tr><td>Valor propio máximo λ<sub>max</sub></td><td className="num mono">{res.lambda_max.toFixed(6)}</td></tr>
                  <tr><td>Índice de consistencia IC = (λ<sub>max</sub> − n)/(n − 1)</td><td className="num mono">{res.ic.toFixed(6)}</td></tr>
                  <tr><td>Índice aleatorio IA (n = {n})</td><td className="num mono">{res.ia.toFixed(2)}</td></tr>
                  <tr><td className="destacado">Razón de consistencia RC = IC / IA</td><td className="num mono destacado">{res.rc.toFixed(6)}</td></tr>
                </tbody>
              </table>
              <div style={{ marginTop: 8 }}>
                {res.consistente
                  ? <Aviso tipo="exito">RC &lt; 0.10: los juicios son consistentes y los pesos son válidos.</Aviso>
                  : <Aviso tipo="error">RC ≥ 0.10: los juicios se contradicen entre sí. Revise las comparaciones; así no se pueden guardar.</Aviso>}
              </div>
            </>
          )}
          {sim && !sim.valida && <Aviso tipo="error">{sim.errores.join(' ')}</Aviso>}
        </div>
      </div>
      {a.puede_editar && cambiada && (
        <div style={{ marginTop: 12 }}>
          <Campo etiqueta="Justificación del cambio" requerido ayuda="Queda registrada en la auditoría junto con la matriz anterior">
            <input value={just} onChange={e => setJust(e.target.value)} placeholder="Ej.: Acuerdo de reunión de gerencia del …" />
          </Campo>
          {error && <div style={{ marginTop: 8 }}><Aviso tipo="error">{error}</Aviso></div>}
          <div className="grupo-botones" style={{ marginTop: 10 }}>
            <button className="boton" onClick={() => setMatriz(a.matriz.map(f => f.map(cercano)))}>Descartar cambios</button>
            <button className="boton primario" disabled={ocupado || !res || !res.consistente} onClick={guardar}>Guardar nuevos pesos y recalcular</button>
          </div>
        </div>
      )}
      {!a.puede_editar && <p className="texto-tenue" style={{ fontSize: 12, marginTop: 10 }}>Solo el gerente o el administrador pueden cambiar los juicios.</p>}
    </Panel>
  )
}

const COLS_MTA = [
  { titulo: 'Trámite', clave: 'nombre', ancho: 42 }, { titulo: 'Casos (n)', clave: 'n', formato: 'numero' },
  { titulo: 'Media', clave: 'media', formato: 'decimal1' }, { titulo: 'Mediana', clave: 'mediana', formato: 'decimal1' },
  { titulo: 'Desv. estándar', clave: 'desviacion', formato: 'decimal1' }, { titulo: 'P80', clave: 'p80', formato: 'decimal1' },
  { titulo: 'P95', clave: 'p95', formato: 'decimal1' }, { titulo: 'Mínimo', clave: 'minimo', formato: 'numero' }, { titulo: 'Máximo', clave: 'maximo', formato: 'numero' },
  { titulo: 'Coef. variación', clave: 'coef_variacion', formato: 'decimal' }, { titulo: 'Predecibilidad', clave: 'interpretacion', ancho: 20 },
  { titulo: 'Plazo TUPA', clave: 'plazo_tupa', formato: 'numero' }, { titulo: 'Cumplimiento TUPA', clave: 'tasa_cumplimiento', formato: 'porcentaje' },
  { titulo: 'Brecha P80 − TUPA', clave: 'brecha_p80_tupa', formato: 'decimal1' },
]

function MtaTramites({ m }) {
  const { notificar } = useApp()
  const [todos, setTodos] = useState(false)
  const filas = m.mta.tramites.filter(t => todos || t.datos_suficientes)
  return (
    <>
      <Aviso tipo="informativo">
        Base de cálculo: <b>{numero(m.mta.base_n)}</b> de {numero(m.mta.total_expedientes)} expedientes — los cerrados (finalizados o cerrados en el sistema
        anterior) con al menos {m.parametros.mov_minimo} movimientos registrados. Los demás no tienen una trayectoria medible.
        Un trámite con menos de {m.parametros.n_minimo} casos no recibe estadísticas. Todo en días hábiles.
      </Aviso>
      <Panel sinRelleno titulo="Tiempos reales de atención por trámite"
             acciones={<div className="grupo-botones">
               <label className="casilla"><input type="checkbox" checked={todos} onChange={e => setTodos(e.target.checked)} /> Incluir trámites con menos de {m.parametros.n_minimo} casos</label>
               <button className="boton pequeno" onClick={() => exportarExcel(notificar, 'mta_por_tramite', [{ nombre: 'MTA por trámite', titulo: 'Modelo 2 — MTA por trámite',
                 subtitulo: `Base de cálculo: ${m.mta.base_n} expedientes cerrados. Días hábiles.`, columnas: COLS_MTA, filas: m.mta.tramites }])}>⬇ Excel</button>
             </div>}>
        <div className="tabla-contenedor" style={{ maxHeight: 'calc(100vh - 330px)' }}>
          <table className="tabla">
            <thead><tr><th>Trámite</th><th className="num">n</th><th className="num">Media</th><th className="num">Mediana</th><th className="num">Desv.</th>
              <th className="num">P80</th><th className="num">P95</th><th className="num">CV</th><th>Predecibilidad</th><th className="num">TUPA</th><th className="num">Cumple</th><th className="num">P80 − TUPA</th></tr></thead>
            <tbody>{filas.map(t => (
              <tr key={t.codigo} style={{ opacity: t.datos_suficientes ? 1 : 0.55 }}>
                <td className="destacado">{t.nombre}</td><td className="num">{numero(t.n)}</td>
                {t.datos_suficientes ? <>
                  <td className="num">{numero(t.media, 1)}</td><td className="num">{numero(t.mediana, 1)}</td><td className="num">{numero(t.desviacion, 1)}</td>
                  <td className="num">{numero(t.p80, 1)}</td><td className="num">{numero(t.p95, 1)}</td><td className="num">{t.coef_variacion === null ? '—' : t.coef_variacion.toFixed(2)}</td>
                  <td className="suave">{t.interpretacion}</td><td className="num">{t.plazo_tupa ?? '—'}</td>
                  <td className="num">{t.tasa_cumplimiento === null ? '—' : <Insignia tipo={t.tasa_cumplimiento < 0.3 ? 'CRÍTICO' : t.tasa_cumplimiento < 0.6 ? 'ALTO' : 'BAJO'}>{porcentaje(t.tasa_cumplimiento, 0)}</Insignia>}</td>
                  <td className="num">{t.brecha_p80_tupa === null ? '—' : `${t.brecha_p80_tupa > 0 ? '+' : ''}${numero(t.brecha_p80_tupa, 1)}`}</td>
                </> : <td colSpan={10} className="suave">sin datos suficientes (mínimo {m.parametros.n_minimo} casos)</td>}
              </tr>))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}

function MtaOficinas({ m }) {
  const tabla = (filas, titulo, desc) => (
    <Panel sinRelleno titulo={titulo} descripcion={desc}>
      <div className="tabla-contenedor" style={{ maxHeight: 420 }}>
        <table className="tabla">
          <thead><tr><th>Nombre</th><th className="num">Pasos</th><th className="num">Expedientes</th><th className="num">Media</th><th className="num">Mediana</th><th className="num">P80</th><th className="num">P95</th><th>Predecibilidad</th></tr></thead>
          <tbody>{filas.map(u => (
            <tr key={`${u.tipo}:${u.codigo}`}><td className="destacado">{u.nombre}{u.tipo === 'UNIDAD ORGANICA' ? <span className="suave"> ({u.codigo})</span> : null}</td>
              <td className="num">{numero(u.n)}</td><td className="num">{numero(u.expedientes_atendidos)}</td><td className="num">{numero(u.media, 1)}</td>
              <td className="num">{numero(u.mediana, 1)}</td><td className="num">{numero(u.p80, 1)}</td><td className="num">{numero(u.p95, 1)}</td><td className="suave">{u.interpretacion}</td></tr>))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
  return (
    <>
      <Aviso tipo="informativo">Permanencia: días hábiles que un expediente se quedó en cada oficina o persona, desde que llegó hasta su siguiente movimiento.
        Estos percentiles 80 son los que usa URBANITO para detectar expedientes «estancados». Solo se publican destinos con al menos {m.parametros.n_minimo} pasos.</Aviso>
      <div className="dos-columnas">
        {tabla(m.mta.unidades, 'Por unidad orgánica', 'Estadística institucional')}
        {tabla(m.mta.responsables, 'Por responsable', 'En los registros importados el destino se anotaba con el nombre del trabajador')}
      </div>
    </>
  )
}

function Plazos({ m }) {
  const cuenta = (o) => m.plazos.filter(p => p.origen === o).length
  return (
    <>
      <Aviso tipo="informativo">El factor «urgencia temporal» del IUA compara los días transcurridos con un plazo de referencia. Si el trámite tiene plazo en el TUPA,
        se usa ese plazo legal. Si no lo tiene, se usa el percentil 80 de los tiempos reales (Modelo 2). Si tampoco hay datos suficientes, el factor se omite: el sistema no inventa plazos.</Aviso>
      <div className="rejilla-indicadores">
        <div className="indicador bajo"><div className="etiqueta">Con plazo TUPA</div><div className="valor">{cuenta('TUPA')}</div></div>
        <div className="indicador medio"><div className="etiqueta">Con P80 observado</div><div className="valor">{cuenta('P80 OBSERVADO')}</div></div>
        <div className="indicador"><div className="etiqueta">Sin referencia</div><div className="valor">{cuenta('SIN DATOS')}</div></div>
      </div>
      <Panel sinRelleno>
        <table className="tabla">
          <thead><tr><th>Trámite</th><th className="num">Casos históricos</th><th>Origen</th><th className="num">Plazo de referencia (d.h.)</th><th className="num">P80 observado</th></tr></thead>
          <tbody>{m.plazos.map(p => (
            <tr key={p.codigo}><td>{p.nombre}</td><td className="num">{numero(p.n)}</td>
              <td><Insignia tipo={p.origen === 'TUPA' ? 'BAJO' : p.origen === 'SIN DATOS' ? 'neutra' : 'MEDIO'}>{p.origen}</Insignia></td>
              <td className="num">{p.plazo_referencia === null ? '—' : numero(p.plazo_referencia, 1)}</td>
              <td className="num">{p.p80_observado === null ? '—' : numero(p.p80_observado, 1)}</td></tr>))}
          </tbody>
        </table>
      </Panel>
    </>
  )
}

function Metodologia({ m }) {
  return (
    <div className="dos-columnas">
      <Panel titulo="Modelo 1 — IUA (Índice de Urgencia Administrativa)">
        <div style={{ fontSize: 13.5, lineHeight: 1.65 }}>
          <p><b>Para qué sirve:</b> decidir qué expediente atender primero. Ordena la bandeja de cada trabajador y genera las alertas.</p>
          <p><b>Cómo:</b> suma ponderada de 5 factores normalizados de 0 a 1. Los pesos se obtienen con el Proceso Analítico Jerárquico (AHP) de Saaty,
            a partir de una matriz de juicios por pares, y solo se aceptan si la razón de consistencia es menor que 0.10.</p>
          <ul style={{ paddingLeft: 18 }}>
            <li><b>Urgencia temporal:</b> días hábiles transcurridos ÷ plazo de referencia (tope 1). Plazo 0 (mismo día) → 1 desde el primer día.</li>
            <li><b>Complejidad:</b> oficinas recorridas ÷ percentil 90 de oficinas de su trámite (mínimo {m.parametros.piso_complejidad}).</li>
            <li><b>Antigüedad:</b> días hábiles desde el ingreso ÷ percentil 90 de los expedientes en trámite.</li>
            <li><b>Tipo de procedimiento:</b> 1.0 con plazo TUPA; 0.6 trámite ciudadano sin plazo; 0.3 acto interno.</li>
            <li><b>Carga de trabajo:</b> expedientes en trámite en su ubicación ÷ la ubicación más cargada.</li>
          </ul>
          <p>Si un factor no se puede medir, se excluye y los pesos restantes se reescalan para sumar 1. Si el plazo TUPA ya venció, el expediente es CRÍTICO (regla de seguridad).</p>
          <p>Mientras un expediente está <b>observado</b>, los días no cuentan para el plazo (suspensión, Ley N° 27444).</p>
        </div>
      </Panel>
      <Panel titulo="Modelo 2 — MTA (Modelo Estadístico de Tiempos de Atención)">
        <div style={{ fontSize: 13.5, lineHeight: 1.65 }}>
          <p><b>Para qué sirve:</b> saber cuánto tarda realmente cada trámite y cada oficina, compararlo con el TUPA, informar al ciudadano un plazo realista,
            detectar expedientes estancados y dar el plazo de referencia al IUA cuando no hay plazo legal.</p>
          <p><b>Cómo:</b> estadística descriptiva (media, mediana, desviación estándar, percentiles 80 y 95, coeficiente de variación y tasa de cumplimiento del TUPA)
            sobre los expedientes cerrados con al menos {m.parametros.mov_minimo} movimientos. Mínimo {m.parametros.n_minimo} casos por grupo.</p>
          <p>Los percentiles se calculan por interpolación lineal. Los días hábiles excluyen sábados, domingos y feriados (tabla editable en Configuración).</p>
          <p>Cada expediente que se finaliza en URBANITO entra automáticamente a la base del MTA: el modelo se actualiza con el uso diario.</p>
        </div>
      </Panel>
      <Panel titulo="Fuente de los datos">
        <div style={{ fontSize: 13.5, lineHeight: 1.65 }}>
          <p>Datos históricos: {m.importacion.fuente}. {numero(m.importacion.expedientes)} expedientes y {numero(m.importacion.movimientos)} movimientos, importados con corte al
            {' '}<b>{fecha(m.importacion.fecha_corte)}</b> (última fecha de registro real).</p>
          <p>Los movimientos con fecha posterior al corte son errores de digitación del origen: se conservan y se muestran, pero no entran a los cálculos.</p>
          <p>Al corte, un expediente importado sin movimiento por más de 60 días hábiles se considera cerrado («Cerrado — sistema anterior»).
            Los que figuran en trámite pueden revisarse y depurarse desde «Depurar importados».</p>
          <p>Plazos legales: Texto Único de Procedimientos Administrativos (TUPA) de la Municipalidad Provincial de San Román.</p>
        </div>
      </Panel>
      <Panel titulo="Límites conocidos (para leer bien los resultados)">
        <div style={{ fontSize: 13.5, lineHeight: 1.65 }}>
          <ul style={{ paddingLeft: 18 }}>
            <li>En el sistema anterior más de la mitad de los expedientes tiene un solo movimiento registrado; esos no tienen trayectoria medible y no entran al MTA.</li>
            <li>La fecha de cierre de los expedientes importados es la de su último movimiento registrado; si el cierre real fue posterior y no se registró, el tiempo real fue mayor.</li>
            <li>Los trámites que no se identificaron en el TUPA no tienen plazo legal; el sistema no les asigna uno.</li>
            <li>El IUA ordena prioridades; la decisión final de cómo atender cada expediente es del responsable.</li>
          </ul>
        </div>
      </Panel>
    </div>
  )
}
