// Ficha del expediente: datos, prioridad explicada (IUA), tiempos reales (MTA),
// recorrido y acciones según el rol.
import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useDatos, llamar } from '../api'
import { useApp, Modal, Nivel, Insignia, Cargando, ErrorCarga, Aviso, Pestanas, useAccion } from './Comunes'
import { numero, fecha, porcentaje, restantes, fechaHora } from '../formato'
import { exportarPdf, imprimir } from '../exportar'
import { constanciaHtml, fichaHtml } from '../documentos'
import AccionModal from './Acciones'

const ETIQUETAS_ACCION = {
  derivar: 'Derivar / asignar', observar: 'Observar', subsanar: 'Registrar subsanación', finalizar: 'Finalizar',
  archivar: 'Archivar', corregir: 'Corregir datos', reabrir: 'Reabrir',
}

export default function Ficha({ id, alCerrar }) {
  const { version, refrescar, notificar, estado, usuario } = useApp()
  const [pestana, setPestana] = useState('resumen')
  const [accion, setAccion] = useState(null)
  const { datos: f, error, recargar } = useDatos('ficha', { id }, [version])
  const { ocupado: recibiendo, ejecutar } = useAccion()
  const recibir = async () => {
    const r = await ejecutar(() => llamar('recibir', { movimiento_ids: [f.movimiento_por_recibir] }))
    if (r) { notificar(`Recepción firmada: ${fechaHora(r.recibido_en)}`, 'exito'); refrescar() }
    else notificar('No se pudo registrar la recepción.', 'error')
  }

  const titulo = f ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <h3 className="mono">Expediente {f.expediente.numero}</h3>
      <Insignia tipo="azul">{f.expediente.sistema}</Insignia>
      <Insignia tipo={f.expediente.estado === 'OBSERVADO' ? 'ALTO' : ['FINALIZADO', 'CERRADO_HISTORICO'].includes(f.expediente.estado) ? 'BAJO' : 'neutra'}>
        {f.expediente.estado_nombre}</Insignia>
      {f.iua && <Nivel nivel={f.iua.nivel} />}
    </div>
  ) : 'Expediente'

  const pie = f && (
    <>
      <div className="grupo-botones" style={{ marginRight: 'auto' }}>
        <button className="boton pequeno" onClick={() => imprimir(notificar, fichaHtml(f, estado.institucion, usuario))}>⎙ Imprimir ficha</button>
        <button className="boton pequeno" onClick={() => exportarPdf(notificar, `expediente_${f.expediente.numero}`, fichaHtml(f, estado.institucion, usuario))}>PDF</button>
        {f.expediente.sistema === 'URBANITO' && (
          <button className="boton pequeno" onClick={async () => {
            const c = await llamar('constancia', { id })
            imprimir(notificar, constanciaHtml(c, usuario))
          }}>Constancia de recepción</button>
        )}
      </div>
      {f.puede_recibir && (
        <button className="boton exito" data-accion="recibir" disabled={recibiendo} onClick={recibir}>✍ Firmar recepción</button>
      )}
      {f.acciones.map(a => (
        <button key={a} data-accion={a}
                className={`boton ${a === 'finalizar' ? 'exito' : a === 'archivar' ? '' : a === 'derivar' ? 'primario' : ''}`}
                onClick={() => setAccion(a)}>{ETIQUETAS_ACCION[a]}</button>
      ))}
    </>
  )

  return (
    <>
      <Modal titulo={titulo} alCerrar={alCerrar} tamano="ancho" pie={pie}>
        {error && <ErrorCarga error={error} reintentar={recargar} />}
        {!f && !error && <Cargando />}
        {f && (
          <>
            <Pestanas activa={pestana} alCambiar={setPestana} opciones={[
              { clave: 'resumen', etiqueta: 'Resumen' },
              { clave: 'iua', etiqueta: 'Prioridad (IUA)' },
              { clave: 'mta', etiqueta: 'Tiempos reales (MTA)' },
              { clave: 'recorrido', etiqueta: `Historial (${f.movimientos.length})` },
            ]} />
            {pestana === 'resumen' && <Resumen f={f} irA={setPestana} />}
            {pestana === 'iua' && <ExplicacionIua f={f} />}
            {pestana === 'mta' && <ComparacionMta f={f} />}
            {pestana === 'recorrido' && <Recorrido f={f} />}
          </>
        )}
      </Modal>
      {accion && f && (
        <AccionModal tipo={accion} ficha={f} alCerrar={() => setAccion(null)}
                     alListo={(msg) => { setAccion(null); notificar(msg, 'exito'); refrescar() }} />
      )}
    </>
  )
}

