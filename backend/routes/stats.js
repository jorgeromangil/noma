const { Router } = require('express');
const { check } = require('express-validator');
const { validateFields } = require('../middleware/validate-fields');
const { validateJWT } = require('../middleware/validate-jwt');
const { getArtisanStats, getArtisanStatsAggregate } = require('../controllers/stats');

const router = Router();

// GET /api/stats/artisan/:id/aggregate?periodo=semana|mes|dia
router.get('/artisan/:id/aggregate', [
    validateJWT,
    check('id', 'El id del usuario no es valido').isMongoId(),
    check('periodo').optional().isIn(['hoy', 'dia', 'semana', 'mes']),
    validateFields
], getArtisanStatsAggregate);

// GET /api/stats/artisan/:id
router.get('/artisan/:id', [
    validateJWT,
    check('id', 'El id del usuario no es valido').isMongoId(),
    validateFields
], getArtisanStats);

module.exports = router;
