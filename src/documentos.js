// Documentos imprimibles: constancia de recepción y ficha del expediente.
import { escaparHtml as h, fecha, fechaHora, numero, porcentaje } from './formato'
import { documentoHtml } from './exportar'

export function constanciaHtml(c, usuario) {
  const e = c.estimacion || {}
  const filas = (pares) => pares.map(([k, v]) => `<div><div class="et">${h(k)}</div><div>${h(v ?? '—')}</div></div>`).join('')
  let plazo = 'Este procedimiento no tiene plazo establecido en el TUPA.'
  if (e.plazo_tupa === 0) plazo = `Plazo legal (TUPA): atención el mismo día de su presentación (${fecha(e.fecha_limite_tupa)}).`
  else if (e.plazo_tupa !== null && e.plazo_tupa !== undefined) {
    plazo = `Plazo legal (TUPA): ${e.plazo_tupa} días hábiles. Fecha límite de atención: ${fecha(e.fecha_limite_tupa)}.`
  }
  let estimado = ''
  if (e.mta && !e.mta.insuficiente) {
    estimado = `<p style="margin:6px 0 0">Referencia histórica (${numero(e.mta.n)} casos atendidos): la mitad de estos trámites se resolvió en
      ${numero(e.mta.mediana)} días hábiles o menos y el 80% en ${numero(e.mta.p80)} días hábiles o menos.</p>`
  }
  const cuerpo = `
    <div class="caja" style="text-align:center">
      <div class="et">Número de expediente</div>
      <div style="font-size:26px;font-weight:bold;color:#1a3c6e;letter-spacing:1px">${h(c.numero)}</div>
      <div>Recibido el ${h(fecha(c.fecha_ingreso))}${c.creado_en ? ` — registrado ${h(fechaHora(c.creado_en))}` : ''}</div>
    </div>
    <h2>Datos del administrado</h2>
    <div class="caja grid">${filas([['Solicitante', c.solicitante], ['Documento de identidad', c.documento_identidad],
                                   ['Teléfono', c.telefono], ['Dirección', c.direccion]])}</div>
    <h2>Trámite</h2>
    <div class="caja grid">${filas([['Procedimiento', c.procedimiento], ['Código TUPA', c.tupa_codigo],
                                   ['Folios', c.folios], ['Derivado a', c.destino]])}
      <div style="grid-column:1/-1"><div class="et">Asunto</div><div>${h(c.asunto || '—')}</div></div></div>
    <h2>Plazo</h2>
    <div class="caja"><p style="margin:0">${h(plazo)}</p>${estimado}
      <p style="margin:6px 0 0;font-size:9.5px;color:#666">Los días hábiles excluyen sábados, domingos y feriados. El plazo se suspende
      mientras el expediente esté observado a la espera de subsanación (Ley N° 27444).</p></div>
    <p>Para consultar el estado de su trámite indique el número de expediente <b>${h(c.numero)}</b>.</p>
    <div class="firma"><div>Mesa de partes${c.registrado_por ? `<br>${h(c.registrado_por)}` : ''}</div><div>Administrado</div></div>`
  return documentoHtml({ titulo: 'Constancia de recepción', subtitulo: c.procedimiento, institucion: c.institucion, cuerpo, usuario })
}

export function fichaHtml(f, institucion, usuario) {
  const e = f.expediente
  const filas = (pares) => pares.map(([k, v]) => `<div><div class="et">${h(k)}</div><div>${h(v ?? '—')}</div></div>`).join('')
  let iua = ''
  if (f.iua) {
    const i = f.iua
    iua = `<h2>Prioridad (IUA)</h2><div class="caja">
      <b>IUA ${i.iua.toFixed(3)} — <span class="n-${h(i.nivel)}">${h(i.nivel)}</span></b> · ${h(i.accion)} · Prioridad ${i.prioridad} de ${i.total_activos}
      <table style="margin-top:6px"><thead><tr><th>Factor</th><th class="num">Valor (0–1)</th><th class="num">Peso AHP</th><th class="num">Aporte</th></tr></thead><tbody>
      ${i.factores_meta.map(m => `<tr><td>${h(m.nombre)}</td><td class="num">${i.factores[m.codigo] === null ? 'omitido' : i.factores[m.codigo].toFixed(3)}</td>
        <td class="num">${(i.pesos[m.codigo] * 100).toFixed(1)}%</td><td class="num">${i.aportes[m.codigo] === null ? '—' : i.aportes[m.codigo].toFixed(3)}</td></tr>`).join('')}
      </tbody></table></div>`
  }
  let mta = ''
  if (f.mta && f.mta.datos_suficientes) {
    mta = `<h2>Tiempos reales del trámite (MTA)</h2><div class="caja">Casos históricos: ${numero(f.mta.n)} · mediana ${numero(f.mta.mediana)} d.h. ·
      P80 ${numero(f.mta.p80)} d.h. · cumplimiento del TUPA ${porcentaje(f.mta.tasa_cumplimiento)}
      ${f.mta.dias_expediente !== null ? `<br>Este expediente: ${numero(f.mta.dias_expediente)} d.h. — el ${porcentaje(f.mta.percentil_expediente, 0)} de los casos históricos ${f.mta.en_curso ? 'ya estaba resuelto a esa altura' : 'se resolvió en ese tiempo o menos'}.` : ''}</div>`
  }
  const movs = f.movimientos.map(m => ({ ...m, fecha_t: fecha(m.fecha) }))
  const cuerpo = `
    <div class="caja grid">${filas([['Expediente', `${e.numero} (${e.sistema})`], ['Estado', e.estado_nombre],
      ['Solicitante', e.solicitante], ['Documento', e.documento_identidad], ['Trámite', e.procedimiento],
      ['Departamento', e.departamento], ['Fecha de ingreso', fecha(e.fecha_ingreso)], ['Ubicación actual', e.ubicacion],
      ['Plazo TUPA', e.plazo_tupa !== null && e.plazo_tupa !== undefined ? `${e.plazo_tupa} d.h. (límite ${fecha(e.fecha_limite)})` : (f.procedimiento.plazo_tupa !== null && f.procedimiento.plazo_tupa !== undefined ? `${f.procedimiento.plazo_tupa} d.h.` : 'Sin plazo TUPA')],
      ['Cierre', e.fecha_cierre ? `${fecha(e.fecha_cierre)} — ${e.motivo_cierre || ''}` : '—']])}</div>
    ${iua}${mta}
    <h2>Recorrido</h2>
    <table><thead><tr><th>#</th><th>Fecha</th><th>Movimiento</th><th>Destino</th><th>Documento</th><th class="num">Días en el paso</th><th>Registró</th></tr></thead><tbody>
    ${movs.map(m => `<tr><td>${m.orden}</td><td>${h(m.fecha_t)}${m.fecha_valida ? '' : ' (fecha inválida)'}</td><td>${h(m.tipo || '')}</td>
      <td>${h(m.destino_nombre || m.destino_texto || '—')}</td><td>${h(m.documento || '')}</td>
      <td class="num">${m.dias_en_paso ?? ''}</td><td>${h(m.usuario_nombre || (m.importado ? 'Sistema anterior' : ''))}</td></tr>`).join('')}
    </tbody></table>`
  return documentoHtml({ titulo: `Expediente ${e.numero}`, subtitulo: e.procedimiento, institucion, cuerpo, usuario })
}
