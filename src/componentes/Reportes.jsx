// Reportes exportables a Excel y PDF.
import { useState } from 'react'
import { llamar, useDatos } from '../api'
import { useApp, Panel, Campo, Aviso } from './Comunes'
import { fecha } from '../formato'
import { exportarExcel, exportarPdf, documentoHtml, tablaHtml, COLUMNAS_PRIORIZADOS } from '../exportar'

const COLS_EXP = [
  { titulo: 'Expediente', clave: 'numero', ancho: 16 }, { titulo: 'Sistema', clave: 'sistema', ancho: 10 },
  { titulo: 'Solicitante', clave: 'solicitante', ancho: 34 }, { titulo: 'Trámite', clave: 'procedimiento', ancho: 36 },
  { titulo: 'Departamento', clave: 'departamento', ancho: 32 }, { titulo: 'Estado', clave: 'estado_nombre', ancho: 22 },
  { titulo: 'Fecha de ingreso', clave: 'fecha_ingreso', formato: 'fecha', ancho: 14 }, { titulo: 'Fecha de cierre', clave: 'fecha_cierre', formato: 'fecha', ancho: 14 },
  { titulo: 'Días hábiles de atención', clave: 'dias_atencion', formato: 'numero', ancho: 14 },
  { titulo: 'Ubicación actual', clave: 'ubicacion', ancho: 28 }, { titulo: 'IUA (si está en trámite)', clave: 'iua', formato: 'decimal', ancho: 12 },
  { titulo: 'Nivel', clave: 'nivel', ancho: 10 }, { titulo: 'Cierre', clave: 'motivo_cierre', ancho: 40 },
]
const COLS_PROD = [
  { titulo: 'Usuario', clave: 'usuario', ancho: 18 }, { titulo: 'Nombre', clave: 'nombre', ancho: 32 }, { titulo: 'Rol', clave: 'rol', ancho: 22 },
  { titulo: 'Registros', clave: 'REGISTRO', formato: 'numero' }, { titulo: 'Derivaciones', clave: 'DERIVACION', formato: 'numero' },
  { titulo: 'Observaciones', clave: 'OBSERVACION', formato: 'numero' }, { titulo: 'Subsanaciones', clave: 'SUBSANACION', formato: 'numero' },
  { titulo: 'Finalizaciones', clave: 'FINALIZACION', formato: 'numero' }, { titulo: 'Archivos', clave: 'ARCHIVO', formato: 'numero' },
  { titulo: 'Total de acciones', clave: 'total', formato: 'numero' }, { titulo: 'A su cargo hoy', clave: 'a_cargo', formato: 'numero' },
]

