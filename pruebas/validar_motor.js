// Compara el motor del programa (JavaScript) contra la implementación de
// referencia en Python, sobre la misma base y la misma fecha.
//   node pruebas/validar_motor.js <urbanito.db> <referencia.json> <AAAA-MM-DD>

const fs = require('fs')
const { BaseDatos, cargarAlmacen } = require('../electron/bd')
const { Calendario } = require('../electron/motor/calendario')
const { calcularModelos } = require('../electron/motor/modelos')

const [ruta, refRuta, hoy] = process.argv.slice(2)
const TOL = 1e-9
let fallas = 0, comparaciones = 0

function igual(a, b, donde) {
  comparaciones++
  const nulo = (v) => v === null || v === undefined
  if (nulo(a) && nulo(b)) return
  if (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= TOL * Math.max(1, Math.abs(b))) return
  if (a === b) return
  fallas++
  if (fallas <= 25) console.log(`  DIFERENCIA en ${donde}: motor=${a} referencia=${b}`)
}

;(async () => {
  const ref = JSON.parse(fs.readFileSync(refRuta, 'utf8'))
  const bd = await BaseDatos.abrir(ruta)
  const t0 = Date.now()
  const almacen = cargarAlmacen(bd)
  const t1 = Date.now()
  const cal = new Calendario(almacen.feriados)
  const r = calcularModelos(almacen, cal, hoy)
  console.log(`Carga ${t1 - t0} ms | cálculo ${r.duracion_ms} ms`)

  // AHP
  ref.ahp.pesos.forEach((p, i) => igual(r.ahp.pesos[i], p, `AHP peso ${i}`))
  igual(r.ahp.lambda_max, ref.ahp.lambda_max, 'AHP lambda')
  igual(r.ahp.rc, ref.ahp.rc, 'AHP RC')

  // MTA por trámite
  igual(r.mta.base_n, ref.base_mta, 'MTA base')
  igual(r.mta.tramite.size, Object.keys(ref.mta_tramite).length, 'MTA cantidad de trámites')
  const campos = ['n', 'media', 'mediana', 'desviacion', 'p80', 'p95', 'minimo', 'maximo',
                  'coef_variacion', 'plazo_tupa', 'tasa_cumplimiento', 'brecha_p80_tupa',
                  'datos_suficientes', 'interpretacion']
  for (const [cod, m] of Object.entries(ref.mta_tramite)) {
    const j = r.mta.tramite.get(cod)
    if (!j) { fallas++; console.log(`  falta trámite ${cod}`); continue }
    for (const c of campos) igual(j[c], m[c], `MTA ${cod}.${c}`)
  }
  // MTA por destino
  igual(r.mta.destino.size, Object.keys(ref.mta_destino).length, 'MTA cantidad de destinos')
  for (const [k, m] of Object.entries(ref.mta_destino)) {
    const j = r.mta.destino.get(k)
    if (!j) { fallas++; console.log(`  falta destino ${k}`); continue }
    for (const c of ['n', 'media', 'mediana', 'desviacion', 'p80', 'p95', 'expedientes_atendidos']) {
      igual(j[c], m[c], `MTA destino ${k}.${c}`)
    }
  }
  // Plazos de referencia
  for (const [cod, [v, o]] of Object.entries(ref.plazo_ref)) {
    const j = r.plazoRef.get(cod)
    igual(j.valor, v, `plazo ref ${cod}`)
    igual(j.origen, o, `origen plazo ${cod}`)
  }
  // IUA
  igual(r.referencias.antiguedad, ref.ref_antiguedad, 'IUA ref antigüedad')
  igual(r.referencias.max_carga, ref.max_carga, 'IUA carga máxima')
  igual(r.iua.size, Object.keys(ref.iua).length, 'IUA cantidad de activos')
  for (const [id, v] of Object.entries(ref.iua)) {
    const j = r.iua.get(Number(id))
    if (!j) { fallas++; console.log(`  falta IUA ${id}`); continue }
    igual(j.iua, v.iua, `IUA ${id}`)
    igual(j.nivel, v.nivel, `nivel ${id}`)
    igual(j.vencido, v.vencido, `vencido ${id}`)
    igual(j.dias, v.dias, `días ${id}`)
    for (const [k, f] of Object.entries(v.factores)) igual(j.factores[k], f, `factor ${k} ${id}`)
  }

  console.log(`\n${comparaciones.toLocaleString('es-PE')} comparaciones, ${fallas} diferencias`)
  process.exit(fallas ? 1 : 0)
})()
