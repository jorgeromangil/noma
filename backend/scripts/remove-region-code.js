#!/usr/bin/env node

/**
 * Script de limpieza (OPCIONAL): Eliminar region_code después de migración
 * 
 * Uso:
 *   node scripts/remove-region-code.js
 * 
 * ⚠️ ADVERTENCIA: 
 *    Ejecutar SOLO después de validar que:
 *    1. La migración fue exitosa (todos tienen 'city')
 *    2. Las búsquedas funcionan correctamente con 'city'
 *    3. Se ha hecho backup de la BD
 * 
 * Este script elimina el campo region_code de:
 *    - Productos
 *    - Usuarios
 */

require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline');

const Product = require('../models/products');
const User = require('../models/users');

const MONGODB_URI = process.env.MONGODB_URI || process.env.DBCONNECTION || 'mongodb://localhost:27017/syncro';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt) {
    return new Promise(resolve => {
        rl.question(prompt, resolve);
    });
}

async function removeRegionCode() {
    try {

        const confirm = await question('¿Continuar? (s/n): ');
        if (confirm.toLowerCase() !== 's') {
            process.exit(0);
        }

        await mongoose.connect(MONGODB_URI);

        // ====================
        // Remover de Productos
        // ====================
        const productResult = await Product.updateMany(
            {},
            { $unset: { region_code: 1 } }
        );

        // ====================
        // Remover de Usuarios
        // ====================
        const userResult = await User.updateMany(
            {},
            { $unset: { region_code: 1 } }
        );


        await mongoose.connection.close();
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error.message);
        await mongoose.connection.close();
        process.exit(1);
    } finally {
        rl.close();
    }
}

// Ejecutar
removeRegionCode();
