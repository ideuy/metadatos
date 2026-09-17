import json
import os
import re
import time
import urllib.parse
import xml.etree.ElementTree as ET
from collections import Counter
from typing import Optional

import requests
import urllib3
from tqdm import tqdm

# Desactivar advertencias de SSL inseguro (GeoNetwork Uruguay)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Configuración de Endpoints y Parámetros CSW
URL_CSW = "https://visualizador.ide.uy/geonetwork/srv/spa/csw"
TAMANO_PAGINA = 100
TAMANO_LOTE_ID = 25
UMBRAL_DOS_FASES = 3000
VERIFICAR_SSL = False
PAUSA_ENTRE_REQUESTS_SEG = 0.3
MAX_REINTENTOS = 3
ESPERA_BASE_REINTENTO_SEG = 2

RUTA_CATALOGO_SALIDA = os.path.join("datos", "catalogo.json")

# Espacios de Nombres ISO 19139 / CSW OGC
ESPACIOS_NOMBRES = {
    "csw": "http://www.opengis.net/cat/csw/2.0.2",
    "gmd": "http://www.isotc211.org/2005/gmd",
    "gco": "http://www.isotc211.org/2005/gco",
    "gml": "http://www.opengis.net/gml",
    "ows": "http://www.opengis.net/ows",
    "dc": "http://purl.org/dc/elements/1.1/",
}


def obtener_texto_seguro(elemento: Optional[ET.Element]) -> str:
    """Extrae y normaliza el texto de un elemento XML."""
    if elemento is not None and elemento.text:
        return " ".join(elemento.text.strip().split())
    return ""


def primer_nodo_no_nulo(contenedor: ET.Element, rutas: list[str]) -> Optional[ET.Element]:
    """Devuelve el primer nodo encontrado entre varias rutas candidatas."""
    for ruta in rutas:
        nodo = contenedor.find(ruta, ESPACIOS_NOMBRES)
        if nodo is not None:
            return nodo
    return None


def obtener_codigo_o_texto(nodo: Optional[ET.Element]) -> str:
    """Extrae código de atributos ISO/OGC o cae al texto plano limpiado."""
    if nodo is None:
        return ""
    return nodo.attrib.get("codeListValue") or obtener_texto_seguro(nodo)


def clasificar_tipo_servicio(url: str, protocolo: str = "") -> str:
    """Clasifica el recurso en categorías legibles para la interfaz web."""
    url_m = url.lower()
    prot_m = protocolo.upper()

    if "WMS" in prot_m or "wms" in url_m:
        return "WMS"
    elif "WFS" in prot_m or "wfs" in url_m:
        return "WFS"
    elif "WMTS" in prot_m or "wmts" in url_m:
        return "WMTS"
    elif any(ext in url_m for ext in [".zip", ".shp", ".geojson", ".kml", ".tif", ".tiff", ".csv", ".xlsx", ".jpg"]):
        return "Descarga Directa"
    return "Otros"


def parsear_bbox_iso(md: ET.Element) -> Optional[list[float]]:
    """Extrae BBOX geográfico [minx, miny, maxx, maxy] desde los nodos ISO 19139."""
    for bbox_node in md.findall(".//gmd:EX_GeographicBoundingBox", ESPACIOS_NOMBRES):
        west = obtener_texto_seguro(bbox_node.find("gmd:westBoundLongitude/gco:Decimal", ESPACIOS_NOMBRES))
        east = obtener_texto_seguro(bbox_node.find("gmd:eastBoundLongitude/gco:Decimal", ESPACIOS_NOMBRES))
        south = obtener_texto_seguro(bbox_node.find("gmd:southBoundLatitude/gco:Decimal", ESPACIOS_NOMBRES))
        north = obtener_texto_seguro(bbox_node.find("gmd:northBoundLatitude/gco:Decimal", ESPACIOS_NOMBRES))
        
        if west and east and south and north:
            try:
                minx, maxx = float(west), float(east)
                miny, maxy = float(south), float(north)
                return [minx, miny, maxx, maxy]
            except ValueError:
                continue
    return None


