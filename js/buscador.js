/**
 * Módulo de Búsqueda y Filtros (buscador.js)
 * Gestiona el filtrado interactivo en tiempo real del catálogo de metadatos.
 */

// Referencias a los elementos del DOM
let campoBusqueda;
let botonLimpiar;
let selectorInstitucion;
let contenedorEtiquetas;
let botonReset;
let checkboxesTipos;

// Copia local del catálogo completo para realizar filtrados
let catalogoBase = [];

/**
 * Inicializa los listeners de eventos y la carga de los controles dinámicos de filtro.
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

    if (botonReset) {
        botonReset.addEventListener('click', restablecerFiltros);
    }
}

/**
 * Extrae las instituciones únicas del catálogo y las agrega al `<select>`.
 */
function poblarSelectorInstituciones() {
    if (!selectorInstitucion) return;

    const institucionesUnicas = [...new Set(catalogoBase.map(item => item.institucion))]
        .filter(Boolean)
        .sort();

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
 * Aplica simultáneamente todos los criterios de filtro (Búsqueda textual,
 * Checkboxes de tipo de servicio, Combobox de institución y Etiquetas seleccionadas).
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

    // Filtrado de la lista base
    const resultadoFiltrado = catalogoBase.filter(metadato => {
        // 1. Filtro por Búsqueda Libre (Título, Resumen o Palabras Clave)
        const coincideTexto = !textoConsulta || 
            metadato.titulo.toLowerCase().includes(textoConsulta) ||
            metadato.resumen.toLowerCase().includes(textoConsulta) ||
            metadato.palabras_clave.some(kw => kw.toLowerCase().includes(textoConsulta));

        // 2. Filtro por Institución
        const coincideInstitucion = !institucionSeleccionada || 
            metadato.institucion === institucionSeleccionada;

        // 3. Filtro por Tipos de Servicio (al menos una coincidencia)
        const coincideTipoServicio = tiposSeleccionados.length === 0 || 
            metadato.tipos_servicio.some(tipo => tiposSeleccionados.includes(tipo));

        // 4. Filtro por Etiquetas Temáticas seleccionadas
        const coincideEtiquetas = etiquetasActivas.length === 0 || 
            etiquetasActivas.every(etiqueta => 
                metadato.palabras_clave.some(kw => kw.toLowerCase().includes(etiqueta))
            );

        return coincideTexto && coincideInstitucion && coincideTipoServicio && coincideEtiquetas;
    });

    // Actualizar la grilla de tarjetas definida en app.js
    if (typeof renderizarTarjetas === 'function') {
        renderizarTarjetas(resultadoFiltrado);
    }

    // Sincronizar actualización con el mapa si está inicializado
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

    checkboxesTipos.forEach(chk => { chk.checked = true; });

    document.querySelectorAll('.pill-etiqueta.activa').forEach(pill => {
        pill.classList.remove('activa');
    });

    ejecutarFiltrosCombinados();
}