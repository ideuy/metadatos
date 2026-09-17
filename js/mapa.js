/**
 * Módulo del Visor Cartográfico (mapa.js)
 * Gestiona el mapa Leaflet, la representación de BBOX, el filtrado espacial y la previsualización de capas.
 */

let instanciaMapa = null;
let grupoCapasBbox = null;
let capaPrevisualizacionActiva = null;

// Coordenadas y zoom inicial centrados en Uruguay
const CENTRO_URUGUAY = [-32.522779, -55.765835];
const ZOOM_INICIAL = 6;

/**
 * Inicializa el mapa Leaflet en el contenedor HTML #mapa.
 * @param {Array} datosCatalogo - Datos iniciales para dibujar las extensiones geográficas.
 */
function inicializarMapa(datosCatalogo) {
    const contenedorMapa = document.getElementById('mapa');
    if (!contenedorMapa) return;

    // Crear la instancia de Leaflet
    instanciaMapa = L.map('mapa').setView(CENTRO_URUGUAY, ZOOM_INICIAL);

    // Agregar mapa base institucional OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(instanciaMapa);

    // Grupo de capas para dibujar y limpiar dinámicamente las BBOX
    grupoCapasBbox = L.featureGroup().addTo(instanciaMapa);

    // Listener para el checkbox de filtrado espacial
    const casillaFiltroEspacial = document.getElementById('filtro-area-visible');
    if (casillaFiltroEspacial) {
        casillaFiltroEspacial.addEventListener('change', () => {
            if (typeof ejecutarFiltrosCombinados === 'function') {
                ejecutarFiltrosCombinados();
            }
        });
    }

    // Al mover o hacer zoom en el mapa, si el filtro espacial está activo, refrescar filtros
    instanciaMapa.on('moveend', () => {
        const filtroEspacialActivo = casillaFiltroEspacial && casillaFiltroEspacial.checked;
        if (filtroEspacialActivo && typeof ejecutarFiltrosCombinados === 'function') {
            ejecutarFiltrosCombinados();
        }
    });

    // Control del botón para remover capa activa
    const botonRemoverCapa = document.getElementById('boton-remover-capa-activa');
    if (botonRemoverCapa) {
        botonRemoverCapa.addEventListener('click', removerCapaPrevisualizada);
    }

    // Dibujar las BBOX iniciales
    actualizarCapasMapa(datosCatalogo);
}

/**
 * Determina si el BBOX de un recurso se cruza con la vista actual del mapa.
 * @param {Array} bbox - [minx, miny, maxx, maxy]
 * @returns {boolean}
 */
function intersecaAreaVisible(bbox) {
    if (!instanciaMapa || !bbox || bbox.length !== 4) return true;

    const limitesMapa = instanciaMapa.getBounds();
    const oesteVisible = limitesMapa.getWest();
    const esteVisible = limitesMapa.getEast();
    const surVisible = limitesMapa.getSouth();
    const norteVisible = limitesMapa.getNorth();

    const minx = bbox[0];
    const miny = bbox[1];
    const maxx = bbox[2];
    const maxy = bbox[3];

    // No interseca si está completamente a la izquierda, derecha, arriba o abajo
    const separadoHorizontal = minx > esteVisible || maxx < oesteVisible;
    const separadoVertical = miny > norteVisible || maxy < surVisible;

    return !(separadoHorizontal || separadoVertical);
}

/**
 * Dibuja los BBOX de los recursos visibles en el catálogo activo sobre el mapa.
 * @param {Array} listaMetadatos - Lista de metadatos filtrados a representar.
 */
