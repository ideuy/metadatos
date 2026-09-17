/**
 * Módulo de Búsqueda y Filtros (buscador.js)
 * Gestiona el filtrado interactivo multi-criterio en tiempo real del catálogo de metadatos.
 */

// Referencias a los elementos del DOM
let campoBusqueda;
let botonLimpiar;
let selectorInstitucion;
let contenedorEtiquetas;
let botonReset;
let checkboxesTipos;
let casillaFiltroEspacial;

// Copia local del catálogo completo para realizar filtrados
let catalogoBase = [];

/**
 * Inicializa los listeners de eventos y los controles de filtro.
 * @param {Array} datosCatalogo - Lista completa de metadatos obtenida desde el servidor.
 */
function inicializarBuscador(datosCatalogo) {
    catalogoBase = datosCatalogo;

    // Capturar elementos DOM
    campoBusqueda = document.getElementById('entrada-busqueda');
    botonLimpiar = document.getElementById('boton-limpiar-busqueda');
    selectorInstitucion = document.getElementById('selector-institucion');
    contenedorEtiquetas = document.getElementById('contenedor-etiquetas');
    botonReset = document.getElementById('boton-reset-filtros');
    checkboxesTipos = document.querySelectorAll('.filtro-tipo');
    casillaFiltroEspacial = document.getElementById('filtro-area-visible');

    // Poblar las opciones de los combos/pills basados en el contenido real del JSON
    poblarSelectorInstituciones();
    poblarEtiquetasTematicas();

    // Registrar Event Listeners
    if (campoBusqueda) {
        campoBusqueda.addEventListener('input', ejecutarFiltrosCombinados);
    }

    if (botonLimpiar) {
        botonLimpiar.addEventListener('click', () => {
            campoBusqueda.value = '';
            ejecutarFiltrosCombinados();
        });
    }

    if (selectorInstitucion) {
        selectorInstitucion.addEventListener('change', ejecutarFiltrosCombinados);
    }

    checkboxesTipos.forEach(checkbox => {
        checkbox.addEventListener('change', ejecutarFiltrosCombinados);
    });

    if (casillaFiltroEspacial) {
        casillaFiltroEspacial.addEventListener('change', ejecutarFiltrosCombinados);
    }

    if (botonReset) {
        botonReset.addEventListener('click', restablecerFiltros);
    }
}

/**
 * Extrae las instituciones únicas del catálogo y las agrega al selector.
 */
function poblarSelectorInstituciones() {
    if (!selectorInstitucion) return;

    const institucionesUnicas = [...new Set(catalogoBase.map(item => item.institucion))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'es'));

    // Limpiar opciones previas manteniendo la primera ("Todas")
    selectorInstitucion.innerHTML = '<option value="">Todas las instituciones</option>';

    institucionesUnicas.forEach(inst => {
        const opcion = document.createElement('option');
        opcion.value = inst;
        opcion.textContent = inst;
        selectorInstitucion.appendChild(opcion);
    });
}

/**
 * Extrae las palabras clave más frecuentes y genera pills interactivos.
 */
function poblarEtiquetasTematicas() {
    if (!contenedorEtiquetas) return;

    const conteoPalabrasClave = {};

    catalogoBase.forEach(item => {
        if (Array.isArray(item.palabras_clave)) {
            item.palabras_clave.forEach(kw => {
                const kwLimpia = kw.trim();
                if (kwLimpia.length > 2) {
                    conteoPalabrasClave[kwLimpia] = (conteoPalabrasClave[kwLimpia] || 0) + 1;
                }
            });
        }
    });

    // Ordenar por frecuencia de aparición y tomar las 12 más populares
    const palabrasTop = Object.entries(conteoPalabrasClave)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(entry => entry[0]);

    contenedorEtiquetas.innerHTML = '';

    palabrasTop.forEach(palabra => {
        const pill = document.createElement('button');
        pill.className = 'pill-etiqueta';
        pill.textContent = palabra;
        pill.dataset.palabra = palabra.toLowerCase();

        pill.addEventListener('click', () => {
            pill.classList.toggle('activa');
            ejecutarFiltrosCombinados();
        });

        contenedorEtiquetas.appendChild(pill);
    });
}

