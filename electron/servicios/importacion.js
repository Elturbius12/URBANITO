// ===========================================================================
// IMPORTACIÓN DE EXPEDIENTES desde Excel/CSV (pantalla «Importar expedientes»)
// Se agrega como métodos de Sistema (ver sistema.js).
//
// Formatos aceptados (detectados por encabezados, ver lectorArchivos.js):
//   PLANTILLA   — hojas EXPEDIENTES + MOVIMIENTOS de la plantilla de URBANITO
//                 (sistema = 'IMPORTADO')
//   CONSOLIDADO — hojas SGCUC / SGAU de CONSOLIDADO_LIMPIO_V5.xlsx, «una fila
//                 por movimiento» (sistema = SGCUC | SGAU, igual que la base
//                 inicial, para que lo ya cargado se detecte como duplicado)
//
// Las reglas son las de herramientas/preparar_semilla.py: clasificación de
// trámites y destinos (motor/clasificacion.js), fecha de corte = última fecha
// de movimiento no posterior a hoy, estado por último destino o inactividad.
// ===========================================================================

const { Sistema, ErrorUsuario, ESTADOS, texto, ahoraIso } = require('./sistema')
const { leerArchivos, LIMITE_BYTES } = require('./lectorArchivos')
const { normalizarTexto, claveDestino } = require('../motor/modelos')
const { clasificarTramite, clasificarDestino, ESTADO_FINAL, TIPO_ESTADO, TIPO_UNIDAD } = require('../motor/clasificacion')
const { generarPlantilla } = require('./plantilla')

const P = Sistema.prototype

const MUESTRA = 100
const MAX_ERRORES = 20000
const MAX_ADVERTENCIAS = 5000
const TAM_LOTE = 500
const ESTADOS_PLANTILLA = ['EN_TRAMITE', 'OBSERVADO', 'FINALIZADO', 'ARCHIVADO']
const TIPOS_MOV = ['REGISTRO', 'DERIVACION', 'OBSERVACION', 'SUBSANACION', 'FINALIZACION', 'ARCHIVO', 'REASIGNACION']
const SINONIMOS_TIPO = { DERIVADO: 'DERIVACION', DERIVAR: 'DERIVACION', RECIBIDO: 'RECIBIDO', OBSERVADO: 'OBSERVACION',
                         SUBSANADO: 'SUBSANACION', FINALIZADO: 'FINALIZACION', ARCHIVADO: 'ARCHIVO', REASIGNADO: 'REASIGNACION' }
const RX_DOCUMENTO = /^(\d{8}|\d{11}|[A-Z0-9]{9,12})$/
const NOMBRE_COL = {
  numero: 'N° EXPEDIENTE', fecha_ingreso: 'FECHA INGRESO', solicitante: 'SOLICITANTE', documento: 'DNI / RUC / CE',
  procedimiento: 'CÓDIGO PROCEDIMIENTO', folios: 'FOLIOS', estado: 'ESTADO', fecha_cierre: 'FECHA CIERRE',
  responsable: 'RESPONSABLE', monto: 'MONTO S/.', n_mov: 'N° MOV', tipo: 'TIPO MOV', fecha: 'FECHA MOV',
  destino: 'DESTINO', asunto: 'ASUNTO', tramite: 'TRÁMITE', folios_mov: 'FOLIOS MOV',
}
const COLUMNAS_SNAPSHOT = ['solicitante', 'documento_identidad', 'telefono', 'direccion', 'procedimiento_codigo', 'asunto',
  'folios', 'fecha_ingreso', 'estado', 'fecha_cierre', 'motivo_cierre', 'responsable_usuario_id', 'ubicacion_tipo',
  'ubicacion_codigo', 'ubicacion_nombre', 'fecha_invalida', 'recibo_numero', 'recibo_monto', 'observaciones']

const ceder = () => new Promise(r => setImmediate(r))

// ------------------------------------------------------------------ fechas
// Acepta fecha nativa de Excel, número de serie, dd/mm/aaaa y aaaa-mm-dd.
// Devuelve { fecha: 'AAAA-MM-DD' | null, malformada: bool }
function leerFecha(v) {
  if (v === null || v === undefined || v === '') return { fecha: null, malformada: false }
  const armar = (a, m, d) => {
    if (a < 100) a += 2000
    const t = new Date(Date.UTC(a, m - 1, d))
    if (t.getUTCFullYear() !== a || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null
    return t.toISOString().slice(0, 10)
  }
  let f = null
  if (v instanceof Date) f = Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
  else if (typeof v === 'number') {
    if (v > 1 && v < 80000) f = new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10)
  } else {
    const s = String(v).trim()
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/)
    if (m) f = armar(+m[1], +m[2], +m[3])
    else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s.*)?$/))) f = armar(+m[3], +m[2], +m[1])
  }
  return { fecha: f, malformada: !f }
}

const vacio = (v) => v === null || v === undefined || String(v).trim() === ''
const txt = (v, max = 500) => (v instanceof Date ? v.toISOString().slice(0, 10) : texto(v, max)) || null
function entero(v) {
  if (vacio(v)) return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) && Number.isInteger(n) ? n : NaN
}
function numeroExpediente(v) {
  if (vacio(v)) return { numero: null }
  if (v instanceof Date) return { numero: null, motivo: 'El número se leyó como fecha: dé formato «Texto» a la columna y vuelva a escribirlo.' }
  const n = texto(v, 40).toUpperCase().replace(/\s+/g, ' ')
  if (n.length > 30) return { numero: null, motivo: 'El número de expediente no puede tener más de 30 caracteres.' }
  return { numero: n }
}

