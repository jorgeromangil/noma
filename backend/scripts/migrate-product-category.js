#!/usr/bin/env node

/**
 * Script de migracion: agregar categoria a productos existentes
 *
 * Uso:
 *   node scripts/migrate-product-category.js
 *
 * Este script:
 * 1. Reemplaza "Agroalimentario" -> "Alimentacion"
 * 2. Asigna "Otros" a productos sin categoria
 *
 * Importante: hacer backup antes de ejecutar.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../models/products');

const MONGODB_URI = process.env.MONGODB_URI || process.env.DBCONNECTION || process.env.DB_CNN || 'mongodb://localhost:27017/syncro';

async function migrateProductCategory() {
    try {
        await mongoose.connect(MONGODB_URI);


        const renameResult = await Product.updateMany(
            { category: 'Agroalimentario' },
            { $set: { category: 'Alimentación' } }
        );

        const defaultResult = await Product.updateMany(
            { $or: [{ category: { $exists: false } }, { category: '' }, { category: null }] },
            { $set: { category: 'Otros' } }
        );

    } catch (error) {
        console.error('❌ Error en migracion:', error.message || error);
        process.exitCode = 1;
    } finally {
        await mongoose.connection.close();
    }
}

migrateProductCategory();
