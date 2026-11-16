// Punto único de entrada: la interfaz (local o desde otra PC de la red)
// pide una acción por nombre; aquí se valida la sesión y se ejecuta.

const { ErrorUsuario } = require('./sistema')

// Acciones que no requieren sesión
const PUBLICAS = {
  estado_inicial: (s) => s.estadoInicial(),
  configuracion_inicial: (s, d) => s.configuracionInicial(d || {}),
  login: (s, d) => s.login((d || {}).usuario, (d || {}).clave),
  ping: () => ({ ok: true, servicio: 'URBANITO' }),
  // portal ciudadano (llevan su propio token de portal en los datos, distinto al de los trabajadores)
  portal_ingresar: (s, d) => s.portalIngresar(d || {}),
  portal_cambiar_clave: (s, d) => s.portalCambiarClave(d || {}),
  portal_mis_tramites: (s, d) => s.portalMisTramites(d || {}),
  portal_consulta_dni: (s, d) => s.portalConsultaDni(d || {}),
  portal_salir: (s, d) => s.portalSalir(d || {}),
}

// Acciones con sesión: (sistema, usuario, datos, token)
const PRIVADAS = {
  sesion: (s, u) => s.usuarioPublico(u),
  logout: (s, u, d, token) => s.logout(token, u),
  cambiar_clave: (s, u, d) => s.cambiarClave(u, d),

  resumen: (s, u) => s.resumen(u),
  catalogos: (s, u) => s.catalogos(u),
  bandeja: (s, u, d) => s.bandeja(u, d),
  alertas: (s, u) => s.alertas(u),
  buscar: (s, u, d) => s.buscar(u, d),
  ficha: (s, u, d) => s.ficha(u, d.id),
  constancia: (s, u, d) => { s.exigir(u, 'consultar'); return s.constancia(d.id) },
  estimacion: (s, u, d) => { s.exigir(u, 'consultar'); return s.estimacion(d.procedimiento_codigo, d.fecha) },
  departamentos: (s, u) => s.departamentosResumen(u),
  tablero: (s, u, d) => s.tablero(u, d),
  modelos: (s, u) => s.modelos(u),
  mesa_partes: (s, u) => s.mesaPartes(u),
  importados_en_tramite: (s, u, d) => s.importadosEnTramite(u, d),
  exportar_busqueda: (s, u, d) => s.exportarBusqueda(u, d),
  productividad: (s, u, d) => s.productividad(u, d),

  registrar_expediente: (s, u, d) => s.registrarExpediente(u, d),
  derivar: (s, u, d) => s.derivar(u, d.id, d),
  observar: (s, u, d) => s.observar(u, d.id, d),
  subsanar: (s, u, d) => s.subsanar(u, d.id, d),
  finalizar: (s, u, d) => s.finalizar(u, d.id, d),
  archivar: (s, u, d) => s.archivar(u, d.id, d),
  reabrir: (s, u, d) => s.reabrir(u, d.id, d),
  corregir: (s, u, d) => s.corregir(u, d.id, d),
  depurar_importados: (s, u, d) => s.depurarImportados(u, d),

  simular_ahp: (s, u, d) => s.simularAhp(u, d),
  guardar_ahp: (s, u, d) => s.guardarAhp(u, d),
  guardar_parametros: (s, u, d) => s.guardarParametros(u, d),

  usuarios: (s, u) => s.listarUsuarios(u),
  crear_usuario: (s, u, d) => s.crearUsuario(u, d),
  editar_usuario: (s, u, d) => s.editarUsuario(u, d.id, d),
  restablecer_clave: (s, u, d) => s.restablecerClave(u, d.id),
  alias_historicos: (s, u) => s.aliasHistoricos(u),
  crear_usuarios_departamento: (s, u) => s.crearUsuariosPorDepartamento(u),

  importar_departamentos: (s, u) => s.departamentosImportacion(u),
  importar_previsualizar: (s, u, d, token, ctx) => s.importarPrevisualizar(u, d, { progreso: ctx.progreso }),
  importar_confirmar: (s, u, d, token, ctx) => s.importarConfirmar(u, d, { progreso: ctx.progreso }),
  importaciones: (s, u) => s.listarImportaciones(u),
  importar_deshacer: (s, u, d) => s.importarDeshacer(u, d),
  plantilla_importacion: (s, u, d) => s.plantillaImportacion(u, d),

  procedimientos: (s, u) => s.listarProcedimientos(u),
  editar_procedimiento: (s, u, d) => s.editarProcedimiento(u, d.codigo, d),
  feriados: (s, u, d) => s.listarFeriados(u, (d || {}).anio),
  agregar_feriado: (s, u, d) => s.agregarFeriado(u, d),
  eliminar_feriado: (s, u, d) => s.eliminarFeriado(u, d),

  respaldos: (s, u) => s.listarRespaldos(u),
  crear_respaldo: (s, u) => s.crearRespaldo(u),
  auditoria: (s, u, d) => s.auditoria(u, d),

  // ---- v2: importación del Control de Expedientes 2026 y documento TUPA
  importar2026_previsualizar: (s, u, d, token, ctx) => s.importar2026Previsualizar(u, d, { progreso: ctx.progreso }),
  importar2026_confirmar: (s, u, d, token, ctx) => s.importar2026Confirmar(u, d, { progreso: ctx.progreso }),
  subir_tupa: (s, u, d) => s.tupaSubir(u, d),
  tupa_documentos: (s, u) => s.tupaListar(u),
  descargar_tupa: (s, u, d) => s.tupaDescargar(u, d),

  // ---- v2: Modelo 3 (asignación óptima MILP) y seguimiento
  asignacion_ejecutar: (s, u, d) => s.asignacionEjecutar(u, d),
  asignacion_confirmar: (s, u, d) => s.asignacionConfirmar(u, d),
  asignaciones: (s, u, d) => s.asignacionesListar(u, d),
  asignacion_actualizar: (s, u, d) => s.asignacionActualizar(u, d),
  eficiencia: (s, u, d) => s.eficienciaListar(u, d),
  seguimiento: (s, u, d) => s.seguimiento(u, d),
  actividad_usuarios: (s, u, d) => s.actividadUsuarios(u, d),

  // ---- v2: notificaciones y reportes semanales
  notificaciones: (s, u, d) => s.notificacionesListar(u, d),
  notificaciones_nuevas: (s, u, d) => s.notificacionesNuevas(u, d),
  notificacion_leida: (s, u, d) => s.notificacionMarcarLeida(u, d),
  al_abrir: (s, u) => s.notificacionesAlAbrir(u),
  reporte_semanal_estado: (s, u) => s.reporteSemanalEstado(u),
  reporte_semanal_enviar: (s, u, d) => s.reporteSemanalEnviar(u, d),
  reportes_consolidado: (s, u, d) => s.reportesConsolidado(u, d),

  // ---- v2: mejoras
  pendientes_recepcion: (s, u) => s.pendientesRecepcion(u),
  recibir: (s, u, d) => s.recibirExpedientes(u, d),
  plantillas_observacion: (s, u) => s.plantillasObservacion(u),
  guardar_plantillas_observacion: (s, u, d) => s.guardarPlantillasObservacion(u, d),
  busqueda_universal: (s, u, d) => s.busquedaUniversal(u, d),
  finalizados: (s, u, d) => s.finalizados(u, d),
  antes_despues: (s, u) => s.antesDespues(u),
  crear_departamento: (s, u, d) => s.crearDepartamento(u, d),

  // ---- v2: portal ciudadano (desde mesa de partes)
  administrado_buscar: (s, u, d) => s.administradoBuscar(u, d),
  administrado_separar_nombre: (s, u, d) => s.separarNombreAdministrado(u, d),
  administrado_restablecer: (s, u, d) => s.administradoRestablecer(u, d),
}

