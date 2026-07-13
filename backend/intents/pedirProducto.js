const Product = require('../models/products');
const ContextManager = require('../utils/contextManager');

module.exports = async (req, res) => {
  try {
    const ctx = new ContextManager(req);

    // En este flujo queremos chips muy controlados para dar ejemplos claros.
    // Especialmente cuando el usuario viene de "sin resultados" y pulsa "Buscar otro producto".
    const regionFromContext = ctx.getParam('buscando-productos', 'region');
    const txt = '¿Qué producto quieres buscar?';

    const chips = {
      type: 'chips',
      options: [
        { text: 'Vino' },
        { text: 'Queso' },
        { text: 'Ver productos' },
        { text: 'Filtrar por provincia' }
      ]
    };

    return res.json({
      fulfillmentText: txt,
      fulfillmentMessages: [
        { text: { text: [txt] } },
        { payload: { richContent: [[chips]] } }
      ],
      outputContexts: [
        ctx.updateContext(
          'buscando-productos',
          {
            producto: '',
            tipo_producto: '',
            region: typeof regionFromContext === 'string' ? regionFromContext : '',
            ultima_busqueda: 'pedir-producto',
            esperando_producto: true
          },
          3
        )
      ]
    });
  } catch (error) {
    console.error('Error en pedirProducto:', error);
    return res.json({
      fulfillmentText: '¿Qué producto quieres buscar?'
    });
  }
};
