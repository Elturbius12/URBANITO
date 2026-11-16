// Bandeja priorizada: el Modelo 1 (IUA) aplicado al trabajo diario.
import { useEffect, useMemo, useState } from 'react'
import { useDatos, llamar } from '../api'
import { useApp, Panel, Nivel, Cargando, ErrorCarga, Vacio, Aviso, Semaforo, colorPlazo, useAccion } from './Comunes'
import { numero, fecha, restantes, fechaHora } from '../formato'
import { exportarExcel, COLUMNAS_PRIORIZADOS } from '../exportar'

const NIVELES = ['CRÍTICO', 'ALTO', 'MEDIO', 'BAJO']
const TAM = 100

export default function Bandeja({ inicial = {} }) {
  const { usuario, version, abrirFicha, notificar } = useApp()
  const [f, setF] = useState({ nivel: inicial.nivel || '', departamento: '', procedimiento: '', estado: '',
                               solo_vencidos: !!inicial.solo_vencidos, solo_mios: false, texto: '' })
  const [texto, setTexto] = useState('')
  const [pagina, setPagina] = useState(1)
  useEffect(() => { const t = setTimeout(() => setF(x => ({ ...x, texto })), 300); return () => clearTimeout(t) }, [texto])
  useEffect(() => setPagina(1), [f])

  const { datos, error, recargar } = useDatos('bandeja', f, [version])
  const conteo = useMemo(() => {
    const c = { 'CRÍTICO': 0, ALTO: 0, MEDIO: 0, BAJO: 0 }
    for (const x of datos?.filas || []) c[x.nivel]++
    return c
  }, [datos])

  if (error) return <ErrorCarga error={error} reintentar={recargar} />
  if (!datos) return <Cargando />
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const visibles = datos.filas.slice((pagina - 1) * TAM, pagina * TAM)
  const conteoPlazo = { verde: 0, amarillo: 0, rojo: 0, gris: 0 }
  for (const x of datos.filas) conteoPlazo[colorPlazo(x).clase]++

  return (
    <>
      <Panel>
        <div className="filtros" style={{ marginBottom: 10 }}>
          <button className={`filtro${!f.nivel ? ' activo' : ''}`} onClick={() => setF({ ...f, nivel: '' })}>Todos</button>
          {NIVELES.map(n => (
            <button key={n} className={`filtro${f.nivel === n ? ' activo' : ''}`} onClick={() => setF({ ...f, nivel: n })}>
              {n}{!f.nivel && ` (${conteo[n]})`}
            </button>
          ))}
          <input className="control" style={{ marginLeft: 'auto', minWidth: 260 }} placeholder="Buscar por N° de expediente o solicitante…"
                 value={texto} onChange={e => setTexto(e.target.value)} />
        </div>
        <div className="filtros">
          {datos.opciones.departamentos.length > 1 && (
            <select className="control" value={f.departamento} onChange={set('departamento')}>
              <option value="">Todos los departamentos</option>
              {datos.opciones.departamentos.map(d => <option key={d.codigo} value={d.codigo}>{d.nombre}</option>)}
            </select>
          )}
          <select className="control" value={f.procedimiento} onChange={set('procedimiento')}>
            <option value="">Todos los trámites</option>
            {datos.opciones.procedimientos.map(p => <option key={p.codigo} value={p.codigo}>{p.nombre}</option>)}
          </select>
          <select className="control" value={f.estado} onChange={set('estado')}>
            <option value="">En trámite y observados</option>
            <option value="EN_TRAMITE">Solo en trámite</option>
            <option value="OBSERVADO">Solo observados</option>
          </select>
          <label className="casilla"><input type="checkbox" checked={f.solo_vencidos} onChange={set('solo_vencidos')} /> Solo con plazo vencido</label>
          {['JEFE_DEPARTAMENTO', 'GERENTE'].includes(usuario.rol) && (
            <label className="casilla"><input type="checkbox" checked={f.solo_mios} onChange={set('solo_mios')} /> Solo asignados a mí</label>
          )}
          <button className="boton pequeno" style={{ marginLeft: 'auto' }} disabled={!datos.filas.length}
                  onClick={() => exportarExcel(notificar, `bandeja_priorizada_${datos.hoy}`, [{
                    nombre: 'Bandeja priorizada', titulo: 'Bandeja priorizada por IUA',
                    subtitulo: `${usuario.nombre_completo} — ${fecha(datos.hoy)} — ${datos.filas.length} expedientes`,
                    columnas: COLUMNAS_PRIORIZADOS, filas: datos.filas }])}>
            ⬇ Exportar a Excel
          </button>
        </div>
      </Panel>

      <PorRecibir />

      {usuario.rol === 'TECNICO' && !datos.filas.length && !f.texto && (
        <Aviso tipo="informativo">No tiene expedientes asignados. Su jefe de departamento le asigna expedientes desde su bandeja
          (botón «Derivar / asignar» en la ficha del expediente).</Aviso>
      )}

      <Panel sinRelleno titulo={`${numero(datos.total)} expediente${datos.total === 1 ? '' : 's'}`}
             descripcion={`Orden: mayor IUA primero. Calculado ${fechaHora(datos.calculado_en)}. Clic en una fila para ver el detalle y actuar.`}
             acciones={<div className="leyenda-semaforo">
               <Semaforo color="verde">{conteoPlazo.verde} en plazo</Semaforo><Semaforo color="amarillo">{conteoPlazo.amarillo} por vencer</Semaforo>
               <Semaforo color="rojo">{conteoPlazo.rojo} vencidos</Semaforo><Semaforo color="gris">{conteoPlazo.gris} sin plazo</Semaforo></div>}>
        {!datos.filas.length ? <Vacio texto="No hay expedientes con estos filtros." /> : (
          <div className="tabla-contenedor" style={{ maxHeight: 'calc(100vh - 360px)' }}>
            <table className="tabla" data-prueba="bandeja">
              <thead>
                <tr>
                  <th style={{ width: 6, padding: 0 }}></th><th className="num">#</th><th>Expediente</th><th>Solicitante</th><th>Trámite</th>
                  <th>Ubicación</th><th className="num">Días</th><th>Plazo TUPA</th><th className="num">IUA</th><th>Nivel</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map(x => (
                  <tr key={x.id} className="clicable" onClick={() => abrirFicha(x.id)}>
                    <td style={{ padding: 0 }}><div className={`semaforo ${x.nivel}`} style={{ height: 38 }} /></td>
                    <td className="num suave">{x.prioridad}</td>
                    <td>
                      <div className="destacado mono">{x.numero}</div>
                      <div className="suave">{x.sistema}{x.estado === 'OBSERVADO' ? ' · observado' : ''}</div>
                    </td>
                    <td>{x.solicitante || '—'}</td>
                    <td>
                      <div>{x.procedimiento}</div>
                      {x.departamento && <div className="suave">{x.departamento.replace('Departamento de ', '')}</div>}
                    </td>
                    <td>
                      <div>{x.ubicacion}</div>
                      <div className="suave">{x.dias_sin_movimiento !== null ? `${x.dias_sin_movimiento} d.h. sin movimiento` : ''}
                        {x.estancado && <span style={{ color: 'var(--medio)', fontWeight: 600 }}> · estancado</span>}</div>
                    </td>
                    <td className="num">{x.dias === null ? '—' : numero(x.dias)}</td>
                    <td>
                      <Semaforo color={colorPlazo(x).clase} titulo={colorPlazo(x).texto}>{restantes(x.dias_restantes)}</Semaforo>
                      <div className="suave">{x.plazo_tupa !== null ? `${x.plazo_tupa} d.h. · límite ${fecha(x.fecha_limite)}` : (x.origen_plazo === 'P80 OBSERVADO' ? `Ref. MTA: ${numero(x.plazo_referencia)} d.h.` : '')}</div>
                    </td>
                    <td className="num destacado">{x.iua.toFixed(3)}</td>
                    <td><Nivel nivel={x.nivel} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {datos.filas.length > TAM && (
          <div className="paginacion">
            <span>Mostrando {(pagina - 1) * TAM + 1}–{Math.min(pagina * TAM, datos.filas.length)} de {datos.filas.length}</span>
            <button className="boton pequeno" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>‹ Anterior</button>
            <button className="boton pequeno" disabled={pagina * TAM >= datos.filas.length} onClick={() => setPagina(pagina + 1)}>Siguiente ›</button>
          </div>
        )}
      </Panel>
    </>
  )
}

// Expedientes derivados a mí (o a mi departamento) que aún no firmé como recibidos
function PorRecibir() {
  const { version, abrirFicha, notificar, refrescar } = useApp()
  const { datos, recargar } = useDatos('pendientes_recepcion', {}, [version])
  const [sel, setSel] = useState(new Set())
  const { ocupado, ejecutar } = useAccion()
  if (!datos || !datos.length) return null
  const todos = datos.every(p => sel.has(p.movimiento_id))
  const recibir = async (ids) => {
    const r = await ejecutar(() => llamar('recibir', { movimiento_ids: ids }))
    if (r) { notificar(`${r.recibidos} expediente(s) recibido(s): ${fechaHora(r.recibido_en)}`, 'exito'); setSel(new Set()); recargar(); refrescar() }
    else notificar('No se pudo registrar la recepción. Actualice la pantalla.', 'error')
  }
  return (
    <Panel titulo={`Por recibir (${datos.length})`} sinRelleno
           descripcion="Le derivaron estos expedientes. Firme la recepción para dejar constancia de la fecha y hora en que los recibió."
           acciones={<div className="grupo-botones">
             <button className="boton pequeno" disabled={!sel.size || ocupado} onClick={() => recibir([...sel])}>✍ Recibir seleccionados ({sel.size})</button>
             <button className="boton exito pequeno" disabled={ocupado} onClick={() => recibir(datos.map(p => p.movimiento_id))} data-accion="recibir-todos">✍ Recibir todos</button></div>}>
      <div className="tabla-contenedor" style={{ maxHeight: 240 }}>
        <table className="tabla">
          <thead><tr><th style={{ width: 30 }}><input type="checkbox" checked={todos} aria-label="Seleccionar todos"
            onChange={() => setSel(todos ? new Set() : new Set(datos.map(p => p.movimiento_id)))} /></th>
            <th>Expediente</th><th>Trámite</th><th>Derivado por</th><th>Fecha</th><th>Indicaciones</th><th>Nivel</th></tr></thead>
          <tbody>{datos.map(p => (
            <tr key={p.movimiento_id} className="clicable" onClick={() => abrirFicha(p.expediente_id)}>
              <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={sel.has(p.movimiento_id)} onChange={() => {
                const s = new Set(sel); if (s.has(p.movimiento_id)) s.delete(p.movimiento_id); else s.add(p.movimiento_id); setSel(s) }} /></td>
              <td className="mono destacado">{p.numero}</td><td>{p.procedimiento}</td><td>{p.derivado_por || '—'}</td>
              <td className="suave">{fechaHora(p.registrado_en)}</td><td className="suave" style={{ maxWidth: 260 }}>{p.observacion || ''}</td>
              <td><Nivel nivel={p.nivel} /></td></tr>))}</tbody>
        </table>
      </div>
    </Panel>
  )
}
