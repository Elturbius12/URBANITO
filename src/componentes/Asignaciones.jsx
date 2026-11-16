// Asignaciones — Modelo 3: asignación óptima de expedientes a trabajadores (MILP).
// Administrador: ejecuta el modelo, revisa y corrige la propuesta, y confirma.
// Jefes y gerente: ven las asignaciones de su alcance. Técnicos: las suyas.
import { useMemo, useState } from 'react'
import { useDatos, llamar } from '../api'
import { useApp, Panel, Cargando, ErrorCarga, Aviso, Modal, Campo, Indicador, Insignia, Nivel, Pestanas, Paginacion,
         Vacio, Semaforo, useAccion, puede } from './Comunes'
import { numero, fecha, porcentaje } from '../formato'
import { exportarExcel } from '../exportar'

const NIVELES = ['CRÍTICO', 'ALTO', 'MEDIO', 'BAJO']
const TAM = 50

export default function Asignaciones() {
  const { usuario } = useApp()
  const admin = puede(usuario, 'asignaciones')
  const [pestana, setPestana] = useState(admin ? 'modelo' : 'lista')
  return (
    <>
      <Pestanas activa={pestana} alCambiar={setPestana} opciones={[
        ...(admin ? [{ clave: 'modelo', etiqueta: 'Ejecutar modelo' }] : []),
        { clave: 'lista', etiqueta: admin || puede(usuario, 'asignaciones_ver') ? 'Asignaciones confirmadas' : 'Mis asignaciones' },
        ...(admin || puede(usuario, 'asignaciones_ver') ? [{ clave: 'eficiencia', etiqueta: 'Eficiencia histórica (eᵢⱼ)' }] : []),
      ]} />
      {pestana === 'modelo' && <EjecutarModelo alConfirmar={() => setPestana('lista')} />}
      {pestana === 'lista' && <ListaAsignaciones />}
      {pestana === 'eficiencia' && <Eficiencia />}
    </>
  )
}

