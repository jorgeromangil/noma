const User = require('../models/users');
const Product = require('../models/products');
const ContextManager = require('../utils/contextManager');
const { coerceToText, normalizeNoAccents } = require('../utils/nlp');

const PAGE_SIZE = 5;

const escapeRegExp = (value) => `${value ?? ''}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildLooseSpanishRegex = (value) => {
  const base = `${value ?? ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

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

const toTitle = (value) => {
  const str = `${value || ''}`.trim();
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
};

const getProductSearchTerms = (value) => {
  const normalized = `${value || ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  if (!normalized) return [];

  const aliases = {
    ceramica: ['ceram', 'alfarer', 'barro'],
    alfareria: ['alfarer', 'ceram', 'barro'],
    barro: ['barro', 'alfarer', 'ceram'],
    vino: ['vino'],
    queso: ['queso', 'lacteo'],
    miel: ['miel'],
    aceite: ['aceite', 'oliva'],
    turron: ['turron', 'turrón']
  };

  return Array.from(new Set([normalized, ...(aliases[normalized] || [])]));
};

const buildProductMatchFilter = (value) => {
  const terms = getProductSearchTerms(value);
  if (!terms.length) return null;

  // Campos de alta precisión para evitar falsos positivos al buscar tipo de producto.
  const fields = [
    'name',
    'resumen',
    'category'
  ];

  return {
    $or: terms.flatMap((term) => {
      const loose = buildLooseSpanishRegex(term);
      const rx = new RegExp(loose || escapeRegExp(term), 'i');
      return fields.map((field) => ({ [field]: rx }));
    })
  };
};

const normalize = (value) => normalizeNoAccents(value);

const isGenericArtisanIntentQuery = (value) => {
  const q = normalize(value);
  if (!q) return false;

  return /^(quiero\s+)?(conocer|conectar\s+con|ver|buscar|mostrar)(\s+a\s+los)?\s+artesan(?:o|os)$/.test(q)
    || /^(conectar\s+con|conocer)\s+artesan(?:o|os)\s+locales$/.test(q)
    || /^(ver|mostrar)\s+todos\s+los\s+artesan(?:o|os)$/.test(q)
    || /^todos\s+los\s+artesan(?:o|os)$/.test(q);
};

const isAmbiguousFilterValue = (value) => {
  const q = normalize(value);
  if (!q) return true;
  if (q.length < 2) return true;

  // Evita que conectores sueltos se interpreten como producto
  // (ej: "en", "de") y acaben en mensajes tipo "en en en Zamora".
  if (/^(en|de|del|al|la|el|los|las|un|una)$/.test(q)) {
    return true;
  }

  if (/^(conocer|quiero|buscar|ver|mostrar|otra|ciudad|provincia|artesano|artesanos|producto|productos)$/.test(q)) {
    return true;
  }

  if (/^(quiero\s+conocer|quiero\s+ver|quiero\s+buscar|conocer\s+a\s+los)\b/.test(q)) {
    return true;
  }

  return false;
};

const buildArtisanRecoveryChips = () => ([
  { text: 'Otra provincia' },
  { text: 'Ver todos los artesanos' },
  { text: 'Artesanos en Madrid' },
  { text: 'Artesanos en Valencia' }
]);

const looksLikeSimpleLocationReply = (value) => {
  const q = normalize(value);
  if (!q || q.length > 50) return false;
  return !/^(buscar|filtrar|otra|quiero|ver|mostrar|artesanos|productos|ayuda|como|que)\b/.test(q);
};

const toNonNegativeInt = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

const buildArtisanLocationClause = (locationValue) => {
  const locationRegex = new RegExp(escapeRegExp(locationValue), 'i');
  return {
    $or: [
      { province: locationRegex },
      { address_text: locationRegex },
      { city: locationRegex }
    ]
  };
};

const resolveSearchTermsFromQuery = async ({ rawQueryText, currentProductRaw, currentLocationRaw }) => {
  const stripped = coerceToText(rawQueryText).replace(/[?.!,;:]+$/g, '').trim();
  if (!stripped) {
    return { mode: 'none', product: '', location: '' };
  }

  const normalized = normalize(stripped);
  if (/^(ver\s+todos\s+los\s+artesanos|todos\s+los\s+artesanos|ver\s+artesanos)$/.test(normalized)) {
    return { mode: 'all', product: '', location: '' };
  }

  let match = stripped.match(/artesan(?:o|os)\s+de\s+(.+?)\s+en\s+(.+)$/i);
  if (!match) {
    match = stripped.match(/que\s+hagan\s+(.+?)\s+en\s+(.+)$/i);
  }
  if (match) {
    return {
      mode: 'both',
      product: coerceToText(match[1]),
      location: coerceToText(match[2])
    };
  }

  match = stripped.match(/artesan(?:o|os)(?:\s+disponibles?)?\s+en\s+(.+)$/i);
  if (match) {
    return {
      mode: 'location-only',
      product: '',
      location: coerceToText(match[1])
    };
  }

  match = stripped.match(/que\s+hagan\s+(.+)$/i);
  if (match) {
    return {
      mode: 'product-only',
      product: coerceToText(match[1]),
      location: ''
    };
  }

  match = stripped.match(/artesan(?:o|os)\s+de\s+(.+)$/i);
  if (!match || !match[1]) {
    return { mode: 'none', product: '', location: '' };
  }

  const candidate = coerceToText(match[1]);
  if (!candidate) {
    return { mode: 'none', product: '', location: '' };
  }

  const locationClause = buildArtisanLocationClause(candidate);
  const locationHits = await User.countDocuments({ role: 'artisan', active: { $ne: false }, ...locationClause });

  const productFilter = buildProductMatchFilter(candidate);
  const productHits = productFilter ? await Product.countDocuments(productFilter) : 0;

  if (locationHits > 0 && productHits === 0) {
    return {
      mode: 'location-only',
      product: '',
      location: candidate
    };
  }

  if (productHits > 0 && locationHits === 0) {
    return {
      mode: 'product-only',
      product: candidate,
      location: ''
    };
  }

  if (productHits > 0 && locationHits > 0) {
    if (currentLocationRaw && !currentProductRaw) {
      return {
        mode: 'location-only',
        product: '',
        location: candidate
      };
    }

    return {
      mode: 'product-only',
      product: candidate,
      location: ''
    };
  }

  if (currentProductRaw && !currentLocationRaw) {
    return {
      mode: 'product-only',
      product: candidate,
      location: ''
    };
  }

  if (currentLocationRaw && !currentProductRaw && locationHits > 0) {
    return {
      mode: 'location-only',
      product: '',
      location: candidate
    };
  }

  return {
    mode: 'product-only',
    product: candidate,
    location: ''
  };
};

module.exports = async (req, res) => {
  try {
    const ctx = new ContextManager(req);
    const rawQueryText = coerceToText(req.body?.queryResult?.queryText);
    const normalizedQuery = normalize(rawQueryText);


    let currentLocationRaw =
      coerceToText(ctx.parameters.province) ||
      coerceToText(ctx.parameters.region) ||
      coerceToText(ctx.parameters.city) ||
      coerceToText(ctx.parameters.ciudad);

    let currentProductRaw =
      coerceToText(ctx.parameters.product) ||
      coerceToText(ctx.parameters.producto);

    let contextLocationRaw =
      coerceToText(ctx.getParam('buscando-artesanos', 'region')) ||
      coerceToText(ctx.getParam('buscando-productos', 'province')) ||
      coerceToText(ctx.getParam('buscando-productos', 'region'));

    let contextProductRaw =
      coerceToText(ctx.getParam('buscando-artesanos', 'producto')) ||
      coerceToText(ctx.getParam('buscando-productos', 'product')) ||
      coerceToText(ctx.getParam('buscando-productos', 'producto'));

    if (isGenericArtisanIntentQuery(rawQueryText)) {
      currentLocationRaw = '';
      currentProductRaw = '';
      contextLocationRaw = '';
      contextProductRaw = '';
    }

    if (isAmbiguousFilterValue(currentLocationRaw)) currentLocationRaw = '';
    if (isAmbiguousFilterValue(currentProductRaw)) currentProductRaw = '';
    if (isAmbiguousFilterValue(contextLocationRaw)) contextLocationRaw = '';
    if (isAmbiguousFilterValue(contextProductRaw)) contextProductRaw = '';

    const contextOffset = toNonNegativeInt(ctx.getParam('buscando-artesanos', 'offset'));
    const isVerMasArtesanos = /^(ver\s+mas\s+artesanos|mas\s+artesanos)$/.test(normalizedQuery);

    const askingForAnotherCity = /^(buscar\s+por\s+ciudad|filtrar\s+por\s+ciudad|otra\s+ciudad|buscar\s+otra\s+ciudad|buscar\s+por\s+provincia|filtrar\s+por\s+provincia|otra\s+provincia|buscar\s+otra\s+provincia|cambiar\s+provincia)$/i.test(normalizedQuery);
    if (askingForAnotherCity) {
      const rememberedProduct = currentProductRaw || contextProductRaw;
      const txt = rememberedProduct
        ? `¿De qué ciudad o provincia quieres ver artesanos de ${rememberedProduct}?`
        : '¿De qué ciudad o provincia quieres ver artesanos?';

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
                    { text: 'La Rioja' },
                    { text: 'Valencia' },
                    { text: 'Madrid' },
                    { text: 'Sevilla' }
                  ]
                }
              ]]
            }
          }
        ],
        outputContexts: [
          ctx.createContext('buscando-artesanos', {
            producto: rememberedProduct || '',
            region: '',
            esperando_region: true,
            tipo_busqueda: 'artesanos',
            ultima_busqueda: 'pedir-region-artesanos'
          }, 10)
        ]
      });
    }

    const resolvedFromQuery = await resolveSearchTermsFromQuery({
      rawQueryText,
      currentProductRaw,
      currentLocationRaw
    });

    // Resolver de forma explícita 3 casos: solo producto, solo localidad y ambos.
    let locationRaw = '';
    let productRaw = '';

    if (resolvedFromQuery.mode === 'both') {
      productRaw = resolvedFromQuery.product || currentProductRaw;
      locationRaw = resolvedFromQuery.location || currentLocationRaw;
    } else if (resolvedFromQuery.mode === 'all') {
      productRaw = '';
      locationRaw = '';
    } else if (resolvedFromQuery.mode === 'product-only') {
      productRaw = resolvedFromQuery.product || currentProductRaw;
      locationRaw = '';
    } else if (resolvedFromQuery.mode === 'location-only') {
      locationRaw = resolvedFromQuery.location || currentLocationRaw;
      productRaw = '';
    } else {
      locationRaw = currentLocationRaw;
      productRaw = currentProductRaw;
    }

    const waitingArtisanRegion = ctx.getParam('buscando-artesanos', 'esperando_region') === true;
    if (!locationRaw && waitingArtisanRegion && looksLikeSimpleLocationReply(rawQueryText)) {
      locationRaw = rawQueryText;
    }

    // Solo heredamos producto del contexto si la consulta actual no forzó ubicación/producto.
    if (!productRaw && resolvedFromQuery.mode === 'none') {
      productRaw = contextProductRaw;
    }

    // Solo heredamos ubicación del contexto cuando no hay señal explícita en la consulta.
    if (!locationRaw && !productRaw && resolvedFromQuery.mode === 'none') {
      locationRaw = contextLocationRaw;
    }

    const locationParam = locationRaw ? locationRaw.toLowerCase() : '';
    const productParam = productRaw ? productRaw.toLowerCase() : '';


    const queryClauses = [
      {
        role: 'artisan',
        active: { $ne: false }
      }
    ];

    // Filtrar por ubicación si se especifica (provincia/dirección/compatibilidad city).
    if (locationParam) {
      const locationRegex = new RegExp(escapeRegExp(locationParam), 'i');
      queryClauses.push({
        $or: [
        { province: locationRegex },
        { address_text: locationRegex },
        { city: locationRegex }
        ]
      });
    }

    // Si el usuario pide un tipo de artesano, buscar por texto del perfil y por productos asociados.
    if (productParam) {
      const productFilter = buildProductMatchFilter(productParam);

      let ownerIds = [];
      if (productFilter) {
        const productosRelacionados = await Product.find({
          ...productFilter,
          active: { $ne: false }
        })
          .select('owner')
          .limit(200)
          .lean();

        ownerIds = Array.from(new Set(
          productosRelacionados
            .map((p) => p.owner && String(p.owner))
            .filter(Boolean)
        ));
      }

      // Regla estricta: si se pide producto, solo artesanos que tengan ese producto.
      queryClauses.push({ _id: { $in: ownerIds } });
    }

    const filter = queryClauses.length === 1 ? queryClauses[0] : { $and: queryClauses };
    const offset = isVerMasArtesanos ? contextOffset : 0;
    const total = await User.countDocuments(filter);

    // Buscar artesanos según filtro
    let artesanos = await User.find(filter)
      .select('name surname company_name description province contact address_text image slug')
      .sort({ company_name: 1, name: 1, _id: 1 })
      .skip(offset)
      .limit(PAGE_SIZE);

    const nextOffset = offset + artesanos.length;
    const hasMore = nextOffset < total;

    if (isVerMasArtesanos && offset > 0 && !artesanos.length && total > 0) {
      const txt = 'Ya te mostré todos los artesanos disponibles con esos criterios.';
      return res.json({
        fulfillmentText: txt,
        fulfillmentMessages: [
          { text: { text: [txt] } },
          {
            payload: {
              richContent: [[
                {
                  type: 'chips',
                  options: buildArtisanRecoveryChips()
                }
              ]]
            }
          }
        ],
        outputContexts: [
          ctx.createContext('buscando-artesanos', {
            producto: locationParam && !productParam ? '' : (productParam || ''),
            region: productParam && !locationParam ? '' : (locationParam || ''),
            esperando_region: false,
            tipo_busqueda: 'artesanos',
            ultima_busqueda: 'artesanos',
            offset,
            total,
            resultados_count: total
          }, 10)
        ]
      });
    }

    // 🔧 DEBUG: Ver si hay artesanos SIN el filtro de aprobación
    if (artesanos.length === 0 && offset === 0) {
      const todosArtesanos = await User.find({ role: 'artisan', active: { $ne: false } }).select('name artisanStatus').limit(5);
    }

    // Mensaje si no se encuentra ningún artesano
    if (!artesanos.length) {
      let mensaje = "No encontré artesanos";
      if (productParam) mensaje += ` especializados en ${productParam}`;
      if (locationParam) mensaje += ` en ${toTitle(locationParam)}`;
      mensaje += ". ¿Quieres probar con otra provincia o ver todos los artesanos?";

      return res.json({
        fulfillmentText: mensaje,
        fulfillmentMessages: [
          { text: { text: [mensaje] } },
          {
            payload: {
              richContent: [[
                {
                  type: "chips",
                  options: buildArtisanRecoveryChips()
                }
              ]]
            }
          }
        ],
        outputContexts: [
          ctx.createContext('buscando-artesanos', {
            producto: productParam || '',
            region: locationParam || '',
            esperando_region: false,
            tipo_busqueda: 'artesanos',
            ultima_busqueda: 'artesanos',
            offset: 0,
            total: 0,
            resultados_count: 0
          }, 10)
        ]
      });
    }

    // Mensaje principal
    let fulfillmentText = '';
    const specializationLabel = total === 1 ? ' especializado en ' : ' especializados en ';
    if (offset > 0) {
      fulfillmentText = `Aquí tienes ${artesanos.length} artesano${artesanos.length > 1 ? 's' : ''} más`;
      if (productParam) fulfillmentText += `${specializationLabel}${productParam}`;
      if (locationParam) fulfillmentText += ` en ${toTitle(locationParam)}`;
      fulfillmentText += ` (${nextOffset}/${total}):`;
    } else {
      fulfillmentText = `Encontré ${total} artesano${total !== 1 ? 's' : ''}`;
      if (productParam) fulfillmentText += `${specializationLabel}${productParam}`;
      if (locationParam) fulfillmentText += ` en ${toTitle(locationParam)}`;
      fulfillmentText += total > artesanos.length ? `. Te muestro los primeros ${artesanos.length}:` : ':';
    }

    // Cards de artesanos (página actual)
    const richContent = artesanos.map((a) => ({
      type: "info",
      title: a.company_name || `${a.name} ${a.surname}`,
      subtitle: `${a.province || a.address_text || 'España'}${a.description ? ' • ' + a.description.substring(0, 50) + '...' : ''}`,
      image: a.image ? { src: { rawUrl: a.image } } : undefined,
      actionLink: a.slug ? `https://noma.com/artesano/${a.slug}` : undefined
    }));

    // Chips contextuales - usar provincia del primer artesano si está disponible
    const chipsOptions = [];
    if (hasMore) chipsOptions.push({ text: 'Ver más artesanos' });
    
    // Si hay una provincia específica (no "España" genérico), mostrar opción contextual
    const firstArtisanProvince = artesanos.length > 0 ? (artesanos[0].province || '').toLowerCase() : '';
    const hasSpecificProvince = firstArtisanProvince && firstArtisanProvince !== 'españa' && firstArtisanProvince.trim();
    
    if (hasSpecificProvince) {
      const provinciaCapitalizada = firstArtisanProvince.charAt(0).toUpperCase() + firstArtisanProvince.slice(1);
      chipsOptions.push({ text: `Ver productos de ${provinciaCapitalizada}` });
      chipsOptions.push({ text: 'Otra provincia' });
    } else {
      chipsOptions.push({ text: 'Ver productos' });
    }

    const chips = { type: "chips", options: chipsOptions };

    // Establecer contexto: Cambiar a contexto de artesanos pero mantener info de producto/región
    const outputContexts = [
      ctx.createContext('buscando-artesanos', {
        producto: locationParam && !productParam ? '' : (productParam || ''),
        region: productParam && !locationParam ? '' : (locationParam || ''),
        esperando_region: false,
        tipo_busqueda: 'artesanos',
        ultima_busqueda: 'artesanos',
        offset: nextOffset,
        total,
        resultados_count: total
      }, 10),
      ctx.deleteContext('buscando-productos')
    ];

    return res.json({
      fulfillmentText,
      fulfillmentMessages: [
        { text: { text: [fulfillmentText] } },
        { payload: { richContent: [[...richContent, chips]] } }
      ],
      outputContexts: outputContexts
    });

  } catch (error) {
    console.error("Error en buscarArtesanos:", error);
    return res.json({
      fulfillmentText: "Hubo un error buscando artesanos. Por favor, intenta de nuevo."
    });
  }
};