def es_registro_uruguay(bbox: Optional[list[float]], titulo: str, resumen: str) -> bool:
    """Valida si el registro pertenece a Uruguay por BBOX o filtros semánticos."""
    if bbox:
        minx, miny, maxx, maxy = bbox
        # BBOX envolvente aproximado de Uruguay
        if -59.0 <= minx <= -52.0 and -36.0 <= miny <= -29.0:
            return True
        # Descartar si cae completamente fuera del cono sur
        if minx > -50.0 or miny > 0.0 or maxx < -60.0 or maxy < -40.0:
            return False

    texto_combinado = f"{titulo} {resumen}".lower()
    descartes = ["geoscience australia", "victoria", "vmadmin", "dse", "sample record"]
    if any(palabra in texto_combinado for palabra in descartes):
        return False

    return True


def solicitar_con_reintentos(parametros: dict) -> Optional[requests.Response]:
    """Realiza peticiones GET con reintentos y tolerancia a fallos."""
    for intento in range(1, MAX_REINTENTOS + 1):
        try:
            respuesta = requests.get(
                URL_CSW, params=parametros, verify=VERIFICAR_SSL, timeout=60
            )
            if respuesta.status_code == 200:
                return respuesta
        except requests.RequestException:
            pass

        if intento < MAX_REINTENTOS:
            time.sleep(ESPERA_BASE_REINTENTO_SEG * intento)

    return None


def extraer_fecha_por_tipo(md: ET.Element, tipo_deseado: str) -> str:
    """Extrae fechas ISO específicas (creation, publication, revision)."""
    for ci_date in md.findall(".//gmd:identificationInfo//gmd:citation//gmd:CI_Date", ESPACIOS_NOMBRES):
        codigo_nodo = ci_date.find("gmd:dateType/gmd:CI_DateTypeCode", ESPACIOS_NOMBRES)
        codigo = obtener_codigo_o_texto(codigo_nodo).lower()
        if codigo == tipo_deseado:
            nodo_fecha = primer_nodo_no_nulo(
                ci_date, ["gmd:date/gco:DateTime", "gmd:date/gco:Date"]
            )
            return obtener_texto_seguro(nodo_fecha)
    return ""


