// routes/dialogflow.js
const { Router } = require('express');
const dialogflowBridge = require('../controllers/dialogflowBridge'); // <--- CAMBIA ESTO

const router = Router();

// Ahora el frontend le habla al puente, y el puente se encarga del resto
router.post('/webhook', dialogflowBridge); 

module.exports = router;