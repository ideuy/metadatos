/**
 * Módulo del Visor Cartográfico (mapa.js)
 * Gestiona el mapa de Leaflet, la representación de los BBOX de las capas y la interacción espacial.
 */

let instanciaMapa = null;
let grupoCapasBbox = null;

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

    // Agregar mapa base de OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(instanciaMapa);

    // Grupo de capas para dibujar y limpiar dinámicamente las BBOX
    grupoCapasBbox = L.featureGroup().addTo(instanciaMapa);

    // Dibujar las BBOX iniciales
    actualizarCapasMapa(datosCatalogo);
}

/**
 * Dibuja los BBOX de los recursos visibles en el catálogo activo sobre el mapa.
 * @param {Array} listaMetadatos - Lista de metadatos filtrados a representar.
 */
function actualizarCapasMapa(listaMetadatos) {
    if (!instanciaMapa || !grupoCapasBbox) return;

    // Limpiar BBOX anteriores
    grupoCapasBbox.clearLayers();

    listaMetadatos.forEach(metadato => {
        if (metadato.bbox && metadato.bbox.length === 4) {
            // Estructura [minx, miny, maxx, maxy] -> Leaflet usa [[lat_min, lon_min], [lat_max, lon_max]]
            const minx = metadato.bbox[0];
            const miny = metadato.bbox[1];
            const maxx = metadato.bbox[2];
            const maxy = metadato.bbox[3];

            const limitesBbox = [
                [miny, minx],
                [maxy, maxx]
            ];

            // Crear rectángulo geométrico sobre el mapa
            const rectangulo = L.rectangle(limitesBbox, {
                color: '#004d40',
                weight: 1.5,
                fillColor: '#0288d1',
                fillOpacity: 0.15
            });

            // Contenido emergente al hacer clic sobre el BBOX en el mapa
            rectangulo.bindPopup(`
                <div style="font-size:0.85rem;">
                    <strong>${metadato.titulo}</strong><br>
                    <small>${metadato.institucion}</small><br>
                    <a href="#${metadato.id}" style="color:#004d40; text-decoration:underline;">Ir a la tarjeta</a>
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

    // Desplazar suavemente la vista hacia el área del BBOX
    instanciaMapa.fitBounds(limites, { padding: [20, 20] });

    // Desplazar suavemente el scroll vertical hasta la sección del mapa
    const seccionMapa = document.querySelector('.seccion-mapa');
    if (seccionMapa) {
        seccionMapa.scrollIntoView({ behavior: 'smooth' });
    }
}