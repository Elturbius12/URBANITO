// ===========================================================================
// PORTAL CIUDADANO — administrados y consulta de sus trámites
// Se agregan como métodos de Sistema (ver sistema.js).
//
// Credenciales (regla de la Gerencia):
//   usuario    = nombres + apellidos, en mayúsculas, sin espacios ni tildes
//   contraseña = iniciales de los nombres + DNI + iniciales de los apellidos
//   Ej.: JULIO FRANCISCO / CRUZ CHOQUEHUANCA, DNI 60062237
//        usuario JULIOFRANCISCOCRUZCHOQUEHUANCA · contraseña JF60062237CC
// Como la contraseña inicial se deduce de datos conocidos, el portal OBLIGA a
// cambiarla en el primer ingreso y bloquea tras 5 intentos fallidos.
//
// El portal (carpeta portal/) no abre la base: llama a estas acciones
// públicas por el servidor de red de URBANITO. El ciudadano solo ve sus
// trámites: número, trámite, estado, fechas y departamento. Nunca el IUA, el
// trabajador asignado ni las observaciones internas.
// ===========================================================================

const { Sistema, ErrorUsuario, texto, ahoraIso } = require('./sistema')
const { normalizarOrigen } = require('../motor/clasificacion')
const seg = require('./seguridad')

const P = Sistema.prototype

const URL_PORTAL_DEFECTO = 'http://localhost:7302'
const ESTADOS_PUBLICOS = {
  EN_TRAMITE: 'En trámite', OBSERVADO: 'Observado: acérquese a mesa de partes para subsanar', FINALIZADO: 'Atendido',
  ARCHIVADO: 'Archivado', CERRADO_HISTORICO: 'Concluido', SIN_FECHA: 'En revisión', INCOMPLETO: 'En revisión',
}

const soloLetras = (s) => normalizarOrigen(s).replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim()
const iniciales = (s) => soloLetras(s).split(' ').filter(Boolean).map(p => p[0]).join('')

// Separa «NOMBRES APELLIDOS» suponiendo que los dos últimos términos son los apellidos
// (la interfaz muestra el resultado para que mesa de partes lo corrija).
function separarNombre(completo) {
  const p = soloLetras(completo).split(' ').filter(Boolean)
  if (p.length <= 2) return { nombres: p[0] || '', apellidos: p.slice(1).join(' ') }
  return { nombres: p.slice(0, -2).join(' '), apellidos: p.slice(-2).join(' ') }
}

function generarCredenciales({ nombres, apellidos, dni }) {
  const n = soloLetras(nombres), a = soloLetras(apellidos)
  return { usuario: `${n}${a}`.replace(/ /g, ''), clave: `${iniciales(n)}${dni}${iniciales(a)}` }
}

P.urlPortal = function () {
  return (this.almacen.configuracion.parametros || {}).portal_url || URL_PORTAL_DEFECTO
}

P.mensajeWhatsapp = function (nombre, usuario, clave) {
  return `Estimado ${nombre}, su trámite ha sido registrado en la Municipalidad Provincial de San Román. ` +
    `Para consultar el estado de sus trámites ingrese a ${this.urlPortal()}. Usuario: ${usuario} | Contraseña: ${clave}. ` +
    'Cambie su contraseña en el primer ingreso.'
}

P.enlaceWhatsapp = function (telefono, mensaje) {
  let t = String(telefono || '').replace(/\D/g, '')
  if (t.length === 9) t = `51${t}`                  // celular peruano sin código de país
  return t.length >= 11 ? `https://wa.me/${t}?text=${encodeURIComponent(mensaje)}` : null
}

// Mesa de partes: ¿el DNI ya tiene cuenta en el portal?
P.administradoBuscar = function (u, { dni } = {}) {
  this.exigir(u, 'registrar')
  const d = texto(dni, 12)
  if (!/^\d{8}$/.test(d)) return { aplica: false }
  const a = this.bd.una('SELECT id, nombre_completo, telefono_whatsapp, usuario_portal, creado_en FROM administrados WHERE documento_identidad = ?', [d])
  return { aplica: true, existe: !!a, administrado: a || null }
}

P.separarNombreAdministrado = function (u, { nombre } = {}) {
  this.exigir(u, 'registrar')
  return separarNombre(nombre)
}

