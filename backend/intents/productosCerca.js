// intents/productosCerca.js
const Product = require('../models/products');
const User = require('../models/users');
const ContextManager = require('../utils/contextManager');
const MensajesNaturales = require('../utils/mensajesNaturales');

/**
 * Intent: productos-cerca-de-mi
 * Versión simplificada que pide la ciudad al usuario
 */

module.exports = async(req, res) => {
    try {
        const ctx = new ContextManager(req);

        const escapeRegExp = (value) => `${value ?? ''}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const toNumber = (value) => {
            const n = Number(value);
            return Number.isFinite(n) ? n : null;
        };

        const haversineKm = (lat1, lon1, lat2, lon2) => {
            const R = 6371;
            const toRad = (deg) => deg * (Math.PI / 180);
            const dLat = toRad(lat2 - lat1);
            const dLon = toRad(lon2 - lon1);
            const a =
                Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
        };

        const params = req.body?.queryResult?.parameters || {};

        // Obtener producto del contexto si existe
        const producto = ctx.getParam('buscando-productos', 'producto');

        // Verificar si tenemos ubicación del usuario en el contexto
        let ciudad = ctx.getParam('ubicacion-usuario', 'ciudad');
        let provincia = ctx.getParam('ubicacion-usuario', 'provincia');
        const lat = toNumber(
            ctx.getParam('ubicacion-usuario', 'lat') ||
            ctx.getParam('ubicacion-usuario', 'latitude') ||
            params.lat ||
            params.latitude
        );
        const lon = toNumber(
            ctx.getParam('ubicacion-usuario', 'lon') ||
            ctx.getParam('ubicacion-usuario', 'lng') ||
            ctx.getParam('ubicacion-usuario', 'longitude') ||
            params.lon ||
            params.lng ||
            params.longitude
        );
        const accuracy = toNumber(
            ctx.getParam('ubicacion-usuario', 'accuracy') ||
            params.accuracy
        );
        const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);

        // Si no tenemos ni coordenadas ni ciudad, pedir permiso de ubicación (con fallback manual)
        if (!hasCoords && !ciudad) {
            return res.json({
                fulfillmentText: "Para mostrarte productos cerca, necesito tu ubicación. Pulsa \"Permitir ubicación\" y te enseñaré los más cercanos. Si prefieres, también puedes escribir tu ciudad.",
                fulfillmentMessages: [{
                        text: {
                            text: ["Para mostrarte productos cerca, necesito tu ubicación. Pulsa \"Permitir ubicación\" y te enseñaré los más cercanos. Si prefieres, también puedes escribir tu ciudad."]
                        }
                    },
                    {
                        payload: {
                            richContent: [
                                [{
                                    type: "chips",
                                    options: [
                                        { text: "Permitir ubicación" },
                                        { text: "Madrid" },
                                        { text: "Barcelona" },
                                        { text: "Valencia" },
                                        { text: "Sevilla" },
                                        { text: "Málaga" }
                                    ]
                                }]
                            ]
                        }
                    }
                ],
                outputContexts: [
                    ctx.createContext('esperando-ubicacion', {
                        producto: producto || '',
                        preguntando_ubicacion: true
                    }, 2)
                ]
            });
        }

        let productos = [];
        let artesanos = [];

        if (hasCoords) {
            const MAX_DISTANCE_METERS = 120000;
            const nearClause = {
                location: {
                    $near: {
                        $geometry: {
                            type: 'Point',
                            coordinates: [lon, lat]
                        },
                        $maxDistance: MAX_DISTANCE_METERS
                    }
                },
                active: { $ne: false }
            };

            let filter = nearClause;
            if (producto) {
                filter = {
                    $and: [
                        nearClause,
                        {
                            $or: [
                                { name: new RegExp(escapeRegExp(producto), 'i') },
                                { description: new RegExp(escapeRegExp(producto), 'i') }
                            ]
                        }
                    ]
                };
            }

            productos = await Product.find(filter).limit(10);

            if (productos.length === 0) {
                const fallbackNearClause = {
                    location: {
                        $near: {
                            $geometry: {
                                type: 'Point',
                                coordinates: [lon, lat]
                            }
                        }
                    },
                    active: { $ne: false }
                };

                const fallbackFilter = producto
                    ? {
                        $and: [
                            fallbackNearClause,
                            {
                                $or: [
                                    { name: new RegExp(escapeRegExp(producto), 'i') },
                                    { description: new RegExp(escapeRegExp(producto), 'i') }
                                ]
                            }
                        ]
                    }
                    : fallbackNearClause;

                productos = await Product.find(fallbackFilter).limit(10);
            }
        } else {
            // Fallback manual por ciudad si no hay coordenadas concedidas
            const rxCity = new RegExp(escapeRegExp(ciudad), 'i');
            let filter = { active: { $ne: false }, $or: [{ city: rxCity }, { address_text: rxCity }] };

            if (producto) {
                filter = {
                    $and: [
                        { $or: [{ city: rxCity }, { address_text: rxCity }] },
                        { name: new RegExp(escapeRegExp(producto), 'i') }
                    ]
                };
            }

            productos = await Product.find(filter).limit(10);

            artesanos = await User.find({
                role: 'artisan',
                artisanStatus: 'approved',
                active: { $ne: false },
                $or: [{ city: rxCity }, { address_text: rxCity }]
            }).limit(5);
        }

        // Si no hay resultados
        if (productos.length === 0 && artesanos.length === 0) {
            const noResultsText = hasCoords
                ? (producto
                    ? `No encontré ${producto} cerca de tu ubicación actual 😔\n\n¿Quieres probar con otro producto o explorar por provincia?`
                    : `No encontré productos artesanales cerca de tu ubicación actual.\n\n¿Quieres explorar por provincia o ver productos populares?`)
                : (producto
                    ? `No encontré ${producto} en ${ciudad} 😔\n\n¿Quieres buscar en otra ciudad o ver ${producto} de toda España?`
                    : `No encontré productos artesanales en ${ciudad} en este momento.\n\n¿Quieres probar con otra ciudad?`);

            return res.json({
                fulfillmentText: noResultsText,
                fulfillmentMessages: [{
                        text: {
                            text: [noResultsText]
                        }
                    },
                    {
                        payload: {
                            richContent: [
                                [{
                                    type: "chips",
                                    options: hasCoords
                                        ? [
                                            { text: "Filtrar por categoría" },
                                            { text: "Solo con certificación" }
                                        ]
                                        : (producto
                                            ? [
                                                { text: `Ver ${producto} de toda España` },
                                                { text: "Buscar en otra ciudad" },
                                                { text: "Cambiar de producto" },
                                                { text: "Ver productos populares" }
                                            ] : [
                                                { text: "Buscar en otra ciudad" },
                                                { text: "Ver productos populares" },
                                                { text: "Explorar regiones" }
                                            ])
                                }]
                            ]
                        }
                    }
                ]
            });
        }

        // Mensaje principal
        let fulfillmentText;
        if (hasCoords) {
            fulfillmentText = producto
                ? `¡Genial! Encontré ${productos.length} ${producto} cerca de ti.`
                : `¡Perfecto! Encontré ${productos.length} productos artesanales cerca de ti.`;
        } else {
            fulfillmentText = producto
                ? `¡Genial! Encontré ${productos.length} ${producto} en ${ciudad}! 📍`
                : `¡Perfecto! Hay ${productos.length} productos artesanales en ${ciudad}! 📍`;

            if (artesanos.length > 0) {
                fulfillmentText += `\n\nTambién encontré ${artesanos.length} ${artesanos.length === 1 ? 'artesano' : 'artesanos'} en tu zona.`;
            }
        }

        // Rich Content - Productos
        const richContent = [];

        // Añadir productos
        productos.slice(0, 5).forEach(p => {
            const coords = Array.isArray(p?.location?.coordinates) ? p.location.coordinates : [];
            const productLon = Number(coords?.[0]);
            const productLat = Number(coords?.[1]);
            const hasProductCoords = Number.isFinite(productLat) && Number.isFinite(productLon);
            const distanceKm = (hasCoords && hasProductCoords)
                ? haversineKm(lat, lon, productLat, productLon)
                : null;

            const distanceLabel = Number.isFinite(distanceKm)
                ? ` • a ${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km`
                : '';

            richContent.push({
                type: "info",
                title: p.name,
                subtitle: `${p.address_text || p.city || ciudad || 'España'}${p.certificaciones_protecciones ? ' • ' + p.certificaciones_protecciones : ''}${distanceLabel}`,
                image: p.media && p.media.length > 0 ? { src: { rawUrl: p.media[0] } } : undefined,
                actionLink: `https://noma.com/producto/${p.slug}`
            });
        });

        // Chips con sugerencias
        const chips = {
            type: "chips",
            options: hasCoords
                ? [
                    { text: "Filtrar por categoría" },
                    { text: "Solo con certificación" }
                ]
                : [
                    { text: `👨‍🎨 Ver artesanos de ${ciudad}` },
                    { text: "🔄 Buscar en otra ciudad" },
                    { text: producto ? `Ver más ${producto}` : "🎯 Buscar algo específico" },
                    { text: "⭐ Ver destacados" }
                ]
        };

        richContent.push(chips);

        // Establecer contexto con ubicación
        const outputContexts = [
            ctx.updateContext('buscando-productos', {
                producto: producto || '',
                region: ciudad || '',
                filtro_cercania_activo: hasCoords,
                ultima_busqueda: 'cerca-de-mi',
                resultados_count: productos.length
            }, 10),
            ctx.createContext('ubicacion-usuario', {
                ciudad: ciudad || '',
                provincia: provincia || ciudad || '',
                lat: hasCoords ? lat : null,
                lon: hasCoords ? lon : null,
                accuracy: Number.isFinite(accuracy) ? accuracy : null
            }, 10)
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
        console.error("Error en productosCerca:", error);
        return res.json({
            fulfillmentText: "Hubo un error buscando productos cerca. Puedes pulsar \"Permitir ubicación\" o decirme tu ciudad.",
            fulfillmentMessages: [
                { text: { text: ["Hubo un error. Puedes pulsar \"Permitir ubicación\" o decirme tu ciudad."] } },
                {
                    payload: {
                        richContent: [
                            [{
                                type: "chips",
                                options: [
                                    { text: "Permitir ubicación" },
                                    { text: "Madrid" },
                                    { text: "Barcelona" },
                                    { text: "Valencia" }
                                ]
                            }]
                        ]
                    }
                }
            ]
        });
    }
};
