const Product = require('../models/products');
const ContextManager = require('../utils/contextManager');
const { toSpanishTitleCase } = require('../utils/linguistica');

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ACTIVE = { active: { $ne: false } };

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

const normalizeNoAccents = (value) => `${value ?? ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const STOPWORDS = new Set([
    'de', 'del', 'la', 'el', 'los', 'las', 'en', 'con', 'sin', 'por', 'para',
    'un', 'una', 'unos', 'unas', 'que', 'y', 'o', 'producto', 'productos'
]);

const SEARCH_FIELDS = [
    'name',
    'resumen',
    'description',
    'historia_origen',
    'importancia_cultural',
    'proceso_elaboracion',
    'materias_primas',
    'tiempo_elaboracion',
    'certificaciones_protecciones'
];

const FAMILY_HINTS = [
    { term: 'vino', keywords: ['vino', 'tinto', 'blanco', 'rosado', 'rosada', 'rose', 'roseado'] },
    { term: 'queso', keywords: ['queso', 'curado', 'semicurado', 'fresco'] },
    { term: 'aceite', keywords: ['aceite', 'oliva', 'olivo'] },
    { term: 'ceramica', keywords: ['ceramica', 'alfareria', 'barro', 'jarra', 'jarron', 'plato', 'vasija', 'cuenco', 'taza'] }
];

const buildTermRegex = (value, { wholeWord = false } = {}) => {
    const loose = buildLooseSpanishRegex(value);
    const pattern = loose || escapeRegExp(`${value ?? ''}`.trim());
    if (!pattern) return null;

    if (!wholeWord) {
        return new RegExp(pattern, 'i');
    }

    return new RegExp(`(^|[^a-zA-ZÁÉÍÓÚÜÑáéíóúüñ])(?:${pattern})(?=$|[^a-zA-ZÁÉÍÓÚÜÑáéíóúüñ])`, 'i');
};

const extractMeaningfulTerms = (value) => normalizeNoAccents(value)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .filter((term) => term.length >= 3 && !STOPWORDS.has(term));

const buildTextFilter = (term) => {
    const rx = buildTermRegex(term, { wholeWord: `${term ?? ''}`.trim().length >= 4 });
    if (!rx) return null;

    return {
        $or: SEARCH_FIELDS.map((field) => ({ [field]: rx }))
    };
};

const buildStrictNameFilter = (term) => {
    const rx = buildTermRegex(term, { wholeWord: `${term ?? ''}`.trim().length >= 4 });
    if (!rx) return null;

    return { name: rx };
};

const buildRegionFilter = (region) => {
    const rx = buildTermRegex(region);
    if (!rx) return null;

    return {
        $or: [
            { city: rx },
            { province: rx },
            { autonomous_community: rx },
            { address_text: rx }
        ]
    };
};

const combineWithAnd = (filters) => {
    const safe = (filters || []).filter(Boolean);
    if (!safe.length) return {};
    if (safe.length === 1) return safe[0];
    return { $and: safe };
};

const mergeUniqueById = (items, max = 10) => {
    const out = [];
    const seen = new Set();

    for (const item of items || []) {
        const id = item?._id?.toString();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(item);
        if (out.length >= max) break;
    }

    return out;
};

const removeLikelyExactMatch = (items, requestedTerm) => {
    const normalizedRequested = normalizeNoAccents(requestedTerm).replace(/\s+/g, ' ').trim();
    if (!normalizedRequested) return items || [];

    return (items || []).filter((item) => {
        const normalizedName = normalizeNoAccents(item?.name).replace(/\s+/g, ' ').trim();
        return normalizedName !== normalizedRequested;
    });
};

const detectFamilyTerm = (productTerm, referenceName = '') => {
    const source = normalizeNoAccents(`${productTerm || ''} ${referenceName || ''}`);

    for (const hint of FAMILY_HINTS) {
        for (const keyword of hint.keywords) {
            const rx = new RegExp(`(^|\\b)${escapeRegExp(keyword)}(\\b|$)`, 'i');
            if (rx.test(source)) {
                return hint.term;
            }
        }
    }

    const terms = extractMeaningfulTerms(source);
    return terms[0] || '';
};

const findReferenceProduct = async(productTerm, regionTerm) => {
    const strictNameFilter = buildStrictNameFilter(productTerm);
    const looseFilter = buildTextFilter(productTerm);

    // Primero intenta con búsqueda estricta en el nombre
    if (strictNameFilter) {
        const regionFilter = buildRegionFilter(regionTerm);

        if (regionFilter) {
            const regional = await Product.findOne(combineWithAnd([ACTIVE, strictNameFilter, regionFilter]))
                .sort({ name: 1, _id: 1 });
            if (regional) return regional;
        }

        const found = await Product.findOne(combineWithAnd([ACTIVE, strictNameFilter])).sort({ name: 1, _id: 1 });
        if (found) return found;
    }

    // Si no encuentra en el nombre, busca en otros campos
    if (looseFilter) {
        const regionFilter = buildRegionFilter(regionTerm);

        if (regionFilter) {
            const regional = await Product.findOne(combineWithAnd([ACTIVE, looseFilter, regionFilter]))
                .sort({ name: 1, _id: 1 });
            if (regional) return regional;
        }

        return Product.findOne(combineWithAnd([ACTIVE, looseFilter])).sort({ name: 1, _id: 1 });
    }

    return null;
};

const searchByTerm = async({ term, regionTerm, excludeId, limit = 10 }) => {
    const strictNameFilter = buildStrictNameFilter(term);
    const looseFilter = buildTextFilter(term);
    
    if (!strictNameFilter && !looseFilter) return { items: [], expandedToSpain: false };

    const exclusion = excludeId ? { _id: { $ne: excludeId } } : null;
    const baseFilters = [strictNameFilter || looseFilter, exclusion].filter(Boolean);
    const regionFilter = buildRegionFilter(regionTerm);

    let expandedToSpain = false;

    // STAGE 1: Búsqueda estricta solo en el nombre
    if (strictNameFilter) {
        const strictBaseFilters = [ACTIVE, strictNameFilter, exclusion].filter(Boolean);
        
        if (regionFilter) {
            const regional = await Product.find(combineWithAnd([...strictBaseFilters, regionFilter]))
                .sort({ name: 1, _id: 1 })
                .limit(limit);

            if (regional.length > 0) {
                return { items: regional, expandedToSpain: false };
            }

            const nationwide = await Product.find(combineWithAnd(strictBaseFilters))
                .sort({ name: 1, _id: 1 })
                .limit(limit);

            if (nationwide.length > 0) {
                expandedToSpain = true;
                return {
                    items: nationwide,
                    expandedToSpain
                };
            }
        } else {
            const items = await Product.find(combineWithAnd(strictBaseFilters))
                .sort({ name: 1, _id: 1 })
                .limit(limit);

            if (items.length > 0) {
                return { items, expandedToSpain: false };
            }
        }
    }

    // STAGE 2: Si la búsqueda estricta devolvió 0 resultados, expandir a todos los campos
    const looseBaseFilters = [ACTIVE, looseFilter || strictNameFilter, exclusion].filter(Boolean);

    if (regionFilter) {
        const regional = await Product.find(combineWithAnd([...looseBaseFilters, regionFilter]))
            .sort({ name: 1, _id: 1 })
            .limit(limit);

        if (regional.length >= 3) {
            return { items: regional, expandedToSpain };
        }

        const nationwide = await Product.find(combineWithAnd(looseBaseFilters))
            .sort({ name: 1, _id: 1 })
            .limit(limit);

        expandedToSpain = true;
        return {
            items: mergeUniqueById([...regional, ...nationwide], limit),
            expandedToSpain
        };
    }

    const items = await Product.find(combineWithAnd(looseBaseFilters))
        .sort({ name: 1, _id: 1 })
        .limit(limit);

    return { items, expandedToSpain };
};

const searchByCategory = async({ category, regionTerm, excludeId, limit = 10 }) => {
    if (!category) return { items: [], expandedToSpain: false };

    const exclusion = excludeId ? { _id: { $ne: excludeId } } : null;
    const categoryFilter = { category };
    const baseFilters = [ACTIVE, categoryFilter, exclusion];
    const regionFilter = buildRegionFilter(regionTerm);

    let expandedToSpain = false;

    if (regionFilter) {
        const regional = await Product.find(combineWithAnd([...baseFilters, regionFilter]))
            .sort({ name: 1, _id: 1 })
            .limit(limit);

        if (regional.length >= 3) {
            return { items: regional, expandedToSpain };
        }

        const nationwide = await Product.find(combineWithAnd(baseFilters))
            .sort({ name: 1, _id: 1 })
            .limit(limit);

        expandedToSpain = true;
        return {
            items: mergeUniqueById([...regional, ...nationwide], limit),
            expandedToSpain
        };
    }

    const items = await Product.find(combineWithAnd(baseFilters))
        .sort({ name: 1, _id: 1 })
        .limit(limit);

    return { items, expandedToSpain };
};

const searchPopularProducts = async({ regionTerm, excludeId, limit = 10 }) => {
    const exclusion = excludeId ? { _id: { $ne: excludeId } } : null;
    const baseFilters = [ACTIVE, exclusion].filter(Boolean);
    const regionFilter = buildRegionFilter(regionTerm);

    let expandedToSpain = false;

    if (regionFilter) {
        const regional = await Product.find(combineWithAnd([...baseFilters, regionFilter]))
            .sort({ name: 1, _id: 1 })
            .limit(limit);

        if (regional.length >= 3) {
            return { items: regional, expandedToSpain: false };
        }

        const nationwide = await Product.find(combineWithAnd(baseFilters))
            .sort({ name: 1, _id: 1 })
            .limit(limit);

        expandedToSpain = true;
        return {
            items: mergeUniqueById([...regional, ...nationwide], limit),
            expandedToSpain
        };
    }

    const items = await Product.find(combineWithAnd(baseFilters))
        .sort({ name: 1, _id: 1 })
        .limit(limit);

    return { items, expandedToSpain };
};

module.exports = async(req, res) => {
    try {
        const ctx = new ContextManager(req);

        const productoCtx = ctx.getParam('buscando-productos', 'producto');
        const regionCtx = ctx.getParam('buscando-productos', 'region');
        const queryText = req.body?.queryResult?.queryText || '';

        // Si el usuario hace clic en "Ver productos similares", ignora parámetros extraídos
        // y usa directamente el contexto, SIN filtro regional
        const isChipClick = /^ver\s+productos\s+similares$/i.test(queryText);
        const productParam = isChipClick ? (productoCtx || null) : (
            ctx.parameters.product ||
            ctx.parameters.producto ||
            productoCtx ||
            null
        );

        const regionParam = isChipClick ? null : (ctx.parameters.region || regionCtx || null);
        const cleanProductParam = `${productParam || ''}`.trim();
        const cleanRegionParam = `${regionParam || ''}`.trim();

        if (!cleanProductParam && !cleanRegionParam) {
            return res.json({
                fulfillmentText: '¿Productos similares a qué? Dime un producto (ej: "vino") o una provincia (ej: "Alicante").'
            });
        }

        let productos = [];
        let expandedToSpain = false;
        let usedCategoryFallback = false;
        let usedPopularFallback = false;
        let referenceCategory = '';

        if (cleanProductParam) {
            const referenceProduct = await findReferenceProduct(cleanProductParam, cleanRegionParam);
            referenceCategory = referenceProduct?.category || '';

            // Búsqueda directa: misma categoría del producto de referencia (ej: Alimentación)
            // Sin fallbacks de familia o término exacto
            if (referenceCategory) {
                const byCategory = await searchByCategory({
                    category: referenceCategory,
                    regionTerm: cleanRegionParam,
                    excludeId: null,  // NO excluimos el producto original
                    limit: 100  // Obtener todos los productos de esa categoría
                });
                expandedToSpain = byCategory.expandedToSpain;
                productos = byCategory.items;
                usedCategoryFallback = Boolean(productos.length);
            }

            // Si no hay categoría o no hay productos en esa categoría, mostrar populares
            if (!productos.length) {
                const popular = await searchPopularProducts({
                    regionTerm: cleanRegionParam,
                    excludeId: referenceProduct?._id,
                    limit: 5
                });
                expandedToSpain = expandedToSpain || popular.expandedToSpain;
                productos = popular.items;
                usedPopularFallback = Boolean(productos.length);
            }
        } else if (cleanRegionParam) {
            const regionFilter = buildRegionFilter(cleanRegionParam);
            productos = regionFilter
                ? await Product.find(combineWithAnd([ACTIVE, regionFilter])).sort({ name: 1, _id: 1 }).limit(5)
                : [];
        }

        if (!productos.length) {
            return res.json({
                fulfillmentText: 'No encontré productos similares con esos criterios. ¿Quieres que te muestre productos populares?'
            });
        }

        const regionDisplay = cleanRegionParam ? toSpanishTitleCase(cleanRegionParam) : '';
        const extra = expandedToSpain && regionDisplay ? ` (incluye resultados fuera de ${regionDisplay})` : '';

        let fulfillmentText;
        if (usedPopularFallback) {
            fulfillmentText = `No encontré más productos parecidos a "${cleanProductParam}". Te muestro productos populares`;
            if (regionDisplay) fulfillmentText += ` en ${regionDisplay}`;
            fulfillmentText += `${extra}:`;
        } else if (usedCategoryFallback) {
            const fallbackCategory = productos[0]?.category || 'la misma categoría';
            fulfillmentText = `No encontré más productos parecidos a "${cleanProductParam}". Te muestro productos de la misma categoría (${fallbackCategory})`;
            if (regionDisplay) fulfillmentText += ` en ${regionDisplay}`;
            fulfillmentText += `${extra}:`;
        } else {
            const base = cleanProductParam
                ? `Aquí tienes productos similares a "${cleanProductParam}"`
                : 'Aquí tienes productos similares';
            const suffix = regionDisplay ? ` en ${regionDisplay}` : '';
            fulfillmentText = `${base}${suffix}${extra}:`;
        }

        const richContent = productos.slice(0, 5).map((p) => ({
            type: 'info',
            title: p.name,
            subtitle: `${p.address_text || p.city || p.province || regionDisplay || 'España'}${p.category ? ' • ' + p.category : ''}${p.certificaciones_protecciones ? ' • ' + p.certificaciones_protecciones : ''}`,
            image: p.media && p.media.length > 0 ? { src: { rawUrl: p.media[0] } } : undefined,
            actionLink: `http://localhost:4200/producto/${p.slug}`
        }));

        // Detectar si hay más productos para paginar
        const hayMas = productos.length > 5;

        // Detectar si algún producto tiene certificación
        const hasCertification = productos.some(p => p.certificaciones_protecciones && p.certificaciones_protecciones.trim());

        const chips = {
            type: 'chips',
            options: [
                { text: 'Ver todos los productos' },
                ...(hayMas ? [{ text: 'Ver más productos relacionados' }] : []),
                ...(hasCertification ? [{ text: 'Filtrar por certificación' }] : [])
            ]
        };

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
                ctx.updateContext(
                    'buscando-productos', {
                        producto: cleanProductParam || '',
                        categoria: referenceCategory || '',
                        region: cleanRegionParam || '',
                        ultima_busqueda: 'similares',
                        resultados_count: productos.length,
                        offset: 5,
                        total: productos.length
                    },
                    10
                )
            ]
        });
    } catch (error) {
        console.error('Error en productosSimilares:', error);
        return res.json({
            fulfillmentText: 'Hubo un error buscando productos similares. Por favor, intenta de nuevo.'
        });
    }
};