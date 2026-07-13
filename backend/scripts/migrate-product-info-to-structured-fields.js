/**
 * Script de migración: product_info -> campos estructurados
 * 
 * Convierte el campo único product_info en:
 * - historia_origen
 * - importancia_cultural
 * - proceso_elaboracion
 * - materias_primas
 * - tiempo_elaboracion
 * - certificaciones_protecciones (opcional)
 * 
 * IMPORTANTE: Este script asigna valores por defecto basados en el product_info existente.
 * Los artesanos deberán actualizar manualmente sus productos con información completa.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const DB_CNN = process.env.DB_CNN || 'mongodb://localhost:27017/syncro_abp';

// Schema temporal que incluye el campo antiguo product_info
const productSchema = new mongoose.Schema({
    name: String,
    description: String,
    product_info: String, // Campo antiguo
    historia_origen: String,
    importancia_cultural: String,
    proceso_elaboracion: String,
    materias_primas: String,
    tiempo_elaboracion: String,
    certificaciones_protecciones: String,
    media: [String],
    city: String,
    address_text: String,
    location: {
        type: {
            type: String,
            enum: ['Point']
        },
        coordinates: [Number]
    },
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, { collection: 'products', timestamps: true });

const Product = mongoose.model('ProductMigration', productSchema);

// Función para dividir inteligentemente el product_info
function parseProductInfo(productInfo, productName) {
    if (!productInfo) {
        return {
            historia_origen: `Producto artesanal tradicional: ${productName}`,
            importancia_cultural: 'Producto con valor cultural y patrimonial.',
            proceso_elaboracion: 'Proceso artesanal tradicional.',
            materias_primas: 'Materias primas de calidad.',
            tiempo_elaboracion: 'Varía según la pieza.'
        };
    }

    // Dividir el texto en oraciones
    const sentences = productInfo.split(/[.!?]+/).filter(s => s.trim().length > 0);

    // Intentar distribuir el contenido de manera inteligente
    const totalSentences = sentences.length;

    let historia_origen = '';
    let importancia_cultural = '';
    let proceso_elaboracion = '';
    let materias_primas = '';
    let tiempo_elaboracion = 'Información pendiente de especificar.';

    if (totalSentences >= 5) {
        // Si hay 5 o más oraciones, distribuir
        historia_origen = sentences.slice(0, Math.ceil(totalSentences * 0.3)).join('. ') + '.';
        importancia_cultural = sentences.slice(Math.ceil(totalSentences * 0.3), Math.ceil(totalSentences * 0.5)).join('. ') + '.';
        proceso_elaboracion = sentences.slice(Math.ceil(totalSentences * 0.5), Math.ceil(totalSentences * 0.8)).join('. ') + '.';
        materias_primas = sentences.slice(Math.ceil(totalSentences * 0.8)).join('. ') + '.';
    } else if (totalSentences >= 3) {
        // Si hay 3-4 oraciones
        historia_origen = sentences[0] + '.';
        importancia_cultural = sentences[1] ? sentences[1] + '.' : 'Producto con valor patrimonial.';
        proceso_elaboracion = sentences.slice(2).join('. ') + '.';
        materias_primas = 'Materias primas tradicionales de calidad.';
    } else {
        // Si hay muy poco texto, repartir lo que hay
        historia_origen = sentences[0] ? sentences[0] + '.' : `Producto artesanal: ${productName}`;
        importancia_cultural = sentences[1] ? sentences[1] + '.' : 'Producto con valor cultural.';
        proceso_elaboracion = sentences[2] || 'Proceso artesanal tradicional.';
        materias_primas = 'Materias primas de calidad.';
    }

    return {
        historia_origen: historia_origen.trim(),
        importancia_cultural: importancia_cultural.trim(),
        proceso_elaboracion: proceso_elaboracion.trim(),
        materias_primas: materias_primas.trim(),
        tiempo_elaboracion
    };
}

async function migrateProducts() {
    try {
        await mongoose.connect(DB_CNN);

        // Buscar productos que aún tienen product_info (campo antiguo)
        const productsToMigrate = await Product.find({
            product_info: { $exists: true }
        });

        if (productsToMigrate.length === 0) {
            return;
        }


        let migrated = 0;
        let skipped = 0;
        let errors = 0;

        for (const product of productsToMigrate) {
            try {
                // Si el producto ya tiene los nuevos campos (migración parcial previa), saltar
                if (product.historia_origen && product.importancia_cultural && product.proceso_elaboracion) {
                    skipped++;
                    continue;
                }


                // Parsear el product_info
                const parsedFields = parseProductInfo(product.product_info, product.name);

                // Actualizar el producto con los nuevos campos
                product.historia_origen = parsedFields.historia_origen;
                product.importancia_cultural = parsedFields.importancia_cultural;
                product.proceso_elaboracion = parsedFields.proceso_elaboracion;
                product.materias_primas = parsedFields.materias_primas;
                product.tiempo_elaboracion = parsedFields.tiempo_elaboracion;
                product.certificaciones_protecciones = ''; // Vacío por defecto

                // NO eliminar product_info aún - lo hacemos después de verificar
                // product.product_info = undefined;

                await product.save();

                migrated++;

            } catch (error) {
                console.error(`   ❌ Error migrando "${product.name}":`, error.message);
                errors++;
            }
        }


    } catch (error) {
        console.error('❌ Error fatal durante la migración:', error);
    } finally {
        await mongoose.connection.close();
    }
}

// Ejecutar migración
migrateProducts();
