const StatsAggregate = require('../models/statsAggregate');
// Devuelve estadísticas agregadas por periodo para un artesano
const getArtisanStatsAggregate = async (req, res = response) => {
    const artisanId = req.params.id;
    const periodo = req.query.periodo || 'semana';

    try {
        if (req.role !== 'admin' && req.uid !== artisanId) {
            return res.status(403).json({
                ok: false,
                msg: 'No autorizado para ver estadisticas'
            });
        }

        // Buscar la estadística agregada más reciente para el periodo
        const agg = await StatsAggregate.findOne({ periodo })
            .sort({ fechaFin: -1 })
            .lean();

        if (!agg) {
            return res.status(404).json({
                ok: false,
                msg: 'No hay estadísticas agregadas para este periodo'
            });
        }

        // Productos del artesano para filtrar métricas por producto y reducir payload
        const artisanProducts = await Product.find({ owner: artisanId }).select('_id').lean();
        const artisanProductIds = new Set(artisanProducts.map((p) => String(p._id)));

        // Filtrar datos solo para el artesano solicitado
        const artisanIdStr = String(artisanId);
        const datosFiltrados = {};
        for (const tipo in agg.datos) {
            if (!Object.prototype.hasOwnProperty.call(agg.datos, tipo)) continue;
            if (tipo === 'productAnalytics') {
                // Incluir solo analytics de productos del artesano
                const analytics = agg.datos.productAnalytics || {};
                const analyticsFiltrados = {};
                for (const productId in analytics) {
                    if (!Object.prototype.hasOwnProperty.call(analytics, productId)) continue;
                    if (artisanProductIds.has(String(productId))) {
                        analyticsFiltrados[productId] = analytics[productId];
                    }
                }
                datosFiltrados.productAnalytics = analyticsFiltrados;
                continue;
            }
            const tipoData = agg.datos[tipo];
            // Si hay desglose por usuario, tomar solo el del artesano
            let total = 0;
            if (tipoData.porUsuario && tipoData.porUsuario[artisanIdStr]) {
                total = tipoData.porUsuario[artisanIdStr];
            }
            datosFiltrados[tipo] = {
                total
            };
            // Si hay desglose por producto, también filtrar si se requiere (opcional)
            if (tipoData.porProducto) {
                const porProductoFiltrado = {};
                for (const productId in tipoData.porProducto) {
                    if (!Object.prototype.hasOwnProperty.call(tipoData.porProducto, productId)) continue;
                    if (artisanProductIds.has(String(productId))) {
                        porProductoFiltrado[productId] = tipoData.porProducto[productId];
                    }
                }
                datosFiltrados[tipo].porProducto = porProductoFiltrado;
            }
            // Incluir porArtisan si existe
            if (tipoData.porArtisan) {
                datosFiltrados[tipo].porArtisan = {
                    [artisanIdStr]: Number(tipoData.porArtisan[artisanIdStr] || 0)
                };
            }
        }

        return res.json({
            ok: true,
            periodo,
            fechaInicio: agg.fechaInicio,
            fechaFin: agg.fechaFin,
            datos: datosFiltrados
        });
    } catch (error) {
        console.error('Error stats aggregate:', error);
        return res.status(500).json({
            ok: false,
            msg: 'Error obteniendo estadisticas agregadas'
        });
    }
};
const { response } = require('express');
const fs = require('fs');
const User = require('../models/users');
const Product = require('../models/products');
const { BetaAnalyticsDataClient } = require('@google-analytics/data');

const gaCache = new Map();
const GA_CACHE_TTL_MS = 60 * 1000;

const getGaClient = () => {
    if (!process.env.GA4_CREDENTIALS_PATH) return null;
    if (!fs.existsSync(process.env.GA4_CREDENTIALS_PATH)) return null;
    return new BetaAnalyticsDataClient({
        keyFilename: process.env.GA4_CREDENTIALS_PATH
    });
};

const fetchGaEventCount = async (client, propertyId, eventName, artisanId) => {
    if (!client || !propertyId) return { value: null, error: null };

    const buildFilter = (useArtisanFilter) => {
        if (!useArtisanFilter) return {
            filter: {
                fieldName: 'eventName',
                stringFilter: { matchType: 'EXACT', value: eventName }
            }
        };

        return {
            andGroup: {
                expressions: [
                    {
                        filter: {
                            fieldName: 'eventName',
                            stringFilter: { matchType: 'EXACT', value: eventName }
                        }
                    },
                    {
                        filter: {
                            fieldName: 'customEvent:artisan_id',
                            stringFilter: { matchType: 'EXACT', value: String(artisanId) }
                        }
                    }
                ]
            }
        };
    };

    try {
        const [report] = await client.runReport({
            property: `properties/${propertyId}`,
            dateRanges: [{ startDate: '2015-08-14', endDate: 'today' }],
            metrics: [{ name: 'eventCount' }],
            dimensionFilter: buildFilter(true)
        });

        const value = report?.rows?.[0]?.metricValues?.[0]?.value;
        const parsed = value ? Number(value) : 0;
        if (parsed > 0) return { value: parsed, error: null };
    } catch (err) {
        const message = err?.message || '';
        if (message.includes('INVALID_ARGUMENT')) {
            try {
                const [reportFallback] = await client.runReport({
                    property: `properties/${propertyId}`,
                    dateRanges: [{ startDate: '2015-08-14', endDate: 'today' }],
                    metrics: [{ name: 'eventCount' }],
                    dimensionFilter: buildFilter(false)
                });
                const value = reportFallback?.rows?.[0]?.metricValues?.[0]?.value;
                const parsed = value ? Number(value) : 0;
                return { value: parsed, error: new Error('GA4 dimension artisan_id no disponible aun; usando total global temporal') };
            } catch (fallbackErr) {
                return { value: null, error: fallbackErr };
            }
        }
        return { value: null, error: err };
    }

    try {
        const [realtime] = await client.runRealtimeReport({
            property: `properties/${propertyId}`,
            minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
            metrics: [{ name: 'eventCount' }],
            dimensionFilter: buildFilter(true)
        });

        const realtimeValue = realtime?.rows?.[0]?.metricValues?.[0]?.value;
        return { value: realtimeValue ? Number(realtimeValue) : 0, error: null };
    } catch (err) {
        return { value: null, error: err };
    }
};

