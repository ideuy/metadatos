import json
import os
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from tqdm import tqdm

HITS_PER_PAGE = 200
URL_API_IDE = f"https://visualizador.ide.uy/geonetwork/srv/api/records?hitsPerPage={HITS_PER_PAGE}&from=1&to={HITS_PER_PAGE}"
RUTA_CATALOGO_SALIDA = os.path.join("datos", "catalogo.json")

NAMESPACES_RDF = {
    'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    'dcat': 'http://www.w3.org/ns/dcat#',
    'dct': 'http://purl.org/dc/terms/',
    'foaf': 'http://xmlns.com/foaf/0.1/',
    'ogc': 'http://www.opengis.net/rdf#'
}

def limpiar_texto(texto):
    """Elimina múltiples espacios, tabulaciones y saltos de línea innecesarios."""
    if not texto:
        return ""
    return re.sub(r'\s+', ' ', texto).strip()

def clasificar_tipo_servicio(url):
    url_minuscula = url.lower()
    if "wms" in url_minuscula:
        return "WMS"
    elif "wfs" in url_minuscula:
        return "WFS"
    elif "wmts" in url_minuscula:
        return "WMTS"
    elif any(ext in url_minuscula for ext in ['.zip', '.shp', '.geojson', '.kml', '.tif', '.tiff', '.csv', '.xlsx', '.jpg']):
        return "Descarga Directa"
    return "Otros"

def extraer_bbox_wkt(texto_wkt):
    try:
        coordenadas_str = re.search(r'Polygon\s*\(\((.*?)\)\)', texto_wkt, re.IGNORECASE)
        if not coordenadas_str:
            return None
        
        pares = coordenadas_str.group(1).split(',')
        lons, lats = [], []
        for par in pares:
            partes = par.strip().split()
            if len(partes) >= 2:
                lons.append(float(partes[0]))
                lats.append(float(partes[1]))
                
        if lons and lats:
            return [min(lons), min(lats), max(lons), max(lats)]
    except Exception:
        pass
    return None

def es_registro_uruguay(bbox, titulo, resumen):
    """Valida si el registro pertenece a Uruguay por BBOX o términos clave."""
    if bbox:
        minx, miny, maxx, maxy = bbox
        # BBOX aproximado de Uruguay
        if -59.0 <= minx <= -52.0 and -36.0 <= miny <= -29.0:
            return True
        # Si está completamente fuera de la región (ej. Australia/Victoria), descartar
        if minx > -50.0 or miny > 0.0 or maxx < -60.0 or maxy < -40.0:
            return False

    texto_combinado = f"{titulo} {resumen}".lower()
    descartes = ["geoscience australia", "victoria", "vmadmin", "dse"]
    if any(palabra in texto_combinado for palabra in descartes):
        return False
        
    return True

def extraer_metadatos_rdf():
    print("Conectando a la API de IDE Uruguay...")
    peticion = urllib.request.Request(
        URL_API_IDE, 
        headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    )
    
    try:
        with urllib.request.urlopen(peticion, timeout=120) as respuesta:
            tamanio_total = int(respuesta.info().get('Content-Length', 0))
            
            pbar = tqdm(
                total=tamanio_total if tamanio_total > 0 else None,
                unit='B',
                unit_scale=True,
                desc="Descargando metadatos"
            )
            
            chunk_size = 1024 * 64
            datos_xml = bytearray()
            
            while True:
                chunk = respuesta.read(chunk_size)
                if not chunk:
                    break
                datos_xml.extend(chunk)
                pbar.update(len(chunk))
            pbar.close()

        print("Procesando estructura RDF/DCAT...")
        raiz_xml = ET.fromstring(datos_xml)
        lista_catalogo = []

        datasets = raiz_xml.findall('.//dcat:Dataset', NAMESPACES_RDF)
        contador_validos = 1

        for dataset in datasets:
            nodo_titulo = dataset.find('dct:title', NAMESPACES_RDF)
            titulo = limpiar_texto(nodo_titulo.text) if (nodo_titulo is not None and nodo_titulo.text) else "Sin título"

            nodo_resumen = dataset.find('dct:abstract', NAMESPACES_RDF)
            if nodo_resumen is None:
                nodo_resumen = dataset.find('dct:description', NAMESPACES_RDF)

            resumen = limpiar_texto(nodo_resumen.text) if (nodo_resumen is not None and nodo_resumen.text) else "Sin descripción disponible."

            bbox = None
            nodo_wkt = dataset.find('.//ogc:asWKT', NAMESPACES_RDF)
            if nodo_wkt is not None and nodo_wkt.text:
                bbox = extraer_bbox_wkt(nodo_wkt.text)

            # Filtrar registros de plantilla/ejemplos internacionales
            if not es_registro_uruguay(bbox, titulo, resumen):
                continue

            palabras_clave = [
                limpiar_texto(kw.text) for kw in dataset.findall('dcat:keyword', NAMESPACES_RDF) if kw.text
            ]

            institucion = "Organismo No Especificado"
            nodo_publisher = dataset.find('dct:publisher', NAMESPACES_RDF)
            if nodo_publisher is not None:
                uri_org = nodo_publisher.attrib.get(f"{{{NAMESPACES_RDF['rdf']}}}resource", "")
                if uri_org:
                    nombre_org = uri_org.split('/')[-1]
                    nombre_org = urllib.parse.unquote(nombre_org)  # Decodifica caracteres como %20 o %28
                    if nombre_org:
                        institucion = limpiar_texto(nombre_org)

            distribuciones = []
            tipos_detectados = set()
            
            for nodo_dist in dataset.findall('dcat:distribution', NAMESPACES_RDF):
                url_recurso = nodo_dist.attrib.get(f"{{{NAMESPACES_RDF['rdf']}}}resource", "")
                if url_recurso:
                    tipo_servicio = clasificar_tipo_servicio(url_recurso)
                    tipos_detectados.add(tipo_servicio)
                    distribuciones.append({
                        "url": url_recurso,
                        "tipo": tipo_servicio,
                        "protocolo": tipo_servicio
                    })

            lista_catalogo.append({
                "id": f"meta-{contador_validos}",
                "titulo": titulo,
                "resumen": resumen,
                "institucion": institucion,
                "palabras_clave": palabras_clave,
                "tipos_servicio": list(tipos_detectados),
                "bbox": bbox,
                "distribuciones": distribuciones
            })
            contador_validos += 1

        os.makedirs(os.path.dirname(RUTA_CATALOGO_SALIDA), exist_ok=True)

        with open(RUTA_CATALOGO_SALIDA, 'w', encoding='utf-8') as archivo:
            json.dump(lista_catalogo, archivo, ensure_ascii=False, indent=2)

        print(f"Éxito: Se filtraron y procesaron {len(lista_catalogo)} registros de Uruguay en '{RUTA_CATALOGO_SALIDA}'")

    except Exception as error:
        print(f"Error al extraer metadatos: {error}")

if __name__ == "__main__":
    extraer_metadatos_rdf()