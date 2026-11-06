// Compila el proceso principal (y sus librerías) en un solo archivo, para que
// el programa empaquetado no dependa de copiar correctamente node_modules.
//   node herramientas/compilar_principal.js
const esbuild = require('esbuild')
const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const SALIDA = path.join(RAIZ, 'compilado')

fs.rmSync(SALIDA, { recursive: true, force: true })
fs.mkdirSync(SALIDA, { recursive: true })

esbuild.buildSync({
  entryPoints: [path.join(RAIZ, 'electron', 'main.js')],
  bundle: true, platform: 'node', target: 'node20', format: 'cjs',
  external: ['electron'], outfile: path.join(SALIDA, 'main.js'),
  logLevel: 'warning', legalComments: 'none',
})
fs.copyFileSync(path.join(RAIZ, 'electron', 'preload.js'), path.join(SALIDA, 'preload.js'))
fs.copyFileSync(path.join(RAIZ, 'electron', 'esquema.sql'), path.join(SALIDA, 'esquema.sql'))
fs.copyFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'), path.join(SALIDA, 'sql-wasm.wasm'))
console.log('Proceso principal compilado en', SALIDA, `(${(fs.statSync(path.join(SALIDA, 'main.js')).size / 1e6).toFixed(1)} MB)`)
