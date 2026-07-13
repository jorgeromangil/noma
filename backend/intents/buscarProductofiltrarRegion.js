const Product = require('../models/products');
const ContextManager = require('../utils/contextManager');
const { pluralize, toTitle, toSpanishTitleCase } = require('../utils/linguistica');
const {
    normalizeNoAccents,
    cleanConversationalPrefix,
    coerceToText,
    stripTrailingPunctuation
} = require('../utils/nlp');

const escapeRegExp = (value) => `${value ?? ''}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Regex tolerante a: acentos, espacios/guiones/guion_bajo y comas/puntos del address_text
// Ej: "la rioja" matchea "Logroño, La Rioja, España".
const buildLooseSpanishRegex = (value) => {
    const base = `${value ?? ''}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();

    if (!base) return '';

    const mapChar = (ch) => {
        switch (ch) {
            case 'a':
                return '[aáàäâ]';
            case 'e':
                return '[eéèëê]';
            case 'i':
                return '[iíìïî]';
            case 'o':
                return '[oóòöô]';
            case 'u':
                return '[uúùüû]';
            case 'n':
                return '[nñ]';
            case ' ':
                return '[\\s,._-]*';
            case '-':
            case '_':
            case ',':
            case '.':
                return '[\\s,._-]*';
            default:
                return escapeRegExp(ch);
        }
    };

    let pattern = '';
    for (const ch of base) pattern += mapChar(ch);
    return pattern;
};

const toNormalizedString = (value) => {
    const text = coerceToText(value);
    return text ? text.toLowerCase().trim() : null;
};

const PRODUCT_ATTRIBUTE_KEYWORDS = new Set([
    'oveja', 'cabra', 'vaca', 'bufala', 'búfala', 'trufa', 'ecologico', 'ecológico', 'artesanal'
]);

const cleanProductPrefix = (value) => {
    const raw = cleanConversationalPrefix(`${value || ''}`.trim());
    if (!raw) return '';

    return raw
        .replace(/^(quiero|busco|buscar|dame|muestrame|mu[eé]strame|ensename|ens[eé][ñn]ame|ver|mostrar|encontrar)\s+/i, '')
        .replace(/^productos?\s+de\s+/i, '')
        .trim();
};

const isLikelyProductAttribute = (value) => {
    const v = normalizeNoAccents(value);
    if (!v) return false;

    if (PRODUCT_ATTRIBUTE_KEYWORDS.has(v)) return true;

    const tokens = v.split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || tokens.length > 3) return false;

    return tokens.some((t) => PRODUCT_ATTRIBUTE_KEYWORDS.has(t));
};

const inferAttributeFromRawQuery = (rawQueryText, productValue, regionValue) => {
    const cleaned = normalizeNoAccents(cleanProductPrefix(stripTrailingPunctuation(rawQueryText)));
    const product = normalizeNoAccents(productValue);
    const region = normalizeNoAccents(regionValue);

    if (!cleaned || !product) return null;

    let base = cleaned;
    if (region) {
        base = base.replace(new RegExp(`\\s+(?:de|en)\\s+${escapeRegExp(region)}$`, 'i'), '').trim();
    }

    if (!base || base === product) return null;

    if (base.startsWith(`${product} de `)) {
        const rest = base.slice((`${product} de `).length).trim();
        return rest || null;
    }

    if (base.startsWith(`${product} en `)) {
        const rest = base.slice((`${product} en `).length).trim();
        return rest || null;
    }

    if (base.startsWith(`${product} `)) {
        const rest = base.slice((`${product} `).length).trim();
        return rest || null;
    }

    return null;
};

const isLikelyLocationTerm = async (term) => {
    const raw = `${term || ''}`.trim();
    if (!raw) return false;

    const loose = buildLooseSpanishRegex(raw);
    const rx = new RegExp(loose || escapeRegExp(raw), 'i');

    const hits = await Product.countDocuments({
        active: { $ne: false },
        $or: [
            { city: rx },
            { province: rx },
            { autonomous_community: rx },
            { address_text: rx }
        ]
    });

    return hits > 0;
};

