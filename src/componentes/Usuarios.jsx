// Administración de usuarios.
import { useState } from 'react'
import { useDatos, llamar } from '../api'
import { useApp, Panel, Cargando, ErrorCarga, Aviso, Modal, Campo, Insignia, useAccion } from './Comunes'
import { fechaHora } from '../formato'
import Credenciales from './Credenciales'

export default function Usuarios() {
  const { version, refrescar, usuario: yo, notificar, estado } = useApp()
  const { datos: lista, error, recargar } = useDatos('usuarios', {}, [version])
  const { datos: cat } = useDatos('catalogos', {})
  const [editando, setEditando] = useState(null)
  const [clave, setClave] = useState(null)
  const [lote, setLote] = useState(null)
  const { ejecutar, ocupado } = useAccion()
  if (error) return <ErrorCarga error={error} reintentar={recargar} />
  if (!lista || !cat) return <Cargando />

  const restablecer = async (u) => {
    if (!window.confirm(`¿Generar una nueva contraseña temporal para ${u.usuario}? Su sesión actual se cerrará.`)) return
    const r = await ejecutar(() => llamar('restablecer_clave', { id: u.id }))
    if (r) setClave({ usuario: u.usuario, clave: r.clave_temporal })
  }

  const crearLote = async () => {
    if (!window.confirm('Se creará un jefe y un técnico por cada uno de los 11 departamentos, además de gerente y mesa de partes (los que ya existan se omiten). Cada cuenta recibirá una contraseña temporal que se mostrará UNA sola vez. ¿Continuar?')) return
    const r = await ejecutar(() => llamar('crear_usuarios_departamento'))
    if (r) { setLote(r); refrescar() }
  }

  return (
    <>
      <div className="grupo-botones" style={{ marginBottom: 14 }}>
        <button className="boton primario" onClick={() => setEditando({})} data-accion="nuevo-usuario">+ Nuevo usuario</button>
        {yo.rol === 'ADMINISTRADOR' && (
          <button className="boton" onClick={crearLote} disabled={ocupado} data-accion="usuarios-departamento">Crear usuarios por departamento</button>
        )}
      </div>
      <Panel sinRelleno>
        <table className="tabla">
          <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Departamento</th><th>Alias histórico</th><th>Último acceso</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {lista.map(u => (
              <tr key={u.id}>
                <td className="mono destacado">{u.usuario}</td><td>{u.nombre_completo}</td><td>{u.rol_nombre}</td>
                <td>{u.departamento_nombre || '—'}{u.departamentos.length > 1 && <span className="texto-suave"> +{u.departamentos.length - 1}: {u.departamentos.filter(d => !d.principal).map(d => d.nombre.replace(/^Departamento de /, '')).join(', ')}</span>}</td><td className="mono">{u.alias_historico || '—'}</td>
                <td className="suave">{fechaHora(u.ultimo_acceso)}</td>
                <td>{!u.activo ? <Insignia>Inactivo</Insignia> : u.bloqueado ? <Insignia tipo="CRÍTICO">Bloqueado</Insignia>
                  : u.debe_cambiar_clave ? <Insignia tipo="MEDIO">Clave temporal</Insignia> : <Insignia tipo="BAJO">Activo</Insignia>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="boton pequeno" onClick={() => setEditando(u)}>Editar</button>{' '}
                  <button className="boton pequeno" onClick={() => restablecer(u)} disabled={u.id === yo.id}>Nueva clave</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel titulo="Roles">
        <table className="tabla"><tbody>
          {Object.entries(cat.roles).map(([k, r]) => <tr key={k}><td className="destacado">{r.nombre}</td><td className="suave">{r.descripcion}</td></tr>)}
        </tbody></table>
      </Panel>
      {editando && <FormUsuario u={editando} cat={cat} alCerrar={() => setEditando(null)}
                                alListo={(r) => { setEditando(null); refrescar(); if (r?.clave_temporal) setClave({ usuario: r.usuario, clave: r.clave_temporal }) }} />}
      {lote && (
        <Modal titulo={`Usuarios por departamento: ${lote.creados.length} creados`} tamano="ancho" alCerrar={() => setLote(null)}
               pie={<button className="boton primario" onClick={() => setLote(null)}>Ya las guardé, cerrar</button>}>
          <Aviso tipo="advertencia">Estas contraseñas temporales se muestran <b>una sola vez</b>. Descárguelas o cópielas ahora;
            después solo podrá generar una nueva con «Nueva clave». Cada persona elegirá la suya en su primer ingreso.
            Los nombres son genéricos: cámbielos por los reales con «Editar».</Aviso>
          {lote.creados.length ? <Credenciales lista={lote.creados} omitidos={lote.omitidos} institucion={estado.institucion} avisar={notificar} />
            : <p>Todas las cuentas ya existían; no se creó ninguna ({lote.omitidos.map(o => o.usuario).join(', ')}).</p>}
        </Modal>
      )}
      {clave && (
        <Modal titulo="Contraseña temporal" alCerrar={() => setClave(null)} pie={<button className="boton primario" onClick={() => setClave(null)}>Listo</button>}>
          <p>Entregue esta contraseña a <b className="mono">{clave.usuario}</b>. Deberá cambiarla al ingresar. No se volverá a mostrar.</p>
          <div className="mono resaltado" style={{ fontSize: 22, textAlign: 'center', marginTop: 12 }} data-prueba="clave-temporal">{clave.clave}</div>
        </Modal>
      )}
    </>
  )
}

function FormUsuario({ u, cat, alCerrar, alListo }) {
  const nuevo = !u.id
  const { datos: alias } = useDatos('alias_historicos', {})
  const [f, setF] = useState({ usuario: u.usuario || '', nombre_completo: u.nombre_completo || '', rol: u.rol || 'TECNICO',
    departamento_codigo: u.departamento_codigo || '', alias_historico: u.alias_historico || '', activo: u.activo !== false,
    departamentos: (u.departamentos || []).map(d => d.codigo),
    capacidad_maxima: u.capacidad_maxima ?? 10 })
  const multiple = ['JEFE_DEPARTAMENTO', 'TECNICO'].includes(f.rol)
  const MAX_DEPS = 2     // mismo límite que el núcleo (sistema.js)
  const marcar = (codigo) => (e) => {
    const lista = e.target.checked ? [...new Set([...f.departamentos, codigo])] : f.departamentos.filter(c => c !== codigo)
    const principal = lista.includes(f.departamento_codigo) ? f.departamento_codigo : (lista[0] || '')
    setF({ ...f, departamentos: lista, departamento_codigo: principal })
  }
  const { ocupado, error, ejecutar } = useAccion()
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const guardar = async () => {
    const deps = multiple ? f.departamentos : (f.departamento_codigo ? [f.departamento_codigo] : [])
    const datos = { ...f, departamento_codigo: f.departamento_codigo || null, alias_historico: f.alias_historico || null,
                    capacidad_maxima: f.capacidad_maxima === '' ? null : Number(f.capacidad_maxima),
                    departamentos: f.departamento_codigo && !deps.includes(f.departamento_codigo) ? [f.departamento_codigo, ...deps] : deps }
    const r = await ejecutar(() => nuevo ? llamar('crear_usuario', datos) : llamar('editar_usuario', { ...datos, id: u.id }),
      nuevo ? 'Usuario creado' : 'Usuario actualizado')
    if (r) alListo(nuevo ? { ...r, usuario: f.usuario.toLowerCase() } : null)
  }

  return (
    <Modal titulo={nuevo ? 'Nuevo usuario' : `Editar ${u.usuario}`} alCerrar={alCerrar}
           pie={<><button className="boton" onClick={alCerrar}>Cancelar</button><button className="boton primario" disabled={ocupado} onClick={guardar} data-accion="guardar-usuario">Guardar</button></>}>
      <div className="formulario">
        <Campo etiqueta="Usuario" requerido ayuda="Ej.: juan.perez"><input value={f.usuario} onChange={set('usuario')} disabled={!nuevo} data-campo="usuario" /></Campo>
        <Campo etiqueta="Nombre completo" requerido><input value={f.nombre_completo} onChange={set('nombre_completo')} data-campo="nombre" /></Campo>
        <Campo etiqueta="Rol" requerido>
          <select value={f.rol} onChange={set('rol')} data-campo="rol">{Object.entries(cat.roles).map(([k, r]) => <option key={k} value={k}>{r.nombre}</option>)}</select>
        </Campo>
        <Campo etiqueta={multiple ? 'Departamento principal' : 'Departamento'} requerido={f.rol === 'JEFE_DEPARTAMENTO'}>
          <select value={f.departamento_codigo} data-campo="departamento"
                  onChange={e => setF({ ...f, departamento_codigo: e.target.value,
                    departamentos: e.target.value && !f.departamentos.includes(e.target.value) ? [...f.departamentos, e.target.value] : f.departamentos })}>
            <option value="">— Ninguno —</option>
            {cat.departamentos.map(d => <option key={d.codigo} value={d.codigo}>{d.nombre}</option>)}
          </select>
        </Campo>
        {multiple && (
          <Campo etiqueta="Departamentos en que trabaja" completo ayuda={`Marque los departamentos que atiende (máximo ${MAX_DEPS}). El principal se elige arriba.`}>
            <div className="lista-departamentos" data-campo="departamentos">
              {cat.departamentos.map(d => (
                <label key={d.codigo}>
                  <input type="checkbox" checked={f.departamentos.includes(d.codigo)} onChange={marcar(d.codigo)}
                         disabled={!f.departamentos.includes(d.codigo) && f.departamentos.length >= MAX_DEPS} />
                  {d.nombre.replace(/^Departamento de /, '')}{f.departamento_codigo === d.codigo && <b> (principal)</b>}
                </label>))}
            </div>
          </Campo>
        )}
        {multiple && (
          <Campo etiqueta="Capacidad máxima" ayuda="Cuántos expedientes puede tener asignados a la vez (lo usa el modelo de asignación).">
            <input type="number" min="1" max="200" value={f.capacidad_maxima} onChange={set('capacidad_maxima')} data-campo="capacidad" />
          </Campo>
        )}
        <Campo etiqueta="Nombre en los registros del sistema anterior" completo
               ayuda="Si esta persona ya trabajaba aquí, elija cómo aparecía en los expedientes importados: verá en su bandeja los que estaban a su cargo.">
          <select value={f.alias_historico} onChange={set('alias_historico')}>
            <option value="">— No aplica —</option>
            {(alias || []).map(a => <option key={a.codigo} value={a.codigo}>{a.nombre} ({a.movimientos} movimientos)</option>)}
          </select>
        </Campo>
        {!nuevo && <label className="casilla completo"><input type="checkbox" checked={f.activo} onChange={set('activo')} /> Usuario activo</label>}
      </div>
      {nuevo && <p className="texto-suave" style={{ fontSize: 12.5, marginTop: 10 }}>Al guardar se genera una contraseña temporal que el usuario cambiará en su primer ingreso.</p>}
      {error && <div style={{ marginTop: 10 }}><Aviso tipo="error">{error}</Aviso></div>}
    </Modal>
  )
}
