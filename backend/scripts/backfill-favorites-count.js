/**
 * backfill-favorites-count.js
 *
 * Rellena el campo favoritesCount en todos los productos existentes
 * contando cuántos usuarios tienen ese producto en su array favorites.
 *
 * Ejecución: node backend/scripts/backfill-favorites-count.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const User = require('../models/users');
const Product = require('../models/products');

const MONGODB_URI = process.env.DBCONNECTION || 'mongodb://localhost:27017/abp';

async function main() {
    await mongoose.connect(MONGODB_URI);

    // Construir mapa productId -> count con un solo aggregate
    const agg = await User.aggregate([
        { $match: { favorites: { $exists: true, $ne: [] } } },
        { $unwind: '$favorites' },
        { $group: { _id: { $toString: '$favorites' }, count: { $sum: 1 } } }
    ]);

    const countsById = new Map(agg.map(item => [String(item._id), item.count]));

    // Actualizar todos los productos en bulk
    const products = await Product.find({}, '_id').lean();
    let updated = 0;
    const ops = products.map(p => ({
        updateOne: {
            filter: { _id: p._id },
            update: { $set: { favoritesCount: countsById.get(String(p._id)) || 0 } }
        }
    }));

    if (ops.length > 0) {
        const result = await Product.bulkWrite(ops, { ordered: false });
        updated = result.modifiedCount;
    }

    await mongoose.disconnect();
}

main().then(() => {
    process.exit(0);
}).catch(err => {
    console.error('Error en backfill:', err);
    process.exit(1);
});