export default function Reportes() {
  const { usuario, notificar, estado } = useApp()
  const { datos: cat } = useDatos('catalogos', {})
  const [f, setF] = useState({ desde: '', hasta: '', estado: '', procedimiento: '', departamento: '' })
  const [ocupado, setOcupado] = useState(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const sub = `${usuario.nombre_completo} — generado el ${fecha(new Date().toISOString())}`

  const correr = async (clave, fn) => {
    setOcupado(clave)
    try { await fn() } catch (e) { notificar(e.message, 'error') } finally { setOcupado(null) }
  }

  const reportes = [
    {
      clave: 'bandeja', titulo: 'Bandeja priorizada completa', desc: 'Todos los expedientes en trámite de su alcance, ordenados por IUA, con plazo, días y nivel.',
      excel: async () => {
        const b = await llamar('bandeja', {})
        await exportarExcel(notificar, `bandeja_priorizada_${b.hoy}`, [{ nombre: 'Bandeja', titulo: 'Bandeja priorizada por IUA', subtitulo: sub, columnas: COLUMNAS_PRIORIZADOS, filas: b.filas }])
      },
      pdf: async () => {
        const b = await llamar('bandeja', {})
        const cols = COLUMNAS_PRIORIZADOS.filter(c => ['prioridad', 'numero', 'solicitante', 'procedimiento', 'ubicacion', 'dias', 'plazo_tupa', 'dias_restantes', 'iua', 'nivel'].includes(c.clave))
        await exportarPdf(notificar, `bandeja_priorizada_${b.hoy}`, documentoHtml({ titulo: 'Bandeja priorizada (IUA)', subtitulo: sub, institucion: estado.institucion, usuario, cuerpo: tablaHtml(cols, b.filas) }), true)
      },
    },
    {
      clave: 'alertas', titulo: 'Alertas', desc: 'Cuatro hojas: vencidos, por vencer, estancados y observados.',
      excel: async () => {
        const a = await llamar('alertas', {})
        const h = (nombre, filas) => ({ nombre, titulo: `Alertas — ${nombre}`, subtitulo: sub, columnas: COLUMNAS_PRIORIZADOS, filas })
        await exportarExcel(notificar, 'alertas', [h('Vencidos', a.vencidos), h('Por vencer', a.por_vencer), h('Estancados', a.estancados), h('Observados', a.observados)])
      },
    },
    {
      clave: 'mta', titulo: 'Modelo 2 — estadísticas de tiempos (MTA)', desc: 'Por trámite, por unidad orgánica, por responsable y plazos de referencia del IUA.',
      excel: async () => {
        const m = await llamar('modelos', {})
        const med = [{ titulo: 'Casos (n)', clave: 'n', formato: 'numero' }, { titulo: 'Media', clave: 'media', formato: 'decimal1' },
          { titulo: 'Mediana', clave: 'mediana', formato: 'decimal1' }, { titulo: 'Desv. estándar', clave: 'desviacion', formato: 'decimal1' },
          { titulo: 'P80', clave: 'p80', formato: 'decimal1' }, { titulo: 'P95', clave: 'p95', formato: 'decimal1' },
          { titulo: 'Coef. variación', clave: 'coef_variacion', formato: 'decimal' }, { titulo: 'Predecibilidad', clave: 'interpretacion', ancho: 22 }]
        await exportarExcel(notificar, 'mta_estadisticas', [
          { nombre: 'Por trámite', titulo: 'MTA por trámite', subtitulo: `Base: ${m.mta.base_n} expedientes cerrados. Días hábiles.`,
            columnas: [{ titulo: 'Trámite', clave: 'nombre', ancho: 42 }, ...med, { titulo: 'Plazo TUPA', clave: 'plazo_tupa', formato: 'numero' },
              { titulo: 'Cumplimiento TUPA', clave: 'tasa_cumplimiento', formato: 'porcentaje' }, { titulo: 'Brecha P80 − TUPA', clave: 'brecha_p80_tupa', formato: 'decimal1' },
              { titulo: '¿Datos suficientes?', clave: 'suf' }], filas: m.mta.tramites.map(t => ({ ...t, suf: t.datos_suficientes ? 'Sí' : 'No' })) },
          { nombre: 'Por unidad', titulo: 'MTA — permanencia por unidad orgánica', subtitulo: 'Días hábiles por paso', columnas: [{ titulo: 'Unidad', clave: 'nombre', ancho: 42 }, { titulo: 'Expedientes', clave: 'expedientes_atendidos', formato: 'numero' }, ...med], filas: m.mta.unidades },
          { nombre: 'Por responsable', titulo: 'MTA — permanencia por responsable', subtitulo: 'Días hábiles por paso', columnas: [{ titulo: 'Responsable', clave: 'nombre', ancho: 30 }, { titulo: 'Expedientes', clave: 'expedientes_atendidos', formato: 'numero' }, ...med], filas: m.mta.responsables },
          { nombre: 'Plazos de referencia', titulo: 'Plazos de referencia del IUA', subtitulo: 'TUPA si existe; si no, P80 observado', columnas: [{ titulo: 'Trámite', clave: 'nombre', ancho: 42 }, { titulo: 'Origen', clave: 'origen', ancho: 16 }, { titulo: 'Plazo de referencia', clave: 'plazo_referencia', formato: 'decimal1' }, { titulo: 'P80 observado', clave: 'p80_observado', formato: 'decimal1' }, { titulo: 'Casos', clave: 'n', formato: 'numero' }], filas: m.plazos },
        ])
      },
    },
    {
      clave: 'cumplimiento', titulo: 'Cumplimiento del TUPA', desc: 'Qué porcentaje de cada trámite se atendió dentro del plazo legal (trámites con 30 casos o más).',
      excel: async () => {
        const t = await llamar('tablero', {})
        await exportarExcel(notificar, 'cumplimiento_tupa', [{ nombre: 'Cumplimiento', titulo: 'Cumplimiento del plazo TUPA', subtitulo: sub,
          columnas: [{ titulo: 'Trámite', clave: 'nombre', ancho: 42 }, { titulo: 'Casos', clave: 'n', formato: 'numero' }, { titulo: 'Mediana', clave: 'mediana', formato: 'decimal1' },
            { titulo: 'P80', clave: 'p80', formato: 'decimal1' }, { titulo: 'Plazo TUPA', clave: 'plazo_tupa', formato: 'numero' }, { titulo: 'Cumplimiento', clave: 'tasa_cumplimiento', formato: 'porcentaje' },
            { titulo: 'Brecha P80 − TUPA', clave: 'brecha_p80_tupa', formato: 'decimal1' }], filas: t.cumplimiento }])
      },
      pdf: async () => {
        const t = await llamar('tablero', {})
        await exportarPdf(notificar, 'cumplimiento_tupa', documentoHtml({ titulo: 'Cumplimiento del plazo TUPA', subtitulo: sub, institucion: estado.institucion, usuario,
          cuerpo: tablaHtml([{ titulo: 'Trámite', clave: 'nombre' }, { titulo: 'Casos', clave: 'n', formato: 'numero' }, { titulo: 'Mediana', clave: 'mediana', formato: 'decimal1' },
            { titulo: 'P80', clave: 'p80', formato: 'decimal1' }, { titulo: 'TUPA', clave: 'plazo_tupa', formato: 'numero' }, { titulo: 'Cumplimiento', clave: 'tasa_cumplimiento', formato: 'porcentaje' }], t.cumplimiento) }))
      },
    },
    {
      clave: 'productividad', titulo: 'Productividad por usuario', desc: 'Acciones registradas en URBANITO por cada usuario en el rango de fechas (registros, derivaciones, finalizaciones…).',
      excel: async () => {
        const p = await llamar('productividad', { desde: f.desde || undefined, hasta: f.hasta || undefined })
        await exportarExcel(notificar, 'productividad', [{ nombre: 'Productividad', titulo: 'Productividad por usuario',
          subtitulo: `${f.desde ? fecha(f.desde) : 'inicio'} a ${f.hasta ? fecha(f.hasta) : 'hoy'} — ${sub}`, columnas: COLS_PROD, filas: p }])
      },
    },
    {
      clave: 'expedientes', titulo: 'Listado de expedientes', desc: 'Todos los expedientes que cumplan los filtros de abajo, con estado, fechas y días de atención.',
      excel: async () => {
        if (!f.desde && !f.hasta && !f.procedimiento && !f.departamento && !f.estado) {
          if (!window.confirm('Sin filtros se exportan todos los expedientes (más de 50 mil filas). ¿Continuar?')) return
        }
        const filas = await llamar('exportar_busqueda', f)
        await exportarExcel(notificar, 'expedientes', [{ nombre: 'Expedientes', titulo: 'Listado de expedientes', subtitulo: sub, columnas: COLS_EXP, filas }])
      },
    },
  ]

  return (
    <>
      <Panel titulo="Filtros para «Listado de expedientes» y «Productividad»">
        <div className="filtros">
          <Campo etiqueta="Ingreso desde"><input type="date" className="control" value={f.desde} onChange={set('desde')} /></Campo>
          <Campo etiqueta="hasta"><input type="date" className="control" value={f.hasta} onChange={set('hasta')} /></Campo>
          <Campo etiqueta="Estado">
            <select className="control" value={f.estado} onChange={set('estado')}>
              <option value="">Todos</option>
              {cat && Object.entries(cat.estados).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Campo>
          {usuario.departamentos_elegibles.length > 1 && (
            <Campo etiqueta="Departamento">
              <select className="control" value={f.departamento} onChange={set('departamento')}>
                <option value="">Todos</option>
                {usuario.departamentos_elegibles.map(d => <option key={d.codigo} value={d.codigo}>{d.nombre}</option>)}
              </select>
            </Campo>
          )}
          <Campo etiqueta="Trámite">
            <select className="control" value={f.procedimiento} onChange={set('procedimiento')}>
              <option value="">Todos</option>
              {cat && cat.procedimientos.map(p => <option key={p.codigo} value={p.codigo}>{p.nombre}</option>)}
            </select>
          </Campo>
        </div>
      </Panel>
      {usuario.rol === 'JEFE_DEPARTAMENTO' && <Aviso tipo="informativo">Los reportes incluyen solo los expedientes de {usuario.departamentos.length > 1 ? 'sus departamentos' : 'su departamento'}.</Aviso>}
      <div className="tres-columnas">
        {reportes.map(r => (
          <Panel key={r.clave} titulo={r.titulo}>
            <p className="texto-suave" style={{ fontSize: 13, minHeight: 58 }}>{r.desc}</p>
            <div className="grupo-botones">
              <button className="boton primario" disabled={!!ocupado} onClick={() => correr(r.clave, r.excel)} data-reporte={r.clave}>
                {ocupado === r.clave ? 'Generando…' : '⬇ Excel'}</button>
              {r.pdf && <button className="boton" disabled={!!ocupado} onClick={() => correr(r.clave, r.pdf)}>PDF</button>}
            </div>
          </Panel>
        ))}
      </div>
    </>
  )
}
