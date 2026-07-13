// Script para eliminar todos los eventos de tipo 'consulta' de la colección Stats

const mongoose = require('mongoose');
const Stats = require('../models/stats');
require('dotenv').config();

async function main() {
  await mongoose.connect(process.env.DBCONNECTION, { useNewUrlParser: true, useUnifiedTopology: true });
  const result = await Stats.deleteMany({ tipo: 'consulta' });
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error eliminando eventos:', err);
  process.exit(1);
});
