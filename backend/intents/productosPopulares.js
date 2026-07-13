// intents/productosPopulares.js
const Product = require('../models/products');
const Stats = require('../models/stats');
const StatsAggregate = require('../models/statsAggregate');
const ContextManager = require('../utils/contextManager');
const moment = require('moment');
const mongoose = require('mongoose');
const {
  normalizeNoAccents,
  cleanConversationalPrefix,
  stripTrailingPunctuation
} = require('../utils/nlp');

const PAGE_SIZE = 5;

const CATEGORY_ALIASES = [
  { alias: 'alimentacion', value: 'Alimentación' },
  { alias: 'alimentacion y gastronomia', value: 'Alimentación' },
  { alias: 'comida', value: 'Alimentación' },
  { alias: 'gastronomia', value: 'Alimentación' },
  { alias: 'textil', value: 'Textil' },
  { alias: 'ropa', value: 'Textil' },
  { alias: 'barro', value: 'Barro y Alfarería' },
  { alias: 'alfareria', value: 'Barro y Alfarería' },
  { alias: 'ceramica', value: 'Barro y Alfarería' },
  { alias: 'madera', value: 'Madera y mueble' },
  { alias: 'mueble', value: 'Madera y mueble' },
  { alias: 'muebles', value: 'Madera y mueble' }
];

const GENERIC_RECOMMENDATION_TERMS = new Set([
  'producto', 'productos', 'algo', 'alguno', 'algunos', 'artesanal', 'artesanales',
  'recomendacion', 'recomendaciones', 'categoria', 'categorias', 'mejor', 'mejores'
]);

const RECOMMENDATION_STOPWORDS = new Set([
  'que', 'me', 'hazme', 'dame', 'quiero', 'una', 'un', 'algun', 'alguna',
  'por', 'favor', 'porfa', 'de', 'la', 'el', 'los', 'las', 'sobre', 'para',
  'del', 'al', 'algo', 'productos', 'producto', 'categoria', 'categorias',
  'recomendacion', 'recomendaciones', 'recomiendame', 'recomienda', 'recomiendas'
]);

