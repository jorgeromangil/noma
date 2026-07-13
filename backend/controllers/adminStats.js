const User = require('../models/users');
const Product = require('../models/products');
const { response } = require('express');

// Devuelve estadísticas globales para el panel de admin
const getAdminStats = async (req, res = response) => {
    if (req.role !== 'admin') {
        return res.status(403).json({ ok: false, msg: 'No autorizado' });
    }
    try {
        // Ejecutar en paralelo lo que no depende entre sí.
        const [totalUsers, artisanUsers, regularUsers, totalProducts, productBuckets, popularProducts] = await Promise.all([
            User.estimatedDocumentCount(),
            User.countDocuments({ role: 'artisan' }),
            User.countDocuments({ role: 'regular' }),
            Product.estimatedDocumentCount(),
            Product.aggregate([
                {
                    $facet: {
                        byCategory: [
                            { $group: { _id: '$category', count: { $sum: 1 } } }
                        ],
                        byComunidad: [
                            { $match: { autonomous_community: { $nin: [null, ''] } } },
                            { $group: { _id: '$autonomous_community', count: { $sum: 1 } } },
                            { $sort: { count: -1, _id: 1 } }
                        ]
                    }
                }
            ]),
            Product.find({}, 'name category owner media image favoritesCount')
                .sort({ favoritesCount: -1, _id: 1 })
                .limit(50)
                .lean()
        ]);

        const productStats = productBuckets?.[0] || { byCategory: [], byComunidad: [] };

        // Desglose por categoría
        const categories = Product.schema.path('category').enumValues;
        const productsByCategory = Object.fromEntries(categories.map((cat) => [cat, 0]));
        for (const row of productStats.byCategory || []) {
            if (row && row._id) {
                productsByCategory[row._id] = row.count;
            }
        }

        // Desglose por comunidad autónoma
        const productsByComunidad = {};
        for (const row of productStats.byComunidad || []) {
            if (row && row._id) {
                productsByComunidad[row._id] = row.count;
            }
        }

        // Productos más populares (más favoritos)
        const popularProductsNormalized = popularProducts.map((p) => ({
            _id: p._id,
            name: p.name,
            category: p.category,
            owner: p.owner,
            favorites: Number(p.favoritesCount || 0),
            media: p.media || [],
            image: p.image || null
        }));

        return res.json({
            ok: true,
            stats: {
                users: { total: totalUsers, artisan: artisanUsers, regular: regularUsers },
                products: { total: totalProducts, byCategory: productsByCategory, byComunidad: productsByComunidad },
                popularProducts: popularProductsNormalized
            }
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, msg: 'Error obteniendo estadísticas admin' });
    }
};

module.exports = { getAdminStats };
