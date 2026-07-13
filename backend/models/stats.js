const { Schema, model } = require('mongoose');

// Esquema para registrar estadísticas de uso
const StatsSchema = Schema({
  fecha: { type: Date, default: Date.now }, // Fecha de la acción
  tipo: { type: String, required: true }, // Tipo de acción (ahora acepta cualquier string)
  producto: { type: Schema.Types.ObjectId, ref: 'Product' }, // Producto consultado
  ciudad: { type: String }, // Ciudad desde la que se consulta
  usuario: { type: Schema.Types.ObjectId, ref: 'User' }, // Usuario (opcional)
  detalles: { type: Schema.Types.Mixed }, // Otros detalles
});

module.exports = model('Stats', StatsSchema);
