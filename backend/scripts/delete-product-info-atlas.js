/**
 * Script para eliminar permanentemente product_info de MongoDB Atlas
 */

const mongoose = require('mongoose');
require('dotenv').config();

const DB_CNN = process.env.DBCONNECTION || process.env.DB_CNN || 'mongodb://localhost:27017/syncro_abp';

async function deleteProductInfoAtlas() {
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
        console.error('❌ Error:', error.message);
    } finally {
        await mongoose.connection.close();
    }
}

deleteProductInfoAtlas();
