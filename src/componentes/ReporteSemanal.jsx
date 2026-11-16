// Reporte semanal de avance (jueves desde las 08:00).
// Es OBLIGATORIO: el modal no tiene botón de cerrar, no se cierra con Escape
// ni haciendo clic fuera; solo desaparece al enviar el formulario completo.
import { useState } from 'react'
import { llamar } from '../api'
import { useApp, Modal, Aviso, Campo, Nivel, useAccion } from './Comunes'
import { fecha } from '../formato'

export default function ReporteSemanal({ estado, alEnviar, alCerrar }) {
  const { notificar } = useApp()
  const obligatorio = estado.requerido
  const [items, setItems] = useState(() => Object.fromEntries(estado.asignaciones.map(a => [a.id, {
    estado: a.estado === 'COMPLETADA' ? 'Finalizado' : a.estado === 'EN_PROGRESO' ? 'En proceso' : '', avance: '' }])))
  const [dificultades, setDificultades] = useState('')
  const [adicionales, setAdicionales] = useState('')
  const [apoyo, setApoyo] = useState(false)
  const { ocupado, error, setError, ejecutar } = useAccion()

  const set = (id, k) => (e) => setItems({ ...items, [id]: { ...items[id], [k]: e.target.value } })
  const faltan = estado.asignaciones.filter(a => !items[a.id].estado ||
    (items[a.id].estado === 'En proceso' && items[a.id].avance.trim().length < 10))

  const enviar = async () => {
    if (faltan.length) { setError(`Complete ${faltan.length} expediente(s): elija su estado y, si está «En proceso», describa el avance (mínimo 10 caracteres).`); return }
    const r = await ejecutar(() => llamar('reporte_semanal_enviar', {
      asignaciones: estado.asignaciones.map(a => ({ asignacion_id: a.id, estado: items[a.id].estado, avance: items[a.id].avance })),
      dificultades, adicionales, necesita_apoyo: apoyo }))
    if (r) { notificar(`Reporte de la semana ${r.semana} enviado. ¡Gracias!`, 'exito'); alEnviar() }
  }

  return (
    <Modal titulo={`Reporte semanal de avance — semana ${estado.semana}`} tamano="ancho"
           alCerrar={obligatorio ? null : alCerrar}
           pie={<button className="boton primario grande" disabled={ocupado} onClick={enviar} data-accion="enviar-reporte">
             {ocupado ? 'Enviando…' : 'Enviar reporte'}</button>}>
      {obligatorio && <Aviso tipo="informativo">Hoy es día de reporte semanal. Complete el estado de cada expediente asignado para continuar
        usando URBANITO. Toma unos minutos y ayuda a su jefe a saber dónde necesita apoyo.</Aviso>}
      {!estado.asignaciones.length
        ? <p className="texto-suave" style={{ marginBottom: 12 }}>No tiene asignaciones activas esta semana. Igual puede reportar dificultades o expedientes atendidos fuera de asignación.</p>
        : (
          <div className="tabla-contenedor" style={{ maxHeight: '46vh', marginBottom: 14 }}>
            <table className="tabla" data-prueba="reporte-asignaciones">
              <thead><tr><th>Expediente</th><th>Trámite</th><th>Nivel</th><th>Fecha límite</th><th style={{ width: 170 }}>Estado actual *</th><th>Descripción del avance</th></tr></thead>
              <tbody>{estado.asignaciones.map(a => {
                const it = items[a.id]
                const falta = it.estado === 'En proceso' && it.avance.trim().length < 10
                return (
                  <tr key={a.id}>
                    <td className="mono destacado">{a.numero}</td>
                    <td>{a.procedimiento}<div className="suave">{a.solicitante || ''}</div></td>
                    <td><Nivel nivel={a.nivel} /></td>
                    <td style={{ color: a.vencida ? 'var(--critico)' : undefined }}>{fecha(a.fecha_limite)}</td>
                    <td><select className="control" value={it.estado} onChange={set(a.id, 'estado')} data-campo="estado-reporte">
                      <option value="">— Elija —</option>
                      {estado.estados.map(e => <option key={e} value={e}>{e}</option>)}
                    </select></td>
                    <td><textarea className="control" rows={2} value={it.avance} onChange={set(a.id, 'avance')}
                                  placeholder={it.estado === 'En proceso' ? 'Obligatorio: qué avanzó esta semana' : 'Opcional'}
                                  style={falta ? { borderColor: 'var(--critico)' } : undefined} /></td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        )}
      <div className="formulario">
        <Campo etiqueta="Dificultades encontradas" completo ayuda="Opcional: falta de información, documentos, inspecciones pendientes…">
          <textarea value={dificultades} onChange={e => setDificultades(e.target.value)} />
        </Campo>
        <Campo etiqueta="Expedientes adicionales atendidos fuera de asignación" completo ayuda="Opcional: números de expediente y lo que hizo">
          <textarea value={adicionales} onChange={e => setAdicionales(e.target.value)} />
        </Campo>
        <label className="casilla completo"><input type="checkbox" checked={apoyo} onChange={e => setApoyo(e.target.checked)} data-campo="apoyo" />
          Necesito apoyo del jefe de departamento</label>
      </div>
      {error && <div style={{ marginTop: 10 }}><Aviso tipo="error">{error}</Aviso></div>}
    </Modal>
  )
}
