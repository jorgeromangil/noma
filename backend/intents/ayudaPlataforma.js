const ContextManager = require('../utils/contextManager');

module.exports = async (req, res) => {
  try {
    const ctx = new ContextManager(req);

    const txt = [
      'Guia rapida de Noma:',
      '',
      'Noma te permite descubrir productos artesanales, explorar por mapa y conectar con artesanos.',
      '',
      '1) Usa el chatbot para pedir productos o artesanos en lenguaje natural.',
      '',
      '2) En la parte superior puedes iniciar sesion/registrarte; si ya entraste, ahi tienes tu perfil.',
      '',
      '3) Usa la barra de busqueda y los filtros (categorias, certificaciones y proximidad).',
      '',
      '4) En el mapa, cada pin representa un producto o artesano. Haz clic para abrir su ficha completa.',
      '',
      '5) Puedes cambiar de motor de busqueda y alternar entre vista 2D y 3D desde el switch inferior.'
    ].join('\n');

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
                  { text: 'Conectar con artesano' }
                ]
              }
            ]]
          }
        }
      ],
      outputContexts: [
        ctx.deleteContext('buscando-productos'),
        ctx.deleteContext('buscando-artesanos')
      ]
    });
  } catch (error) {
    console.error('Error en ayudaPlataforma:', error);
    return res.json({
      fulfillmentText: 'Puedo ayudarte a usar Noma: buscar productos, filtrar por provincia y explorar el mapa. Que quieres hacer?'
    });
  }
};
