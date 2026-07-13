const Product = require('../models/products');
const ContextManager = require('../utils/contextManager');
const MensajesNaturales = require('../utils/mensajesNaturales');
const SugerenciasProactivas = require('../utils/sugerenciasProactivas');
const {
  normalizeNoAccents,
  cleanConversationalPrefix,
  stripTrailingPunctuation,
  containsOffensiveLanguage
} = require('../utils/nlp');

const PAGE_SIZE = 5;
const CATEGORY_OPTIONS = [
  'Alimentación',
  'Textil',
  'Barro y Alfarería',
  'Madera y mueble',
  'Otros'
];

const CATEGORY_ALIASES = [
  { alias: 'alimentacion', value: 'Alimentación' },
  { alias: 'alimentacion y bebida', value: 'Alimentación' },
  { alias: 'textil', value: 'Textil' },
  { alias: 'barro y alfareria', value: 'Barro y Alfarería' },
  { alias: 'alfareria', value: 'Barro y Alfarería' },
  { alias: 'barro', value: 'Barro y Alfarería' },
  { alias: 'ceramica', value: 'Barro y Alfarería' },
  { alias: 'madera y mueble', value: 'Madera y mueble' },
  { alias: 'madera', value: 'Madera y mueble' },
  { alias: 'mueble', value: 'Madera y mueble' },
  { alias: 'otros', value: 'Otros' }
];

const escapeRegExp = (value) => `${value ?? ''}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const cleanProductPrefix = (value) => {
  const raw = cleanConversationalPrefix(stripTrailingPunctuation(`${value || ''}`.trim()));
  if (!raw) return '';

  // Limpia prefijos en cadena (ej: "quiero ver vino" -> "vino").
  let current = raw;
  let prev = '';

  while (current !== prev) {
    prev = current;
    current = current
      .replace(/^(quiero|quisiera|busco|buscar|busca|dame|muestrame|mu[eé]strame|ensename|ens[eé][ñn]ame|ver|mostrar|mostrarme|encontrar)\s+/i, '')
      .replace(/^productos?\s+de\s+/i, '')
      .trim();
  }

  return current;
};

const stripLeadingConjunction = (value) => `${value || ''}`
  .trim()
  .replace(/^(y|e|o|u)\s+/i, '')
  .trim();

const normalizeComparableText = (value) => normalizeNoAccents(
  stripLeadingConjunction(cleanProductPrefix(value))
).replace(/\s+/g, ' ').trim();

const isCertificationLikeProductTerm = (productTerm, certificationFilter) => {
  const normalizedProduct = normalizeComparableText(productTerm);
  if (!normalizedProduct || certificationFilter.mode === 'none') return false;

  const candidates = new Set();

  if (certificationFilter.value) {
    const normalizedValue = normalizeComparableText(certificationFilter.value);
    if (normalizedValue) {
      candidates.add(normalizedValue);
      candidates.add(`certificacion ${normalizedValue}`);
    }
  }

  const normalizedLabel = normalizeComparableText(certificationFilter.label);
  if (normalizedLabel) {
    candidates.add(normalizedLabel);
  }

  if (certificationFilter.mode === 'any') {
    candidates.add('certificacion');
    candidates.add('certificacion oficial');
    candidates.add('oficial');
  }

  return candidates.has(normalizedProduct);
};

const buildLooseSpanishRegex = (value) => {
  const base = normalizeNoAccents(value);
  if (!base) return '';

  const mapChar = (ch) => {
    switch (ch) {
      case 'a': return '[aáàäâ]';
      case 'e': return '[eéèëê]';
      case 'i': return '[iíìïî]';
      case 'o': return '[oóòöô]';
      case 'u': return '[uúùüû]';
      case 'n': return '[nñ]';
      case ' ': return '[\\s,._-]*';
      case '-':
      case '_':
      case ',':
      case '.': return '[\\s,._-]*';
      default: return escapeRegExp(ch);
    }
  };

  let pattern = '';
  for (const ch of base) pattern += mapChar(ch);
  return pattern;
};

const buildSearchRegex = (term, { wholeWord = false } = {}) => {
  const loose = buildLooseSpanishRegex(term);
  const basePattern = loose || escapeRegExp(term);

  if (!wholeWord) {
    return new RegExp(basePattern, 'i');
  }

  const boundedPattern = `(^|[^a-zA-ZÁÉÍÓÚÜÑáéíóúüñ])(?:${basePattern})(?=$|[^a-zA-ZÁÉÍÓÚÜÑáéíóúüñ])`;
  return new RegExp(boundedPattern, 'i');
};

// Genera variantes singular/plural básicas para español
const getSingularPluralVariants = (term) => {
  const variants = new Set([term]);
  
  // Si termina en 's', agregar forma sin 's' (plural -> singular)
  if (term.endsWith('s') && term.length > 2) {
    const singular = term.slice(0, -1);
    variants.add(singular);
  } else if (!term.endsWith('s') && term.length > 2) {
    // Si NO termina en 's', agregar forma con 's' (singular -> plural)
    variants.add(term + 's');
  }
  
  return Array.from(variants);
};

const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'en', 'un', 'una', 'unos', 'unas']);

const humanJoin = (items) => {
  const values = (items || []).filter(Boolean);
  if (!values.length) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} y ${values[1]}`;
  return `${values.slice(0, -1).join(', ')} y ${values[values.length - 1]}`;
};

