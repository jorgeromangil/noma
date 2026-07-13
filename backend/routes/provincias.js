const { Router } = require('express');
const { 
    getProvincias, 
    getAutonomousCommunity, 
    searchProvincias,
    getAutonomousCommunities,
    getProvinciasByAutonomousCommunity
} = require('../helpers/provincias');

const router = Router();

/**
 * GET /api/provincias
 * Obtiene el listado de todas las provincias
 */
router.get('/', (req, res) => {
    try {
        const provincias = getProvincias();
        res.json({
            ok: true,
            msg: 'Listado de provincias',
            data: provincias,
            total: provincias.length
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error obteniendo provincias'
        });
    }
});

/**
 * GET /api/provincias/search
 * Query param: q (término de búsqueda)
 * Busca provincias por término
 */
router.get('/search', (req, res) => {
    try {
        const searchTerm = req.query.q || '';
        const results = searchProvincias(searchTerm);
        res.json({
            ok: true,
            msg: 'Resultados de búsqueda',
            data: results,
            total: results.length
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error en búsqueda'
        });
    }
});

/**
 * GET /api/provincias/comunidades
 * Obtiene el listado de comunidades autónomas únicas
 */
router.get('/comunidades', (req, res) => {
    try {
        const comunidades = getAutonomousCommunities();
        res.json({
            ok: true,
            msg: 'Listado de comunidades autónomas',
            data: comunidades,
            total: comunidades.length
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error obteniendo comunidades'
        });
    }
});

/**
 * GET /api/provincias/:provincia/comunidad
 * Obtiene la comunidad autónoma de una provincia específica
 */
router.get('/:provincia/comunidad', (req, res) => {
    try {
        const { provincia } = req.params;
        const comunidad = getAutonomousCommunity(provincia);
        
        if (!comunidad) {
            return res.status(404).json({
                ok: false,
                msg: 'Provincia no encontrada'
            });
        }

        res.json({
            ok: true,
            msg: 'Comunidad autónoma obtenida',
            data: {
                provincia,
                comunidad_autonoma: comunidad
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error obteniendo comunidad'
        });
    }
});

/**
 * GET /api/provincias/comunidades/:comunidad
 * Obtiene las provincias de una comunidad autónoma
 */
router.get('/comunidades/:comunidad', (req, res) => {
    try {
        const { comunidad } = req.params;
        const provincias = getProvinciasByAutonomousCommunity(comunidad);
        
        res.json({
            ok: true,
            msg: 'Provincias obtenidas',
            data: provincias,
            total: provincias.length
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error obteniendo provincias'
        });
    }
});

module.exports = router;
