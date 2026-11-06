// Cuentas iniciales por departamento: un jefe y un técnico por cada uno de los
// 11 departamentos, más gerente, mesa de partes y (si falta) administrador.
// Cada cuenta recibe una contraseña temporal ALEATORIA (seg.claveTemporal) y
// debe cambiarla en su primer ingreso. Nunca hay contraseñas fijas en el código.
// Lo usan: la acción «Crear usuarios por departamento» (Usuarios.jsx), la
// configuración inicial (Acceso.jsx) y herramientas/crear_usuarios_departamentos.js.

const crypto = require('crypto')
const { Sistema, ErrorUsuario } = require('./sistema')
const seg = require('./seguridad')

const P = Sistema.prototype

// clave corta del usuario -> código del departamento
const CLAVES_DEPARTAMENTO = [
  ['numeracion', 'DEP_NUMERACION'],
  ['licencias', 'DEP_LICENCIAS_EDIF'],
  ['visado', 'DEP_VISADO_PLANOS'],
  ['parametros', 'DEP_PARAMETROS'],
  ['catastro', 'DEP_NEG_CATASTRO'],
  ['subdivision', 'DEP_SUBDIV_TIERRAS'],
  ['zonificacion', 'DEP_ZONIFICACION'],
  ['telecom', 'DEP_TELECOM'],
  ['compatuso', 'DEP_COMPAT_USO'],
  ['zanja', 'DEP_APERT_ZANJA'],
  ['ocupvia', 'DEP_OCUP_VIA'],
]

// Lista de cuentas a crear (nombres genéricos, editables por el administrador)
P.cuentasDepartamento = function () {
  const lista = []
  if (!this.bd.una("SELECT id FROM usuarios WHERE rol = 'ADMINISTRADOR'")) {
    lista.push({ usuario: 'admin', nombre_completo: 'Administrador del sistema', rol: 'ADMINISTRADOR', departamento_codigo: null })
  }
  lista.push({ usuario: 'gerente', nombre_completo: 'Gerente de Desarrollo Urbano', rol: 'GERENTE', departamento_codigo: null })
  lista.push({ usuario: 'mesa.partes', nombre_completo: 'Mesa de partes', rol: 'MESA_PARTES', departamento_codigo: null })
  for (const [clave, codigo] of CLAVES_DEPARTAMENTO) {
    const d = this.departamentos.get(codigo)
    if (!d) continue                                 // base sin ese departamento: no se inventa
    lista.push({ usuario: `jefe.${clave}`, nombre_completo: `Jefe del ${d.nombre}`, rol: 'JEFE_DEPARTAMENTO', departamento_codigo: codigo })
    lista.push({ usuario: `tecnico.${clave}`, nombre_completo: `Técnico del ${d.nombre}`, rol: 'TECNICO', departamento_codigo: codigo })
  }
  return lista
}

// Crea las cuentas que falten. Debe llamarse DENTRO de una transacción.
// actor: usuario que audita (o { id: null, usuario: 'consola' } desde el script).
P.crearCuentasDepartamento = function (actor) {
  const lote = `USUARIOS-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${crypto.randomBytes(2).toString('hex')}`
  const creados = [], omitidos = []
  for (const c of this.cuentasDepartamento()) {
    if (this.bd.una('SELECT id FROM usuarios WHERE usuario = ?', [c.usuario])) {
      omitidos.push({ usuario: c.usuario, motivo: 'Ya existe' })
      continue
    }
    const temporal = seg.claveTemporal()
    if (seg.validarClaveNueva(temporal)) throw new Error('La clave temporal generada no cumple la política')
    const id = this.insertarUsuario(c, temporal, true)
    this.auditar(actor, 'CREAR_USUARIO', 'usuarios', id,
      { lote, usuario: c.usuario, rol: c.rol, departamento: c.departamento_codigo, origen: 'Usuarios por departamento' })
    const dep = c.departamento_codigo ? this.departamentos.get(c.departamento_codigo) : null
    creados.push({ usuario: c.usuario, nombre: c.nombre_completo, rol: seg.ROLES[c.rol].nombre, rol_codigo: c.rol,
                   departamento: dep ? dep.nombre : null, clave_temporal: temporal })
  }
  return { lote, creados, omitidos }
}

// Acción «Crear usuarios por departamento» (solo ADMINISTRADOR). Idempotente.
P.crearUsuariosPorDepartamento = function (u) {
  this.exigir(u, 'usuarios')
  if (u.rol !== 'ADMINISTRADOR') throw new ErrorUsuario('Solo el administrador puede crear usuarios en lote.', 'PERMISO')
  const r = this.bd.transaccion(() => this.crearCuentasDepartamento(u))
  this.cargarCatalogos()
  return r
}

module.exports = { CLAVES_DEPARTAMENTO }
