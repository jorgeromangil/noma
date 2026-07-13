const Product = require('../models/products');
const ContextManager = require('../utils/contextManager');
const { pluralize } = require('../utils/linguistica');

const PAGE_SIZE = 5;

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

    // IMPORTANTE: cuando el usuario pide "ver productos" (listado general),
    // reiniciamos la paginación para no heredar offsets de búsquedas anteriores.
    const offset = 0;

    const total = await Product.countDocuments({ active: { $ne: false } });

    if (total === 0) {
      const txt = 'Ahora mismo no hay productos disponibles en Noma.';
      return res.json({
        fulfillmentText: txt,
        fulfillmentMessages: [{ text: { text: [txt] } }],
        outputContexts: [
          ctx.updateContext(
            'buscando-productos',
            {
              producto: '',
              tipo_producto: '',
              region: '',
              categoria: '',
              certificacion: '',
              esperando_categoria: false,
              filtro_cercania_activo: false,
              ultima_busqueda: 'todos',
              offset: 0,
              total: 0,
              resultados_count: 0
            },
            10
          )
        ]
      });
    }

    const productos = await Product.find({ active: { $ne: false } })
      .sort({ name: 1, _id: 1 })
      .skip(offset)
      .limit(PAGE_SIZE);

    if (!productos.length) {
      const txt = 'Ya no hay más productos para mostrar. ¿Quieres filtrar por provincia o ver productos populares?';
      return res.json({
        fulfillmentText: txt,
        fulfillmentMessages: [{ text: { text: [txt] } }],
        outputContexts: [
          ctx.updateContext(
            'buscando-productos',
            {
              producto: '',
              tipo_producto: '',
              region: '',
              categoria: '',
              certificacion: '',
              esperando_categoria: false,
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
        // Siempre mostramos este chip en "ver todos" para permitir avanzar por páginas.
        { text: 'Ver más productos' },
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
            esperando_categoria: false,
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
  } catch (error) {
    console.error('Error en listarProductos:', error);
    return res.json({
      fulfillmentText: 'Hubo un error listando productos. Por favor, intenta de nuevo.'
    });
  }
};