// Acciones que llevan un archivo (base64) y usan el canal de red de mayor tamaño
const CON_ARCHIVO = new Set(['importar_previsualizar', 'importar_confirmar', 'importar2026_previsualizar', 'importar2026_confirmar',
  'subir_tupa'])

// Acciones de consulta que se filtran por el «departamento activo» elegido en la interfaz
const FILTRABLES = new Set(['resumen', 'bandeja', 'alertas', 'departamentos', 'tablero', 'importados_en_tramite',
  'exportar_busqueda', 'productividad', 'importar_departamentos', 'importar_previsualizar', 'importar_confirmar',
  'plantilla_importacion', 'finalizados', 'antes_despues'])

// Acciones que solo se permiten desde la propia PC servidor (manejan archivos locales)
const SOLO_LOCAL = new Set(['restaurar_respaldo'])

async function despachar(sistema, accion, datos, token, { local = true, progreso = null } = {}) {
  try {
    if (PUBLICAS[accion]) return { ok: true, datos: await PUBLICAS[accion](sistema, datos) }
    if (!PRIVADAS[accion] && !SOLO_LOCAL.has(accion)) throw new ErrorUsuario(`Acción desconocida: ${accion}`)
    let u = sistema.usuarioDeSesion(token)
    const activo = datos && typeof datos === 'object' ? datos.departamento_activo : null
    if (activo && FILTRABLES.has(accion)) u = sistema.conDepartamentoActivo(u, activo)
    if (SOLO_LOCAL.has(accion)) {
      if (!local) throw new ErrorUsuario('Esta acción solo puede hacerse en la PC servidor.', 'PERMISO')
      if (accion === 'restaurar_respaldo') {
        return { ok: true, datos: await sistema.restaurarRespaldo(u, datos) }
      }
    }
    return { ok: true, datos: await PRIVADAS[accion](sistema, u, datos || {}, token, { local, progreso }) }
  } catch (err) {
    if (err && err.esDeUsuario) return { ok: false, error: err.message, codigo: err.codigo }
    console.error(`[URBANITO] error en ${accion}:`, err)
    return { ok: false, error: 'Ocurrió un error interno. El detalle quedó registrado en el archivo de registro.', codigo: 'INTERNO',
             detalle: String(err && err.message) }
  }
}

module.exports = { despachar, PRIVADAS, PUBLICAS, CON_ARCHIVO }
