-- ===========================================================================
-- URBANITO — esquema de la base de datos
-- Lo usan el preparador de la base inicial (Python) y el programa (Electron).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS configuracion (
    clave   TEXT PRIMARY KEY,
    valor   TEXT NOT NULL            -- JSON
);

CREATE TABLE IF NOT EXISTS departamentos (
    codigo  TEXT PRIMARY KEY,
    nombre  TEXT NOT NULL,
    activo  INTEGER NOT NULL DEFAULT 1
);

-- Unidades orgánicas de la municipalidad (destinos de derivación)
CREATE TABLE IF NOT EXISTS unidades (
    codigo     TEXT PRIMARY KEY,
    nombre     TEXT NOT NULL,
    categoria  TEXT,
    activo     INTEGER NOT NULL DEFAULT 1
);

-- Catálogo de procedimientos (trámites) con su plazo legal del TUPA
CREATE TABLE IF NOT EXISTS procedimientos (
    codigo               TEXT PRIMARY KEY,
    nombre               TEXT NOT NULL,
    grupo                TEXT,
    es_tramite           INTEGER NOT NULL,      -- 1 trámite de ciudadano, 0 acto interno
    tupa_codigo          TEXT,
    tupa_nombre          TEXT,
    plazo_tupa           INTEGER,               -- días hábiles; NULL = sin plazo normativo
    departamento_codigo  TEXT REFERENCES departamentos(codigo),
    seleccionable        INTEGER NOT NULL DEFAULT 1,   -- aparece en mesa de partes
    activo               INTEGER NOT NULL DEFAULT 1
);

-- Calendario: feriados que no cuentan como día hábil
CREATE TABLE IF NOT EXISTS feriados (
    fecha   TEXT PRIMARY KEY,            -- AAAA-MM-DD
    nombre  TEXT NOT NULL,
    origen  TEXT NOT NULL                -- 'LEY' (cargado de fábrica) | 'ADMINISTRADOR'
);

CREATE TABLE IF NOT EXISTS usuarios (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario              TEXT NOT NULL UNIQUE,
    nombre_completo      TEXT NOT NULL,
    rol                  TEXT NOT NULL,
    departamento_codigo  TEXT,
    alias_historico      TEXT,           -- nombre con que aparece en los registros importados
    hash                 TEXT NOT NULL,
    sal                  TEXT NOT NULL,
    activo               INTEGER NOT NULL DEFAULT 1,
    debe_cambiar_clave   INTEGER NOT NULL DEFAULT 1,
    intentos_fallidos    INTEGER NOT NULL DEFAULT 0,
    bloqueado_hasta      TEXT,
    creado_en            TEXT NOT NULL,
    ultimo_acceso        TEXT
);

CREATE TABLE IF NOT EXISTS expedientes (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    numero                  TEXT NOT NULL,
    sistema                 TEXT NOT NULL,      -- SGCUC | SGAU (importados) | URBANITO (nuevos)
    solicitante             TEXT,
    documento_identidad     TEXT,
    telefono                TEXT,
    direccion               TEXT,
    procedimiento_codigo    TEXT REFERENCES procedimientos(codigo),
    asunto                  TEXT,
    folios                  INTEGER,
    fecha_ingreso           TEXT,               -- AAAA-MM-DD
    estado                  TEXT NOT NULL,      -- EN_TRAMITE | OBSERVADO | FINALIZADO | ARCHIVADO | CERRADO_HISTORICO | SIN_FECHA
    fecha_cierre            TEXT,
    motivo_cierre           TEXT,
    responsable_usuario_id  INTEGER REFERENCES usuarios(id),
    ubicacion_tipo          TEXT,               -- USUARIO | UNIDAD ORGANICA | RESPONSABLE | ESTADO | SIN DATO | NO IDENTIFICADO
    ubicacion_codigo        TEXT,
    ubicacion_nombre        TEXT,
    importado               INTEGER NOT NULL DEFAULT 0,
    fecha_invalida          INTEGER NOT NULL DEFAULT 0,
    registrado_por          INTEGER REFERENCES usuarios(id),
    creado_en               TEXT,
    importacion_id          INTEGER REFERENCES importaciones(id),   -- lote de importación desde la interfaz
    recibo_numero           TEXT,
    recibo_monto            REAL,
    observaciones           TEXT,
    UNIQUE (sistema, numero)
);

