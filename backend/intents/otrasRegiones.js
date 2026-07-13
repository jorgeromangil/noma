// intents/otrasRegiones.js
const Product = require('../models/products');
const ContextManager = require('../utils/contextManager');

const PAGE_SIZE = 12;

const toTitle = (value) => {
  const s = `${value || ''}`.trim();
  if (!s) return '';
  if (/^[A-Z]{2}-[A-Z0-9]{2,3}$/.test(s)) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const normalizeRegion = (str) => {
  if (!str) return '';
  return `${str}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
};

const looksLikePostalCode = (value) => {
  const s = `${value || ''}`.trim();
  return /^\d{4,5}$/.test(s);
};

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

  // Preferimos un segmento "tipo región/provincia" sin números
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (!p || isCountry(p)) continue;
    if (hasLetters(p) && !hasDigits(p)) return p;
  }

  // Fallback: último segmento con letras, limpiando zip al inicio
  for (let i = parts.length - 1; i >= 0; i--) {
    let p = parts[i];
    if (!p || isCountry(p)) continue;
    if (!hasLetters(p)) continue;
    p = p.replace(/^\d{4,5}\s+/, '').trim();
    if (p) return p;
  }

  return '';
};

const regionLabelFromProduct = (product) => {  // Primero intentamos obtener la ciudad
  const province = `${product?.province || ''}`.trim();
  if (province) return toTitle(province);

  const autonomousCommunity = `${product?.autonomous_community || ''}`.trim();
  if (autonomousCommunity) return toTitle(autonomousCommunity);

  const city = `${product?.city || ''}`.trim();
  if (city) return toTitle(city);

  const code = `${product?.region_code || ''}`.trim();
  const addressText = `${product?.address_text || ''}`.trim();

  const fromAddress = regionFromAddressText(addressText);
  if (fromAddress) return toTitle(fromAddress);

  if (code && /^[A-Z]{2}-[A-Z0-9]{2,3}$/i.test(code)) {
    return toTitle(code);
  }

  if (code && !looksLikePostalCode(code)) {
    if (!/^\d+$/.test(code)) return toTitle(code);
  }

  return '';
};

const normalizeList = (values) => {
  const seen = new Set();
  const output = [];

  for (const value of values || []) {
    const label = `${value || ''}`.trim();
    if (!label) continue;

    const key = normalizeRegion(label);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    output.push(toTitle(label));
  }

  return output.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
};

const getSafeOffset = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
};

module.exports = async (req, res) => {
  try {
    const ctx = new ContextManager(req);
    const rawQueryText = (req.body?.queryResult?.queryText || '').toString().trim();
    const qNorm = normalizeRegion(rawQueryText);
    const isNextRegionsPage = /^(ver mas provincias|mas provincias|ver mas regiones|mas regiones|ver mas)$/i.test(qNorm);
    
    // Obtener producto del contexto
    const productParam = ctx.getParam('buscando-productos', 'producto');

    if (!productParam) {
      // ✅ Si no hay producto en contexto, listamos provincias y paginamos.
      const provinces = normalizeList(await Product.distinct('province', { province: { $exists: true, $ne: '' } }));

      const canContinuePaging =
        isNextRegionsPage &&
        normalizeRegion(ctx.getParam('explorando-regiones', 'mode')) === 'all';

      const offset = canContinuePaging ? getSafeOffset(ctx.getParam('explorando-regiones', 'offset')) : 0;
      const page = provinces.slice(offset, offset + PAGE_SIZE);
      const nextOffset = offset + page.length;
      const hasMore = nextOffset < provinces.length;

      const txt = page.length
        ? (offset === 0
          ? 'Estas son algunas provincias con productos disponibles:'
          : 'Te muestro más provincias con productos disponibles:')
        : 'Ahora mismo no tengo provincias disponibles.';

      const options = page.length
        ? page.map((r) => ({ text: r }))
        : [
            { text: 'Ver productos' },
            { text: 'Productos populares' }
          ];

      if (hasMore) options.push({ text: 'Ver más provincias' });

      return res.json({
        fulfillmentText: txt,
        fulfillmentMessages: [
          { text: { text: [txt] } },
          {
            payload: {
              richContent: [[
                {
                  type: 'chips',
                  // Usamos nombre de provincia corto para evitar filas con huecos visuales.
                  options
                }
              ]]
            }
          }
        ],
        outputContexts: [
          ctx.updateContext('explorando-regiones', {
            mode: 'all',
            producto: '',
            offset: nextOffset,
            total: provinces.length
          }, 10)
        ]
      });
    }

    // Si hay producto, buscar en qué provincias está disponible
    const mode = normalizeRegion(ctx.getParam('explorando-regiones', 'mode'));
    const prevProduct = normalizeRegion(ctx.getParam('explorando-regiones', 'producto'));
    const sameProductPaging = mode === 'producto' && prevProduct === normalizeRegion(productParam);
    const offset = (isNextRegionsPage && sameProductPaging)
      ? getSafeOffset(ctx.getParam('explorando-regiones', 'offset'))
      : 0;

    const regions = normalizeList(
      await Product.distinct('province', {
        name: new RegExp(productParam, 'i'),
        province: { $exists: true, $ne: '' }
      })
    );

    if (!regions.length) {
      // Fallback legacy por si hay datos antiguos sin province
      const productos = await Product.find({
        name: new RegExp(productParam, 'i')
      }).select('province autonomous_community city address_text region_code').limit(200);

      const legacyRegions = normalizeList((productos || []).map(regionLabelFromProduct));
      const page = legacyRegions.slice(offset, offset + PAGE_SIZE);
      const nextOffset = offset + page.length;
      const hasMore = nextOffset < legacyRegions.length;

      if (!legacyRegions.length) {
        return res.json({
          fulfillmentText: `No encontré ${productParam} en otras provincias. ¿Quieres buscar otro producto?`
        });
      }

      const fulfillmentText = `${productParam} está disponible en ${legacyRegions.length} ${legacyRegions.length === 1 ? 'provincia' : 'provincias'}:`;
      const regionChips = page.map((region) => ({ text: region }));
      if (hasMore) regionChips.push({ text: 'Ver más provincias' });

      return res.json({
        fulfillmentText,
        fulfillmentMessages: [
          { text: { text: [fulfillmentText] } },
          {
            payload: {
              richContent: [[
                {
                  type: 'chips',
                  options: regionChips
                }
              ]]
            }
          }
        ],
        outputContexts: [
          ctx.updateContext('explorando-regiones', {
            mode: 'producto',
            producto: productParam,
            offset: nextOffset,
            total: legacyRegions.length
          }, 10),
          ctx.updateContext('buscando-productos', {
            producto: productParam,
            ultima_busqueda: 'explorar-regiones'
          }, 10)
        ]
      });
    }

    const page = regions.slice(offset, offset + PAGE_SIZE);
    const nextOffset = offset + page.length;
    const hasMore = nextOffset < regions.length;

    if (!page.length) {
      return res.json({
        fulfillmentText: `No hay más provincias para ${productParam}. ¿Quieres ver otro producto?`,
        fulfillmentMessages: [
          { text: { text: [`No hay más provincias para ${productParam}.`] } },
          {
            payload: {
              richContent: [[
                {
                  type: 'chips',
                  options: [
                    { text: 'Cambiar de producto' },
                    { text: 'Ver productos populares' }
                  ]
                }
              ]]
            }
          }
        ],
        outputContexts: [
          ctx.updateContext('explorando-regiones', {
            mode: 'producto',
            producto: productParam,
            offset,
            total: regions.length
          }, 10)
        ]
      });
    }

    const fulfillmentText = `${productParam} está disponible en ${regions.length} ${regions.length === 1 ? 'provincia' : 'provincias'}:`;

    // Crear chips con las provincias disponibles
    const regionChips = page.map((region) => ({ text: region }));
    if (hasMore) regionChips.push({ text: 'Ver más provincias' });

    return res.json({
      fulfillmentText,
      fulfillmentMessages: [
        { text: { text: [fulfillmentText] } },
        {
          payload: {
            richContent: [[
              {
                type: "chips",
                options: regionChips
              }
            ]]
          }
        }
      ],
      outputContexts: [
        ctx.updateContext('explorando-regiones', {
          mode: 'producto',
          producto: productParam,
          offset: nextOffset,
          total: regions.length
        }, 10),
        ctx.updateContext('buscando-productos', {
          producto: productParam,
          ultima_busqueda: 'explorar-regiones'
        }, 10)
      ]
    });

  } catch (error) {
    console.error("Error en otrasRegiones:", error);
    return res.json({
      fulfillmentText: "Hubo un error buscando provincias. Por favor, intenta de nuevo."
    });
  }
};