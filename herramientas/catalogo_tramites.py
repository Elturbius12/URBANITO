"""
CATÁLOGO DE TRÁMITES — URBANITO
================================
Agrupa las 16,563 variantes de texto libre (con errores de tipeo) en un
catálogo de categorías de trámite, y enlaza cada categoría con su
procedimiento TUPA cuando existe.

REGLA CRÍTICA: si un trámite NO tiene procedimiento TUPA identificado en el
documento oficial que tenemos, NO se le asigna plazo. Se marca explícitamente
como "sin plazo normativo identificado". No se inventan plazos.

Las reglas se evalúan EN ORDEN: la primera que coincide gana. Por eso las
reglas más específicas van primero.
"""
import re
import unicodedata

# ---------------------------------------------------------------------------
# Normalización de texto
# ---------------------------------------------------------------------------

def normalizar(s):
    """Mayúsculas, sin tildes, sin puntuación, espacios colapsados."""
    if s is None:
        return ""
    s = str(s).strip().upper()
    if s in ("NAN", "NONE", ""):
        return ""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


# ---------------------------------------------------------------------------
# Fragmentos regex tolerantes a los errores de tipeo reales de la data
# ---------------------------------------------------------------------------
# "CERTIFICADO", "CERT", "CERTIF", "CERTIFICDAO", "CERTIFICADO DE", "CERTIFICADO D E"
RX_CERT = r"(?:CERTIFICADOS?|CERTIFICDAO|CERTIF|CERTF|CERT)"
# "NUMERACION", "NUEMRACION", "NUMERAION", "ENUMERACION", "NUM", "N P"
RX_NUMER = r"(?:E?NUMERACIONE?S?|NUEMRACION|NUMERAION|NUMERCION|NUM\b|NUMERAC)"
# "POSESION", "POSECION", "POSESION"
RX_POSE = r"(?:POSESION|POSECION|POSSESION|POCESION)"
# "CONSTANCIA", "CONSTACIA", "CONTANCIA", "CONSTANCIA D E"
RX_CONST = r"(?:CONSTANCIAS?|CONSTACIA|CONTANCIA|COSNTANCIA|CONST\b)"
# "CATASTRO", "CATSTRO"
RX_CATAS = r"(?:CATASTRO|CATSTRO|CATASRO)"
# "SUBDIVISION", "SUB DIVISION", "SUB DIVICION", "DIVICION"
RX_SUBDIV = r"(?:SUB\s*DIVI[SC]ION|SUBDIVI[SC]ION)"
# "VISADO", "VISACION", "VISADO DE PLANO"
RX_VISADO = r"(?:VISADOS?|VISACION|VIZADO|VISTO BUENO DE PLANO)"
# "PRESCRIPCION", "PREESCRIPCION", "PRESC", "P A D", "PAD"
RX_PRESC = r"(?:PRE+SCRIPCION|PRESC\b|\bP\s*A\s*D\b|\bPAD\b)"
# "REGISTROS PUBLICOS", "R P", "RR PP", "SUNARP"
RX_RRPP = r"(?:REGISTROS?\s*PUBLICOS?|REGIS\s*PUBLICOS?|\bR\s*P\b|\bRR\s*PP\b|SUNARP)"
# "SERVICIOS BASICOS", "SERVICOS BASICOS", "S B", "AGUA LUZ"
RX_SSBB = r"(?:SERVI[CV]I?OS?\s*BASICOS?|\bS\s*B\b|AGUA\s*(?:Y\s*)?(?:LUZ|DESAGUE))"


def expr(*parts):
    """Une fragmentos en un regex de búsqueda."""
    return re.compile("|".join(parts))


# ---------------------------------------------------------------------------
# CATÁLOGO
# ---------------------------------------------------------------------------
# Cada entrada:
#   codigo         : identificador interno estable
#   nombre         : nombre legible
#   grupo          : agrupación temática
#   patron         : regex; la primera coincidencia en orden gana
#   tupa_codigo    : código del procedimiento TUPA, o None si no existe
#   tupa_nombre    : nombre oficial TUPA, o None
#   plazo_tupa     : días hábiles según TUPA, o None si no hay procedimiento
#   es_tramite     : True = trámite de ciudadano; False = acto interno
#
# IMPORTANTE: plazo_tupa=None significa "sin plazo normativo identificado".
# El sistema NO debe sustituirlo por un valor por defecto.

