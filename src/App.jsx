// URBANITO — aplicación: flujo de acceso y armazón por rol.
import { useEffect, useMemo, useState, useCallback } from 'react'
import { llamar, fijarToken, alExpirarSesion, fijarDepartamentoActivo } from './api'
import { Contexto, useNotificaciones, puede, Cargando, Modal } from './componentes/Comunes'
import { ElegirModo, ConfiguracionInicial, Ingreso, CambiarClave } from './componentes/Acceso'
import Inicio from './componentes/Inicio'
import MesaPartes from './componentes/MesaPartes'
import Bandeja from './componentes/Bandeja'
import Alertas from './componentes/Alertas'
import Buscar from './componentes/Buscar'
import Departamentos from './componentes/Departamentos'
import Tablero from './componentes/Tablero'
import Modelos from './componentes/Modelos'
import Reportes from './componentes/Reportes'
import Depuracion from './componentes/Depuracion'
import Usuarios from './componentes/Usuarios'
import Configuracion from './componentes/Configuracion'
import Auditoria from './componentes/Auditoria'
import Ayuda from './componentes/Ayuda'
import Importar from './componentes/Importar'
import Ficha from './componentes/Ficha'
import Asignaciones from './componentes/Asignaciones'
import Seguimiento from './componentes/Seguimiento'
import ReporteSemanal from './componentes/ReporteSemanal'
import Campana from './componentes/Notificaciones'
import BusquedaUniversal from './componentes/BusquedaUniversal'
import { fechaLarga, capitalizar } from './formato'

const SECCIONES = [
  { clave: 'inicio', icono: '▣', etiqueta: 'Inicio', grupo: 'Gestión diaria', permiso: null,
    subtitulo: 'Su situación de hoy' },
  { clave: 'mesa', icono: '✎', etiqueta: 'Mesa de partes', grupo: 'Gestión diaria', permiso: 'registrar',
    subtitulo: 'Registro de expedientes y recepción de subsanaciones' },
  { clave: 'bandeja', icono: '☰', etiqueta: 'Bandeja priorizada', grupo: 'Gestión diaria', permiso: 'bandeja',
    subtitulo: 'Qué atender primero, según el Índice de Urgencia Administrativa (Modelo 1)' },
  { clave: 'alertas', icono: '⚠', etiqueta: 'Alertas', grupo: 'Gestión diaria', permiso: 'alertas',
    subtitulo: 'Vencidos, por vencer, estancados y observados' },
  { clave: 'buscar', icono: '⌕', etiqueta: 'Buscar expediente', grupo: 'Gestión diaria', permiso: 'consultar',
    subtitulo: 'Consulta sobre todos los expedientes, actuales e históricos' },
  { clave: 'asignaciones', icono: '⇄', etiqueta: 'Asignaciones', grupo: 'Gestión diaria',
    permiso: ['asignaciones', 'asignaciones_ver', 'mis_asignaciones'],
    subtitulo: 'Modelo de asignación óptima de expedientes a trabajadores (MILP)' },
  { clave: 'importar', icono: '↑', etiqueta: 'Importar datos', grupo: 'Gestión diaria', permiso: 'importar',
    subtitulo: 'Cargar expedientes desde Excel o CSV y el Control de Expedientes 2026' },
  { clave: 'departamentos', icono: '▤', etiqueta: 'Departamentos', grupo: 'Gestión diaria', permiso: 'departamentos',
    subtitulo: 'Los 11 departamentos y sus trámites del TUPA' },
  { clave: 'tablero', icono: '◔', etiqueta: 'Tablero gerencial', grupo: 'Análisis', permiso: 'tablero',
    subtitulo: 'Indicadores para la toma de decisiones' },
  { clave: 'seguimiento', icono: '◉', etiqueta: 'Seguimiento', grupo: 'Análisis', permiso: 'seguimiento',
    subtitulo: 'Avance de cada trabajador, sus asignaciones y reportes semanales' },
  { clave: 'modelos', icono: '∑', etiqueta: 'Modelos IUA y MTA', grupo: 'Análisis', permiso: 'modelos_ver',
    subtitulo: 'Cómo se calcula la prioridad y los tiempos reales' },
  { clave: 'reportes', icono: '⎙', etiqueta: 'Reportes', grupo: 'Análisis', permiso: 'reportes',
    subtitulo: 'Exportar a Excel y PDF' },
  { clave: 'depuracion', icono: '✓', etiqueta: 'Depurar importados', grupo: 'Administración', permiso: 'depurar',
    subtitulo: 'Cerrar expedientes del sistema anterior que ya fueron atendidos' },
  { clave: 'usuarios', icono: '☺', etiqueta: 'Usuarios', grupo: 'Administración', permiso: 'usuarios',
    subtitulo: 'Cuentas, roles y contraseñas' },
  { clave: 'configuracion', icono: '⚙', etiqueta: 'Configuración', grupo: 'Administración', permiso: 'usuarios',
    subtitulo: 'Red, respaldos, feriados, procedimientos y parámetros' },
  { clave: 'auditoria', icono: '⌚', etiqueta: 'Auditoría', grupo: 'Administración', permiso: 'usuarios',
    subtitulo: 'Registro de todo lo que se hizo en el sistema y quién lo hizo' },
  { clave: 'ayuda', icono: '?', etiqueta: 'Ayuda', grupo: 'Administración', permiso: null,
    subtitulo: 'Guía rápida para su rol' },
]
const GRUPOS = ['Gestión diaria', 'Análisis', 'Administración']

