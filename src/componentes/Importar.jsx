// Importar expedientes desde Excel o CSV, en 4 pasos:
// 1) departamento y plantilla, 2) archivo, 3) vista previa (no guarda nada), 4) confirmar.
// El archivo lo lee el navegador y viaja en base64; el núcleo (en el servidor)
// vuelve a validarlo todo al confirmar.
import { useEffect, useState } from 'react'
import { llamar, useDatos } from '../api'
import { useApp, Panel, Cargando, ErrorCarga, Aviso, Modal, Campo, Insignia, Indicador, Paginacion, Vacio, Pestanas, useAccion } from './Comunes'
import Importar2026 from './Importar2026'
import { numero, fecha, fechaHora } from '../formato'
import { exportarExcel } from '../exportar'
import { elegirArchivoImportacion, paraEnviar, descargarBase64 } from '../archivos'

const TAM_MUESTRA = 20
const TAM_ERRORES = 50

// Evita que una celda exportada se interprete como fórmula al abrirla en Excel
export const neutralizar = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v)

export async function descargarPlantilla(notificar, departamento) {
  try {
    const r = await llamar('plantilla_importacion', { departamento: departamento || undefined })
    descargarBase64(r.nombre_archivo, r.base64)
    notificar(`Plantilla descargada: ${r.nombre_archivo}`, 'exito')
  } catch (e) {
    notificar(e.message, 'error')
  }
}

// Pestañas: plantilla / consolidado (todos los que importan) y Control 2026 (administrador)
export default function Importar() {
  const { usuario } = useApp()
  const admin = usuario.rol === 'ADMINISTRADOR'
  const [pestana, setPestana] = useState('plantilla')
  if (!admin) return <ImportarPlantilla />
  return (
    <>
      <Pestanas activa={pestana} alCambiar={setPestana} opciones={[
        { clave: 'plantilla', etiqueta: 'Plantilla o consolidado' },
        { clave: 'control2026', etiqueta: 'Control de Expedientes 2026' },
      ]} />
      {pestana === 'plantilla' ? <ImportarPlantilla /> : <Importar2026 />}
    </>
  )
}

