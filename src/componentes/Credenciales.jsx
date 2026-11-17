// Tabla de cuentas recién creadas con su contraseña temporal.
// Se muestra UNA sola vez: después solo existe «Nueva clave» (restablecer).
import { escaparHtml as h } from '../formato'
import { documentoHtml, exportarExcel, exportarPdf } from '../exportar'

const neutralizar = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v)

export default function Credenciales({ lista, omitidos = [], institucion, avisar = (t) => window.alert(t) }) {
  const sello = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  const archivo = `credenciales_urbanito_${sello}`

  const copiar = async () => {
    const tsv = ['Usuario\tNombre\tRol\tDepartamento\tClave temporal',
      ...lista.map(c => [c.usuario, c.nombre, c.rol, c.departamento || '', c.clave_temporal].join('\t'))].join('\n')
    try { await navigator.clipboard.writeText(tsv); avisar('Tabla copiada al portapapeles', 'exito') } catch (_) { avisar('No se pudo copiar', 'error') }
  }
  const excel = async () => {
    await exportarExcel(avisar, archivo, [{
      nombre: 'Credenciales', titulo: 'URBANITO — Credenciales iniciales (contraseñas temporales)',
      subtitulo: 'Entregue a cada persona solo su fila. Deberá cambiar la contraseña al ingresar. Guarde este archivo fuera de la carpeta del programa y elimínelo después de entregar las claves.',
      columnas: [{ titulo: 'Usuario', clave: 'usuario', ancho: 22 }, { titulo: 'Nombre', clave: 'nombre', ancho: 48 },
                 { titulo: 'Rol', clave: 'rol', ancho: 22 }, { titulo: 'Departamento', clave: 'departamento', ancho: 40 },
                 { titulo: 'Contraseña temporal', clave: 'clave_temporal', ancho: 20 }],
      filas: lista.map(c => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, neutralizar(v)]))),
    }])
  }
  const pdf = async () => {
    const cuerpo = lista.map(c => `<div class="caja" style="page-break-inside:avoid">
      <div class="grid"><div><span class="et">Usuario</span><br><b style="font-size:14px">${h(c.usuario)}</b></div>
      <div><span class="et">Contraseña temporal</span><br><b style="font-size:14px;font-family:monospace">${h(c.clave_temporal)}</b></div>
      <div><span class="et">Nombre</span><br>${h(c.nombre)}</div><div><span class="et">Rol / departamento</span><br>${h(c.rol)}${c.departamento ? ` — ${h(c.departamento)}` : ''}</div></div>
      <div style="font-size:9.5px;color:#555;margin-top:4px">Al ingresar por primera vez URBANITO le pedirá elegir su propia contraseña.</div></div>`).join('')
    const html = documentoHtml({ titulo: 'Credenciales iniciales de URBANITO', subtitulo: 'Recorte y entregue a cada persona solo su recuadro', institucion, cuerpo })
    await exportarPdf(avisar, archivo, html)
  }

  return (
    <>
      <div className="tabla-contenedor" style={{ maxHeight: 360, overflow: 'auto' }}>
        <table className="tabla" data-prueba="credenciales">
          <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Departamento</th><th>Clave temporal</th></tr></thead>
          <tbody>{lista.map(c => (
            <tr key={c.usuario}><td className="mono destacado">{c.usuario}</td><td>{c.nombre}</td><td>{c.rol}</td>
              <td>{c.departamento || '—'}</td><td className="mono">{c.clave_temporal}</td></tr>))}</tbody>
        </table>
      </div>
      {omitidos.length > 0 && <p className="texto-suave" style={{ fontSize: 12.5, marginTop: 8 }}>
        Ya existían y se omitieron: {omitidos.map(o => o.usuario).join(', ')}.</p>}
      <div className="grupo-botones" style={{ marginTop: 12 }}>
        <button className="boton" onClick={copiar}>Copiar</button>
        <button className="boton" onClick={excel}>⇩ Descargar Excel</button>
        <button className="boton" onClick={pdf}>⇩ Descargar PDF</button>
      </div>
    </>
  )
}
