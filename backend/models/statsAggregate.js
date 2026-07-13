const { Schema, model } = require('mongoose');

// Esquema para estadísticas agregadas por periodo
const StatsAggregateSchema = Schema({
  periodo: { type: String, enum: ['hoy', 'dia', 'semana', 'mes'], required: true },
  fechaInicio: { type: Date, required: true }, // Inicio del periodo
  fechaFin: { type: Date, required: true },   // Fin del periodo
  datos: { type: Schema.Types.Mixed, required: true }, // Objeto con los datos agregados
  creadoEn: { type: Date, default: Date.now },
});

StatsAggregateSchema.index({ periodo: 1, fechaInicio: 1, fechaFin: 1 }, { unique: true });

module.exports = model('StatsAggregate', StatsAggregateSchema);
