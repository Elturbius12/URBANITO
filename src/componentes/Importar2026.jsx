// Importar el Control de Expedientes 2026 (solo administrador).
// 1) archivo y años  2) vista previa de la conciliación (no guarda nada)  3) confirmar.
// También permite subir el documento TUPA como referencia.
import { useEffect, useState } from 'react'
import { llamar, useDatos } from '../api'
import { useApp, Panel, Aviso, Modal, Indicador, Insignia, Paginacion, Vacio, useAccion } from './Comunes'
import { numero, fecha, fechaHora } from '../formato'
import { exportarExcel } from '../exportar'

const TAM = 25
const SITUACION = {
  NUEVO: ['BAJO', 'Nuevo'], FINALIZAR: ['azul', 'Se finaliza'], REABRIR: ['MEDIO', 'Se reabre'], OMITIR: ['neutra', 'Se omite'],
}

export default function Importar2026() {
  const { notificar, refrescar, ir } = useApp()
  const [archivo, setArchivo] = useState(null)
  const [anios, setAnios] = useState(null)
  const [opc, setOpc] = useState({ reabrir_pendientes: true, incluir_incompletos: true })
  const [previa, setPrevia] = useState(null)
  const [confirmando, setConfirmando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [progreso, setProgreso] = useState(null)
  const [pag, setPag] = useState(1)
  const { ocupado, error, setError, ejecutar } = useAccion()

  useEffect(() => (window.urbanito.alProgreso ? window.urbanito.alProgreso(p => setProgreso(p)) : undefined), [])

  const elegir = async () => {
    setError(null); setPrevia(null); setResultado(null); setAnios(null)
    const r = await window.urbanito.elegirArchivoImportacion({ tipo: 'control2026' })
    if (r.cancelado) return
    if (!r.ok) return setError(r.error)
    setArchivo(r.archivos[0])
  }
  const datos = (extra = {}) => ({ archivos_ids: [archivo.id], anios: anios || undefined, ...opc, ...extra })

  const previsualizar = async () => {
    setProgreso(null)
    const r = await ejecutar(() => llamar('importar2026_previsualizar', datos()))
    setProgreso(null)
    if (r) {
      setPrevia(r); setPag(1)
      if (!anios) setAnios(r.anios_disponibles.filter(a => a.anio !== 'sin fecha').map(a => Number(a.anio)))
    }
  }
  const confirmar = async () => {
    setProgreso({ fase: 'Iniciando…', porcentaje: 0 })
    const r = await ejecutar(() => llamar('importar2026_confirmar', datos()), 'Importación del Control 2026 terminada')
    setConfirmando(false); setProgreso(null)
    if (r) { setResultado(r); setPrevia(null); refrescar() }
  }

  return (
    <>
      <Aviso tipo="informativo">
        Este importador <b>concilia</b> el Control de Expedientes 2026 con la base: los expedientes que ya existen no se duplican.
        Si el Control los da por <b>finalizados</b> (con documento de salida en los ZIP), se cierran con la fecha real de salida;
        si los da por <b>pendientes</b> y la base los había cerrado solo por inactividad, se reabren para que el modelo de asignación los considere.
        Los que no existen se crean con sistema «CONTROL_2026». Todo se puede deshacer desde «Importaciones anteriores».
      </Aviso>
      <Panel titulo="1. Archivo y años a considerar" descripcion="CONTROL_EXPEDIENTES_2026.xlsx (hojas «Control 2026», «Documentos ZIP» y «Registros incompletos»)">
        <div className="filtros">
          <button className="boton primario" onClick={elegir} disabled={ocupado} data-accion="elegir-control2026">Seleccionar archivo…</button>
          {archivo && <span className="mono">{archivo.nombre} <span className="texto-suave">({(archivo.tamano / 1048576).toFixed(2)} MB)</span></span>}
        </div>
        {archivo && !resultado && (
          <>
            {previa && (
              <div style={{ marginTop: 12 }}>
                <div className="etiqueta-campo" style={{ marginBottom: 4 }}>Años de ingreso a considerar</div>
                <div className="grupo-botones">
                  {previa.anios_disponibles.map(a => a.anio === 'sin fecha'
                    ? <span key="sf" className="texto-suave" style={{ fontSize: 12.5 }}>({numero(a.n)} sin fecha de ingreso)</span>
                    : (
                      <label key={a.anio} className="casilla"><input type="checkbox" checked={(anios || []).includes(Number(a.anio))}
                        onChange={e => { setPrevia(null); setAnios(e.target.checked ? [...(anios || []), Number(a.anio)] : (anios || []).filter(x => x !== Number(a.anio))) }} />
                        {a.anio} ({numero(a.n)})</label>))}
                </div>
              </div>
            )}
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label className="casilla"><input type="checkbox" checked={opc.reabrir_pendientes} onChange={e => { setPrevia(null); setOpc({ ...opc, reabrir_pendientes: e.target.checked }) }} />
                Reabrir los que el Control marca como pendientes y la base cerró solo por inactividad (recomendado)</label>
              <label className="casilla"><input type="checkbox" checked={opc.incluir_incompletos} onChange={e => { setPrevia(null); setOpc({ ...opc, incluir_incompletos: e.target.checked }) }} />
                Conservar los registros incompletos (se guardan marcados como «Registro incompleto» y no entran a los modelos)</label>
            </div>
            <div className="grupo-botones" style={{ marginTop: 12 }}>
              <button className="boton primario" onClick={previsualizar} disabled={ocupado || (anios && !anios.length)} data-accion="previsualizar-2026">
                {ocupado && !confirmando ? 'Analizando…' : previa ? 'Volver a analizar' : 'Analizar y ver resumen'}</button>
            </div>
          </>
        )}
        {ocupado && progreso && !confirmando && <Progreso p={progreso} />}
        {error && !confirmando && <div style={{ marginTop: 10 }}><Aviso tipo="error">{error}</Aviso></div>}
      </Panel>

      {previa && !resultado && <VistaPrevia previa={previa} pag={pag} setPag={setPag} alImportar={() => setConfirmando(true)} notificar={notificar} />}

      {resultado && (
        <Panel titulo="Importación terminada">
          <Aviso tipo="exito"><b>{resultado.mensaje}</b> {numero(resultado.incompletos)} registros incompletos conservados.
            Ahora hay <b>{numero(resultado.en_tramite_ahora)}</b> expedientes en trámite; las prioridades (IUA) y tiempos (MTA) ya se recalcularon.</Aviso>
          <div className="grupo-botones">
            <button className="boton primario" onClick={() => ir('asignaciones')}>Ir al modelo de asignación</button>
            <button className="boton" onClick={() => ir('buscar', { importacion: resultado.importacion_id })}>Ver los expedientes nuevos</button>
            <button className="boton" onClick={() => { setArchivo(null); setResultado(null) }}>Importar otro archivo</button>
          </div>
        </Panel>
      )}

      <Tupa />

      {confirmando && previa && (
        <Modal titulo="Confirmar importación del Control 2026" alCerrar={ocupado ? null : () => setConfirmando(false)}
               pie={<><button className="boton" disabled={ocupado} onClick={() => setConfirmando(false)}>Cancelar</button>
                 <button className="boton primario" disabled={ocupado} onClick={confirmar} data-accion="confirmar-2026">{ocupado ? 'Importando…' : 'Importar ahora'}</button></>}>
          <table className="tabla"><tbody>
            <tr><td>Expedientes nuevos (sistema CONTROL_2026)</td><td className="num destacado">{numero(previa.totales.nuevos)}</td></tr>
            <tr><td>Existentes que se finalizan con su documento de salida</td><td className="num">{numero(previa.totales.finalizar)}</td></tr>
            <tr><td>Existentes que se reabren como «en trámite»</td><td className="num">{numero(previa.totales.reabrir)}</td></tr>
            <tr><td>Omitidos</td><td className="num">{numero(previa.totales.omitidos)}</td></tr>
            <tr><td>Registros incompletos que se conservan</td><td className="num">{numero(previa.totales.incompletos)}</td></tr>
          </tbody></table>
          <p className="texto-suave" style={{ fontSize: 12.5, marginTop: 10 }}>Se guarda en una sola operación. Puede deshacerse mientras nadie trabaje esos expedientes en URBANITO.</p>
          {ocupado && <Progreso p={progreso} />}
          {error && <div style={{ marginTop: 10 }}><Aviso tipo="error">{error}</Aviso></div>}
        </Modal>
      )}
    </>
  )
}

function Progreso({ p }) {
  const pct = p && p.porcentaje !== undefined ? p.porcentaje : null
  return (
    <div style={{ marginTop: 10 }}>
      <div className="texto-suave" style={{ fontSize: 12.5 }}>{p?.fase || 'Procesando…'}{p?.total > 1 ? ` ${numero(p.hechos)} de ${numero(p.total)}` : ''}</div>
      <div className="barra-progreso"><div style={{ width: `${pct === null ? 100 : Math.max(3, pct)}%`, opacity: pct === null ? 0.4 : 1 }} /></div>
    </div>
  )
}

function VistaPrevia({ previa, pag, setPag, alImportar, notificar }) {
  const t = previa.totales
  const e = previa.estadisticas
  const fila = (k, x) => x ? <tr key={k}><td>{k === 'PENDIENTE' ? 'Pendientes' : 'Finalizados'}</td><td className="num">{numero(x.n)}</td><td className="num">{numero(x.minimo)}</td>
    <td className="num">{numero(x.mediana, 0)}</td><td className="num">{numero(x.maximo)}</td></tr> : null
  return (
    <>
      <Panel titulo="2. Resumen antes de confirmar" descripcion={`Todavía no se guardó nada · ${previa.nombre_archivo}`}>
        <div className="rejilla-indicadores">
          <Indicador etiqueta="Registros leídos" valor={numero(t.leidos)} nota={`${numero(t.pendientes)} pendientes · ${numero(t.finalizados)} finalizados`} />
          <Indicador etiqueta="Nuevos" valor={numero(t.nuevos)} tono="bajo" nota="No existían en la base" />
          <Indicador etiqueta="Actualizados" valor={numero(t.actualizados)} tono="medio" nota={`${numero(t.finalizar)} se finalizan · ${numero(t.reabrir)} se reabren`} />
          <Indicador etiqueta="Omitidos" valor={numero(t.omitidos)} nota={t.fuera_de_anio ? `+ ${numero(t.fuera_de_anio)} fuera de los años elegidos` : 'Ver motivos abajo'} />
          <Indicador etiqueta="Incompletos" valor={numero(t.incompletos)} nota="Se conservan marcados" />
        </div>
        <div className="dos-columnas">
          <div>
            <div className="etiqueta-campo" style={{ marginBottom: 4 }}>Días transcurridos</div>
            <table className="tabla">
              <thead><tr><th></th><th className="num">n</th><th className="num">Mín.</th><th className="num">Mediana</th><th className="num">Máx.</th></tr></thead>
              <tbody>
                <tr><td colSpan={5} className="suave">Días hábiles (calendario de URBANITO, sin feriados ni fines de semana)</td></tr>
                {fila('PENDIENTE', e.dias_habiles.PENDIENTE)}{fila('FINALIZADO', e.dias_habiles.FINALIZADO)}
                <tr><td colSpan={5} className="suave">Días calendario (columna «Días transcurridos» del Excel)</td></tr>
                {fila('PENDIENTE', e.dias_calendario_excel.PENDIENTE)}{fila('FINALIZADO', e.dias_calendario_excel.FINALIZADO)}
              </tbody>
            </table>
          </div>
          <div>
            <div className="etiqueta-campo" style={{ marginBottom: 4 }}>Motivos de omisión</div>
            {!previa.motivos_omision.length ? <p className="texto-suave">Ninguno.</p> : (
              <table className="tabla"><tbody>{previa.motivos_omision.map(m => <tr key={m.motivo}><td>{m.motivo}</td><td className="num">{numero(m.n)}</td></tr>)}</tbody></table>
            )}
            <div className="etiqueta-campo" style={{ margin: '12px 0 4px' }}>Documentos de salida (ZIP)</div>
            <p style={{ fontSize: 13 }}>{numero(previa.hojas.documentos_zip)} documentos, {numero(previa.hojas.documentos_zip_cruzados)} vinculados a filas del Control.</p>
          </div>
        </div>
        <div className="grupo-botones" style={{ marginTop: 14 }}>
          <button className="boton primario" disabled={!(t.nuevos + t.actualizados + t.incompletos)} onClick={alImportar} data-accion="importar-2026">
            Importar ({numero(t.nuevos)} nuevos, {numero(t.actualizados)} actualizados)</button>
          {previa.advertencias_total > 0 && (
            <button className="boton" onClick={() => exportarExcel(notificar, 'advertencias_control_2026', [{ nombre: 'Advertencias', titulo: 'Advertencias — Control 2026',
              subtitulo: previa.nombre_archivo, columnas: [{ titulo: 'Fila del Excel', clave: 'fila', formato: 'numero' }, { titulo: 'Expediente', clave: 'numero', ancho: 22 },
                { titulo: 'Motivo', clave: 'motivo', ancho: 90 }], filas: previa.advertencias }])}>⇩ {numero(previa.advertencias_total)} advertencias (Excel)</button>
          )}
        </div>
      </Panel>
      <div className="dos-columnas">
        <Panel titulo="Trámites más frecuentes" sinRelleno descripcion="Cómo se clasificó «Tipo de trámite» en el catálogo del TUPA">
          <table className="tabla"><tbody>{previa.tramites.map(x => <tr key={x.codigo}><td>{x.nombre}</td><td className="mono suave">{x.codigo}</td><td className="num">{numero(x.n)}</td></tr>)}</tbody></table>
        </Panel>
        <Panel titulo="Muestra" sinRelleno>
          {!previa.muestra.length ? <Vacio /> : (
            <>
              <div className="tabla-contenedor"><table className="tabla">
                <thead><tr><th>Fila</th><th>Expediente</th><th>Trámite</th><th>Control</th><th>Base</th><th>Situación</th></tr></thead>
                <tbody>{previa.muestra.slice((pag - 1) * TAM, pag * TAM).map(m => (
                  <tr key={`${m.fila}|${m.numero}`}><td className="suave">{m.fila}</td><td className="mono destacado">{m.numero}<div className="suave">{m.solicitante}</div></td>
                    <td>{m.procedimiento}<div className="suave">{fecha(m.fecha_ingreso)}</div></td>
                    <td>{m.estado_control}{m.fecha_salida && <div className="suave">salida {fecha(m.fecha_salida)}</div>}</td>
                    <td className="suave">{m.estado_base ? `${m.sistema_base}: ${m.estado_base}` : '—'}</td>
                    <td title={m.motivo || ''}><Insignia tipo={SITUACION[m.situacion][0]}>{SITUACION[m.situacion][1]}</Insignia></td></tr>))}</tbody>
              </table></div>
              <Paginacion pagina={pag} total={previa.muestra.length} tam={TAM} alCambiar={setPag} />
            </>
          )}
        </Panel>
      </div>
    </>
  )
}

function Tupa() {
  const { notificar, version } = useApp()
  const { datos, recargar } = useDatos('tupa_documentos', {}, [version])
  const { ocupado, error, setError, ejecutar } = useAccion()
  const subir = async () => {
    setError(null)
    const r = await window.urbanito.elegirArchivoImportacion({ tipo: 'tupa' })
    if (r.cancelado) return
    if (!r.ok) return setError(r.error)
    const ok = await ejecutar(() => llamar('subir_tupa', { archivos_ids: [r.archivos[0].id] }), 'Documento TUPA guardado')
    if (ok) recargar()
  }
  const descargar = async (t) => {
    try {
      const r = await llamar('descargar_tupa', { id: t.id })
      const g = await window.urbanito.guardarArchivo({ nombre: r.nombre_archivo, base64: r.base64, titulo: 'Guardar documento TUPA' })
      if (g.ok) notificar(`Guardado: ${g.ruta}`, 'exito')
      else if (!g.cancelado) notificar(g.error, 'error')
    } catch (e) { notificar(e.message, 'error') }
  }
  return (
    <Panel titulo="Documento TUPA de referencia (opcional)" descripcion="Se guarda en la base para consulta. Los plazos se editan en Configuración › Procedimientos y plazos TUPA."
           acciones={<button className="boton pequeno" disabled={ocupado} onClick={subir} data-accion="subir-tupa">↑ Subir TUPA (PDF o Excel)</button>}>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {!datos || !datos.length ? <p className="texto-suave">Todavía no se subió ningún documento TUPA.</p> : (
        <table className="tabla"><tbody>{datos.map(t => (
          <tr key={t.id}><td className="mono">{t.nombre_archivo}</td><td className="num">{numero(t.tamano / 1048576, 1)} MB</td>
            <td className="suave">{fechaHora(t.creado_en)} · {t.subido_por_nombre}</td>
            <td><button className="boton pequeno" onClick={() => descargar(t)}>Descargar</button></td></tr>))}</tbody></table>
      )}
    </Panel>
  )
}
