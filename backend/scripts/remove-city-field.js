/**
 * Script para eliminar el campo city de usuarios y productos en MongoDB Atlas
 *
 * ADVERTENCIA: Haz un backup antes de ejecutar.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const DB_CNN = process.env.DBCONNECTION || process.env.DB_CNN || 'mongodb://localhost:27017/syncro_abp';

async function removeCityField() {
    try {
        await mongoose.connect(DB_CNN);

        const db = mongoose.connection.db;
        const usersCollection = db.collection('users');
        const productsCollection = db.collection('products');

        // Eliminar campo city de usuarios
        const usersResult = await usersCollection.updateMany(
            { city: { $exists: true } },
            { $unset: { city: "" } }
        );

        // Eliminar campo city de productos
        const productsResult = await productsCollection.updateMany(
            { city: { $exists: true } },
            { $unset: { city: "" } }
        );

    } catch (error) {
        console.error('❌ Error durante la eliminación del campo city:', error);
    } finally {
        await mongoose.connection.close();
    }
}

// Ejecutar
removeCityField();
