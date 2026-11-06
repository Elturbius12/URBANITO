// Bandeja priorizada: el Modelo 1 (IUA) aplicado al trabajo diario.
import { useEffect, useMemo, useState } from 'react'
import { useDatos } from '../api'
import { useApp, Panel, Nivel, Cargando, ErrorCarga, Vacio, Aviso } from './Comunes'
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

      {usuario.rol === 'TECNICO' && !datos.filas.length && !f.texto && (
        <Aviso tipo="informativo">No tiene expedientes asignados. Su jefe de departamento le asigna expedientes desde su bandeja
          (botón «Derivar / asignar» en la ficha del expediente).</Aviso>
      )}

      <Panel sinRelleno titulo={`${numero(datos.total)} expediente${datos.total === 1 ? '' : 's'}`}
             descripcion={`Orden: mayor IUA primero. Calculado ${fechaHora(datos.calculado_en)}. Clic en una fila para ver el detalle y actuar.`}>
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
                      <div style={{ color: x.vencido ? 'var(--critico)' : undefined, fontWeight: x.vencido ? 600 : undefined }}>{restantes(x.dias_restantes)}</div>
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