// Crea la cuenta si el DNI es nuevo. Debe llamarse DENTRO de una transacción.
// Devuelve las credenciales (la contraseña solo existe aquí: se guarda cifrada).
P.registrarAdministradoSiNuevo = function (u, { dni, nombres, apellidos, whatsapp }) {
  if (!/^\d{8}$/.test(String(dni || ''))) return null
  if (this.bd.una('SELECT id FROM administrados WHERE documento_identidad = ?', [dni])) return null
  const n = soloLetras(nombres), a = soloLetras(apellidos)
  if (n.length < 2 || a.length < 2) {
    throw new ErrorUsuario('Para crear el acceso al portal ciudadano indique por separado los nombres y los apellidos del solicitante.')
  }
  const tel = String(whatsapp || '').replace(/\D/g, '')
  if (tel && !/^(51)?9\d{8}$/.test(tel)) throw new ErrorUsuario('WhatsApp: escriba un celular de 9 dígitos que empiece con 9.')
  let { usuario, clave } = generarCredenciales({ nombres: n, apellidos: a, dni })
  // homónimos: se agregan los 3 últimos dígitos del DNI
  if (this.bd.una('SELECT id FROM administrados WHERE usuario_portal = ?', [usuario])) usuario = `${usuario}${dni.slice(-3)}`
  const { hash, sal } = seg.cifrarClave(clave)
  const nombre = `${n} ${a}`
  const id = this.bd.ejecutar(`INSERT INTO administrados(documento_identidad, nombre_completo, telefono_whatsapp, usuario_portal,
      clave_portal_hash, clave_portal_sal, activo, creado_en) VALUES (?,?,?,?,?,?,1,?)`,
    [dni, nombre, tel || null, usuario, hash, sal, ahoraIso()]).ultimoId
  this.auditar(u, 'CREAR_ADMINISTRADO', 'administrados', id, { dni, usuario_portal: usuario, whatsapp: !!tel })
  const mensaje = this.mensajeWhatsapp(nombre, usuario, clave)
  return { id, nombre, usuario, clave, whatsapp: tel || null, mensaje, enlace_whatsapp: tel ? this.enlaceWhatsapp(tel, mensaje) : null,
           url_portal: this.urlPortal() }
}

// Mesa de partes: nueva contraseña inicial (p. ej. si el ciudadano la olvidó)
P.administradoRestablecer = function (u, { dni } = {}) {
  this.exigir(u, 'registrar')
  const a = this.bd.una('SELECT * FROM administrados WHERE documento_identidad = ?', [texto(dni, 12)])
  if (!a) throw new ErrorUsuario('Ese DNI no tiene acceso al portal.', 'NO_EXISTE')
  const { nombres, apellidos } = separarNombre(a.nombre_completo)
  const { clave } = generarCredenciales({ nombres, apellidos, dni: a.documento_identidad })
  const { hash, sal } = seg.cifrarClave(clave)
  this.bd.transaccion(() => {
    this.bd.ejecutar('UPDATE administrados SET clave_portal_hash = ?, clave_portal_sal = ?, primer_acceso = NULL WHERE id = ?', [hash, sal, a.id])
    this.auditar(u, 'RESTABLECER_ADMINISTRADO', 'administrados', a.id, a.documento_identidad)
  })
  const mensaje = this.mensajeWhatsapp(a.nombre_completo, a.usuario_portal, clave)
  return { nombre: a.nombre_completo, usuario: a.usuario_portal, clave, mensaje,
           enlace_whatsapp: a.telefono_whatsapp ? this.enlaceWhatsapp(a.telefono_whatsapp, mensaje) : null }
}

// =================================================================== acciones públicas del portal
const intentos = new Map()           // usuario_portal -> { n, hasta }

function sesionesPortal(s) {
  if (!s.sesionesPortal) s.sesionesPortal = new seg.Sesiones()
  return s.sesionesPortal
}

P.portalAdministrado = function (token) {
  const ses = sesionesPortal(this).obtener(token)
  if (!ses) throw new ErrorUsuario('Su sesión terminó. Vuelva a ingresar.', 'SESION')
  const a = this.bd.una('SELECT * FROM administrados WHERE id = ? AND activo = 1', [ses.usuario_id])
  if (!a) throw new ErrorUsuario('Su acceso fue desactivado.', 'SESION')
  return a
}

P.portalIngresar = function ({ usuario, clave } = {}) {
  // se acepta con o sin espacios/tildes; los homónimos llevan dígitos al final
  const clave_usuario = normalizarOrigen(usuario).replace(/[^A-Z0-9]/g, '')
  const a = clave_usuario ? this.bd.una('SELECT * FROM administrados WHERE usuario_portal = ?', [clave_usuario]) : null
  const generico = new ErrorUsuario('Usuario o contraseña incorrectos.', 'CREDENCIALES')
  if (!a || !a.activo) throw generico
  const reg = intentos.get(a.id)
  if (reg && reg.hasta > Date.now()) throw new ErrorUsuario('Demasiados intentos. Espere 5 minutos.', 'BLOQUEADO')
  if (!seg.verificarClave(String(clave || ''), a.clave_portal_hash, a.clave_portal_sal)) {
    // si hubo un bloqueo y ya venció, se empieza de cero; si no, se acumula
    const previos = !reg || (reg.hasta && reg.hasta <= Date.now()) ? 0 : reg.n
    const n = previos + 1
    intentos.set(a.id, { n, hasta: n >= seg.MAX_INTENTOS ? Date.now() + seg.BLOQUEO_MIN * 60000 : 0 })
    throw generico
  }
  intentos.delete(a.id)
  const token = sesionesPortal(this).crear({ id: a.id })
  return { token, nombre: a.nombre_completo, debe_cambiar_clave: !a.primer_acceso }
}

