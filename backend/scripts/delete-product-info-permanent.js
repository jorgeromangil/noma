/**
 * Script para eliminar permanentemente el campo product_info de todos los productos
 */

const mongoose = require('mongoose');
require('dotenv').config();

const DB_CNN = process.env.DB_CNN || 'mongodb://localhost:27017/syncro_abp';

async function deleteProductInfoPermanent() {
    try {
        await mongoose.connect(DB_CNN);

        const db = mongoose.connection.db;
        const productsCollection = db.collection('products');

        // Contar productos con product_info ANTES
        const countBefore = await productsCollection.countDocuments({
            product_info: { $exists: true }
        });


        if (countBefore === 0) {
            await mongoose.connection.close();
            return;
        }

        // Eliminar el campo product_info de TODOS los productos

        await productsCollection.updateMany(
            { product_info: { $exists: true } },
            { $unset: { product_info: "" } }
        );

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.connection.close();
    }
}

deleteProductInfoPermanent();