function Dato({ etiqueta, children }) {
  return <div className="ficha-dato"><div className="etiqueta">{etiqueta}</div><div className="valor">{children ?? '—'}</div></div>
}

function Resumen({ f, irA }) {
  const e = f.expediente
  const p = f.procedimiento
  const i = f.iua
  return (
    <>
      {f.puede_recibir && <Aviso tipo="informativo">Este expediente le fue derivado y aún no confirmó la recepción.
        Use «Firmar recepción» para dejar constancia de la fecha y hora en que lo recibió.</Aviso>}
      {f.asignaciones && f.asignaciones.some(a => ['PENDIENTE', 'EN_PROGRESO'].includes(a.estado)) && (
        <Aviso tipo="informativo">Asignado por el modelo de asignación a <b>{f.asignaciones.find(a => ['PENDIENTE', 'EN_PROGRESO'].includes(a.estado)).usuario}</b>
          {' '}· fecha límite {fecha(f.asignaciones.find(a => ['PENDIENTE', 'EN_PROGRESO'].includes(a.estado)).fecha_limite)}.</Aviso>
      )}
      {e.fecha_invalida && <Aviso>La fecha de ingreso registrada en el sistema anterior es posterior a la fecha de corte (error de digitación).
        Mientras no se corrija, el IUA omite los factores que dependen de esa fecha.</Aviso>}
      {!f.en_alcance && f.acciones.length === 0 && ['EN_TRAMITE', 'OBSERVADO'].includes(e.estado) && (
        <Aviso tipo="informativo">Usted puede consultar este expediente, pero no está a su cargo ni en su departamento.</Aviso>
      )}
      {i && (
        <div className="resaltado" style={{ display: 'flex', gap: 24, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <div><div className="etiqueta-campo">Índice de urgencia</div><div className="grande">{i.iua.toFixed(3)}</div></div>
          <div><div className="etiqueta-campo">Nivel</div><div style={{ marginTop: 4 }}><Nivel nivel={i.nivel} /></div></div>
          <div><div className="etiqueta-campo">Acción sugerida</div><div style={{ fontWeight: 600 }}>{i.accion}</div></div>
          <div><div className="etiqueta-campo">Prioridad</div><div style={{ fontWeight: 600 }}>{i.prioridad} de {numero(i.total_activos)} en trámite</div></div>
          <button className="boton pequeno" style={{ marginLeft: 'auto' }} onClick={() => irA('iua')}>¿Por qué esta prioridad?</button>
        </div>
      )}
      <div className="ficha-datos" style={{ marginBottom: 16 }}>
        <Dato etiqueta="Solicitante">{e.solicitante}</Dato>
        <Dato etiqueta="Documento de identidad">{e.documento_identidad}</Dato>
        <Dato etiqueta="Teléfono">{e.telefono}</Dato>
        <Dato etiqueta="Trámite">{e.procedimiento}</Dato>
        <Dato etiqueta="Departamento">{e.departamento || 'Sin departamento asignado'}</Dato>
        <Dato etiqueta="Procedimiento TUPA">{p.tupa_codigo ? `${p.tupa_codigo}` : 'No identificado en el TUPA'}</Dato>
        <Dato etiqueta="Fecha de ingreso">{fecha(e.fecha_ingreso)}</Dato>
        <Dato etiqueta="Folios">{e.folios}</Dato>
        <Dato etiqueta="Dirección">{e.direccion}</Dato>
        <Dato etiqueta="Ubicación actual">{e.ubicacion}</Dato>
        <Dato etiqueta="Último movimiento">{fecha(e.ultimo_movimiento)}{i?.dias_sin_movimiento !== null && i ? ` (hace ${i.dias_sin_movimiento} d.h.)` : ''}</Dato>
        <Dato etiqueta="Registrado por">{e.registrado_por || (e.importado ? 'Sistema anterior (importado)' : '—')}</Dato>
        <div className="ficha-dato" style={{ gridColumn: '1 / -1' }}><div className="etiqueta">Asunto</div><div className="valor">{e.asunto || '—'}</div></div>
      </div>

      <h3 style={{ marginBottom: 8 }}>Plazo</h3>
      <div className="ficha-datos">
        <Dato etiqueta="Plazo legal (TUPA)">{p.plazo_tupa === null || p.plazo_tupa === undefined ? 'Sin plazo en el TUPA'
          : p.plazo_tupa === 0 ? 'Mismo día (0 d.h.)' : `${p.plazo_tupa} días hábiles`}</Dato>
        {i && <Dato etiqueta="Fecha límite">{fecha(i.fecha_limite)}</Dato>}
        {i && <Dato etiqueta="Situación"><span style={{ color: i.vencido ? 'var(--critico)' : undefined, fontWeight: 600 }}>{restantes(i.dias_restantes)}</span></Dato>}
        {i && <Dato etiqueta="Días hábiles transcurridos">{i.dias === null ? 'No calculable' : numero(i.dias)}</Dato>}
        {i && <Dato etiqueta="Días con plazo suspendido">{numero(f.dias_suspendidos)}</Dato>}
        {e.fecha_cierre && <Dato etiqueta="Fecha de cierre">{fecha(e.fecha_cierre)}</Dato>}
        {e.motivo_cierre && <div className="ficha-dato" style={{ gridColumn: '1 / -1' }}><div className="etiqueta">Cierre</div><div className="valor">{e.motivo_cierre}</div></div>}
      </div>
    </>
  )
}

function explicacionFactor(codigo, i) {
  switch (codigo) {
    case 'urgencia_temporal':
      if (i.factores.urgencia_temporal === null) {
        return i.dias === null ? 'No se puede calcular: la fecha de ingreso no es válida.'
          : 'Este trámite no tiene plazo en el TUPA ni suficientes casos históricos para estimarlo.'
      }
      if (i.plazo_referencia === 0) return `Plazo TUPA de atención el mismo día; lleva ${i.dias} d.h.`
      return `Lleva ${numero(i.dias)} de ${numero(i.plazo_referencia, 1)} d.h. de su plazo de referencia (${i.origen_plazo === 'TUPA' ? 'plazo legal del TUPA' : 'P80 de los tiempos reales, Modelo 2'}).`
    case 'complejidad':
      return `Ha pasado por ${i.n_oficinas} oficina(s) distinta(s); el 90% de los expedientes de este trámite pasa por ${numero(i.referencia_oficinas, Number.isInteger(i.referencia_oficinas) ? 0 : 1)} o menos.`
    case 'antiguedad':
      if (i.factores.antiguedad === null) return 'No se puede calcular: la fecha de ingreso no es válida.'
      return `Ingresó hace ${numero(i.dias)} d.h.; el 90% de los expedientes en trámite tiene ${numero(i.referencias.antiguedad, 1)} d.h. o menos.`
    case 'tipo_procedimiento':
      return i.plazo_tupa !== null ? 'Trámite con plazo legal en el TUPA: vencerlo tiene consecuencias jurídicas (escala 1.0).'
        : i.factores.tipo_procedimiento >= 0.6 ? 'Trámite de un ciudadano sin plazo identificado en el TUPA (escala 0.6).'
          : 'Documento o acto interno, sin un administrado esperando (escala 0.3).'
    case 'carga_trabajo':
      return `Su ubicación actual tiene ${i.carga_ubicacion} expediente(s) en trámite; la ubicación más cargada tiene ${i.referencias.max_carga}.`
    default: return ''
  }
}

function ExplicacionIua({ f }) {
  const i = f.iua
  if (!i) {
    return <Aviso tipo="informativo">Este expediente no está en trámite ({f.expediente.estado_nombre.toLowerCase()}), por eso no tiene índice de urgencia.
      El IUA solo se calcula para expedientes en trámite u observados.</Aviso>
  }
  const corteCritico = i.referencias.cortes[0][1]
  return (
    <>
      <div className="dos-columnas">
        <div>
          <div className="etiqueta-campo">Índice de Urgencia Administrativa</div>
          <div className="grande" style={{ marginBottom: 8 }}>{i.iua.toFixed(3)} <Nivel nivel={i.nivel} /></div>
          <div className="medidor"><div className="aguja" style={{ left: `${Math.min(100, i.iua * 100)}%` }} /></div>
          <div className="escala-medidor"><span>0 · BAJO</span><span>0.30 · MEDIO</span><span>0.50 · ALTO</span><span>0.70 · CRÍTICO</span><span>1</span></div>
        </div>
        <div className="resaltado">
          <div style={{ fontWeight: 650, marginBottom: 4 }}>{i.accion}</div>
          <div style={{ fontSize: 13 }}>
            {i.vencido && i.iua < corteCritico
              ? <>Es <b>CRÍTICO por regla de seguridad</b>: ya superó su plazo legal del TUPA. Su puntaje ({i.iua.toFixed(3)}) sería menor,
                  pero el vencimiento de un plazo legal no se compensa con los demás factores.</>
              : <>Ocupa el puesto <b>{i.prioridad}</b> de {numero(i.total_activos)} expedientes en trámite, ordenados de mayor a menor IUA.</>}
          </div>
        </div>
      </div>

      <h3 style={{ margin: '18px 0 4px' }}>Cálculo: IUA = Σ (peso del factor × valor del factor)</h3>
      <p className="texto-suave" style={{ fontSize: 12.5, marginBottom: 12 }}>
        Cada factor se mide de 0 a 1. Los pesos salen del Proceso Analítico Jerárquico (AHP) y suman 100%.
        {i.factores_omitidos.length > 0 && ' Si un factor no se puede medir, se excluye y los pesos de los demás se reparten proporcionalmente (no se inventa un valor).'}
      </p>
      <table className="tabla">
        <thead><tr><th>Factor</th><th>Qué se midió en este expediente</th><th style={{ width: 170 }}>Valor (0 a 1)</th><th className="num">Peso AHP</th><th className="num">Aporte al IUA</th></tr></thead>
        <tbody>
          {i.factores_meta.map(m => {
            const v = i.factores[m.codigo]
            return (
              <tr key={m.codigo}>
                <td className="destacado">{m.nombre}<div className="suave">{m.pregunta}</div></td>
                <td style={{ fontSize: 12.5 }}>{explicacionFactor(m.codigo, i)}</td>
                <td>{v === null ? <Insignia>omitido</Insignia> : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="barra-factor" style={{ flex: 1 }}><div className="relleno" style={{ width: `${v * 100}%` }} /></div>
                    <span className="mono">{v.toFixed(3)}</span>
                  </div>)}</td>
                <td className="num">{(i.pesos[m.codigo] * 100).toFixed(1)}%</td>
                <td className="num destacado">{i.aportes[m.codigo] === null ? '—' : i.aportes[m.codigo].toFixed(3)}</td>
              </tr>
            )
          })}
          <tr style={{ background: 'var(--azul-muy-claro)' }}>
            <td colSpan={4} className="destacado" style={{ textAlign: 'right' }}>IUA</td>
            <td className="num destacado">{i.iua.toFixed(3)}</td>
          </tr>
        </tbody>
      </table>
    </>
  )
}

function ComparacionMta({ f }) {
  const m = f.mta
  const e = f.expediente
  if (!m) return <Aviso tipo="informativo">No hay expedientes cerrados de este trámite en la base de cálculo del MTA, por eso no hay tiempos históricos con qué comparar.</Aviso>
  if (!m.datos_suficientes) {
    return <Aviso tipo="informativo">Solo hay {m.n} caso(s) cerrados de este trámite. El MTA no publica estadísticas con menos de 30 casos,
      porque un promedio sobre tan pocos datos no es confiable.</Aviso>
  }
  const maximo = Math.max(m.p95, m.dias_expediente || 0, m.plazo_tupa || 0) * 1.08 || 1
  const pos = (v) => `${Math.min(100, (v / maximo) * 100)}%`
  // cada marca en su propia fila de etiqueta para que no se encimen
  const marcas = [
    ...(m.plazo_tupa !== null ? [{ v: m.plazo_tupa, t: `Plazo TUPA: ${m.plazo_tupa}`, c: 'var(--bajo)', fila: 0 }] : []),
    { v: m.mediana, t: `Mediana: ${numero(m.mediana)}`, c: 'var(--azul-claro)', fila: 1 },
    { v: m.p80, t: `P80: ${numero(m.p80)}`, c: 'var(--alto)', fila: 2 },
  ]
  return (
    <>
      <p className="texto-suave" style={{ fontSize: 13, marginBottom: 14 }}>
        Modelo 2 — tiempos reales de atención de <b>{e.procedimiento}</b>, calculados sobre {numero(m.n)} expedientes ya cerrados
        (días hábiles desde el ingreso hasta el cierre).
      </p>
      <div className="rejilla-indicadores">
        <div className="indicador"><div className="etiqueta">Casos históricos</div><div className="valor">{numero(m.n)}</div></div>
        <div className="indicador"><div className="etiqueta">Mediana</div><div className="valor">{numero(m.mediana)}</div><div className="nota">la mitad se resolvió en este tiempo o menos</div></div>
        <div className="indicador alto"><div className="etiqueta">Percentil 80</div><div className="valor">{numero(m.p80)}</div><div className="nota">el 80% se resolvió en este tiempo o menos</div></div>
        <div className="indicador bajo"><div className="etiqueta">Plazo TUPA</div><div className="valor">{m.plazo_tupa === null ? '—' : m.plazo_tupa}</div></div>
        <div className={`indicador ${m.tasa_cumplimiento !== null && m.tasa_cumplimiento < 0.5 ? 'critico' : ''}`}>
          <div className="etiqueta">Cumplimiento del TUPA</div><div className="valor">{porcentaje(m.tasa_cumplimiento, 0)}</div>
          <div className="nota">dentro del plazo legal · proceso {m.interpretacion}</div></div>
      </div>
      <div className="panel"><div className="panel-cuerpo">
        <div style={{ position: 'relative', height: 112, margin: '6px 90px 0' }}>
          <div style={{ position: 'absolute', top: 30, left: 0, right: 0, height: 8, background: 'var(--gris-fondo)', borderRadius: 4 }} />
          {marcas.map(x => (
            <div key={x.t}>
              <div style={{ position: 'absolute', left: pos(x.v), top: 22, width: 3, height: 26 + x.fila * 18, background: x.c, transform: 'translateX(-1px)' }} />
              <div style={{ position: 'absolute', left: pos(x.v), top: 50 + x.fila * 18, transform: 'translateX(-50%)', fontSize: 11,
                            color: x.c, fontWeight: 700, whiteSpace: 'nowrap', background: '#fff', padding: '0 3px', zIndex: 2,
                            border: '1px solid var(--borde)', borderRadius: 4 }}>{x.t}</div>
            </div>
          ))}
          {m.dias_expediente !== null && (
            <>
              <div style={{ position: 'absolute', left: pos(m.dias_expediente), top: 0, transform: 'translateX(-50%)', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                Este expediente: {numero(m.dias_expediente)}</div>
              <div style={{ position: 'absolute', left: pos(m.dias_expediente), top: 26, width: 16, height: 16, borderRadius: '50%', background: '#111827',
                            border: '2px solid #fff', transform: 'translateX(-50%)', boxShadow: '0 0 0 1px #111827' }} />
            </>
          )}
        </div>
        <div className="texto-tenue" style={{ fontSize: 11, textAlign: 'right' }}>días hábiles desde el ingreso →</div>
      </div></div>
      {m.dias_expediente !== null && m.percentil_expediente !== null && (
        <Aviso tipo={m.percentil_expediente >= 0.8 ? 'advertencia' : 'informativo'}>
          {m.en_curso
            ? <>Este expediente lleva <b>{numero(m.dias_expediente)} días hábiles</b>. A esa altura, el <b>{porcentaje(m.percentil_expediente, 0)}</b> de
                los casos históricos de su trámite ya estaba resuelto.</>
            : <>Este expediente tardó <b>{numero(m.dias_expediente)} días hábiles</b>. El <b>{porcentaje(m.percentil_expediente, 0)}</b> de los casos
                históricos de su trámite se resolvió en ese tiempo o menos.</>}
          {m.en_curso && m.percentil_expediente >= 0.8 && ' Ya va más lento que el 80% de los casos: conviene revisar por qué se retrasa.'}
        </Aviso>
      )}
    </>
  )
}

function Recorrido({ f }) {
  const e = f.expediente
  const totalDias = (f.tiempo_por_destino || []).reduce((t, x) => t + x.dias, 0)
  return (
    <>
      {f.tiempo_por_destino && f.tiempo_por_destino.length > 0 && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-cabecera"><h3>Tiempo en cada escritorio</h3>
            <span className="texto-suave" style={{ fontSize: 12 }}>{numero(totalDias)} días hábiles en total</span></div>
          <div className="panel-cuerpo" style={{ height: Math.max(90, f.tiempo_por_destino.length * 30 + 20) }}>
            <ResponsiveContainer>
              <BarChart data={f.tiempo_por_destino.slice(0, 12)} layout="vertical" margin={{ top: 0, right: 40, left: 10, bottom: 0 }}>
                <XAxis type="number" allowDecimals={false} fontSize={11} unit=" d" />
                <YAxis type="category" dataKey="destino" width={230} fontSize={11} tickFormatter={(v) => (v.length > 34 ? `${v.slice(0, 33)}…` : v)} />
                <Tooltip formatter={(v) => [`${v} días hábiles`, 'Permanencia']} />
                <Bar dataKey="dias" radius={[0, 4, 4, 0]} isAnimationActive={false} label={{ position: 'right', fontSize: 11 }}>
                  {f.tiempo_por_destino.slice(0, 12).map((x, k) => <Cell key={x.destino} fill={k === 0 ? '#ea580c' : '#2d5a9e'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <div className="linea-tiempo">
        {f.movimientos.map(m => {
          const clase = m.paso_actual ? 'actual' : m.tipo === 'OBSERVACION' ? 'observacion'
            : ['FINALIZACION', 'ARCHIVO'].includes(m.tipo) ? 'cierre' : ''
          const ancho = totalDias && m.dias_en_paso ? Math.max(2, Math.min(100, (m.dias_en_paso / totalDias) * 100)) : 0
          return (
            <div key={m.id} className={`paso ${clase}${m.fecha_valida ? '' : ' invalido'}`}>
              <div className="titulo">{fecha(m.fecha)} · {m.tipo || 'Movimiento'} → {m.destino_nombre || m.destino_texto || 'Sin destino registrado'}</div>
              {ancho > 0 && <div className="barra-paso" title={`${m.dias_en_paso} d.h.`}><div style={{ width: `${ancho}%` }} /></div>}
              <div className="detalle">
                {m.documento && <>Doc.: {m.documento} · </>}
                {m.folios && <>Folios: {m.folios} · </>}
                {m.dias_en_paso !== undefined && m.dias_en_paso !== null && <>{m.paso_actual ? `Lleva ${m.dias_en_paso} d.h. aquí` : `Permaneció ${m.dias_en_paso} d.h.`} · </>}
                {m.usuario_nombre ? `Registró: ${m.usuario_nombre} (${fechaHora(m.registrado_en)})` : m.importado ? 'Registro del sistema anterior' : ''}
                {!m.fecha_valida && <> · <b>Fecha posterior al corte de importación: error de registro en el origen</b></>}
              </div>
              {m.recibido_en && <div className="detalle" style={{ color: 'var(--bajo)' }}>✍ Recibido por {m.recibido_por} el {fechaHora(m.recibido_en)}</div>}
              {m.por_recibir && <div className="detalle" style={{ color: 'var(--alto)' }}>Recepción pendiente de firma</div>}
              {m.observacion && <div className="detalle" style={{ color: 'var(--texto)', marginTop: 2 }}>{m.observacion}</div>}
            </div>
          )
        })}
        {!f.movimientos.length && <div className="texto-suave">No hay movimientos registrados.</div>}
        {e.estado === 'CERRADO_HISTORICO' && (
          <div className="paso cierre"><div className="titulo">{fecha(e.fecha_cierre)} · Cerrado</div><div className="detalle">{e.motivo_cierre}</div></div>
        )}
      </div>
      {f.asignaciones && f.asignaciones.length > 0 && (
        <>
          <h3 style={{ margin: '16px 0 6px' }}>Asignaciones (modelo de asignación)</h3>
          <table className="tabla"><thead><tr><th>Asignado</th><th>Trabajador</th><th>Fecha límite</th><th>Estado</th><th className="num">IUA</th><th className="num">eᵢⱼ</th><th>Lote</th></tr></thead>
            <tbody>{f.asignaciones.map(a => <tr key={a.id}><td>{fecha(a.fecha_asignacion)}</td><td>{a.usuario}</td><td>{fecha(a.fecha_limite)}</td>
              <td>{a.estado}</td><td className="num">{a.iua_al_asignar?.toFixed(3) ?? '—'}</td><td className="num">{a.eij_score?.toFixed(3) ?? '—'}</td><td className="mono suave">{a.lote_id}</td></tr>)}</tbody></table>
        </>
      )}
    </>
  )
}
