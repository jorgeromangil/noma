const { Schema, model } = require('mongoose');

const CATEGORY_OPTIONS = [
    'Alimentación',
    'Textil',
    'Barro y Alfarería',
    'Madera y mueble',
    'Otros'
];

// Esquema para productos
const ProductSchema = Schema({
    name: {
        type: String,
        required: true,
            // unique: true
    },
    slug: {
        type: String,
        unique: true,
        sparse: true,
        index: true
    },
    description: {
        type: String,
        required: true
    },
    resumen: {
        type: String,
        required: true
    },
    category: {
        type: String,
        required: true,
        enum: CATEGORY_OPTIONS,
        index: true
    },
    historia_origen: {
        type: String,
        required: true
    },
    importancia_cultural: {
        type: String,
        required: true
    },
    proceso_elaboracion: {
        type: String,
        required: true
    },
    materias_primas: {
        type: String,
        required: true
    },
    tiempo_elaboracion: {
        type: String,
        required: true
    },
    certificaciones_protecciones: {
        type: String,
        required: true
    },
    media: {
        type: [String],
        required: true,
        validate: {
            validator: function(arr) {
                return Array.isArray(arr) && arr.length > 0;
            },
            message: 'Se requiere al menos un elemento en media'
        }
    },
    province: {
        type: String,
        required: true
    },
    autonomous_community: {
        type: String,
        required: true,
        index: true
    },
    address_text: {
        type: String,
        required: true
    },
    active: {
        type: Boolean,
        default: true,
        index: true
    },
    // GeoJSON point for coordinates derived from address_text
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
            default: undefined
        }
    },

}, { collection: 'products', timestamps: true, versionKey: false });

// Propietario: referencia al Usuario que posee/gestiona el producto
ProductSchema.add({
    owner: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    }
});

// Modelo 3D opcional (glb)
ProductSchema.add({
    model3d: {
        url: { type: String, default: null },
        filename: { type: String, default: null },
        originalName: { type: String, default: null },
        driveFileId: { type: String, default: null },
        driveMimeType: { type: String, default: null },
        sizeBytes: { type: Number, default: null },
        sha256: { type: String, default: null },
        uploadedAt: { type: Date, default: null },
        uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }
    }
});

// Reportes de contenido (moderación)
ProductSchema.add({
    report_count: {
        type: Number,
        default: 0,
        index: true
    },
    last_reported_at: {
        type: Date,
        default: null,
        index: true
    },
    report_status: {
        type: String,
        enum: ['pending', 'reviewed', 'dismissed', 'actioned'],
        default: 'pending',
        index: true
    },
    reports: [{
        reason: {
            type: String,
            required: true,
            enum: ['contenido_inapropiado', 'informacion_falsa', 'spam', 'derechos_autor', 'otro']
        },
        details: {
            type: String,
            default: '',
            maxlength: 1000
        },
        reporter: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        createdAt: {
            type: Date,
            default: Date.now
        }
    }]
});

// Contador desnormalizado de favoritos (se incrementa/decrementa en addFavorite/removeFavorite)
ProductSchema.add({
    favoritesCount: {
        type: Number,
        default: 0,
        index: true
    }
});

// Ocultar campos sensibles y transformar _id a uid
ProductSchema.method('toJSON', function() {
    const { __v, _id, reports, report_count, last_reported_at, report_status, ...object } = this.toObject();
    object.uid = _id;
    return object;
});

// Índice geoespacial para consultas de proximidad
ProductSchema.index({ location: '2dsphere' });

module.exports = model('Product', ProductSchema);
