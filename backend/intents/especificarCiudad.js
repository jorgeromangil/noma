// intents/especificarCiudad.js
const Product = require('../models/products');
const User = require('../models/users');
const ContextManager = require('../utils/contextManager');

/**
 * Intent: especificar-ciudad
 * 
 * Training phrases:
 * - estoy en {ciudad}
 * - vivo en {ciudad}
 * - soy de {ciudad}
 * - {ciudad}
 * - madrid
 * - barcelona
 * - valencia
 * 
 * Parameters:
 * - ciudad: @sys.geo-city (required: true)
 */

module.exports = async(req, res) => {
    try {
        const ctx = new ContextManager(req);
        const params = req.body.queryResult.parameters;

        const escapeRegExp = (value) => `${value ?? ''}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Obtener ciudad del parámetro
        let ciudad = params.ciudad || params['geo-city'];

        // Si viene como objeto, extraer el nombre
        if (typeof ciudad === 'object' && ciudad.city) {
            ciudad = ciudad.city;
        }

        if (!ciudad) {
            return res.json({
                fulfillmentText: "No entendí la ciudad. ¿Puedes repetirla?"
            });
        }

        // Normalizar nombre de ciudad
        ciudad = ciudad.toString().toLowerCase();

        // Obtener producto del contexto si existe
        const producto = ctx.getParam('buscando-productos', 'producto') ||
            ctx.getParam('esperando-ubicacion', 'producto');

        // Buscar productos en esa ciudad
        const rxCity = new RegExp(escapeRegExp(ciudad), 'i');
        let filter = { $or: [{ city: rxCity }, { address_text: rxCity }] };

        if (producto) {
            filter = {
                $and: [
                    { $or: [{ city: rxCity }, { address_text: rxCity }] },
                    { name: new RegExp(escapeRegExp(producto), 'i') }
                ]
            };
        }


        const productos = await Product.find(filter).limit(10);

        // Buscar artesanos
        const artesanos = await User.find({
            role: 'artisan',
            artisanStatus: 'approved',
            active: { $ne: false },
            $or: [{ city: rxCity }, { address_text: rxCity }]
        }).limit(5);

        // Si no hay resultados
        if (productos.length === 0 && artesanos.length === 0) {
            return res.json({
                fulfillmentText: producto ?
                    `No encontré ${producto} en ${ciudad} 😔\n\n¿Quieres buscar en otra ciudad o ver ${producto} de toda España?` :
                    `No encontré productos en ${ciudad} en este momento.\n\n¿Pruebas con otra ciudad?`,
                fulfillmentMessages: [{
                        text: {
                            text: [producto ?
                                `No encontré ${producto} en ${ciudad} 😔` :
                                `No encontré productos en ${ciudad}.`
                            ]
                        }
                    },
                    {
                        payload: {
                            richContent: [
                                [{
                                    type: "chips",
                                    options: producto ? [
                                        { text: `Ver ${producto} de toda España` },
                                        { text: "Buscar en otra ciudad" },
                                        { text: "Cambiar de producto" }
                                    ] : [
                                        { text: "Buscar en otra ciudad" },
                                        { text: "Ver productos populares" },
                                        { text: "Explorar por producto" }
                                    ]
                                }]
                            ]
                        }
                    }
                ],
                outputContexts: [
                    ctx.createContext('ubicacion-usuario', {
                        ciudad: ciudad
                    }, 10)
                ]
            });
        }

        // Capitalizar primera letra de la ciudad
        const ciudadCapitalizada = ciudad.charAt(0).toUpperCase() + ciudad.slice(1);

        // Mensaje de éxito
        let fulfillmentText = producto ?
            `¡Perfecto! Encontré ${productos.length} ${producto} en ${ciudadCapitalizada}! 📍` :
            `¡Genial! Hay ${productos.length} productos artesanales en ${ciudadCapitalizada}! 📍`;

        if (artesanos.length > 0) {
            fulfillmentText += `\n\nTambién hay ${artesanos.length} ${artesanos.length === 1 ? 'artesano' : 'artesanos'} en la zona.`;
        }

        // Rich Content
        const richContent = [];

        // Cards de productos
        productos.slice(0, 5).forEach(p => {
            richContent.push({
                type: "info",
                title: p.name,
                subtitle: `${p.address_text || p.city || ciudadCapitalizada} ${p.certificaciones_protecciones ? '• ' + p.certificaciones_protecciones : ''}`,
                image: p.media && p.media.length > 0 ? { src: { rawUrl: p.media[0] } } : undefined,
                actionLink: `https://noma.com/producto/${p.slug}`
            });
        });

        // Chips
        const chips = {
            type: "chips",
            options: [
                { text: `👨‍🎨 Artesanos de ${ciudadCapitalizada}` },
                { text: "🔄 Otra ciudad" },
                { text: producto ? `Más ${producto}` : "🎯 Buscar producto" },
                { text: "⭐ Ver destacados" }
            ]
        };

        richContent.push(chips);

        // Guardar ubicación en contexto
        const outputContexts = [
            ctx.updateContext('buscando-productos', {
                producto: producto || '',
                region: ciudadCapitalizada,
                ciudad: ciudadCapitalizada,
                ultima_busqueda: 'cerca-de-mi',
                resultados_count: productos.length
            }, 10),
            ctx.createContext('ubicacion-usuario', {
                ciudad: ciudadCapitalizada,
                provincia: ciudadCapitalizada
            }, 10),
            ctx.deleteContext('esperando-ubicacion') // Limpiar contexto temporal
        ];

        return res.json({
            fulfillmentText,
            fulfillmentMessages: [
                { text: { text: [fulfillmentText] } },
                { payload: { richContent: [richContent] } }
            ],
            outputContexts
        });

    } catch (error) {
        console.error("Error en especificarCiudad:", error);
        return res.json({
            fulfillmentText: "Hubo un error procesando tu ciudad. ¿Puedes decirme de qué ciudad eres de otra forma?"
        });
    }
};