P.portalCambiarClave = function ({ token, actual, nueva } = {}) {
  const a = this.portalAdministrado(token)
  if (!seg.verificarClave(String(actual || ''), a.clave_portal_hash, a.clave_portal_sal)) throw new ErrorUsuario('La contraseña actual no es correcta.')
  const err = seg.validarClaveNueva(nueva)
  if (err) throw new ErrorUsuario(err)
  if (String(nueva).includes(a.documento_identidad)) throw new ErrorUsuario('La nueva contraseña no debe contener su DNI.')
  const { hash, sal } = seg.cifrarClave(nueva)
  this.bd.transaccion(() => {
    this.bd.ejecutar('UPDATE administrados SET clave_portal_hash = ?, clave_portal_sal = ?, primer_acceso = COALESCE(primer_acceso, ?) WHERE id = ?',
      [hash, sal, ahoraIso(), a.id])
    this.auditar({ id: null, usuario: `portal:${a.usuario_portal}` }, 'PORTAL_CAMBIAR_CLAVE', 'administrados', a.id, null)
  })
  return { ok: true }
}

P.portalSalir = function ({ token } = {}) {
  sesionesPortal(this).cerrar(token)
  return { ok: true }
}

// Lista pública de trámites de un DNI (solo datos que el ciudadano puede ver)
P.tramitesPublicos = function (dni) {
  const hoy = this.hoy()
  return [...this.almacen.expedientes.values()].filter(e => e.documento_identidad === dni)
    .sort((a, b) => (b.fecha_ingreso || '').localeCompare(a.fecha_ingreso || ''))
    .map(e => {
      const p = this.almacen.procedimientos.get(e.procedimiento_codigo) || {}
      const i = this.r.iua.get(e.id)
      let departamento = null
      if (e.ubicacion_tipo === 'DEPARTAMENTO') departamento = (this.departamentos.get(e.ubicacion_codigo) || {}).nombre || null
      else if (e.ubicacion_tipo === 'USUARIO') {
        const usr = this.usuarios.get(Number(e.ubicacion_codigo))
        departamento = usr && usr.departamento_codigo ? (this.departamentos.get(usr.departamento_codigo) || {}).nombre : 'Gerencia de Desarrollo Urbano'
      } else if (e.ubicacion_tipo === 'UNIDAD ORGANICA') departamento = (this.unidades.get(e.ubicacion_codigo) || {}).nombre || e.ubicacion_nombre
      if (!departamento && p.departamento_codigo) departamento = (this.departamentos.get(p.departamento_codigo) || {}).nombre
      let estimada = i ? i.fecha_limite : null
      if (!estimada && i) {
        const mt = this.r.mta.tramite.get(e.procedimiento_codigo)
        if (mt && mt.datos_suficientes && e.fecha_ingreso) estimada = this.cal.fechaLimite(e.fecha_ingreso, Math.ceil(mt.mediana))
      }
      return {
        numero: e.numero, tramite: p.nombre || 'Trámite', estado: ESTADOS_PUBLICOS[e.estado] || 'En revisión',
        fecha_ingreso: e.fecha_ingreso, fecha_estimada: i ? estimada : null, fecha_atencion: i ? null : e.fecha_cierre,
        departamento_actual: i ? departamento : null, en_curso: !!i, vencido: !!(i && i.vencido),
        plazo_tupa: p.plazo_tupa ?? null, hoy,
      }
    })
}

P.portalMisTramites = function ({ token } = {}) {
  const a = this.portalAdministrado(token)
  if (!a.primer_acceso) throw new ErrorUsuario('Debe cambiar su contraseña antes de continuar.', 'CAMBIAR_CLAVE')
  return { nombre: a.nombre_completo, dni: a.documento_identidad, tramites: this.tramitesPublicos(a.documento_identidad),
           institucion: this.almacen.configuracion.institucion }
}

// GET /api/consulta/:dni del portal: solo el propio DNI del ciudadano autenticado
P.portalConsultaDni = function ({ token, dni } = {}) {
  const a = this.portalAdministrado(token)
  if (!a.primer_acceso) throw new ErrorUsuario('Debe cambiar su contraseña antes de continuar.', 'CAMBIAR_CLAVE')
  if (String(dni) !== a.documento_identidad) throw new ErrorUsuario('Solo puede consultar los trámites de su propio DNI.', 'PERMISO')
  return { dni: a.documento_identidad, tramites: this.tramitesPublicos(a.documento_identidad) }
}

module.exports = { generarCredenciales, separarNombre, ESTADOS_PUBLICOS, URL_PORTAL_DEFECTO }
