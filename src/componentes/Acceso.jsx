// Pantallas previas al uso: configuración inicial, ingreso.
import { useState } from 'react'
import { llamar } from '../api'
import { Aviso, Campo } from './Comunes'
import Credenciales from './Credenciales'

function Marca({ institucion }) {
  return (
    <>
      <h1>URBANITO</h1>
      <div className="institucion">
        Gestión administrativa — {institucion?.area || 'Gerencia de Desarrollo Urbano'}<br />
        {institucion?.nombre || 'Municipalidad Provincial de San Román'} — {institucion?.ciudad || 'Juliaca'}
      </div>
    </>
  )
}

export function ConfiguracionInicial({ estado, alListo }) {
  const [f, setF] = useState({ nombre_completo: '', usuario: 'admin', clave: '', clave2: '', crear_demo: false, crear_por_departamento: false })
  const [error, setError] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [demo, setDemo] = useState(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const guardar = async () => {
    setError(null)
    if (f.clave !== f.clave2) return setError('Las contraseñas no coinciden.')
    setOcupado(true)
    try {
      const r = await llamar('configuracion_inicial', f)
      if (r.usuarios_demo.length) setDemo(r.usuarios_demo)
      else alListo()
    } catch (e) { setError(e.message) } finally { setOcupado(false) }
  }

  if (demo) {
    return (
      <div className="acceso">
        <div className="tarjeta-acceso ancha">
          <Marca institucion={estado.institucion} />
          <Aviso tipo="exito">Sistema configurado. Guarde las contraseñas temporales de los usuarios creados:
            se muestran una sola vez y cada persona deberá cambiar la suya al ingresar.</Aviso>
          {f.crear_por_departamento
            ? <Credenciales lista={demo} institucion={estado.institucion} />
            : (
              <table className="tabla" style={{ marginBottom: 16 }}>
                <thead><tr><th>Usuario</th><th>Rol</th><th>Contraseña temporal</th></tr></thead>
                <tbody>{demo.map(d => <tr key={d.usuario}><td className="mono destacado">{d.usuario}</td><td>{d.rol}</td><td className="mono">{d.clave_temporal}</td></tr>)}</tbody>
              </table>
            )}
          <button className="boton primario grande" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }} onClick={alListo}>Ya las guardé, continuar</button>
        </div>
      </div>
    )
  }

  return (
    <div className="acceso">
      <div className="tarjeta-acceso ancha">
        <Marca institucion={estado.institucion} />
        <h3>Configuración inicial</h3>
        <p className="texto-suave" style={{ fontSize: 13, margin: '4px 0 14px' }}>
          Cree la cuenta del administrador del sistema. Con ella se crearán después los usuarios de cada área.
        </p>
        <div className="formulario">
          <Campo etiqueta="Nombre completo" requerido completo><input value={f.nombre_completo} onChange={set('nombre_completo')} autoFocus /></Campo>
          <Campo etiqueta="Usuario" requerido><input value={f.usuario} onChange={set('usuario')} /></Campo>
          <div />
          <Campo etiqueta="Contraseña" requerido ayuda="Mínimo 8 caracteres, con letras y números"><input type="password" value={f.clave} onChange={set('clave')} /></Campo>
          <Campo etiqueta="Repetir contraseña" requerido><input type="password" value={f.clave2} onChange={set('clave2')} /></Campo>
          <label className="casilla completo">
            <input type="checkbox" checked={f.crear_por_departamento} data-campo="crear-por-departamento"
                   onChange={e => setF({ ...f, crear_por_departamento: e.target.checked, crear_demo: e.target.checked ? false : f.crear_demo })} />
            Crear usuarios por departamento: un jefe y un técnico por cada uno de los 11 departamentos, gerente y mesa de partes (contraseñas temporales aleatorias)
          </label>
          {!f.crear_por_departamento && (
            <label className="casilla completo">
              <input type="checkbox" checked={f.crear_demo} onChange={set('crear_demo')} />
              Crear también un usuario de prueba por cada rol (gerente, jefe y técnico de Numeración, mesa de partes)
            </label>
          )}
        </div>
        {error && <div style={{ marginTop: 12 }}><Aviso tipo="error">{error}</Aviso></div>}
        <button className="boton primario grande" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }}
                disabled={ocupado} onClick={guardar}>{ocupado ? 'Guardando…' : 'Crear administrador'}</button>
      </div>
    </div>
  )
}

export function Ingreso({ estado, alIngresar }) {
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState(null)
  const [ocupado, setOcupado] = useState(false)

  const entrar = async (e) => {
    e.preventDefault()
    setOcupado(true); setError(null)
    try {
      const r = await llamar('login', { usuario, clave })
      alIngresar(r)
    } catch (err) { setError(err.message) } finally { setOcupado(false) }
  }

  return (
    <div className="acceso">
      <form className="tarjeta-acceso" onSubmit={entrar}>
        <Marca institucion={estado.institucion} />
        <Campo etiqueta="Usuario"><input value={usuario} onChange={e => setUsuario(e.target.value)} autoFocus autoComplete="username" /></Campo>
        <Campo etiqueta="Contraseña"><input type="password" value={clave} onChange={e => setClave(e.target.value)} autoComplete="current-password" /></Campo>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button type="submit" className="boton primario grande" style={{ width: '100%', justifyContent: 'center' }}
                disabled={ocupado || !usuario || !clave}>{ocupado ? 'Verificando…' : 'Ingresar'}</button>
      </form>
    </div>
  )
}

export function CambiarClave({ usuario, obligatorio, alListo, alCancelar }) {
  const [f, setF] = useState({ actual: '', nueva: '', nueva2: '' })
  const [error, setError] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const guardar = async (e) => {
    e.preventDefault()
    setError(null)
    if (f.nueva !== f.nueva2) return setError('Las contraseñas nuevas no coinciden.')
    setOcupado(true)
    try {
      const r = await llamar('cambiar_clave', { actual: f.actual, nueva: f.nueva })
      alListo(r.usuario)
    } catch (err) { setError(err.message) } finally { setOcupado(false) }
  }

  const contenido = (
    <form onSubmit={guardar}>
      {obligatorio && <Aviso tipo="informativo">Hola, {usuario.nombre_completo}. Por seguridad debe cambiar su contraseña temporal antes de continuar.</Aviso>}
      <Campo etiqueta="Contraseña actual"><input type="password" value={f.actual} onChange={set('actual')} autoFocus /></Campo>
      <div style={{ height: 10 }} />
      <Campo etiqueta="Nueva contraseña" ayuda="Mínimo 8 caracteres, con letras y números"><input type="password" value={f.nueva} onChange={set('nueva')} /></Campo>
      <div style={{ height: 10 }} />
      <Campo etiqueta="Repetir nueva contraseña"><input type="password" value={f.nueva2} onChange={set('nueva2')} /></Campo>
      {error && <div style={{ marginTop: 12 }}><Aviso tipo="error">{error}</Aviso></div>}
      <div className="grupo-botones" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        {alCancelar && <button type="button" className="boton" onClick={alCancelar}>Cancelar</button>}
        <button type="submit" className="boton primario" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Cambiar contraseña'}</button>
      </div>
    </form>
  )
  if (!obligatorio) return contenido
  return (
    <div className="acceso"><div className="tarjeta-acceso"><Marca />{contenido}</div></div>
  )
}
