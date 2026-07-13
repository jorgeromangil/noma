/**
 * Script para eliminar los campos summary de los productos
 * 
 * Elimina los siguientes campos:
 * - description_summary
 * - historia_origen_summary
 * - importancia_cultural_summary
 * - proceso_elaboracion_summary
 * 
 * ADVERTENCIA: Este script es IRREVERSIBLE sin backup.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const DB_CNN = process.env.DB_CNN || 'mongodb://localhost:27017/syncro_abp';

async function removeSummaryFields() {
    try {
        await mongoose.connect(DB_CNN);

        const db = mongoose.connection.db;
        const productsCollection = db.collection('products');

        // Campos a eliminar
        const fieldsToRemove = [
            'description_summary',
            'historia_origen_summary',
            'importancia_cultural_summary',
            'proceso_elaboracion_summary'
        ];

        // Construir el objeto de eliminación
        const unsetObject = {};
        fieldsToRemove.forEach(field => {
            unsetObject[field] = "";
        });

        // Eliminar los campos

        await productsCollection.updateMany(
            {
                $or: fieldsToRemove.map(field => ({ [field]: { $exists: true } }))
            },
            { $unset: unsetObject }
        );

    } catch (error) {
        console.error('❌ Error durante la eliminación:', error);
    } finally {
        await mongoose.connection.close();
    }
}

// Ejecutar
removeSummaryFields();
