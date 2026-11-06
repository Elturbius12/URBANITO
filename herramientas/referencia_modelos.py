"""
IMPLEMENTACIÓN DE REFERENCIA DE LOS MODELOS (Python / pandas / numpy)
======================================================================
Calcula MTA, IUA y AHP sobre la base del programa con las mismas reglas que
el motor JavaScript que lleva el programa. Sirve para verificar, número por
número, que el motor del programa calcula lo mismo que esta implementación
independiente.

Uso:
    python referencia_modelos.py <urbanito.db> <AAAA-MM-DD hoy> <salida.json>
"""
import json
import re
import sqlite3
import sys
import unicodedata

import numpy as np
import pandas as pd


def normalizar_texto(s):
    if s is None:
        return ""
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").upper()
    s = re.sub(r"[^A-Z0-9]+", " ", s)
    return s.strip()


def interpretar(cv):
    if cv is None:
        return "sin dato"
    if cv < 0.3:
        return "muy predecible"
    if cv < 0.6:
        return "predecible"
    if cv < 1.0:
        return "variable"
    return "muy variable"


def medidas(valores, plazo=None):
    d = pd.Series(valores, dtype=float).dropna()
    n = len(d)
    if n == 0:
        return None
    media = float(d.mean())
    desv = float(d.std(ddof=1)) if n > 1 else 0.0
    m = {"n": n, "media": media, "mediana": float(d.quantile(0.5)),
         "desviacion": desv, "p80": float(d.quantile(0.8)), "p95": float(d.quantile(0.95)),
         "minimo": float(d.min()), "maximo": float(d.max()),
         "coef_variacion": desv / media if media > 0 else None}
    if plazo is not None:
        m["plazo_tupa"] = int(plazo)
        m["tasa_cumplimiento"] = float((d <= plazo).mean())
        m["brecha_p80_tupa"] = m["p80"] - plazo
    else:
        m["plazo_tupa"] = m["tasa_cumplimiento"] = m["brecha_p80_tupa"] = None
    return m


def ahp(matriz):
    A = np.array(matriz, dtype=float)
    vals, vecs = np.linalg.eig(A)
    i = int(np.argmax(vals.real))
    w = np.abs(vecs[:, i].real)
    w = w / w.sum()
    n = A.shape[0]
    lmax = float(vals[i].real)
    ic = (lmax - n) / (n - 1)
    ia = {1: 0, 2: 0, 3: 0.58, 4: 0.90, 5: 1.12, 6: 1.24, 7: 1.32, 8: 1.41, 9: 1.45}[n]
    rc = ic / ia if ia else 0.0
    return {"pesos": w.tolist(), "lambda_max": lmax, "ic": ic, "rc": rc}


