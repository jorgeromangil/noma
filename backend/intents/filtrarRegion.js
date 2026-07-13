const Product = require('../models/products');
const ContextManager = require('../utils/contextManager');
const MensajesNaturales = require('../utils/mensajesNaturales');
const { normalizeNoAccents, coerceToText } = require('../utils/nlp');

const REGION_OPTIONS_PAGE_SIZE = 6;

// Función auxiliar para normalizar regiones
const normalizeRegion = (input) => {
    if (input === null || input === undefined) return '';
    const str = (typeof input === 'string') ? input : String(input);
    if (!str.trim()) return '';
    return normalizeNoAccents(str).replace(/\s+/g, ' '); // Normalizar espacios
};

// Dialogflow puede devolver parámetros como string, array u objeto (según integración/version)
const coerceDialogflowParamToText = (value) => {
    return coerceToText(value);
};

const toTitle = (value) => {
    const s = `${value || ''}`.trim();
    if (!s) return '';
    // Si es un código tipo ES-RI, lo dejamos tal cual (pero ya se intentó mapear antes)
    if (/^[A-Z]{2}-[A-Z0-9]{2,3}$/.test(s)) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
};

const looksLikePostalCode = (value) => {
    const s = `${value || ''}`.trim();
    return /^\d{4,5}$/.test(s);
};

// Comunidades autónomas españolas normalizadas para validación
const SPANISH_REGIONS = new Set([
    'andalucia', 'aragon', 'asturias', 'cantabria', 'castilla y leon',
    'castilla-la mancha', 'canarias', 'cataluna', 'extremadura', 'galicia',
    'islas baleares', 'murcia', 'madrid', 'navarra', 'pais vasco', 'la rioja',
    'comunidad valenciana', 'ceuta', 'melilla'
]);

const regionFromAddressText = (addressText) => {
    const raw = `${addressText || ''}`.trim();
    if (!raw) return '';

    const parts = raw
        .replace(/[.]+$/g, '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);

    const isCountry = (p) => {
        const n = normalizeRegion(p);
        return n === 'espana' || n === 'españa' || n === 'spain';
    };

    const hasLetters = (p) => /[a-zA-ZÁÉÍÓÚÜÑáéíóúüñ]/.test(p);
    const hasDigits = (p) => /\d/.test(p);

    const stripZip = (p) => `${p || ''}`.replace(/^\d{4,5}\s+/, '').trim();

    const isAutonomousCommunity = (p) => {
        const n = normalizeRegion(p);
        return SPANISH_REGIONS.has(n);
    };

    // Caso particular: queremos aceptar "Toledo" como región válida cuando el address incluya
    // "..., Toledo, Castilla-La Mancha, ..." (sin convertirlo siempre a la CCAA).
    for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (!p || isCountry(p)) continue;
        const cleaned = stripZip(p);
        if (!cleaned) continue;

        if (isAutonomousCommunity(cleaned) && i - 1 >= 0) {
            const comunidadNorm = normalizeRegion(cleaned);
            const prev = stripZip(parts[i - 1]);
            const prevNorm = normalizeRegion(prev);

            // Solo este caso especial (evita que "Haro" reemplace "La Rioja")
            if (comunidadNorm === 'castilla-la mancha' && prevNorm === 'toledo') {
                return prev;
            }
        }
    }

    // Preferimos un segmento "tipo región/provincia" sin números
    for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (!p || isCountry(p)) continue;
        if (hasLetters(p) && !hasDigits(p)) return p;
    }

    // Fallback: último segmento con letras (limpiando zip al inicio)
    for (let i = parts.length - 1; i >= 0; i--) {
        let p = parts[i];
        if (!p || isCountry(p)) continue;
        if (!hasLetters(p)) continue;
        p = stripZip(p);
        if (p) return p;
    }

    return '';
};

