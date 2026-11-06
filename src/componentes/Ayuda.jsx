// Guía rápida según el rol.
import { useApp, Panel, puede } from './Comunes'
import { descargarPlantilla } from './Importar'

const GUIAS = {
  MESA_PARTES: [
    ['Registrar un expediente', 'Mesa de partes → «Registrar expediente». Complete los datos, elija el trámite: verá al instante el plazo legal (TUPA), la fecha límite y lo que realmente suele tardar (Modelo 2). Pulse «Registrar y generar constancia» e imprima la constancia para el ciudadano.'],
    ['Importar expedientes', '«Importar expedientes»: descargue la plantilla, llénela (una fila por expediente en EXPEDIENTES y una por movimiento en MOVIMIENTOS), súbala y revise la vista previa antes de confirmar. Puede importar trámites de cualquier departamento.'],
    ['Recibir una subsanación', 'Mesa de partes → «Observados». Abra el expediente y pulse «Registrar subsanación». Vuelve a su responsable y el plazo continúa.'],
    ['Informar el estado a un ciudadano', '«Buscar expediente» por número, nombre o DNI. La ficha muestra dónde está, cuántos días lleva y su fecha límite.'],
  ],
  TECNICO: [
    ['Qué atender primero', '«Bandeja priorizada»: sus expedientes asignados, ordenados por el Índice de Urgencia Administrativa (IUA). Empiece por los CRÍTICOS.'],
    ['Por qué un expediente es urgente', 'En la ficha, pestaña «Prioridad (IUA)»: verá cada factor, su peso y cuánto aporta al índice.'],
    ['Actuar', 'En la ficha: «Derivar / asignar» (a otra persona u oficina), «Observar» (suspende el plazo hasta que el administrado subsane), «Finalizar» (indique el documento con que se resuelve) o «Archivar».'],
    ['Alertas', '«Alertas» muestra lo vencido, lo que vence pronto y lo estancado (más tiempo sin movimiento que el 80% histórico de su ubicación).'],
  ],
  JEFE_DEPARTAMENTO: [
    ['Distribuir el trabajo', 'En la «Bandeja priorizada» de su departamento abra cada expediente y use «Derivar / asignar» para asignarlo a un técnico.'],
    ['Controlar plazos', '«Alertas» y el «Tablero gerencial» de su departamento: vencidos, por vencer, estancados, carga por persona y cumplimiento histórico del TUPA.'],
    ['Cargar la data de su departamento', '«Importar expedientes»: elija su departamento, descargue la plantilla (solo trae sus procedimientos), llénela y súbala. La vista previa marca cada fila con error (fila, columna y motivo) sin guardar nada; puede importar solo las filas válidas. Si se equivocó, use «Deshacer importación» mientras nadie haya trabajado esos expedientes.'],
    ['Varios departamentos', 'Si atiende más de un departamento, elija arriba a la derecha el «Departamento activo» para ver solo uno, o «Todos mis departamentos».'],
    ['Depurar importados', '«Depurar importados»: cierre los expedientes del sistema anterior que ya fueron atendidos pero figuran en trámite (verifíquelos antes).'],
    ['Reportes', '«Reportes»: bandeja, alertas, estadísticas del MTA, productividad por usuario y listados en Excel o PDF.'],
  ],
  GERENTE: [
    ['Visión general', '«Tablero gerencial»: todos los departamentos o uno en particular; niveles de urgencia, ingresos y cierres por mes, cumplimiento del TUPA y carga por ubicación.'],
    ['Decidir con los modelos', '«Modelos IUA y MTA»: dónde se concentran los retrasos, qué trámites incumplen su plazo legal y por cuánto (brecha P80 − TUPA).'],
    ['Importar y departamento activo', 'Puede importar expedientes de cualquier departamento desde «Importar expedientes». Con el selector «Departamento activo» (arriba a la derecha) filtra bandeja, alertas, tablero y reportes.'],
    ['Ajustar prioridades', 'En «Modelos» puede cambiar los juicios de la matriz AHP. El sistema solo acepta juicios consistentes (RC < 0.10) y recalcula el IUA de todos los expedientes.'],
  ],
  ADMINISTRADOR: [
    ['Usuarios', '«Usuarios»: cree una cuenta por trabajador con su rol y departamento. Si ya trabajaba aquí, vincúlelo con su nombre en los registros anteriores para que vea sus expedientes heredados.'],
    ['Usuarios por departamento', '«Usuarios → Crear usuarios por departamento» crea un jefe y un técnico por cada departamento, gerente y mesa de partes, con contraseñas temporales aleatorias que se muestran una sola vez (descárguelas en Excel o PDF). Un jefe o técnico puede tener varios departamentos.'],
    ['Importar expedientes', '«Importar expedientes»: acepta la plantilla de URBANITO, dos CSV (expedientes y movimientos) o el consolidado SGCUC/SGAU tal cual. Cada lote queda en el historial y puede deshacerse; solo usted o quien lo hizo puede hacerlo.'],
    ['Red', '«Configuración → Red»: active la conexión en red para que las demás PCs de la oficina usen URBANITO sobre los datos de esta PC.'],
    ['Respaldos', 'Se crea uno automático al día. Copie uno a una USB cada semana desde «Configuración → Respaldos».'],
    ['Calendario y TUPA', 'Agregue los días no laborables decretados en «Feriados». Actualice plazos del TUPA en «Procedimientos» indicando la norma.'],
    ['Auditoría', 'Todo lo que se registra, corrige o configura queda en «Auditoría» con usuario, fecha y detalle.'],
  ],
}

