// Alertas: vencidos, por vencer, estancados y observados.
import { useState } from 'react'
import { useDatos } from '../api'
import { useApp, Panel, Cargando, ErrorCarga, Pestanas, Aviso } from './Comunes'
import TablaExpedientes from './TablaExpedientes'
import { exportarExcel, COLUMNAS_PRIORIZADOS } from '../exportar'
import { fecha } from '../formato'

export default function Alertas() {
  const { version, notificar, usuario } = useApp()
  const [pestana, setPestana] = useState('vencidos')
  const { datos: a, error, recargar } = useDatos('alertas', {}, [version])
  if (error) return <ErrorCarga error={error} reintentar={recargar} />
  if (!a) return <Cargando />

  const grupos = {
    vencidos: { filas: a.vencidos, titulo: 'Plazo TUPA vencido',
      texto: 'Superaron su plazo legal. Si un trámite sujeto a silencio administrativo vence, el administrado puede darlo por aprobado o denegado según el TUPA. Están marcados como CRÍTICOS sin importar su puntaje.',
      columnas: ['numero', 'solicitante', 'tramite', 'ubicacion', 'plazo', 'iua', 'nivel'] },
    por_vencer: { filas: a.por_vencer, titulo: `Vencen en ${a.dias_alerta} días hábiles o menos`,
      texto: 'Todavía están dentro del plazo. Es el momento de actuar para no llegar al vencimiento.',
      columnas: ['numero', 'solicitante', 'tramite', 'ubicacion', 'plazo', 'iua', 'nivel'] },
    estancados: { filas: a.estancados, titulo: 'Estancados',
      texto: 'Llevan en su ubicación actual más días sin movimiento que el percentil 80 histórico de esa misma oficina o persona (Modelo 2). Solo se evalúan ubicaciones con al menos 30 pasos históricos.',
      columnas: ['numero', 'solicitante', 'tramite', 'ubicacion', 'sin_mov', 'iua', 'nivel'] },
    abandonados: { filas: a.abandonados || [], titulo: `Abandonados (sin movimiento por ${a.dias_abandono} d.h. o más)`,
      texto: `Llevan ${a.dias_abandono} días hábiles o más sin ningún movimiento registrado. Revise si siguen en trámite, si deben derivarse o archivarse. El administrador cambia este límite en Configuración › Parámetros.`,
      columnas: ['numero', 'solicitante', 'tramite', 'ubicacion', 'sin_mov', 'iua', 'nivel'] },
    observados: { filas: a.observados, titulo: 'Observados',
      texto: 'Esperan que el administrado subsane. El plazo está suspendido. Si no subsana, pueden archivarse por abandono.',
      columnas: ['numero', 'solicitante', 'tramite', 'ubicacion', 'sin_mov', 'nivel'] },
  }
  const g = grupos[pestana]

  return (
    <>
      <Pestanas activa={pestana} alCambiar={setPestana} opciones={[
        { clave: 'vencidos', etiqueta: `Vencidos (${a.vencidos.length})` },
        { clave: 'por_vencer', etiqueta: `Por vencer (${a.por_vencer.length})` },
        { clave: 'estancados', etiqueta: `Estancados (${a.estancados.length})` },
        { clave: 'abandonados', etiqueta: `Abandonados (${(a.abandonados || []).length})` },
        { clave: 'observados', etiqueta: `Observados (${a.observados.length})` },
      ]} />
      <Aviso tipo="informativo">{g.texto}</Aviso>
      <Panel sinRelleno titulo={g.titulo}
             acciones={<button className="boton pequeno" disabled={!g.filas.length} onClick={() => exportarExcel(notificar, `alertas_${pestana}`, [{
               nombre: g.titulo, titulo: `Alertas — ${g.titulo}`, subtitulo: `${usuario.nombre_completo} — ${fecha(new Date().toISOString())}`,
               columnas: COLUMNAS_PRIORIZADOS, filas: g.filas }])}>⬇ Exportar a Excel</button>}>
        <TablaExpedientes filas={g.filas} columnas={g.columnas} vacio="Ninguno. ¡Bien!" alto="calc(100vh - 330px)" />
      </Panel>
      {a.sin_plazo_referencia.length > 0 && (
        <p className="texto-tenue" style={{ fontSize: 12 }}>
          {a.sin_plazo_referencia.length} expediente(s) en trámite no tienen plazo TUPA ni suficientes casos históricos: su IUA se calcula
          con los factores disponibles y no pueden generar alertas de vencimiento.
        </p>
      )}
    </>
  )
}
