"""
CATÁLOGO DE DEPENDENCIAS — URBANITO
====================================
El campo de destino de una derivación mezcla tres cosas distintas:

  1. UNIDAD ORGÁNICA  — una oficina de la municipalidad, escrita como sigla
                        (GEDU, SGAU, SGCUC, GDUYT…)
  2. RESPONSABLE      — el nombre de pila del trabajador que recibió el
                        expediente (PILAR, CRISTIAN, ALEXANDER…)
  3. ESTADO           — una situación, no un destino (ARCHIVADO, ABANDONO,
                        BUSQUEDA)

Mezclarlas produce estadísticas sin sentido ("la oficina PILAR tarda 27 días").
Este módulo las separa.

Los nombres oficiales de las siglas provienen de la estructura orgánica de la
Municipalidad Provincial de San Román. Una sigla que no está en el catálogo
NO se inventa: se marca como no identificada.
"""
import re
import unicodedata

# ---------------------------------------------------------------------------
# Unidades orgánicas reconocidas
# ---------------------------------------------------------------------------
UNIDADES = {
    # Gerencias
    "GEDU":     ("Gerencia de Desarrollo Urbano", "Gerencia"),
    "GDU":      ("Gerencia de Desarrollo Urbano", "Gerencia"),
    "GDUYT":    ("Gerencia de Desarrollo Urbano y Territorial", "Gerencia"),
    "GSG":      ("Gerencia de Secretaría General", "Gerencia"),
    "GESG":     ("Gerencia de Secretaría General", "Gerencia"),
    "GEMU":     ("Gerencia Municipal", "Gerencia"),
    "GEAD":     ("Gerencia de Administración", "Gerencia"),
    "GAT":      ("Gerencia de Administración Tributaria", "Gerencia"),
    "GPDE":     ("Gerencia de Promoción del Desarrollo Económico", "Gerencia"),

    # Sub gerencias de desarrollo urbano (el ámbito de URBANITO)
    "SGAU":     ("Sub Gerencia de Autorizaciones Urbanas", "Sub Gerencia"),
    "SGCUC":    ("Sub Gerencia de Control Urbano y Catastro", "Sub Gerencia"),
    "SGPU":     ("Sub Gerencia de Planeamiento Urbano", "Sub Gerencia"),
    "SGPUC":    ("Sub Gerencia de Planeamiento Urbano y Catastro", "Sub Gerencia"),
    "SGOP":     ("Sub Gerencia de Obras Públicas", "Sub Gerencia"),
    "SGEP":     ("Sub Gerencia de Estudios y Proyectos", "Sub Gerencia"),

    # Otras sub gerencias
    "SGAC":     ("Sub Gerencia de Atención al Ciudadano", "Sub Gerencia"),
    "SGBPSFL":  ("Sub Gerencia de Bienes, Patrimonio y Saneamiento Físico Legal", "Sub Gerencia"),
    "SGFIPL":   ("Sub Gerencia de Fiscalización, Inspección y Policía Local", "Sub Gerencia"),
    "SGRRHH":   ("Sub Gerencia de Recursos Humanos", "Sub Gerencia"),
    "SGGA":     ("Sub Gerencia de Gestión Ambiental", "Sub Gerencia"),
    "SGCS":     ("Sub Gerencia de Control y Supervisión", "Sub Gerencia"),

    # Órganos de asesoría y apoyo
    "PPM":      ("Procuraduría Pública Municipal", "Órgano de asesoría"),
    "UF":       ("Unidad Formuladora", "Órgano de apoyo"),
    "OPMI":     ("Oficina de Programación Multianual de Inversiones", "Órgano de apoyo"),
    "OCI":      ("Órgano de Control Institucional", "Órgano de control"),
}

# Estados: no son un destino, son una situación del expediente
ESTADOS = {
    "ARCHIVADO":  "Archivado",
    "ARCHIVO":    "Archivado",
    "ABANDONO":   "En abandono",
    "BUSQUEDA":   "En búsqueda",
    "PENDIENTE":  "Pendiente",
    "CONCLUIDO":  "Concluido",
    "ENTREGADO":  "Entregado al administrado",
    "NOTIFICADO": "Notificado",
}