const escapeRegExp = (value = '') => `${value}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildRecommendationLabels = ({ categoryRecommendation, productRecommendation, regionParam }) => {
  const hasCategory = Boolean(categoryRecommendation);
  const hasProduct = Boolean(productRecommendation);

  const moreText = hasCategory
    ? `Ver más de ${categoryRecommendation}`
    : (hasProduct ? `Ver más sobre ${productRecommendation}` : 'Ver más productos populares');

  const provinceText = regionParam
    ? 'Ver recomendaciones en otra provincia'
    : 'Filtrar por provincia';

  const changeCriteriaText = hasCategory
    ? 'Cambiar de categoría'
    : (hasProduct ? 'Cambiar de producto' : 'Buscar producto específico');

  return { moreText, provinceText, changeCriteriaText };
};

const detectCategoryFromText = (rawText = '') => {
  const normalized = normalizeNoAccents(rawText);
  if (!normalized) return '';

  for (const item of CATEGORY_ALIASES) {
    const rx = new RegExp(`(^|\\b)${escapeRegExp(item.alias)}(\\b|$)`, 'i');
    if (rx.test(normalized)) return item.value;
  }

  return '';
};

const looksLikeCategoryValue = (rawValue = '') => {
  const normalized = normalizeNoAccents(rawValue);
  if (!normalized) return false;

  if (CATEGORY_ALIASES.some((item) => normalizeNoAccents(item.alias) === normalized)) {
    return true;
  }

  return CATEGORY_ALIASES.some((item) => normalizeNoAccents(item.value) === normalized);
};

const extractRecommendationProductTerm = (rawText = '') => {
  const normalized = normalizeNoAccents(cleanConversationalPrefix(stripTrailingPunctuation(rawText)))
    .replace(/[?.!,;:]+/g, ' ')
    .replace(/\b(que|qué)\s+me\s+recomiendas\b/g, ' ')
    .replace(/\brecomiendame\b/g, ' ')
    .replace(/\brecomiendame\s+productos?\b/g, ' ')
    .replace(/\brecomiendame\s+algo\b/g, ' ')
    .replace(/\bme\s+recomiendas\b/g, ' ')
    .replace(/\brecomendaciones?\s+de\b/g, '')
    .replace(/\bproductos?\s+de\s+la\s+categoria\s+[^,.;]+/g, '')
    .replace(/\bproductos?\s+de\s+categoria\s+[^,.;]+/g, '')
    .replace(/\bde\s+la\s+categoria\s+[^,.;]+/g, '')
    .replace(/\bde\s+categoria\s+[^,.;]+/g, '')
    .replace(/\bproductos?\s+de\b/g, '')
    .replace(/\bde\b/g, ' ')
    .replace(/\bsobre\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return '';
  if (GENERIC_RECOMMENDATION_TERMS.has(normalized)) return '';

  const tokens = normalized
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length > 2)
    .filter((t) => !RECOMMENDATION_STOPWORDS.has(t));

  if (!tokens.length) return '';

  return tokens.join(' ');
};

/**
 * Obtiene los N productos más populares basado en estadísticas reales (clicks: product_modal_open)
 * Intenta usar datos agregados recientes para máximo rendimiento,
 * con fallback a Stats en tiempo real si no encuentra agregados
 */
const getPopularProductIds = async (limit = 20) => {
  try {
    // 1. Intentar obtener datos agregados recientes (hoy, ayer, esta semana)
    const periodsTryOrder = ['hoy', 'dia', 'semana'];
    let aggregateData = null;

    for (const periodo of periodsTryOrder) {
      const agg = await StatsAggregate.findOne({ periodo })
        .sort({ fechaInicio: -1 })
        .lean();

      if (agg?.datos?.productAnalytics) {
        aggregateData = agg.datos.productAnalytics;
        break;
      }
    }

    // 2. Si hay datos agregados, usarlos
    if (aggregateData && Object.keys(aggregateData).length > 0) {
      const productStatsArray = Object.entries(aggregateData)
        .map(([productId, stats]) => ({
          productId,
          clicks: stats.clicks || 0,
          avgDuration: stats.avgDuration || 0
        }))
        .sort((a, b) => b.clicks - a.clicks) // Ordenar por clicks descendente
        .slice(0, limit);


      return productStatsArray.map(p => p.productId);
    }

    // 3. Fallback: contar clicks en tiempo real de los últimos 7 días
    const sevenDaysAgo = moment().subtract(7, 'days').toDate();
    const statsData = await Stats.aggregate([
      {
        $match: {
          tipo: 'product_modal_open',
          fecha: { $gte: sevenDaysAgo },
          producto: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: '$producto',
          clicks: { $sum: 1 }
        }
      },
      {
        $sort: { clicks: -1 }
      },
      {
        $limit: limit
      }
    ]);

    if (statsData.length > 0) {
      return statsData.map(s => s._id);
    }

    return [];

  } catch (error) {
    console.error('❌ Error obteniendo productos populares:', error);
    return [];
  }
};

module.exports = async(req, res) => {
  try {
    const ctx = new ContextManager(req);
    const rawRegionParam = `${ctx.getParam('buscando-productos', 'region') || ''}`.trim();
    const rawQueryText = `${req.body?.queryResult?.queryText || ''}`.trim();
    const normalizedQuery = normalizeNoAccents(rawQueryText);
    const isRecommendationRequest = /recomend|recomiend/.test(normalizedQuery);
    const storedLastSearch = normalizeNoAccents(ctx.getParam('buscando-productos', 'ultima_busqueda') || '');
    const isMorePopularRequest = /^(ver\s+mas\s+productos\s+populares|ver\s+mas\s+populares|mas\s+productos\s+populares)$/.test(normalizedQuery)
      || ((normalizedQuery === 'ver mas' || normalizedQuery === 'mas') && storedLastSearch === 'populares');
    const storedOffset = Number(ctx.getParam('buscando-productos', 'offset'));
    const offset = isMorePopularRequest && Number.isFinite(storedOffset) && storedOffset > 0 ? storedOffset : 0;

    const categoryRecommendation = isRecommendationRequest ? detectCategoryFromText(rawQueryText) : '';
    const productRecommendationRaw = isRecommendationRequest ? extractRecommendationProductTerm(rawQueryText) : '';
    const productRecommendation = categoryRecommendation ? '' : productRecommendationRaw;
    const regionLooksLikeCategory = looksLikeCategoryValue(rawRegionParam)
      || (categoryRecommendation && normalizeNoAccents(rawRegionParam) === normalizeNoAccents(categoryRecommendation));
    const regionParam = regionLooksLikeCategory ? '' : rawRegionParam;

    // Obtener IDs de productos más populares (basado en estadísticas reales)
    const popularProductIds = await getPopularProductIds(30);

    const popularIdStrings = popularProductIds
      .map((id) => `${id}`)
      .filter(Boolean);
    const popularObjectIds = popularIdStrings
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (!popularObjectIds.length) {
      // Si no hay datos de popularidad, retornar mensaje informativo
      return res.json({
        fulfillmentText: "En este momento no tengo datos sobre productos populares. ¿Quieres buscar algo específico o explorar por provincia?"
      });
    }

    // Construir filtro base: populares + activos + (opcional) categoría/producto
    const baseFilter = {
      _id: { $in: popularObjectIds },
      active: true
    };

    if (categoryRecommendation) {
      baseFilter.category = categoryRecommendation;
    }

    if (productRecommendation) {
      const productRegex = new RegExp(escapeRegExp(productRecommendation), 'i');
      baseFilter.name = productRegex;
    }

    const filter = { ...baseFilter };

    // Si hay región, filtrar también por región
    if (regionParam) {
      filter.$or = [
        { province: new RegExp(regionParam, "i") },
        { autonomous_community: new RegExp(regionParam, "i") },
        { city: new RegExp(regionParam, "i") },
        { address_text: new RegExp(regionParam, "i") }
      ];
    }

    // Buscar los productos populares ordenados por popularidad (usando el orden de popularProductIds)
    // Para mantener el orden, usamos agregación con $in que preserva orden después de proyecto
    const total = await Product.countDocuments(filter);

    const productos = await Product.aggregate([
      { $match: filter },
      {
        $addFields: {
          // Crear índice de orden basado en la posición en popularProductIds
          order: {
            $indexOfArray: [popularIdStrings, { $toString: '$_id' }]
          }
        }
      },
      { $sort: { order: 1 } }, // Ordenar por la posición original
      { $skip: offset },
      { $limit: PAGE_SIZE }
    ]);

    if (!productos || productos.length === 0) {
      if (isMorePopularRequest && total > 0 && offset >= total) {
        const txt = 'Ya te mostré todos los productos populares disponibles.';
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
                      { text: 'Ver todos los productos' },
                      { text: 'Ver productos populares' }
                    ]
                  }
                ]]
              }
            }
          ],
          outputContexts: [
            ctx.createContext('buscando-productos', {
              ultima_busqueda: 'populares',
              region: regionParam || '',
              categoria: categoryRecommendation || '',
              producto: productRecommendation || '',
              offset,
              total,
              resultados_count: total
            }, 10)
          ]
        });
      }

      // Si no hay productos populares en la región, buscar cualquier popular
      if (regionParam) {
        const totalGlobal = await Product.countDocuments(baseFilter);
        const productosGlobales = await Product.aggregate([
          {
            $match: baseFilter
          },
          {
            $addFields: {
              order: { $indexOfArray: [popularIdStrings, { $toString: '$_id' }] }
            }
          },
          { $sort: { order: 1 } },
          { $skip: offset },
          { $limit: PAGE_SIZE }
        ]);

        if (productosGlobales.length > 0) {
          const recommendationCriteriaText = categoryRecommendation
            ? ` de la categoría ${categoryRecommendation}`
            : (productRecommendation ? ` relacionados con ${productRecommendation}` : '');
          const mensaje = isRecommendationRequest
            ? `Te recomiendo productos populares${recommendationCriteriaText} (no encontré en ${regionParam}):`
            : `Te muestro productos artesanales populares (no encontré en ${regionParam}):`;
          const labels = buildRecommendationLabels({
            categoryRecommendation,
            productRecommendation,
            regionParam: ''
          });
          const richContent = productosGlobales.map(p => ({
            type: "info",
            title: p.name,
            subtitle: `${p.city || p.province || 'España'} • ${p.certificaciones_protecciones || 'Artesanía'}`,
            image: p.media && p.media.length > 0 ? { src: { rawUrl: p.media[0] } } : undefined,
            actionLink: `https://noma.com/producto/${p.slug}`
          }));

          const chips = {
            type: "chips",
            options: [
              ...(offset + productosGlobales.length < totalGlobal ? [{ text: labels.moreText }] : []),
              { text: labels.provinceText },
              { text: labels.changeCriteriaText }
            ]
          };

          const nextOffsetGlobal = offset + productosGlobales.length;

          return res.json({
            fulfillmentText: mensaje,
            fulfillmentMessages: [
              { text: { text: [mensaje] } },
              { payload: { richContent: [[...richContent, chips]] } }
            ],
            outputContexts: [
              ctx.createContext('buscando-productos', {
                ultima_busqueda: 'populares',
                region: '',
                categoria: categoryRecommendation || '',
                producto: productRecommendation || '',
                offset: nextOffsetGlobal,
                total: totalGlobal,
                resultados_count: totalGlobal
              }, 10)
            ]
          });
        }
      }

      return res.json({
        fulfillmentText: "No encontré productos populares con esos criterios. ¿Quieres cambiar categoría, buscar otro producto o ver otras provincias?"
      });
    }

    // Construir respuesta con los productos populares encontrados
    const regionText = regionParam ? ` en ${regionParam}` : '';
    const recommendationCriteriaText = categoryRecommendation
      ? ` de la categoría ${categoryRecommendation}`
      : (productRecommendation ? ` relacionados con ${productRecommendation}` : '');
    const mensaje = isRecommendationRequest
      ? `Te recomiendo los productos más populares${recommendationCriteriaText}${regionText} (basado en interés real de usuarios):`
      : `Te muestro los productos más populares${regionText} (basado en interés real de usuarios):`;

    const richContent = productos.map(p => ({
      type: "info",
      title: p.name,
      subtitle: `${p.city || p.province || 'España'} • ${p.certificaciones_protecciones || 'Artesanía'}`,
      image: p.media && p.media.length > 0 ? { src: { rawUrl: p.media[0] } } : undefined,
      actionLink: `https://noma.com/producto/${p.slug}`
    }));

    const labels = buildRecommendationLabels({
      categoryRecommendation,
      productRecommendation,
      regionParam
    });

    const nextOffset = offset + productos.length;
    const hasMore = nextOffset < total;

    const chips = {
      type: "chips",
      options: [
        ...(hasMore ? [{ text: labels.moreText }] : []),
        { text: labels.provinceText },
        { text: labels.changeCriteriaText }
      ]
    };

    return res.json({
      fulfillmentText: mensaje,
      fulfillmentMessages: [
        { text: { text: [mensaje] } },
        { payload: { richContent: [[...richContent, chips]] } }
      ],
      outputContexts: [
        ctx.createContext('buscando-productos', {
          ultima_busqueda: 'populares',
          region: regionParam || '',
          categoria: categoryRecommendation || '',
          producto: productRecommendation || '',
          offset: nextOffset,
          total,
          resultados_count: total
        }, 10)
      ]
    });

  } catch (error) {
    console.error("❌ Error en productosPopulares:", error);
    return res.json({
      fulfillmentText: "Hubo un error mostrando productos populares. Por favor, intenta de nuevo."
    });
  }
};