def procesar_registro_md(md: ET.Element, id_secuencial: int) -> Optional[dict]:
    """Parsea un nodo gmd:MD_Metadata completo y devuelve el esquema JSON ampliado."""
    uuid = obtener_texto_seguro(md.find("gmd:fileIdentifier/gco:CharacterString", ESPACIOS_NOMBRES))
    if not uuid:
        return None

    titulo = (
        obtener_texto_seguro(
            md.find(".//gmd:identificationInfo//gmd:citation//gmd:title/gco:CharacterString", ESPACIOS_NOMBRES)
        )
        or "Sin título"
    )

    resumen = (
        obtener_texto_seguro(
            md.find(".//gmd:identificationInfo//gmd:abstract/gco:CharacterString", ESPACIOS_NOMBRES)
        )
        or "Sin descripción disponible."
    )

    bbox = parsear_bbox_iso(md)

    # Validar que sea un registro uruguayo
    if not es_registro_uruguay(bbox, titulo, resumen):
        return None

    # Institución / Organismo
    organismo = (
        obtener_texto_seguro(
            md.find(".//gmd:pointOfContact//gmd:organisationName/gco:CharacterString", ESPACIOS_NOMBRES)
        )
        or "Organismo No Especificado"
    )

    # Palabras clave y Temas
    palabras_clave = [
        obtener_texto_seguro(kw)
        for kw in md.findall(
            ".//gmd:identificationInfo//gmd:descriptiveKeywords//gmd:keyword//gco:CharacterString",
            ESPACIOS_NOMBRES,
        )
        if obtener_texto_seguro(kw)
    ]

    topic_nodes = md.findall(
        ".//gmd:identificationInfo//gmd:topicCategory/gmd:MD_TopicCategoryCode", ESPACIOS_NOMBRES
    )
    topicos_tematicos = [obtener_texto_seguro(t) for t in topic_nodes if obtener_texto_seguro(t)]

    # Fechas
    nodo_fecha_md = primer_nodo_no_nulo(md, ["gmd:dateStamp/gco:DateTime", "gmd:dateStamp/gco:Date"])
    fecha_metadato = obtener_texto_seguro(nodo_fecha_md) or "No especificada"
    fecha_creacion = extraer_fecha_por_tipo(md, "creation") or "No especificada"
    fecha_publicacion = extraer_fecha_por_tipo(md, "publication") or "No especificada"
    fecha_revision = extraer_fecha_por_tipo(md, "revision") or "No especificada"

    # Contacto
    correo_contacto = (
        obtener_texto_seguro(
            md.find(".//gmd:pointOfContact//gmd:electronicMailAddress/gco:CharacterString", ESPACIOS_NOMBRES)
        )
        or "No especificado"
    )

    # Jerarquía y Estado
    nodo_nivel = md.find("gmd:hierarchyLevel/gmd:MD_ScopeCode", ESPACIOS_NOMBRES)
    nivel_jerarquia = obtener_codigo_o_texto(nodo_nivel) or "dataset"

    nodo_progreso = md.find(".//gmd:identificationInfo//gmd:status/gmd:MD_ProgressCode", ESPACIOS_NOMBRES)
    estado_progreso = obtener_codigo_o_texto(nodo_progreso) or "No especificado"

    # CRS y Resoluciones
    crs_nodes = md.findall(".//gmd:referenceSystemInfo//gmd:rsIdentifier//gmd:code/gco:CharacterString", ESPACIOS_NOMBRES)
    sistemas_referencia = [obtener_texto_seguro(c) for c in crs_nodes if obtener_texto_seguro(c)]

    escala = obtener_texto_seguro(
        md.find(".//gmd:spatialResolution//gmd:equivalentScale//gmd:denominator/gco:Integer", ESPACIOS_NOMBRES)
    ) or "No especificada"

    # Extensión Temporal
    extensiones_temporales = []
    for periodo in md.findall(".//gmd:EX_TemporalExtent//gml:TimePeriod", ESPACIOS_NOMBRES):
        inicio = obtener_texto_seguro(periodo.find("gml:beginPosition", ESPACIOS_NOMBRES))
        fin = obtener_texto_seguro(periodo.find("gml:endPosition", ESPACIOS_NOMBRES))
        if inicio or fin:
            extensiones_temporales.append(f"{inicio or '?'} a {fin or '?'}")
    extension_temporal = " | ".join(extensiones_temporales) if extensiones_temporales else "No especificada"

    # Calidad y Linaje
    linaje = (
        obtener_texto_seguro(
            md.find(".//gmd:dataQualityInfo//gmd:lineage//gmd:statement/gco:CharacterString", ESPACIOS_NOMBRES)
        )
        or "No especificado"
    )

    # Restricciones
    restricciones_uso = [
        obtener_texto_seguro(n)
        for n in md.findall(".//gmd:resourceConstraints//gmd:useLimitation/gco:CharacterString", ESPACIOS_NOMBRES)
        if obtener_texto_seguro(n)
    ]

    # Distribución y Servicios OGC
    distribuciones = []
    tipos_detectados = set()

    for online in md.findall(".//gmd:distributionInfo//gmd:CI_OnlineResource", ESPACIOS_NOMBRES):
        url_recurso = obtener_texto_seguro(online.find("gmd:linkage/gmd:URL", ESPACIOS_NOMBRES))
        protocolo = obtener_texto_seguro(online.find("gmd:protocol/gco:CharacterString", ESPACIOS_NOMBRES))
        nombre_recurso = obtener_texto_seguro(online.find("gmd:name/gco:CharacterString", ESPACIOS_NOMBRES))

        if url_recurso:
            tipo_servicio = clasificar_tipo_servicio(url_recurso, protocolo)
            tipos_detectados.add(tipo_servicio)
            distribuciones.append({
                "url": url_recurso,
                "protocolo": protocolo or tipo_servicio,
                "tipo": tipo_servicio,
                "nombre": nombre_recurso
            })

    formatos_distribucion = sorted({
        obtener_texto_seguro(n)
        for n in md.findall(".//gmd:distributionFormat//gmd:MD_Format/gmd:name/gco:CharacterString", ESPACIOS_NOMBRES)
        if obtener_texto_seguro(n)
    })

    return {
        "id": f"meta-{id_secuencial}",
        "uuid": uuid,
        "titulo": titulo,
        "resumen": resumen,
        "institucion": organismo,
        "correo_contacto": correo_contacto,
        "palabras_clave": palabras_clave,
        "topicos_tematicos": topicos_tematicos,
        "tipos_servicio": list(tipos_detectados),
        "bbox": bbox,
        "distribuciones": distribuciones,
        "formatos_distribucion": formatos_distribucion,
        "nivel_jerarquia": nivel_jerarquia,
        "estado_progreso": estado_progreso,
        "escala_denominador": escala,
        "sistemas_referencia": sistemas_referencia,
        "extension_temporal": extension_temporal,
        "fechas": {
            "metadato": fecha_metadato,
            "creacion": fecha_creacion,
            "publicacion": fecha_publicacion,
            "revision": fecha_revision
        },
        "calidad": {
            "linaje": linaje
        },
        "restricciones_uso": restricciones_uso
    }


