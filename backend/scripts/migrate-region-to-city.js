#!/usr/bin/env node

/**
 * Script de migración: region_code -> city
 * 
 * Uso:
 *   node scripts/migrate-region-to-city.js
 * 
 * Este script:
 * 1. Conecta a la BD MongoDB
 * 2. Para cada Producto y Usuario, copia region_code -> city
 * 3. Elimina el campo region_code (opcional, comentado)
 * 
 * ⚠️ IMPORTANTE: Hacer backup de la BD ANTES de ejecutar
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Product = require('../models/products');
const User = require('../models/users');

const MONGODB_URI = process.env.MONGODB_URI || process.env.DBCONNECTION || 'mongodb://localhost:27017/syncro';

async function migrate() {
    try {
        await mongoose.connect(MONGODB_URI);

        // ====================
        // Migrar Productos
        // ====================
        const productCount = await Product.countDocuments({});

        let productsUpdated = 0;
        const products = await Product.find({});

        for (const product of products) {
            let cityToSet = null;

            // 1. Si ya tiene city, saltar
            if (product.city) {
                continue;
            }

            // 2. Si tiene region_code, copiar
            if (product.region_code) {
                cityToSet = product.region_code;
            }
            // 3. Si no, intentar extraer de address_text (después de la última coma)
            else if (product.address_text) {
                const parts = product.address_text.split(',').map(p => p.trim());
                if (parts.length > 0) {
                    // Tomar la segunda posición desde el final (ciudad generalmente viene antes del país)
                    const cityCandidate = parts.length >= 2 ? parts[parts.length - 2] : parts[parts.length - 1];
                    // Filtrar "España" si es el último elemento
                    if (cityCandidate.toLowerCase() !== 'españa') {
                        cityToSet = cityCandidate;
                    }
                }
            }

            if (cityToSet) {
                product.city = cityToSet;
                await product.save();
                productsUpdated++;
            }
        }

        // ====================
        // Migrar Usuarios (Artisans)
        // ====================
        const userCount = await User.countDocuments({ role: 'artisan' });

        let usersUpdated = 0;
        const users = await User.find({ role: 'artisan' });

        for (const user of users) {
            let cityToSet = null;

            // 1. Si ya tiene city, saltar
            if (user.city) {
                continue;
            }

            // 2. Si tiene region_code, copiar
            if (user.region_code) {
                cityToSet = user.region_code;
            }
            // 3. Si no, intentar extraer de address_text
            else if (user.address_text) {
                const parts = user.address_text.split(',').map(p => p.trim());
                if (parts.length > 0) {
                    const cityCandidate = parts.length >= 2 ? parts[parts.length - 2] : parts[parts.length - 1];
                    if (cityCandidate.toLowerCase() !== 'españa') {
                        cityToSet = cityCandidate;
                    }
                }
            }

            if (cityToSet) {
                user.city = cityToSet;
                await user.save();
                usersUpdated++;
            }
        }

        // ====================
        // Resumen
        // ====================


        await mongoose.connection.close();
        process.exit(0);

    } catch (error) {
        console.error('❌ Error en migración:', error.message);
        await mongoose.connection.close();
        process.exit(1);
    }
}

// Ejecutar
migrate();