def main():
    ruta, hoy_txt, salida = sys.argv[1:4]
    con = sqlite3.connect(ruta)
    cfg = {k: json.loads(v) for k, v in con.execute("SELECT clave, valor FROM configuracion")}
    par = cfg["parametros"]
    fer = np.array([r[0] for r in con.execute("SELECT fecha FROM feriados")], dtype="datetime64[D]")
    hoy = np.datetime64(hoy_txt)

    def dh(a, b):
        return int(np.busday_count(np.datetime64(a), np.datetime64(b), holidays=fer))

    exp = pd.read_sql("SELECT e.*, p.plazo_tupa, p.es_tramite FROM expedientes e "
                      "LEFT JOIN procedimientos p ON p.codigo = e.procedimiento_codigo", con)
    mov = pd.read_sql("SELECT * FROM movimientos WHERE fecha_valida = 1 AND fecha IS NOT NULL "
                      "ORDER BY expediente_id, orden", con)

    # ---------- derivados por expediente ----------
    def clave_destino(r):
        if r["destino_tipo"] in (None, "SIN DATO") or pd.isna(r["destino_tipo"]):
            return None
        if r["destino_codigo"] is not None and not pd.isna(r["destino_codigo"]):
            return f"{r['destino_tipo']}:{r['destino_codigo']}"
        t = normalizar_texto(r["destino_texto"])
        return f"TXT:{t}" if t else None

    mov["clave"] = mov.apply(clave_destino, axis=1)
    por_exp = {k: g for k, g in mov.groupby("expediente_id")}

    def suspension(g, hasta):
        dias, abierta = 0, None
        for _, m in g.iterrows():
            if m["tipo"] == "OBSERVACION":
                abierta = m["fecha"]
            elif m["tipo"] == "SUBSANACION" and abierta is not None:
                dias += dh(abierta, m["fecha"])
                abierta = None
        if abierta is not None and hasta is not None:
            dias += dh(abierta, hasta)
        return dias

    n_mov, n_ofi, ultima = {}, {}, {}
    for i, g in por_exp.items():
        n_mov[i] = len(g)
        n_ofi[i] = g["clave"].dropna().nunique()
        ultima[i] = g["fecha"].iloc[-1]
    exp["n_mov"] = exp["id"].map(n_mov).fillna(0).astype(int)
    exp["n_oficinas"] = exp["id"].map(n_ofi).fillna(0).astype(int)

    # ---------- MTA ----------
    base = exp[exp.estado.isin(["CERRADO_HISTORICO", "FINALIZADO"])
               & (exp.n_mov >= par["mov_minimo"]) & (exp.fecha_invalida == 0)
               & exp.fecha_ingreso.notna() & exp.fecha_cierre.notna()].copy()
    dias = []
    for _, e in base.iterrows():
        if e["fecha_cierre"] < e["fecha_ingreso"]:
            dias.append(None)
            continue
        g = por_exp.get(e["id"])
        s = suspension(g, None) if g is not None else 0
        dias.append(dh(e["fecha_ingreso"], e["fecha_cierre"]) - s)
    base["dias"] = dias
    base = base[base["dias"].notna()]

    mta_tramite = {}
    for cod, g in base.groupby("procedimiento_codigo"):
        plazo = g["plazo_tupa"].iloc[0]
        plazo = None if pd.isna(plazo) else plazo
        m = medidas(g["dias"], plazo)
        m["datos_suficientes"] = m["n"] >= par["n_minimo"]
        m["interpretacion"] = interpretar(m["coef_variacion"]) if m["datos_suficientes"] else "sin datos suficientes"
        mta_tramite[cod] = m

    perm = {}
    ids_base = set(base["id"])
    for i in ids_base:
        g = por_exp.get(i)
        if g is None or len(g) < 2:
            continue
        filas = g.to_dict("records")
        for a, b in zip(filas[:-1], filas[1:]):
            if a["destino_tipo"] in ("UNIDAD ORGANICA", "DEPARTAMENTO"):
                amb = "unidad"
            elif a["destino_tipo"] in ("RESPONSABLE", "USUARIO"):
                amb = "responsable"
            else:
                continue
            k = (amb, f"{a['destino_tipo']}:{a['destino_codigo']}")
            perm.setdefault(k, {"dias": [], "exp": set()})
            perm[k]["dias"].append(dh(a["fecha"], b["fecha"]))
            perm[k]["exp"].add(i)
    mta_dest = {}
    for (amb, k), v in perm.items():
        m = medidas(v["dias"])
        if m["n"] < par["n_minimo"]:
            continue
        m["expedientes_atendidos"] = len(v["exp"])
        mta_dest[f"{amb}|{k}"] = m

    procs = pd.read_sql("SELECT codigo, plazo_tupa, es_tramite FROM procedimientos", con)
    plazo_ref = {}
    for _, p in procs.iterrows():
        if pd.notna(p["plazo_tupa"]):
            plazo_ref[p["codigo"]] = (float(p["plazo_tupa"]), "TUPA")
        elif p["codigo"] in mta_tramite and mta_tramite[p["codigo"]]["datos_suficientes"]:
            plazo_ref[p["codigo"]] = (mta_tramite[p["codigo"]]["p80"], "P80 OBSERVADO")
        else:
            plazo_ref[p["codigo"]] = (None, "SIN DATOS")

    # ---------- AHP ----------
    res_ahp = ahp(cfg["ahp"]["matriz"])
    cod_f = [f["codigo"] for f in cfg["ahp"]["factores"]]
    pesos = dict(zip(cod_f, res_ahp["pesos"]))

    # ---------- IUA ----------
    ref_ofi = {}
    for cod, g in exp.groupby("procedimiento_codigo"):
        ref_ofi[cod] = max(float(g["n_oficinas"].quantile(par["percentil_complejidad"])),
                           par["piso_complejidad"])

    act = exp[exp.estado.isin(["EN_TRAMITE", "OBSERVADO"])].copy()
    d_ing, d_sin = [], []
    for _, e in act.iterrows():
        g = por_exp.get(e["id"])
        if e["fecha_invalida"] or e["fecha_ingreso"] is None or pd.isna(e["fecha_ingreso"]) \
           or np.datetime64(e["fecha_ingreso"]) > hoy:
            d_ing.append(None)
        else:
            s = suspension(g, hoy_txt) if g is not None else 0
            d_ing.append(max(0, dh(e["fecha_ingreso"], hoy_txt) - s))
        d_sin.append(dh(ultima[e["id"]], hoy_txt) if e["id"] in ultima else None)
    act["dias"] = d_ing
    act["dias_sin"] = d_sin
    vals = act["dias"].dropna().astype(float)
    ref_ant = max(float(vals.quantile(par["percentil_antiguedad"])), 1.0) if len(vals) else 1.0

    def clave_ubic(e):
        if e["ubicacion_tipo"] is None or pd.isna(e["ubicacion_tipo"]) or e["ubicacion_codigo"] is None \
           or pd.isna(e["ubicacion_codigo"]):
            return "SIN UBICACION"
        return f"{e['ubicacion_tipo']}:{e['ubicacion_codigo']}"

    act["ubic"] = act.apply(clave_ubic, axis=1)
    carga = act["ubic"].value_counts().to_dict()
    max_carga = max(carga.values()) if carga else 1

    def norm(v, ref):
        if v is None or ref is None or ref <= 0:
            return None
        return min(1.0, max(0.0, v / ref))

    esc = par["escala_tipo"]
    iua = {}
    for _, e in act.iterrows():
        pr, origen = plazo_ref.get(e["procedimiento_codigo"], (None, "SIN DATOS"))
        dias = None if e["dias"] is None or pd.isna(e["dias"]) else float(e["dias"])
        if dias is None or pr is None:
            fu = None
        elif pr == 0:
            fu = 1.0 if dias > 0 else 0.0
        else:
            fu = min(1.0, max(0.0, dias / pr))
        fc = norm(float(e["n_oficinas"]), ref_ofi.get(e["procedimiento_codigo"], par["piso_complejidad"]))
        fa = norm(dias, ref_ant)
        if pd.notna(e["plazo_tupa"]):
            ft = esc["con_plazo_tupa"]
        elif e["es_tramite"] == 1:
            ft = esc["tramite_ciudadano"]
        else:
            ft = esc["acto_interno"]
        fcar = norm(float(carga[e["ubic"]]), float(max_carga))
        f = {"urgencia_temporal": fu, "complejidad": fc, "antiguedad": fa,
             "tipo_procedimiento": ft, "carga_trabajo": fcar}
        disp = {k: v for k, v in f.items() if v is not None}
        pd_ = sum(pesos[k] for k in disp)
        valor = sum(pesos[k] * v for k, v in disp.items()) / pd_
        vencido = bool(pd.notna(e["plazo_tupa"]) and dias is not None and dias > e["plazo_tupa"])
        nivel = None
        if vencido:
            nivel = "CRÍTICO"
        else:
            for nv, corte, _ in par["cortes"]:
                if valor >= corte:
                    nivel = nv
                    break
        iua[str(int(e["id"]))] = {"iua": valor, "nivel": nivel, "vencido": vencido,
                                  "factores": f, "dias": dias}

    out = {"ahp": res_ahp, "mta_tramite": mta_tramite, "mta_destino": mta_dest,
           "plazo_ref": {k: list(v) for k, v in plazo_ref.items()},
           "ref_antiguedad": ref_ant, "max_carga": max_carga, "iua": iua,
           "base_mta": int(len(base))}
    with open(salida, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, default=lambda o: o if not isinstance(o, np.generic) else o.item())
    niveles = pd.Series([v["nivel"] for v in iua.values()]).value_counts().to_dict()
    print(f"Referencia: base MTA {len(base):,} | trámites MTA {len(mta_tramite)} | "
          f"destinos MTA {len(mta_dest)} | activos IUA {len(iua)} | niveles {niveles}")
    print(f"AHP pesos {[round(p, 6) for p in res_ahp['pesos']]} RC={res_ahp['rc']:.6f}")


if __name__ == "__main__":
    main()
