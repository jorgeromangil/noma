/**
 * Script para eliminar el campo product_info después de verificar la migración
 * 
 * ADVERTENCIA: Solo ejecutar este script después de:
 * 1. Haber ejecutado migrate-product-info-to-structured-fields.js
 * 2. Verificar que todos los productos tienen los nuevos campos completos
 * 3. Hacer un backup de la base de datos
 * 
 * Este script es IRREVERSIBLE sin backup.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const DB_CNN = process.env.DB_CNN || 'mongodb://localhost:27017/syncro_abp';

async function removeProductInfoField() {
    try {
        await mongoose.connect(DB_CNN);

        const db = mongoose.connection.db;
        const productsCollection = db.collection('products');

        // Verificar que todos los productos tienen los nuevos campos

        const productosIncompletos = await productsCollection.countDocuments({
            $or: [
                { historia_origen: { $exists: false } },
                { importancia_cultural: { $exists: false } },
                { proceso_elaboracion: { $exists: false } },
                { materias_primas: { $exists: false } },
                { tiempo_elaboracion: { $exists: false } }
            ]
        });

        if (productosIncompletos > 0) {
            return;
        }


        // Contar productos con product_info
        const countWithOldField = await productsCollection.countDocuments({
            product_info: { $exists: true }
        });

        if (countWithOldField === 0) {
            return;
        }


        // Pedir confirmación (si se ejecuta interactivamente)

        // Eliminar el campo product_info de todos los documentos

        await productsCollection.updateMany({ product_info: { $exists: true } }, { $unset: { product_info: "" } });

    } catch (error) {
        console.error('❌ Error durante la eliminación del campo:', error);
    } finally {
        await mongoose.connection.close();
    }
}

// Ejecutar
removeProductInfoField();
