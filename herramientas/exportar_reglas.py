"""
EXPORTAR REGLAS DE CLASIFICACIÓN — URBANITO
============================================
Vuelca a JSON las reglas de los catálogos de Python (trámites, dependencias y
departamentos) para que el importador del programa (electron/motor/
clasificacion.js) clasifique exactamente igual que preparar_semilla.py.

Así hay UNA sola fuente de reglas: los catálogos .py. Si se cambia una regla,
se vuelve a ejecutar este script:

    python herramientas/exportar_reglas.py

y se verifica con `npm run probar` (la prueba de importación comprueba que el
clasificador JS reproduce la clasificación de la base inicial).
"""
import json
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from catalogo_dependencias import (UNIDADES, ESTADOS, PREFIJOS_CARGO,  # noqa: E402
                                   RX_TRANSITO)
from catalogo_tramites import CATALOGO  # noqa: E402
from catalogo_departamentos import DEPARTAMENTOS  # noqa: E402

SALIDA = os.path.join(os.path.dirname(AQUI), "electron", "motor", "reglas_origen.json")


def main():
    datos = {
        "_aviso": "Archivo generado por herramientas/exportar_reglas.py. No editar a mano.",
        "tramites": [
            {"codigo": c["codigo"], "nombre": c["nombre"], "grupo": c["grupo"],
             "patron": c["patron"].pattern}
            for c in CATALOGO
        ],
        "unidades": {k: list(v) for k, v in UNIDADES.items()},
        "estados": ESTADOS,
        "prefijos_cargo": PREFIJOS_CARGO,
        "rx_transito": RX_TRANSITO.pattern,
        "departamentos": [{"codigo": d["codigo"], "nombre": d["nombre"],
                           "procedimientos": d["procedimientos"]} for d in DEPARTAMENTOS],
    }
    with open(SALIDA, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=1)
    print(f"Reglas exportadas: {len(datos['tramites'])} trámites, "
          f"{len(datos['unidades'])} unidades -> {SALIDA}")


if __name__ == "__main__":
    main()