CREATE TABLE IF NOT EXISTS movimientos (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    expediente_id       INTEGER NOT NULL REFERENCES expedientes(id),
    orden               INTEGER NOT NULL,
    fecha               TEXT,               -- AAAA-MM-DD
    tipo                TEXT,               -- REGISTRO | DERIVACION | OBSERVACION | SUBSANACION | FINALIZACION | ARCHIVO | REASIGNACION | (texto importado)
    destino_texto       TEXT,
    destino_tipo        TEXT,
    destino_codigo      TEXT,
    destino_nombre      TEXT,
    destino_usuario_id  INTEGER REFERENCES usuarios(id),
    documento           TEXT,
    folios              TEXT,
    observacion         TEXT,
    usuario_id          INTEGER REFERENCES usuarios(id),
    registrado_en       TEXT,
    fecha_valida        INTEGER NOT NULL DEFAULT 1,
    importado           INTEGER NOT NULL DEFAULT 0,
    importacion_id      INTEGER REFERENCES importaciones(id)
);

-- Departamentos en que trabaja cada usuario (usuarios.departamento_codigo es el principal)
CREATE TABLE IF NOT EXISTS usuario_departamentos (
    usuario_id           INTEGER NOT NULL REFERENCES usuarios(id),
    departamento_codigo  TEXT NOT NULL REFERENCES departamentos(codigo),
    PRIMARY KEY (usuario_id, departamento_codigo)
);

-- Lotes de importación de expedientes desde Excel/CSV (pantalla «Importar expedientes»)
CREATE TABLE IF NOT EXISTS importaciones (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha_hora                TEXT NOT NULL,
    usuario_id                INTEGER REFERENCES usuarios(id),
    departamento_codigo       TEXT,                 -- NULL = todos los departamentos
    nombre_archivo            TEXT NOT NULL,
    formato                   TEXT,                 -- PLANTILLA | CONSOLIDADO
    filas_leidas              INTEGER NOT NULL DEFAULT 0,
    expedientes_creados       INTEGER NOT NULL DEFAULT 0,
    expedientes_omitidos      INTEGER NOT NULL DEFAULT 0,
    expedientes_actualizados  INTEGER NOT NULL DEFAULT 0,
    movimientos_creados       INTEGER NOT NULL DEFAULT 0,
    errores                   INTEGER NOT NULL DEFAULT 0,
    estado                    TEXT NOT NULL,        -- COMPLETADO | DESHECHO
    detalle                   TEXT,                 -- JSON: valores previos de los expedientes actualizados
    deshecho_en               TEXT,
    deshecho_por              INTEGER REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS auditoria (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha_hora  TEXT NOT NULL,
    usuario_id  INTEGER,
    usuario     TEXT,
    accion      TEXT NOT NULL,
    entidad     TEXT,
    entidad_id  TEXT,
    detalle     TEXT
);

CREATE INDEX IF NOT EXISTS idx_exp_estado   ON expedientes(estado);
CREATE INDEX IF NOT EXISTS idx_exp_proc     ON expedientes(procedimiento_codigo);
CREATE INDEX IF NOT EXISTS idx_exp_resp     ON expedientes(responsable_usuario_id);
CREATE INDEX IF NOT EXISTS idx_exp_numero   ON expedientes(numero);
CREATE INDEX IF NOT EXISTS idx_exp_solic    ON expedientes(solicitante);
CREATE INDEX IF NOT EXISTS idx_mov_exp      ON movimientos(expediente_id, orden);
CREATE INDEX IF NOT EXISTS idx_aud_fecha    ON auditoria(fecha_hora);
