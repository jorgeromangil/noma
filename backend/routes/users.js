// Ruta base: /api/users

const { Router } = require('express');
const { getUsers, createUser, updateUser, deleteUser, completeArtisan, getPublicArtisanById, getPublicArtisanBySlug, getFavorites, addFavorite, removeFavorite } = require('../controllers/users');
const { check } = require('express-validator');
const { validateFields } = require('../middleware/validate-fields');
const { validateRole } = require('../middleware/validate-role');
const { validateJWT } = require('../middleware/validate-jwt');

const router = Router();

// PERFIL PÚBLICO DE ARTESANO (sin JWT) -> /api/users/artisan/:id
router.get('/artisan/slug/:slug', getPublicArtisanBySlug);
router.get('/artisan/:id', [
    check('id', 'El id de usuario debe ser válido').isMongoId(),
    validateFields,
], getPublicArtisanById);

router.get('/', [
    validateJWT,
    check('all', 'all debe ser booleano').optional().isBoolean(),
    check('from', 'El from debe ser un número').optional().isNumeric(),
    check('recordsPerPage', 'recordsPerPage debe ser un número').optional().isNumeric(),
    check('role', 'El rol no es válido').optional().isIn(['regular', 'artisan', 'admin']),
    check('status', 'El estado no es válido').optional().isIn(['active', 'inactive', 'all']),
    validateFields,
], getUsers);

// Favoritos del usuario autenticado
router.get('/favorites', [
    validateJWT,
    validateFields,
], getFavorites);

router.post('/favorites/:productId', [
    validateJWT,
    check('productId', 'El id del producto debe ser válido').isMongoId(),
    validateFields,
], addFavorite);

router.delete('/favorites/:productId', [
    validateJWT,
    check('productId', 'El id del producto debe ser válido').isMongoId(),
    validateFields,
], removeFavorite);

router.post('/', [
    validateJWT,
    check('name', 'El nombre es obligatorio').not().isEmpty(),
    check('surname', 'El apellido es obligatorio').not().isEmpty(),
    check('email', 'El email es obligatorio').not().isEmpty(),
    check('password', 'La contraseña es obligatoria').not().isEmpty(),
    check('email', 'El email no es válido').isEmail(),
    check('password', 'La contraseña debe tener al menos 6 caracteres').isLength({ min: 6 }),
    check('company_name').if((value, { req }) => req.body.role === 'artisan').not().isEmpty().withMessage('company_name obligatorio para artisan'),
    check('description').if((value, { req }) => req.body.role === 'artisan').not().isEmpty().withMessage('description obligatorio para artisan'),
    check('address_text').if((value, { req }) => req.body.role === 'artisan').not().isEmpty().withMessage('address_text obligatorio para artisan'),
    check('contact').if((value, { req }) => req.body.role === 'artisan').not().isEmpty().withMessage('contact obligatorio para artisan'),
    check('province').if((value, { req }) => req.body.role === 'artisan').not().isEmpty().withMessage('province obligatorio para artisan'),
    check('province').if((value, { req }) => req.body.role === 'artisan').custom((value) => {
        const { getCanonicalProvinceName } = require('../helpers/provincias');
        if (!getCanonicalProvinceName(value)) {
            throw new Error('Provincia inválida');
        }
        return true;
    }),
    validateFields,
    validateRole
], createUser);

// Endpoint para que un usuario autenticado complete su perfil artisan
router.put('/complete-artisan', [
    validateJWT,
    check('company_name', 'company_name es obligatorio').not().isEmpty(),
    check('description', 'description es obligatorio').not().isEmpty(),
    check('address_text', 'address_text es obligatorio').not().isEmpty(),
    check('contact', 'contact es obligatorio').not().isEmpty(),
    check('province', 'province es obligatorio').not().isEmpty(),
    check('province').custom((value) => {
        const { getCanonicalProvinceName } = require('../helpers/provincias');
        if (!getCanonicalProvinceName(value)) {
            throw new Error('Provincia inválida');
        }
        return true;
    }),
    validateFields
], completeArtisan);

router.get('/:id', [
    validateJWT,
    check('id', 'El id de usuario debe ser válido').isMongoId(),
    validateFields,
], getUsers);

// El password no se debe actualizar aquí, hacer procedimientos especiales
router.put('/:id', [
    validateJWT,
    check('name', 'El nombre es obligatorio').optional().not().isEmpty(),
    check('surname', 'El apellido es obligatorio').optional().not().isEmpty(),
    check('email', 'El email es obligatorio').optional().not().isEmpty(),
    check('email', 'El email no es válido').optional().isEmail(),
    check('id', 'El id del usuario no es válido').isMongoId(),
    check('active', 'active debe ser booleano').optional().isBoolean(),
    check('province').optional().custom((value, { req }) => {
        if (req.body.role === 'artisan' && value) {
            const { getCanonicalProvinceName } = require('../helpers/provincias');
            if (!getCanonicalProvinceName(value)) {
                throw new Error('Provincia inválida');
            }
        }
        return true;
    }),
    validateFields,
    validateRole
], updateUser);

router.delete('/:id', [
    validateJWT,
    check('id', 'El id del usuario no es válido').isMongoId(),
    validateFields
], deleteUser);

module.exports = router;
