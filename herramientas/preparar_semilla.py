"""
PREPARAR BASE INICIAL — URBANITO ERP
=====================================
Convierte los datos reales ya procesados del Excel consolidado
(expedientes.csv y movimientos.csv, generados por 03_procesar_expedientes.py)
en la base SQLite con la que arranca el programa de escritorio.

Uso:
    python preparar_semilla.py <carpeta_con_csv> <salida.db>

Correcciones que aplica respecto del pipeline anterior:
  1. Cada expediente se identifica por (sistema, número). Hay números que
     existen a la vez en SGCUC y SGAU y no deben mezclarse.
  2. Fecha de corte = la última fecha de movimiento que NO es posterior al día
     en que se ejecuta este script. Las fechas posteriores son errores de
     digitación del origen: se conservan, pero se marcan como inválidas y no
     entran a ningún cálculo.
  3. Los días hábiles descuentan sábados, domingos y feriados nacionales
     (tabla `feriados`), no solo fines de semana.
  4. El estado de cada expediente queda explícito (EN_TRAMITE, FINALIZADO,
     ARCHIVADO, CERRADO_HISTORICO, SIN_FECHA) en vez de inferirse cada vez.
  5. Las siglas de unidad que son sinónimos (ej. GDU / GEDU) se unifican en
     un solo código.

No crea ni completa ningún dato: todo lo que entra viene de los CSV.
"""
import json
import os
import sqlite3
import sys
from datetime import date, timedelta

import numpy as np
import pandas as pd
from dateutil.easter import easter

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from catalogo_dependencias import (UNIDADES, clasificar_destino,  # noqa: E402
                                   TIPO_UNIDAD, TIPO_ESTADO)
from catalogo_tramites import CATALOGO  # noqa: E402
from catalogo_departamentos import DEPARTAMENTOS, PROCEDIMIENTO_A_DEPARTAMENTO  # noqa: E402

ESQUEMA = os.path.join(os.path.dirname(AQUI), "electron", "esquema.sql")

DIAS_INACTIVIDAD_CIERRE = 60

# Destinos que, si son el último movimiento, significan que el expediente terminó.
ESTADO_FINAL = {
    "CONCLUIDO": ("FINALIZADO", "Concluido (registro importado)"),
    "ENTREGADO": ("FINALIZADO", "Entregado al administrado (registro importado)"),
    "ARCHIVADO": ("FINALIZADO", "Enviado a archivo (registro importado)"),
    "ARCHIVO": ("FINALIZADO", "Enviado a archivo (registro importado)"),
    "ABANDONO": ("ARCHIVADO", "Declarado en abandono (registro importado)"),
}