const getArtisanStats = async (req, res = response) => {
    const artisanId = req.params.id;

    try {
        if (req.role !== 'admin' && req.uid !== artisanId) {
            return res.status(403).json({
                ok: false,
                msg: 'No autorizado para ver estadisticas'
            });
        }

        const products = await Product.find({ owner: artisanId }).select('_id name active media favoritesCount').lean();
        const productIds = products.map(p => p._id);
        const productsPublished = productIds.length;
        const productsVisible = products.filter(p => p.active !== false).length;
        const productsHidden = products.filter(p => p.active === false).length;

        // Usar el contador desnormalizado — O(n productos del artesano), sin aggregate sobre usuarios
        const favoritesBreakdown = products
            .map(p => ({
                productId: String(p._id),
                name: p.name || 'Producto sin nombre',
                favorites: Number(p.favoritesCount ?? 0),
                thumbnail: (Array.isArray(p.media) && p.media.length > 0) ? p.media[0] : null
            }))
            .sort((a, b) => b.favorites - a.favorites);

        const favoritesReceived = favoritesBreakdown.reduce((sum, p) => sum + p.favorites, 0);

        const propertyId = process.env.GA4_PROPERTY_ID;
        const gaClient = getGaClient();
        const gaConfigured = Boolean(gaClient && propertyId);

        let profileViews = null;
        let productClicks = null;
        let gaError = null;
        if (gaConfigured) {
            const cacheKey = `${artisanId}`;
            const cached = gaCache.get(cacheKey);
            const now = Date.now();

            if (cached && now - cached.timestamp < GA_CACHE_TTL_MS) {
                profileViews = cached.profileViews;
                productClicks = cached.productClicks;
                gaError = cached.gaError;
            } else {
                try {
                    const [profileResult, productResult] = await Promise.all([
                        fetchGaEventCount(gaClient, propertyId, 'view_artisan_profile', artisanId),
                        fetchGaEventCount(gaClient, propertyId, 'product_modal_open', artisanId)
                    ]);

                    profileViews = profileResult.value;
                    productClicks = productResult.value;

                    const errorPayload = profileResult.error || productResult.error;
                    if (errorPayload) {
                        const detailMessages = Array.isArray(errorPayload?.details)
                            ? errorPayload.details.map(d => d?.message).filter(Boolean).join(' | ')
                            : '';
                        gaError = detailMessages
                            || errorPayload?.message
                            || JSON.stringify(errorPayload, Object.getOwnPropertyNames(errorPayload));
                        console.warn('GA4 stats error:', gaError);
                    }

                    gaCache.set(cacheKey, {
                        timestamp: now,
                        profileViews,
                        productClicks,
                        gaError
                    });
                } catch (gaError) {
                    gaError = gaError?.message || String(gaError);
                    console.warn('GA4 stats error:', gaError);
                }
            }
        }

        return res.json({
            ok: true,
            stats: {
                productsPublished,
                productsVisible,
                productsHidden,
                favoritesReceived,
                favoritesBreakdown,
                profileViews,
                productClicks,
                gaError,
                gaConfigured
            }
        });
    } catch (error) {
        console.error('Error stats:', error);
        return res.status(500).json({
            ok: false,
            msg: 'Error obteniendo estadisticas'
        });
    }
};

// Devuelve estadísticas agregadas globales por periodo para admin
const getGlobalStatsAggregate = async (req, res = response) => {
    const periodo = req.query.periodo || 'semana';
    try {
        if (req.role !== 'admin') {
            return res.status(403).json({
                ok: false,
                msg: 'No autorizado para ver estadísticas globales'
            });
        }
        // Buscar la estadística agregada más reciente para el periodo
        const agg = await StatsAggregate.findOne({ periodo })
            .sort({ fechaFin: -1 })
            .lean();
        if (!agg) {
            return res.status(404).json({
                ok: false,
                msg: 'No hay estadísticas agregadas para este periodo'
            });
        }
        // Devolver todos los datos agregados globales
        return res.json({
            ok: true,
            periodo,
            fechaInicio: agg.fechaInicio,
            fechaFin: agg.fechaFin,
            datos: agg.datos
        });
    } catch (error) {
        console.error('Error stats global aggregate:', error);
        return res.status(500).json({
            ok: false,
            msg: 'Error obteniendo estadísticas globales agregadas'
        });
    }
};

module.exports = {
    getArtisanStats,
    getArtisanStatsAggregate,
    getGlobalStatsAggregate
};