// ------------------------------------------------------------------ alcance
// Departamentos desde los que el usuario puede importar.
// deps = null: sin restricción (todos los procedimientos).
P.alcanceImportacion = function (u, departamento) {
  this.exigir(u, 'importar')
  const libre = this.vistaGeneral(u) || u.rol === 'MESA_PARTES'
  const propios = libre ? null : new Set(u.departamentos || [])
  const elegido = texto(departamento, 40) || u._depActivo || null
  if (elegido && elegido !== 'TODOS') {
    if (!this.departamentos.has(elegido)) throw new ErrorUsuario('Departamento inválido.')
    if (propios && !propios.has(elegido)) {
      throw new ErrorUsuario('No puede importar expedientes de un departamento que no es suyo.', 'PERMISO')
    }
    return { deps: new Set([elegido]), codigo: elegido }
  }
  if (propios && !propios.size) throw new ErrorUsuario('Su usuario no tiene departamento asignado.', 'PERMISO')
  return { deps: propios, codigo: null }
}

P.departamentosImportacion = function (u) {
  const { deps } = this.alcanceImportacion(u, null)
  return [...this.departamentos.values()].filter(d => d.activo && (!deps || deps.has(d.codigo)))
    .map(d => ({ codigo: d.codigo, nombre: d.nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre))
}

// ------------------------------------------------------------------ índices de resolución
P.indicesImportacion = function () {
  const proc = new Map()
  for (const p of this.almacen.procedimientos.values()) {
    proc.set(p.codigo.toUpperCase(), p)
    proc.set(normalizarTexto(p.codigo), p)
    proc.set(normalizarTexto(p.nombre), p)
  }
  const destinos = new Map()
  const poner = (k, d) => { const n = normalizarTexto(k); if (n && !destinos.has(n)) destinos.set(n, d) }
  const usuarios = new Map()
  for (const x of this.usuarios.values()) {
    if (!x.activo || !['JEFE_DEPARTAMENTO', 'TECNICO', 'GERENTE'].includes(x.rol)) continue
    const d = { tipo: 'USUARIO', codigo: String(x.id), nombre: x.nombre_completo, usuario_id: x.id }
    for (const k of [x.usuario, x.nombre_completo]) { poner(k, d); usuarios.set(normalizarTexto(k), x) }
  }
  for (const dep of this.departamentos.values()) {
    const d = { tipo: 'DEPARTAMENTO', codigo: dep.codigo, nombre: dep.nombre, usuario_id: null }
    poner(dep.codigo, d); poner(dep.nombre, d); poner(dep.nombre.replace(/^Departamento de /i, ''), d)
  }
  for (const un of this.unidades.values()) {
    const d = { tipo: 'UNIDAD ORGANICA', codigo: un.codigo, nombre: un.nombre, usuario_id: null }
    poner(un.codigo, d); poner(un.nombre, d)
  }
  // situaciones que usa el propio programa como destino (finalizar, archivar, observar)
  for (const [c, n] of [['FINALIZADO', 'Finalizado'], ['ARCHIVADO', 'Archivado'], ['OBSERVADO', 'Observado — en manos del administrado']]) {
    poner(c, { tipo: 'ESTADO', codigo: c, nombre: n, usuario_id: null })
  }
  return { proc, destinos, usuarios }
}

// Destino de un movimiento de la PLANTILLA: usuario, departamento o unidad por
// código o nombre normalizado; si no, las reglas del consolidado (estados y
// siglas); si tampoco, SIN DATO (advertencia, no error).
function resolverDestinoPlantilla(idx, unidades, valor) {
  const original = txt(valor, 200)
  if (!original) return { destino: { tipo: 'SIN DATO', codigo: null, nombre: null, usuario_id: null }, original }
  const d = idx.destinos.get(normalizarTexto(original))
  if (d) return { destino: d, original }
  const c = clasificarDestino(original)
  if (c.tipo === TIPO_ESTADO || (c.tipo === TIPO_UNIDAD && unidades.has(c.codigo))) {
    return { destino: { ...c, usuario_id: null }, original }
  }
  return { destino: { tipo: 'SIN DATO', codigo: null, nombre: null, usuario_id: null }, original, desconocido: true }
}

// ------------------------------------------------------------------ análisis (no escribe)
P.analizarImportacion = async function (u, datos, avisar = () => {}) {
  const { deps, codigo: depCodigo } = this.alcanceImportacion(u, datos.departamento)
  const archivos = decodificarArchivos(datos.archivos)
  const leido = await leerArchivos(archivos)
  const hoy = this.hoy()
  const idx = this.indicesImportacion()
  const errores = [], advertencias = []
  const filasConError = new Set()
  const err = (hoja, fila, col, motivo, numero = null) => {
    filasConError.add(`${hoja}|${fila}`)
    if (errores.length < MAX_ERRORES) errores.push({ hoja, fila, columna: NOMBRE_COL[col] || col, motivo, numero })
  }
  const adv = (hoja, fila, col, motivo, numero = null) => {
    if (advertencias.length < MAX_ADVERTENCIAS) advertencias.push({ hoja, fila, columna: NOMBRE_COL[col] || col, motivo, numero })
  }
  const nombreDeps = deps ? [...deps].map(c => (this.departamentos.get(c) || {}).nombre || c).join(', ') : null

  // ---------- 1. agrupar filas por expediente
  const grupos = new Map()
  const consolidado = leido.formato === 'CONSOLIDADO'
  const firma = (c) => [c.fecha_ingreso, c.solicitante, c.asunto, c.procedimiento].map(v => normalizarTexto(v instanceof Date ? v.toISOString() : v)).join('|')
  let nMovFilas = 0
  for (const t of leido.tablas) {
    if (t.tipo === 'MOVIMIENTOS') continue
    for (const f of t.filas) {
      const { numero, motivo } = numeroExpediente(f.numero)
      if (!numero) { err(f.__hoja, f.__fila, 'numero', motivo || 'Falta el número de expediente.'); continue }
      const sistema = consolidado ? t.tipo : 'IMPORTADO'
      const k = `${sistema}|${numero}`
      const cab = consolidado
        ? { ...f, asunto: t.tipo === 'SGAU' ? [f.tipo_tramite, f.tramite].map(x => txt(x, 400)).filter(Boolean).join(' | ') : f.asunto }
        : f
      let g = grupos.get(k)
      if (!g) {
        g = { clave: k, numero, sistema, hoja: f.__hoja, fila: f.__fila, cab, firma: firma(cab), movs: [], filas: [f.__fila], error: false }
        grupos.set(k, g)
      } else if (g.firma !== firma(cab)) {
        err(f.__hoja, f.__fila, 'numero', `El expediente ${numero} se repite (fila ${g.fila}) con datos de cabecera distintos (fecha, solicitante o trámite).`, numero)
        g.error = true
        continue
      } else if (!consolidado) {
        adv(f.__hoja, f.__fila, 'numero', `Fila repetida del expediente ${numero} (igual a la fila ${g.fila}); se ignora.`, numero)
        continue
      }
      g.filas.push(f.__fila)
      if (consolidado && !(vacio(f.n_mov) && vacio(f.tipo) && vacio(f.fecha))) {
        nMovFilas++
        g.movs.push({ ...f, folios: f.folios_mov, observacion: t.tipo === 'SGCUC'
          ? (txt(f.responsable_mov, 100) ? `Responsable: ${txt(f.responsable_mov, 100)}` : null)
          : [f.descripcion, f.observacion_mov].map(x => txt(x, 1000)).filter(Boolean).join(' — ') || null })
      }
    }
  }
  for (const t of leido.tablas.filter(x => x.tipo === 'MOVIMIENTOS')) {
    for (const f of t.filas) {
      nMovFilas++
      const { numero, motivo } = numeroExpediente(f.numero)
      if (!numero) { err(f.__hoja, f.__fila, 'numero', motivo || 'Falta el número de expediente.'); continue }
      const g = grupos.get(`IMPORTADO|${numero}`)
      if (!g) { err(f.__hoja, f.__fila, 'numero', `El expediente ${numero} no figura en la hoja EXPEDIENTES.`, numero); continue }
      g.movs.push(f)
    }
  }

  // ---------- 2. fecha de corte (regla de preparar_semilla.py)
  let corte = null
  for (const g of grupos.values()) {
    for (const m of g.movs) {
      m._f = leerFecha(m.fecha)
      if (m._f.fecha && m._f.fecha <= hoy && (!corte || m._f.fecha > corte)) corte = m._f.fecha
    }
  }
  corte = corte || hoy
  const inactividad = (this.almacen.configuracion.parametros || {}).dias_inactividad_cierre || 60

  // ---------- 3. validar y armar cada expediente
  const validos = []
  let vistos = 0
  for (const g of grupos.values()) {
    if (++vistos % 2000 === 0) { avisar('Validando expedientes…', vistos, grupos.size); await ceder() }
    const c = g.cab, h = g.hoja, fi = g.fila
    let mal = g.error
    const e = (col, motivo) => { err(h, fi, col, motivo, g.numero); mal = true }

    // fecha de ingreso
    const fIng = leerFecha(c.fecha_ingreso)
    let fechaIngreso = fIng.fecha, fechaInvalida = 0
    if (fechaIngreso && !this.cal.indice(fechaIngreso)) { fechaIngreso = null; fIng.malformada = true }
    if (!consolidado) {
      if (!fechaIngreso) e('fecha_ingreso', fIng.malformada ? 'Fecha inválida. Use dd/mm/aaaa o aaaa-mm-dd.' : 'Falta la fecha de ingreso.')
      else if (fechaIngreso > hoy) {
        fechaInvalida = 1
        adv(h, fi, 'fecha_ingreso', 'Fecha de ingreso posterior a hoy: se guarda marcada como inválida y no entra a los cálculos.', g.numero)
      }
    } else if (fechaIngreso && fechaIngreso > corte) fechaInvalida = 1

    // solicitante y documento
    const solicitante = txt(c.solicitante, 200)
    let documento = null
    if (!consolidado) {
      if (!solicitante || solicitante.length < 3) e('solicitante', 'Falta el nombre o razón social del solicitante (mínimo 3 caracteres).')
      documento = (txt(c.documento, 20) || '').toUpperCase().replace(/\s+/g, '')
      if (/^\d+\.0$/.test(documento)) documento = documento.slice(0, -2)
      if (!documento) e('documento', 'Falta el DNI, RUC o carné de extranjería.')
      else if (!RX_DOCUMENTO.test(documento)) e('documento', `Documento inválido «${documento}»: DNI (8 dígitos), RUC (11 dígitos) o carné de extranjería (9 a 12 caracteres).`)
    }

    // procedimiento
    let proc = null
    if (consolidado) {
      proc = this.almacen.procedimientos.get(clasificarTramite(c.asunto))
    } else {
      const v = txt(c.procedimiento, 200)
      if (!v) e('procedimiento', 'Falta el código del procedimiento.')
      else {
        proc = idx.proc.get(v.toUpperCase()) || idx.proc.get(normalizarTexto(v))
        if (!proc || !proc.activo) {
          const sug = [...this.almacen.procedimientos.values()]
            .filter(p => p.activo && p.seleccionable && (!deps || deps.has(p.departamento_codigo))).map(p => p.codigo).slice(0, 12)
          e('procedimiento', `Procedimiento «${v}» no reconocido. Códigos válidos: ${sug.join(', ')}.`)
          proc = null
        }
      }
    }
    if (proc && deps && !deps.has(proc.departamento_codigo)) {
      const suyo = proc.departamento_codigo ? (this.departamentos.get(proc.departamento_codigo) || {}).nombre : 'ningún departamento'
      const sug = [...this.almacen.procedimientos.values()].filter(p => p.activo && p.seleccionable && deps.has(p.departamento_codigo)).map(p => p.codigo)
      e(consolidado ? (g.sistema === 'SGAU' ? 'tramite' : 'asunto') : 'procedimiento',
        `El procedimiento ${proc.codigo} (${proc.nombre}) pertenece a ${suyo}; aquí solo se importan trámites de ${nombreDeps}. Códigos válidos: ${sug.join(', ')}.`)
    }

    // folios y montos
    const folios = entero(c.folios)
    if (!consolidado && (folios === null || Number.isNaN(folios) || folios < 1 || folios > 100000)) e('folios', 'Folios: escriba un número entero mayor que cero.')
    let monto = null
    if (!vacio(c.monto)) {
      monto = Number(String(c.monto).replace(',', '.'))
      if (!Number.isFinite(monto) || monto < 0) {
        if (consolidado) monto = null
        else e('monto', 'Monto inválido: escriba un número (por ejemplo 36.50).')
      }
    }

    // responsable
    let responsableId = null
    if (!consolidado && !vacio(c.responsable)) {
      const r = idx.usuarios.get(normalizarTexto(c.responsable))
      if (r) responsableId = r.id
      else adv(h, fi, 'responsable', `Responsable «${txt(c.responsable, 60)}» no es un usuario activo; se deja sin responsable.`, g.numero)
    }

    // ---------- movimientos
    const movs = []
    const nVistos = new Map()
    g.movs.forEach((m, i) => {
      const mf = m.__fila
      const mh = m.__hoja
      const n = entero(m.n_mov)
      if (!consolidado) {
        if (n === null || Number.isNaN(n) || n < 1) { err(mh, mf, 'n_mov', 'N° MOV: escriba un número entero mayor o igual a 1.', g.numero); mal = true; return }
        if (nVistos.has(n)) { err(mh, mf, 'n_mov', `El N° MOV ${n} se repite en el expediente ${g.numero} (fila ${nVistos.get(n)}).`, g.numero); mal = true; return }
        nVistos.set(n, mf)
      }
      // tipo
      const tNorm = normalizarTexto(m.tipo)
      let tipo = SINONIMOS_TIPO[tNorm] || (TIPOS_MOV.includes(tNorm) ? tNorm : null)
      if (!consolidado && !tipo) {
        err(mh, mf, 'tipo', `Tipo de movimiento «${txt(m.tipo, 40) || ''}» inválido. Use: ${TIPOS_MOV.join(', ')}.`, g.numero); mal = true; return
      }
      if (consolidado && !tipo) tipo = txt(m.tipo, 30)
      // fecha
      const f = m._f || leerFecha(m.fecha)
      let fecha = f.fecha
      if (fecha && !this.cal.indice(fecha)) fecha = null
      let valida = fecha && fecha <= corte ? 1 : 0
      if (!consolidado) {
        if (!fecha) { err(mh, mf, 'fecha', f.malformada || m.fecha ? 'Fecha de movimiento inválida. Use dd/mm/aaaa o aaaa-mm-dd.' : 'Falta la fecha del movimiento.', g.numero); mal = true; return }
        if (fecha > hoy) { valida = 0; adv(mh, mf, 'fecha', 'Fecha de movimiento posterior a hoy: se guarda marcada como inválida y no entra a los cálculos.', g.numero) }
        if (fechaIngreso && fecha < fechaIngreso) adv(mh, mf, 'fecha', 'El movimiento es anterior a la fecha de ingreso.', g.numero)
      }
      // destino
      let destino, original
      if (consolidado) {
        original = txt(m.destino, 200)
        const cl = clasificarDestino(original)
        destino = { tipo: cl.tipo, codigo: cl.codigo, nombre: cl.nombre, usuario_id: null }
      } else {
        const r = resolverDestinoPlantilla(idx, this.unidades, m.destino)
        destino = r.destino; original = r.original
        if (r.desconocido) adv(mh, mf, 'destino', `Destino «${original}» no reconocido: se guarda como SIN DATO con el texto original.`, g.numero)
      }
      if (destino.tipo !== 'SIN DATO' && !claveDestino({ destino_tipo: destino.tipo, destino_codigo: destino.codigo, destino_texto: original })) {
        destino = { tipo: 'SIN DATO', codigo: null, nombre: null, usuario_id: null }
      }
      movs.push({
        n: consolidado ? (Number.isNaN(n) || n === null ? 1e9 : n) : n, i, fecha: fecha || null, tipo, valida,
        destino_texto: original, destino, documento: txt(m.documento, 120),
        folios: vacio(m.folios) ? null : String(typeof m.folios === 'number' ? m.folios : txt(m.folios, 20)),
        observacion: txt(m.observacion, 2000),
      })
    })
    if (mal) continue
    // plantilla: por N° MOV; consolidado: por fecha y luego N° MOV (como la base inicial)
    movs.sort((a, b) => (consolidado ? (a.fecha || '9999').localeCompare(b.fecha || '9999') : 0) || a.n - b.n || a.i - b.i)
    movs.forEach((m, k) => { m.orden = k + 1 })

    // ---------- estado (explícito manda; si no, reglas de preparar_semilla.py)
    const validosMov = movs.filter(m => m.valida)
    const ultima = validosMov.length ? validosMov[validosMov.length - 1] : null
    const estadoTxt = consolidado ? null : normalizarTexto(c.estado).replace(/ /g, '_')
    let estado, fechaCierre = null, motivo = null
    if (estadoTxt) {
      if (!ESTADOS_PLANTILLA.includes(estadoTxt)) { e('estado', `Estado «${txt(c.estado, 30)}» inválido. Use: ${ESTADOS_PLANTILLA.join(', ')}.`); continue }
      estado = estadoTxt
      if (estado === 'FINALIZADO' || estado === 'ARCHIVADO') {
        const fc = leerFecha(c.fecha_cierre)
        fechaCierre = fc.fecha || (ultima ? ultima.fecha : null)
        if (fc.malformada) { e('fecha_cierre', 'Fecha de cierre inválida. Use dd/mm/aaaa o aaaa-mm-dd.'); continue }
        if (!fechaCierre) { e('fecha_cierre', `Un expediente ${estado.toLowerCase()} necesita FECHA CIERRE o al menos un movimiento con fecha.`); continue }
        if (fechaCierre > hoy) { e('fecha_cierre', 'La fecha de cierre no puede ser posterior a hoy.'); continue }
        if (fechaIngreso && fechaCierre < fechaIngreso) { e('fecha_cierre', 'La fecha de cierre es anterior a la fecha de ingreso.'); continue }
        motivo = `${ESTADOS[estado]} (según el archivo importado)`
      }
    } else {
      if (!consolidado) adv(h, fi, 'estado', 'Sin ESTADO: se deduce de los movimientos.', g.numero)
      const ultTipo = movs.length ? movs[movs.length - 1].tipo : null
      if (!consolidado && ultima && ['FINALIZACION', 'ARCHIVO', 'OBSERVACION'].includes(ultTipo)) {
        estado = { FINALIZACION: 'FINALIZADO', ARCHIVO: 'ARCHIVADO', OBSERVACION: 'OBSERVADO' }[ultTipo]
        if (estado !== 'OBSERVADO') { fechaCierre = ultima.fecha; motivo = `${ESTADOS[estado]} (según el archivo importado)` }
      } else if (!ultima) {
        estado = 'SIN_FECHA'; motivo = 'Sin fechas de movimiento válidas en el origen'
      } else if (ultima.destino.tipo === TIPO_ESTADO && ESTADO_FINAL[ultima.destino.codigo]) {
        [estado, motivo] = ESTADO_FINAL[ultima.destino.codigo]
        fechaCierre = ultima.fecha
      } else if (this.cal.diasHabiles(ultima.fecha, corte) > inactividad) {
        estado = 'CERRADO_HISTORICO'; fechaCierre = ultima.fecha
        motivo = `Sin movimiento por más de ${inactividad} días hábiles a la fecha de corte (${corte})`
      } else estado = 'EN_TRAMITE'
    }
    // ubicación = destino del último movimiento válido
    let ub = ultima ? ultima.destino : { tipo: 'SIN DATO', codigo: null, nombre: null, usuario_id: null }
    const sinLugar = (d) => d.tipo === 'SIN DATO' || (d.tipo === 'ESTADO' && d.codigo === 'OBSERVADO')
    if (!consolidado && sinLugar(ub)) {
      // en la plantilla, un movimiento sin destino (p. ej. una observación) no cambia la ubicación
      const conDestino = validosMov.filter(m => !sinLugar(m.destino))
      if (conDestino.length) ub = conDestino[conDestino.length - 1].destino
    }
    if (!consolidado && (estado === 'FINALIZADO' || estado === 'ARCHIVADO')) {
      ub = { tipo: 'ESTADO', codigo: estado, nombre: ESTADOS[estado], usuario_id: null }
    }
    if (!responsableId && ub.tipo === 'USUARIO') responsableId = ub.usuario_id

    validos.push({
      clave: g.clave, numero: g.numero, sistema: g.sistema, hoja: h, fila: fi,
      exp: {
        solicitante, documento_identidad: documento || null, telefono: txt(c.telefono, 20), direccion: txt(c.direccion, 200),
        procedimiento_codigo: proc ? proc.codigo : 'VACIO', asunto: txt(c.asunto, 1000) || (consolidado ? null : (proc ? proc.nombre : null)),
        folios: folios === null || Number.isNaN(folios) ? null : folios, fecha_ingreso: fechaIngreso, estado,
        fecha_cierre: fechaCierre, motivo_cierre: motivo, responsable_usuario_id: responsableId,
        ubicacion_tipo: ub.tipo, ubicacion_codigo: ub.codigo === null || ub.codigo === undefined ? null : String(ub.codigo),
        ubicacion_nombre: ub.nombre, fecha_invalida: fechaInvalida, recibo_numero: txt(c.recibo, 40), recibo_monto: monto,
        observaciones: txt(c.observaciones, 2000),
      },
      movs,
    })
  }

  // ---------- 4. duplicados contra la base: clave (sistema, numero)
  const modo = datos.modo_duplicados === 'actualizar' ? 'actualizar' : 'omitir'
  const sistemas = [...new Set(validos.map(v => v.sistema))]
  const existentes = new Map()
  for (const s of sistemas) {
    for (const x of this.bd.todas('SELECT id, sistema, numero, importado FROM expedientes WHERE sistema = ?', [s])) {
      existentes.set(`${x.sistema}|${x.numero}`, x)
    }
  }
  const conMovUsuario = new Set(this.bd.todas('SELECT DISTINCT expediente_id id FROM movimientos WHERE importado = 0').map(r => r.id))
  let nuevos = 0, duplicados = 0, actualizables = 0
  for (const v of validos) {
    const x = existentes.get(v.clave)
    if (!x) { v.situacion = 'NUEVO'; nuevos++; continue }
    v.existente_id = x.id
    duplicados++
    if (modo === 'actualizar' && x.importado && v.sistema !== 'URBANITO' && !conMovUsuario.has(x.id)) {
      v.situacion = 'ACTUALIZAR'; actualizables++
    } else {
      v.situacion = 'OMITIR'
      v.motivo_omision = !x.importado ? 'Registrado en URBANITO (Mesa de partes): nunca se modifica'
        : conMovUsuario.has(x.id) ? 'Ya tiene movimientos registrados en URBANITO' : 'Ya existe'
    }
  }

  const movimientos = validos.reduce((s, v) => s + v.movs.length, 0)
  const nombreProc = (cod) => (this.almacen.procedimientos.get(cod) || {}).nombre || cod
  return {
    formato: leido.formato,
    aviso_formato: consolidado ? 'Formato consolidado detectado (hojas SGCUC / SGAU, una fila por movimiento). Se aplican las reglas de la base inicial.' : null,
    archivos: archivos.map(a => ({ nombre: a.nombre, tamano: a.contenido.length })),
    nombre_archivo: archivos.map(a => a.nombre).join(' + ').slice(0, 300),
    hojas: leido.tablas.map(t => ({ hoja: t.hoja, tipo: t.tipo, filas: t.filas.length, columnas_faltantes: t.columnas_faltantes })),
    departamento: depCodigo, departamento_nombre: depCodigo ? this.departamentos.get(depCodigo).nombre : null,
    alcance: nombreDeps, fecha_corte: corte, modo_duplicados: modo,
    totales: {
      filas_leidas: leido.filas_leidas, expedientes_unicos: grupos.size, movimientos_leidos: nMovFilas,
      expedientes_validos: validos.length, movimientos, nuevos, duplicados, actualizables,
      filas_con_error: filasConError.size, expedientes_con_error: grupos.size - validos.length,
      advertencias: advertencias.length,
    },
    errores, advertencias,
    errores_truncados: filasConError.size > errores.length,
    muestra: validos.filter(v => v.situacion !== 'OMITIR').concat(validos.filter(v => v.situacion === 'OMITIR'))
      .slice(0, MUESTRA).map(v => ({
        hoja: v.hoja, fila: v.fila, numero: v.numero, sistema: v.sistema, solicitante: v.exp.solicitante,
        procedimiento_codigo: v.exp.procedimiento_codigo, procedimiento: nombreProc(v.exp.procedimiento_codigo),
        fecha_ingreso: v.exp.fecha_ingreso, estado: v.exp.estado, estado_nombre: ESTADOS[v.exp.estado],
        movimientos: v.movs.length, situacion: v.situacion, motivo: v.motivo_omision || null,
      })),
    _validos: validos,
  }
}

function decodificarArchivos(lista) {
  if (!Array.isArray(lista) || !lista.length) throw new ErrorUsuario('Seleccione un archivo .xlsx o .csv.')
  return lista.slice(0, 3).map(a => {
    const b64 = typeof (a && a.base64) === 'string' ? a.base64 : ''
    if (b64.length > Math.ceil(LIMITE_BYTES * 4 / 3) + 8) {
      throw new ErrorUsuario(`"${texto(a.nombre, 100)}" pesa más de ${LIMITE_BYTES / 1024 / 1024} MB. Divídalo en partes más pequeñas.`)
    }
    return { nombre: texto(a && a.nombre, 200) || 'archivo', contenido: Buffer.from(b64, 'base64') }
  })
}

function publico(a) {
  const { _validos, ...resto } = a
  return resto
}

// ------------------------------------------------------------------ acciones
P.importarPrevisualizar = async function (u, datos, { progreso } = {}) {
  const avisar = (fase, hechos, total) => {
    if (progreso) { try { progreso({ fase, hechos, total, porcentaje: total ? Math.round((hechos / total) * 100) : 0 }) } catch (_) { /* sin ventana */ } }
  }
  avisar('Leyendo el archivo…', 0, 1)
  const a = await this.analizarImportacion(u, datos || {}, avisar)
  this.bd.transaccion(() => this.auditar(u, 'IMPORTAR_PREVISUALIZAR', 'importaciones', null, {
    archivo: a.nombre_archivo, formato: a.formato, departamento: a.departamento, totales: a.totales }))
  return publico(a)
}

P.importarConfirmar = async function (u, datos = {}, { progreso } = {}) {
  const avisar = (fase, hechos, total) => {
    if (progreso) { try { progreso({ fase, hechos, total, porcentaje: total ? Math.round((hechos / total) * 100) : 0 }) } catch (_) { /* sin ventana */ } }
  }
  avisar('Leyendo y validando el archivo…', 0, 1)
  const a = await this.analizarImportacion(u, datos, avisar)
  if (a.totales.filas_con_error && !datos.solo_validas) {
    throw new ErrorUsuario(`El archivo tiene ${a.totales.filas_con_error} fila(s) con error. Corríjalas o elija «Importar solo las filas válidas».`)
  }
  const crear = a._validos.filter(v => v.situacion === 'NUEVO')
  const actualizar = a._validos.filter(v => v.situacion === 'ACTUALIZAR')
  const omitidos = a._validos.filter(v => v.situacion === 'OMITIR').length
  const total = crear.length + actualizar.length
  const ahora = ahoraIso()
  let loteId = null, movCreados = 0
  const detalle = { actualizados: [] }

  await this.bd.transaccionLarga('importación de expedientes', async () => {
    loteId = this.bd.ejecutar(
      `INSERT INTO importaciones(fecha_hora, usuario_id, departamento_codigo, nombre_archivo, formato, filas_leidas,
       expedientes_creados, expedientes_omitidos, expedientes_actualizados, movimientos_creados, errores, estado)
       VALUES (?,?,?,?,?,?,0,0,0,0,?,'EN_CURSO')`,
      [ahora, u.id, a.departamento, a.nombre_archivo, a.formato, a.totales.filas_leidas, a.totales.filas_con_error]).ultimoId
    let siguiente = (this.bd.una('SELECT MAX(id) m FROM expedientes').m || 0) + 1
    const insExp = this.bd.preparar(
      `INSERT INTO expedientes(id, numero, sistema, solicitante, documento_identidad, telefono, direccion,
       procedimiento_codigo, asunto, folios, fecha_ingreso, estado, fecha_cierre, motivo_cierre, responsable_usuario_id,
       ubicacion_tipo, ubicacion_codigo, ubicacion_nombre, importado, fecha_invalida, registrado_por, creado_en,
       importacion_id, recibo_numero, recibo_monto, observaciones)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?)`)
    const insMov = this.bd.preparar(
      `INSERT INTO movimientos(expediente_id, orden, fecha, tipo, destino_texto, destino_tipo, destino_codigo,
       destino_nombre, destino_usuario_id, documento, folios, observacion, usuario_id, registrado_en, fecha_valida,
       importado, importacion_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,1,?)`)
    const movimientos = (id, movs, desde = 0) => {
      for (const m of movs) {
        insMov.ejecutar([id, m.orden + desde, m.fecha, m.tipo, m.destino_texto, m.destino.tipo,
          m.destino.codigo === null || m.destino.codigo === undefined ? null : String(m.destino.codigo),
          m.destino.nombre, m.destino.usuario_id || null, m.documento, m.folios, m.observacion, ahora, m.valida, loteId])
        movCreados++
      }
    }
    try {
      let hechos = 0
      for (const v of crear) {
        const x = v.exp
        const id = siguiente++
        insExp.ejecutar([id, v.numero, v.sistema, x.solicitante, x.documento_identidad, x.telefono, x.direccion,
          x.procedimiento_codigo, x.asunto, x.folios, x.fecha_ingreso, x.estado, x.fecha_cierre, x.motivo_cierre,
          x.responsable_usuario_id, x.ubicacion_tipo, x.ubicacion_codigo, x.ubicacion_nombre, x.fecha_invalida,
          u.id, ahora, loteId, x.recibo_numero, x.recibo_monto, x.observaciones])
        movimientos(id, v.movs)
        if (++hechos % TAM_LOTE === 0) { avisar('Guardando expedientes…', hechos, total); await ceder() }
      }
      for (const v of actualizar) {
        const antes = this.bd.una(`SELECT ${COLUMNAS_SNAPSHOT.join(', ')} FROM expedientes WHERE id = ?`, [v.existente_id])
        const previos = this.bd.una('SELECT COUNT(*) n, MAX(orden) m FROM movimientos WHERE expediente_id = ?', [v.existente_id])
        detalle.actualizados.push({ id: v.existente_id, numero: v.numero, antes })
        this.bd.ejecutar(`UPDATE expedientes SET ${COLUMNAS_SNAPSHOT.map(c => `${c} = ?`).join(', ')} WHERE id = ?`,
          [...COLUMNAS_SNAPSHOT.map(c => v.exp[c] === undefined ? antes[c] : v.exp[c]), v.existente_id])
        // solo se agregan los movimientos que el expediente todavía no tenía
        movimientos(v.existente_id, v.movs.slice(previos.n).map((m, k) => ({ ...m, orden: k + 1 })), previos.m || 0)
        if (++hechos % TAM_LOTE === 0) { avisar('Actualizando expedientes…', hechos, total); await ceder() }
      }
    } finally {
      insExp.liberar(); insMov.liberar()
    }
    this.bd.ejecutar(`UPDATE importaciones SET expedientes_creados = ?, expedientes_omitidos = ?, expedientes_actualizados = ?,
                      movimientos_creados = ?, estado = 'COMPLETADO', detalle = ? WHERE id = ?`,
      [crear.length, omitidos, actualizar.length, movCreados, JSON.stringify(detalle), loteId])
    this.auditar(u, 'IMPORTAR_CONFIRMAR', 'importaciones', loteId, {
      archivo: a.nombre_archivo, formato: a.formato, departamento: a.departamento, fecha_corte: a.fecha_corte,
      creados: crear.length, actualizados: actualizar.length, omitidos, movimientos: movCreados,
      filas_con_error_descartadas: a.totales.filas_con_error })
  })
  avisar('Recalculando prioridades (IUA) y tiempos (MTA)…', total, total)
  await ceder()
  this.cargar()                       // recarga el almacén y hace UN solo recalcular()
  avisar('Listo', total, total)
  return {
    ok: true, importacion_id: loteId, formato: a.formato, nombre_archivo: a.nombre_archivo,
    expedientes_creados: crear.length, expedientes_actualizados: actualizar.length, expedientes_omitidos: omitidos,
    movimientos_creados: movCreados, filas_con_error: a.totales.filas_con_error, advertencias: a.totales.advertencias,
    fecha_corte: a.fecha_corte, en_tramite_creados: crear.filter(v => ['EN_TRAMITE', 'OBSERVADO'].includes(v.exp.estado)).length,
  }
}

P.listarImportaciones = function (u) {
  this.exigir(u, 'importar')
  const filas = this.bd.todas(`SELECT i.id, i.fecha_hora, i.usuario_id, i.departamento_codigo, i.nombre_archivo, i.formato,
      i.filas_leidas, i.expedientes_creados, i.expedientes_omitidos, i.expedientes_actualizados, i.movimientos_creados,
      i.errores, i.estado, i.deshecho_en FROM importaciones i WHERE i.estado <> 'EN_CURSO' ORDER BY i.id DESC LIMIT 200`)
  return filas
    .filter(f => u.rol === 'ADMINISTRADOR' || this.vistaGeneral(u) || f.usuario_id === u.id ||
                 (f.departamento_codigo && (u.departamentos || []).includes(f.departamento_codigo)))
    .map(f => {
      const usr = this.usuarios.get(f.usuario_id)
      return { ...f, usuario: usr ? usr.nombre_completo : '—',
               departamento: f.departamento_codigo ? (this.departamentos.get(f.departamento_codigo) || {}).nombre : 'Todos',
               puede_deshacer: f.estado === 'COMPLETADO' && (u.rol === 'ADMINISTRADOR' || f.usuario_id === u.id) }
    })
}

// Deshace un lote: borra SOLO lo que creó y restaura lo que actualizó.
P.importarDeshacer = function (u, { id }) {
  this.exigir(u, 'importar')
  const lote = this.bd.una('SELECT * FROM importaciones WHERE id = ?', [Number(id)])
  if (!lote) throw new ErrorUsuario('La importación no existe.', 'NO_EXISTE')
  if (u.rol !== 'ADMINISTRADOR' && lote.usuario_id !== u.id) {
    throw new ErrorUsuario('Solo el administrador o quien hizo la importación puede deshacerla.', 'PERMISO')
  }
  if (lote.estado !== 'COMPLETADO') throw new ErrorUsuario('Esta importación ya fue deshecha.')
  const detalle = lote.detalle ? JSON.parse(lote.detalle) : { actualizados: [] }
  const creados = this.bd.todas('SELECT id FROM expedientes WHERE importacion_id = ?', [lote.id]).map(r => r.id)
  const tocados = [...creados, ...detalle.actualizados.map(a => a.id)]
  // ¿alguien trabajó sobre estos expedientes después de importarlos?
  const usados = new Set()
  for (let i = 0; i < tocados.length; i += 500) {
    const parte = tocados.slice(i, i + 500)
    const marcas = parte.map(() => '?').join(',')
    for (const r of this.bd.todas(`SELECT DISTINCT expediente_id id FROM movimientos WHERE importado = 0 AND expediente_id IN (${marcas})`, parte)) usados.add(r.id)
    for (const r of this.bd.todas(`SELECT DISTINCT CAST(entidad_id AS INTEGER) id FROM auditoria WHERE entidad = 'expedientes'
                                   AND fecha_hora > ? AND entidad_id IN (${marcas})`, [lote.fecha_hora, ...parte.map(String)])) usados.add(r.id)
  }
  if (usados.size) {
    const nums = [...usados].slice(0, 5).map(i => (this.almacen.expedientes.get(i) || {}).numero || i)
    throw new ErrorUsuario(`No se puede deshacer: ${usados.size} expediente(s) del lote ya tienen movimientos o cambios registrados en URBANITO (por ejemplo ${nums.join(', ')}).`)
  }
  let movBorrados = 0
  this.bd.transaccion(() => {
    movBorrados = this.bd.ejecutar('DELETE FROM movimientos WHERE importacion_id = ?', [lote.id]).cambios
    const expBorrados = this.bd.ejecutar('DELETE FROM expedientes WHERE importacion_id = ?', [lote.id]).cambios
    for (const a of detalle.actualizados) {
      this.bd.ejecutar(`UPDATE expedientes SET ${COLUMNAS_SNAPSHOT.map(c => `${c} = ?`).join(', ')} WHERE id = ?`,
        [...COLUMNAS_SNAPSHOT.map(c => a.antes[c]), a.id])
    }
    this.bd.ejecutar("UPDATE importaciones SET estado = 'DESHECHO', deshecho_en = ?, deshecho_por = ? WHERE id = ?", [ahoraIso(), u.id, lote.id])
    this.auditar(u, 'IMPORTAR_DESHACER', 'importaciones', lote.id, {
      archivo: lote.nombre_archivo, expedientes_borrados: expBorrados, movimientos_borrados: movBorrados,
      expedientes_restaurados: detalle.actualizados.length })
  })
  this.cargar()
  return { ok: true, expedientes_borrados: creados.length, movimientos_borrados: movBorrados, expedientes_restaurados: detalle.actualizados.length }
}

P.plantillaImportacion = async function (u, { departamento } = {}) {
  const { deps, codigo } = this.alcanceImportacion(u, departamento)
  const dep = codigo ? this.departamentos.get(codigo) : null
  const procedimientos = [...this.almacen.procedimientos.values()]
    .filter(p => p.activo && p.seleccionable && (!deps || deps.has(p.departamento_codigo)))
    .sort((a, b) => (a.departamento_codigo || '').localeCompare(b.departamento_codigo || '') || a.nombre.localeCompare(b.nombre))
  const buf = await generarPlantilla({
    departamento: dep, alcance: deps ? [...deps].map(c => this.departamentos.get(c).nombre) : null,
    procedimientos: procedimientos.map(p => ({ ...p, departamento: p.departamento_codigo ? (this.departamentos.get(p.departamento_codigo) || {}).nombre : '' })),
    departamentos: [...this.departamentos.values()].filter(d => d.activo),
    unidades: [...this.unidades.values()].filter(x => x.activo),
    usuarios: [...this.usuarios.values()].filter(x => x.activo && ['JEFE_DEPARTAMENTO', 'TECNICO', 'GERENTE'].includes(x.rol)),
    tipos: TIPOS_MOV, estados: ESTADOS_PLANTILLA, institucion: this.almacen.configuracion.institucion, hoy: this.hoy(),
  })
  const sufijo = dep ? dep.nombre.replace(/^Departamento de /i, '') : 'todos los departamentos'
  const nombre = `Plantilla de importación — ${sufijo}`.replace(/[\\/:*?"<>|]/g, ' ')
  return { nombre_archivo: `${nombre}.xlsx`, base64: buf.toString('base64') }
}

module.exports = { leerFecha, TIPOS_MOV, ESTADOS_PLANTILLA }