CATALOGO = [
    # ========== ACTOS INTERNOS (no son trámites TUPA de ciudadano) ==========
    # Van primero porque frases como "SUBSANA PARAMETROS" no deben caer en
    # la categoría "parámetros urbanísticos".
    dict(codigo="INT_SUBSANA", nombre="Subsanación / levantamiento de observaciones",
         grupo="Acto interno", es_tramite=False,
         patron=expr(r"\bSUBSAN", r"LEVANTAMIENTO\s*DE\s*OBSERVACION",
                  r"RESPUESTA\s*A\s*(?:LA\s*)?OBSERVACION", r"\bSUBSANACION"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="INT_NOTIF", nombre="Notificación / descargo",
         grupo="Acto interno", es_tramite=False,
         patron=expr(r"NOTIFICACION", r"\bDESCARGO", r"EFECTU[EA]\s*NOTIF",
                  r"NOTIFICAR", r"PREVENTIVA\s*DE\s*INFRACCION"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="INT_RECONSID", nombre="Recurso de reconsideración o apelación",
         grupo="Acto interno", es_tramite=False,
         patron=expr(r"RECONSIDERACION", r"\bAPELACION", r"RECURSO\s*DE"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="INT_DESIST", nombre="Desistimiento y devolución",
         grupo="Acto interno", es_tramite=False,
         patron=expr(r"DESISTIMIENTO", r"DEVOLUCION\s*Y\s*DESIST", r"DESISTE"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="INT_AMPL_PLAZO", nombre="Ampliación de plazo",
         grupo="Acto interno", es_tramite=False,
         patron=expr(r"AMPLIACION\s*DE\s*PLAZO", r"PRORROGA\s*DE\s*PLAZO"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="INT_INFORME", nombre="Informe / opinión técnica interna",
         grupo="Acto interno", es_tramite=False,
         patron=expr(r"^SOLICIT[AO]?\s*INFORME", r"^SOL\s*INFORME", r"^INFORME\b",
                  r"INFORME\s*(?:TECNICO|DOCUMENTADO|SOBRE)", r"OPINION\s*TECNICA",
                  r"AUTENTICIDAD", r"PRONUNCIAMIENTO"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="INT_REMITE", nombre="Remisión de documentos / conocimiento",
         grupo="Acto interno", es_tramite=False,
         patron=expr(r"SE\s*REMITE", r"REMIT[AE]", r"ADJUNTA?R?\s*DOCUMENTO",
                  r"^CONOCIMIENTO", r"SE\s*DEVUELVE", r"COPIA\s*DE\s*PLANO",
                  r"CUMPLA\s*CON\s*LO\s*DISPUESTO", r"TOMAR\s*ACCIONES",
                  r"COMUNIC[AO]\s*DISPOSICION", r"LO\s*QUE\s*(?:SE\s*)?INDICA",
                  r"NO\s*INDICA", r"INFORMATIVO", r"\bAUDIENCIA\b",
                  r"\bOPOSICION\b", r"SOLICIT[AO]\s*INFORMACION",
                  r"REQUI?ER[EA]\w*\s*(?:DE\s*)?INFORM", r"REMIT[OAE]\w*\s*INFORM",
                  r"\bANEXAR?\b", r"^INFORMACION", r"DE\s*CONOCIMIENTO",
                  r"\bCONFORMIDAD\s*(?:PARA|DE\s*PRACTICAS)", r"\bOFICIO\b",
                  r"\bRECTIFICACION\b$", r"^SOLICIT[AO]$"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="INT_RESOLUCION", nombre="Emisión / rectificación de resolución",
         grupo="Acto interno", es_tramite=False,
         patron=expr(r"^RESOLUCION\s*DE", r"RECTIFICACION\s*DE\s*RESOLUCION",
                  r"LIBRE\s*DISPONIBILIDAD"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="INT_COPIA", nombre="Copia certificada de documento o plano",
         grupo="Acto interno", es_tramite=False,
         patron=expr(r"\bCOPIAS?\b", r"COPIA\s*CERTIFICADA", r"FOTOCOPIA"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="INT_OPINION_LEGAL", nombre="Opinión legal",
         grupo="Acto interno", es_tramite=False,
         patron=expr(r"OPINION\s*LEGAL", r"\bLEGAL\b"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="INT_DEVOLUCION", nombre="Devolución de pago o documentos",
         grupo="Acto interno", es_tramite=False,
         patron=expr(r"DEVOLUCION\s*(?:DE\s*)?(?:PAGO|DOCUMENTO|EXPEDIENTE)",
                  r"\bDEVOLUCION\b", r"\bDEVOLVER\b"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="INT_SILENCIO", nombre="Silencio administrativo",
         grupo="Acto interno", es_tramite=False,
         patron=expr(r"SILENCIO\s*ADMINISTRATIVO"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="INT_PRACTICAS", nombre="Prácticas pre profesionales",
         grupo="Acto interno", es_tramite=False,
         patron=expr(r"PRACTICAS", r"PRE\s*PROFESIONAL"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="INT_RIESGO", nombre="Disposición por riesgo",
         grupo="Acto interno", es_tramite=False,
         patron=expr(r"RIESGO\s*ELECTRICO", r"\bRIESGO\b", r"DISPOSICION\s*DE\s*MEDIDA"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    # ========== TRÁMITES SIN PROCEDIMIENTO TUPA IDENTIFICADO ==========
    # Son trámites reales y frecuentes, pero NO figuran en el TUPA que tenemos.
    # plazo_tupa = None  →  el sistema usará solo el P80 del MTA y lo advertirá.

    dict(codigo="CONST_POSESION", nombre="Constancia de posesión",
         grupo="Catastro", es_tramite=True,
         patron=expr(RX_CONST + r".*" + RX_POSE, RX_POSE,
                  RX_CERT + r".*" + RX_POSE),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="PRESC_ADQ", nombre="Prescripción adquisitiva de dominio",
         grupo="Catastro", es_tramite=True,
         patron=expr(RX_PRESC + r".*ADQUISITIV", r"ADQUISITIVA\s*DE\s*DOMINIO",
                  r"^" + RX_PRESC + r"$"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="INDEPENDIZACION", nombre="Independización de predio rústico",
         grupo="Habilitación urbana", es_tramite=True,
         patron=expr(r"INDEPENDIZACION"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="CONST_RUSTICO", nombre="Constancia de predio rústico",
         grupo="Catastro", es_tramite=True,
         patron=expr(RX_CONST + r".*PREDIO\s*RUSTICO", r"PREDIO\s*RUSTICO"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="SUBDIV_TIERRAS", nombre="Subdivisión de tierras",
         grupo="Habilitación urbana", es_tramite=True,
         patron=expr(RX_SUBDIV + r".*TIERRAS", r"^" + RX_SUBDIV + r"$"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="ACCESO_INFO", nombre="Acceso a la información pública",
         grupo="Transparencia", es_tramite=True,
         patron=expr(r"ACCESO\s*A\s*LA?\s*INFORMACION", r"ACCESO\s*ALA\s*INFORMACION"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="CAMBIO_USO", nombre="Cambio de uso",
         grupo="Autorizaciones", es_tramite=True,
         patron=expr(r"CAMBIO\s*DE\s*USO"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="CERT_JURISDICCION", nombre="Certificado de jurisdicción",
         grupo="Catastro", es_tramite=True,
         patron=expr(r"JURI[SD]DICCION", r"JURIDICCION"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="PLANO_CATASTRAL", nombre="Plano catastral",
         grupo="Catastro", es_tramite=True,
         patron=expr(r"PLANO\s*CATASTRAL", r"CATASTRAL"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="REPLANTEO", nombre="Replanteo / verificación de lote",
         grupo="Catastro", es_tramite=True,
         patron=expr(r"REPLANTEO", r"\bVERIFICACION\b"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="TERRENO", nombre="Disponibilidad o donación de terreno",
         grupo="Otros", es_tramite=True,
         patron=expr(r"DISPONIBILIDAD\s*DE\s*TERRENO", r"DONACION\s*DE\s*TERRENO",
                  r"\bTERRENO\b"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="HABITABILIDAD", nombre="Certificado de habitabilidad",
         grupo="Edificaciones", es_tramite=True,
         patron=expr(r"HABITABILIDAD"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    # ========== TRÁMITES CON PROCEDIMIENTO TUPA IDENTIFICADO ==========

    dict(codigo="NUM_PREDIAL", nombre="Certificado de numeración municipal",
         grupo="Catastro", es_tramite=True,
         patron=expr(RX_NUMER + r".*PREDIAL", r"PREDIAL.*" + RX_NUMER,
                  RX_NUMER + r"\s*MUNICIPAL", r"\bN\s*P\s*SERVICIOS",
                  RX_CERT + r"\s*D?\s*E?\s*" + RX_NUMER, r"^" + RX_NUMER),
         tupa_codigo="ES1726979056",
         tupa_nombre="Certificado de Numeración Municipal",
         plazo_tupa=0),

    dict(codigo="NEG_CATASTRO", nombre="Certificado negativo de catastro",
         grupo="Catastro", es_tramite=True,
         patron=expr(r"NEGATIVO.{0,4}\s*(?:DE\s*)?" + RX_CATAS,
                  RX_CATAS + r".*NEGATIVO", r"CERT\s*NEG(?:ATIVO)?\b"),
         tupa_codigo="PA18934371",
         tupa_nombre="Certificado negativo de catastro para predio urbano o rústico",
         plazo_tupa=7),

    dict(codigo="ZONIF_VIAS", nombre="Certificado de zonificación y vías",
         grupo="Autorizaciones", es_tramite=True,
         patron=expr(r"ZONIFICACION"),
         tupa_codigo="PA18936C68",
         tupa_nombre="Certificado de Zonificación de vías",
         plazo_tupa=5),

    dict(codigo="COMPAT_USO", nombre="Certificado de compatibilidad de uso",
         grupo="Autorizaciones", es_tramite=True,
         patron=expr(r"COMPATIBILIDAD\s*DE\s*USO", r"COMPATIBILIDAD"),
         tupa_codigo="PA189371E1",
         tupa_nombre="Certificado de Compatibilidad de uso",
         plazo_tupa=10),

    dict(codigo="PARAMETROS", nombre="Certificado de parámetros urbanísticos y edificatorios",
         grupo="Edificaciones", es_tramite=True,
         patron=expr(r"PARAMETROS"),
         tupa_codigo="PA1893BCB1",
         tupa_nombre="Certificado de parámetros urbanísticos y edificatorios",
         plazo_tupa=15),

    dict(codigo="ALINEAMIENTO", nombre="Constancia de alineamiento municipal",
         grupo="Autorizaciones", es_tramite=True,
         patron=expr(r"ALINEAMIENTO"),
         tupa_codigo="PA1893045A",
         tupa_nombre="Constancia de Alineamiento Municipal",
         plazo_tupa=7),

    dict(codigo="VISADO_PLANO", nombre="Visado de planos y memoria descriptiva",
         grupo="Catastro", es_tramite=True,
         patron=expr(RX_VISADO),
         tupa_codigo="PA1893F321",
         tupa_nombre="Visado de plano de ubicación, perimétrico y memoria descriptiva de predio urbano",
         plazo_tupa=15),

    dict(codigo="SUBDIV_LOTE", nombre="Subdivisión de lote urbano",
         grupo="Habilitación urbana", es_tramite=True,
         patron=expr(RX_SUBDIV + r".*LOTE", RX_SUBDIV),
         tupa_codigo="PE1726971032",
         tupa_nombre="Subdivisión de Lote Urbano",
         plazo_tupa=13),

    dict(codigo="OCUP_VIA", nombre="Autorización de ocupación de vía pública con materiales",
         grupo="Autorizaciones", es_tramite=True,
         patron=expr(r"OCUPACION\s*DE\s*VIA", r"MATERIALES\s*DE\s*CONSTRUCCION",
                  r"VIA\s*PUBLICA"),
         tupa_codigo="PA18939987",
         tupa_nombre="Autorización para ocupación de vía pública con materiales de construcción",
         plazo_tupa=10),

    dict(codigo="APERT_ZANJA", nombre="Autorización para apertura de zanja",
         grupo="Autorizaciones", es_tramite=True,
         patron=expr(r"APERTURA\s*DE\s*ZANJA", r"\bZANJA\b"),
         tupa_codigo="PA18935619",
         tupa_nombre="Autorización para apertura de zanja en predios urbanos",
         plazo_tupa=10),

    dict(codigo="TELECOM_DESMONT", nombre="Desmontaje y retiro de infraestructura de telecomunicaciones",
         grupo="Telecomunicaciones", es_tramite=True,
         patron=expr(r"DESMONTAJE", r"RETIRO\s*DE\s*(?:LA\s*)?INFRAESTRUCTURA"),
         tupa_codigo="PA189349F9",
         tupa_nombre="Autorización de desmontaje y retiro de la infraestructura de telecomunicaciones",
         plazo_tupa=15),

    dict(codigo="TELECOM_INST", nombre="Instalación de infraestructura de telecomunicaciones",
         grupo="Telecomunicaciones", es_tramite=True,
         patron=expr(r"TELECOMUNICACION", r"RADIOCOMUNICACION", r"\bANTENAS?\b",
                  r"FIBRA\s*OPTICA", r"CABLE\s*AEREO", r"\bPOSTES?\b",
                  r"\bMURETE\b", r"INSTALACION\s*DE\s*INFRAESTRUCTURA",
                  r"FINALIZACION\s*DE\s*INSTALACION", r"\bACROS\b"),
         tupa_codigo="PA18935D57",
         tupa_nombre="Autorización para la instalación de infraestructura para la prestación de servicios públicos de telecomunicaciones",
         plazo_tupa=15),

    dict(codigo="CONFORM_OBRA", nombre="Conformidad de obra y declaratoria de edificación",
         grupo="Edificaciones", es_tramite=True,
         patron=expr(r"CONFORMIDAD\s*DE\s*OBRA", r"DECLARATORIA\s*DE\s*EDIFICACION",
                  r"PREDECLARATORIA"),
         tupa_codigo="PE1726971136",
         tupa_nombre="Conformidad de Obra y Declaratoria de Edificación sin variaciones para las Modalidades B, C y D",
         plazo_tupa=18),

    dict(codigo="LIC_DEMOLICION", nombre="Licencia de edificación — demolición",
         grupo="Edificaciones", es_tramite=True,
         patron=expr(r"DEMOLICION", r"DEMOLER", r"\bDESMONTE\b"),
         tupa_codigo="PE1726971069",
         tupa_nombre="Licencia de Edificación Modalidad B - Aprobación de proyecto con evaluación por la Municipalidad para demolición parcial",
         plazo_tupa=18),

    dict(codigo="LIC_EDIFICACION", nombre="Licencia de edificación / construcción",
         grupo="Edificaciones", es_tramite=True,
         patron=expr(r"LICENCIAS?\s*DE\s*(?:CONSTRUCCION|EDIFICACION|OBRA)",
                  r"\bEDIFICACIONES?\b", r"OBRA\s*NUEVA", r"\bTECHO\b",
                  r"INICIO\s*DE\s*OBRA", r"\bAMPLIACION\b", r"REMODELACION",
                  r"REGULARIZACION"),
         tupa_codigo="PE1726971093",
         tupa_nombre="Licencia de Edificación Modalidad C - Aprobación de proyecto con evaluación previa por la Comisión Técnica para ampliación, remodelación y/o demolición parcial",
         plazo_tupa=28),

    dict(codigo="HAB_URBANA", nombre="Habilitación urbana",
         grupo="Habilitación urbana", es_tramite=True,
         patron=expr(r"HABILITACION\s*URBANA", r"RECEPCION\s*DE\s*OBRAS"),
         tupa_codigo="PE1726971013",
         tupa_nombre="Licencia de Habilitación Urbana Modalidad C - Aprobación de Proyecto con evaluación previa por la Comisión Técnica para proceso de Reurbanización",
         plazo_tupa=48),

    dict(codigo="PREDIO_RUSTICO_VIS", nombre="Visado de planos para predio rústico",
         grupo="Catastro", es_tramite=True,
         patron=expr(r"RUSTICO"),
         tupa_codigo="PA18931361",
         tupa_nombre="Visado de planos y memoria descriptiva para predio rústico",
         plazo_tupa=10),

    # ========== Destinos genéricos (contexto, no trámite en sí) ==========
    dict(codigo="GEN_RRPP", nombre="Trámite con fines registrales (SUNARP)",
         grupo="Otros", es_tramite=True,
         patron=expr(RX_RRPP),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="GEN_SSBB", nombre="Trámite para servicios básicos",
         grupo="Otros", es_tramite=True,
         patron=expr(RX_SSBB),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),

    dict(codigo="GEN_RECT_ESCRIT", nombre="Trámite para rectificación de escritura",
         grupo="Otros", es_tramite=True,
         patron=expr(r"RECTIFICACION\s*D?\s*E?\s*E?SCRITURA", r"\bR\s*E\b"),
         tupa_codigo=None, tupa_nombre=None, plazo_tupa=None),
]

# Categoría de respaldo para lo que no coincide con nada
SIN_CLASIFICAR = dict(
    codigo="SIN_CLASIFICAR", nombre="Sin clasificar", grupo="Sin clasificar",
    es_tramite=False, tupa_codigo=None, tupa_nombre=None, plazo_tupa=None)

VACIO = dict(
    codigo="VACIO", nombre="Sin dato de trámite", grupo="Sin clasificar",
    es_tramite=False, tupa_codigo=None, tupa_nombre=None, plazo_tupa=None)

# Índice por código
POR_CODIGO = {c["codigo"]: c for c in CATALOGO}
POR_CODIGO[SIN_CLASIFICAR["codigo"]] = SIN_CLASIFICAR
POR_CODIGO[VACIO["codigo"]] = VACIO


def clasificar(*textos):
    """
    Clasifica un trámite a partir de uno o varios campos de texto.
    Los textos se concatenan y se evalúan contra el catálogo en orden.
    Devuelve el dict de la categoría.
    """
    partes = [normalizar(t) for t in textos]
    partes = [p for p in partes if p]
    if not partes:
        return VACIO
    texto = " ".join(partes)
    for cat in CATALOGO:
        if cat["patron"].search(texto):
            return cat
    return SIN_CLASIFICAR


if __name__ == "__main__":
    # Prueba rápida con casos reales de la data
    pruebas = [
        "CERTIFICADO DE NUMERACION PREDIAL",
        "CERT D ENUMERACION PREDIAL PARA SERVICIOS BASICOS",
        "CONSTANCIA DE POSECION",
        "CERT NEGATIVO DE CATSTRO",
        "CERTIFICADO DE ZONIFICACION Y VIAS",
        "SUB DIVICION DE TIERRAS",
        "VISADO DE PLANO Y MEMORIA",
        "OCUPACION DE VIA",
        "SUBSANA PARAMETROS",
        "PARAMETROS URBANISTICOS",
        "LICENCIA DE CONSTRUCCION",
        "NOTIFICACION PREVENTIVA DE INFRACCION",
        "PRESCRIPCION ADQUISITIVA DE DOMINIO",
        "",
        "ALGO QUE NO EXISTE XYZ",
    ]
    print(f"{'TEXTO':<58} {'CATEGORÍA':<42} PLAZO")
    print("-" * 115)
    for t in pruebas:
        c = clasificar(t)
        plazo = f"{c['plazo_tupa']} d.h." if c["plazo_tupa"] else "sin plazo TUPA"
        print(f"{t[:56]:<58} {c['nombre'][:40]:<42} {plazo}")
