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
    ultimo_acceso        TEXT,
    capacidad_maxima     INTEGER DEFAULT 10   -- expedientes que puede tener asignados a la vez (modelo MILP)
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

-- Departamentos en que trabaja cada usuario (máximo 2). usuarios.departamento_codigo
-- sigue siendo el principal; es_principal = 1 lo replica aquí.
CREATE TABLE IF NOT EXISTS usuario_departamentos (
    usuario_id           INTEGER NOT NULL REFERENCES usuarios(id),
    departamento_codigo  TEXT NOT NULL REFERENCES departamentos(codigo),
    es_principal         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (usuario_id, departamento_codigo)
);

-- Lotes de importación de expedientes desde Excel/CSV (pantalla «Importar expedientes»).
-- También registra las importaciones del Control de Expedientes 2026
-- (formato = 'CONTROL_2026'). Equivalencias con la especificación de la v2:
--   total_registros = filas_leidas, importados = expedientes_creados,
--   omitidos = expedientes_omitidos, importado_por = usuario_id,
--   creado_en = fecha_hora, errores (JSON) = detalle.
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
    deshecho_por              INTEGER REFERENCES usuarios(id),
    anio_filtro               TEXT                  -- JSON con los años considerados, p. ej. [2025, 2026]; NULL = todos
);

-- ===========================================================================
-- v2 — Asignación óptima (MILP), seguimiento, reportes, notificaciones, portal
-- ===========================================================================

-- Asignaciones expediente → trabajador (propuestas por el modelo MILP y confirmadas por el administrador)
CREATE TABLE IF NOT EXISTS asignaciones (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    expediente_id     INTEGER NOT NULL REFERENCES expedientes(id),
    usuario_id        INTEGER NOT NULL REFERENCES usuarios(id),
    fecha_asignacion  TEXT NOT NULL,
    fecha_limite      TEXT,
    estado            TEXT NOT NULL DEFAULT 'PENDIENTE',   -- PENDIENTE | EN_PROGRESO | COMPLETADA | REASIGNADA
    iua_al_asignar    REAL,
    eij_score         REAL,
    lote_id           TEXT,                                -- agrupa las asignaciones de una misma corrida
    asignado_por      INTEGER REFERENCES usuarios(id),
    observacion       TEXT,
    creado_en         TEXT NOT NULL,
    actualizado_en    TEXT
);

-- Eficiencia histórica de cada trabajador por tipo de trámite (e_ij del modelo MILP)
CREATE TABLE IF NOT EXISTS eficiencia_trabajador (
    usuario_id            INTEGER NOT NULL REFERENCES usuarios(id),
    procedimiento_codigo  TEXT NOT NULL REFERENCES procedimientos(codigo),
    total_atendidos       INTEGER NOT NULL DEFAULT 0,
    finalizados_a_tiempo  INTEGER NOT NULL DEFAULT 0,
    tiempo_promedio_dias  REAL,
    tasa_finalizacion     REAL,
    velocidad_relativa    REAL,
    experiencia           REAL,
    score_eij             REAL,
    actualizado_en        TEXT,
    PRIMARY KEY (usuario_id, procedimiento_codigo)
);

-- Reportes semanales de avance (se llenan los jueves)
CREATE TABLE IF NOT EXISTS reportes_semanales (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id     INTEGER NOT NULL REFERENCES usuarios(id),
    semana         TEXT NOT NULL,                 -- ISO 8601, p. ej. 2026-W47
    fecha_llenado  TEXT NOT NULL,
    datos          TEXT NOT NULL,                 -- JSON con el formulario completo
    creado_en      TEXT NOT NULL
);

-- Notificaciones internas (campana de la cabecera)
CREATE TABLE IF NOT EXISTS notificaciones (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id       INTEGER NOT NULL REFERENCES usuarios(id),
    tipo             TEXT NOT NULL,               -- ASIGNACION | DERIVACION | REPORTE | RECORDATORIO | SISTEMA
    titulo           TEXT NOT NULL,
    mensaje          TEXT,
    referencia_tipo  TEXT,                        -- expediente | asignacion | reporte
    referencia_id    INTEGER,
    leida            INTEGER NOT NULL DEFAULT 0,
    creado_en        TEXT NOT NULL
);

-- Administrados (ciudadanos) con acceso al portal de consulta
CREATE TABLE IF NOT EXISTS administrados (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    documento_identidad  TEXT NOT NULL UNIQUE,    -- DNI
    nombre_completo      TEXT NOT NULL,
    telefono_whatsapp    TEXT,
    usuario_portal       TEXT UNIQUE,             -- nombre completo sin espacios
    clave_portal_hash    TEXT,
    clave_portal_sal     TEXT,
    activo               INTEGER NOT NULL DEFAULT 1,
    creado_en            TEXT NOT NULL,
    primer_acceso        TEXT
);

-- Firma de recepción: el destinatario acepta con un clic el expediente derivado
CREATE TABLE IF NOT EXISTS recepciones (
    movimiento_id   INTEGER PRIMARY KEY REFERENCES movimientos(id),
    expediente_id   INTEGER NOT NULL REFERENCES expedientes(id),
    usuario_id      INTEGER NOT NULL REFERENCES usuarios(id),
    recibido_en     TEXT NOT NULL                 -- fecha y hora exactas (ISO)
);

-- Documento TUPA de referencia subido por el administrador
CREATE TABLE IF NOT EXISTS tupa_documento (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre_archivo  TEXT NOT NULL,
    contenido       BLOB,                         -- PDF o Excel del TUPA
    subido_por      INTEGER REFERENCES usuarios(id),
    creado_en       TEXT NOT NULL
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
CREATE INDEX IF NOT EXISTS idx_asig_exp     ON asignaciones(expediente_id);
CREATE INDEX IF NOT EXISTS idx_asig_usr     ON asignaciones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_asig_estado  ON asignaciones(estado);
CREATE INDEX IF NOT EXISTS idx_notif_usr    ON notificaciones(usuario_id, leida);
CREATE INDEX IF NOT EXISTS idx_admin_dni    ON administrados(documento_identidad);
CREATE INDEX IF NOT EXISTS idx_rep_sem      ON reportes_semanales(usuario_id, semana);