const dedupeChipOptions = (options, max = 5) => {
  const seen = new Set();
  const result = [];

  for (const option of options || []) {
    const text = `${option?.text || ''}`.trim();
    if (!text) continue;
    const key = normalizeNoAccents(text);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ text });
    if (result.length >= max) break;
  }

  return result;
};

const detectCategoryFromText = (rawText) => {
  const normalized = normalizeNoAccents(rawText);
  if (!normalized) return '';

  for (const item of CATEGORY_ALIASES) {
    const aliasRx = new RegExp(`(^|\\b)${escapeRegExp(item.alias)}(\\b|$)`, 'i');
    if (aliasRx.test(normalized)) {
      return item.value;
    }
  }

  return '';
};

const detectCertificationFilter = (rawText) => {
  const normalized = normalizeNoAccents(rawText);
  if (!normalized) return { mode: 'none', value: '', label: '' };

  const hasCertificationCue =
    normalized.includes('certificacion') ||
    normalized.includes('certificaciones') ||
    normalized.includes('certificado') ||
    normalized.includes('certificados') ||
    normalized.includes('artesania garantizada') ||
    normalized.includes('do') ||
    normalized.includes('dop') ||
    normalized.includes('igp') ||
    normalized.includes('iga');

  if (!hasCertificationCue) {
    return { mode: 'none', value: '', label: '' };
  }

  if (normalized.includes('artesania garantizada')) {
    return { mode: 'term', value: 'Artesanía garantizada', label: 'certificación Artesanía garantizada' };
  }

  const acronymMatch = rawText.match(/\b(DOP|IGP|IGA|DO)\b/i);
  if (acronymMatch?.[1]) {
    const term = acronymMatch[1].toUpperCase();
    return { mode: 'term', value: term, label: `certificación ${term}` };
  }

  const genericCertification =
    /^(filtrar\s+por\s+)?(productos?\s+)?(solo\s+)?(con\s+)?certificaci(?:o|ó)n(?:es)?$/.test(normalized);

  if (genericCertification) return { mode: 'none', value: '', label: '' };

  const termMatch = rawText.match(/certificaci(?:o|ó)n(?:es)?(?:\s+oficial(?:es)?)?\s+(.+)$/i);
  if (termMatch?.[1]) {
    const value = termMatch[1].replace(/[?.!,;:]+$/g, '').trim();
    if (value) {
      return { mode: 'term', value, label: `certificación ${value}` };
    }
  }

  return { mode: 'none', value: '', label: '' };
};

const parseStoredCertificationFilter = (storedValue) => {
  const raw = `${storedValue || ''}`.trim();
  if (!raw) return { mode: 'none', value: '', label: '' };

  const normalized = normalizeNoAccents(raw);

  if (
    normalized === 'oficial' ||
    normalized === 'certificacion oficial' ||
    normalized === 'cualquier certificacion oficial'
  ) {
    return { mode: 'any', value: 'oficial', label: 'certificación oficial' };
  }

  if (normalized === 'artesania garantizada') {
    return { mode: 'term', value: 'Artesanía garantizada', label: 'certificación Artesanía garantizada' };
  }

  const acronymMatch = raw.match(/\b(DO|DOP|IGP|IGA)\b/i);
  if (acronymMatch?.[1]) {
    const term = acronymMatch[1].toUpperCase();
    return { mode: 'term', value: term, label: `certificación ${term}` };
  }

  return { mode: 'term', value: raw, label: `certificación ${raw}` };
};

const isGenericFilterCommand = (value) => {
  const normalized = normalizeNoAccents(value);
  if (!normalized) return true;

  return /^(filtrar|categoria|categorias|certificacion|certificaciones|solo\s+con\s+certificacion(?:\s+(?:do|dop|igp|iga))?|con\s+certificacion(?:\s+(?:do|dop|igp|iga))?|certificacion\s+oficial|productos?\s+con\s+certificacion(?:\s+(?:do|dop|igp|iga))?|cambiar|producto|productos|ver|quitar|limpiar|borrar)$/.test(normalized);
};

const extractQueryTerms = (value) => {
  const normalized = normalizeNoAccents(cleanProductPrefix(value));
  if (!normalized) return [];

  return normalized
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !STOPWORDS.has(t));
};

