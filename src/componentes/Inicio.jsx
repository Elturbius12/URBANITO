// Inicio: lo primero que ve cada usuario, según su rol.
import { useDatos } from '../api'
import { useApp, Indicador, Panel, Nivel, Cargando, ErrorCarga, Aviso, puede, Vacio } from './Comunes'
import { numero, fecha, restantes, fechaHora } from '../formato'

export default function Inicio() {
  const { usuario, version, ir, abrirFicha } = useApp()
  const { datos: r, error, recargar } = useDatos('resumen', {}, [version])
  if (error) return <ErrorCarga error={error} reintentar={recargar} />
  if (!r) return <Cargando />

  const saludo = (() => {
    const h = new Date().getHours()
    return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'
  })()

  return (
    <>
      <h3 style={{ marginBottom: 12, fontSize: 17 }}>{saludo}, {usuario.nombre_completo.split(' ')[0]}.</h3>

      {usuario.rol === 'MESA_PARTES' ? (
        <>
          <div className="rejilla-indicadores">
            <Indicador etiqueta="Registrados hoy" valor={numero(r.registrados_hoy)} onClick={() => ir('mesa')} />
            <Indicador etiqueta="Observados (esperan subsanación)" valor={numero(r.observados_total)} tono={r.observados_total ? 'alto' : ''}
                       nota="El ciudadano debe traer lo observado" onClick={() => ir('mesa')} />
            <Indicador etiqueta="Mis acciones hoy" valor={numero(r.mis_acciones_hoy)} />
          </div>
          <Panel titulo="¿Qué desea hacer?">
            <div className="grupo-botones">
              <button className="boton primario grande" onClick={() => ir('mesa', { pestana: 'nuevo' })}>✎ Registrar un expediente nuevo</button>
              <button className="boton grande" onClick={() => ir('mesa', { pestana: 'observados' })}>Recibir una subsanación</button>
              <button className="boton grande" onClick={() => ir('buscar')}>Consultar el estado de un expediente</button>
            </div>
          </Panel>
        </>
      ) : (
        <>
          <div className="rejilla-indicadores">
            <Indicador etiqueta={alcanceTexto(usuario)} valor={numero(r.en_tramite)} onClick={() => ir('bandeja')} />
            <Indicador etiqueta="Críticos — atender hoy" valor={numero(r.niveles?.['CRÍTICO'])} tono="critico" onClick={() => ir('bandeja', { nivel: 'CRÍTICO' })} />
            <Indicador etiqueta="Plazo TUPA vencido" valor={numero(r.vencidos)} tono="critico" onClick={() => ir('alertas')} />
            <Indicador etiqueta={`Vencen en ≤ ${r.dias_alerta || 5} días`} valor={numero(r.por_vencer)} tono="alto" onClick={() => ir('alertas')} />
            <Indicador etiqueta="Estancados" valor={numero(r.estancados)} tono="medio"
                       nota="Más tiempo sin movimiento que el 80% histórico de su ubicación" onClick={() => ir('alertas')} />
            <Indicador etiqueta="Observados" valor={numero(r.observados)} nota="Plazo suspendido" />
          </div>

          {r.importados_en_tramite > 0 && puede(usuario, 'depurar') && (
            <Aviso tipo="informativo">
              {numero(r.importados_en_tramite)} de estos expedientes vienen del sistema anterior y figuraban en trámite al
              {' '}{fecha(r.fecha_corte_importacion)} (fecha de corte de los datos importados). Algunos pueden haberse atendido sin que se
              registrara el cierre.{r.sin_tramite > 0 && <> Además, <b>{numero(r.sin_tramite)}</b> no tienen el trámite anotado en el sistema anterior:
              sin trámite no se conoce su plazo legal, por eso su IUA se calcula sin el factor de urgencia temporal.</>}
              <button className="boton pequeno" style={{ marginLeft: 6 }} onClick={() => ir('depuracion')}>Revisarlos</button>
            </Aviso>
          )}

          <Panel titulo="Lo más urgente" sinRelleno
                 descripcion="Ordenado por el Índice de Urgencia Administrativa (IUA). Haga clic para abrir el expediente."
                 acciones={<button className="boton pequeno" onClick={() => ir('bandeja')}>Ver bandeja completa</button>}>
            {!r.top?.length ? <Vacio texto="No tiene expedientes en trámite." /> : (
              <table className="tabla">
                <thead><tr><th>#</th><th>Expediente</th><th>Solicitante</th><th>Trámite</th><th>Plazo</th><th className="num">IUA</th><th>Nivel</th></tr></thead>
                <tbody>
                  {r.top.map(f => (
                    <tr key={f.id} className="clicable" onClick={() => abrirFicha(f.id)}>
                      <td className="suave">{f.prioridad}</td>
                      <td className="destacado mono">{f.numero}</td>
                      <td>{f.solicitante || '—'}</td>
                      <td>{f.procedimiento}</td>
                      <td style={{ color: f.vencido ? 'var(--critico)' : undefined }}>{restantes(f.dias_restantes)}</td>
                      <td className="num destacado">{f.iua.toFixed(3)}</td>
                      <td><Nivel nivel={f.nivel} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <p className="texto-tenue" style={{ fontSize: 11.5 }}>Modelos recalculados: {fechaHora(r.calculado_en)}. Se recalculan solos con cada registro, derivación o cierre.</p>
        </>
      )}
    </>
  )
}

function alcanceTexto(u) {
  if (u.rol === 'TECNICO') return 'Asignados a mí'
  if (u.rol === 'JEFE_DEPARTAMENTO') return 'En trámite en mi departamento'
  return 'En trámite (todos)'
}
