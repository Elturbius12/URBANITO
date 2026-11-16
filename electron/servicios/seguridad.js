// Seguridad: contraseñas, sesiones, roles y permisos.
// Los permisos se verifican aquí, en el proceso que guarda los datos; la
// interfaz solo oculta lo que el usuario no puede usar.

const crypto = require('crypto')

const ROLES = {
  ADMINISTRADOR: {
    nombre: 'Administrador del sistema',
    descripcion: 'Gestiona usuarios, catálogos, feriados, respaldos y auditoría. Ve todo.',
  },
  GERENTE: {
    nombre: 'Gerente',
    descripcion: 'Alta dirección: tablero gerencial de todos los departamentos, reportes y pesos del modelo IUA.',
  },
  JEFE_DEPARTAMENTO: {
    nombre: 'Jefe de departamento',
    descripcion: 'Bandeja priorizada de su departamento: asigna, deriva, observa y finaliza expedientes.',
  },
  TECNICO: {
    nombre: 'Técnico / especialista',
    descripcion: 'Atiende los expedientes que tiene asignados.',
  },
  MESA_PARTES: {
    nombre: 'Mesa de partes',
    descripcion: 'Registra expedientes nuevos, recibe subsanaciones y consulta el estado para el ciudadano.',
  },
}

// Permisos de la v2 (asignación óptima y seguimiento):
//   asignaciones      ejecutar el modelo MILP y confirmar asignaciones (solo ADMINISTRADOR, vía '*')
//   asignaciones_ver  ver las asignaciones confirmadas (de su alcance)
//   seguimiento       panel de avance de todos los trabajadores y consolidado semanal
//   mis_asignaciones  ver y actualizar las asignaciones propias
//   reporte_semanal   llenar el reporte semanal de los jueves
// Las notificaciones propias no requieren permiso: todo usuario con sesión las ve.
const PERMISOS = {
  ADMINISTRADOR: ['*'],
  GERENTE: ['consultar', 'bandeja', 'alertas', 'tablero', 'departamentos', 'modelos_ver',
            'modelos_editar', 'reportes', 'derivar', 'observar', 'subsanar', 'finalizar',
            'archivar', 'depurar', 'importar', 'seguimiento', 'asignaciones_ver'],
  JEFE_DEPARTAMENTO: ['consultar', 'bandeja', 'alertas', 'tablero', 'departamentos', 'modelos_ver',
                      'reportes', 'derivar', 'observar', 'subsanar', 'finalizar', 'archivar', 'depurar', 'importar',
                      'asignaciones_ver',
                      // los jefes también atienden expedientes (son parte de los 15 trabajadores del modelo)
                      'mis_asignaciones', 'reporte_semanal'],
  TECNICO: ['consultar', 'bandeja', 'alertas', 'modelos_ver', 'derivar', 'observar', 'subsanar',
            'finalizar', 'archivar', 'mis_asignaciones', 'reporte_semanal'],
  MESA_PARTES: ['consultar', 'registrar', 'subsanar', 'modelos_ver', 'corregir', 'importar'],
}

function tienePermiso(rol, permiso) {
  const lista = PERMISOS[rol] || []
  return lista.includes('*') || lista.includes(permiso)
}

// ---------------------------------------------------------------- claves
const N_SCRYPT = { N: 16384, r: 8, p: 1 }

function cifrarClave(clave, sal = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(clave), sal, 64, N_SCRYPT).toString('hex')
  return { hash, sal }
}

function verificarClave(clave, hash, sal) {
  const calc = crypto.scryptSync(String(clave), sal, 64, N_SCRYPT)
  const guardado = Buffer.from(hash, 'hex')
  return guardado.length === calc.length && crypto.timingSafeEqual(guardado, calc)
}

function validarClaveNueva(clave) {
  const errores = []
  if (typeof clave !== 'string' || clave.length < 8) errores.push('al menos 8 caracteres')
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(clave || '')) errores.push('al menos una letra')
  if (!/\d/.test(clave || '')) errores.push('al menos un número')
  return errores.length ? `La contraseña debe tener ${errores.join(', ')}.` : null
}

function claveTemporal() {
  // sin caracteres ambiguos (0/O, 1/l/I)
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let s = ''
  const bytes = crypto.randomBytes(10)
  for (const b of bytes) s += abc[b % abc.length]
  return s.slice(0, 6) + String(2 + (bytes[0] % 8)) + s.slice(6, 9)
}

// ---------------------------------------------------------------- sesiones
const DURACION_MAX_MS = 12 * 3600 * 1000      // jornada completa
const INACTIVIDAD_MS = 2 * 3600 * 1000         // 2 horas sin usar el programa
const MAX_INTENTOS = 5
const BLOQUEO_MIN = 5

class Sesiones {
  constructor() {
    this.activas = new Map()
  }

  crear(usuario) {
    const token = crypto.randomBytes(32).toString('hex')
    const ahora = Date.now()
    this.activas.set(token, { token, usuario_id: usuario.id, creada: ahora, ultimo_uso: ahora })
    return token
  }

  obtener(token) {
    const s = token && this.activas.get(token)
    if (!s) return null
    const ahora = Date.now()
    if (ahora - s.creada > DURACION_MAX_MS || ahora - s.ultimo_uso > INACTIVIDAD_MS) {
      this.activas.delete(token)
      return null
    }
    s.ultimo_uso = ahora
    return s
  }

  cerrar(token) {
    this.activas.delete(token)
  }

  cerrarDeUsuario(usuarioId) {
    for (const [t, s] of this.activas) if (s.usuario_id === usuarioId) this.activas.delete(t)
  }
}

module.exports = {
  ROLES, PERMISOS, tienePermiso, cifrarClave, verificarClave, validarClaveNueva,
  claveTemporal, Sesiones, MAX_INTENTOS, BLOQUEO_MIN,
}
