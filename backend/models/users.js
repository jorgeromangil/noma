const { Schema, model } = require('mongoose');

// Crear el esquema de usuario
const UserSchema = Schema({
    name: {
        type: String,
        required: true
    },
    surname: {
        type: String,
        // No obligatorio para permitir cuentas externas (Google) sin apellido
        required: false,
        default: ''
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    slug: {
        type: String,
        unique: true,
        sparse: true,
        index: true
    },
    password: {
        type: String,
        required: true,
    },
    image: {
        type: String,
        default: ''
    },
    active: {
        type: Boolean,
        default: true
    },
    role: {
        type: String,
        required: true,
        default: 'regular',
        index: true
    },
    // Campos específicos para usuarios con role 'artisan'
    company_name: {
        type: String,
        required: function() { return this.role === 'artisan'; }
    },
    description: {
        type: String,
        required: function() { return this.role === 'artisan'; }
    },
    address_text: {
        type: String,
        required: function() { return this.role === 'artisan'; }
    },
    contact: {
        type: String,
        required: function() { return this.role === 'artisan'; }
    },
    province: {
        type: String,
        required: function() { return this.role === 'artisan'; }
    },
    // Marca si el usuario se registró/ligó vía Google
    google: {
        type: Boolean,
        default: false
    },
    // Estado del perfil artisan (si aplica)
    artisanStatus: {
        type: String,
        enum: ['none', 'pending', 'approved', 'rejected'],
        default: 'none'
    },
    favorites: [{
        type: Schema.Types.ObjectId,
        ref: 'Product',
        default: []
    }],
}, { collection: 'users', timestamps: true });

// Crear modificación al método toJSON para personalizar la respuesta
UserSchema.method('toJSON', function() {
    const { __v, _id, password, ...object } = this.toObject();
    object.uid = _id;
    return object;
});

module.exports = model('User', UserSchema);