const buildProductFilter = (rawQuery) => {
  const terms = extractQueryTerms(rawQuery);
  if (!terms.length) return null;

  const searchableFields = [
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

  // Requerimos TODOS los términos significativos para mejorar precisión
  // (ej: "queso curado" no debe devolver "queso semicurado" por coincidencia parcial).
  return {
    $and: terms.map((term) => {
      const wholeWord = term.length >= 4;
      const rx = buildSearchRegex(term, { wholeWord });
      return {
        $or: searchableFields.map((field) => ({ [field]: rx }))
      };
    })
  };
};

const buildStrictNameFilter = (rawQuery) => {
  const terms = extractQueryTerms(rawQuery);
  if (!terms.length) return null;

  return {
    $and: terms.map((term) => {
      const variants = getSingularPluralVariants(term);
      const orConditions = variants.map((variant) => {
        const wholeWord = variant.length >= 4;
        const rx = buildSearchRegex(variant, { wholeWord });
        return { name: rx };
      });
      
      // Si hay múltiples variantes, usar $or; si no, usar directamente
      return orConditions.length > 1 ? { $or: orConditions } : orConditions[0];
    })
  };
};

const getImageUrl = (product) => {
  if (!product?.media || product.media.length === 0) {
    return 'https://via.placeholder.com/150';
  }

  const foto = product.media[0];
  if (typeof foto !== 'string' || !foto.trim()) {
    return 'https://via.placeholder.com/150';
  }

  if (foto.startsWith('data:image')) return foto;
  if (foto.startsWith('http')) return foto;
  return `http://localhost:3000/uploads/${foto}`;
};

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const NEAR_RADIUS_METERS = 120000;
const EARTH_RADIUS_METERS = 6378100;
const buildNearbyWithinFilter = (lon, lat) => ({
  location: {
    $geoWithin: {
      $centerSphere: [[lon, lat], NEAR_RADIUS_METERS / EARTH_RADIUS_METERS]
    }
  }
});

const buildLocationClause = (term) => {
  const loose = buildLooseSpanishRegex(term);
  const rx = new RegExp(loose || escapeRegExp(term), 'i');

  return {
    $or: [
      { city: rx },
      { province: rx },
      { autonomous_community: rx },
      { address_text: rx }
    ]
  };
};

module.exports = async (req, res) => {
  try {
    const ctx = new ContextManager(req);

    const rawQueryText = req.body?.queryResult?.queryText || '';
    const normalizedQuery = normalizeNoAccents(stripTrailingPunctuation(rawQueryText));
    const hasGreetingCue = /\b(hola|holi|buenas|buenos\s+dias|buenas\s+tardes|buenas\s+noches|hey|ey|ola)\b/.test(normalizedQuery);
    const hasTaskCue = /\b(busca|buscar|busco|producto|productos|artesano|artesanos|categoria|certificacion|region|provincia|ciudad|cerca)\b/.test(normalizedQuery);
    const isGreetingText = hasGreetingCue && !hasTaskCue;

    if (containsOffensiveLanguage(rawQueryText)) {
      const txt = 'Prefiero mantener una conversacion respetuosa. Si quieres, te ayudo a encontrar productos artesanales.';
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
                    { text: 'Ver productos' },
                    { text: 'Filtrar por categoría' },
                    { text: 'Productos populares' }
                  ]
                }
              ]]
            }
          }
        ]
      });
    }

    if (isGreetingText) {
      const txt = '¡Hola! ¿Qué te gustaría buscar hoy?';
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
                    { text: 'Ver productos' },
                    { text: 'Productos populares' },
                    { text: 'Conectar con artesanos' },
                    { text: 'Ayuda' }
                  ]
                }
              ]]
            }
          }
        ]
      });
    }

    // Si Dialogflow cae en FP-1 con "ver más", redirigimos a paginación correcta.
    if (/^(ver\s+mas(\s+productos)?|ver\s+mas\s+productos\s+relacionados|ver\s+mas\s+de\s+.+|ver\s+mas\s+sobre\s+.+)$/.test(normalizedQuery)) {
      const handleVerMasProductos = require('./verMasProductos');
      return handleVerMasProductos(req, res);
    }

    const storedProduct =
      ctx.getParam('buscando-productos', 'producto') ||
      ctx.getParam('buscando-productos', 'tipo_producto') ||
      '';
    const cleanedStoredProduct = cleanProductPrefix(storedProduct);
    const safeStoredProduct = isGenericFilterCommand(cleanedStoredProduct)
      ? ''
      : cleanedStoredProduct;
    const storedCategory = `${ctx.getParam('buscando-productos', 'categoria') || ''}`.trim();
    const storedRegion = `${ctx.getParam('buscando-productos', 'region') || ''}`.trim();
    const storedCertificationRaw = `${ctx.getParam('buscando-productos', 'certificacion') || ''}`.trim();
    const storedCertificationFilter = parseStoredCertificationFilter(storedCertificationRaw);
    const waitingCategorySelection = Boolean(ctx.getParam('buscando-productos', 'esperando_categoria'));
    const storedNearFlag = Boolean(ctx.getParam('buscando-productos', 'filtro_cercania_activo'));
    const storedLastSearch = normalizeNoAccents(ctx.getParam('buscando-productos', 'ultima_busqueda') || '');
    const lat = toNumber(
      ctx.getParam('ubicacion-usuario', 'lat') ||
      ctx.getParam('ubicacion-usuario', 'latitude')
    );
    const lon = toNumber(
      ctx.getParam('ubicacion-usuario', 'lon') ||
      ctx.getParam('ubicacion-usuario', 'lng') ||
      ctx.getParam('ubicacion-usuario', 'longitude')
    );
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);
    const shouldApplyNearFilter = hasCoords && (storedNearFlag || storedLastSearch === 'cerca-de-mi');
    const isClearFiltersCommand =
      /^(quitar|limpiar|borrar|reiniciar)\s+filtros?$/.test(normalizedQuery) ||
      /^ver\s+sin\s+filtros?$/.test(normalizedQuery) ||
      /^sin\s+filtros?$/.test(normalizedQuery);

    const productParamRaw = ctx.parameters.product || ctx.parameters.producto || safeStoredProduct || '';

    const isCategoryPrompt = /^(filtrar\s+por\s+categorias?|ver\s+categorias?|categorias?|explorar\s+categorias?)$/.test(normalizedQuery);
    if (isCategoryPrompt) {
      const txt = 'Perfecto. ¿Qué categoría quieres explorar?';
      const offsetCtx = Number(ctx.getParam('buscando-productos', 'offset'));
      const totalCtx = Number(ctx.getParam('buscando-productos', 'total'));
      const countCtx = Number(ctx.getParam('buscando-productos', 'resultados_count'));
      return res.json({
        fulfillmentText: txt,
        fulfillmentMessages: [
          { text: { text: [txt] } },
          {
            payload: {
              richContent: [[
                {
                  type: 'chips',
                  options: CATEGORY_OPTIONS.map((cat) => ({ text: cat }))
                }
              ]]
            }
          }
        ],
        outputContexts: [
          ctx.updateContext('buscando-productos', {
            producto: safeStoredProduct || '',
            region: storedRegion || '',
            categoria: storedCategory || '',
            certificacion: storedCertificationRaw || '',
            esperando_categoria: true,
            filtro_cercania_activo: storedNearFlag,
            ultima_busqueda: ctx.getParam('buscando-productos', 'ultima_busqueda') || 'productos-filtrados',
            offset: Number.isFinite(offsetCtx) ? offsetCtx : 0,
            total: Number.isFinite(totalCtx) ? totalCtx : 0,
            resultados_count: Number.isFinite(countCtx) ? countCtx : 0
          }, 10)
        ]
      });
    }

    const certificationFilter = detectCertificationFilter(rawQueryText);
    const isCertificationPrompt =
      /^(filtrar\s+por\s+certificaciones?|certificaciones?|solo\s+con\s+certificacion(?:\s+oficial)?|certificacion(?:\s+oficial)?)$/.test(normalizedQuery) ||
      (normalizedQuery.includes('certificacion') && !/\b(do|dop|igp|iga|artesania\s+garantizada)\b/.test(normalizedQuery));
    const hasExplicitCertificationChoice = /\b(do|dop|igp|iga|artesania\s+garantizada)\b/.test(normalizedQuery);

    if (isCertificationPrompt && !hasExplicitCertificationChoice) {
      const txt = '¿Qué tipo de certificación quieres usar?';
      const offsetCtx = Number(ctx.getParam('buscando-productos', 'offset'));
      const totalCtx = Number(ctx.getParam('buscando-productos', 'total'));
      const countCtx = Number(ctx.getParam('buscando-productos', 'resultados_count'));
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
                    { text: 'Certificación DO' },
                    { text: 'Certificación DOP' },
                    { text: 'Certificación IGP' },
                    { text: 'Certificación IGA' },
                    { text: 'Artesanía garantizada' }
                  ]
                }
              ]]
            }
          }
        ],
        outputContexts: [
          ctx.updateContext('buscando-productos', {
            producto: safeStoredProduct || '',
            region: storedRegion || '',
            categoria: storedCategory || '',
            certificacion: storedCertificationRaw || '',
            esperando_categoria: false,
            filtro_cercania_activo: storedNearFlag,
            ultima_busqueda: ctx.getParam('buscando-productos', 'ultima_busqueda') || 'productos-filtrados',
            offset: Number.isFinite(offsetCtx) ? offsetCtx : 0,
            total: Number.isFinite(totalCtx) ? totalCtx : 0,
            resultados_count: Number.isFinite(countCtx) ? countCtx : 0
          }, 10)
        ]
      });
    }

    const detectedCategory = detectCategoryFromText(rawQueryText);
    const hasCategoryCue = normalizedQuery.includes('categoria') || normalizedQuery.includes('categorias');
    const shouldResolveCategorySelection = hasCategoryCue || waitingCategorySelection || Boolean(detectedCategory);
    if (shouldResolveCategorySelection && !detectedCategory && !isClearFiltersCommand) {
      const txt = '¿Qué categoría quieres aplicar?';
      const offsetCtx = Number(ctx.getParam('buscando-productos', 'offset'));
      const totalCtx = Number(ctx.getParam('buscando-productos', 'total'));
      const countCtx = Number(ctx.getParam('buscando-productos', 'resultados_count'));
      return res.json({
        fulfillmentText: txt,
        fulfillmentMessages: [
          { text: { text: [txt] } },
          {
            payload: {
              richContent: [[
                {
                  type: 'chips',
                  options: CATEGORY_OPTIONS.map((cat) => ({ text: cat }))
                }
              ]]
            }
          }
        ],
        outputContexts: [
          ctx.updateContext('buscando-productos', {
            producto: safeStoredProduct || '',
            region: storedRegion || '',
            categoria: storedCategory || '',
            certificacion: storedCertificationRaw || '',
            esperando_categoria: true,
            filtro_cercania_activo: storedNearFlag,
            ultima_busqueda: ctx.getParam('buscando-productos', 'ultima_busqueda') || 'productos-filtrados',
            offset: Number.isFinite(offsetCtx) ? offsetCtx : 0,
            total: Number.isFinite(totalCtx) ? totalCtx : 0,
            resultados_count: Number.isFinite(countCtx) ? countCtx : 0
          }, 10)
        ]
      });
    }

    const cleanedFromText = isClearFiltersCommand ? '' : cleanProductPrefix(rawQueryText);
    const cleanedFromParam = cleanProductPrefix(productParamRaw);
    const normalizedDetectedCategory = normalizeNoAccents(detectedCategory);
    const normalizedRawNoPunct = normalizeNoAccents(stripTrailingPunctuation(rawQueryText));
    const regionRefinementMatch = normalizedRawNoPunct.match(/(?:de|en)\s+([a-zA-Z\s]+)$/i);
    const regionRefinementCandidate = regionRefinementMatch?.[1]?.trim() || '';

    const looksLikeFreshProductQuery = (() => {
      if (isClearFiltersCommand) return false;
      if (waitingCategorySelection) return false;
      if (certificationFilter.mode !== 'none') return false;
      if (regionRefinementCandidate) return false;
      if (!cleanedFromText) return false;
      if (isGenericFilterCommand(cleanedFromText)) return false;

      const normalizedFresh = normalizeComparableText(cleanedFromText);
      const normalizedStored = normalizeComparableText(safeStoredProduct);
      // Si cleanedFromText es igual a regionRefinementCandidate (ej: "productos de alicante" → cleanedFromText="alicante"), no es un producto fresco
      if (regionRefinementCandidate && normalizeComparableText(regionRefinementCandidate) === normalizedFresh) return false;
      return Boolean(normalizedFresh) && normalizedFresh !== normalizedStored;
    })();

    const categoryFilter = (isClearFiltersCommand || looksLikeFreshProductQuery)
      ? ''
      : (shouldResolveCategorySelection ? detectedCategory : (storedCategory || ''));
    const activeCertificationFilter = (isClearFiltersCommand || looksLikeFreshProductQuery)
      ? { mode: 'none', value: '', label: '' }
      : (certificationFilter.mode !== 'none' ? certificationFilter : storedCertificationFilter);
    const hasCategoryFilter = Boolean(categoryFilter);
    const hasCertificationFilter = activeCertificationFilter.mode !== 'none';
    const clearFiltersText = isClearFiltersCommand
      ? 'He quitado los filtros de categoría y certificación.'
      : '';
    const regionFilter = isClearFiltersCommand
      ? ''
      : (regionRefinementCandidate || storedRegion || '');

    // Importante: Dialogflow suele extraer solo el sustantivo base (ej: "queso")
    // y perder calificativos (ej: "semicurado"). Priorizamos el texto completo.
    let productParam = cleanedFromText || cleanedFromParam;

    const isPureCategorySelection =
      shouldResolveCategorySelection &&
      Boolean(detectedCategory) &&
      normalizeNoAccents(cleanedFromText) === normalizedDetectedCategory;

    if (isPureCategorySelection) {
      // If user only selected a category chip, keep previous product term (if any)
      // instead of converting the category text into product term.
      productParam = cleanedFromParam || safeStoredProduct || '';
    }

    const hasAdvancedFilter = Boolean(categoryFilter) || activeCertificationFilter.mode !== 'none';
    if (hasAdvancedFilter) {
      const strippedQuery = cleanProductPrefix(
        rawQueryText
          .replace(/categor[ií]a(?:s)?\s+[^,.;]+/gi, '')
          .replace(/solo\s+con\s+certificaci[oó]n(?:\s+oficial(?:es)?)?/gi, '')
          .replace(/con\s+certificaci[oó]n(?:\s+oficial(?:es)?)?/gi, '')
          .replace(/certificaci[oó]n(?:es)?(?:\s+oficial(?:es)?)?/gi, '')
          .replace(/\bartesani[aá]\s+garantizada\b/gi, '')
          .replace(/\b(DO|DOP|IGP|IGA)\b/gi, '')
          .replace(/\s{2,}/g, ' ')
      );

      const strippedNormalized = normalizeNoAccents(strippedQuery);
      const isCertificationOnlyQuery =
        hasCertificationFilter &&
        (!strippedNormalized || /^(solo\s+)?con\s+certificacion(?:\s+(?:do|dop|igp|iga|oficial))?$/.test(strippedNormalized));
      const isRegionRefinementOnlyQuery = Boolean(regionRefinementCandidate);
      const isCategoryOnlyQuery =
        shouldResolveCategorySelection &&
        Boolean(detectedCategory) &&
        (strippedNormalized === normalizedDetectedCategory || !strippedNormalized);

      if (isCertificationOnlyQuery) {
        // Mantener el producto previo al aplicar "solo con certificación ..."
        productParam = cleanedFromParam || safeStoredProduct || '';
      }

      if (isRegionRefinementOnlyQuery) {
        // Mantener el producto previo al aplicar "de/en <provincia>"
        productParam = safeStoredProduct || cleanedFromParam || '';
      }

      if (!isCertificationOnlyQuery && !isCategoryOnlyQuery && !isRegionRefinementOnlyQuery && !isGenericFilterCommand(strippedQuery)) {
        productParam = strippedQuery || productParam;
      }

      if (isCategoryOnlyQuery) {
        productParam = cleanedFromParam || safeStoredProduct || '';
      }

      if (isGenericFilterCommand(productParam)) {
        productParam = '';
      }
    }

    if (
      detectedCategory &&
      (shouldResolveCategorySelection || hasCategoryCue) &&
      normalizeNoAccents(productParam) === normalizedDetectedCategory
    ) {
      productParam = cleanedFromParam || safeStoredProduct || '';
    }

    const genericUtterances = new Set(['producto', 'productos', 'ver productos', 'ver']);
    if ((!productParam || genericUtterances.has(normalizeNoAccents(productParam))) && cleanedFromParam) {
      productParam = cleanedFromParam;
    }

    if (detectedCategory && productParam) {
      const normalizedParam = normalizeNoAccents(productParam);
      const productWithoutTrailingCategory = normalizedParam
        .replace(new RegExp(`\\s+(de|en)\\s+${escapeRegExp(normalizedDetectedCategory)}$`, 'i'), '')
        .trim();

      if (productWithoutTrailingCategory && productWithoutTrailingCategory !== normalizedParam && !isGenericFilterCommand(productWithoutTrailingCategory)) {
        productParam = productWithoutTrailingCategory;
      }
    }

    productParam = stripLeadingConjunction(productParam);
    const normalizedProductComparable = normalizeComparableText(productParam);
    const normalizedCategoryComparable = normalizeComparableText(categoryFilter);

    if (
      hasCategoryFilter &&
      normalizedProductComparable &&
      normalizedCategoryComparable &&
      normalizedCategoryComparable.includes(normalizedProductComparable)
    ) {
      productParam = safeStoredProduct || '';
    }

    if (isCertificationLikeProductTerm(productParam, activeCertificationFilter)) {
      productParam = safeStoredProduct || '';
    }

    productParam = stripLeadingConjunction(productParam);

    // Si productParam es solo un comando, tratarlo como vacío
    const normalizedCommandParam = normalizeNoAccents(productParam || '').replace(/[?.!,;:]+$/g, '').trim();
    const isCommandOnly =
      /^(cambiar|producto|productos|ver|quitar|limpiar|borrar|filtrar)$/.test(normalizedCommandParam) ||
      /^(cambiar\s+(de\s+)?productos?|buscar\s+otro\s+producto|otro\s+producto|buscar\s+producto)$/.test(normalizedCommandParam);
    if (isCommandOnly) {
      productParam = '';
    }

    // Si el término es una palabra genérica de artesanía, no tiene sentido buscarlo como producto
    const isGenericCraftTerm = /^(artesani[ao]s?|artesanales?|cosas?\s+artesanales?|cosas?\s+de\s+artesania|manualidades?)$/.test(normalizedCommandParam);
    if (isGenericCraftTerm) {
      const listarProductos = require('./listarProductos');
      return listarProductos(req, res);
    }

    // Si productParam es igual a la región detectada (ej: "enseñame productos de alicante" → productParam="alicante"), limpiar productParam
    if (regionRefinementCandidate && normalizeComparableText(productParam) === normalizeComparableText(regionRefinementCandidate)) {
      productParam = '';
    }

    if (!productParam && !categoryFilter && activeCertificationFilter.mode === 'none') {
      const txt = clearFiltersText
        ? `${clearFiltersText} ¿Qué producto estás buscando ahora?`
        : "¿Qué producto estás buscando?";

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
                    { text: 'Ver productos' },
                    { text: 'Filtrar por categoría' },
                    { text: 'Solo con certificación' },
                    { text: 'Conectar con artesanos' },
                    ...(shouldApplyNearFilter ? [] : [{ text: 'Productos cerca de mí' }])
                  ]
                }
              ]]
            }
          }
        ],
        outputContexts: [
          ctx.createContext('buscando-productos', {
            producto: '',
            region: regionFilter || '',
            tipo_producto: '',
            categoria: '',
            certificacion: '',
            esperando_categoria: false,
            filtro_cercania_activo: shouldApplyNearFilter,
            ultima_busqueda: shouldApplyNearFilter ? 'cerca-de-mi' : 'productos',
            offset: 0,
            total: 0,
            resultados_count: 0
          }, 10)
        ]
      });
    }

    const extractedTerms = extractQueryTerms(productParam);

    // Si viene de similares y se está filtrando por certificación, ignorar el producto y solo filtrar por categoría + certificación
    const comingFromSimilares = normalizeNoAccents(storedLastSearch) === 'similares';
    const filteringByCertificationFromSimilares = comingFromSimilares && hasCertificationFilter && activeCertificationFilter.mode !== 'none';

    if (filteringByCertificationFromSimilares) {
      productParam = ''; // Ignorar el producto cuando viene de similares + certificación
    }

    const andFilters = [{ active: { $ne: false } }];

    if (shouldApplyNearFilter) {
      andFilters.push(buildNearbyWithinFilter(lon, lat));
    }

    let productos = [];
    let total = 0;

    if (productParam) {
      // Primero: búsqueda ESTRICTA solo en el nombre del producto
      const strictFilters = [...andFilters];
      
      let productFilter = null;
      try {
        productFilter = buildStrictNameFilter(productParam);
      } catch (e) {
        console.error(`⚠️ Error building strict filter for "${productParam}":`, e.message);
        productFilter = null;
      }
      
      strictFilters.push(productFilter || {
        name: new RegExp(escapeRegExp(productParam), 'i')
      });

      if (categoryFilter) {
        strictFilters.push({ category: categoryFilter });
      }

      if (regionFilter) {
        strictFilters.push(buildLocationClause(regionFilter));
      }

      if (activeCertificationFilter.mode === 'any') {
        strictFilters.push({
          certificaciones_protecciones: {
            $regex: /[a-zA-Z0-9ÁÉÍÓÚÜÑáéíóúüñ]/,
            $not: /sin\s+certificaci[oó]n/i
          }
        });
      }

      if (activeCertificationFilter.mode === 'term') {
        strictFilters.push({
          certificaciones_protecciones: buildSearchRegex(activeCertificationFilter.value)
        });
      }

      const strictFilter = strictFilters.length <= 1 ? (strictFilters[0] || {}) : { $and: strictFilters };
      
      try {
        const strictResults = await Product.find(strictFilter)
          .sort({ name: 1, _id: 1 })
          .limit(PAGE_SIZE);

        // Usar solo búsqueda estricta en nombre (sin expandir a otros campos)
        // Si no hay resultados en nombre, devolver vacío en lugar de expandir a ingredientes
        productos = strictResults;
        total = await Product.countDocuments(strictFilter);

        // Fallback defensivo: cuando viene 1 término (ej: "quesos") y el filtro principal
        // no devuelve nada, rehacemos la consulta con variantes singular/plural explícitas.
        if (!productos.length && extractedTerms.length === 1) {
          const term = extractedTerms[0];
          const variants = getSingularPluralVariants(term);
          const nameOr = variants
            .filter(Boolean)
            .map((variant) => {
              const wholeWord = variant.length >= 4;
              return { name: buildSearchRegex(variant, { wholeWord }) };
            });

          if (nameOr.length) {
            const altFilters = [...andFilters, { $or: nameOr }];

            if (categoryFilter) {
              altFilters.push({ category: categoryFilter });
            }

            if (regionFilter) {
              altFilters.push(buildLocationClause(regionFilter));
            }

            if (activeCertificationFilter.mode === 'any') {
              altFilters.push({
                certificaciones_protecciones: {
                  $regex: /[a-zA-Z0-9ÁÉÍÓÚÜÑáéíóúüñ]/,
                  $not: /sin\s+certificaci[oó]n/i
                }
              });
            }

            if (activeCertificationFilter.mode === 'term') {
              altFilters.push({
                certificaciones_protecciones: buildSearchRegex(activeCertificationFilter.value)
              });
            }

            const altFilter = altFilters.length <= 1 ? (altFilters[0] || {}) : { $and: altFilters };
            productos = await Product.find(altFilter)
              .sort({ name: 1, _id: 1 })
              .limit(PAGE_SIZE);
            total = await Product.countDocuments(altFilter);
          }
        }
      } catch (dbError) {
        console.error(`❌ Database error searching for "${productParam}":`, dbError.message);
        productos = [];
        total = 0;
      }
    } else {
      // Sin parámetro de producto, búsqueda normal por filtros
      if (categoryFilter) {
        andFilters.push({ category: categoryFilter });
      }

      if (regionFilter) {
        andFilters.push(buildLocationClause(regionFilter));
      }

      if (activeCertificationFilter.mode === 'any') {
        andFilters.push({
          certificaciones_protecciones: {
            $regex: /[a-zA-Z0-9ÁÉÍÓÚÜÑáéíóúüñ]/,
            $not: /sin\s+certificaci[oó]n/i
          }
        });
      }

      if (activeCertificationFilter.mode === 'term') {
        andFilters.push({
          certificaciones_protecciones: buildSearchRegex(activeCertificationFilter.value)
        });
      }

      const filter = andFilters.length <= 1 ? (andFilters[0] || {}) : { $and: andFilters };
      total = await Product.countDocuments(filter);
      productos = await Product.find(filter)
        .sort({ name: 1, _id: 1 })
        .limit(PAGE_SIZE);
    }

    const productCriteria = stripLeadingConjunction(productParam);
    const normalizedProductCriteria = normalizeComparableText(productCriteria);
    const normalizedRegionCriteria = normalizeComparableText(regionFilter);
    const normalizedCategoryCriteria = normalizeComparableText(categoryFilter);
    const normalizedCertificationCriteria = normalizeComparableText(activeCertificationFilter.value || activeCertificationFilter.label);
    const hasSpecificProductSearch = Boolean(normalizedProductCriteria);
    const includeProductCriteria = Boolean(productCriteria)
      && normalizedProductCriteria !== normalizedRegionCriteria
      && (!hasCategoryFilter || !normalizedCategoryCriteria.includes(normalizedProductCriteria))
      && (!hasCertificationFilter || normalizedProductCriteria !== normalizedCertificationCriteria);

    const criteriaParts = [];
    if (includeProductCriteria) criteriaParts.push(productCriteria);
    if (regionFilter) criteriaParts.push(`en ${regionFilter}`);
    if (categoryFilter) criteriaParts.push(`categoría ${categoryFilter}`);
    if (activeCertificationFilter.label) criteriaParts.push(activeCertificationFilter.label);
    const criteriaText = humanJoin(criteriaParts);
    const isNearRefinementStage = shouldApplyNearFilter && (hasCategoryFilter || hasCertificationFilter);
    const isNearFinalRefinementStage = shouldApplyNearFilter && hasCategoryFilter && hasCertificationFilter;

    // ✅ Mensaje natural y variado
    const fulfillmentText = (productParam && !categoryFilter && activeCertificationFilter.mode === 'none')
      ? MensajesNaturales.productosEncontrados(productos.length, productParam)
      : `Encontré ${total} producto${total === 1 ? '' : 's'}${criteriaText ? ` con ${criteriaText}` : ''}${total > productos.length ? `. Te muestro los primeros ${productos.length}:` : ':'}`;

    if (!productos.length) {
      const emptyText = criteriaText
        ? `No encontré productos con ${criteriaText}.`
        : MensajesNaturales.sinResultados(productParam || 'ese filtro');
      const responseText = isClearFiltersCommand
        ? 'He quitado los filtros de categoría y certificación. ¿Quieres ver todos los productos?'
        : (clearFiltersText ? `${clearFiltersText} ${emptyText}` : emptyText);

      return res.json({
        fulfillmentText: responseText,
        fulfillmentMessages: [
          { text: { text: [responseText] } },
          {
            payload: {
              richContent: [[
                {
                  type: "chips",
                  options: isClearFiltersCommand
                    ? [
                        { text: 'Ver todos los productos' },
                        { text: 'Ver productos populares' },
                        { text: 'Conectar con artesanos' }
                      ]
                    : isNearFinalRefinementStage
                    ? [
                        { text: 'Quitar filtros' },
                        { text: 'Ver todos los productos' },
                        { text: 'Conectar con artesanos' }
                      ]
                    : isNearRefinementStage
                    ? [
                        ...(hasCategoryFilter ? [] : [{ text: 'Filtrar por categoría' }]),
                        ...(hasCertificationFilter ? [] : [{ text: 'Solo con certificación' }]),
                        { text: 'Quitar filtros' },
                        { text: 'Ver todos los productos' },
                        { text: 'Conectar con artesanos' }
                      ]
                    : [
                        { text: "Filtrar por categoría" },
                        { text: "Solo con certificación" },
                        ...(categoryFilter || activeCertificationFilter.mode !== 'none' ? [{ text: 'Quitar filtros' }] : []),
                        ...(shouldApplyNearFilter ? [] : [{ text: "Productos cerca de mí" }]),
                        { text: 'Conectar con artesanos' },
                        { text: "Ver productos populares" },
                        { text: "Explorar por provincia" }
                      ]
                }
              ]]
            }
          }
        ],
        outputContexts: [
          ctx.createContext('buscando-productos', {
            producto: productParam || '',
            region: regionFilter || '',
            tipo_producto: productParam || '',
            categoria: categoryFilter || '',
            certificacion: activeCertificationFilter.mode === 'none'
              ? ''
              : (activeCertificationFilter.mode === 'any' ? 'oficial' : activeCertificationFilter.value),
            esperando_categoria: false,
            filtro_cercania_activo: shouldApplyNearFilter,
            ultima_busqueda: 'productos-filtrados',
            offset: 0,
            total: 0,
            resultados_count: 0
          }, 10)
        ]
      });
    }

    const richContent = productos.map(p => ({
      type: 'info',
      title: p.name,
      subtitle: `${p.address_text || p.city || 'España'}${p.certificaciones_protecciones ? ` • ${p.certificaciones_protecciones}` : ''}`,
      image: { src: { rawUrl: getImageUrl(p) } },
      actionLink: `http://localhost:4200/producto/${p.slug}`
    }));

    // ✅ Sugerencias proactivas
    const sugerencias = SugerenciasProactivas.despuesDeProductos(
      productParam,
      null,
      productos.length
    );

    const hasMore = productos.length < total;
    const chipsOptions = [];
    if (isClearFiltersCommand) {
      chipsOptions.push({ text: 'Ver todos los productos' });
      chipsOptions.push({ text: 'Ver productos populares' });
      chipsOptions.push({ text: 'Conectar con artesanos' });
    } else if (isNearFinalRefinementStage) {
      if (hasMore) chipsOptions.push({ text: 'Ver más productos' });
      if (hasSpecificProductSearch) chipsOptions.push({ text: 'Ver productos similares' });
      chipsOptions.push({ text: 'Quitar filtros' });
      chipsOptions.push({ text: 'Ver todos los productos' });
      chipsOptions.push({ text: 'Conectar con artesanos' });
    } else if (isNearRefinementStage) {
      if (hasMore) chipsOptions.push({ text: 'Ver más productos' });
      if (hasSpecificProductSearch) chipsOptions.push({ text: 'Ver productos similares' });
      if (!hasCategoryFilter) chipsOptions.push({ text: 'Filtrar por categoría' });
      if (!hasCertificationFilter) chipsOptions.push({ text: 'Solo con certificación' });
      chipsOptions.push({ text: 'Quitar filtros' });
      chipsOptions.push({ text: 'Ver todos los productos' });
      chipsOptions.push({ text: 'Conectar con artesanos' });
    } else {
      if (hasMore) chipsOptions.push({ text: 'Ver más productos' });
      if (hasSpecificProductSearch) chipsOptions.push({ text: 'Ver productos similares' });
      if (!categoryFilter) chipsOptions.push({ text: 'Filtrar por categoría' });
      if (activeCertificationFilter.mode === 'none') chipsOptions.push({ text: 'Solo con certificación' });
      if (categoryFilter || activeCertificationFilter.mode !== 'none') chipsOptions.push({ text: 'Quitar filtros' });
      if (!shouldApplyNearFilter) chipsOptions.push({ text: 'Productos cerca de mí' });
      chipsOptions.push({ text: 'Filtrar por provincia' });
    }

    const chips = {
      type: 'chips',
      options: dedupeChipOptions(chipsOptions, 6)
    };

    const suggestionMessage = /^encontre\s+pocos\s+resultados/i.test(normalizeNoAccents(sugerencias.mensaje))
      ? '¿Quieres ampliar la búsqueda?'
      : sugerencias.mensaje;
    const mensajeCompleto = `${clearFiltersText ? `${clearFiltersText}\n\n` : ''}${fulfillmentText}\n\n${suggestionMessage}`;

    const outputContexts = [
      ctx.createContext('buscando-productos', {
        producto: productParam || '',
        region: regionFilter || '',
        tipo_producto: productParam || '',
        categoria: categoryFilter || '',
        certificacion: activeCertificationFilter.mode === 'none'
          ? ''
          : (activeCertificationFilter.mode === 'any' ? 'oficial' : activeCertificationFilter.value),
        esperando_categoria: false,
        filtro_cercania_activo: shouldApplyNearFilter,
        ultima_busqueda: (categoryFilter || activeCertificationFilter.mode !== 'none') ? 'productos-filtrados' : 'productos',
        offset: productos.length,
        total,
        resultados_count: total
      }, 10),
      ctx.deleteContext('buscando-artesanos')
    ];

    return res.json({
      fulfillmentText: mensajeCompleto,
      fulfillmentMessages: [
        { text: { text: [mensajeCompleto] } },
        { payload: { richContent: [[...richContent, chips]] } }
      ],
      outputContexts: outputContexts
    });

  } catch (error) {
    console.error("Error en buscarProductos:", error);
    return res.json({
      fulfillmentText: MensajesNaturales.error()
    });
  }
};
