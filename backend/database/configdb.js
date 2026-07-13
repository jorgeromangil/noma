// Importar mongoose
const mongoose = require('mongoose');

// Crear la función de conexión a la base de datos
const dbConnection = async () => {
    try {
        await mongoose.connect(process.env.DBCONNECTION);
    } catch (error) {
        console.error('❌ Error conectando a MongoDB:', error?.message || error);
        // Propaga el error original para no perder detalles
        throw error;
    }
};

// Exportar la función de conexión
module.exports = {
    dbConnection
};
