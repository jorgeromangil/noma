// Ruta base: /api/login

const { Router } = require('express');
const { login, register, googleSignIn, validateSession } = require('../controllers/auth');
const { check } = require('express-validator');
const { validateFields } = require('../middleware/validate-fields');
const { validateJWT } = require('../middleware/validate-jwt');

const router = Router();

// POST /api/auth/login
router.post('/login', [
    check('email', 'El email es obligatorio').not().isEmpty(),
    check('password', 'La contraseña es obligatoria').not().isEmpty(),
    check('email', 'El email no es válido').isEmail(),
    validateFields,
], login);

// Ruta pública de registro: /api/auth/register

router.post('/register', [
    // Campos básicos obligatorios
    check('name', 'El nombre es obligatorio').not().isEmpty(),
    check('surname', 'El apellido es obligatorio').not().isEmpty(),
    check('email', 'El email es obligatorio').not().isEmpty(),
    check('password', 'La contraseña es obligatoria').not().isEmpty(),
    check('email', 'El email no es válido').isEmail(),
    check('password', 'La contraseña debe tener al menos 6 caracteres').isLength({ min: 6 }),
    // role obligatorio en registro público y debe ser 'regular' o 'artisan'
    check('role', 'El role es obligatorio').not().isEmpty(),
    check('role').isIn(['regular', 'artisan']).withMessage('role inválido'),
    // Si role === 'artisan', entonces requerimos campos adicionales
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
    validateFields
], register);

// POST /api/auth/google  -> Google Sign-In (client sends id_token)
router.post('/google', [
    check('id_token', 'id_token es requerido').not().isEmpty(),
    validateFields
], googleSignIn);

router.get('/validate', [
    validateJWT,
    validateFields
], validateSession);

module.exports = router;
