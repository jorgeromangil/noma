/*
Importación de módulos
*/
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

// Aviso al arrancar sobre variables de entorno relevantes
if (!process.env.NOMINATIM_EMAIL) {
    console.warn('Advertencia: la variable NOMINATIM_EMAIL no está configurada. Copia `.env.example` a `.env` y añade un email de contacto para evitar 403 de Nominatim.');
}

const { dbConnection } = require('./database/configdb');

const app = express();
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const INSTANCE_NAME = process.env.INSTANCE_NAME || `api-node-${PORT}`;
const BACKEND_METADATA = {
    instance: INSTANCE_NAME,
    host: HOST,
    port: PORT,
    pid: process.pid
};

dbConnection();

// =========================================================================
// CONFIGURACIÓN DE MIDDLEWARES Y CORS CORREGIDA
// =========================================================================

// 1. Configuración explícita de CORS para Netlify
const corsOptions = {
    origin: 'https://noma-syncro.netlify.app', // Tu frontend
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-token', 'X-Requested-With'], // Añade aquí si usas otra cabecera para el token
    credentials: true,
    optionsSuccessStatus: 200 // Responde 200 a los OPTIONS de navegadores viejos o estrictos
};

app.use(cors(corsOptions));

// 2. Parseo de JSON (Debe ir ANTES de las rutas para leer el body de /batch-details)
app.use(express.json({ limit: '50mb' }));

// 3. Tus cabeceras personalizadas de metadatos
app.use((_req, res, next) => {
    res.setHeader('X-Backend-Instance', BACKEND_METADATA.instance);
    res.setHeader('X-Backend-Port', String(BACKEND_METADATA.port));
    res.setHeader('X-Backend-Pid', String(BACKEND_METADATA.pid));
    next();
});

// 4. Tu filtro de métodos permitidos
const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'];
app.use((req, res, next) => {
    if (!allowedMethods.includes(req.method)) {
        return res.status(405).json({ ok: false, msg: 'Método no permitido' });
    }
    next();
});
// =========================================================================

/*
Rutas
*/
// Cualquier ruta que tenga /users será manejada por el archivo routes/users.js
app.use('/api/users', require('./routes/users'));
// Rutas de autenticación
// Usamos /api/auth para agrupar login y register
app.use('/api/auth', require('./routes/auth'));
// Nota: la compatibilidad con /api/login se ha eliminado para evitar rutas confusas.
// Ahora los endpoints son /api/auth/login y /api/auth/register
// Rutas de productos
app.use('/api/products', require('./routes/products'));
// Rutas de estadisticas
app.use('/api/stats', require('./routes/stats'));
// Ruta pública para estadísticas mínimas
app.use('/api/public', require('./routes/public'));
// Ruta para analytics (registro de eventos)
app.use('/api/analytics', require('./routes/analytics'));
// Rutas de provincias
app.use('/api/provincias', require('./routes/provincias'));
// Rutas de administración (solo admin)
app.use('/api/admin', require('./routes/adminStats'));
//Ruta para dialogflow
app.use('/api/dialogflow', require('./routes/dialogflow'));
// Abrir la aplicacíon en el puerto que configuremos en el .env (fallback 3000)

const dialogflowBridge = require('./controllers/dialogflowBridge');
app.post('/api/dialogflow', dialogflowBridge);

app.listen(PORT, HOST, () => {
});