def extraer_metadatos_csw():
    """Ejecuta la extracción paginada vía GetRecords CSW ISO 19139."""
    print("\n🌐 Conectando al servicio CSW OGC de IDE Uruguay...")
    
    posicion_inicio = 1
    total_registros = None
    uuids_procesados = set()
    lista_catalogo = []
    contador_validos = 1

    pbar = tqdm(desc="🔄 Descargando e inspeccionando registros", unit="rec")

    while True:
        parametros = {
            "request": "GetRecords",
            "service": "CSW",
            "version": "2.0.2",
            "resultType": "results",
            "elementSetName": "full",
            "typeNames": "gmd:MD_Metadata",
            "outputSchema": "http://www.isotc211.org/2005/gmd",
            "startPosition": posicion_inicio,
            "maxRecords": TAMANO_PAGINA,
        }

        respuesta = solicitar_con_reintentos(parametros)
        if respuesta is None:
            print("\n❌ Error al conectar con la API CSW. Interrumpiendo lote.")
            break

        try:
            raiz = ET.fromstring(respuesta.content)
        except ET.ParseError as err:
            print(f"\nXML Invalido recibido: {err}")
            break

        nodo_resultados = raiz.find(".//csw:SearchResults", ESPACIOS_NOMBRES)
        if total_registros is None and nodo_resultados is not None:
            total_registros = int(nodo_resultados.attrib.get("numberOfRecordsMatched", 0))
            pbar.total = total_registros

        elementos = raiz.findall(".//gmd:MD_Metadata", ESPACIOS_NOMBRES)
        if not elementos:
            break

        for md in elementos:
            uuid = obtener_texto_seguro(md.find("gmd:fileIdentifier/gco:CharacterString", ESPACIOS_NOMBRES))
            if uuid and uuid in uuids_procesados:
                continue

            metadato_procesado = procesar_registro_md(md, contador_validos)
            if metadato_procesado:
                uuids_procesados.add(uuid)
                lista_catalogo.append(metadato_procesado)
                contador_validos += 1

            pbar.update(1)

        # Determinar siguiente página
        siguiente = None
        if nodo_resultados is not None:
            valor_siguiente = nodo_resultados.attrib.get("nextRecord")
            if valor_siguiente is not None:
                siguiente = int(valor_siguiente)

        if siguiente is not None and siguiente > 0:
            posicion_inicio = siguiente
        else:
            posicion_inicio += len(elementos)
            if total_registros and posicion_inicio > total_registros:
                break

        time.sleep(PAUSA_ENTRE_REQUESTS_SEG)

    pbar.close()

    # Guardar en JSON estático para el cliente Web
    os.makedirs(os.path.dirname(RUTA_CATALOGO_SALIDA), exist_ok=True)
    with open(RUTA_CATALOGO_SALIDA, "w", encoding="utf-8") as archivo:
        json.dump(lista_catalogo, archivo, ensure_ascii=False, indent=2)

    print(f"\n✅ Éxito: Se procesaron {len(lista_catalogo)} registros de Uruguay en '{RUTA_CATALOGO_SALIDA}'\n")


if __name__ == "__main__":
    extraer_metadatos_csw()