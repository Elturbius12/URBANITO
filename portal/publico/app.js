// Portal ciudadano: ingreso, cambio de contraseña obligatorio y lista de trámites.
// El token vive solo en la pestaña (sessionStorage): al cerrar el navegador se pierde.
(function () {
  'use strict'
  const $ = (id) => document.getElementById(id)
  const vistas = ['v-ingreso', 'v-clave', 'v-tramites']
  const mostrar = (v) => { for (const x of vistas) $(x).hidden = x !== v; $('salir').hidden = v === 'v-ingreso' }
  let token = null
  try { token = sessionStorage.getItem('urbanito_portal') } catch (_) { /* sin almacenamiento */ }
  const guardarToken = (t) => { token = t; try { t ? sessionStorage.setItem('urbanito_portal', t) : sessionStorage.removeItem('urbanito_portal') } catch (_) { /* nada */ } }

  async function api(metodo, ruta, cuerpo) {
    const r = await fetch(ruta, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    })
    const d = await r.json().catch(() => ({ error: 'Respuesta inválida del servidor.' }))
    if (!r.ok) { const e = new Error(d.error || 'Error'); e.codigo = d.codigo; e.estado = r.status; throw e }
    return d
  }

  const fecha = (f) => (f ? f.slice(0, 10).split('-').reverse().join('/') : '—')
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  async function cargarTramites() {
    try {
      const d = await api('GET', '/api/mis-tramites')
      $('saludo').textContent = `Hola, ${d.nombre}`
      const lista = $('lista')
      if (!d.tramites.length) { lista.innerHTML = '<p class="tarjeta">No hay trámites registrados con su DNI.</p>'; mostrar('v-tramites'); return }
      lista.innerHTML = d.tramites.map(t => `
        <article class="tarjeta tramite ${t.en_curso ? (t.vencido ? 'vencido' : 'curso') : 'cerrado'}">
          <div class="fila"><span class="numero">Expediente ${esc(t.numero)}</span><span class="estado">${esc(t.estado)}</span></div>
          <div class="nombre">${esc(t.tramite)}</div>
          <dl>
            <div><dt>Ingreso</dt><dd>${fecha(t.fecha_ingreso)}</dd></div>
            ${t.en_curso ? `<div><dt>Fecha estimada de atención</dt><dd>${fecha(t.fecha_estimada)}${t.vencido ? ' <b class="alerta">(plazo vencido)</b>' : ''}</dd></div>
              <div><dt>Dónde está ahora</dt><dd>${esc(t.departamento_actual || 'Gerencia de Desarrollo Urbano')}</dd></div>`
              : `<div><dt>Atendido el</dt><dd>${fecha(t.fecha_atencion)}</dd></div>`}
            ${t.plazo_tupa != null ? `<div><dt>Plazo legal (TUPA)</dt><dd>${t.plazo_tupa === 0 ? 'Mismo día' : `${t.plazo_tupa} días hábiles`}</dd></div>` : ''}
          </dl>
        </article>`).join('')
      mostrar('v-tramites')
    } catch (e) {
      if (e.codigo === 'CAMBIAR_CLAVE') return mostrar('v-clave')
      guardarToken(null); mostrar('v-ingreso'); $('e-ingreso').textContent = e.message
    }
  }

  $('f-ingreso').addEventListener('submit', async (ev) => {
    ev.preventDefault()
    $('e-ingreso').textContent = ''
    const f = new FormData(ev.target)
    try {
      const r = await api('POST', '/api/ingresar', { usuario: f.get('usuario'), clave: f.get('clave') })
      guardarToken(r.token)
      ev.target.reset()
      if (r.debe_cambiar_clave) mostrar('v-clave'); else cargarTramites()
    } catch (e) { $('e-ingreso').textContent = e.message }
  })

  $('f-clave').addEventListener('submit', async (ev) => {
    ev.preventDefault()
    $('e-clave').textContent = ''
    const f = new FormData(ev.target)
    if (f.get('nueva') !== f.get('repetir')) { $('e-clave').textContent = 'Las contraseñas nuevas no coinciden.'; return }
    try {
      await api('POST', '/api/cambiar-clave', { actual: f.get('actual'), nueva: f.get('nueva') })
      ev.target.reset()
      cargarTramites()
    } catch (e) { $('e-clave').textContent = e.message }
  })

  $('salir').addEventListener('click', async () => {
    try { await api('POST', '/api/salir') } catch (_) { /* ya cerrada */ }
    guardarToken(null); mostrar('v-ingreso')
  })

  if (token) cargarTramites(); else mostrar('v-ingreso')
})()
