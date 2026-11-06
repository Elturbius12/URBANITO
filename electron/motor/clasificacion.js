// ===========================================================================
// CLASIFICACIÓN DE DATOS DE ORIGEN — port a JS de las reglas de
// herramientas/catalogo_tramites.py y catalogo_dependencias.py.
// Las reglas vienen de reglas_origen.json, generado desde los .py por
// herramientas/exportar_reglas.py (una sola fuente de verdad).
// ===========================================================================

const REGLAS = require('./reglas_origen.json')

const TIPO_UNIDAD = 'UNIDAD ORGANICA'
const TIPO_RESPONSABLE = 'RESPONSABLE'
const TIPO_ESTADO = 'ESTADO'
const TIPO_VACIO = 'SIN DATO'
const TIPO_NO_IDENT = 'NO IDENTIFICADO'

// Igual que normalizar() de los catálogos Python
function normalizarOrigen(texto) {
  if (texto === null || texto === undefined) return ''
  let s = String(texto).trim().toUpperCase()
  if (s === 'NAN' || s === 'NONE' || s === '') return ''
  s = s.normalize('NFD').replace(/\p{Mn}/gu, '')
  s = s.replace(/[^A-Z0-9 ]/g, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

const TRAMITES = REGLAS.tramites.map(t => ({ ...t, rx: new RegExp(t.patron) }))
const UNIDADES = REGLAS.unidades
const ESTADOS_ORIGEN = REGLAS.estados
const RX_PREFIJO = new RegExp(REGLAS.prefijos_cargo)
const RX_TRANSITO = new RegExp(REGLAS.rx_transito)

// Sinónimos de sigla (GDU / GEDU): el primer código con el mismo nombre manda,
// como en preparar_semilla.py
const CANON = {}
{
  const porNombre = {}
  for (const [sigla, [nombre]] of Object.entries(UNIDADES)) {
    if (!(nombre in porNombre)) porNombre[nombre] = sigla
    CANON[sigla] = porNombre[nombre]
  }
}

function titulo(s) {
  return s.toLowerCase().replace(/(^|[^a-z0-9])([a-z])/g, (_, a, b) => a + b.toUpperCase())
}

// clasificar_destino() de catalogo_dependencias.py + unificación de sinónimos
function clasificarDestino(texto) {
  let s = normalizarOrigen(texto)
  if (!s) return { tipo: TIPO_VACIO, codigo: null, nombre: null }
  s = s.replace(RX_TRANSITO, '').trim()
  const sinCargo = s.replace(RX_PREFIJO, '').trim()
  for (const [clave, nombre] of Object.entries(ESTADOS_ORIGEN)) {
    if (s === clave || sinCargo === clave) return { tipo: TIPO_ESTADO, codigo: clave, nombre }
  }
  const unidad = (sigla) => ({ tipo: TIPO_UNIDAD, codigo: CANON[sigla] || sigla, nombre: UNIDADES[sigla][0] })
  if (UNIDADES[s]) return unidad(s)
  const tokens = s.split(' ')
  const encontradas = tokens.filter(t => UNIDADES[t])
  if (encontradas.length) {
    const subs = encontradas.filter(t => UNIDADES[t][1] === 'Sub Gerencia')
    return unidad(subs.length ? subs[subs.length - 1] : encontradas[encontradas.length - 1])
  }
  if (tokens.length <= 2 && tokens.every(t => /^[A-Z]+$/.test(t))) {
    const nom = sinCargo || s
    return { tipo: TIPO_RESPONSABLE, codigo: nom, nombre: titulo(nom) }
  }
  return { tipo: TIPO_NO_IDENT, codigo: null, nombre: s.slice(0, 80) }
}

// clasificar() de catalogo_tramites.py: devuelve el código del procedimiento
function clasificarTramite(...textos) {
  const partes = textos.map(normalizarOrigen).filter(Boolean)
  if (!partes.length) return 'VACIO'
  const t = partes.join(' ')
  for (const c of TRAMITES) if (c.rx.test(t)) return c.codigo
  return 'SIN_CLASIFICAR'
}

// Destinos que, como último movimiento, significan que el expediente terminó
// (ESTADO_FINAL de preparar_semilla.py)
const ESTADO_FINAL = {
  CONCLUIDO: ['FINALIZADO', 'Concluido (registro importado)'],
  ENTREGADO: ['FINALIZADO', 'Entregado al administrado (registro importado)'],
  ARCHIVADO: ['FINALIZADO', 'Enviado a archivo (registro importado)'],
  ARCHIVO: ['FINALIZADO', 'Enviado a archivo (registro importado)'],
  ABANDONO: ['ARCHIVADO', 'Declarado en abandono (registro importado)'],
}

module.exports = {
  normalizarOrigen, clasificarDestino, clasificarTramite, ESTADO_FINAL, CANON, UNIDADES,
  TIPO_UNIDAD, TIPO_RESPONSABLE, TIPO_ESTADO, TIPO_VACIO, TIPO_NO_IDENT,
}
