const { Router } = require('express');
const { getProducts, getMapLiteProducts, getBatchProductDetails, getProductsCacheMetadata, getProductBySlug, getProductById, getMyProducts, getAdminProducts, createProduct, updateProduct, deleteProduct, reportProduct, getOpenDataDataset, getEstadisticasUso, getReportedProducts, updateReportedProductStatus } = require('../controllers/products');
const { uploadModel3d, getModel3dMetadata, deleteModel3d, serveModel3dPublic } = require('../controllers/model3d');
const { body, check, param } = require('express-validator');
const { validateFields } = require('../middleware/validate-fields');
const { validateJWT } = require('../middleware/validate-jwt');
const { handleUpload } = require('../middleware/model3d-upload');
const rateLimit = require('express-rate-limit');

const uploadLimiter = rateLimit({
    windowMs: (parseInt(process.env.MODEL3D_RATE_WINDOW_MIN || '10', 10)) * 60 * 1000,
    max: parseInt(process.env.MODEL3D_RATE_MAX || '5', 10),
    standardHeaders: true,
    legacyHeaders: false,
});

const router = Router();

const CATEGORY_OPTIONS = [
    'Alimentación',
    'Textil',
    'Barro y Alfarería',
    'Madera y mueble',
    'Otros'
];

const REPORT_REASON_OPTIONS = [
    'contenido_inapropiado',
    'informacion_falsa',
    'spam',
    'derechos_autor',
    'otro'
];

// GET /api/products/usage-stats -> estadísticas de uso reales
router.get('/usage-stats', getEstadisticasUso);

// GET /api/products
router.get('/', [
    check('owner').optional().isMongoId().withMessage('El artesano seleccionado no es válido'),
    check('from', 'El from debe ser un número').optional().isNumeric(),
    check('recordsPerPage', 'recordsPerPage debe ser un número').optional().isNumeric(),
    check('page', 'page debe ser un número').optional().isNumeric(),
    check('pageSize', 'pageSize debe ser un número').optional().isNumeric(),
    validateFields
], getProducts);

// GET /api/products/map-lite -> payload ligero para la precarga del mapa
router.get('/map-lite', getMapLiteProducts);

// POST /api/products/batch-details -> detalles completos de productos por lotes
router.post('/batch-details', [
    body('ids', 'El campo ids debe ser un array con entre 1 y 20 ids').isArray({ min: 1, max: 20 }),
    body('ids.*', 'Todos los ids deben ser MongoId válidos').isMongoId(),
    validateFields
], getBatchProductDetails);

// GET /api/products/cache-metadata -> firma ligera para validar caché del mapa
router.get('/cache-metadata', getProductsCacheMetadata);

// GET /api/products/open-data -> dataset abierto (csv|json)
router.get('/open-data', getOpenDataDataset);

// GET /api/products/my --> productos del usuario autenticado
router.get('/my', [
    validateJWT,
    validateFields,
], getMyProducts);

router.get('/my/:id', [
    validateJWT,
    check('id', 'El id del producto debe ser válido').isMongoId(),
    validateFields,
], getMyProducts);

router.get('/admin', [
    validateJWT,
    check('owner').optional().isMongoId().withMessage('El artesano seleccionado no es válido'),
    check('from', 'El from debe ser un número').optional().isNumeric(),
    check('recordsPerPage', 'recordsPerPage debe ser un número').optional().isNumeric(),
    check('status', 'El estado no es válido').optional().isIn(['visible', 'hidden', 'all']),
    validateFields
], getAdminProducts);

// GET /api/products/slug/:slug -> obtener producto por slug
router.get('/slug/:slug', getProductBySlug);

// GET /api/products/reports/admin - obtener productos reportados (admin only)
router.get('/reports/admin', [
    validateJWT,
    validateFields
], getReportedProducts);

// PUT /api/products/:id/report-status - actualizar estado de moderación (admin only)
router.put('/:id/report-status', [
    validateJWT,
    param('id', 'El id del producto no es válido').isMongoId(),
    check('status', 'El estado es obligatorio').not().isEmpty(),
    check('status', 'Estado de reporte no válido').isIn(['pending', 'dismissed', 'actioned']),
    validateFields
], updateReportedProductStatus);