# ---------------------------------------------------------------- feriados
def feriados_peru(desde=2014, hasta=2030):
    """
    Feriados nacionales del Perú (Decreto Legislativo 713 y leyes posteriores).
      9 dic  — Ley 31381, rige desde 2022
      6 ago  — Ley 31530, rige desde 2022
      23 jul — rige desde 2023
      7 jun  — Ley 31788, rige desde 2024
    Los días no laborables que decrete el Ejecutivo cada año NO se incluyen:
    los agrega el administrador desde el programa.
    """
    fijos = [
        ((1, 1), "Año Nuevo", 0),
        ((5, 1), "Día del Trabajo", 0),
        ((6, 7), "Batalla de Arica y Día de la Bandera", 2024),
        ((6, 29), "San Pedro y San Pablo", 0),
        ((7, 23), "Día de la Fuerza Aérea del Perú", 2023),
        ((7, 28), "Fiestas Patrias", 0),
        ((7, 29), "Fiestas Patrias", 0),
        ((8, 6), "Batalla de Junín", 2022),
        ((8, 30), "Santa Rosa de Lima", 0),
        ((10, 8), "Combate de Angamos", 0),
        ((11, 1), "Día de Todos los Santos", 0),
        ((12, 8), "Inmaculada Concepción", 0),
        ((12, 9), "Batalla de Ayacucho", 2022),
        ((12, 25), "Navidad", 0),
    ]
    filas = []
    for anio in range(desde, hasta + 1):
        for (m, d), nombre, desde_anio in fijos:
            if anio >= desde_anio:
                filas.append((date(anio, m, d).isoformat(), nombre))
        pascua = easter(anio)
        filas.append(((pascua - timedelta(days=3)).isoformat(), "Jueves Santo"))
        filas.append(((pascua - timedelta(days=2)).isoformat(), "Viernes Santo"))
    return sorted(set(filas))


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Uso: python preparar_semilla.py <carpeta_csv> <salida.db>")
    carpeta, salida = sys.argv[1], sys.argv[2]

    exp = pd.read_csv(os.path.join(carpeta, "expedientes.csv"), dtype={"expediente": str})
    mov = pd.read_csv(os.path.join(carpeta, "movimientos.csv"), dtype={"expediente": str})
    print(f"Leídos {len(exp):,} expedientes y {len(mov):,} movimientos")

    feriados = feriados_peru()
    vacaciones = np.array([f for f, _ in feriados], dtype="datetime64[D]")

    def dh(a, b):
        """Días hábiles en [a, b): lun-vie sin feriados."""
        return int(np.busday_count(np.datetime64(a), np.datetime64(b), holidays=vacaciones))

    # ---------------- fecha de corte ----------------
    hoy = date.today()
    mov["fecha"] = pd.to_datetime(mov["fecha"], errors="coerce").dt.date
    validas = mov["fecha"].dropna()
    corte = max(f for f in validas if f <= hoy)
    print(f"Fecha de corte de la importación: {corte}")

    # ---------------- unidades: unificar sinónimos ----------------
    canon_por_nombre, canon = {}, {}
    for sigla, (nombre, cat) in UNIDADES.items():
        canon_por_nombre.setdefault(nombre, sigla)
        canon[sigla] = canon_por_nombre[nombre]

    def clasificar(texto):
        c = clasificar_destino(texto)
        if c["tipo"] == TIPO_UNIDAD and c["codigo"] in canon:
            c = dict(c, codigo=canon[c["codigo"]])
        return c

    # ---------------- base ----------------
    if os.path.exists(salida):
        os.remove(salida)
    con = sqlite3.connect(salida)
    with open(ESQUEMA, encoding="utf-8") as f:
        con.executescript(f.read())

    con.executemany("INSERT INTO feriados VALUES (?,?,'LEY')", feriados)
    con.executemany("INSERT INTO departamentos(codigo,nombre) VALUES (?,?)",
                    [(d["codigo"], d["nombre"]) for d in DEPARTAMENTOS])
    unidades_canon = {}
    for sigla, (nombre, cat) in UNIDADES.items():
        unidades_canon[canon[sigla]] = (nombre, cat)
    con.executemany("INSERT INTO unidades(codigo,nombre,categoria) VALUES (?,?,?)",
                    [(k, v[0], v[1]) for k, v in unidades_canon.items()])

    procs = []
    for c in CATALOGO:
        procs.append((c["codigo"], c["nombre"], c["grupo"], int(c["es_tramite"]),
                      c["tupa_codigo"], c["tupa_nombre"], c["plazo_tupa"],
                      PROCEDIMIENTO_A_DEPARTAMENTO.get(c["codigo"]),
                      int(bool(c["es_tramite"]))))
    procs.append(("SIN_CLASIFICAR", "Sin clasificar", "Sin clasificar", 0,
                  None, None, None, None, 0))
    procs.append(("VACIO", "Sin dato de trámite", "Sin clasificar", 0,
                  None, None, None, None, 0))
    con.executemany("""INSERT INTO procedimientos(codigo,nombre,grupo,es_tramite,
                       tupa_codigo,tupa_nombre,plazo_tupa,departamento_codigo,seleccionable)
                       VALUES (?,?,?,?,?,?,?,?,?)""", procs)

    # ---------------- movimientos por (sistema, expediente) ----------------
    mov = mov.reset_index().rename(columns={"index": "_fila"})
    mov = mov.sort_values(["sistema", "expediente", "orden", "_fila"])
    grupos = {k: g for k, g in mov.groupby(["sistema", "expediente"], sort=False)}

    conteo = {"EN_TRAMITE": 0, "FINALIZADO": 0, "ARCHIVADO": 0,
              "CERRADO_HISTORICO": 0, "SIN_FECHA": 0}
    invalidas_ing = 0
    filas_exp, filas_mov = [], []
    exp_id = 0
    for _, e in exp.iterrows():
        exp_id += 1
        clave = (e["sistema"], e["expediente"])
        g = grupos.get(clave)

        fi = pd.to_datetime(e["fecha_ingreso"], errors="coerce")
        fi = None if pd.isna(fi) else fi.date()
        fecha_invalida = int(fi is not None and fi > corte)
        invalidas_ing += fecha_invalida

        ultima, ult_clas = None, None
        orden = 0
        if g is not None:
            for _, m in g.iterrows():
                orden += 1
                f = m["fecha"] if pd.notna(m["fecha"]) else None
                valida = int(f is not None and f <= corte)
                cl = clasificar(m["destino"] if pd.notna(m["destino"]) else None)
                filas_mov.append((
                    exp_id, orden, f.isoformat() if f else None,
                    m["tipo_movimiento"] if pd.notna(m["tipo_movimiento"]) else None,
                    m["destino"] if pd.notna(m["destino"]) else None,
                    cl["tipo"], cl["codigo"], cl["nombre"],
                    m["documento"] if pd.notna(m["documento"]) else None,
                    str(m["folios"]) if pd.notna(m["folios"]) else None,
                    valida))
                if valida:
                    ultima, ult_clas = f, cl

        # ---------- estado ----------
        if ultima is None:
            estado, cierre, motivo = "SIN_FECHA", None, "Sin fechas de movimiento válidas en el origen"
        elif ult_clas["tipo"] == TIPO_ESTADO and ult_clas["codigo"] in ESTADO_FINAL:
            estado, motivo = ESTADO_FINAL[ult_clas["codigo"]]
            cierre = ultima.isoformat()
        elif dh(ultima, corte) > DIAS_INACTIVIDAD_CIERRE:
            estado, cierre = "CERRADO_HISTORICO", ultima.isoformat()
            motivo = (f"Sin movimiento por más de {DIAS_INACTIVIDAD_CIERRE} días "
                      f"hábiles a la fecha de corte ({corte.isoformat()})")
        else:
            estado, cierre, motivo = "EN_TRAMITE", None, None
        conteo[estado] += 1

        ub = ult_clas or {"tipo": "SIN DATO", "codigo": None, "nombre": None}
        filas_exp.append((
            exp_id, e["expediente"], e["sistema"],
            e["solicitante"] if pd.notna(e["solicitante"]) else None,
            e["categoria_codigo"],
            e["texto_original"] if pd.notna(e["texto_original"]) else None,
            fi.isoformat() if fi else None, estado, cierre, motivo,
            ub["tipo"], ub["codigo"], ub["nombre"], fecha_invalida))

    con.executemany("""INSERT INTO expedientes(id,numero,sistema,solicitante,
        procedimiento_codigo,asunto,fecha_ingreso,estado,fecha_cierre,motivo_cierre,
        ubicacion_tipo,ubicacion_codigo,ubicacion_nombre,fecha_invalida,importado)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)""", filas_exp)
    con.executemany("""INSERT INTO movimientos(expediente_id,orden,fecha,tipo,
        destino_texto,destino_tipo,destino_codigo,destino_nombre,documento,folios,
        fecha_valida,importado) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)""", filas_mov)

    # ---------------- configuración ----------------
    with open(os.path.join(carpeta, "pesos_iua.json"), encoding="utf-8") as f:
        ahp = json.load(f)
    config = {
        "institucion": {"nombre": "Municipalidad Provincial de San Román",
                        "ciudad": "Juliaca",
                        "area": "Gerencia de Desarrollo Urbano"},
        "importacion": {"fecha_corte": corte.isoformat(),
                        "fuente": "CONSOLIDADO_LIMPIO_V5.xlsx (SGCUC y SGAU)",
                        "expedientes": len(filas_exp),
                        "movimientos": len(filas_mov),
                        "fecha_preparacion": hoy.isoformat()},
        "ahp": {"matriz": ahp["matriz"],
                "factores": [{k: fa[k] for k in ("codigo", "nombre", "pregunta", "justificacion")}
                             for fa in ahp["factores"]]},
        "parametros": {"n_minimo": 30, "mov_minimo": 2,
                       "dias_inactividad_cierre": DIAS_INACTIVIDAD_CIERRE,
                       "dias_alerta_por_vencer": 5,
                       "percentil_complejidad": 0.90,
                       "percentil_antiguedad": 0.90,
                       "piso_complejidad": 3,
                       "cortes": [["CRÍTICO", 0.70, "Atender hoy"],
                                  ["ALTO", 0.50, "Atender esta semana"],
                                  ["MEDIO", 0.30, "Programar"],
                                  ["BAJO", 0.00, "Sin apremio"]],
                       "escala_tipo": {"con_plazo_tupa": 1.0,
                                       "tramite_ciudadano": 0.6,
                                       "acto_interno": 0.3}},
        "version_esquema": 1,
    }
    con.executemany("INSERT INTO configuracion VALUES (?,?)",
                    [(k, json.dumps(v, ensure_ascii=False)) for k, v in config.items()])
    con.commit()
    con.execute("VACUUM")
    con.close()

    print(f"Expedientes: {len(filas_exp):,}  |  movimientos: {len(filas_mov):,}")
    for k, v in conteo.items():
        print(f"  {k:<18} {v:>7,}")
    print(f"  fecha de ingreso posterior al corte (marcadas): {invalidas_ing}")
    print(f"  movimientos con fecha inválida: {sum(1 for m in filas_mov if not m[-1]):,}")
    print(f"Base inicial lista: {salida} ({os.path.getsize(salida)/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
