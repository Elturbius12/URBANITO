// Los 11 departamentos y sus trámites del TUPA.
import { useState } from 'react'
import { useDatos, llamar } from '../api'
import { useApp, Panel, Cargando, ErrorCarga, Insignia, Aviso, Modal, Campo, useAccion } from './Comunes'
import { numero, porcentaje } from '../formato'

export default function Departamentos() {
  const { version, ir, usuario, refrescar } = useApp()
  const { datos, error, recargar } = useDatos('departamentos', {}, [version])
  const [abierto, setAbierto] = useState(null)
  const [nuevo, setNuevo] = useState(false)
  if (error) return <ErrorCarga error={error} reintentar={recargar} />
  if (!datos) return <Cargando />

  return (
    <>
      <Aviso tipo="informativo">Cada departamento agrupa los trámites del TUPA que atiende. Los expedientes históricos vienen del sistema anterior;
        los nuevos se registran en mesa de partes. Un departamento sin expedientes no tuvo casos en los datos importados.</Aviso>
      {usuario.rol === 'ADMINISTRADOR' && (
        <div className="grupo-botones" style={{ marginBottom: 12 }}>
          <button className="boton primario" onClick={() => setNuevo(true)} data-accion="nuevo-departamento">+ Añadir departamento</button>
          <span className="texto-suave" style={{ fontSize: 12.5 }}>El personal de cada departamento se asigna en «Usuarios» (hasta 2 departamentos por persona).</span>
        </div>
      )}
      {nuevo && <NuevoDepartamento alCerrar={() => setNuevo(false)} alListo={() => { setNuevo(false); recargar(); refrescar() }} />}
      <Panel sinRelleno>
        <table className="tabla">
          <thead><tr><th></th><th>Departamento</th><th className="num">Trámites</th><th className="num">Expedientes</th>
            <th className="num">En trámite</th><th className="num">Críticos</th><th className="num">Vencidos</th><th>Personal</th></tr></thead>
          <tbody>
            {datos.map(d => (
              <FilaDepartamento key={d.codigo} d={d} abierto={abierto === d.codigo || datos.length === 1}
                                alternar={() => setAbierto(abierto === d.codigo ? null : d.codigo)}
                                verBandeja={() => ir('bandeja')} />
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  )
}

function FilaDepartamento({ d, abierto, alternar, verBandeja }) {
  return (
    <>
      <tr className="clicable" onClick={alternar}>
        <td style={{ width: 22 }}>{abierto ? '▾' : '▸'}</td>
        <td className="destacado">{d.nombre}</td>
        <td className="num">{d.tramites.length}</td>
        <td className="num">{numero(d.total_expedientes)}</td>
        <td className="num">{numero(d.total_en_tramite)}</td>
        <td className="num">{d.total_criticos ? <Insignia tipo="CRÍTICO">{d.total_criticos}</Insignia> : 0}</td>
        <td className="num">{d.total_vencidos ? <Insignia tipo="CRÍTICO">{d.total_vencidos}</Insignia> : 0}</td>
        <td className="suave">{d.usuarios.length ? d.usuarios.map(u => u.nombre).join(', ') : 'Sin usuarios asignados'}</td>
      </tr>
      {abierto && (
        <tr><td></td><td colSpan={7} style={{ background: 'var(--fondo)' }}>
          <table className="tabla" style={{ background: '#fff', marginBottom: 8 }}>
            <thead><tr><th>Trámite</th><th>Código TUPA</th><th className="num">Plazo TUPA</th><th className="num">Expedientes</th>
              <th className="num">En trámite</th><th className="num">Mediana real</th><th className="num">P80 real</th><th className="num">Cumple TUPA</th></tr></thead>
            <tbody>
              {d.tramites.map(t => (
                <tr key={t.codigo}>
                  <td>{t.nombre}</td><td className="suave mono">{t.tupa_codigo || '—'}</td>
                  <td className="num">{t.plazo_tupa === null ? '—' : t.plazo_tupa === 0 ? 'Mismo día' : `${t.plazo_tupa} d.h.`}</td>
                  <td className="num">{numero(t.expedientes)}</td><td className="num">{numero(t.en_tramite)}</td>
                  <td className="num">{t.mta?.datos_suficientes ? numero(t.mta.mediana) : '—'}</td>
                  <td className="num">{t.mta?.datos_suficientes ? numero(t.mta.p80) : '—'}</td>
                  <td className="num">{t.mta?.datos_suficientes && t.mta.tasa_cumplimiento !== null
                    ? <Insignia tipo={t.mta.tasa_cumplimiento < 0.3 ? 'CRÍTICO' : t.mta.tasa_cumplimiento < 0.6 ? 'ALTO' : 'BAJO'}>{porcentaje(t.mta.tasa_cumplimiento, 0)}</Insignia>
                    : <span className="suave">{t.mta ? `${t.mta.n} casos` : 'sin casos'}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="suave" style={{ fontSize: 12 }}>
            Personal: {d.usuarios.length ? d.usuarios.map(u => `${u.nombre} (${u.rol})`).join(', ') : 'el administrador puede asignar usuarios a este departamento en «Usuarios».'}
            {d.total_en_tramite > 0 && <button className="boton pequeno" style={{ marginLeft: 10 }} onClick={verBandeja}>Ver en la bandeja</button>}
          </div>
        </td></tr>
      )}
    </>
  )
}

function NuevoDepartamento({ alCerrar, alListo }) {
  const [f, setF] = useState({ nombre: '', codigo: '' })
  const { ocupado, error, ejecutar } = useAccion()
  const guardar = async () => {
    const r = await ejecutar(() => llamar('crear_departamento', f), 'Departamento creado')
    if (r) alListo()
  }
  return (
    <Modal titulo="Añadir departamento" alCerrar={alCerrar}
           pie={<><button className="boton" onClick={alCerrar}>Cancelar</button><button className="boton primario" disabled={ocupado} onClick={guardar}>Crear</button></>}>
      <div className="formulario">
        <Campo etiqueta="Nombre" requerido completo ayuda="Ej.: Habilitaciones Urbanas (se antepone «Departamento de»)">
          <input value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} autoFocus />
        </Campo>
        <Campo etiqueta="Código" ayuda="Opcional; si lo deja vacío se genera (DEP_…)"><input value={f.codigo} onChange={e => setF({ ...f, codigo: e.target.value.toUpperCase() })} /></Campo>
      </div>
      <p className="texto-suave" style={{ fontSize: 12.5, marginTop: 10 }}>Luego asigne sus trámites en Configuración › Procedimientos y su personal en Usuarios.</p>
      {error && <div style={{ marginTop: 10 }}><Aviso tipo="error">{error}</Aviso></div>}
    </Modal>
  )
}