const buildSearchRegex = (term, { wholeWord = false } = {}) => {
    const loose = buildLooseSpanishRegex(term);
    const basePattern = loose || escapeRegExp(term);

    if (!wholeWord) {
        return new RegExp(basePattern, 'i');
    }

    // Evita falsos positivos por subcadenas: "curado" NO debe matchear "semicurado".
    const boundedPattern = `(^|[^a-zA-ZÁÉÍÓÚÜÑáéíóúüñ])(?:${basePattern})(?=$|[^a-zA-ZÁÉÍÓÚÜÑáéíóúüñ])`;
    return new RegExp(boundedPattern, 'i');
};

const buildProductTextClause = (term, { wholeWord = false } = {}) => {
    const rx = buildSearchRegex(term, { wholeWord });
    return {
        $or: [
            { name: rx },
            { description: rx },
            { historia_origen: rx },
            { importancia_cultural: rx },
            { proceso_elaboracion: rx },
            { materias_primas: rx },
            { tiempo_elaboracion: rx },
            { certificaciones_protecciones: rx }
        ]
    };
};

const buildMainProductClause = (term) => {
    // Para el producto principal usamos campos "fuertes" para evitar casos
    // como turrón matcheando por mencionar "aceite" en texto secundario.
    const normalized = normalizeNoAccents(term);
    const variants = new Set([normalized]);
    if (normalized.endsWith('s') && normalized.length > 3) {
        variants.add(normalized.slice(0, -1));
    } else if (!normalized.endsWith('s') && normalized.length > 2) {
        variants.add(`${normalized}s`);
    }

    const regexes = Array.from(variants)
        .filter(Boolean)
        .map((v) => buildSearchRegex(v, { wholeWord: true }));

    return {
        $or: [
            ...regexes.map((rx) => ({ name: rx })),
            ...regexes.map((rx) => ({ resumen: rx }))
        ]
    };
};

const buildLocationClause = (term) => {
    const loose = buildLooseSpanishRegex(term);
    const rx = new RegExp(loose || escapeRegExp(term), 'i');

    return {
        $or: [
            { city: rx }, // compatibilidad legacy
            { province: rx },
            { autonomous_community: rx },
            { address_text: rx }
        ]
    };
};

const parseProductAndRegionFromQueryText = (queryText) => {
    const raw = `${queryText || ''}`.trim();
    if (!raw) return { producto: null, region: null, atributo: null };

    // Ej: "aceite de jaen", "vino en la rioja"
    const match = raw.match(/^(.+?)\s+(?:de|en)\s+(.+)$/i);
    if (!match) return { producto: null, region: null, atributo: null };

    const producto = cleanProductPrefix((match[1] || '').replace(/[?.!,;:]+$/g, '').trim());
    const region = (match[2] || '').replace(/[?.!,;:]+$/g, '').trim();

    const bad = new Set(['de', 'en', 'del', 'la', 'el', 'los', 'las', 'un', 'una']);
    if (!producto || bad.has(producto.toLowerCase())) return { producto: null, region, atributo: null };
    if (!region) return { producto, region: null, atributo: null };

    // Caso NLP clave: "queso de oveja" o "queso en oveja" => oveja es atributo, no ciudad.
    if (isLikelyProductAttribute(region)) {
        return { producto, region: null, atributo: region };
    }

    return { producto, region, atributo: null };
};

