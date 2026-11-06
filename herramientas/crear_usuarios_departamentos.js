// Crea las cuentas iniciales por departamento en una base de URBANITO, desde consola.
//
//   node herramientas/crear_usuarios_departamentos.js <ruta/urbanito.db> [carpeta_credenciales]
//
// - Un JEFE_DEPARTAMENTO (jefe.<clave>) y un TECNICO (tecnico.<clave>) por cada
//   uno de los 11 departamentos; además gerente, mesa.partes y admin (si no hay).
// - Idempotente: si un usuario ya existe, lo omite y lo informa.
// - Cada cuenta recibe una contraseña temporal ALEATORIA y debe cambiarla al
//   ingresar. No hay contraseñas fijas en el código ni en el repositorio.
// - Las credenciales se guardan en un Excel en <carpeta_credenciales>
//   (por defecto ./credenciales, que está en .gitignore). Nunca dentro de semilla/.
//
// No use este script sobre semilla/urbanito.db: esa es la base de fábrica.

const fs = require('fs')
const path = require('path')
const ExcelJS = require('exceljs')
const { Sistema } = require('../electron/servicios/sistema')

async function main() {
  const [rutaBd, carpeta = path.join(process.cwd(), 'credenciales')] = process.argv.slice(2)
  if (!rutaBd) {
    console.error('Uso: node herramientas/crear_usuarios_departamentos.js <ruta/urbanito.db> [carpeta_credenciales]')
    process.exit(2)
  }
  const raiz = path.resolve(__dirname, '..')
  const semilla = path.join(raiz, 'semilla')
  if (path.resolve(rutaBd).startsWith(semilla + path.sep)) {
    console.error('No se modifica la base de fábrica (semilla/). Use una copia o la base instalada.')
    process.exit(2)
  }
  const destino = path.resolve(carpeta)
  if (destino === semilla || destino.startsWith(semilla + path.sep)) {
    console.error('Las credenciales no pueden guardarse dentro de semilla/.')
    process.exit(2)
  }
  if (!fs.existsSync(rutaBd)) { console.error(`No existe la base ${rutaBd}`); process.exit(2) }

  const s = new Sistema({ rutaBd, carpetaRespaldos: null })
  await s.iniciar()
  let r
  try {
    r = s.bd.transaccion(() => s.crearCuentasDepartamento({ id: null, usuario: 'consola' }))
  } finally {
    s.detener()
  }

  for (const o of r.omitidos) console.log(`  = ${o.usuario.padEnd(22)} ${o.motivo}, se omite`)
  if (!r.creados.length) {
    console.log('No se creó ninguna cuenta: todas ya existían.')
    return
  }
  console.log(`\nCuentas creadas (lote ${r.lote}):`)
  console.log(`  ${'USUARIO'.padEnd(22)} ${'ROL'.padEnd(22)} ${'CLAVE TEMPORAL'.padEnd(14)} DEPARTAMENTO`)
  for (const c of r.creados) console.log(`  ${c.usuario.padEnd(22)} ${c.rol.padEnd(22)} ${c.clave_temporal.padEnd(14)} ${c.departamento || '—'}`)

  fs.mkdirSync(destino, { recursive: true })
  const archivo = path.join(destino, `credenciales_${r.lote}.xlsx`)
  const libro = new ExcelJS.Workbook()
  const h = libro.addWorksheet('Credenciales')
  h.columns = [
    { header: 'Usuario', key: 'usuario', width: 22 }, { header: 'Nombre', key: 'nombre', width: 48 },
    { header: 'Rol', key: 'rol', width: 22 }, { header: 'Departamento', key: 'departamento', width: 40 },
    { header: 'Contraseña temporal', key: 'clave_temporal', width: 20 },
  ]
  h.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  h.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A68' } }
  for (const c of r.creados) h.addRow(c)
  await libro.xlsx.writeFile(archivo)
  console.log(`\nCredenciales guardadas en: ${archivo}`)
  console.log('Entregue a cada persona solo su clave y borre el archivo después. Cada uno elegirá su contraseña al ingresar.')
}

main().catch(err => { console.error(err.esDeUsuario ? err.message : err); process.exit(1) })
