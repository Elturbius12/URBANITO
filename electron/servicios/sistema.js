// ===========================================================================
// SISTEMA — núcleo del ERP
// Mantiene la base, el calendario y los resultados de los modelos en memoria.
// Toda escritura pasa por aquí: valida permisos, valida datos, guarda en una
// transacción, registra la auditoría y recalcula los modelos.
// ===========================================================================

const fs = require('fs')
const path = require('path')
const { BaseDatos, cargarAlmacen } = require('../bd')
const { Calendario, hoyLocal } = require('../motor/calendario')
const { calcularModelos, ACTIVOS } = require('../motor/modelos')
const { validarMatriz, calcularAhp } = require('../motor/ahp')
const seg = require('./seguridad')

// Junto al código compilado, o en electron/ durante el desarrollo
const ESQUEMA = fs.readFileSync([path.join(__dirname, 'esquema.sql'), path.join(__dirname, '..', 'esquema.sql')]
  .find(r => fs.existsSync(r)), 'utf8')

const ESTADOS = {
  EN_TRAMITE: 'En trámite',
  OBSERVADO: 'Observado (plazo suspendido)',
  FINALIZADO: 'Finalizado',
  ARCHIVADO: 'Archivado',
  CERRADO_HISTORICO: 'Cerrado (sistema anterior)',
  SIN_FECHA: 'Sin fechas registradas',
}
const CERRADOS = new Set(['FINALIZADO', 'ARCHIVADO', 'CERRADO_HISTORICO'])
const RESULTADOS_FINALIZACION = ['APROBADO / PROCEDENTE', 'DENEGADO / IMPROCEDENTE', 'ATENDIDO']
const MOTIVOS_ARCHIVO = ['Desistimiento del administrado', 'Abandono (no subsanó)',
                         'Improcedente', 'Duplicado', 'Acumulado a otro expediente', 'Otro']

class ErrorUsuario extends Error {
  constructor(mensaje, codigo = 'VALIDACION') {
    super(mensaje)
    this.codigo = codigo
    this.esDeUsuario = true
  }
}

const texto = (v, max = 500) => (v === null || v === undefined ? '' : String(v)).trim().slice(0, max)
const ahoraIso = () => new Date().toISOString()

class Sistema {
  constructor({ rutaBd, carpetaRespaldos, fechaFija = null }) {
    this.rutaBd = rutaBd
    this.carpetaRespaldos = carpetaRespaldos
    this.fechaFija = fechaFija            // solo para pruebas automatizadas
    this.sesiones = new seg.Sesiones()
    this.oyentes = new Set()
  }

  hoy() {
    return this.fechaFija || hoyLocal()
  }

  async iniciar() {
    this.bd = await BaseDatos.abrir(this.rutaBd)
    this.bd.db.exec(ESQUEMA)          // crea lo que falte (no toca lo existente)
    this.migraciones = this.bd.migrar()
    this.verificarIntegridad()
    this.cargar()
    this.respaldoAutomatico()
    this.reloj = setInterval(() => {
      if (this.r && this.r.hoy !== this.hoy()) this.recalcular()
    }, 60 * 1000)
    if (this.reloj.unref) this.reloj.unref()
  }

  detener() {
    if (this.reloj) clearInterval(this.reloj)
    if (this.bd) this.bd.cerrar()
  }