function actualizarCapasMapa(listaMetadatos) {
    if (!instanciaMapa || !grupoCapasBbox) return;

    grupoCapasBbox.clearLayers();

    listaMetadatos.forEach(metadato => {
        if (metadato.bbox && metadato.bbox.length === 4) {
            const minx = metadato.bbox[0];
            const miny = metadato.bbox[1];
            const maxx = metadato.bbox[2];
            const maxy = metadato.bbox[3];

            const limitesBbox = [
                [miny, minx],
                [maxy, maxx]
            ];

            const rectangulo = L.rectangle(limitesBbox, {
                color: '#004d40',
                weight: 1.5,
                fillColor: '#0288d1',
                fillOpacity: 0.12
            });

            // Contenido emergente al hacer clic sobre el BBOX
            rectangulo.bindPopup(`
                <div style="font-size:0.85rem; line-height: 1.3;">
                    <strong style="color: #004d40;">${metadato.titulo}</strong><br>
                    <span style="color: #555;">${metadato.institucion}</span><br>
                    <div style="margin-top: 6px;">
                        <a href="#${metadato.id}" style="color:#0288d1; font-weight:600; text-decoration:none;">Ir a tarjeta en listado &rarr;</a>
                    </div>
                </div>
            `);

            grupoCapasBbox.addLayer(rectangulo);
        }
    });
}

/**
 * Enfoca y hace zoom en el mapa según las coordenadas BBOX seleccionadas desde una tarjeta.
 * @param {Array} bbox - [minx, miny, maxx, maxy]
 */
function enfocarEnMapa(bbox) {
    if (!instanciaMapa || !bbox || bbox.length !== 4) {
        alert('Este metadato no posee coordenadas geográficas delimitadas.');
        return;
    }

    const minx = bbox[0];
    const miny = bbox[1];
    const maxx = bbox[2];
    const maxy = bbox[3];

    const limites = [
        [miny, minx],
        [maxy, maxx]
    ];

    instanciaMapa.fitBounds(limites, { padding: [30, 30] });

    const seccionMapa = document.querySelector('.seccion-mapa');
    if (seccionMapa) {
        seccionMapa.scrollIntoView({ behavior: 'smooth' });
    }
}

/**
 * Previsualiza una capa WMS sobre el mapa.
 * @param {string} url - URL del servicio WMS
 * @param {string} titulo - Título descriptivo de la capa
 * @param {Array} bbox - [minx, miny, maxx, maxy] opcional para autozoom
 */
function previsualizarCapaWms(url, titulo, bbox) {
    if (!instanciaMapa) return;

    removerCapaPrevisualizada();

    // Limpiar query params de la URL base
    const urlBase = url.split('?')[0];

    try {
        // En servicios de GeoServer institucional, se usa la capa asociada a la ruta
        // o parámetro layers según la URL
        let nombreCapa = '';
        const partesUrl = urlBase.split('/');
        const penultima = partesUrl[partesUrl.length - 2];
        nombreCapa = penultima || 'default';

        capaPrevisualizacionActiva = L.tileLayer.wms(urlBase, {
            layers: nombreCapa,
            format: 'image/png',
            transparent: true,
            version: '1.3.0',
            opacity: 0.75,
            attribution: `&copy; ${titulo}`
        });

        capaPrevisualizacionActiva.addTo(instanciaMapa);

        // Actualizar barra de estado visual
        const barraEstado = document.getElementById('barra-estado-mapa');
        const textoCapa = document.getElementById('texto-capa-activa');
        if (barraEstado && textoCapa) {
            textoCapa.textContent = `Previsualizando capa: ${titulo}`;
            barraEstado.style.display = 'flex';
        }

        if (bbox && bbox.length === 4) {
            enfocarEnMapa(bbox);
        } else {
            const seccionMapa = document.querySelector('.seccion-mapa');
            if (seccionMapa) {
                seccionMapa.scrollIntoView({ behavior: 'smooth' });
            }
        }
    } catch (error) {
        console.error('Error al previsualizar capa WMS:', error);
        alert('No se pudo previsualizar la capa en el mapa.');
    }
}

/**
 * Quita la capa activa de previsualización del mapa.
 */
function removerCapaPrevisualizada() {
    if (instanciaMapa && capaPrevisualizacionActiva) {
        instanciaMapa.removeLayer(capaPrevisualizacionActiva);
        capaPrevisualizacionActiva = null;
    }

    const barraEstado = document.getElementById('barra-estado-mapa');
    if (barraEstado) {
        barraEstado.style.display = 'none';
    }
}