/**
 * Aplica simultáneamente todos los criterios de filtro (Texto,
 * Tipos de servicio, Institución, Temáticas y Extensión espacial visible en mapa).
 */
function ejecutarFiltrosCombinados() {
    const textoConsulta = campoBusqueda ? campoBusqueda.value.toLowerCase().trim() : '';
    const institucionSeleccionada = selectorInstitucion ? selectorInstitucion.value : '';

    // Obtener los tipos de servicios que están marcados en las casillas
    const tiposSeleccionados = Array.from(checkboxesTipos)
        .filter(chk => chk.checked)
        .map(chk => chk.value);

    // Obtener las palabras clave seleccionadas activamente en los pills
    const etiquetasActivas = Array.from(document.querySelectorAll('.pill-etiqueta.activa'))
        .map(pill => pill.dataset.palabra);

    // Estado del filtro espacial
    const filtrarPorEspacio = casillaFiltroEspacial && casillaFiltroEspacial.checked;

    // Filtrado de la lista base
    const resultadoFiltrado = catalogoBase.filter(metadato => {
        // 1. Filtro por Búsqueda Libre (Título, Resumen o Palabras Clave)
        const coincideTexto = !textoConsulta || 
            (metadato.titulo && metadato.titulo.toLowerCase().includes(textoConsulta)) ||
            (metadato.resumen && metadato.resumen.toLowerCase().includes(textoConsulta)) ||
            (Array.isArray(metadato.palabras_clave) && metadato.palabras_clave.some(kw => kw.toLowerCase().includes(textoConsulta)));

        // 2. Filtro por Institución
        const coincideInstitucion = !institucionSeleccionada || 
            metadato.institucion === institucionSeleccionada;

        // 3. Filtro por Tipos de Servicio
        const coincideTipoServicio = tiposSeleccionados.length === 0 || 
            (Array.isArray(metadato.tipos_servicio) && metadato.tipos_servicio.some(tipo => tiposSeleccionados.includes(tipo)));

        // 4. Filtro por Etiquetas Temáticas seleccionadas
        const coincideEtiquetas = etiquetasActivas.length === 0 || 
            (Array.isArray(metadato.palabras_clave) && etiquetasActivas.every(etiqueta => 
                metadato.palabras_clave.some(kw => kw.toLowerCase().includes(etiqueta))
            ));

        // 5. Filtro Espacial (área visible del mapa)
        let coincideEspacial = true;
        if (filtrarPorEspacio) {
            if (typeof intersecaAreaVisible === 'function') {
                coincideEspacial = intersecaAreaVisible(metadato.bbox);
            }
        }

        return coincideTexto && coincideInstitucion && coincideTipoServicio && coincideEtiquetas && coincideEspacial;
    });

    // Actualizar la grilla de tarjetas definida en app.js
    if (typeof renderizarTarjetas === 'function') {
        renderizarTarjetas(resultadoFiltrado);
    }

    // Sincronizar actualización con los rectángulos del mapa
    if (typeof actualizarCapasMapa === 'function') {
        actualizarCapasMapa(resultadoFiltrado);
    }
}

/**
 * Limpia todos los controles y vuelve el catálogo a su estado original.
 */
function restablecerFiltros() {
    if (campoBusqueda) campoBusqueda.value = '';
    if (selectorInstitucion) selectorInstitucion.value = '';
    if (casillaFiltroEspacial) casillaFiltroEspacial.checked = false;

    checkboxesTipos.forEach(chk => { chk.checked = true; });

    document.querySelectorAll('.pill-etiqueta.activa').forEach(pill => {
        pill.classList.remove('activa');
    });

    ejecutarFiltrosCombinados();
}
