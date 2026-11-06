// Acceso a la base de datos SQLite (sql.js, sin dependencias nativas).
// La base vive en memoria y se guarda en disco tras cada operación de
// escritura, de forma atómica (archivo temporal + renombrar), para que un
// corte de luz no deje el archivo a medio escribir.

const fs = require('fs')
const path = require('path')
const initSqlJs = require('sql.js/dist/sql-wasm.js')

let SQL = null

async function cargarMotorSql() {
  if (SQL) return SQL
  // En el programa compilado el .wasm va junto al código; en desarrollo, en node_modules.
  const junto = path.join(__dirname, 'sql-wasm.wasm')
  const wasm = fs.existsSync(junto) ? junto : require.resolve('sql.js/dist/sql-wasm.wasm')
  SQL = await initSqlJs({ locateFile: () => wasm })
  return SQL
}

class BaseDatos {
  constructor(db, ruta) {
    this.db = db
    this.ruta = ruta
    this.pendiente = null
    this.ocupada = null          // motivo de una transacción larga en curso (importación)
  }

  static async abrir(ruta) {
    const S = await cargarMotorSql()
    const db = new S.Database(fs.readFileSync(ruta))
    db.exec('PRAGMA foreign_keys = ON;')
    return new BaseDatos(db, ruta)
  }

  static limpiar(params) {
    return params.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v))
  }

  todas(sql, params = []) {
    const st = this.db.prepare(sql)
    try {
      st.bind(BaseDatos.limpiar(params))
      const filas = []
      while (st.step()) filas.push(st.getAsObject())
      return filas
    } finally {
      st.free()
    }
  }

  una(sql, params = []) {
    return this.todas(sql, params)[0] || null
  }

  ejecutar(sql, params = []) {
    this.db.run(sql, BaseDatos.limpiar(params))
    return {
      cambios: this.db.getRowsModified(),
      ultimoId: this.una('SELECT last_insert_rowid() AS id').id,
    }
  }

  // Sentencia preparada para inserciones masivas (mucho más rápida que ejecutar()).
  preparar(sql) {
    const st = this.db.prepare(sql)
    return {
      ejecutar: (params = []) => { st.run(BaseDatos.limpiar(params)) },
      liberar: () => st.free(),
    }
  }

  exigirLibre() {
    if (this.ocupada) {
      const e = new Error(`Hay una ${this.ocupada} en curso. Espere unos segundos e intente de nuevo.`)
      e.esDeUsuario = true
      e.codigo = 'OCUPADO'
      throw e
    }
  }

  // Ejecuta fn dentro de una transacción; si algo falla, se deshace todo.
  transaccion(fn) {
    this.exigirLibre()
    this.db.exec('BEGIN')
    try {
      const r = fn()
      this.db.exec('COMMIT')
      this.guardar()
      return r
    } catch (err) {
      try { this.db.exec('ROLLBACK') } catch (_) { /* sin transacción abierta */ }
      throw err
    }
  }

  // Transacción larga y asíncrona (importación por lotes): fn puede ceder el
  // control entre lotes para informar el progreso sin congelar el programa.
  // Mientras dura, cualquier otra escritura se rechaza con un mensaje claro.
  async transaccionLarga(motivo, fn) {
    this.exigirLibre()
    this.ocupada = motivo
    this.db.exec('BEGIN')
    try {
      const r = await fn()
      this.db.exec('COMMIT')
      this.guardar()
      return r
    } catch (err) {
      try { this.db.exec('ROLLBACK') } catch (_) { /* sin transacción abierta */ }
      throw err
    } finally {
      this.ocupada = null
    }
  }

  columnas(tabla) {
    return new Set(this.todas(`PRAGMA table_info(${tabla})`).map(c => c.name))
  }

  // Migración de esquema idempotente para bases ya existentes (la semilla y
  // las ya instaladas). Las tablas nuevas las crea esquema.sql (CREATE TABLE
  // IF NOT EXISTS); aquí se agregan columnas nuevas a tablas antiguas.
  // Devuelve la lista de cambios aplicados.
  migrar() {
    const aplicados = []
    const agregar = (tabla, columna, tipo) => {
      if (!this.columnas(tabla).has(columna)) {
        this.db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${tipo}`)
        aplicados.push(`${tabla}.${columna}`)
      }
    }
    agregar('expedientes', 'importacion_id', 'INTEGER REFERENCES importaciones(id)')
    agregar('movimientos', 'importacion_id', 'INTEGER REFERENCES importaciones(id)')
    agregar('expedientes', 'recibo_numero', 'TEXT')
    agregar('expedientes', 'recibo_monto', 'REAL')
    agregar('expedientes', 'observaciones', 'TEXT')
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_exp_importacion ON expedientes(importacion_id);
                  CREATE INDEX IF NOT EXISTS idx_mov_importacion ON movimientos(importacion_id);
                  CREATE INDEX IF NOT EXISTS idx_exp_sistema_numero ON expedientes(sistema, numero);`)
    // el departamento principal de cada usuario también figura en usuario_departamentos
    this.db.run(`INSERT OR IGNORE INTO usuario_departamentos(usuario_id, departamento_codigo)
                 SELECT id, departamento_codigo FROM usuarios WHERE departamento_codigo IS NOT NULL`)
    if (this.db.getRowsModified()) aplicados.push(`usuario_departamentos (${this.db.getRowsModified()} filas)`)
    if (aplicados.length) this.guardar()
    return aplicados
  }

  guardar() {
    const datos = Buffer.from(this.db.export())
    const tmp = `${this.ruta}.tmp`
    const fd = fs.openSync(tmp, 'w')
    try {
      fs.writeSync(fd, datos)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(tmp, this.ruta)
    // db.export() desactiva las claves foráneas en sql.js; se reactivan.
    this.db.exec('PRAGMA foreign_keys = ON;')
  }

  configuracion() {
    const cfg = {}
    for (const f of this.todas('SELECT clave, valor FROM configuracion')) cfg[f.clave] = JSON.parse(f.valor)
    return cfg
  }

  cerrar() {
    this.db.close()
  }
}

// Carga en memoria lo que necesita el motor de modelos.
function cargarAlmacen(bd) {
  const expedientes = new Map()
  for (const e of bd.todas('SELECT * FROM expedientes')) expedientes.set(e.id, e)
  const movimientos = new Map()
  for (const m of bd.todas('SELECT * FROM movimientos ORDER BY expediente_id, orden, id')) {
    if (!movimientos.has(m.expediente_id)) movimientos.set(m.expediente_id, [])
    movimientos.get(m.expediente_id).push(m)
  }
  const procedimientos = new Map()
  for (const p of bd.todas('SELECT * FROM procedimientos')) procedimientos.set(p.codigo, p)
  return {
    expedientes, movimientos, procedimientos,
    configuracion: bd.configuracion(),
    feriados: bd.todas('SELECT fecha FROM feriados').map(f => f.fecha),
  }
}

function copiarSiNoExiste(origen, destino) {
  if (fs.existsSync(destino)) return false
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  fs.copyFileSync(origen, destino)
  return true
}

module.exports = { BaseDatos, cargarAlmacen, cargarMotorSql, copiarSiNoExiste }
