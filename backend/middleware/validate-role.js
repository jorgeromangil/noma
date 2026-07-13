const { response } = require('express');
const allowedRoles = ['regular', 'artisan', 'admin'];

// Valida que el role (si viene en el body) sea uno de los permitidos
const validateRole = (req, res = response, next) => {
    const { role } = req.body;
    if (role && !allowedRoles.includes(role)) {
        return res.status(400).json({
            ok: false,
            msg: 'El rol no es válido'
        });
    }
    next();
}

module.exports = {
    validateRole
};