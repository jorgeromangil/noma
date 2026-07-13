const Product = require('../models/products');
const ContextManager = require('../utils/contextManager');
const MensajesNaturales = require('../utils/mensajesNaturales');
const { normalizeNoAccents, stripTrailingPunctuation } = require('../utils/nlp');

const toTitle = (value) => {
    const s = `${value || ''}`.trim();
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
};

module.exports = async(req, res) => {
    try {
        const ctx = new ContextManager(req);

        // Obtener nuevo producto del parámetro
        let productoParam = ctx.parameters.producto?.toLowerCase() ||
            ctx.parameters.product?.toLowerCase() ||
            null;

        // Limpiar si es un comando en lugar de un producto
        const normalizedProductoParam = `${productoParam || ''}`
            .toString();
        const normalizedProductoParamClean = normalizeNoAccents(stripTrailingPunctuation(normalizedProductoParam));
        const isCommand =
            /^(cambiar|quitar|limpiar|borrar|filtrar|ver|solo|con|productos?|de|producto)$/.test(normalizedProductoParamClean) ||
            /^(cambiar\s+(de\s+)?productos?|buscar\s+otro\s+producto|otro\s+producto)$/.test(normalizedProductoParamClean);
        if (isCommand) {
            productoParam = null;
        }

        // Obtener región del contexto (si existe)
        const region = ctx.getParam('buscando-productos', 'region');

        // ⚠️ CASO 1: Usuario dijo "cambiar de producto" pero NO especificó cuál
        if (!productoParam) {
            return res.json({
                fulfillmentText: "¿A qué producto quieres cambiar?",
                fulfillmentMessages: [
                    { text: { text: ["¿A qué producto quieres cambiar?"] } },
                    {
                        payload: {
                            richContent: [
                                [{
                                    type: "chips",
                                    options: [
                                        { text: "Vino" },
                                        { text: "Cerámica" },
                                        { text: "Queso" },
                                        { text: "Aceite" },
                                        { text: "Miel" },
                                        { text: "Cerveza" },
                                        { text: "Jamón" },
                                        { text: "Ver productos populares" }
                                    ]
                                }]
                            ]
                        }
                    }
                ],
                outputContexts: [
                    // Mantener región en el contexto
                    ctx.updateContext('buscando-productos', {
                        region: region || '',
                        esperando_producto: true
                    }, 10)
                ]
            });
        }

        // ✅ CASO 2: Tiene producto especificado, buscar

        // Construir filtro
        let filter = { name: new RegExp(productoParam, 'i'), active: { $ne: false } };

        // Si hay región en el contexto, mantenerla
        if (region) {
            filter.city = new RegExp(region, 'i');
        }

        const productos = await Product.find(filter).limit(10);

        if (!productos.length) {
            const mensaje = region ?
                `No encontré ${productoParam} en ${region}. ¿Quieres ver ${productoParam} de toda España o cambiar de provincia?` :
                `No encontré ${productoParam}. ¿Quieres buscar otra cosa?`;

            return res.json({
                fulfillmentText: mensaje,
                fulfillmentMessages: [
                    { text: { text: [mensaje] } },
                    {
                        payload: {
                            richContent: [
                                [{
                                    type: "chips",
                                    options: region ? [
                                        { text: `${toTitle(productoParam)} de toda España` },
                                        { text: "Cambiar provincia" },
                                        { text: "Cambiar de producto" },
                                        { text: "Ver productos populares" }
                                    ] : [
                                        { text: "Quiero vino" },
                                        { text: "Quiero cerámica" },
                                        { text: "Ver productos populares" }
                                    ]
                                }]
                            ]
                        }
                    }
                ]
            });
        }

        // Mensaje natural variado
        const fulfillmentText = region ?
            MensajesNaturales.cambioProducto(productoParam, region) :
            MensajesNaturales.productosEncontrados(productos.length, productoParam);

        // Rich Content
        const richContent = productos.slice(0, 5).map(p => ({
            type: "info",
            title: p.name,
            subtitle: `${p.city || 'España'} ${p.certificaciones_protecciones ? '• ' + p.certificaciones_protecciones : ''}`,
            image: p.media && p.media.length > 0 ? { src: { rawUrl: p.media[0] } } : undefined,
            actionLink: `https://noma.com/producto/${p.slug}`
        }));

        // Chips contextuales
        const chips = {
            type: "chips",
            options: region ? [
                { text: "Ver más" },
                { text: "Cambiar provincia" },
                { text: "Conocer artesanos" }
            ] : [
                { text: "Ver más" },
                { text: "Filtrar por provincia" },
                { text: "Conocer artesanos" }
            ]
        };

        // Actualizar contexto con el nuevo producto
        const outputContexts = [
            ctx.updateContext('buscando-productos', {
                producto: productoParam,
                region: region || '',
                tipo_producto: productoParam,
                ultima_busqueda: 'cambio-producto',
                resultados_count: productos.length
            }, 10)
        ];

        return res.json({
            fulfillmentText: fulfillmentText,
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
            outputContexts: outputContexts
        });

    } catch (error) {
        console.error("Error en cambiarProducto:", error);
        return res.json({
            fulfillmentText: "Hubo un error cambiando de producto. Por favor, intenta de nuevo."
        });
    }
};