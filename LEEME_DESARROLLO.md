# URBANITO — código fuente

Programa de escritorio (Electron + React) con base SQLite embebida (sql.js).

## Estructura
- `electron/` — proceso principal: núcleo del ERP (`servicios/`), modelos (`motor/`: calendario, estadística, AHP, IUA y MTA), red local, exportación.
- `src/` — interfaz (React).
- `semilla/urbanito.db` — base inicial con los datos reales importados (corte 16/10/2026).
- `herramientas/preparar_semilla.py` — genera la base inicial desde `expedientes.csv` / `movimientos.csv` del pipeline anterior.
- `herramientas/referencia_modelos.py` — implementación independiente de los modelos en Python, usada para validar el motor.
- `pruebas/` — validación del motor, pruebas del núcleo, de punta a punta, de red y de exportación.

## Comandos (Node 20+)
```
npm install
npm run iniciar            # compila y abre el programa
npm run probar             # motor vs. referencia Python + pruebas del núcleo
npm run empaquetar:win     # instalador de Windows en distribucion/ (desde Linux requiere wine)
```
Pruebas con interfaz (Linux): `xvfb-run -a node pruebas/e2e.js` y `xvfb-run -a node pruebas/e2e_red.js`.

Regenerar la base inicial: `python herramientas/preparar_semilla.py <carpeta_csv> semilla/urbanito.db`

## Importación de expedientes y usuarios por departamento
- `electron/servicios/importacion.js` — vista previa, confirmación (una transacción por lote, con progreso), historial y deshacer.
- `electron/servicios/lectorArchivos.js` — lectura de .xlsx (solo valores) y CSV (`;` o `,`, comillas, BOM). Detecta por encabezados la plantilla (EXPEDIENTES / MOVIMIENTOS) o el consolidado (SGCUC / SGAU).
- `electron/servicios/plantilla.js` — genera la plantilla única desde los catálogos de la base.
- `electron/motor/clasificacion.js` + `reglas_origen.json` — port a JS de las reglas de `catalogo_tramites.py` y `catalogo_dependencias.py`. Si cambian las reglas Python: `python herramientas/exportar_reglas.py` (la prueba verifica que el JS clasifica igual que la base inicial).
- `electron/servicios/usuariosDepartamento.js` — jefe y técnico por departamento, gerente y mesa de partes, con claves temporales aleatorias.
- Migración automática al abrir (`bd.migrar()`): tablas `importaciones` y `usuario_departamentos`; columnas `importacion_id`, `recibo_numero`, `recibo_monto` y `observaciones`.
- Red: las acciones con archivo usan `/urbanito/importar` (límite 72 MB); el resto, `/urbanito/api` (2 MB).

```
npm run crear-usuarios -- <ruta/urbanito.db> [carpeta_credenciales]   # nunca sobre semilla/
node pruebas/generar_muestra_consolidado.js ../CONSOLIDADO_LIMPIO_V5.xlsx 150   # regenera pruebas/datos/consolidado_muestra.xlsx
node pruebas/prueba_importacion.js semilla/urbanito.db                  # incluida en npm run probar
```
Las credenciales (`credenciales/`, `credenciales_*.xlsx`) están en `.gitignore`.

## Esquema v2 (asignación óptima y seguimiento) — Fase 1
- `configuracion.version_esquema` = 2 (`VERSION_ESQUEMA` en `electron/bd.js`). `bd.migrar()` sube las bases v1 al abrir; cada paso verifica si hace falta, así que es idempotente.
- Tablas nuevas: `asignaciones`, `eficiencia_trabajador`, `reportes_semanales`, `notificaciones`, `administrados`, `tupa_documento` (+ índices).
- Columnas nuevas: `usuarios.capacidad_maxima` (defecto 10), `usuario_departamentos.es_principal`, `importaciones.anio_filtro` (JSON de años).
- `importaciones` NO se redefinió: la importación del Control 2026 usará la tabla existente con `formato = 'CONTROL_2026'` (equivalencias de columnas comentadas en `esquema.sql`).
- Un usuario trabaja en máximo 2 departamentos (`MAX_DEPARTAMENTOS_USUARIO`).
- Permisos nuevos (`seguridad.js`): `asignaciones`, `asignaciones_ver`, `seguimiento`, `mis_asignaciones`, `reporte_semanal`.
- Prueba: `node pruebas/prueba_esquema_v2.js semilla/urbanito.db` (incluida en `npm run probar`).

## v2 — Fases 2 a 7
- Importador Control 2026: `electron/servicios/importador2026.js` (concilia con la base; no duplica). UI: `Importar2026.jsx`.
- Modelo 3 (MILP): `electron/motor/asignacion.js` (glpk.js + heurística voraz), `servicios/asignacionServicio.js`, UI `Asignaciones.jsx`. `glpk.wasm` se copia a `compilado/`.
- Notificaciones (`servicios/notificaciones.js`, campana con polling 10 s, GET `/api/notificaciones-nuevas`), reportes semanales (`servicios/reportesSemanales.js`, `ReporteSemanal.jsx`), seguimiento (`Seguimiento.jsx`).
- Mejoras (`servicios/mejoras.js`): recepción firmada (tabla `recepciones`), plantillas, búsqueda universal, actividad, abandonados, finalizados, antes/después, crear departamento.
- Portal ciudadano: `servicios/portalCiudadano.js` + `portal/` (Express, ver `portal/LEEME.md`).
- Pruebas: `node pruebas/prueba_v2.js semilla/urbanito.db` (en `npm run probar`); interfaz: `node pruebas/e2e_v2.js` (requiere `npm i --no-save playwright`).
