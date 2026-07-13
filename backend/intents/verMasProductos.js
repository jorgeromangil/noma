// intents/verMasProductos.js
const Product = require('../models/products');
const ContextManager = require('../utils/contextManager');
const { pluralize, toTitle } = require('../utils/linguistica');

const PAGE_SIZE = 5;
const NEAR_RADIUS_METERS = 120000;
const EARTH_RADIUS_METERS = 6378100;

const escapeRegExp = (value) => `${value ?? ''}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const buildNearbyWithinFilter = (lon, lat) => ({
  location: {
    $geoWithin: {
      $centerSphere: [[lon, lat], NEAR_RADIUS_METERS / EARTH_RADIUS_METERS]
    }
  }
});

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

const buildMoreChipText = ({ categoryParam, productParam }) => {
  if (categoryParam) return `Ver más de ${categoryParam}`;
  if (productParam) return `Ver más sobre ${productParam}`;
  return 'Ver más productos';
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

module.exports = async (req, res) => {
  try {
    const ctx = new ContextManager(req);
    
    // Obtener filtros del contexto (compat con nombres legacy)
    const productParam =
      ctx.getParam('buscando-productos', 'producto') ||
      ctx.getParam('buscando-productos', 'product') ||
      '';

    const regionParam =
      ctx.getParam('buscando-productos', 'region') ||
      ctx.getParam('buscando-productos', 'province') ||
      ctx.getParam('buscando-productos', 'city') ||
      '';

    const categoryParam =
      ctx.getParam('buscando-productos', 'categoria') ||
      ctx.getParam('buscando-productos', 'category') ||
      '';

    const certificationParam =
      ctx.getParam('buscando-productos', 'certificacion') ||
      ctx.getParam('buscando-productos', 'certification') ||
      '';

    const nearModeParam = Boolean(ctx.getParam('buscando-productos', 'filtro_cercania_activo'));
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
    const shouldApplyNearFilter = nearModeParam && hasCoords;

    const certificationNorm = `${certificationParam || ''}`.toLowerCase().trim();
    const hasAnyCertificationFilter = certificationNorm === 'oficial' || certificationNorm === 'certificacion oficial';

    const ultima = ctx.getParam('buscando-productos', 'ultima_busqueda');
    const offsetRaw = ctx.getParam('buscando-productos', 'offset');
    const offsetParsed = Number(offsetRaw);
    const offset = Number.isFinite(offsetParsed) && offsetParsed >= 0 ? Math.floor(offsetParsed) : 0;

    const ultimaNorm = (ultima || '').toString().toLowerCase().trim();
    const totalCtx = ctx.getParam('buscando-productos', 'total') ?? 0;
    const totalCtxNum = Number(totalCtx);
    const hasValidOffset = Number.isFinite(offsetParsed) && offsetParsed > 0;
    const hasPaginationHints = (Number.isFinite(totalCtxNum) && totalCtxNum > 0) || hasValidOffset;

    const isRegionScopedPagination = ['region', 'otros-productos-region', 'cambio-region'].includes(ultimaNorm);


    // ✅ Caso especial: venimos de "Ver productos similares" y queremos más
    if (ultimaNorm === 'similares') {
      let effectiveCategory = `${categoryParam || ''}`.trim();

      if (!effectiveCategory && productParam) {
        const productRx = new RegExp(buildLooseSpanishRegex(productParam) || escapeRegExp(productParam), 'i');
        const reference = await Product.findOne({ name: productRx, active: { $ne: false } }).select('category').lean();
        effectiveCategory = `${reference?.category || ''}`.trim();
      }

      const similarFilter = effectiveCategory
        ? { category: effectiveCategory, active: { $ne: false } }
        : (productParam
          ? { name: new RegExp(buildLooseSpanishRegex(productParam) || escapeRegExp(productParam), 'i'), active: { $ne: false } }
          : { active: { $ne: false } });

      const total = Number(totalCtx) > 0
        ? Number(totalCtx)
        : await Product.countDocuments(similarFilter);

      const productos = await Product.find(similarFilter)
        .sort({ name: 1, _id: 1 })
        .skip(Math.max(0, offset))
        .limit(PAGE_SIZE);

      if (!productos.length) {
        const txt = effectiveCategory
          ? `Ya mostramos todos los ${effectiveCategory} disponibles. ¿Quieres filtrar por provincia, añadir certificación o buscar otra cosa?`
          : 'Ya mostramos todos los productos relacionados disponibles. ¿Quieres filtrar por provincia, añadir certificación o buscar otra cosa?';
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
            ctx.updateContext(
              'buscando-productos',
              {
                producto: productParam || '',
                categoria: effectiveCategory || '',
                region: regionParam || '',
                certificacion: certificationParam || '',
                ultima_busqueda: 'similares',
                offset,
                total,
                resultados_count: total
              },
              10
            )
          ]
        });
      }

      const nextOffset = offset + productos.length;
      const hasMore = nextOffset < total;

      const fulfillmentText = effectiveCategory
        ? `Aquí tienes ${productos.length} ${pluralize(productos.length, 'producto', 'productos')} más de ${effectiveCategory} (${nextOffset}/${total}):`
        : `Aquí tienes ${productos.length} ${pluralize(productos.length, 'producto', 'productos')} más relacionados (${nextOffset}/${total}):`;

      const richContent = productos.map((p) => ({
        type: 'info',
        title: p.name,
        subtitle: `${p.address_text || p.city || 'España'}${p.category ? ' • ' + p.category : ''}${p.certificaciones_protecciones ? ' • ' + p.certificaciones_protecciones : ''}`,
        image: { src: { rawUrl: getImageUrl(p) } },
        actionLink: `http://localhost:4200/producto/${p.slug}`
      }));

      // Detectar si hay certificación en los productos
      const hasCert = productos.some(p => p.certificaciones_protecciones && p.certificaciones_protecciones.trim());

      const chips = {
        type: 'chips',
        options: [
          ...(hasMore ? [{ text: 'Ver más productos relacionados' }] : []),
          ...(hasCert ? [{ text: 'Filtrar por certificación' }] : [])
        ]
      };

      return res.json({
        fulfillmentText,
        fulfillmentMessages: [
          { text: { text: [fulfillmentText] } },
          { payload: { richContent: [[...richContent, chips]] } }
        ],
        outputContexts: [
          ctx.updateContext(
            'buscando-productos',
            {
              producto: productParam || '',
                categoria: effectiveCategory || '',
              region: regionParam || '',
              certificacion: certificationParam || '',
              ultima_busqueda: 'similares',
              offset: nextOffset,
              total,
              resultados_count: total
            },
            10
          )
        ]
      });
    }

    // Si venimos de un flujo por provincia pero falta la provincia en contexto,
    // pedimos una nueva en vez de mezclar resultados globales.
    if (!productParam && !regionParam && !categoryParam && !certificationParam && !shouldApplyNearFilter && isRegionScopedPagination) {
      const txt = '¿De qué provincia quieres ver más productos?';
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
                    { text: 'Madrid' },
                    { text: 'Barcelona' },
                    { text: 'Valencia' },
                    { text: 'Ver todas las provincias' }
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
              producto: productParam || '',
              region: '',
              categoria: categoryParam || '',
              certificacion: certificationParam || '',
              filtro_cercania_activo: shouldApplyNearFilter,
              esperando_region: true,
              ultima_busqueda: 'region',
              offset: 0,
              total: 0,
              resultados_count: 0
            },
            10
          )
        ]
      });
    }

    // ✅ Caso especial: venimos de "listar todos" y el usuario pide "ver más productos"
    // Si ultima_busqueda=todos, SIEMPRE priorizamos paginación global e ignoramos
    // cualquier resto de filtros en contexto para evitar contaminación.
    if (ultimaNorm === 'todos' || (!productParam && !regionParam && !categoryParam && !certificationParam && !shouldApplyNearFilter && (hasPaginationHints && !ultimaNorm))) {
      const total = Number(totalCtx) > 0 ? Number(totalCtx) : await Product.countDocuments({ active: { $ne: false } });

      const productos = await Product.find({ active: { $ne: false } })
        .sort({ name: 1, _id: 1 })
        .skip(Math.max(0, offset))
        .limit(PAGE_SIZE);

      if (!productos.length) {
        const txt = 'Ya te mostré todos los productos disponibles. ¿Quieres filtrar por provincia o ver productos populares?';
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
            ctx.updateContext(
              'buscando-productos',
              {
                producto: '',
                tipo_producto: '',
                region: '',
                categoria: '',
                certificacion: '',
                filtro_cercania_activo: false,
                ultima_busqueda: 'todos',
                offset,
                total,
                resultados_count: total
              },
              10
            )
          ]
        });
      }

      const nextOffset = offset + productos.length;
      const hasMore = nextOffset < total;

      const fulfillmentText = `Aquí tienes ${productos.length} ${pluralize(productos.length, 'producto', 'productos')} más (${nextOffset}/${total}):`;

      const richContent = productos.map((p) => ({
        type: 'info',
        title: p.name,
        subtitle: p.address_text || p.city || 'España',
        image: { src: { rawUrl: getImageUrl(p) } },
        actionLink: `http://localhost:4200/producto/${p.slug}`
      }));

      const chips = {
        type: 'chips',
        options: [
          ...(hasMore ? [{ text: 'Ver más productos' }] : []),
          { text: 'Filtrar por provincia' },
          { text: 'Ver productos populares' },
          { text: 'Filtrar por categoría' }
        ]
      };

      return res.json({
        fulfillmentText,
        fulfillmentMessages: [
          { text: { text: [fulfillmentText] } },
          { payload: { richContent: [[...richContent, chips]] } }
        ],
        outputContexts: [
          ctx.updateContext(
            'buscando-productos',
            {
              producto: '',
              tipo_producto: '',
              region: '',
              categoria: '',
              certificacion: '',
              filtro_cercania_activo: false,
              ultima_busqueda: 'todos',
              offset: nextOffset,
              total,
              resultados_count: total
            },
            10
          )
        ]
      });
    }

    // Si no hay contexto (ni producto/region ni paginación), en vez de cortar el flujo,
    // arrancamos un listado general para que el chip "ver más" sea útil.
    if (!productParam && !regionParam && !categoryParam && !certificationParam && !shouldApplyNearFilter) {
      const total = await Product.countDocuments({ active: { $ne: false } });
      const productos = await Product.find({ active: { $ne: false } })
        .sort({ name: 1, _id: 1 })
        .limit(PAGE_SIZE);

      if (!productos.length) {
        return res.json({
          fulfillmentText: 'Ahora mismo no hay productos disponibles en Noma.'
        });
      }

      const nextOffset = productos.length;
      const hasMore = nextOffset < total;
      const fulfillmentText = `Te muestro ${productos.length} de ${total} ${pluralize(total, 'producto', 'productos')} ${pluralize(total, 'disponible', 'disponibles')}:`;

      const richContent = productos.map((p) => ({
        type: 'info',
        title: p.name,
        subtitle: p.address_text || p.city || 'España',
        image: { src: { rawUrl: getImageUrl(p) } },
        actionLink: `http://localhost:4200/producto/${p.slug}`
      }));

      const chips = {
        type: 'chips',
        options: [
          ...(hasMore ? [{ text: 'Ver más productos' }] : []),
          { text: 'Filtrar por provincia' },
          { text: 'Ver productos populares' },
          { text: 'Filtrar por categoría' }
        ]
      };

      return res.json({
        fulfillmentText,
        fulfillmentMessages: [
          { text: { text: [fulfillmentText] } },
          { payload: { richContent: [[...richContent, chips]] } }
        ],
        outputContexts: [
          ctx.updateContext(
            'buscando-productos',
            {
              producto: '',
              tipo_producto: '',
              region: '',
              categoria: '',
              certificacion: '',
              filtro_cercania_activo: false,
              ultima_busqueda: 'todos',
              offset: nextOffset,
              total,
              resultados_count: total
            },
            10
          )
        ]
      });
    }

    // Construir filtro según contexto
    let filter = { active: { $ne: false } };
    if (productParam) {
      filter.name = new RegExp(productParam, "i");
    }

    if (categoryParam) {
      filter.category = categoryParam;
    }

    if (certificationParam) {
      if (hasAnyCertificationFilter) {
        filter.certificaciones_protecciones = {
          $regex: /[a-zA-Z0-9ÁÉÍÓÚÜÑáéíóúüñ]/,
          $not: /sin\s+certificaci[oó]n/i
        };
      } else {
        filter.certificaciones_protecciones = new RegExp(escapeRegExp(certificationParam), 'i');
      }
    }

    if (shouldApplyNearFilter) {
      filter.location = buildNearbyWithinFilter(lon, lat).location;
    }

    if (regionParam) {
      const loose = buildLooseSpanishRegex(regionParam);
      const regionRegex = new RegExp(loose || escapeRegExp(regionParam), 'i');
      filter.$or = [
        { province: regionRegex },
        { autonomous_community: regionRegex },
        { city: regionRegex },
        { address_text: regionRegex }
      ];
    }

    const total = await Product.countDocuments(filter);
    const productos = await Product.find(filter)
      .sort({ name: 1, _id: 1 })
      .skip(Math.max(0, offset))
      .limit(PAGE_SIZE);

    if (!productos.length) {
      return res.json({
        fulfillmentText: 'No encontré más productos con esos criterios. ¿Quieres buscar algo diferente?',
        fulfillmentMessages: [
          { text: { text: ['No encontré más productos con esos criterios. ¿Quieres buscar algo diferente?'] } },
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
          ctx.updateContext(
            'buscando-productos',
            {
              producto: productParam || '',
              region: regionParam || '',
              categoria: categoryParam || '',
              certificacion: certificationParam || '',
              filtro_cercania_activo: shouldApplyNearFilter,
              ultima_busqueda: ultimaNorm || 'ver-mas',
              offset,
              total,
              resultados_count: total
            },
            10
          )
        ]
      });
    }

    const nextOffset = offset + productos.length;
    const hasMore = nextOffset < total;
    const hasCategoryFilter = Boolean(categoryParam);
    const hasCertificationFilter = Boolean(certificationParam);
    const isNearRefinementStage = shouldApplyNearFilter && (hasCategoryFilter || hasCertificationFilter);
    const isNearFinalRefinementStage = shouldApplyNearFilter && hasCategoryFilter && hasCertificationFilter;
    const moreChipText = buildMoreChipText({ categoryParam, productParam });

    // Mensaje contextual
    const regionDisplay = regionParam ? toTitle(regionParam) : '';
    let fulfillmentText = `Aquí tienes ${productos.length} ${pluralize(productos.length, 'producto', 'productos')}`;
    if (productParam) fulfillmentText += ` de ${productParam}`;
    if (categoryParam) fulfillmentText += ` de categoría ${categoryParam}`;
    if (certificationParam) fulfillmentText += hasAnyCertificationFilter ? ' con certificación oficial' : ` con certificación ${certificationParam}`;
    if (regionDisplay) fulfillmentText += ` en ${regionDisplay}`;
    fulfillmentText += ` (${nextOffset}/${total}):`;

    // Rich Content
    const richContent = productos.map(p => ({
      type: 'info',
      title: p.name,
      subtitle: p.address_text || p.city || 'España',
      image: { src: { rawUrl: getImageUrl(p) } },
      actionLink: `http://localhost:4200/producto/${p.slug}`
    }));

    // Chips
    const chipsOptions = [];
    if (isNearFinalRefinementStage) {
      if (hasMore) chipsOptions.push({ text: moreChipText });
      if (productParam) chipsOptions.push({ text: 'Ver productos similares' });
      chipsOptions.push({ text: 'Quitar filtros' });
      chipsOptions.push({ text: 'Ver todos los productos' });
      chipsOptions.push({ text: 'Conectar con artesanos' });
    } else if (isNearRefinementStage) {
      if (hasMore) chipsOptions.push({ text: moreChipText });
      if (productParam) chipsOptions.push({ text: 'Ver productos similares' });
      if (!hasCategoryFilter) chipsOptions.push({ text: 'Filtrar por categoría' });
      if (!hasCertificationFilter) chipsOptions.push({ text: 'Solo con certificación' });
      chipsOptions.push({ text: 'Quitar filtros' });
      chipsOptions.push({ text: 'Ver todos los productos' });
      chipsOptions.push({ text: 'Conectar con artesanos' });
    } else {
      if (hasMore) chipsOptions.push({ text: moreChipText });
      if (productParam) chipsOptions.push({ text: 'Ver productos similares' });
      if (regionDisplay) chipsOptions.push({ text: `${toTitle(productParam || 'Productos')} en otra provincia` });
      if (productParam) chipsOptions.push({ text: `Otros productos de ${regionDisplay || 'España'}` });
      if (!categoryParam) chipsOptions.push({ text: 'Filtrar por categoría' });
      if (!certificationParam) chipsOptions.push({ text: 'Solo con certificación' });
      if (categoryParam || certificationParam) chipsOptions.push({ text: 'Quitar filtros' });
      if (!shouldApplyNearFilter) chipsOptions.push({ text: 'Productos cerca de mí' });
      chipsOptions.push({ text: 'Conectar con artesanos' });
    }

    const chips = { type: 'chips', options: chipsOptions };

    // Mantener contexto con paginación
    const outputContexts = [
      ctx.updateContext(
        'buscando-productos',
        {
          producto: productParam || '',
          region: regionParam || '',
          categoria: categoryParam || '',
          certificacion: certificationParam || '',
          filtro_cercania_activo: shouldApplyNearFilter,
          ultima_busqueda: ultimaNorm || 'ver-mas',
          offset: nextOffset,
          total,
          resultados_count: total
        },
        10
      )
    ];

    return res.json({
      fulfillmentText,
      fulfillmentMessages: [
        { text: { text: [fulfillmentText] } },
        { payload: { richContent: [[...richContent, chips]] } }
      ],
      outputContexts
    });

  } catch (error) {
    console.error("Error en verMasProductos:", error);
    return res.json({
      fulfillmentText: "Hubo un error mostrando más productos. Por favor, intenta de nuevo."
    });
  }
};