export default function App() {
  const [equipo, setEquipo] = useState(null)
  const [estado, setEstado] = useState(null)
  const [sesion, setSesion] = useState(null)
  const [error, setError] = useState(null)
  const { notificar, vista: vistaNotificaciones } = useNotificaciones()

  const cargarEstado = useCallback(async () => {
    setError(null)
    const eq = await window.urbanito.equipo()
    setEquipo(eq)
    if (!eq.modo) return
    try {
      setEstado(await llamar('estado_inicial'))
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => { cargarEstado() }, [cargarEstado])

  useEffect(() => {
    alExpirarSesion((msg) => {
      fijarToken(null)
      setSesion(null)
      notificar(msg || 'Su sesión terminó.', 'error')
    })
  }, [notificar])

  if (!equipo) return <Cargando texto="Iniciando URBANITO…" />
  if (!equipo.modo) return <>{vistaNotificaciones}<ElegirModo alListo={cargarEstado} /></>
  if (error) {
    return (
      <div className="acceso"><div className="tarjeta-acceso">
        <h1>URBANITO</h1>
        <p style={{ margin: '12px 0' }}>{error}</p>
        <div className="grupo-botones">
          <button className="boton primario" onClick={cargarEstado}>Reintentar</button>
          <button className="boton" onClick={() => window.urbanito.cambiarModo()}>Cambiar modo de esta PC</button>
        </div>
      </div></div>
    )
  }
  if (!estado) return <Cargando texto="Cargando datos…" />
  if (estado.requiere_configuracion) return <ConfiguracionInicial estado={estado} alListo={cargarEstado} />
  if (!sesion) {
    return <>{vistaNotificaciones}<Ingreso estado={estado} equipo={equipo} alIngresar={(r) => { fijarToken(r.token); setSesion(r.usuario) }} /></>
  }
  if (sesion.debe_cambiar_clave) {
    return <CambiarClave usuario={sesion} obligatorio alListo={(u) => setSesion(u)} />
  }
  return <Marco usuario={sesion} equipo={equipo} estado={estado} notificar={notificar}
                vistaNotificaciones={vistaNotificaciones} setUsuario={setSesion}
                salir={async () => { try { await llamar('logout') } catch (_) { /* ya cerrada */ } fijarToken(null); setSesion(null) }} />
}

function Marco({ usuario, equipo, estado, notificar, vistaNotificaciones, salir, setUsuario }) {
  const [seccion, setSeccion] = useState('inicio')
  const [parametros, setParametros] = useState({})
  const [version, setVersion] = useState(0)
  const [fichaId, setFichaId] = useState(null)
  const [contadores, setContadores] = useState(null)
  const [cambiandoClave, setCambiandoClave] = useState(false)
  const [reporte, setReporte] = useState(null)          // estado del reporte semanal (modal del jueves)
  const [verReporte, setVerReporte] = useState(false)
  // «Departamento activo»: solo en el estado de la interfaz ('' = todos los suyos)
  const [depActivo, setDepActivo] = useState('')
  const elegibles = usuario.departamentos_elegibles || []
  const vistaGeneral = usuario.rol === 'ADMINISTRADOR' || usuario.rol === 'GERENTE'
  const conSelector = vistaGeneral || elegibles.length > 1

  const refrescar = useCallback(() => setVersion(v => v + 1), [])
  const cambiarDepartamento = useCallback((c) => {
    fijarDepartamentoActivo(c)
    setDepActivo(c)
    setVersion(v => v + 1)
  }, [])
  useEffect(() => () => fijarDepartamentoActivo(null), [])
  const ir = useCallback((clave, params = {}) => { setParametros(params); setSeccion(clave) }, [])

  // actualización automática (otros usuarios pueden estar trabajando en red)
  useEffect(() => {
    const t = setInterval(refrescar, 60000)
    return () => clearInterval(t)
  }, [refrescar])

  useEffect(() => {
    llamar('resumen').then(setContadores).catch(() => {})
  }, [version])

  // Reporte semanal: se revisa al entrar y cada 5 minutos (el jueves a las 08:00 aparece solo)
  const revisarReporte = useCallback(() => {
    if (!puede(usuario, 'reporte_semanal') || usuario.permisos.includes('*')) return
    llamar('reporte_semanal_estado').then(setReporte).catch(() => {})
  }, [usuario])
  useEffect(() => {
    revisarReporte()
    const t = setInterval(revisarReporte, 5 * 60000)
    return () => clearInterval(t)
  }, [revisarReporte])

  const ctx = useMemo(() => ({
    usuario, equipo, estado, notificar, refrescar, version, ir, abrirFicha: setFichaId, depActivo,
  }), [usuario, equipo, estado, notificar, refrescar, version, ir, depActivo])

  const visibles = SECCIONES.filter(s => !s.permiso || puede(usuario, s.permiso))
  const actual = SECCIONES.find(s => s.clave === seccion) || SECCIONES[0]

  const pantalla = {
    inicio: <Inicio />, mesa: <MesaPartes inicial={parametros} />, bandeja: <Bandeja inicial={parametros} />, alertas: <Alertas />,
    buscar: <Buscar inicial={parametros} />, departamentos: <Departamentos />, tablero: <Tablero />,
    modelos: <Modelos />, reportes: <Reportes />, depuracion: <Depuracion />, usuarios: <Usuarios />,
    configuracion: <Configuracion />, auditoria: <Auditoria />, ayuda: <Ayuda />, importar: <Importar />,
    asignaciones: <Asignaciones />, seguimiento: <Seguimiento inicial={parametros} />,
  }[actual.clave]

  return (
    <Contexto.Provider value={ctx}>
      <div className="aplicacion">
        <nav className="barra-lateral">
          <div className="marca">
            <h1>URBANITO</h1>
            <p>{estado.institucion.area}<br />{estado.institucion.nombre}</p>
          </div>
          <div className="menu">
            {GRUPOS.map(g => {
              const items = visibles.filter(s => s.grupo === g)
              if (!items.length) return null
              return (
                <div key={g}>
                  <div className="menu-titulo">{g}</div>
                  {items.map(s => (
                    <button key={s.clave} className={`menu-opcion${seccion === s.clave ? ' activa' : ''}`}
                            onClick={() => ir(s.clave)} data-seccion={s.clave}>
                      <span className="icono">{s.icono}</span>
                      <span>{s.etiqueta}</span>
                      {s.clave === 'bandeja' && contadores?.en_tramite !== undefined && <span className="contador">{contadores.en_tramite}</span>}
                      {s.clave === 'alertas' && contadores?.vencidos > 0 && <span className="contador alarma">{contadores.vencidos}</span>}
                      {s.clave === 'mesa' && contadores?.observados_total > 0 && <span className="contador">{contadores.observados_total}</span>}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
          <div className="usuario-lateral">
            <div className="nombre">{usuario.nombre_completo}</div>
            <div className="rol">{usuario.rol_nombre}{usuario.departamento_nombre ? ` · ${usuario.departamento_nombre.replace('Departamento de ', '')}` : ''}{(usuario.departamentos || []).length > 1 ? ` (+${usuario.departamentos.length - 1})` : ''}</div>
            <div className="botones">
              <button onClick={() => setCambiandoClave(true)}>Contraseña</button>
              <button onClick={salir} data-accion="salir">Salir</button>
            </div>
          </div>
        </nav>

        <main className="contenido">
          <header className="cabecera">
            <div>
              <h2>{actual.etiqueta}</h2>
              <div className="subtitulo">{actual.subtitulo}</div>
            </div>
            <div className="derecha">
              {puede(usuario, 'consultar') && <BusquedaUniversal />}
              {conSelector && (
                <label className="selector-departamento" title="Filtra la bandeja, alertas, tablero, importación y reportes">
                  <span>Departamento activo</span>
                  <select className="control" value={depActivo} onChange={e => cambiarDepartamento(e.target.value)} data-campo="departamento-activo">
                    <option value="">{vistaGeneral ? 'Todos' : 'Todos mis departamentos'}</option>
                    {elegibles.map(d => <option key={d.codigo} value={d.codigo}>{d.nombre.replace(/^Departamento de /, '')}</option>)}
                  </select>
                </label>
              )}
              <span>{contadores ? capitalizar(fechaLarga(contadores.hoy)) : ''}</span>
              <span className="chip-modo">{equipo.modo === 'cliente' ? 'Conectado en red' : 'PC servidor'}</span>
              <Campana alAbrirReporte={() => { revisarReporte(); setVerReporte(true) }} />
            </div>
          </header>
          <div className="cuerpo" key={`${actual.clave}|${depActivo}`}>{pantalla}</div>
        </main>
      </div>

      {fichaId && <Ficha id={fichaId} alCerrar={() => setFichaId(null)} />}
      {reporte && reporte.aplica && (reporte.requerido || (verReporte && !reporte.lleno)) && (
        <ReporteSemanal estado={reporte} alCerrar={() => setVerReporte(false)}
                        alEnviar={() => { setVerReporte(false); revisarReporte(); refrescar() }} />
      )}
      {cambiandoClave && (
        <Modal titulo="Cambiar mi contraseña" alCerrar={() => setCambiandoClave(false)}>
          <CambiarClave usuario={usuario} alCancelar={() => setCambiandoClave(false)}
                        alListo={(u) => { setUsuario(u); setCambiandoClave(false); notificar('Contraseña actualizada', 'exito') }} />
        </Modal>
      )}
      {vistaNotificaciones}
    </Contexto.Provider>
  )
}