export default function Ayuda() {
  const { usuario, notificar } = useApp()
  const propios = GUIAS[usuario.rol] || []
  return (
    <>
      {puede(usuario, 'importar') && (
        <Panel titulo="Plantilla de importación" descripcion="Una sola plantilla para todos los departamentos, con los catálogos vigentes"
               acciones={<button className="boton" data-accion="plantilla-ayuda"
                                 onClick={() => descargarPlantilla(notificar, usuario.departamentos.length === 1 && usuario.rol === 'JEFE_DEPARTAMENTO' ? usuario.departamento_codigo : null)}>
                 ⇩ Descargar plantilla</button>}>
          <table className="tabla"><tbody>
            <tr><td className="destacado" style={{ width: 240 }}>Hojas</td><td>INSTRUCCIONES · EXPEDIENTES (una fila por expediente) · MOVIMIENTOS (una fila por movimiento, enlazada por N° EXPEDIENTE) · CATÁLOGOS (solo lectura, alimenta las listas) · EJEMPLO (borrar).</td></tr>
            <tr><td className="destacado">Obligatorios (*)</td><td>N° expediente, fecha de ingreso, solicitante, DNI/RUC/CE, código de procedimiento, folios y estado; en movimientos: N° expediente, N° mov, tipo y fecha.</td></tr>
            <tr><td className="destacado">Fechas</td><td>dd/mm/aaaa (también aaaa-mm-dd). Una fecha posterior a hoy se guarda marcada como inválida y no entra a los cálculos.</td></tr>
            <tr><td className="destacado">Duplicados</td><td>Si el N° de expediente ya existe, se omite. Los expedientes registrados en Mesa de partes nunca se modifican.</td></tr>
            <tr><td className="destacado">Por rol</td><td>Jefe: solo trámites de sus departamentos. Mesa de partes, gerente y administrador: cualquier departamento. Técnico: no importa.</td></tr>
          </tbody></table>
        </Panel>
      )}
      <Panel titulo={`Guía para: ${usuario.rol_nombre}`}>
        <table className="tabla"><tbody>
          {propios.map(([t, d]) => <tr key={t}><td className="destacado" style={{ width: 240 }}>{t}</td><td>{d}</td></tr>)}
        </tbody></table>
      </Panel>
      <Panel titulo="Conceptos">
        <table className="tabla"><tbody>
          <tr><td className="destacado" style={{ width: 240 }}>IUA — Modelo 1</td><td>Índice de Urgencia Administrativa (0 a 1). Combina urgencia del plazo, complejidad, antigüedad, tipo de trámite y carga de la oficina, con pesos calculados por AHP. CRÍTICO ≥ 0.70 o plazo vencido; ALTO ≥ 0.50; MEDIO ≥ 0.30.</td></tr>
          <tr><td className="destacado">MTA — Modelo 2</td><td>Estadística de los tiempos reales de atención de los expedientes cerrados: mediana, percentil 80 (P80), cumplimiento del TUPA. Se actualiza sola con cada expediente que se finaliza.</td></tr>
          <tr><td className="destacado">Días hábiles (d.h.)</td><td>Lunes a viernes, sin feriados. Es como se cuentan los plazos del TUPA.</td></tr>
          <tr><td className="destacado">Observado</td><td>El administrado debe corregir o completar algo. Mientras tanto el plazo no corre (Ley N° 27444).</td></tr>
          <tr><td className="destacado">Estancado</td><td>Lleva en su ubicación actual más días sin movimiento que el 80% de los casos históricos en esa misma ubicación.</td></tr>
          <tr><td className="destacado">Importado / sistema anterior</td><td>Expedientes de SGCUC y SGAU cargados desde el Excel consolidado. Los nuevos se numeran en URBANITO.</td></tr>
        </tbody></table>
      </Panel>
    </>
  )
}