function ImportarPlantilla() {
  const { usuario, notificar, refrescar, ir, depActivo } = useApp()
  const { datos: deps, error: errDeps, recargar: recDeps } = useDatos('importar_departamentos', {})
  const [departamento, setDepartamento] = useState(depActivo || '')
  const [archivos, setArchivos] = useState(null)
  const [modo, setModo] = useState('omitir')
  const [previa, setPrevia] = useState(null)
  const [confirmando, setConfirmando] = useState(false)
  const [progreso, setProgreso] = useState(null)
  const [resultado, setResultado] = useState(null)
  const [verHistorial, setVerHistorial] = useState(0)
  const { ocupado, error, setError, ejecutar } = useAccion()

  // un jefe con un solo departamento lo tiene elegido de entrada
  useEffect(() => {
    if (deps && deps.length === 1 && !departamento) setDepartamento(deps[0].codigo)
  }, [deps, departamento])

  if (errDeps) return <ErrorCarga error={errDeps} reintentar={recDeps} />
  if (!deps) return <Cargando />
  const libre = ['ADMINISTRADOR', 'GERENTE', 'MESA_PARTES'].includes(usuario.rol)
  const nombreDep = (deps.find(d => d.codigo === departamento) || {}).nombre
  const paso = resultado ? 4 : previa ? 3 : archivos ? 2 : 1

  const reiniciar = () => { setArchivos(null); setPrevia(null); setResultado(null); setError(null); setProgreso(null) }

  const elegir = async () => {
    setError(null); setPrevia(null); setResultado(null)
    const r = await elegirArchivoImportacion('general')
    if (r.cancelado) return
    if (!r.ok) return setError(r.error)
    setArchivos(r.archivos)
  }

  const previsualizar = async () => {
    setProgreso({ fase: 'Procesando…' })
    const r = await ejecutar(() => llamar('importar_previsualizar', {
      departamento: departamento || undefined, archivos: paraEnviar(archivos), modo_duplicados: modo }))
    setProgreso(null)
    if (r) setPrevia(r)
  }

  const confirmar = async () => {
    setProgreso({ fase: 'Importando…' })
    const r = await ejecutar(() => llamar('importar_confirmar', {
      departamento: departamento || undefined, archivos: paraEnviar(archivos), modo_duplicados: modo,
      solo_validas: previa.totales.filas_con_error > 0 }), 'Importación terminada')
    setConfirmando(false)
    setProgreso(null)
    if (r) { setResultado(r); refrescar(); setVerHistorial(v => v + 1) }
  }

  const descargarErrores = () => exportarExcel(notificar, `errores_importacion_${previa.nombre_archivo.replace(/\.[a-z]+$/i, '')}`, [{
    nombre: 'Errores', titulo: 'Filas con error — importación de expedientes',
    subtitulo: `${previa.nombre_archivo} · ${numero(previa.totales.filas_con_error)} filas con error`,
    columnas: [{ titulo: 'Hoja / archivo', clave: 'hoja', ancho: 18 }, { titulo: 'Fila del Excel', clave: 'fila', formato: 'numero', ancho: 10 },
               { titulo: 'N° expediente', clave: 'numero', ancho: 18 }, { titulo: 'Columna', clave: 'columna', ancho: 22 },
               { titulo: 'Motivo', clave: 'motivo', ancho: 90 }],
    filas: previa.errores.map(e => ({ hoja: neutralizar(e.hoja), fila: e.fila, numero: neutralizar(e.numero || ''),
                                      columna: neutralizar(e.columna), motivo: neutralizar(e.motivo) })),
  }])

  return (
    <>
      <div className="pasos-importar">
        {[['1. Departamento y plantilla', 'Elija el departamento y descargue la plantilla'], ['2. Archivo', 'Excel (.xlsx) o CSV, hasta 50 MB'],
          ['3. Vista previa', 'Se valida todo sin guardar nada'], ['4. Importar', 'Confirmación y resumen']].map(([t, d], i) => (
          <div key={t} className={`paso-i${paso === i + 1 ? ' activo' : ''}${paso > i + 1 ? ' hecho' : ''}`}><b>{t}</b>{d}</div>
        ))}
      </div>

      <Panel titulo="1. Departamento y plantilla" descripcion="La plantilla trae las listas de procedimientos, destinos y estados vigentes">
        <div className="filtros">
          <select className="control" value={departamento} onChange={e => { setDepartamento(e.target.value); setPrevia(null) }}
                  disabled={!!resultado} data-campo="departamento-importar">
            {(libre || deps.length > 1) && <option value="">{libre ? 'Todos los departamentos' : 'Todos mis departamentos'}</option>}
            {deps.map(d => <option key={d.codigo} value={d.codigo}>{d.nombre}</option>)}
          </select>
          <button className="boton" onClick={() => descargarPlantilla(notificar, departamento)} data-accion="descargar-plantilla">
            ⇩ Descargar plantilla{nombreDep ? ` de ${nombreDep.replace(/^Departamento de /, '')}` : ''}
          </button>
        </div>
        {!libre && <p className="texto-suave" style={{ fontSize: 12.5, marginTop: 8 }}>
          Solo se importan trámites de {nombreDep || 'sus departamentos'}. Las filas con procedimientos de otro departamento se rechazan.</p>}
      </Panel>

      <Panel titulo="2. Archivo" descripcion="Plantilla de URBANITO (hojas EXPEDIENTES y MOVIMIENTOS), dos CSV con esos encabezados, o el consolidado SGCUC/SGAU">
        <div className="filtros">
          <button className="boton primario" onClick={elegir} disabled={ocupado || !!resultado} data-accion="elegir-archivo">Seleccionar archivo…</button>
          {archivos && archivos.map(a => <span key={a.nombre} className="mono">{a.nombre} <span className="texto-suave">({(a.tamano / 1048576).toFixed(2)} MB)</span></span>)}
        </div>
        {archivos && !resultado && (
          <>
            <div style={{ marginTop: 12 }}>
              <div className="texto-suave" style={{ fontSize: 12.5, marginBottom: 4 }}>Si el expediente ya existe en URBANITO:</div>
              <label className="casilla"><input type="radio" checked={modo === 'omitir'} onChange={() => { setModo('omitir'); setPrevia(null) }} /> Omitirlo (recomendado)</label>
              <label className="casilla"><input type="radio" checked={modo === 'actualizar'} onChange={() => { setModo('actualizar'); setPrevia(null) }} />
                Actualizarlo, solo si también fue importado y nadie lo trabajó en URBANITO (nunca se tocan los de Mesa de partes)</label>
            </div>
            <div className="grupo-botones" style={{ marginTop: 12 }}>
              <button className="boton primario" onClick={previsualizar} disabled={ocupado} data-accion="previsualizar">
                {ocupado && !confirmando ? 'Validando…' : 'Validar y ver vista previa'}</button>
              <button className="boton" onClick={reiniciar} disabled={ocupado}>Cambiar archivo</button>
            </div>
          </>
        )}
        {ocupado && progreso && !confirmando && <Progreso p={progreso} />}
        {error && !confirmando && <div style={{ marginTop: 10 }}><Aviso tipo="error">{error}</Aviso></div>}
      </Panel>

      {previa && !resultado && <VistaPrevia previa={previa} descargarErrores={descargarErrores}
                                            alImportar={() => setConfirmando(true)} alCancelar={reiniciar} />}

      {resultado && (
        <Panel titulo="4. Importación terminada">
          <Aviso tipo="exito">
            Se crearon <b>{numero(resultado.expedientes_creados)}</b> expedientes y <b>{numero(resultado.movimientos_creados)}</b> movimientos
            {resultado.expedientes_actualizados ? <>, se actualizaron <b>{numero(resultado.expedientes_actualizados)}</b></> : null}
            {' '}y se omitieron <b>{numero(resultado.expedientes_omitidos)}</b> que ya existían.
            {resultado.filas_con_error ? <> Se descartaron {numero(resultado.filas_con_error)} filas con error.</> : null}
            {' '}Las prioridades (IUA) y los tiempos (MTA) ya se recalcularon.
          </Aviso>
          <div className="grupo-botones">
            <button className="boton primario" onClick={() => ir('buscar', { importacion: resultado.importacion_id })} data-accion="ver-importados">
              Ver los expedientes importados en «Buscar»</button>
            <button className="boton" onClick={reiniciar}>Importar otro archivo</button>
          </div>
        </Panel>
      )}

      <Historial version={verHistorial} />

      {confirmando && (
        <Modal titulo="Confirmar importación" alCerrar={ocupado ? null : () => setConfirmando(false)}
               pie={<><button className="boton" disabled={ocupado} onClick={() => setConfirmando(false)}>Cancelar</button>
                 <button className="boton primario" disabled={ocupado} onClick={confirmar} data-accion="confirmar-importacion">
                   {ocupado ? 'Importando…' : 'Importar ahora'}</button></>}>
          <p>Archivo: <b className="mono">{previa.nombre_archivo}</b>{previa.departamento_nombre ? <> · {previa.departamento_nombre}</> : null}</p>
          <table className="tabla" style={{ margin: '10px 0' }}><tbody>
            <tr><td>Expedientes nuevos que se crearán</td><td className="num destacado">{numero(previa.totales.nuevos)}</td></tr>
            {modo === 'actualizar' && <tr><td>Expedientes importados antes que se actualizarán</td><td className="num">{numero(previa.totales.actualizables)}</td></tr>}
            <tr><td>Ya existentes que se omitirán</td><td className="num">{numero(previa.totales.duplicados - previa.totales.actualizables)}</td></tr>
            <tr><td>Movimientos</td><td className="num">{numero(previa.totales.movimientos)}</td></tr>
            {previa.totales.filas_con_error > 0 && <tr><td>Filas con error que NO se importarán</td><td className="num">{numero(previa.totales.filas_con_error)}</td></tr>}
          </tbody></table>
          <p className="texto-suave" style={{ fontSize: 12.5 }}>Todo se guarda en una sola operación: si algo falla, no queda nada a medias.
            Podrá deshacer este lote desde «Importaciones anteriores» mientras nadie trabaje sobre esos expedientes.</p>
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

function VistaPrevia({ previa, descargarErrores, alImportar, alCancelar }) {
  const [pagM, setPagM] = useState(1)
  const [pagE, setPagE] = useState(1)
  const [verAdv, setVerAdv] = useState(false)
  const t = previa.totales
  const hayErrores = t.filas_con_error > 0
  const importables = t.nuevos + t.actualizables

  return (
    <>
      <Panel titulo="3. Vista previa" descripcion={`Todavía no se guardó nada · fecha de corte del archivo: ${fecha(previa.fecha_corte)}`}>
        {previa.aviso_formato && <Aviso tipo="informativo">{previa.aviso_formato}</Aviso>}
        <div className="rejilla-indicadores">
          <Indicador etiqueta="Filas leídas" valor={numero(t.filas_leidas)} />
          <Indicador etiqueta="Expedientes únicos" valor={numero(t.expedientes_unicos)} />
          <Indicador etiqueta="Movimientos" valor={numero(t.movimientos)} />
          <Indicador etiqueta="Expedientes nuevos" valor={numero(t.nuevos)} tono="bajo" />
          <Indicador etiqueta="Ya existentes" valor={numero(t.duplicados)} nota={t.actualizables ? `${numero(t.actualizables)} se actualizarán` : 'se omiten'} />
          <Indicador etiqueta="Filas con error" valor={numero(t.filas_con_error)} tono={hayErrores ? 'critico' : ''}
                     nota={hayErrores ? `${numero(t.expedientes_con_error)} expedientes excluidos` : 'ninguna'} />
        </div>
        {t.advertencias > 0 && (
          <Aviso tipo="advertencia">{numero(t.advertencias)} advertencia(s): se importan igual, pero conviene revisarlas.{' '}
            <button className="boton pequeno" onClick={() => setVerAdv(!verAdv)}>{verAdv ? 'Ocultar' : 'Ver advertencias'}</button></Aviso>
        )}
        {verAdv && <TablaErrores filas={previa.advertencias.slice(0, 500)} />}
        <div className="grupo-botones" style={{ marginTop: 12 }}>
          {hayErrores ? (
            <>
              <button className="boton primario" disabled={!importables} onClick={alImportar} data-accion="importar-validas">
                Importar solo las filas válidas ({numero(importables)} expedientes)</button>
              <button className="boton" onClick={alCancelar}>Cancelar y corregir</button>
            </>
          ) : (
            <>
              <button className="boton primario" onClick={alImportar} data-accion="importar">
                {importables ? `Importar ${numero(importables)} expedientes` : 'Registrar la importación (no hay expedientes nuevos)'}</button>
              <button className="boton" onClick={alCancelar}>Cancelar</button>
            </>
          )}
        </div>
      </Panel>

      <Panel titulo="Primeras filas válidas" descripcion="Hasta 100 expedientes, con la situación que tendrán al importar" sinRelleno>
        {!previa.muestra.length ? <Vacio texto="No hay filas válidas" /> : (
          <>
            <div className="tabla-contenedor"><table className="tabla">
              <thead><tr><th>Fila</th><th>Expediente</th><th>Solicitante</th><th>Trámite</th><th>Ingreso</th><th>Estado</th><th className="num">Movs.</th><th>Situación</th></tr></thead>
              <tbody>{previa.muestra.slice((pagM - 1) * TAM_MUESTRA, pagM * TAM_MUESTRA).map(m => (
                <tr key={`${m.hoja}|${m.fila}|${m.numero}`}>
                  <td className="suave">{m.fila}</td><td className="mono destacado">{m.numero}</td><td>{m.solicitante || '—'}</td>
                  <td>{m.procedimiento}</td><td>{fecha(m.fecha_ingreso)}</td><td>{m.estado_nombre}</td><td className="num">{m.movimientos}</td>
                  <td>{m.situacion === 'NUEVO' ? <Insignia tipo="BAJO">Nuevo</Insignia> : m.situacion === 'ACTUALIZAR'
                    ? <Insignia tipo="MEDIO">Se actualiza</Insignia> : <span title={m.motivo}><Insignia>Se omite</Insignia></span>}</td>
                </tr>))}</tbody>
            </table></div>
            <Paginacion pagina={pagM} total={previa.muestra.length} tam={TAM_MUESTRA} alCambiar={setPagM} />
          </>
        )}
      </Panel>

      {hayErrores && (
        <Panel titulo={`Filas con error (${numero(t.filas_con_error)})`}
               descripcion={previa.errores_truncados ? `Se muestran los primeros ${numero(previa.errores.length)} errores` : 'Corrija estas filas en su archivo y vuelva a validarlo'}
               acciones={<button className="boton pequeno" onClick={descargarErrores} data-accion="descargar-errores">⇩ Descargar errores en Excel</button>} sinRelleno>
          <TablaErrores filas={previa.errores.slice((pagE - 1) * TAM_ERRORES, pagE * TAM_ERRORES)} />
          <Paginacion pagina={pagE} total={previa.errores.length} tam={TAM_ERRORES} alCambiar={setPagE} />
        </Panel>
      )}
    </>
  )
}

function TablaErrores({ filas }) {
  return (
    <div className="tabla-contenedor"><table className="tabla">
      <thead><tr><th>Hoja</th><th>Fila del Excel</th><th>Expediente</th><th>Columna</th><th>Motivo</th></tr></thead>
      <tbody>{filas.map((e, i) => (
        <tr key={i}><td className="suave">{e.hoja}</td><td className="num">{e.fila}</td><td className="mono">{e.numero || '—'}</td>
          <td>{e.columna}</td><td>{e.motivo}</td></tr>))}</tbody>
    </table></div>
  )
}

function Historial({ version }) {
  const { notificar, refrescar } = useApp()
  const { datos, error, recargar } = useDatos('importaciones', {}, [version])
  const { ejecutar } = useAccion()
  if (error) return <ErrorCarga error={error} reintentar={recargar} />
  if (!datos) return null

  const deshacer = async (l) => {
    if (!window.confirm(`¿Deshacer la importación N° ${l.id} (${l.nombre_archivo})?\n\nSe borrarán los ${l.expedientes_creados} expedientes y ${l.movimientos_creados} movimientos que creó${l.expedientes_actualizados ? `, y se restaurarán ${l.expedientes_actualizados} expedientes actualizados` : ''}. Esta acción queda en la auditoría.`)) return
    const r = await ejecutar(() => llamar('importar_deshacer', { id: l.id }))
    if (r) { notificar(`Importación deshecha: ${r.expedientes_borrados} expedientes borrados`, 'exito'); recargar(); refrescar() }
    else notificar('No se pudo deshacer la importación. Vea el motivo en pantalla.', 'error')
  }

  return (
    <Panel titulo="Importaciones anteriores" sinRelleno>
      {!datos.length ? <Vacio texto="Todavía no hay importaciones" /> : (
        <div className="tabla-contenedor"><table className="tabla">
          <thead><tr><th>N°</th><th>Fecha</th><th>Usuario</th><th>Departamento</th><th>Archivo</th><th className="num">Filas</th>
            <th className="num">Creados</th><th className="num">Omitidos</th><th className="num">Movs.</th><th className="num">Errores</th><th>Estado</th><th></th></tr></thead>
          <tbody>{datos.map(l => (
            <tr key={l.id}>
              <td className="mono">{l.id}</td><td className="suave">{fechaHora(l.fecha_hora)}</td><td>{l.usuario}</td><td>{l.departamento}</td>
              <td className="mono">{l.nombre_archivo}</td><td className="num">{numero(l.filas_leidas)}</td><td className="num">{numero(l.expedientes_creados)}</td>
              <td className="num">{numero(l.expedientes_omitidos)}</td><td className="num">{numero(l.movimientos_creados)}</td><td className="num">{numero(l.errores)}</td>
              <td>{l.estado === 'DESHECHO' ? <Insignia>Deshecha</Insignia> : <Insignia tipo="BAJO">Completada</Insignia>}</td>
              <td>{l.puede_deshacer && <button className="boton pequeno" onClick={() => deshacer(l)} data-accion="deshacer-importacion">Deshacer importación</button>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </Panel>
  )
}
