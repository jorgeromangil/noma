/**
 * Script para mostrar ejemplos de documentos con el campo city en users y products
 *
 * Ejecuta: node scripts/show-city-examples.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const DB_CNN = process.env.DB_CNN || 'mongodb://localhost:27017/syncro_abp';

async function showCityExamples() {
    try {
        await mongoose.connect(DB_CNN);

        const db = mongoose.connection.db;
        const usersCollection = db.collection('users');
        const productsCollection = db.collection('products');

        // Buscar usuarios con city
        const users = await usersCollection.find({ city: { $exists: true } }).limit(5).toArray();
        const usersCount = await usersCollection.countDocuments({ city: { $exists: true } });

        // Buscar productos con city
        const products = await productsCollection.find({ city: { $exists: true } }).limit(5).toArray();
        const productsCount = await productsCollection.countDocuments({ city: { $exists: true } });

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.connection.close();
    }
}

showCityExamples();