const regionLabelFromProduct = (product) => {
    // Primero intentamos obtener la ciudad directamente
    const city = `${product?.city || ''}`.trim();
    if (city) return toTitle(city);

    // Buscar en province
    const province = `${product?.province || ''}`.trim();
    if (province) return toTitle(province);

    // Buscar en autonomous_community
    const autonomousCommunity = `${product?.autonomous_community || ''}`.trim();
    if (autonomousCommunity) return toTitle(autonomousCommunity);

    // Fallback a address_text si no hay city
    const addressText = `${product?.address_text || ''}`.trim();
    const fromAddress = regionFromAddressText(addressText);
    if (fromAddress) return toTitle(fromAddress);

    // Último recurso (si hay region_code legacy)
    const code = `${product?.region_code || ''}`.trim();
    if (code && /^[A-Z]{2}-[A-Z0-9]{2,3}$/i.test(code)) {
        return toTitle(code);
    }

    if (code && !looksLikePostalCode(code)) {
        if (!/^\d+$/.test(code)) return toTitle(code);
    }

    return '';
};

const getLocationCandidatesFromProduct = (product) => {
    const city = `${product?.city || ''}`.trim();
    const province = `${product?.province || ''}`.trim();
    const autonomousCommunity = `${product?.autonomous_community || ''}`.trim();
    const addressText = `${product?.address_text || ''}`.trim();
    const regionFromAddress = regionFromAddressText(addressText);

    const addressParts = addressText ?
        addressText
        .replace(/[.]+$/g, '')
        .split(',')
        .map((p) => `${p || ''}`.replace(/^\d{4,5}\s+/, '').trim())
        .filter(Boolean) : [];

    const allCandidates = [
        city,
        province,
        autonomousCommunity,
        regionFromAddress,
        addressText,
        ...addressParts
    ].filter(Boolean);

    const seen = new Set();
    return allCandidates.filter((candidate) => {
        const key = normalizeRegion(candidate);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const matchesLocationTerm = (product, term) => {
    const target = normalizeRegion(term);
    if (!target) return false;

    const candidates = getLocationCandidatesFromProduct(product);
    return candidates.some((candidate) => {
        const candidateNorm = normalizeRegion(candidate);
        if (!candidateNorm) return false;
        return candidateNorm.includes(target) || target.includes(candidateNorm);
    });
};

const matchesProvinceTerm = (product, term) => {
    const target = normalizeRegion(term);
    const province = normalizeRegion(product?.province || '');
    if (!target || !province) return false;

    return province === target || province.includes(target) || target.includes(province);
};

const filterProductsByProvinceFirst = (products, term) => {
    const items = Array.isArray(products) ? products : [];
    const provinceMatches = items.filter((p) => matchesProvinceTerm(p, term));
    if (provinceMatches.length > 0) return provinceMatches;

    // Fallback amplio para comunidades/municipios cuando no hay match por provincia.
    return items.filter((p) => matchesLocationTerm(p, term));
};

module.exports = async(req, res) => {
    try {
        const ctx = new ContextManager(req);
        const buscarProductos = require('./buscarProductos');


        // Obtener región del parámetro actual (puede venir como string/array/objeto)
        const regionRaw =
            (ctx.parameters && (ctx.parameters.region ?? ctx.parameters['region.original'])) ??
            null;
        const regionText = coerceDialogflowParamToText(regionRaw);
        let regionParam = regionText ? regionText.toLowerCase() : null;

        // Si el usuario usa chips/comandos de navegación sin ubicación concreta,
        // no debemos tratarlos como nombre literal de provincia.
        const rawQueryText = (req.body?.queryResult?.queryText || '').toString().trim();
        const qNorm = normalizeRegion(rawQueryText);
        const categoryHintRx = /\b(alimentacion|textil|barro|alfareria|ceramica|madera|mueble|otros)\b/i;

        // Defensa: si Dialogflow aterriza aquí con una pregunta de catálogo
        // (ej: "¿qué productos de cerámica tienes?"), reenrutamos a FP-1.
        const productQuestionMatch = qNorm.match(/^(?:que\s+)?productos?\s+de\s+(.+?)\s+(?:tienes|hay)$/i);
        if (productQuestionMatch?.[1]) {
            const inferredProduct = productQuestionMatch[1].trim();
            if (inferredProduct) {
                req.body.queryResult.parameters = {
                    ...(req.body.queryResult.parameters || {}),
                    product: inferredProduct
                };
                return buscarProductos(req, res);
            }
        }
        const isLocationNavigationCommand = /^(filtrar\s+por\s+ciudad|filtrar\s+por\s+provincia|otra\s+ciudad|otra\s+provincia|buscar\s+otra\s+ciudad|buscar\s+otra\s+provincia|buscar\s+por\s+ciudad|buscar\s+por\s+provincia|cambiar\s+provincia)$/.test(qNorm);

        if (isLocationNavigationCommand) {
            regionParam = null;
        }

        // Si el usuario viene de chips (p.ej. hace click en "Jaén"), Dialogflow a veces
        // interpreta eso como una comunidad autónoma (p.ej. "Andalucía"). En este proyecto
        // queremos filtrar EXACTAMENTE por lo que se ve en las tarjetas, así que priorizamos
        // el queryText cuando parece una selección directa (no una frase tipo "productos de ...").
        const isQuestionLikePlace = qNorm.startsWith('que hay en ');
        const looksLikeDirectSelection =
            rawQueryText &&
            !qNorm.includes('producto') &&
            !qNorm.includes('productos') &&
            !qNorm.includes('filtrar') &&
            !qNorm.includes('region') &&
            !isQuestionLikePlace &&
            !isLocationNavigationCommand;

        const esperandoRegion = !!ctx.getParam('buscando-productos', 'esperando_region');
        if (looksLikeDirectSelection && (esperandoRegion || regionParam)) {
            // Si hay discrepancia, usamos el texto del chip tal cual.
            const regionParamNorm = normalizeRegion(regionParam || '');
            if (qNorm && qNorm !== regionParamNorm) {
                regionParam = rawQueryText.toLowerCase();
            }
        }

        // Palabras que NO son ciudades válidas (comando o ayuda)
        const invalidRegionKeywords = new Set([
            'regiones', 'region', 'ciudades', 'ciudad', 'que ciudades', 'que regiones',
            'lista', 'listado', 'ayuda', 'help', 'cuales', 'cuál', 'cuales son'
        ]);

        // Si el regionParam final es una palabra inválida, ignorarlo
        if (regionParam && invalidRegionKeywords.has(normalizeRegion(regionParam).trim())) {
            regionParam = null;
        }

        // Defensa adicional: si `region` trae texto de categoría/pregunta (ej: "ceramica tienes"),
        // no debe aplicarse como provincia y se reinterpreta como búsqueda de producto.
        if (regionParam) {
            const normalizedRegionCandidate = normalizeRegion(regionParam);
            const trimmedCandidate = normalizedRegionCandidate
                .replace(/\b(tienes|hay)\b.*$/i, '')
                .trim();

            const looksLikeQuestionResidue = /\b(tienes|hay)\b/i.test(normalizedRegionCandidate);
            if (trimmedCandidate && looksLikeQuestionResidue && categoryHintRx.test(trimmedCandidate)) {
                req.body.queryResult.parameters = {
                    ...(req.body.queryResult.parameters || {}),
                    product: trimmedCandidate
                };
                return buscarProductos(req, res);
            }
        }

        const regionDisplay = regionParam ? toTitle(regionParam) : null;

        // Obtener producto y categoría del contexto
        let producto = ctx.getParam('buscando-productos', 'producto');
        let categoria = ctx.getParam('buscando-productos', 'categoria');


        // ✅ CASO ESPECIAL: "Otros productos de <región>" debe ignorar el filtro por producto
        const queryText = (req.body?.queryResult?.queryText || '').toString().toLowerCase();
        const isOtrosProductos = queryText.includes('otros productos');
        if (isOtrosProductos) {
            // Si Dialogflow no extrajo región como parámetro, la intentamos parsear del texto
            if (!regionParam) {
                const match = queryText.match(/otros\s+productos\s+de\s+(.+)$/i);
                if (match && match[1]) {
                    regionParam = match[1].trim();
                }
            }

            if (!regionParam) {
                return res.json({
                    fulfillmentText: '¿De qué provincia quieres ver otros productos?',
                    fulfillmentMessages: [
                        { text: { text: ['¿De qué provincia quieres ver otros productos?'] } },
                        {
                            payload: {
                                richContent: [
                                    [{
                                        type: 'chips',
                                        options: [
                                            { text: 'La Rioja' },
                                            { text: 'Madrid' },
                                            { text: 'Cataluña' },
                                            { text: 'Andalucía' }
                                        ]
                                    }]
                                ]
                            }
                        }
                    ]
                });
            }

            const regionNormalizada = normalizeRegion(regionParam);
            const findFilter = { active: { $ne: false } };
            
            if (categoria) {
                findFilter.category = categoria;
            }
            
            const todosProductos = await Product.find(findFilter);
            const matched = filterProductsByProvinceFirst(todosProductos, regionNormalizada);

            const total = matched.length;
            const productos = matched.slice(0, 5);

            if (!productos.length) {
                return res.json({
                    fulfillmentText: `No encontré productos en ${regionDisplay || regionParam}. ¿Quieres probar con otra provincia?`,
                    fulfillmentMessages: [
                        { text: { text: [`No encontré productos en ${regionParam}.`] } },
                        {
                            payload: {
                                richContent: [
                                    [{
                                        type: 'chips',
                                        options: [
                                            { text: 'Madrid' },
                                            { text: 'Barcelona' },
                                            { text: 'Valencia' },
                                            { text: 'Ver productos populares' }
                                        ]
                                    }]
                                ]
                            }
                        }
                    ]
                });
            }

            const fulfillmentText = `Aquí tienes ${productos.length} productos de ${regionParam}:`;
            const richContent = productos.slice(0, 8).map(p => ({
                type: 'info',
                title: p.name,
                subtitle: `${regionLabelFromProduct(p) || 'España'}${p.certificaciones_protecciones ? '• ' + p.certificaciones_protecciones : ''}`,
                image: p.media && p.media.length > 0 ? { src: { rawUrl: p.media[0] } } : undefined,
                actionLink: `https://noma.com/producto/${p.slug}`
            }));

            const chips = {
                type: 'chips',
                options: [
                    { text: 'Ver más' },
                    { text: 'Filtrar por categoría' },
                    { text: 'Quiero vino' },
                    { text: 'Buscar artesanos' }
                ]
            };

            // Importante: limpiamos producto en contexto para que "ver más" siga mostrando mezcla por región
            return res.json({
                fulfillmentText,
                fulfillmentMessages: [
                    { text: { text: [fulfillmentText] } },
                    {
                        payload: {
                            richContent: [
                                [...richContent, chips]
                            ]
                        }
                    }
                ],
                outputContexts: [
                    ctx.updateContext('buscando-productos', {
                        producto: '',
                        tipo_producto: '',
                        region: regionParam,
                        ultima_busqueda: 'otros-productos-region',
                        offset: productos.length,
                        total,
                        resultados_count: total
                    }, 10)
                ]
            });
        }

        // ⚠️ CASO 1: Usuario dijo "filtrar por ciudad/provincia" pero NO especificó cuál
        if (!regionParam) {
            const qNormNoRegion = normalizeRegion(rawQueryText);
            const isPaginationRequest = /^(ver mas regiones|mas regiones|ver mas)$/.test(qNormNoRegion);

            let regiones = [];
            let regionsMode = 'all';

            if (producto) {
                regionsMode = 'producto';

                const byProvince = await Product.distinct('province', {
                    name: new RegExp(producto, 'i'),
                    province: { $exists: true, $ne: '' }
                });

                if (byProvince.length) {
                    regiones = byProvince
                        .map((r) => `${r || ''}`.trim())
                        .filter(Boolean)
                        .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
                } else {
                    const productosConRegion = await Product.find({ name: new RegExp(producto, 'i'), active: { $ne: false } }, { city: 1, province: 1, autonomous_community: 1, address_text: 1, region_code: 1 }).lean();
                    const seen = new Set();
                    regiones = productosConRegion
                        .map((p) => regionLabelFromProduct(p))
                        .filter(Boolean)
                        .filter((r) => {
                            const key = normalizeRegion(r);
                            if (seen.has(key)) return false;
                            seen.add(key);
                            return true;
                        })
                        .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
                }
            }

            if (!regiones.length) {
                const byProvince = await Product.distinct('province', { province: { $exists: true, $ne: '' } });
                regiones = byProvince
                    .map((r) => `${r || ''}`.trim())
                    .filter(Boolean)
                    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

                if (!regiones.length) {
                    const productos = await Product.find({ active: { $ne: false } }, { city: 1, province: 1, autonomous_community: 1, address_text: 1, region_code: 1 }).lean();
                    const seen = new Set();
                    regiones = productos
                        .map((p) => regionLabelFromProduct(p))
                        .filter(Boolean)
                        .filter((r) => {
                            const key = normalizeRegion(r);
                            if (seen.has(key)) return false;
                            seen.add(key);
                            return true;
                        })
                        .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
                }

                regionsMode = 'all';
            }

            let offset = 0;
            if (isPaginationRequest) {
                const prevMode = normalizeRegion(ctx.getParam('explorando-regiones', 'mode'));
                const prevProduct = normalizeRegion(ctx.getParam('explorando-regiones', 'producto'));
                const currentProduct = normalizeRegion(producto || '');
                const sameMode = prevMode === normalizeRegion(regionsMode);
                const sameProduct = regionsMode !== 'producto' || prevProduct === currentProduct;
                if (sameMode && sameProduct) {
                    const storedOffset = Number(ctx.getParam('explorando-regiones', 'offset'));
                    if (Number.isFinite(storedOffset) && storedOffset > 0) {
                        offset = Math.floor(storedOffset);
                    }
                }
            }

            const page = regiones.slice(offset, offset + REGION_OPTIONS_PAGE_SIZE);
            const nextOffset = offset + page.length;
            const hasMore = nextOffset < regiones.length;

            let regionesDisponibles = page.map((r) => ({ text: toTitle(r) }));
            if (hasMore) regionesDisponibles.push({ text: 'Ver más provincias' });

            if (regionesDisponibles.length === 0) {
                regionesDisponibles = [
                    { text: 'Ver productos' },
                    { text: 'Ver productos populares' }
                ];
            }

            const mensaje = isPaginationRequest && page.length
                ? (producto ? `Aquí tienes más provincias para ${producto}:` : 'Aquí tienes más provincias disponibles:')
                : (producto ? `¿En qué provincia quieres ver ${producto}?` : '¿De qué provincia quieres ver los productos?');

            return res.json({
                fulfillmentText: mensaje,
                fulfillmentMessages: [
                    { text: { text: [mensaje] } },
                    {
                        payload: {
                            richContent: [
                                [{
                                    type: "chips",
                                    options: regionesDisponibles
                                }]
                            ]
                        }
                    }
                ],
                outputContexts: [
                    ctx.updateContext('buscando-productos', {
                        producto: producto || '',
                        categoria: categoria || '',
                        esperando_region: true
                    }, 10),
                    ctx.updateContext('explorando-regiones', {
                        mode: regionsMode,
                        producto: producto || '',
                        offset: nextOffset,
                        total: regiones.length
                    }, 10)
                ]
            });
        }

        // ✅ CASO 2: Tiene ciudad especificada, buscar productos

        const regionNormalizada = normalizeRegion(regionParam);

        if (!producto) {
            // Si no hay producto en el contexto, buscar todos los productos de esa región (y categoría si está presente)
            const findFilter = { active: { $ne: false } };
            
            if (categoria) {
                findFilter.category = categoria;
            }
            
            const todosProductos = await Product.find(findFilter);

            const matched = filterProductsByProvinceFirst(todosProductos, regionNormalizada);

            let productos = matched.slice(0, 5);
            let total = matched.length;

            if (!productos.length) {
                return res.json({
                    fulfillmentText: `No encontré productos en ${regionDisplay || regionParam}. ¿Quieres probar con otra provincia?`,
                    fulfillmentMessages: [
                        { text: { text: [`No encontré productos en ${regionParam}.`] } },
                        {
                            payload: {
                                richContent: [
                                    [{
                                        type: "chips",
                                        options: [
                                            { text: "Madrid" },
                                            { text: "Barcelona" },
                                            { text: "Valencia" },
                                            { text: "Ver productos populares" }
                                        ]
                                    }]
                                ]
                            }
                        }
                    ]
                });
            }

            const fulfillmentText = `Encontré ${productos.length} ${productos.length === 1 ? 'producto' : 'productos'} en ${regionDisplay || regionParam}`;

            const richContent = productos.slice(0, 5).map(p => ({
                type: "info",
                title: p.name,
                subtitle: `${regionLabelFromProduct(p) || ''} ${p.certificaciones_protecciones ? '• ' + p.certificaciones_protecciones : ''}`.trim(),
                image: p.media && p.media.length > 0 ? { src: { rawUrl: p.media[0] } } : undefined,
                actionLink: `https://noma.com/producto/${p.slug}`
            }));

            const chipsOptions = [];
            if (total > productos.length) chipsOptions.push({ text: "Ver más productos" });
            chipsOptions.push({ text: "Filtrar por categoría" });
            chipsOptions.push({ text: "Otra provincia" });
            chipsOptions.push({ text: `Artesanos en ${regionDisplay || toTitle(regionParam)}` });
            chipsOptions.push({ text: "Ver todas las provincias" });

            const chips = {
                type: "chips",
                options: chipsOptions
            };

            return res.json({
                fulfillmentText: fulfillmentText,
                fulfillmentMessages: [
                    { text: { text: [fulfillmentText] } },
                    {
                        payload: {
                            richContent: [
                                [...richContent, chips]
                            ]
                        }
                    }
                ],
                outputContexts: [
                    ctx.updateContext('buscando-productos', {
                        producto: producto || '',
                        region: regionParam,
                        categoria: categoria || '',
                        ultima_busqueda: 'region',
                        offset: productos.length,
                        total,
                        resultados_count: total
                    }, 10)
                ]
            });
        }

        // Tiene producto Y región - filtrar por ambos (y categoría si está presente)
        const productFilter = {
            name: new RegExp(producto, 'i'),
            active: { $ne: false }
        };
        
        if (categoria) {
            productFilter.category = categoria;
        }
        
        const todosProductos = await Product.find(productFilter);

        const productos = filterProductsByProvinceFirst(todosProductos, regionNormalizada)
            .slice(0, 10);

        if (!productos.length) {
            return res.json({
                fulfillmentText: `No encontré ${producto} en ${regionParam}. ¿Quieres ver ${producto} de otra provincia?`,
                fulfillmentMessages: [
                    { text: { text: [`No encontré ${producto} en ${regionParam}.`] } },
                    {
                        payload: {
                            richContent: [
                                [{
                                    type: "chips",
                                    options: [
                                        { text: "Madrid" },
                                        { text: "Barcelona" },
                                        { text: "Ver productos populares" }
                                    ]
                                }]
                            ]
                        }
                    }
                ],
                outputContexts: [
                    ctx.updateContext('buscando-productos', {
                        producto: producto,
                        region: regionParam,
                        categoria: categoria || '',
                        ultima_busqueda: 'region'
                    }, 10)
                ]
            });
        }

        // Mensaje natural variado
        const fulfillmentText = MensajesNaturales.cambioRegion(producto, regionParam);

        // Rich Content
        const richContent = productos.slice(0, 5).map(p => ({
            type: "info",
            title: p.name,
            subtitle: `${regionLabelFromProduct(p) || ''} ${p.certificaciones_protecciones ? '• ' + p.certificaciones_protecciones : ''}`.trim(),
            image: p.media && p.media.length > 0 ? { src: { rawUrl: p.media[0] } } : undefined,
            actionLink: `https://noma.com/producto/${p.slug}`
        }));

        // Chips sugeridos
        const chips = {
            type: "chips",
            options: [
                { text: "Ver más" },
                { text: "Filtrar por categoría" },
                { text: "Cambiar de producto" },
                { text: "Conocer artesanos" }
            ]
        };

        // Actualizar contexto
        const outputContexts = [
            ctx.updateContext('buscando-productos', {
                producto: producto,
                region: regionParam,
                categoria: categoria || '',
                tipo_producto: producto,
                ultima_busqueda: 'region',
                resultados_count: productos.length
            }, 10)
        ];

        return res.json({
            fulfillmentText: fulfillmentText,
            fulfillmentMessages: [
                { text: { text: [fulfillmentText] } },
                {
                    payload: {
                        richContent: [
                            [...richContent, chips]
                        ]
                    }
                }
            ],
            outputContexts: outputContexts
        });

    } catch (error) {
        console.error("Error en filtrarRegion:", error);
        return res.json({
            fulfillmentText: "Hubo un error buscando productos. Por favor, intenta de nuevo."
        });
    }
};