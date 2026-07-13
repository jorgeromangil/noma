const { Router } = require('express');
const { validateJWT } = require('../middleware/validate-jwt');
const { getAdminStats } = require('../controllers/adminStats');
const { getGlobalStatsAggregate } = require('../controllers/stats');

const router = Router();

// GET /api/admin/stats

// GET /api/admin/stats-aggregate
router.get('/stats-aggregate', [validateJWT], getGlobalStatsAggregate);

router.get('/stats', [validateJWT], getAdminStats);

module.exports = router;
