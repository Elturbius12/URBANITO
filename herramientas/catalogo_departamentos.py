"""
CATÁLOGO DE DEPARTAMENTOS — URBANITO
======================================
Los 11 departamentos que definen el alcance del proyecto URBANITO.

Cada departamento se enlaza con uno o más códigos del catálogo de
procedimientos (scripts/catalogo_tramites.py), que ya tienen expedientes
reales y, en todos los casos, plazo oficial del TUPA.

Esto no es una tabla aparte de datos: es una relación entre lo que ya existe
(los procedimientos clasificados desde el Excel real) y el nombre
institucional del departamento que los atiende.
"""

DEPARTAMENTOS = [
    dict(codigo="DEP_NUMERACION", nombre="Departamento de Numeración Municipal",
         procedimientos=["NUM_PREDIAL"]),

    dict(codigo="DEP_LICENCIAS_EDIF", nombre="Departamento de Licencias de Edificación",
         procedimientos=["LIC_EDIFICACION", "LIC_DEMOLICION", "CONFORM_OBRA"]),

    dict(codigo="DEP_VISADO_PLANOS", nombre="Departamento de Visado de Planos",
         procedimientos=["VISADO_PLANO", "PREDIO_RUSTICO_VIS"]),

    dict(codigo="DEP_PARAMETROS", nombre="Departamento de Parámetros Urbanísticos",
         procedimientos=["PARAMETROS"]),

    dict(codigo="DEP_NEG_CATASTRO", nombre="Departamento de Negativo de Catastro",
         procedimientos=["NEG_CATASTRO"]),

    dict(codigo="DEP_SUBDIV_TIERRAS", nombre="Departamento de Sub División de Tierras",
         procedimientos=["SUBDIV_TIERRAS", "SUBDIV_LOTE"]),

    dict(codigo="DEP_ZONIFICACION", nombre="Departamento de Zonificación y Vías",
         procedimientos=["ZONIF_VIAS"]),

    dict(codigo="DEP_TELECOM", nombre="Departamento de Telecomunicaciones",
         procedimientos=["TELECOM_INST", "TELECOM_DESMONT"]),

    dict(codigo="DEP_COMPAT_USO", nombre="Departamento de Compatibilidad de Uso",
         procedimientos=["COMPAT_USO"]),

    dict(codigo="DEP_APERT_ZANJA", nombre="Departamento de Apertura de Zanja",
         procedimientos=["APERT_ZANJA"]),

    dict(codigo="DEP_OCUP_VIA", nombre="Departamento de Ocupación de Vía",
         procedimientos=["OCUP_VIA"]),
]

# Mapa inverso: código de procedimiento -> código de departamento
PROCEDIMIENTO_A_DEPARTAMENTO = {
    proc: dep["codigo"]
    for dep in DEPARTAMENTOS
    for proc in dep["procedimientos"]
}