// GET /api/products/:id/model3d/file -> obtener binario del modelo 3D (público)
router.get('/:id/model3d/file', [
    param('id', 'El id del producto no es válido').isMongoId(),
    validateFields
], serveModel3dPublic);

// GET /api/products/:id -> obtener producto por id
router.get('/:id', [
    param('id', 'El id del producto no es válido').isMongoId(),
    validateFields
], getProductById);

// ─── Modelo 3D ───────────────────────────────────────────────────────────
router.post('/:id/model3d', [
    validateJWT,
    uploadLimiter,
    param('id', 'El id del producto no es válido').isMongoId(),
    validateFields,
    handleUpload
], uploadModel3d);

router.get('/:id/model3d', [
    validateJWT,
    param('id', 'El id del producto no es válido').isMongoId(),
    validateFields
], getModel3dMetadata);

router.delete('/:id/model3d', [
    validateJWT,
    param('id', 'El id del producto no es válido').isMongoId(),
    validateFields
], deleteModel3d);

// POST /api/products
router.post('/', [
    validateJWT,
    check('owner')
        .if((value, { req }) => req.role === 'admin')
        .not()
        .isEmpty()
        .withMessage('Debes seleccionar un artesano para crear el producto')
        .bail(),
    check('owner')
        .if((value, { req }) => req.role === 'admin')
        .isMongoId()
        .withMessage('El artesano seleccionado no es válido'),
    check('name', 'El nombre es obligatorio').not().isEmpty(),
    check('description', 'La descripción es obligatoria').not().isEmpty(),
    check('category', 'La categoría es obligatoria').isIn(CATEGORY_OPTIONS),
    check('historia_origen', 'El origen histórico es obligatorio').not().isEmpty(),
    check('importancia_cultural', 'La importancia cultural es obligatoria').not().isEmpty(),
    check('proceso_elaboracion', 'El proceso de elaboración es obligatorio').not().isEmpty(),
    check('materias_primas', 'Las materias primas son obligatorias').not().isEmpty(),
    check('tiempo_elaboracion', 'El tiempo de elaboración es obligatorio').not().isEmpty(),
    check('media', 'Se requiere al menos un medio en media').isArray({ min: 1 }),
    check('province', 'La provincia es obligatoria').not().isEmpty(),
    check('address_text', 'La dirección es obligatoria').not().isEmpty(),
    validateFields
], createProduct);

// PUT /api/products/:id
router.put('/:id', [
    validateJWT,
    param('id', 'El id del producto no es válido').isMongoId(),
    check('owner')
        .if((value, { req }) => req.role === 'admin' && Object.prototype.hasOwnProperty.call(req.body || {}, 'owner'))
        .not()
        .isEmpty()
        .withMessage('Debes seleccionar un artesano para asignar el producto')
        .bail()
        .isMongoId()
        .withMessage('El artesano seleccionado no es válido'),
    check('name').optional().not().isEmpty(),
    check('description').optional().not().isEmpty(),
    check('category').optional().isIn(CATEGORY_OPTIONS),
    check('historia_origen').optional().not().isEmpty(),
    check('importancia_cultural').optional().not().isEmpty(),
    check('proceso_elaboracion').optional().not().isEmpty(),
    check('materias_primas').optional().not().isEmpty(),
    check('tiempo_elaboracion').optional().not().isEmpty(),
    check('certificaciones_protecciones').optional().not().isEmpty(),
    check('media').optional().isArray({ min: 1 }),
    check('province').optional().not().isEmpty(),
    check('address_text').optional().not().isEmpty(),
    validateFields
], updateProduct);

// DELETE /api/products/:id
router.delete('/:id', [
    validateJWT,
    param('id', 'El id del producto no es válido').isMongoId(),
    validateFields
], deleteProduct);

// POST /api/products/:id/report
router.post('/:id/report', [
    validateJWT,
    param('id', 'El id del producto no es válido').isMongoId(),
    check('reason', 'El motivo del reporte es obligatorio').not().isEmpty(),
    check('reason', 'Motivo de reporte no válido').isIn(REPORT_REASON_OPTIONS),
    check('details').optional({ nullable: true }).isLength({ max: 1000 }).withMessage('El detalle no puede superar los 1000 caracteres'),
    validateFields
], reportProduct);

module.exports = router;
