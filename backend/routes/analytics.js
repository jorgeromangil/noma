const { Router } = require('express');
const { check } = require('express-validator');
const { validateFields } = require('../middleware/validate-fields');
const { validateJWT } = require('../middleware/validate-jwt');
const Stats = require('../models/stats');

const router = Router();

// POST /api/stats/event - registrar evento de analytics
router.post('/event', [
    check('tipo', 'El tipo de evento es obligatorio').not().isEmpty(),
    validateFields
], async (req, res) => {
    try {
        const { tipo, producto, ciudad, detalles } = req.body;
        // Si hay JWT válido, req.uid estará presente (por validateJWT), si no, será undefined
        let usuario = null;
        if (req.headers['x-token']) {
            // Intentar decodificar el token manualmente si existe
            try {
                const jwt = require('../helpers/jwt');
                const decoded = jwt.decodeToken(req.headers['x-token']);
                usuario = decoded?.uid || decoded?._id || null;
            } catch (e) { usuario = null; }
        }
        const stat = await Stats.create({
            tipo,
            producto: producto || undefined,
            ciudad: ciudad || undefined,
            usuario,
            detalles: detalles || undefined
        });
        res.json({ ok: true, stat });
    } catch (error) {
        console.error('Error registrando evento stats:', error);
        res.status(500).json({ ok: false, msg: 'Error registrando evento' });
    }
});

module.exports = router;