  verificarIntegridad() {
    const r = this.bd.una('PRAGMA integrity_check')
    const valor = r && Object.values(r)[0]
    if (valor !== 'ok') throw new Error(`La base de datos está dañada (${valor}). Restaure un respaldo.`)
    for (const t of ['expedientes', 'movimientos', 'procedimientos', 'configuracion', 'feriados']) {
      if (!this.bd.una("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [t])) {
        throw new Error(`La base de datos no tiene la tabla "${t}". No es una base de URBANITO.`)
      }
    }
  }

  cargar() {
    this.almacen = cargarAlmacen(this.bd)
    this.cal = new Calendario(this.almacen.feriados)
    this.cargarCatalogos()
    this.recalcular()
  }

  cargarCatalogos() {
    this.departamentos = new Map(this.bd.todas('SELECT * FROM departamentos').map(d => [d.codigo, d]))
    this.unidades = new Map(this.bd.todas('SELECT * FROM unidades').map(u => [u.codigo, u]))
    this.usuarios = new Map(this.bd.todas('SELECT * FROM usuarios').map(u => [u.id, u]))
    // departamentos de cada usuario: el principal primero
    const deps = new Map()
    for (const f of this.bd.todas('SELECT usuario_id, departamento_codigo FROM usuario_departamentos ORDER BY departamento_codigo')) {
      if (!deps.has(f.usuario_id)) deps.set(f.usuario_id, [])
      deps.get(f.usuario_id).push(f.departamento_codigo)
    }
    for (const u of this.usuarios.values()) {
      const lista = (deps.get(u.id) || []).filter(d => d !== u.departamento_codigo)
      u.departamentos = u.departamento_codigo ? [u.departamento_codigo, ...lista] : lista
    }
  }

  recalcular() {
    this.r = calcularModelos(this.almacen, this.cal, this.hoy())
    for (const fn of this.oyentes) {
      try { fn(this.r) } catch (_) { /* un oyente no debe tumbar el sistema */ }
    }
  }

  recargarExpediente(id) {
    const e = this.bd.una('SELECT * FROM expedientes WHERE id = ?', [id])
    if (e) this.almacen.expedientes.set(id, e)
    else this.almacen.expedientes.delete(id)
    const movs = this.bd.todas('SELECT * FROM movimientos WHERE expediente_id = ? ORDER BY orden, id', [id])
    if (movs.length) this.almacen.movimientos.set(id, movs)
    else this.almacen.movimientos.delete(id)
  }

  auditar(usuario, accion, entidad, entidadId, detalle) {
    this.bd.ejecutar(
      'INSERT INTO auditoria(fecha_hora, usuario_id, usuario, accion, entidad, entidad_id, detalle) VALUES (?,?,?,?,?,?,?)',
      [ahoraIso(), usuario ? usuario.id : null, usuario ? usuario.usuario : null, accion, entidad,
       entidadId === null || entidadId === undefined ? null : String(entidadId),
       detalle === undefined ? null : (typeof detalle === 'string' ? detalle : JSON.stringify(detalle))])
  }

  // =================================================================== ACCESO
  estadoInicial() {
    const cfg = this.almacen.configuracion
    return {
      requiere_configuracion: this.bd.una('SELECT COUNT(*) n FROM usuarios').n === 0,
      institucion: cfg.institucion,
      importacion: cfg.importacion,
      roles: seg.ROLES,
    }
  }

  configuracionInicial({ nombre_completo, usuario, clave, crear_demo, crear_por_departamento }) {
    if (!this.estadoInicial().requiere_configuracion) {
      throw new ErrorUsuario('El sistema ya fue configurado.')
    }
    const err = seg.validarClaveNueva(clave)
    if (err) throw new ErrorUsuario(err)
    let demo = []
    this.bd.transaccion(() => {
      const admin = this.insertarUsuario({ usuario, nombre_completo, rol: 'ADMINISTRADOR' }, clave, false)
      this.auditar({ id: admin, usuario }, 'CONFIGURACION_INICIAL', 'usuarios', admin, 'Creación del administrador')
      if (crear_por_departamento) {
        // reemplaza a los usuarios de prueba: jefe y técnico por departamento, gerente y mesa de partes
        this.cargarCatalogos()
        demo = this.crearCuentasDepartamento({ id: admin, usuario: texto(usuario, 30).toLowerCase() }).creados
      } else if (crear_demo) {
        const ejemplos = [
          ['gerente', 'Usuario de prueba — Gerente', 'GERENTE', null],
          ['jefe.numeracion', 'Usuario de prueba — Jefe de Numeración', 'JEFE_DEPARTAMENTO', 'DEP_NUMERACION'],
          ['tecnico.numeracion', 'Usuario de prueba — Técnico de Numeración', 'TECNICO', 'DEP_NUMERACION'],
          ['mesa.partes', 'Usuario de prueba — Mesa de partes', 'MESA_PARTES', null],
        ]
        for (const [u, n, rol, dep] of ejemplos) {
          const temporal = seg.claveTemporal()
          const id = this.insertarUsuario({ usuario: u, nombre_completo: n, rol, departamento_codigo: dep }, temporal, true)
          this.auditar({ id: admin, usuario }, 'CREAR_USUARIO', 'usuarios', id, `Usuario de prueba ${u} (${rol})`)
          demo.push({ usuario: u, clave_temporal: temporal, rol: seg.ROLES[rol].nombre })
        }
      }
    })
    this.cargarCatalogos()
    return { ok: true, usuarios_demo: demo }
  }

  insertarUsuario({ usuario, nombre_completo, rol, departamento_codigo = null, alias_historico = null, departamentos },
                  clave, debeCambiar) {
    const u = texto(usuario, 30).toLowerCase()
    if (!/^[a-z0-9._-]{3,30}$/.test(u)) {
      throw new ErrorUsuario('El usuario debe tener de 3 a 30 caracteres: letras minúsculas, números, punto, guion.')
    }
    if (this.bd.una('SELECT id FROM usuarios WHERE usuario = ?', [u])) {
      throw new ErrorUsuario(`Ya existe el usuario "${u}".`)
    }
    const nombre = texto(nombre_completo, 120)
    if (nombre.length < 3) throw new ErrorUsuario('Ingrese el nombre completo.')
    if (!seg.ROLES[rol]) throw new ErrorUsuario('Rol inválido.')
    const { principal, lista } = this.validarDepartamentoRol(rol, departamento_codigo, departamentos)
    const { hash, sal } = seg.cifrarClave(clave)
    const id = this.bd.ejecutar(
      `INSERT INTO usuarios(usuario, nombre_completo, rol, departamento_codigo, alias_historico,
       hash, sal, activo, debe_cambiar_clave, creado_en) VALUES (?,?,?,?,?,?,?,1,?,?)`,
      [u, nombre, rol, principal, alias_historico ? texto(alias_historico, 60).toUpperCase() : null,
       hash, sal, debeCambiar ? 1 : 0, ahoraIso()]).ultimoId
    this.guardarDepartamentosUsuario(id, lista)
    return id
  }

  // Valida el departamento principal y la lista de departamentos de un usuario.
  // Solo jefes y técnicos pueden trabajar en más de un departamento.
  // Devuelve { principal, lista } (el principal siempre está en la lista).
  validarDepartamentoRol(rol, dep, departamentos) {
    let lista = Array.isArray(departamentos)
      ? [...new Set(departamentos.map(d => texto(d, 40)).filter(Boolean))] : null
    let principal = dep ? texto(dep, 40) : null
    if (lista && lista.length && !principal) principal = lista[0]
    if (!lista) lista = principal ? [principal] : []
    if (principal && !lista.includes(principal)) lista.unshift(principal)
    if (rol === 'JEFE_DEPARTAMENTO' && !principal) {
      throw new ErrorUsuario('Un jefe de departamento debe tener un departamento asignado.')
    }
    if (lista.length > 1 && !['JEFE_DEPARTAMENTO', 'TECNICO'].includes(rol)) {
      throw new ErrorUsuario('Solo un jefe de departamento o un técnico puede trabajar en más de un departamento.')
    }
    for (const d of lista) {
      if (!this.bd.una('SELECT codigo FROM departamentos WHERE codigo = ?', [d])) {
        throw new ErrorUsuario('Departamento inválido.')
      }
    }
    return { principal, lista }
  }

  guardarDepartamentosUsuario(id, lista) {
    this.bd.ejecutar('DELETE FROM usuario_departamentos WHERE usuario_id = ?', [id])
    for (const d of lista) {
      this.bd.ejecutar('INSERT INTO usuario_departamentos(usuario_id, departamento_codigo) VALUES (?,?)', [id, d])
    }
  }

  login(usuario, clave) {
    const u = this.bd.una('SELECT * FROM usuarios WHERE usuario = ?', [texto(usuario, 30).toLowerCase()])
    const generico = new ErrorUsuario('Usuario o contraseña incorrectos.', 'CREDENCIALES')
    if (!u) throw generico
    if (!u.activo) throw new ErrorUsuario('Este usuario está desactivado. Consulte al administrador.', 'INACTIVO')
    if (u.bloqueado_hasta && u.bloqueado_hasta > ahoraIso()) {
      const min = Math.ceil((new Date(u.bloqueado_hasta) - Date.now()) / 60000)
      throw new ErrorUsuario(`Usuario bloqueado por intentos fallidos. Intente en ${min} minuto(s).`, 'BLOQUEADO')
    }
    if (!seg.verificarClave(clave || '', u.hash, u.sal)) {
      const intentos = u.intentos_fallidos + 1
      const bloqueo = intentos >= seg.MAX_INTENTOS
        ? new Date(Date.now() + seg.BLOQUEO_MIN * 60000).toISOString() : null
      this.bd.transaccion(() => {
        this.bd.ejecutar('UPDATE usuarios SET intentos_fallidos = ?, bloqueado_hasta = ? WHERE id = ?',
          [bloqueo ? 0 : intentos, bloqueo, u.id])
        this.auditar(u, 'LOGIN_FALLIDO', 'usuarios', u.id, bloqueo ? 'Usuario bloqueado 5 minutos' : `Intento ${intentos}`)
      })
      if (bloqueo) {
        throw new ErrorUsuario(`Demasiados intentos fallidos. Usuario bloqueado ${seg.BLOQUEO_MIN} minutos.`, 'BLOQUEADO')
      }
      throw generico
    }
    this.bd.transaccion(() => {
      this.bd.ejecutar('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = ? WHERE id = ?',
        [ahoraIso(), u.id])
      this.auditar(u, 'LOGIN', 'usuarios', u.id, null)
    })
    this.cargarCatalogos()
    const token = this.sesiones.crear(u)
    return { token, usuario: this.usuarioPublico(this.usuarios.get(u.id)) }
  }

  // Devuelve el usuario de una sesión válida o lanza SESION
  usuarioDeSesion(token) {
    const s = this.sesiones.obtener(token)
    if (!s) throw new ErrorUsuario('Su sesión terminó. Vuelva a ingresar.', 'SESION')
    const u = this.usuarios.get(s.usuario_id)
    if (!u || !u.activo) {
      this.sesiones.cerrar(token)
      throw new ErrorUsuario('Su usuario fue desactivado.', 'SESION')
    }
    return u
  }

  logout(token, u) {
    this.sesiones.cerrar(token)
    this.bd.transaccion(() => this.auditar(u, 'LOGOUT', 'usuarios', u.id, null))
    return { ok: true }
  }

  usuarioPublico(u) {
    const dep = u.departamento_codigo ? this.departamentos.get(u.departamento_codigo) : null
    const permisos = seg.PERMISOS[u.rol].includes('*')
      ? ['*'] : [...seg.PERMISOS[u.rol]]
    const nombreDep = (c) => (this.departamentos.get(c) || {}).nombre || c
    const propios = (u.departamentos || []).map(c => ({ codigo: c, nombre: nombreDep(c), principal: c === u.departamento_codigo }))
    // departamentos que puede elegir como «departamento activo» en la interfaz
    const elegibles = this.vistaGeneral(u)
      ? [...this.departamentos.values()].filter(d => d.activo).map(d => ({ codigo: d.codigo, nombre: d.nombre }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre))
      : propios.map(({ codigo, nombre }) => ({ codigo, nombre }))
    return {
      id: u.id, usuario: u.usuario, nombre_completo: u.nombre_completo, rol: u.rol,
      rol_nombre: seg.ROLES[u.rol].nombre, departamento_codigo: u.departamento_codigo,
      departamento_nombre: dep ? dep.nombre : null, alias_historico: u.alias_historico,
      departamentos: propios, departamentos_elegibles: elegibles,
      debe_cambiar_clave: !!u.debe_cambiar_clave, permisos, activo: !!u.activo,
      ultimo_acceso: u.ultimo_acceso, creado_en: u.creado_en,
    }
  }

  cambiarClave(u, { actual, nueva }) {
    if (!seg.verificarClave(actual || '', u.hash, u.sal)) throw new ErrorUsuario('La contraseña actual no es correcta.')
    const err = seg.validarClaveNueva(nueva)
    if (err) throw new ErrorUsuario(err)
    if (actual === nueva) throw new ErrorUsuario('La nueva contraseña debe ser diferente de la actual.')
    const { hash, sal } = seg.cifrarClave(nueva)
    this.bd.transaccion(() => {
      this.bd.ejecutar('UPDATE usuarios SET hash = ?, sal = ?, debe_cambiar_clave = 0 WHERE id = ?', [hash, sal, u.id])
      this.auditar(u, 'CAMBIAR_CLAVE', 'usuarios', u.id, null)
    })
    this.cargarCatalogos()
    return { ok: true, usuario: this.usuarioPublico(this.usuarios.get(u.id)) }
  }

  // =================================================================== ALCANCE
  exigir(u, permiso) {
    if (!seg.tienePermiso(u.rol, permiso)) {
      throw new ErrorUsuario('No tiene permiso para esta acción.', 'PERMISO')
    }
    if (u.debe_cambiar_clave) throw new ErrorUsuario('Debe cambiar su contraseña antes de continuar.', 'CAMBIAR_CLAVE')
  }

  departamentoDe(e) {
    const p = this.almacen.procedimientos.get(e.procedimiento_codigo)
    return p ? p.departamento_codigo : null
  }

  // ADMINISTRADOR y GERENTE ven todos los departamentos
  vistaGeneral(u) {
    return u.rol === 'ADMINISTRADOR' || u.rol === 'GERENTE'
  }

  // Conjunto de departamentos del alcance del usuario (considera el
  // «departamento activo» elegido en la interfaz). null = sin restricción.
  departamentosAlcance(u) {
    if (u._depActivo) return new Set([u._depActivo])
    if (this.vistaGeneral(u)) return null
    return new Set(u.departamentos || (u.departamento_codigo ? [u.departamento_codigo] : []))
  }

  // Copia del usuario con el «departamento activo» elegido en la interfaz.
  // Se valida aquí: nadie puede activar un departamento que no le corresponde.
  conDepartamentoActivo(u, codigo) {
    const c = texto(codigo, 40)
    if (!c || c === 'TODOS') return u
    if (!this.departamentos.has(c)) throw new ErrorUsuario('Departamento activo inválido.')
    if (!this.vistaGeneral(u) && !(u.departamentos || []).includes(c)) {
      throw new ErrorUsuario('No trabaja en ese departamento.', 'PERMISO')
    }
    return { ...u, _depActivo: c }
  }

  asignadoA(u, e) {
    if (e.responsable_usuario_id === u.id) return true
    return !!(u.alias_historico && e.ubicacion_tipo === 'RESPONSABLE' &&
              String(e.ubicacion_codigo || '').toUpperCase() === u.alias_historico)
  }

  // ¿El expediente pertenece a alguno de los departamentos del conjunto?
  delDepartamento(e, deps) {
    if (deps.has(this.departamentoDe(e))) return true
    if (e.ubicacion_tipo === 'DEPARTAMENTO' && deps.has(e.ubicacion_codigo)) return true
    const resp = e.responsable_usuario_id && this.usuarios.get(e.responsable_usuario_id)
    return !!(resp && (resp.departamentos || []).some(d => deps.has(d)))
  }

  enAlcance(u, e) {
    const deps = this.departamentosAlcance(u)
    if (this.vistaGeneral(u)) return !deps || this.delDepartamento(e, deps)
    if (u.rol === 'JEFE_DEPARTAMENTO') return this.delDepartamento(e, deps)
    if (u.rol === 'TECNICO') return this.asignadoA(u, e) && (!u._depActivo || this.delDepartamento(e, deps))
    return false
  }

  exigirExpediente(u, id, permiso, { permitirFueraDeAlcance = false } = {}) {
    this.exigir(u, permiso)
    const e = this.almacen.expedientes.get(Number(id))
    if (!e) throw new ErrorUsuario('El expediente no existe.', 'NO_EXISTE')
    if (!permitirFueraDeAlcance && !this.enAlcance(u, e)) {
      throw new ErrorUsuario('Este expediente no está a su cargo ni en su departamento.', 'PERMISO')
    }
    return e
  }

  accionesPermitidas(u, e) {
    const a = []
    const activo = ACTIVOS.has(e.estado)
    const alcance = this.enAlcance(u, e)
    if (u.debe_cambiar_clave) return a
    if (activo && e.estado === 'EN_TRAMITE' && alcance) {
      for (const p of ['derivar', 'observar', 'finalizar', 'archivar']) if (seg.tienePermiso(u.rol, p)) a.push(p)
    }
    if (e.estado === 'OBSERVADO' && seg.tienePermiso(u.rol, 'subsanar') &&
        (alcance || u.rol === 'MESA_PARTES')) a.push('subsanar')
    if (e.estado === 'OBSERVADO' && alcance && seg.tienePermiso(u.rol, 'archivar')) a.push('archivar')
    if (seg.tienePermiso(u.rol, 'corregir') && (u.rol !== 'MESA_PARTES' || e.sistema === 'URBANITO')) a.push('corregir')
    if (CERRADOS.has(e.estado) && u.rol === 'ADMINISTRADOR') a.push('reabrir')
    return a
  }

  // =================================================================== VALIDACIONES
  validarFecha(fecha, { minimo = null, nombre = 'La fecha' } = {}) {
    const f = texto(fecha, 10) || this.hoy()
    if (!this.cal.indice(f)) throw new ErrorUsuario(`${nombre} no es válida.`)
    if (f > this.hoy()) throw new ErrorUsuario(`${nombre} no puede ser posterior a hoy.`)
    if (f < '2014-01-01') throw new ErrorUsuario(`${nombre} no puede ser anterior a 2014.`)
    if (minimo && f < minimo) throw new ErrorUsuario(`${nombre} no puede ser anterior al ${formatoFecha(minimo)} (último registro del expediente).`)
    return f
  }

  fechaMinimaMovimiento(e) {
    const movs = (this.almacen.movimientos.get(e.id) || []).filter(m => m.fecha_valida && m.fecha)
    const ult = movs.length ? movs[movs.length - 1].fecha : null
    const ing = e.fecha_invalida ? null : e.fecha_ingreso
    return [ult, ing].filter(Boolean).sort().pop() || null
  }

  resolverDestino(destino) {
    if (!destino || !destino.tipo) throw new ErrorUsuario('Seleccione a dónde se deriva el expediente.')
    const { tipo, codigo } = destino
    if (tipo === 'USUARIO') {
      const u = this.usuarios.get(Number(codigo))
      if (!u || !u.activo) throw new ErrorUsuario('El usuario de destino no existe o está desactivado.')
      if (!['JEFE_DEPARTAMENTO', 'TECNICO', 'GERENTE'].includes(u.rol)) {
        throw new ErrorUsuario('Solo se puede asignar a un jefe, técnico o gerente.')
      }
      return { tipo: 'USUARIO', codigo: String(u.id), nombre: u.nombre_completo, usuario_id: u.id }
    }
    if (tipo === 'DEPARTAMENTO') {
      const d = this.departamentos.get(codigo)
      if (!d || !d.activo) throw new ErrorUsuario('Departamento de destino inválido.')
      return { tipo: 'DEPARTAMENTO', codigo: d.codigo, nombre: d.nombre, usuario_id: null }
    }
    if (tipo === 'UNIDAD ORGANICA') {
      const un = this.unidades.get(codigo)
      if (!un || !un.activo) throw new ErrorUsuario('Unidad orgánica de destino inválida.')
      return { tipo: 'UNIDAD ORGANICA', codigo: un.codigo, nombre: un.nombre, usuario_id: null }
    }
    throw new ErrorUsuario('Tipo de destino inválido.')
  }

  insertarMovimiento(e, u, { fecha, tipo, destino, documento, folios, observacion }) {
    const orden = (this.bd.una('SELECT MAX(orden) m FROM movimientos WHERE expediente_id = ?', [e.id]).m || 0) + 1
    this.bd.ejecutar(
      `INSERT INTO movimientos(expediente_id, orden, fecha, tipo, destino_texto, destino_tipo, destino_codigo,
       destino_nombre, destino_usuario_id, documento, folios, observacion, usuario_id, registrado_en,
       fecha_valida, importado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0)`,
      [e.id, orden, fecha, tipo, destino ? destino.nombre : null, destino ? destino.tipo : null,
       destino ? destino.codigo : null, destino ? destino.nombre : null,
       destino ? destino.usuario_id : null, texto(documento, 120) || null,
       folios === null || folios === undefined || folios === '' ? null : String(folios),
       texto(observacion, 2000) || null, u.id, ahoraIso()])
  }

  escritura(id, fn) {
    const r = this.bd.transaccion(fn)
    if (id !== null && id !== undefined) this.recargarExpediente(Number(id))
    this.recalcular()
    return r
  }

  // =================================================================== OPERACIONES
  registrarExpediente(u, datos) {
    this.exigir(u, 'registrar')
    const solicitante = texto(datos.solicitante, 200)
    if (solicitante.length < 3) throw new ErrorUsuario('Ingrese el nombre o razón social del solicitante.')
    const doc = texto(datos.documento_identidad, 20).toUpperCase()
    if (!/^(\d{8}|\d{11}|[A-Z0-9]{9,12})$/.test(doc)) {
      throw new ErrorUsuario('Documento inválido: DNI (8 dígitos), RUC (11 dígitos) o carné de extranjería (9 a 12 caracteres).')
    }
    const p = this.almacen.procedimientos.get(datos.procedimiento_codigo)
    if (!p || !p.activo || !p.seleccionable) throw new ErrorUsuario('Seleccione un procedimiento válido.')
    const folios = Number(datos.folios)
    if (!Number.isInteger(folios) || folios < 1 || folios > 100000) throw new ErrorUsuario('Folios: ingrese un número entero mayor que cero.')
    const fecha = this.validarFecha(datos.fecha_ingreso, { nombre: 'La fecha de ingreso' })
    const destino = this.resolverDestino(datos.destino || (p.departamento_codigo
      ? { tipo: 'DEPARTAMENTO', codigo: p.departamento_codigo } : null))
    const anio = fecha.slice(0, 4)

    let nuevo = null
    this.bd.transaccion(() => {
      const filas = this.bd.todas("SELECT numero FROM expedientes WHERE sistema = 'URBANITO' AND numero LIKE ?", [`%-${anio}`])
      const max = filas.reduce((m, f) => Math.max(m, parseInt(f.numero, 10) || 0), 0)
      const numero = `${String(max + 1).padStart(6, '0')}-${anio}`
      const id = this.bd.ejecutar(
        `INSERT INTO expedientes(numero, sistema, solicitante, documento_identidad, telefono, direccion,
         procedimiento_codigo, asunto, folios, fecha_ingreso, estado, responsable_usuario_id,
         ubicacion_tipo, ubicacion_codigo, ubicacion_nombre, importado, fecha_invalida, registrado_por, creado_en)
         VALUES (?,?,?,?,?,?,?,?,?,?,'EN_TRAMITE',?,?,?,?,0,0,?,?)`,
        [numero, 'URBANITO', solicitante, doc, texto(datos.telefono, 20) || null, texto(datos.direccion, 200) || null,
         p.codigo, texto(datos.asunto, 1000) || p.nombre, folios, fecha, destino.usuario_id,
         destino.tipo, destino.codigo, destino.nombre, u.id, ahoraIso()]).ultimoId
      const e = { id, fecha_ingreso: fecha }
      this.insertarMovimiento(e, u, { fecha, tipo: 'REGISTRO', destino, folios,
                                      observacion: texto(datos.observacion, 2000) })
      this.auditar(u, 'REGISTRAR_EXPEDIENTE', 'expedientes', id, `${numero} — ${p.nombre} — ${solicitante}`)
      nuevo = { id, numero }
    })
    this.recargarExpediente(nuevo.id)
    this.recalcular()
    return { ...nuevo, constancia: this.constancia(nuevo.id) }
  }

  constancia(id) {
    const e = this.almacen.expedientes.get(Number(id))
    if (!e) throw new ErrorUsuario('El expediente no existe.', 'NO_EXISTE')
    const p = this.almacen.procedimientos.get(e.procedimiento_codigo)
    const est = this.estimacion(e.procedimiento_codigo, e.fecha_ingreso)
    const reg = e.registrado_por ? this.usuarios.get(e.registrado_por) : null
    return {
      numero: e.numero, sistema: e.sistema, fecha_ingreso: e.fecha_ingreso, creado_en: e.creado_en,
      solicitante: e.solicitante, documento_identidad: e.documento_identidad, telefono: e.telefono,
      direccion: e.direccion, asunto: e.asunto, folios: e.folios,
      procedimiento: p ? p.nombre : e.procedimiento_codigo, tupa_codigo: p ? p.tupa_codigo : null,
      destino: e.ubicacion_nombre, registrado_por: reg ? reg.nombre_completo : null,
      estimacion: est, institucion: this.almacen.configuracion.institucion,
    }
  }

  derivar(u, id, datos) {
    const e = this.exigirExpediente(u, id, 'derivar')
    if (e.estado !== 'EN_TRAMITE') throw new ErrorUsuario(`No se puede derivar: el expediente está ${ESTADOS[e.estado].toLowerCase()}.`)
    const destino = this.resolverDestino(datos.destino)
    if (destino.tipo === e.ubicacion_tipo && destino.codigo === String(e.ubicacion_codigo)) {
      throw new ErrorUsuario('El expediente ya se encuentra en ese destino.')
    }
    const fecha = this.validarFecha(datos.fecha, { minimo: this.fechaMinimaMovimiento(e), nombre: 'La fecha de derivación' })
    return this.escritura(e.id, () => {
      this.insertarMovimiento(e, u, { fecha, tipo: 'DERIVACION', destino, documento: datos.documento,
                                      folios: datos.folios, observacion: datos.observacion })
      this.bd.ejecutar(`UPDATE expedientes SET ubicacion_tipo = ?, ubicacion_codigo = ?, ubicacion_nombre = ?,
                        responsable_usuario_id = ? WHERE id = ?`,
        [destino.tipo, destino.codigo, destino.nombre, destino.usuario_id, e.id])
      this.auditar(u, 'DERIVAR', 'expedientes', e.id, `${e.numero} → ${destino.nombre}`)
      return { ok: true }
    })
  }

  observar(u, id, datos) {
    const e = this.exigirExpediente(u, id, 'observar')
    if (e.estado !== 'EN_TRAMITE') throw new ErrorUsuario('Solo se puede observar un expediente en trámite.')
    const obs = texto(datos.observacion, 2000)
    if (obs.length < 10) throw new ErrorUsuario('Describa la observación que debe subsanar el administrado (mínimo 10 caracteres).')
    const fecha = this.validarFecha(datos.fecha, { minimo: this.fechaMinimaMovimiento(e), nombre: 'La fecha de observación' })
    return this.escritura(e.id, () => {
      this.insertarMovimiento(e, u, { fecha, tipo: 'OBSERVACION',
        destino: { tipo: 'ESTADO', codigo: 'OBSERVADO', nombre: 'Observado — en manos del administrado', usuario_id: null },
        documento: datos.documento, observacion: obs })
      this.bd.ejecutar("UPDATE expedientes SET estado = 'OBSERVADO' WHERE id = ?", [e.id])
      this.auditar(u, 'OBSERVAR', 'expedientes', e.id, `${e.numero}: ${obs}`)
      return { ok: true }
    })
  }

  subsanar(u, id, datos) {
    const e = this.exigirExpediente(u, id, 'subsanar', { permitirFueraDeAlcance: u.rol === 'MESA_PARTES' })
    if (e.estado !== 'OBSERVADO') throw new ErrorUsuario('El expediente no está observado.')
    const fecha = this.validarFecha(datos.fecha, { minimo: this.fechaMinimaMovimiento(e), nombre: 'La fecha de subsanación' })
    const destino = {
      tipo: e.ubicacion_tipo, codigo: e.ubicacion_codigo === null ? null : String(e.ubicacion_codigo),
      nombre: e.ubicacion_nombre, usuario_id: e.responsable_usuario_id,
    }
    return this.escritura(e.id, () => {
      this.insertarMovimiento(e, u, { fecha, tipo: 'SUBSANACION', destino, documento: datos.documento,
                                      folios: datos.folios, observacion: datos.observacion })
      this.bd.ejecutar("UPDATE expedientes SET estado = 'EN_TRAMITE' WHERE id = ?", [e.id])
      this.auditar(u, 'SUBSANAR', 'expedientes', e.id, e.numero)
      return { ok: true }
    })
  }

  finalizar(u, id, datos) {
    const e = this.exigirExpediente(u, id, 'finalizar')
    if (e.estado !== 'EN_TRAMITE') throw new ErrorUsuario('Solo se puede finalizar un expediente en trámite (si está observado, primero debe subsanarse o archivarse).')
    const resultado = texto(datos.resultado, 60)
    if (!RESULTADOS_FINALIZACION.includes(resultado)) throw new ErrorUsuario('Seleccione el resultado del trámite.')
    const doc = texto(datos.documento, 120)
    if (doc.length < 3) throw new ErrorUsuario('Indique el documento con que se resuelve (resolución, certificado, informe, etc.).')
    const fecha = this.validarFecha(datos.fecha, { minimo: this.fechaMinimaMovimiento(e), nombre: 'La fecha de finalización' })
    return this.escritura(e.id, () => {
      this.insertarMovimiento(e, u, { fecha, tipo: 'FINALIZACION',
        destino: { tipo: 'ESTADO', codigo: 'FINALIZADO', nombre: 'Finalizado', usuario_id: null },
        documento: doc, observacion: datos.observacion })
      this.bd.ejecutar(`UPDATE expedientes SET estado = 'FINALIZADO', fecha_cierre = ?, motivo_cierre = ?,
                        ubicacion_tipo = 'ESTADO', ubicacion_codigo = 'FINALIZADO', ubicacion_nombre = 'Finalizado'
                        WHERE id = ?`, [fecha, `${resultado} — ${doc}`, e.id])
      this.auditar(u, 'FINALIZAR', 'expedientes', e.id, `${e.numero}: ${resultado} — ${doc}`)
      return { ok: true }
    })
  }

  archivar(u, id, datos) {
    const e = this.exigirExpediente(u, id, 'archivar')
    if (!ACTIVOS.has(e.estado)) throw new ErrorUsuario('El expediente ya está cerrado.')
    const motivo = texto(datos.motivo, 80)
    if (!MOTIVOS_ARCHIVO.includes(motivo)) throw new ErrorUsuario('Seleccione el motivo del archivo.')
    const obs = texto(datos.observacion, 2000)
    if (motivo === 'Otro' && obs.length < 10) throw new ErrorUsuario('Explique el motivo del archivo (mínimo 10 caracteres).')
    const fecha = this.validarFecha(datos.fecha, { minimo: this.fechaMinimaMovimiento(e), nombre: 'La fecha de archivo' })
    return this.escritura(e.id, () => {
      this.insertarMovimiento(e, u, { fecha, tipo: 'ARCHIVO',
        destino: { tipo: 'ESTADO', codigo: 'ARCHIVADO', nombre: 'Archivado', usuario_id: null },
        documento: datos.documento, observacion: obs })
      this.bd.ejecutar(`UPDATE expedientes SET estado = 'ARCHIVADO', fecha_cierre = ?, motivo_cierre = ?,
                        ubicacion_tipo = 'ESTADO', ubicacion_codigo = 'ARCHIVADO', ubicacion_nombre = 'Archivado'
                        WHERE id = ?`, [fecha, motivo + (obs ? ` — ${obs}` : ''), e.id])
      this.auditar(u, 'ARCHIVAR', 'expedientes', e.id, `${e.numero}: ${motivo}`)
      return { ok: true }
    })
  }

  reabrir(u, id, datos) {
    this.exigir(u, 'usuarios')     // solo administrador
    const e = this.almacen.expedientes.get(Number(id))
    if (!e) throw new ErrorUsuario('El expediente no existe.', 'NO_EXISTE')
    if (!CERRADOS.has(e.estado)) throw new ErrorUsuario('El expediente no está cerrado.')
    const motivo = texto(datos.motivo, 1000)
    if (motivo.length < 10) throw new ErrorUsuario('Explique por qué se reabre (mínimo 10 caracteres).')
    const destino = this.resolverDestino(datos.destino)
    const fecha = this.validarFecha(datos.fecha, { minimo: this.fechaMinimaMovimiento(e), nombre: 'La fecha de reapertura' })
    return this.escritura(e.id, () => {
      this.insertarMovimiento(e, u, { fecha, tipo: 'REAPERTURA', destino, observacion: motivo })
      this.bd.ejecutar(`UPDATE expedientes SET estado = 'EN_TRAMITE', fecha_cierre = NULL, motivo_cierre = NULL,
                        ubicacion_tipo = ?, ubicacion_codigo = ?, ubicacion_nombre = ?, responsable_usuario_id = ?
                        WHERE id = ?`, [destino.tipo, destino.codigo, destino.nombre, destino.usuario_id, e.id])
      this.auditar(u, 'REABRIR', 'expedientes', e.id, `${e.numero}: ${motivo}`)
      return { ok: true }
    })
  }

  corregir(u, id, datos) {
    this.exigir(u, 'corregir')
    const e = this.almacen.expedientes.get(Number(id))
    if (!e) throw new ErrorUsuario('El expediente no existe.', 'NO_EXISTE')
    if (u.rol === 'MESA_PARTES' && e.sistema !== 'URBANITO') {
      throw new ErrorUsuario('Mesa de partes solo corrige expedientes registrados en URBANITO.', 'PERMISO')
    }
    const cambios = {}
    const set = (campo, valor) => { if (valor !== undefined && valor !== e[campo]) cambios[campo] = valor }
    if (datos.solicitante !== undefined) {
      const s = texto(datos.solicitante, 200)
      if (s.length < 3) throw new ErrorUsuario('El solicitante no puede quedar vacío.')
      set('solicitante', s)
    }
    if (datos.documento_identidad !== undefined) {
      const d = texto(datos.documento_identidad, 20).toUpperCase()
      if (d && !/^(\d{8}|\d{11}|[A-Z0-9]{9,12})$/.test(d)) throw new ErrorUsuario('Documento de identidad inválido.')
      set('documento_identidad', d || null)
    }
    for (const c of ['telefono', 'direccion', 'asunto']) if (datos[c] !== undefined) set(c, texto(datos[c], 1000) || null)
    if (datos.folios !== undefined) {
      const f = Number(datos.folios)
      if (!Number.isInteger(f) || f < 1) throw new ErrorUsuario('Folios inválidos.')
      set('folios', f)
    }
    if (datos.procedimiento_codigo !== undefined) {
      const p = this.almacen.procedimientos.get(datos.procedimiento_codigo)
      if (!p || !p.activo) throw new ErrorUsuario('Procedimiento inválido.')
      set('procedimiento_codigo', p.codigo)
    }
    if (datos.fecha_ingreso !== undefined) {
      const movs = (this.almacen.movimientos.get(e.id) || []).filter(m => m.fecha_valida && m.fecha)
      const f = this.validarFecha(datos.fecha_ingreso, { nombre: 'La fecha de ingreso' })
      if (movs.length && f > movs[0].fecha) throw new ErrorUsuario(`La fecha de ingreso no puede ser posterior al primer movimiento (${formatoFecha(movs[0].fecha)}).`)
      set('fecha_ingreso', f)
      if (e.fecha_invalida) cambios.fecha_invalida = 0
    }
    const campos = Object.keys(cambios)
    if (!campos.length) throw new ErrorUsuario('No hay cambios que guardar.')
    const motivo = texto(datos.motivo, 500)
    if (motivo.length < 5) throw new ErrorUsuario('Indique el motivo de la corrección.')
    return this.escritura(e.id, () => {
      this.bd.ejecutar(`UPDATE expedientes SET ${campos.map(c => `${c} = ?`).join(', ')} WHERE id = ?`,
        [...campos.map(c => cambios[c]), e.id])
      const detalle = { motivo, antes: {}, despues: {} }
      for (const c of campos) { detalle.antes[c] = e[c]; detalle.despues[c] = cambios[c] }
      this.auditar(u, 'CORREGIR_EXPEDIENTE', 'expedientes', e.id, detalle)
      return { ok: true }
    })
  }

  // Cierre en lote de expedientes importados que en realidad ya se atendieron
  // en el sistema anterior (nunca se registró su cierre).
  depurarImportados(u, { ids, accion, observacion, procedimiento_codigo }) {
    this.exigir(u, 'depurar')
    if (!Array.isArray(ids) || !ids.length) throw new ErrorUsuario('Seleccione al menos un expediente.')
    if (ids.length > 500) throw new ErrorUsuario('Máximo 500 expedientes por operación.')
    if (!['ATENDIDO', 'ARCHIVAR', 'CLASIFICAR'].includes(accion)) throw new ErrorUsuario('Acción inválida.')
    const obs = texto(observacion, 1000)
    if (obs.length < 10) throw new ErrorUsuario('Indique cómo se verificó (mínimo 10 caracteres).')
    let procNuevo = null
    if (accion === 'CLASIFICAR') {
      procNuevo = this.almacen.procedimientos.get(procedimiento_codigo)
      if (!procNuevo || !procNuevo.activo || !procNuevo.seleccionable) throw new ErrorUsuario('Seleccione el trámite que corresponde.')
    }
    const lista = ids.map(i => {
      const e = this.almacen.expedientes.get(Number(i))
      if (!e) throw new ErrorUsuario(`El expediente ${i} no existe.`)
      if (!e.importado || !ACTIVOS.has(e.estado)) throw new ErrorUsuario(`El expediente ${e.numero} no es un importado en trámite.`)
      if (!this.enAlcance(u, e)) throw new ErrorUsuario(`El expediente ${e.numero} no es de su departamento.`, 'PERMISO')
      return e
    })
    this.bd.transaccion(() => {
      for (const e of lista) {
        const d = this.r.derivados.get(e.id)
        const fecha = d && d.ultima_fecha ? d.ultima_fecha : e.fecha_ingreso
        if (accion === 'CLASIFICAR') {
          this.bd.ejecutar('UPDATE expedientes SET procedimiento_codigo = ? WHERE id = ?', [procNuevo.codigo, e.id])
          this.auditar(u, 'CLASIFICAR_TRAMITE', 'expedientes', e.id,
            { motivo: obs, antes: { procedimiento_codigo: e.procedimiento_codigo }, despues: { procedimiento_codigo: procNuevo.codigo } })
          continue
        }
        if (accion === 'ATENDIDO') {
          this.bd.ejecutar(`UPDATE expedientes SET estado = 'CERRADO_HISTORICO', fecha_cierre = ?, motivo_cierre = ? WHERE id = ?`,
            [fecha, `Depuración: atendido en el sistema anterior; cierre = último movimiento registrado. ${obs}`, e.id])
        } else {
          this.bd.ejecutar(`UPDATE expedientes SET estado = 'ARCHIVADO', fecha_cierre = ?, motivo_cierre = ? WHERE id = ?`,
            [fecha, `Depuración: archivado. ${obs}`, e.id])
        }
        this.auditar(u, 'DEPURAR_IMPORTADO', 'expedientes', e.id, `${e.numero}: ${accion} — ${obs}`)
      }
    })
    for (const e of lista) this.recargarExpediente(e.id)
    this.recalcular()
    return { ok: true, cerrados: lista.length }
  }

  // =================================================================== AHP / PARÁMETROS
  simularAhp(u, { matriz }) {
    this.exigir(u, 'modelos_ver')
    const errores = validarMatriz(matriz)
    if (errores.length) return { valida: false, errores }
    return { valida: true, ...calcularAhp(matriz.map(f => f.map(Number))) }
  }

  guardarAhp(u, { matriz, justificacion }) {
    this.exigir(u, 'modelos_editar')
    const errores = validarMatriz(matriz)
    if (errores.length) throw new ErrorUsuario(errores.join(' '))
    const m = matriz.map(f => f.map(Number))
    const res = calcularAhp(m)
    if (!res.consistente) {
      throw new ErrorUsuario(`Los juicios no son consistentes (RC = ${res.rc.toFixed(3)} ≥ 0.10). Revise las comparaciones antes de guardar.`)
    }
    const just = texto(justificacion, 1000)
    if (just.length < 10) throw new ErrorUsuario('Explique por qué se cambian los juicios (mínimo 10 caracteres).')
    const cfg = this.almacen.configuracion
    const anterior = cfg.ahp.matriz
    const nueva = { ...cfg.ahp, matriz: m }
    this.bd.transaccion(() => {
      this.bd.ejecutar("UPDATE configuracion SET valor = ? WHERE clave = 'ahp'", [JSON.stringify(nueva)])
      this.auditar(u, 'CAMBIAR_PESOS_AHP', 'configuracion', 'ahp', { justificacion: just, anterior, nueva: m, rc: res.rc })
    })
    cfg.ahp = nueva
    this.recalcular()
    return { ok: true, ...res }
  }

  guardarParametros(u, datos) {
    this.exigir(u, 'usuarios')
    const cfg = this.almacen.configuracion
    const p = { ...cfg.parametros }
    if (datos.dias_alerta_por_vencer !== undefined) {
      const n = Number(datos.dias_alerta_por_vencer)
      if (!Number.isInteger(n) || n < 1 || n > 30) throw new ErrorUsuario('Días de alerta: entre 1 y 30.')
      p.dias_alerta_por_vencer = n
    }
    this.bd.transaccion(() => {
      this.bd.ejecutar("UPDATE configuracion SET valor = ? WHERE clave = 'parametros'", [JSON.stringify(p)])
      this.auditar(u, 'CAMBIAR_PARAMETROS', 'configuracion', 'parametros', { antes: cfg.parametros, despues: p })
    })
    cfg.parametros = p
    this.recalcular()
    return { ok: true }
  }

  // =================================================================== USUARIOS
  listarUsuarios(u) {
    this.exigir(u, 'usuarios')
    return [...this.usuarios.values()].sort((a, b) => a.usuario.localeCompare(b.usuario))
      .map(x => ({ ...this.usuarioPublico(x), bloqueado: !!(x.bloqueado_hasta && x.bloqueado_hasta > ahoraIso()) }))
  }

  crearUsuario(u, datos) {
    this.exigir(u, 'usuarios')
    const temporal = seg.claveTemporal()
    let id
    this.bd.transaccion(() => {
      id = this.insertarUsuario(datos, temporal, true)
      this.auditar(u, 'CREAR_USUARIO', 'usuarios', id, `${datos.usuario} (${datos.rol})`)
    })
    this.cargarCatalogos()
    return { id, clave_temporal: temporal }
  }

  editarUsuario(u, id, datos) {
    this.exigir(u, 'usuarios')
    const x = this.usuarios.get(Number(id))
    if (!x) throw new ErrorUsuario('El usuario no existe.')
    const rol = datos.rol || x.rol
    if (!seg.ROLES[rol]) throw new ErrorUsuario('Rol inválido.')
    const dep = datos.departamento_codigo === undefined ? x.departamento_codigo : (datos.departamento_codigo || null)
    const lista0 = datos.departamentos !== undefined ? datos.departamentos
      : (datos.departamento_codigo === undefined ? x.departamentos : null)
    const { principal, lista } = this.validarDepartamentoRol(rol, dep, lista0)
    const nombre = datos.nombre_completo === undefined ? x.nombre_completo : texto(datos.nombre_completo, 120)
    if (nombre.length < 3) throw new ErrorUsuario('Ingrese el nombre completo.')
    const alias = datos.alias_historico === undefined ? x.alias_historico
      : (texto(datos.alias_historico, 60).toUpperCase() || null)
    const activo = datos.activo === undefined ? x.activo : (datos.activo ? 1 : 0)
    if (x.id === u.id && (!activo || rol !== 'ADMINISTRADOR')) {
      throw new ErrorUsuario('No puede desactivarse ni quitarse el rol de administrador a sí mismo.')
    }
    if (x.rol === 'ADMINISTRADOR' && (rol !== 'ADMINISTRADOR' || !activo)) {
      const admins = [...this.usuarios.values()].filter(v => v.rol === 'ADMINISTRADOR' && v.activo).length
      if (admins <= 1) throw new ErrorUsuario('Debe quedar al menos un administrador activo.')
    }
    this.bd.transaccion(() => {
      this.bd.ejecutar(`UPDATE usuarios SET nombre_completo = ?, rol = ?, departamento_codigo = ?,
                        alias_historico = ?, activo = ? WHERE id = ?`, [nombre, rol, principal, alias, activo, x.id])
      this.guardarDepartamentosUsuario(x.id, lista)
      this.auditar(u, 'EDITAR_USUARIO', 'usuarios', x.id, {
        antes: { nombre: x.nombre_completo, rol: x.rol, dep: x.departamento_codigo, departamentos: x.departamentos,
                 alias: x.alias_historico, activo: x.activo },
        despues: { nombre, rol, dep: principal, departamentos: lista, alias, activo } })
    })
    if (!activo || rol !== x.rol) this.sesiones.cerrarDeUsuario(x.id)
    this.cargarCatalogos()
    this.recalcular()
    return { ok: true }
  }

  restablecerClave(u, id) {
    this.exigir(u, 'usuarios')
    const x = this.usuarios.get(Number(id))
    if (!x) throw new ErrorUsuario('El usuario no existe.')
    const temporal = seg.claveTemporal()
    const { hash, sal } = seg.cifrarClave(temporal)
    this.bd.transaccion(() => {
      this.bd.ejecutar(`UPDATE usuarios SET hash = ?, sal = ?, debe_cambiar_clave = 1, intentos_fallidos = 0,
                        bloqueado_hasta = NULL WHERE id = ?`, [hash, sal, x.id])
      this.auditar(u, 'RESTABLECER_CLAVE', 'usuarios', x.id, x.usuario)
    })
    this.sesiones.cerrarDeUsuario(x.id)
    this.cargarCatalogos()
    return { clave_temporal: temporal }
  }

  // Nombres de responsables que aparecen en los registros importados, para
  // vincular un usuario nuevo con su historial.
  aliasHistoricos(u) {
    this.exigir(u, 'usuarios')
    return this.bd.todas(`SELECT destino_codigo AS codigo, destino_nombre AS nombre, COUNT(*) AS movimientos
                          FROM movimientos WHERE destino_tipo = 'RESPONSABLE' AND importado = 1
                          GROUP BY destino_codigo ORDER BY movimientos DESC`)
  }

  // =================================================================== CATÁLOGOS
  editarProcedimiento(u, codigo, datos) {
    this.exigir(u, 'usuarios')
    const p = this.almacen.procedimientos.get(codigo)
    if (!p) throw new ErrorUsuario('El procedimiento no existe.')
    const n = { ...p }
    if (datos.plazo_tupa !== undefined) {
      if (datos.plazo_tupa === null || datos.plazo_tupa === '') n.plazo_tupa = null
      else {
        const v = Number(datos.plazo_tupa)
        if (!Number.isInteger(v) || v < 0 || v > 365) throw new ErrorUsuario('Plazo TUPA: número entero de días hábiles (0 a 365) o vacío si no tiene.')
        n.plazo_tupa = v
      }
    }
    if (datos.departamento_codigo !== undefined) {
      if (datos.departamento_codigo && !this.departamentos.has(datos.departamento_codigo)) throw new ErrorUsuario('Departamento inválido.')
      n.departamento_codigo = datos.departamento_codigo || null
    }
    for (const c of ['tupa_codigo', 'tupa_nombre']) if (datos[c] !== undefined) n[c] = texto(datos[c], 200) || null
    for (const c of ['seleccionable', 'activo']) if (datos[c] !== undefined) n[c] = datos[c] ? 1 : 0
    const motivo = texto(datos.motivo, 500)
    if (motivo.length < 5) throw new ErrorUsuario('Indique el motivo o la norma que sustenta el cambio.')
    this.bd.transaccion(() => {
      this.bd.ejecutar(`UPDATE procedimientos SET plazo_tupa = ?, departamento_codigo = ?, tupa_codigo = ?,
                        tupa_nombre = ?, seleccionable = ?, activo = ? WHERE codigo = ?`,
        [n.plazo_tupa, n.departamento_codigo, n.tupa_codigo, n.tupa_nombre, n.seleccionable, n.activo, codigo])
      this.auditar(u, 'EDITAR_PROCEDIMIENTO', 'procedimientos', codigo, { motivo, antes: p, despues: n })
    })
    this.almacen.procedimientos.set(codigo, n)
    this.recalcular()
    return { ok: true }
  }

  agregarFeriado(u, { fecha, nombre }) {
    this.exigir(u, 'usuarios')
    const f = texto(fecha, 10)
    if (!this.cal.indice(f)) throw new ErrorUsuario('Fecha inválida.')
    const n = texto(nombre, 120)
    if (n.length < 3) throw new ErrorUsuario('Indique el nombre del feriado o la norma que lo declara.')
    if (this.bd.una('SELECT fecha FROM feriados WHERE fecha = ?', [f])) throw new ErrorUsuario('Esa fecha ya está registrada.')
    this.bd.transaccion(() => {
      this.bd.ejecutar("INSERT INTO feriados VALUES (?,?,'ADMINISTRADOR')", [f, n])
      this.auditar(u, 'AGREGAR_FERIADO', 'feriados', f, n)
    })
    this.recargarCalendario()
    return { ok: true }
  }

  eliminarFeriado(u, { fecha }) {
    this.exigir(u, 'usuarios')
    const f = this.bd.una('SELECT * FROM feriados WHERE fecha = ?', [fecha])
    if (!f) throw new ErrorUsuario('La fecha no está registrada.')
    if (f.origen === 'LEY') throw new ErrorUsuario('Los feriados nacionales cargados de fábrica no se eliminan.')
    this.bd.transaccion(() => {
      this.bd.ejecutar('DELETE FROM feriados WHERE fecha = ?', [fecha])
      this.auditar(u, 'ELIMINAR_FERIADO', 'feriados', fecha, f.nombre)
    })
    this.recargarCalendario()
    return { ok: true }
  }

  recargarCalendario() {
    this.almacen.feriados = this.bd.todas('SELECT fecha FROM feriados').map(f => f.fecha)
    this.cal = new Calendario(this.almacen.feriados)
    this.recalcular()
  }

  // =================================================================== RESPALDOS
  nombreRespaldo(tipo) {
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    return `urbanito_${tipo}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.db`
  }

  respaldoAutomatico() {
    if (!this.carpetaRespaldos) return
    fs.mkdirSync(this.carpetaRespaldos, { recursive: true })
    const hoy = this.hoy().replace(/-/g, '')
    const existentes = fs.readdirSync(this.carpetaRespaldos).filter(f => f.startsWith('urbanito_automatico_')).sort()
    if (!existentes.some(f => f.includes(`_${hoy}_`))) {
      fs.copyFileSync(this.rutaBd, path.join(this.carpetaRespaldos, this.nombreRespaldo('automatico')))
    }
    const todos = fs.readdirSync(this.carpetaRespaldos).filter(f => f.startsWith('urbanito_automatico_')).sort()
    for (const viejo of todos.slice(0, Math.max(0, todos.length - 15))) {
      fs.unlinkSync(path.join(this.carpetaRespaldos, viejo))
    }
  }

  crearRespaldo(u) {
    this.exigir(u, 'usuarios')
    fs.mkdirSync(this.carpetaRespaldos, { recursive: true })
    this.bd.guardar()
    const nombre = this.nombreRespaldo('manual')
    fs.copyFileSync(this.rutaBd, path.join(this.carpetaRespaldos, nombre))
    this.bd.transaccion(() => this.auditar(u, 'CREAR_RESPALDO', 'respaldos', nombre, null))
    return { ok: true, nombre }
  }

  listarRespaldos(u) {
    this.exigir(u, 'usuarios')
    if (!fs.existsSync(this.carpetaRespaldos)) return []
    return fs.readdirSync(this.carpetaRespaldos).filter(f => f.endsWith('.db')).sort().reverse().map(f => {
      const st = fs.statSync(path.join(this.carpetaRespaldos, f))
      return { nombre: f, tamano: st.size, fecha: st.mtime.toISOString(),
               tipo: f.includes('_automatico_') ? 'Automático' : f.includes('_antes_restaurar_') ? 'Previo a restaurar' : 'Manual' }
    })
  }

  rutaRespaldo(nombre) {
    if (!/^urbanito_[a-z_]+_\d{8}_\d{6}\.db$/.test(nombre)) throw new ErrorUsuario('Nombre de respaldo inválido.')
    const r = path.join(this.carpetaRespaldos, nombre)
    if (!fs.existsSync(r)) throw new ErrorUsuario('El respaldo no existe.')
    return r
  }

  async restaurarRespaldo(u, { ruta }) {
    this.exigir(u, 'usuarios')
    // validar el archivo antes de tocar nada
    const prueba = await BaseDatos.abrir(ruta)
    try {
      for (const t of ['expedientes', 'movimientos', 'procedimientos', 'configuracion', 'feriados', 'usuarios']) {
        if (!prueba.una("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [t])) {
          throw new ErrorUsuario('El archivo no es un respaldo de URBANITO.')
        }
      }
      if (!prueba.una("SELECT COUNT(*) n FROM usuarios WHERE rol='ADMINISTRADOR' AND activo=1").n) {
        throw new ErrorUsuario('El respaldo no tiene un administrador activo; no se puede restaurar.')
      }
    } finally {
      prueba.cerrar()
    }
    this.bd.guardar()
    fs.mkdirSync(this.carpetaRespaldos, { recursive: true })
    const previo = this.nombreRespaldo('antes_restaurar')
    fs.copyFileSync(this.rutaBd, path.join(this.carpetaRespaldos, previo))
    this.bd.cerrar()
    fs.copyFileSync(ruta, this.rutaBd)
    this.bd = await BaseDatos.abrir(this.rutaBd)
    this.bd.db.exec(ESQUEMA)
    this.bd.migrar()
    this.verificarIntegridad()
    this.cargar()
    this.bd.transaccion(() => this.auditar(u, 'RESTAURAR_RESPALDO', 'respaldos', path.basename(ruta),
      `Copia de seguridad previa: ${previo}`))
    this.sesiones = new seg.Sesiones()
    return { ok: true, previo }
  }

  // =================================================================== AUDITORÍA
  auditoria(u, { desde, hasta, usuario, accion, texto: q, pagina = 1 } = {}) {
    this.exigir(u, 'usuarios')
    const cond = [], p = []
    if (desde) { cond.push('fecha_hora >= ?'); p.push(desde) }
    if (hasta) { cond.push('fecha_hora < ?'); p.push(`${hasta}T99`) }
    if (usuario) { cond.push('usuario = ?'); p.push(usuario) }
    if (accion) { cond.push('accion = ?'); p.push(accion) }
    if (q) { cond.push('(detalle LIKE ? OR entidad_id LIKE ?)'); p.push(`%${q}%`, `%${q}%`) }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : ''
    const total = this.bd.una(`SELECT COUNT(*) n FROM auditoria ${where}`, p).n
    const tam = 100
    const filas = this.bd.todas(`SELECT * FROM auditoria ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...p, tam, (Math.max(1, pagina) - 1) * tam])
    const acciones = this.bd.todas('SELECT DISTINCT accion FROM auditoria ORDER BY accion').map(a => a.accion)
    return { total, pagina, tam, filas, acciones }
  }
}

function formatoFecha(f) {
  if (!f) return '—'
  const [a, m, d] = f.split('-')
  return `${d}/${m}/${a}`
}

module.exports = { Sistema, ErrorUsuario, ESTADOS, CERRADOS, RESULTADOS_FINALIZACION, MOTIVOS_ARCHIVO, formatoFecha, texto, ahoraIso }

// Las consultas (pantallas de solo lectura) están en consultas.js
require('./consultas')
require('./usuariosDepartamento')
require('./importacion')
