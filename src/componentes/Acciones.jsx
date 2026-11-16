// Ventanas de acción sobre un expediente.
import { useState } from 'react'
import { useDatos, llamar } from '../api'
import { useApp, Modal, Campo, Aviso, Cargando, useAccion } from './Comunes'
import { fecha } from '../formato'

const TITULOS = {
  derivar: 'Derivar o asignar el expediente', observar: 'Observar el expediente', subsanar: 'Registrar subsanación',
  finalizar: 'Finalizar el expediente', archivar: 'Archivar el expediente', corregir: 'Corregir datos del expediente',
  reabrir: 'Reabrir el expediente',
}

export default function AccionModal({ tipo, ficha, alCerrar, alListo }) {
  const { usuario } = useApp()
  const { datos: cat } = useDatos('catalogos', {})
  const { datos: plantillas } = useDatos(tipo === 'observar' ? 'plantillas_observacion' : 'ping', {})
  const e = ficha.expediente
  const { ocupado, error, ejecutar } = useAccion()
  const [f, setF] = useState(() => ({
    fecha: '', documento: '', folios: '', observacion: '', resultado: '', motivo: '',
    destino_tipo: tipo === 'reabrir' ? 'DEPARTAMENTO' : 'USUARIO', destino_codigo: tipo === 'reabrir' ? (e.departamento_codigo || '') : '',
    solicitante: e.solicitante || '', documento_identidad: e.documento_identidad || '', telefono: e.telefono || '',
    direccion: e.direccion || '', asunto: e.asunto || '', folios_exp: e.folios ?? '', procedimiento_codigo: e.procedimiento_codigo,
    fecha_ingreso: e.fecha_ingreso || '',
  }))
  const set = (k) => (ev) => setF({ ...f, [k]: ev.target.value })

  if (!cat) return <Modal titulo={TITULOS[tipo]} alCerrar={alCerrar}><Cargando /></Modal>
  const hoy = cat.hoy

  const enviar = async () => {
    const base = { id: e.id, fecha: f.fecha || undefined }
    const destino = { tipo: f.destino_tipo, codigo: f.destino_codigo }
    const llamadas = {
      derivar: () => llamar('derivar', { ...base, destino, documento: f.documento, folios: f.folios, observacion: f.observacion }),
      observar: () => llamar('observar', { ...base, observacion: f.observacion, documento: f.documento }),
      subsanar: () => llamar('subsanar', { ...base, documento: f.documento, folios: f.folios, observacion: f.observacion }),
      finalizar: () => llamar('finalizar', { ...base, resultado: f.resultado, documento: f.documento, observacion: f.observacion }),
      archivar: () => llamar('archivar', { ...base, motivo: f.motivo, observacion: f.observacion, documento: f.documento }),
      reabrir: () => llamar('reabrir', { ...base, motivo: f.motivo, destino }),
      corregir: () => {
        const cambios = { id: e.id, motivo: f.motivo }
        const campos = { solicitante: f.solicitante, documento_identidad: f.documento_identidad, telefono: f.telefono,
                         direccion: f.direccion, asunto: f.asunto, procedimiento_codigo: f.procedimiento_codigo }
        for (const [k, v] of Object.entries(campos)) if ((v || '') !== (e[k] || '')) cambios[k] = v
        if (String(f.folios_exp) !== String(e.folios ?? '')) cambios.folios = Number(f.folios_exp)
        if (f.fecha_ingreso !== (e.fecha_ingreso || '')) cambios.fecha_ingreso = f.fecha_ingreso
        return llamar('corregir', cambios)
      },
    }
    const r = await ejecutar(llamadas[tipo])
    if (r) alListo({ derivar: 'Expediente derivado', observar: 'Expediente observado: plazo suspendido', subsanar: 'Subsanación registrada: el plazo continúa',
                     finalizar: 'Expediente finalizado', archivar: 'Expediente archivado', reabrir: 'Expediente reabierto',
                     corregir: 'Datos corregidos' }[tipo])
  }

  const campoFecha = (
    <Campo etiqueta="Fecha" ayuda={`Por defecto hoy (${fecha(hoy)}). Puede indicar una fecha anterior si registra algo que ocurrió antes.`}>
      <input type="date" value={f.fecha} max={hoy} onChange={set('fecha')} />
    </Campo>
  )

  const destinos = () => {
    const usuarios = [...cat.usuarios_destino].sort((a, b) =>
      (b.departamento_codigo === e.departamento_codigo) - (a.departamento_codigo === e.departamento_codigo) || a.nombre.localeCompare(b.nombre))
    return (
      <>
        <Campo etiqueta="Tipo de destino" requerido>
          <select value={f.destino_tipo} onChange={(ev) => setF({ ...f, destino_tipo: ev.target.value, destino_codigo: '' })}>
            <option value="USUARIO">Una persona (asignar responsable)</option>
            <option value="DEPARTAMENTO">Un departamento</option>
            <option value="UNIDAD ORGANICA">Otra unidad orgánica de la municipalidad</option>
          </select>
        </Campo>
        <Campo etiqueta="Destino" requerido>
          <select value={f.destino_codigo} onChange={set('destino_codigo')} data-campo="destino">
            <option value="">— Seleccione —</option>
            {f.destino_tipo === 'USUARIO' && usuarios.map(u => (
              <option key={u.id} value={u.id}>{u.nombre} — {u.rol}{u.departamento_codigo === e.departamento_codigo ? ' (su departamento)' : ''}</option>))}
            {f.destino_tipo === 'DEPARTAMENTO' && cat.departamentos.map(d => <option key={d.codigo} value={d.codigo}>{d.nombre}</option>)}
            {f.destino_tipo === 'UNIDAD ORGANICA' && cat.unidades.map(u => <option key={u.codigo} value={u.codigo}>{u.nombre} ({u.codigo})</option>)}
          </select>
        </Campo>
        {f.destino_tipo === 'USUARIO' && !usuarios.length && (
          <div className="completo"><Aviso tipo="informativo">Aún no hay usuarios jefes o técnicos registrados. El administrador debe crearlos en «Usuarios».</Aviso></div>
        )}
      </>
    )
  }

  let cuerpo = null
  if (tipo === 'derivar') {
    cuerpo = (
      <div className="formulario">
        {destinos()}
        <Campo etiqueta="Documento (proveído, memorándum, informe)"><input value={f.documento} onChange={set('documento')} /></Campo>
        <Campo etiqueta="Folios"><input value={f.folios} onChange={set('folios')} /></Campo>
        {campoFecha}
        <Campo etiqueta="Indicaciones" completo><textarea value={f.observacion} onChange={set('observacion')} placeholder="Opcional" /></Campo>
      </div>
    )
  } else if (tipo === 'observar') {
    cuerpo = (
      <>
        <Aviso tipo="informativo">Mientras el expediente esté observado, el plazo del TUPA se suspende (no corre) hasta que el administrado subsane.
          La subsanación la puede recibir mesa de partes.</Aviso>
        {Array.isArray(plantillas) && plantillas.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div className="etiqueta-campo" style={{ marginBottom: 4 }}>Textos frecuentes (clic para agregar)</div>
            <div className="grupo-botones">{plantillas.map(p => (
              <button key={p.titulo} type="button" className="boton pequeno" title={p.texto} data-accion="plantilla-observacion"
                      onClick={() => setF(x => ({ ...x, observacion: x.observacion ? `${x.observacion.trim()} ${p.texto}` : p.texto }))}>+ {p.titulo}</button>))}
            </div>
          </div>
        )}
        <div className="formulario">
          <Campo etiqueta="Qué debe subsanar el administrado" requerido completo>
            <textarea value={f.observacion} onChange={set('observacion')} placeholder="Ej.: Presentar copia literal de dominio con antigüedad no mayor a 30 días" />
          </Campo>
          <Campo etiqueta="Documento de notificación"><input value={f.documento} onChange={set('documento')} placeholder="Ej.: Carta N° 015-2026" /></Campo>
          {campoFecha}
        </div>
      </>
    )
  } else if (tipo === 'subsanar') {
    cuerpo = (
      <div className="formulario">
        <Campo etiqueta="Documento presentado"><input value={f.documento} onChange={set('documento')} placeholder="Ej.: Escrito de subsanación" /></Campo>
        <Campo etiqueta="Folios"><input value={f.folios} onChange={set('folios')} /></Campo>
        {campoFecha}
        <Campo etiqueta="Observación" completo><textarea value={f.observacion} onChange={set('observacion')} placeholder="Opcional" /></Campo>
        <div className="completo texto-suave" style={{ fontSize: 12.5 }}>El expediente vuelve a la misma ubicación y responsable que tenía: {e.ubicacion}.</div>
      </div>
    )
  } else if (tipo === 'finalizar') {
    cuerpo = (
      <div className="formulario">
        <Campo etiqueta="Resultado" requerido>
          <select value={f.resultado} onChange={set('resultado')}>
            <option value="">— Seleccione —</option>
            {cat.resultados_finalizacion.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Documento con que se resuelve" requerido><input value={f.documento} onChange={set('documento')} placeholder="Ej.: Certificado N° 0123-2026-SGCUC" /></Campo>
        {campoFecha}
        <Campo etiqueta="Observación" completo><textarea value={f.observacion} onChange={set('observacion')} placeholder="Opcional" /></Campo>
        <div className="completo texto-suave" style={{ fontSize: 12.5 }}>Al finalizar, el expediente sale de la bandeja y su tiempo de atención pasa a formar parte de las estadísticas del Modelo 2 (MTA).</div>
      </div>
    )
  } else if (tipo === 'archivar') {
    cuerpo = (
      <div className="formulario">
        <Campo etiqueta="Motivo" requerido>
          <select value={f.motivo} onChange={set('motivo')}>
            <option value="">— Seleccione —</option>
            {cat.motivos_archivo.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Documento"><input value={f.documento} onChange={set('documento')} /></Campo>
        {campoFecha}
        <Campo etiqueta="Detalle" requerido={f.motivo === 'Otro'} completo><textarea value={f.observacion} onChange={set('observacion')} /></Campo>
      </div>
    )
  } else if (tipo === 'reabrir') {
    cuerpo = (
      <div className="formulario">
        <Campo etiqueta="Motivo de la reapertura" requerido completo><textarea value={f.motivo} onChange={set('motivo')} /></Campo>
        {destinos()}
        {campoFecha}
      </div>
    )
  } else if (tipo === 'corregir') {
    cuerpo = (
      <div className="formulario">
        <Campo etiqueta="Solicitante"><input value={f.solicitante} onChange={set('solicitante')} /></Campo>
        <Campo etiqueta="Documento de identidad"><input value={f.documento_identidad} onChange={set('documento_identidad')} /></Campo>
        <Campo etiqueta="Teléfono"><input value={f.telefono} onChange={set('telefono')} /></Campo>
        <Campo etiqueta="Folios"><input value={f.folios_exp} onChange={set('folios_exp')} /></Campo>
        <Campo etiqueta="Dirección" completo><input value={f.direccion} onChange={set('direccion')} /></Campo>
        <Campo etiqueta="Trámite" completo>
          <select value={f.procedimiento_codigo} onChange={set('procedimiento_codigo')}>
            {cat.procedimientos.filter(p => p.activo).map(p => <option key={p.codigo} value={p.codigo}>{p.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Fecha de ingreso"><input type="date" value={f.fecha_ingreso} max={hoy} onChange={set('fecha_ingreso')} /></Campo>
        <div />
        <Campo etiqueta="Asunto" completo><textarea value={f.asunto} onChange={set('asunto')} /></Campo>
        <Campo etiqueta="Motivo de la corrección" requerido completo ayuda="Queda registrado en la auditoría junto con el valor anterior">
          <input value={f.motivo} onChange={set('motivo')} />
        </Campo>
      </div>
    )
  }

  return (
    <Modal titulo={`${TITULOS[tipo]} ${e.numero}`} alCerrar={alCerrar} tamano="medio"
           pie={<>
             <button className="boton" onClick={alCerrar}>Cancelar</button>
             <button className={`boton ${tipo === 'finalizar' ? 'exito' : tipo === 'archivar' ? 'peligro' : 'primario'}`}
                     disabled={ocupado} onClick={enviar} data-accion="confirmar">{ocupado ? 'Guardando…' : 'Confirmar'}</button>
           </>}>
      {cuerpo}
      {error && <div style={{ marginTop: 12 }}><Aviso tipo="error">{error}</Aviso></div>}
      {usuario.rol === 'ADMINISTRADOR' && tipo !== 'corregir' && tipo !== 'reabrir' && (
        <p className="texto-tenue" style={{ fontSize: 11.5, marginTop: 10 }}>Esta acción quedará registrada en la auditoría a su nombre.</p>
      )}
    </Modal>
  )
}