module.exports = async(req, res) => {
    try {
        const ctx = new ContextManager(req);

        const rawQueryText = (req.body?.queryResult?.queryText || '').toString();
        const normalizedRawQuery = rawQueryText
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[?.!,;:]+$/g, '')
            .trim();

        // Defensa: si Dialogflow clasifica mal "Cambiar de producto" como intent mixto,
        // no debemos buscar ese texto como producto.
        const isChangeProductCommand = /^(cambiar\s+(de\s+)?productos?|buscar\s+otro\s+producto|otro\s+producto)$/.test(normalizedRawQuery);
        if (isChangeProductCommand) {
            const txt = '¿Qué producto quieres buscar ahora?';
            return res.json({
                fulfillmentText: txt,
                fulfillmentMessages: [
                    { text: { text: [txt] } },
                    {
                        payload: {
                            richContent: [[
                                {
                                    type: 'chips',
                                    options: [
                                        { text: 'Quiero vino' },
                                        { text: 'Quiero queso' },
                                        { text: 'Quiero aceite' },
                                        { text: 'Ver productos populares' }
                                    ]
                                }
                            ]]
                        }
                    }
                ],
                outputContexts: [
                    ctx.updateContext(
                        'buscando-productos',
                        {
                            producto: '',
                            tipo_producto: '',
                            esperando_producto: true,
                            ultima_busqueda: 'productos'
                        },
                        10
                    )
                ]
            });
        }

        let productParam = toNormalizedString(ctx.parameters.product);
        let regionParam = toNormalizedString(ctx.parameters.region);
        let productAttributeParam = null;

        if (!productParam) {
            productParam = toNormalizedString(ctx.getParam('buscando-productos', 'producto'));
        }

        if (!regionParam) {
            regionParam = toNormalizedString(ctx.getParam('buscando-productos', 'region'));
        }

        // Si Dialogflow manda parámetros raros (ej: producto="de"), parseamos el queryText
        const parsed = parseProductAndRegionFromQueryText(rawQueryText);
        const badProduct = !productParam || productParam === 'de' || productParam === 'en' || productParam === 'productos' || productParam === 'producto';
        if ((badProduct || !regionParam) && (parsed.producto || parsed.region)) {
            if (parsed.producto) productParam = toNormalizedString(parsed.producto);
            if (parsed.region) regionParam = toNormalizedString(parsed.region);
            if (parsed.atributo) productAttributeParam = toNormalizedString(parsed.atributo);
        }

        if (productParam) {
            productParam = toNormalizedString(cleanProductPrefix(productParam));
        }

        if (productParam && !productParam.trim()) productParam = null;
        if (regionParam && !regionParam.trim()) regionParam = null;
        if (productParam === 'de' || productParam === 'en' || productParam === 'productos' || productParam === 'producto') productParam = null;

        // Palabras que NO son ciudades válidas (comando o ayuda)
        const invalidRegionKeywords = new Set([
            'regiones', 'region', 'ciudades', 'ciudad', 'que ciudades', 'que regiones',
            'lista', 'listado', 'ayuda', 'help', 'cuales', 'cuál', 'cuales son'
        ]);

        // Si el regionParam es una palabra inválida, ignorarlo
        if (regionParam) {
            const normalizedRegion = regionParam.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
            if (invalidRegionKeywords.has(normalizedRegion)) {
                regionParam = null;
            }

            // NLP: términos como "oveja" o "cabra" no son región, son atributo de producto.
            if (isLikelyProductAttribute(regionParam)) {
                productAttributeParam = regionParam;
                regionParam = null;
            }
        }

        // NLP general: si viene "de/en X" y X no parece geográfico, tratar X como atributo.
        if (regionParam) {
            const looksLikeLocation = await isLikelyLocationTerm(regionParam);
            if (!looksLikeLocation) {
                productAttributeParam = productAttributeParam || regionParam;
                regionParam = null;
            }
        }

        // NLP general: producto + calificativo sin preposición (ej: "vino tinto", "queso semicurado").
        if (!productAttributeParam && productParam) {
            const inferredAttribute = inferAttributeFromRawQuery(rawQueryText, productParam, regionParam);
            if (inferredAttribute) {
                productAttributeParam = inferredAttribute;
            }
        }

        if (!productParam && !regionParam) {
            return res.json({
                fulfillmentText: "¿Qué producto buscas y de qué provincia? Por ejemplo: 'cerámica de Valencia' o 'vino de La Rioja'."
            });
        }

        // Filtros robustos
        let filter = {};
        const productClauses = [];
        const activeFilter = { active: { $ne: false } };

        if (productParam) {
            productClauses.push(buildMainProductClause(productParam));
        }

        if (productAttributeParam) {
            productClauses.push(buildProductTextClause(productAttributeParam, { wholeWord: true }));
        }

        const productFilter = productClauses.length > 1 ? { $and: productClauses } : (productClauses[0] || null);

        if (productFilter && regionParam) {
            filter = {
                $and: [
                    activeFilter,
                    productFilter,
                    buildLocationClause(regionParam)
                ]
            };
        } else if (productFilter) {
            filter = { $and: [activeFilter, productFilter] };
        } else if (regionParam) {
            filter = { ...buildLocationClause(regionParam), ...activeFilter };
        }


        const total = await Product.countDocuments(filter);
        const productos = await Product.find(filter)
            .sort({ name: 1, _id: 1 })
            .limit(5);


        if (!productos.length) {
            const productMessage = productAttributeParam && productParam
                ? `${productParam} de ${productAttributeParam}`
                : (productParam || null);

            let mensaje = 'No encontré productos';
            if (productMessage && regionParam) {
                mensaje += ` de ${productMessage} en ${toSpanishTitleCase(regionParam)}`;
            } else if (productMessage) {
                mensaje += ` de ${productMessage}`;
            } else if (regionParam) {
                mensaje += ` en ${toSpanishTitleCase(regionParam)}`;
            }
            mensaje += '. ¿Quieres probar con otra búsqueda?';

            return res.json({
                fulfillmentText: mensaje,
                fulfillmentMessages: [
                    { text: { text: [mensaje] } },
                    {
                        payload: {
                            richContent: [
                                [{
                                    type: 'chips',
                                    options: [
                                        { text: 'Buscar otro producto' },
                                        { text: 'Ver todas las provincias' },
                                        { text: 'Ver productos populares' }
                                    ]
                                }]
                            ]
                        }
                    }
                ],
                outputContexts: [
                    ctx.updateContext(
                        'buscando-productos', {
                            producto: '',
                            tipo_producto: '',
                            region: regionParam || '',
                            ultima_busqueda: 'sin-resultados',
                            esperando_producto: true
                        },
                        10
                    )
                ]
            });
        }

        const regionDisplay = regionParam ? toSpanishTitleCase(regionParam) : null;
        const productDisplay = productParam ? toTitle(productParam) : null;
        const productMessage = productAttributeParam && productParam
            ? `${productParam} de ${productAttributeParam}`
            : (productParam || null);

        let fulfillmentText = `Encontré ${productos.length} ${pluralize(productos.length, 'producto', 'productos')}`;
        if (productMessage && regionParam) {
            fulfillmentText += ` de ${productMessage} en ${regionDisplay}`;
        } else if (productMessage) {
            fulfillmentText += ` de ${productMessage}`;
        } else if (regionParam) {
            fulfillmentText += ` en ${regionDisplay}`;
        }
        fulfillmentText += ':';

        const richContent = productos.map((p) => ({
            type: 'info',
            title: p.name,
            subtitle: `${p.address_text || p.city || 'España'}${p.certificaciones_protecciones ? ' • ' + p.certificaciones_protecciones : ''}`,
            image: p.media && p.media.length > 0 ? { src: { rawUrl: p.media[0] } } : undefined,
            actionLink: `https://noma.com/producto/${p.slug}`
        }));

        // Chips recomendadas y bien escritas (manteniendo frases que disparan intents existentes)
        const chipsOptions = [];
        if (productos.length < total) chipsOptions.push({ text: 'Ver más' });
        if (productDisplay) chipsOptions.push({ text: `${productDisplay} en otras provincias` });
        chipsOptions.push({ text: 'Ver productos similares' });
        chipsOptions.push({ text: 'Filtrar por categoría' });
        chipsOptions.push({ text: 'Buscar artesanos' });
        chipsOptions.push({ text: 'Cambiar de producto' });

        const chips = { type: 'chips', options: chipsOptions.slice(0, 6) };

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
                ctx.createContext(
                    'buscando-productos', {
                        producto: productParam || '',
                        region: regionParam || '',
                        tipo_producto: productParam || '',
                        ultima_busqueda: 'producto-region',
                        offset: productos.length,
                        total,
                        resultados_count: total
                    },
                    10
                )
            ]
        });
    } catch (error) {
        console.error('Error en buscarProductoFiltrarRegion:', error);
        return res.json({
            fulfillmentText: 'Hubo un error procesando tu búsqueda. Por favor, intenta de nuevo.'
        });
    }
};