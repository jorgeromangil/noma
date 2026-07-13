const { Router } = require('express');
const { getPublicStats } = require('../controllers/publicStats');

const router = Router();

// GET /api/public/stats
router.get('/stats', getPublicStats);

module.exports = router;