// ---------------------------------------------------------------- 1. ejecutar y revisar la propuesta
function EjecutarModelo({ alConfirmar }) {
  const { notificar, refrescar, abrirFicha } = useApp()
  const [p, setP] = useState({ niveles: ['CRÍTICO', 'ALTO'], delta: 2, umbral: 30, limite: 2000, incluir_jefes: true, plazo_dias: 10 })
  const [prop, setProp] = useState(null)
  const [eleccion, setEleccion] = useState({})        // expediente_id -> usuario_id | ''
  const [filtro, setFiltro] = useState({ ver: 'asignados', departamento: '', texto: '' })
  const [pagina, setPagina] = useState(1)
  const [confirmando, setConfirmando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const { ocupado, error, ejecutar } = useAccion()

  const correr = async () => {
    setResultado(null)
    const r = await ejecutar(() => llamar('asignacion_ejecutar', p))
    if (r) {
      setProp(r)
      setEleccion(Object.fromEntries(r.filas.map(f => [f.expediente_id, f.usuario_id || ''])))
      setPagina(1)
    }
  }

  // impacto en vivo de los cambios manuales
  const calc = useMemo(() => {
    if (!prop) return null
    const carga = new Map(prop.resumen.map(t => [t.usuario_id, 0]))
    let z = 0, asignados = 0, cambios = 0
    for (const f of prop.filas) {
      const j = eleccion[f.expediente_id]
      if ((j || null) !== (f.usuario_id || null)) cambios++
      if (!j) continue
      const c = f.candidatos.find(k => k.usuario_id === Number(j))
      if (!c) continue
      z += f.iua * c.eij
      asignados++
      carga.set(Number(j), (carga.get(Number(j)) || 0) + 1)
    }
    const excedidos = prop.resumen.filter(t => (carga.get(t.usuario_id) || 0) > t.disponible)
    return { z, asignados, cambios, carga, excedidos }
  }, [prop, eleccion])

  const confirmar = async () => {
    const asignaciones = prop.filas.filter(f => eleccion[f.expediente_id]).map(f => ({ expediente_id: f.expediente_id, usuario_id: Number(eleccion[f.expediente_id]) }))
    const r = await ejecutar(() => llamar('asignacion_confirmar', { lote_id: prop.lote_id, asignaciones, plazo_dias: p.plazo_dias }))
    setConfirmando(false)
    if (r) { setResultado(r); setProp(null); notificar(r.mensaje, 'exito'); refrescar() }
  }

  const exportar = () => exportarExcel(notificar, `propuesta_asignacion_${prop.lote_id}`, [{
    nombre: 'Propuesta', titulo: `Propuesta de asignación ${prop.lote_id}`,
    subtitulo: `Método ${prop.metodo} · Z = ${calc.z.toFixed(4)} · ${calc.asignados} expedientes asignados`,
    columnas: [{ titulo: 'Expediente', clave: 'numero', ancho: 18 }, { titulo: 'Trámite', clave: 'procedimiento', ancho: 34 },
      { titulo: 'Departamento', clave: 'departamento', ancho: 30 }, { titulo: 'IUA (w)', clave: 'iua', formato: 'decimal' },
      { titulo: 'Nivel', clave: 'nivel' }, { titulo: 'Trabajador', clave: 'trabajador', ancho: 34 },
      { titulo: 'eᵢⱼ', clave: 'eij', formato: 'decimal' }, { titulo: 'w·e', clave: 'aporte', formato: 'decimal' }],
    filas: prop.filas.map(f => {
      const j = Number(eleccion[f.expediente_id]) || null
      const c = j ? f.candidatos.find(k => k.usuario_id === j) : null
      return { ...f, trabajador: c ? c.nombre : '— sin asignar —', eij: c ? c.eij : null, aporte: c ? f.iua * c.eij : null }
    }),
  }])

  const visibles = prop ? prop.filas.filter(f => {
    if (filtro.ver === 'asignados' && !eleccion[f.expediente_id]) return false
    if (filtro.ver === 'sin' && eleccion[f.expediente_id]) return false
    if (filtro.departamento && f.departamento_codigo !== filtro.departamento) return false
    if (filtro.texto && !String(f.numero).toUpperCase().includes(filtro.texto.toUpperCase())) return false
    return true
  }) : []
  const deps = prop ? [...new Map(prop.filas.map(f => [f.departamento_codigo, f.departamento])).entries()] : []

  return (
    <>
      <Panel titulo="Modelo de asignación óptima (MILP)"
             descripcion="max Z = Σ wᵢ·eᵢⱼ·xᵢⱼ — wᵢ: urgencia (IUA) · eᵢⱼ: eficiencia histórica del trabajador en ese trámite">
        <div className="formulario" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <Campo etiqueta="Niveles de urgencia a asignar">
            <div className="grupo-botones">{NIVELES.map(n => (
              <label key={n} className="casilla"><input type="checkbox" checked={p.niveles.includes(n)}
                onChange={e => setP({ ...p, niveles: e.target.checked ? [...p.niveles, n] : p.niveles.filter(x => x !== n) })} /> <Nivel nivel={n} /></label>))}
            </div>
          </Campo>
          <Campo etiqueta="Tolerancia de equidad δ" ayuda="Cuánto puede alejarse la carga de cada uno del promedio">
            <input type="number" min="0" max="100" value={p.delta} onChange={e => setP({ ...p, delta: e.target.value })} />
          </Campo>
          <Campo etiqueta="Plazo de atención (días hábiles)" ayuda="Se informa a cada trabajador">
            <input type="number" min="1" max="120" value={p.plazo_dias} onChange={e => setP({ ...p, plazo_dias: e.target.value })} />
          </Campo>
          <Campo etiqueta="Umbral de experiencia" ayuda="Casos atendidos para experiencia plena (eᵢⱼ)">
            <input type="number" min="1" max="1000" value={p.umbral} onChange={e => setP({ ...p, umbral: e.target.value })} />
          </Campo>
          <Campo etiqueta="Máximo de expedientes a considerar" ayuda="Los de mayor IUA primero">
            <input type="number" min="1" max="20000" value={p.limite} onChange={e => setP({ ...p, limite: e.target.value })} />
          </Campo>
          <Campo etiqueta="Trabajadores">
            <label className="casilla"><input type="checkbox" checked={p.incluir_jefes} onChange={e => setP({ ...p, incluir_jefes: e.target.checked })} /> Incluir a los jefes de departamento</label>
          </Campo>
        </div>
        <div className="grupo-botones" style={{ marginTop: 12 }}>
          <button className="boton primario grande" disabled={ocupado || !p.niveles.length} onClick={correr} data-accion="ejecutar-modelo">
            {ocupado && !confirmando ? 'Calculando…' : '⇄ Usar modelo de asignaciones'}</button>
          <span className="texto-suave" style={{ fontSize: 12.5 }}>Se genera una PROPUESTA: nada se asigna hasta que usted la valide.</span>
        </div>
        {error && !confirmando && <div style={{ marginTop: 10 }}><Aviso tipo="error">{error}</Aviso></div>}
      </Panel>

      {resultado && (
        <Aviso tipo="exito"><b>{resultado.mensaje}</b> Cada trabajador recibió una notificación con sus expedientes y su plazo.{' '}
          <button className="boton pequeno" onClick={alConfirmar}>Ver asignaciones</button></Aviso>
      )}

      {prop && calc && (
        <>
          {prop.aviso && <Aviso>{prop.aviso}</Aviso>}
          <div className="rejilla-indicadores">
            <Indicador etiqueta="Método usado" valor={prop.metodo === 'MILP' ? 'MILP (GLPK)' : 'Heurística voraz'}
                       nota={prop.milp ? `${prop.milp.estado === 'OPTIMO' ? 'Solución óptima' : prop.milp.estado} · ${numero(prop.milp.variables)} variables` : ''} />
            <Indicador etiqueta="Valor objetivo Z" valor={calc.z.toFixed(3)} tono={calc.cambios ? 'medio' : 'bajo'}
                       nota={calc.cambios ? `Modelo: ${(prop.milp || prop.voraz).z.toFixed(3)} · ${calc.cambios} cambio(s) manual(es)` : 'Sin cambios manuales'} />
            <Indicador etiqueta="Expedientes asignados" valor={numero(calc.asignados)} nota={`de ${numero(prop.filas.length)} candidatos`} />
            <Indicador etiqueta="Sin trabajador compatible" valor={numero(prop.sin_compatible)} tono={prop.sin_compatible ? 'alto' : ''}
                       nota="Nadie activo en su departamento" />
            <Indicador etiqueta="MILP vs. voraz" valor={prop.mejora_milp === null ? '—' : `${prop.mejora_milp >= 0 ? '+' : ''}${porcentaje(prop.mejora_milp, 2)}`}
                       nota={`Voraz: Z = ${prop.voraz.z.toFixed(3)} (${prop.voraz.asignados} asignados)`} />
          </div>
          {prop.milp && prop.milp.relajaciones.length > 0 && (
            <Aviso tipo="informativo">{prop.milp.relajaciones.join(' ')} {prop.milp.equidad &&
              `Equidad aplicada: entre ${prop.milp.equidad.minimo} y ${prop.milp.equidad.maximo} expedientes por trabajador (promedio ${numero(prop.milp.equidad.promedio, 1)}, δ = ${prop.milp.equidad.delta}).`}</Aviso>
          )}
          {calc.excedidos.length > 0 && (
            <Aviso tipo="error">Con sus cambios, {calc.excedidos.map(t => t.nombre).join(', ')} superaría(n) su capacidad máxima. Corrija antes de validar.</Aviso>
          )}

          <Panel titulo="Carga por trabajador" sinRelleno descripcion="Capacidad disponible = capacidad máxima − asignaciones que ya tiene">
            <div className="tabla-contenedor" style={{ maxHeight: 300 }}>
              <table className="tabla">
                <thead><tr><th>Trabajador</th><th>Departamento(s)</th><th className="num">Ya tiene</th><th className="num">Disponible</th><th className="num">Propuestos</th><th style={{ width: 160 }}>Uso</th></tr></thead>
                <tbody>{prop.resumen.map(t => {
                  const n = calc.carga.get(t.usuario_id) || 0
                  const pct = t.disponible ? Math.min(100, (n / t.disponible) * 100) : (n ? 100 : 0)
                  return (
                    <tr key={t.usuario_id} style={n > t.disponible ? { background: 'var(--critico-fondo)' } : undefined}>
                      <td className="destacado">{t.nombre}<div className="suave">{t.rol}</div></td>
                      <td className="suave">{t.departamentos.map(d => d.replace(/^Departamento de /, '')).join(', ')}</td>
                      <td className="num">{t.carga_actual}</td><td className="num">{t.disponible}</td>
                      <td className="num destacado">{n}</td>
                      <td><div className="barra-progreso" style={{ margin: 0 }}><div style={{ width: `${pct}%`, background: n > t.disponible ? 'var(--critico)' : undefined }} /></div></td>
                    </tr>)
                })}</tbody>
              </table>
            </div>
          </Panel>

          <Panel titulo="Propuesta (editable)" sinRelleno
                 descripcion="Cambie el trabajador con la lista: solo aparecen los de su departamento (restricción de compatibilidad). El valor Z se actualiza al instante."
                 acciones={<div className="grupo-botones">
                   <button className="boton pequeno" onClick={exportar}>⬇ Excel</button>
                   <button className="boton pequeno" disabled={!calc.cambios} onClick={() => setEleccion(Object.fromEntries(prop.filas.map(f => [f.expediente_id, f.usuario_id || ''])))}>Deshacer cambios</button>
                   <button className="boton primario" disabled={!calc.asignados || calc.excedidos.length > 0 || ocupado} onClick={() => setConfirmando(true)} data-accion="validar-asignar">
                     ✔ Validar y asignar</button></div>}>
            <div className="filtros" style={{ padding: '10px 14px' }}>
              {[['asignados', 'Asignados'], ['sin', 'Sin asignar'], ['todos', 'Todos']].map(([k, t]) => (
                <button key={k} className={`filtro${filtro.ver === k ? ' activo' : ''}`} onClick={() => { setFiltro({ ...filtro, ver: k }); setPagina(1) }}>{t}</button>))}
              <select className="control" value={filtro.departamento} onChange={e => { setFiltro({ ...filtro, departamento: e.target.value }); setPagina(1) }}>
                <option value="">Todos los departamentos</option>
                {deps.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
              </select>
              <input className="control" placeholder="N° de expediente…" value={filtro.texto} onChange={e => { setFiltro({ ...filtro, texto: e.target.value }); setPagina(1) }} />
              <span className="texto-suave" style={{ marginLeft: 'auto', fontSize: 12.5 }}>{numero(visibles.length)} fila(s)</span>
            </div>
            {!visibles.length ? <Vacio texto="No hay filas con este filtro." /> : (
              <div className="tabla-contenedor" style={{ maxHeight: 'calc(100vh - 380px)' }}>
                <table className="tabla" data-prueba="propuesta">
                  <thead><tr><th>Expediente</th><th>Trámite</th><th className="num">IUA (w)</th><th>Nivel</th><th style={{ minWidth: 280 }}>Trabajador (eᵢⱼ)</th><th className="num">w·e</th></tr></thead>
                  <tbody>{visibles.slice((pagina - 1) * TAM, pagina * TAM).map(f => {
                    const j = Number(eleccion[f.expediente_id]) || null
                    const c = j ? f.candidatos.find(k => k.usuario_id === j) : null
                    const cambiado = (j || null) !== (f.usuario_id || null)
                    return (
                      <tr key={f.expediente_id} style={cambiado ? { background: 'var(--medio-fondo)' } : undefined}>
                        <td><button className="enlace mono destacado" onClick={() => abrirFicha(f.expediente_id)}>{f.numero}</button>
                          <div className="suave">{f.dias !== null ? `${f.dias} d.h.` : ''}{f.vencido ? ' · vencido' : ''}</div></td>
                        <td>{f.procedimiento}<div className="suave">{(f.departamento || '').replace(/^Departamento de /, '')}</div></td>
                        <td className="num">{f.iua.toFixed(3)}</td>
                        <td><Nivel nivel={f.nivel} /></td>
                        <td><select className="control" value={eleccion[f.expediente_id] || ''} data-campo="trabajador"
                                    onChange={e => setEleccion({ ...eleccion, [f.expediente_id]: e.target.value ? Number(e.target.value) : '' })}>
                          <option value="">— No asignar ahora —</option>
                          {f.candidatos.map(k => <option key={k.usuario_id} value={k.usuario_id}>
                            {k.nombre} — e = {k.eij.toFixed(3)}{k.con_historial ? '' : ' (sin historial)'}{k.usuario_id === f.usuario_id ? ' ★ modelo' : ''}</option>)}
                        </select></td>
                        <td className="num destacado">{c ? (f.iua * c.eij).toFixed(3) : '—'}</td>
                      </tr>)
                  })}</tbody>
                </table>
              </div>
            )}
            <Paginacion pagina={pagina} total={visibles.length} tam={TAM} alCambiar={setPagina} />
          </Panel>
          <p className="texto-tenue" style={{ fontSize: 11.5 }}>
            eᵢⱼ = {prop.pesos.tasa} × tasa de finalización a tiempo + {prop.pesos.velocidad} × velocidad relativa + {prop.pesos.experiencia} × experiencia.
            Un trabajador sin historial en un trámite recibe eᵢⱼ = {prop.eij_sin_historial.toFixed(3)} (valores neutros). Lote {prop.lote_id}.
          </p>
        </>
      )}

      {confirmando && prop && (
        <Modal titulo="Validar y asignar" alCerrar={ocupado ? null : () => setConfirmando(false)}
               pie={<><button className="boton" disabled={ocupado} onClick={() => setConfirmando(false)}>Cancelar</button>
                 <button className="boton primario" disabled={ocupado} onClick={confirmar} data-accion="confirmar-asignacion">{ocupado ? 'Asignando…' : 'Asignar ahora'}</button></>}>
          <p>Se asignarán <b>{numero(calc.asignados)}</b> expedientes a <b>{[...calc.carga.values()].filter(n => n > 0).length}</b> trabajadores
            con un plazo de atención de <b>{p.plazo_dias}</b> días hábiles (o antes, si su plazo TUPA vence primero).</p>
          <ul style={{ margin: '10px 0 0 18px', fontSize: 13 }}>
            <li>Cada expediente pasa a la bandeja del trabajador (queda registrado en su recorrido).</li>
            <li>Cada trabajador recibe una notificación.</li>
            <li>Todo queda en la auditoría{calc.cambios ? `, incluidos sus ${calc.cambios} cambio(s) manual(es)` : ''}.</li>
          </ul>
          {error && <div style={{ marginTop: 10 }}><Aviso tipo="error">{error}</Aviso></div>}
        </Modal>
      )}
    </>
  )
}

// ---------------------------------------------------------------- 2. asignaciones confirmadas
function ListaAsignaciones() {
  const { usuario, version, abrirFicha, notificar, refrescar } = useApp()
  const admin = puede(usuario, 'asignaciones')
  const [f, setF] = useState({ estado: 'ACTIVAS', lote_id: '' })
  const { datos, error, recargar } = useDatos('asignaciones', f, [version])
  const [editando, setEditando] = useState(null)
  if (error) return <ErrorCarga error={error} reintentar={recargar} />
  if (!datos) return <Cargando />
  const mias = datos.filas.filter(a => a.usuario_id === usuario.id)

  return (
    <>
      <div className="filtros" style={{ marginBottom: 12 }}>
        {[['ACTIVAS', 'Activas'], ['PENDIENTE', 'Pendientes'], ['EN_PROGRESO', 'En progreso'], ['COMPLETADA', 'Completadas'], ['REASIGNADA', 'Reasignadas'], ['', 'Todas']].map(([k, t]) => (
          <button key={k} className={`filtro${f.estado === k ? ' activo' : ''}`} onClick={() => setF({ ...f, estado: k })}>{t}</button>))}
        {datos.lotes.length > 0 && (
          <select className="control" value={f.lote_id} onChange={e => setF({ ...f, lote_id: e.target.value })}>
            <option value="">Todos los lotes</option>
            {datos.lotes.map(l => <option key={l.lote_id} value={l.lote_id}>{l.lote_id} · {fecha(l.fecha)} · {l.n} exp.</option>)}
          </select>
        )}
        <button className="boton pequeno" style={{ marginLeft: 'auto' }} disabled={!datos.filas.length}
                onClick={() => exportarExcel(notificar, 'asignaciones', [{ nombre: 'Asignaciones', titulo: 'Asignaciones de expedientes', subtitulo: `${datos.filas.length} registros`,
                  columnas: [{ titulo: 'Expediente', clave: 'numero', ancho: 18 }, { titulo: 'Trámite', clave: 'procedimiento', ancho: 32 },
                    { titulo: 'Trabajador', clave: 'usuario', ancho: 30 }, { titulo: 'Asignado', clave: 'fecha_asignacion', formato: 'fecha' },
                    { titulo: 'Fecha límite', clave: 'fecha_limite', formato: 'fecha' }, { titulo: 'Estado', clave: 'estado_nombre' },
                    { titulo: 'IUA al asignar', clave: 'iua_al_asignar', formato: 'decimal' }, { titulo: 'eᵢⱼ', clave: 'eij_score', formato: 'decimal' },
                    { titulo: 'Lote', clave: 'lote_id', ancho: 22 }], filas: datos.filas }])}>⬇ Excel</button>
      </div>
      {!admin && mias.length > 0 && (
        <Aviso tipo="informativo">Tiene {mias.filter(a => ['PENDIENTE', 'EN_PROGRESO'].includes(a.estado)).length} asignación(es) activa(s).
          Al registrar un movimiento o recibir el expediente, la asignación pasa a «En progreso»; al finalizarlo, a «Completada».</Aviso>
      )}
      <Panel sinRelleno titulo={`${numero(datos.filas.length)} asignación(es)`}>
        {!datos.filas.length ? <Vacio texto="No hay asignaciones con este filtro." /> : (
          <div className="tabla-contenedor" style={{ maxHeight: 'calc(100vh - 320px)' }}>
            <table className="tabla">
              <thead><tr><th>Plazo</th><th>Expediente</th><th>Trámite</th><th>Trabajador</th><th>Asignado</th><th>Fecha límite</th><th>Estado</th><th>Último movimiento</th><th></th></tr></thead>
              <tbody>{datos.filas.map(a => (
                <tr key={a.id}>
                  <td>{a.estado === 'COMPLETADA' ? <Semaforo color="verde">Hecho</Semaforo> : a.estado === 'REASIGNADA' ? <Semaforo color="gris">—</Semaforo>
                    : a.vencida ? <Semaforo color="rojo">Vencida</Semaforo> : a.dias_restantes !== null && a.dias_restantes <= 3
                      ? <Semaforo color="amarillo">{a.dias_restantes} d.h.</Semaforo> : <Semaforo color="verde">{a.dias_restantes ?? '—'} d.h.</Semaforo>}</td>
                  <td><button className="enlace mono destacado" onClick={() => abrirFicha(a.expediente_id)}>{a.numero}</button>
                    <div className="suave">{a.nivel ? <Nivel nivel={a.nivel} /> : a.estado_expediente_nombre}</div></td>
                  <td>{a.procedimiento}<div className="suave">{(a.departamento || '').replace(/^Departamento de /, '')}</div></td>
                  <td>{a.usuario}</td>
                  <td className="suave">{fecha(a.fecha_asignacion)}</td>
                  <td>{fecha(a.fecha_limite)}</td>
                  <td><Insignia tipo={a.estado === 'COMPLETADA' ? 'BAJO' : a.estado === 'EN_PROGRESO' ? 'azul' : a.estado === 'PENDIENTE' ? 'MEDIO' : 'neutra'}>{a.estado_nombre}</Insignia></td>
                  <td className="suave">{a.ultimo_movimiento ? `${fecha(a.ultimo_movimiento.fecha)} · ${a.ultimo_movimiento.tipo || ''}` : '—'}
                    {a.ultimo_movimiento?.usuario && <div>{a.ultimo_movimiento.usuario}</div>}</td>
                  <td>{['PENDIENTE', 'EN_PROGRESO'].includes(a.estado) && (admin || a.usuario_id === usuario.id) &&
                    <button className="boton pequeno" onClick={() => setEditando(a)}>Actualizar</button>}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </Panel>
      {editando && <EditarAsignacion a={editando} admin={admin} alCerrar={() => setEditando(null)}
                                     alListo={(m) => { setEditando(null); notificar(m, 'exito'); recargar(); refrescar() }} />}
    </>
  )
}

function EditarAsignacion({ a, admin, alCerrar, alListo }) {
  const { datos: cat } = useDatos('catalogos', {})
  const [estado, setEstado] = useState(a.estado)
  const [obs, setObs] = useState('')
  const [nuevo, setNuevo] = useState('')
  const { ocupado, error, ejecutar } = useAccion()
  const guardar = async () => {
    const r = await ejecutar(() => llamar('asignacion_actualizar', nuevo ? { id: a.id, usuario_id: Number(nuevo), observacion: obs } : { id: a.id, estado, observacion: obs }))
    if (r) alListo(nuevo ? 'Asignación reasignada' : 'Asignación actualizada')
  }
  const candidatos = cat ? cat.usuarios_destino.filter(x => x.id !== a.usuario_id && x.rol !== 'Gerente' && (x.departamentos || []).includes(a.departamento_codigo)) : []
  return (
    <Modal titulo={`Asignación del expediente ${a.numero}`} alCerrar={alCerrar}
           pie={<><button className="boton" onClick={alCerrar}>Cancelar</button><button className="boton primario" disabled={ocupado} onClick={guardar}>Guardar</button></>}>
      <div className="formulario">
        <Campo etiqueta="Estado de la asignación">
          <select value={estado} onChange={e => setEstado(e.target.value)} disabled={!!nuevo}>
            <option value="PENDIENTE">Pendiente</option><option value="EN_PROGRESO">En progreso</option><option value="COMPLETADA">Completada</option>
          </select>
        </Campo>
        {admin && (
          <Campo etiqueta="Reasignar a" ayuda="Solo personal de su departamento">
            <select value={nuevo} onChange={e => setNuevo(e.target.value)}>
              <option value="">— No reasignar —</option>
              {candidatos.map(x => <option key={x.id} value={x.id}>{x.nombre} — {x.rol}</option>)}
            </select>
          </Campo>
        )}
        <Campo etiqueta="Observación" completo><textarea value={obs} onChange={e => setObs(e.target.value)} placeholder="Opcional" /></Campo>
      </div>
      {error && <div style={{ marginTop: 10 }}><Aviso tipo="error">{error}</Aviso></div>}
    </Modal>
  )
}

// ---------------------------------------------------------------- 3. tabla e_ij
function Eficiencia() {
  const { version } = useApp()
  const { datos, error, recargar } = useDatos('eficiencia', {}, [version])
  const [q, setQ] = useState('')
  if (error) return <ErrorCarga error={error} reintentar={recargar} />
  if (!datos) return <Cargando />
  const filas = datos.filas.filter(f => !q || `${f.usuario} ${f.procedimiento}`.toUpperCase().includes(q.toUpperCase()))
  return (
    <>
      <Aviso tipo="informativo">eᵢⱼ = {datos.pesos.tasa} × tasa de finalización a tiempo + {datos.pesos.velocidad} × velocidad relativa
        + {datos.pesos.experiencia} × experiencia. Se calcula con el historial de expedientes cerrados (los mismos del Modelo 2, MTA) y se
        actualiza cada vez que se ejecuta el modelo. Velocidad = 1 − r/2, con r = tiempo propio / tiempo promedio del trámite.
        Para vincular un trabajador con su historial, el administrador indica su «nombre en los registros del sistema anterior» en Usuarios.</Aviso>
      <Panel sinRelleno titulo={`${numero(datos.filas.length)} pares trabajador–trámite`}
             acciones={<input className="control" placeholder="Filtrar por nombre o trámite…" value={q} onChange={e => setQ(e.target.value)} />}>
        {!filas.length ? <Vacio texto="Aún no se calculó la eficiencia. Ejecute el modelo una vez." /> : (
          <div className="tabla-contenedor" style={{ maxHeight: 'calc(100vh - 330px)' }}>
            <table className="tabla">
              <thead><tr><th>Trabajador</th><th>Trámite</th><th className="num">Atendidos</th><th className="num">A tiempo</th><th className="num">Tiempo prom. (d.h.)</th>
                <th className="num">Tasa</th><th className="num">Velocidad</th><th className="num">Experiencia</th><th className="num">eᵢⱼ</th></tr></thead>
              <tbody>{filas.map(f => (
                <tr key={`${f.usuario_id}|${f.procedimiento_codigo}`}>
                  <td className="destacado">{f.usuario}</td><td>{f.procedimiento}</td><td className="num">{numero(f.total_atendidos)}</td>
                  <td className="num">{numero(f.finalizados_a_tiempo)}</td><td className="num">{f.tiempo_promedio_dias === null ? '—' : numero(f.tiempo_promedio_dias, 1)}</td>
                  <td className="num">{f.tasa_finalizacion.toFixed(2)}</td><td className="num">{f.velocidad_relativa.toFixed(2)}</td>
                  <td className="num">{f.experiencia.toFixed(2)}</td><td className="num destacado">{f.score_eij.toFixed(3)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}