TIPO_UNIDAD = "UNIDAD ORGANICA"
TIPO_RESPONSABLE = "RESPONSABLE"
TIPO_ESTADO = "ESTADO"
TIPO_VACIO = "SIN DATO"
TIPO_NO_IDENT = "NO IDENTIFICADO"


def normalizar(texto):
    """Mayúsculas, sin tildes, sin puntuación, espacios colapsados."""
    if texto is None:
        return ""
    s = str(texto).strip().upper()
    if s in ("NAN", "NONE", ""):
        return ""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


# Prefijos que aparecen pegados al nombre del responsable
PREFIJOS_CARGO = r"^(?:ARQ|ING|ABOG|ABG|LIC|TEC|SR|SRA|SRTA|DR|CPC)\s+"

# Frases que indican tránsito, no destino
RX_TRANSITO = re.compile(r"^(?:PASA\s+A|DERIVADO\s+A|VA\s+A|REMITIDO\s+A)\s+")


def clasificar_destino(texto):
    """
    Clasifica el destino de una derivación.

    Devuelve un dict con:
        tipo            UNIDAD ORGANICA | RESPONSABLE | ESTADO | SIN DATO | NO IDENTIFICADO
        codigo          sigla normalizada o nombre del responsable
        nombre          nombre oficial de la unidad, o el nombre tal cual
        categoria       Gerencia / Sub Gerencia / etc., solo para unidades
    """
    s = normalizar(texto)
    if not s:
        return {"tipo": TIPO_VACIO, "codigo": None, "nombre": None, "categoria": None}

    # "PASA A GDUYT" -> "GDUYT"
    s = RX_TRANSITO.sub("", s).strip()
    # "ARQ MIRIAN" -> "MIRIAN"
    s_sin_cargo = re.sub(PREFIJOS_CARGO, "", s).strip()

    # ¿Estado?
    for clave, nombre in ESTADOS.items():
        if s == clave or s_sin_cargo == clave:
            return {"tipo": TIPO_ESTADO, "codigo": clave,
                    "nombre": nombre, "categoria": None}

    # ¿Unidad orgánica? Exacta primero
    if s in UNIDADES:
        nombre, cat = UNIDADES[s]
        return {"tipo": TIPO_UNIDAD, "codigo": s, "nombre": nombre, "categoria": cat}

    # Compuestos tipo "GESG SGAC" o "GEAD SGBPSFL": gana la unidad más específica
    tokens = s.split()
    encontradas = [t for t in tokens if t in UNIDADES]
    if encontradas:
        # La sub gerencia es más específica que la gerencia
        subs = [t for t in encontradas if UNIDADES[t][1] == "Sub Gerencia"]
        elegida = subs[-1] if subs else encontradas[-1]
        nombre, cat = UNIDADES[elegida]
        return {"tipo": TIPO_UNIDAD, "codigo": elegida, "nombre": nombre, "categoria": cat}

    # ¿Una sola palabra alfabética? Lo tratamos como nombre de responsable.
    if len(tokens) <= 2 and all(t.isalpha() for t in tokens):
        nom = s_sin_cargo if s_sin_cargo else s
        return {"tipo": TIPO_RESPONSABLE, "codigo": nom,
                "nombre": nom.title(), "categoria": None}

    # Texto largo que no coincide con nada: no lo inventamos
    return {"tipo": TIPO_NO_IDENT, "codigo": None, "nombre": s[:80], "categoria": None}


if __name__ == "__main__":
    pruebas = ["GEDU", "SGAU", "PILAR", "ARQ MIRIAN", "PASA A GDUYT", "GESG SGAC",
               "ARCHIVADO", "ABANDONO", "BUSQUEDA", "",
               "DUPLICADO INFORME N 001 2025 ARACELY", "SGBPSFL", "GEAD SGBPSFL"]
    print(f"{'TEXTO':<40}{'TIPO':<18}{'CÓDIGO':<12}{'NOMBRE'}")
    print("-" * 110)
    for t in pruebas:
        r = clasificar_destino(t)
        print(f"{str(t)[:38]:<40}{r['tipo']:<18}{str(r['codigo'] or '—'):<12}"
              f"{str(r['nombre'] or '—')[:50]}")
