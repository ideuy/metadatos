/**
 * Módulo Principal de la Aplicación (app.js)
 * Carga de datos del catálogo y renderizado de la grilla de tarjetas.
 */

// Ruta relativa al catálogo de datos estático
const RUTA_DATOS_CATALOGO = 'datos/catalogo.json';

// Estado global de los datos
let catalogoCompleto = [];
let catalogoFiltrado = [];

/**
 * Carga el archivo JSON con los metadatos e inicializa el renderizado.
 */
async function cargarCatalogo() {
    const contenedorTarjetas = document.getElementById('contenedor-tarjetas');
    const contadorResultados = document.getElementById('contador-resultados');

    try {
        const respuesta = await fetch(RUTA_DATOS_CATALOGO);
        
        if (!respuesta.ok) {
            throw new Error(`Error HTTP: ${respuesta.status}`);
        }

        catalogoCompleto = await respuesta.json();
        catalogoFiltrado = [...catalogoCompleto];

        // Inicializar componentes auxiliares si están disponibles
        if (typeof inicializarBuscador === 'function') {
            inicializarBuscador(catalogoCompleto);
        }

        if (typeof inicializarMapa === 'function') {
            inicializarMapa(catalogoCompleto);
        }

        // Renderizar la grilla inicial
        renderizarTarjetas(catalogoFiltrado);

    } catch (error) {
        console.error('Error al cargar el catálogo de metadatos:', error);
        if (contenedorTarjetas) {
            contenedorTarjetas.innerHTML = `
                <div class="mensaje-error">
                    <p>No se pudo cargar el catálogo de datos. Asegúrate de haber ejecutado previamente <code>procesar_catalogo.py</code>.</p>
                </div>
            `;
        }
        if (contadorResultados) {
            contadorResultados.textContent = 'Error al cargar los datos';
        }
    }
}

/**
 * Asigna la clase de estilo adecuada a cada badge según el tipo de servicio.
 */
function obtenerClaseBadge(tipoServicio) {
    switch (tipoServicio) {
        case 'WMS':
            return 'badge-wms';
        case 'WFS':
            return 'badge-wfs';
        case 'WMTS':
            return 'badge-wmts';
        case 'Descarga Directa':
            return 'badge-descarga';
        default:
            return 'badge-otros';
    }
}

/**
 * Genera el HTML de una tarjeta individual a partir de un metadato.
 */
function crearHtmlTarjeta(metadato) {
    const badgesServicio = metadato.tipos_servicio.map(tipo => 
        `<span class="badge-servicio ${obtenerClaseBadge(tipo)}">${tipo}</span>`
    ).join('');

    const enlaceDistribucion = metadato.distribuciones && metadato.distribuciones.length > 0 
        ? metadato.distribuciones[0].url 
        : '#';

    return `
        <article class="tarjeta-metadato" id="${metadato.id}">
            <div class="encabezado-tarjeta">
                <h3 class="titulo-tarjeta">${metadato.titulo}</h3>
                <span class="insitucion-tarjeta">${metadato.institucion}</span>
            </div>

            <div class="etiquetas-servicio">
                ${badgesServicio}
            </div>

            <p class="resumen-tarjeta" id="resumen-${metadato.id}">
                ${metadato.resumen}
            </p>

            <div class="acciones-tarjeta">
                <button class="boton-accion" onclick="alternarVisibilidadResumen('${metadato.id}')">
                    Ver más
                </button>
                <button class="boton-accion" onclick="copiarUrlServicio('${enlaceDistribucion}')">
                    Copiar Enlace
                </button>
                ${metadato.bbox ? `
                    <button class="boton-accion" onclick="enfocarEnMapa(${JSON.stringify(metadato.bbox)})">
                        Ver En Mapa
                    </button>
                ` : ''}
            </div>
        </article>
    `;
}

/**
 * Dibuja las tarjetas correspondientes en el contenedor del DOM.
 */
function renderizarTarjetas(listaMetadatos) {
    const contenedorTarjetas = document.getElementById('contenedor-tarjetas');
    const contadorResultados = document.getElementById('contador-resultados');

    if (!contenedorTarjetas) return;

    if (contadorResultados) {
        contadorResultados.textContent = `Mostrando ${listaMetadatos.length} metadato(s)`;
    }

    if (listaMetadatos.length === 0) {
        contenedorTarjetas.innerHTML = `
            <div class="sin-resultados">
                <p>No se encontraron recursos geográficos que coincidan con los filtros aplicados.</p>
            </div>
        `;
        return;
    }

    contenedorTarjetas.innerHTML = listaMetadatos.map(crearHtmlTarjeta).join('');
}

/**
 * Expande o colapsa la descripción completa dentro de una tarjeta.
 */
function alternarVisibilidadResumen(idMetadato) {
    const elementoResumen = document.getElementById(`resumen-${idMetadato}`);
    if (elementoResumen) {
        elementoResumen.classList.toggle('desplegado');
    }
}

/**
 * Copia la URL del servicio/recurso al portapapeles del usuario.
 */
function copiarUrlServicio(url) {
    if (!url || url === '#') {
        alert('Este recurso no posee un enlace directo disponible.');
        return;
    }

    navigator.clipboard.writeText(url)
        .then(() => {
            alert('Enlace copiado al portapapeles.');
        })
        .catch(err => {
            console.error('Error al copiar el enlace:', err);
        });
}

// Inicialización automática cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', cargarCatalogo);