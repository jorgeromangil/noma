const jwt = require('jsonwebtoken');
const User = require('../models/users');

const USER_DISABLED_CODE = 'USER_DISABLED';

const validateJWT = async (req, res, next) => {
    // Prefer Authorization: Bearer <token>; keep backward compatibility with x-token
    const authHeader = req.header('authorization') || req.header('Authorization') || '';
    const bearerToken = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : null;
    const legacyToken = req.header('x-token');
    const token = bearerToken || legacyToken;

    if (!token) {
        return res.status(401).json({
            ok: false,
            msg: 'Falta token de autorización'
        });
    }
    try {
        // Devuelve el payload { uid, role }
        const { uid } = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(uid);

        if (!user) {
            return res.status(401).json({
                ok: false,
                msg: 'Token no válido'
            });
        }

        if (user.active === false) {
            return res.status(403).json({
                ok: false,
                code: USER_DISABLED_CODE,
                msg: 'Tu cuenta está desactivada. Contacta con administración.'
            });
        }

        req.uid = uid;
        req.role = user.role;
        req.user = user;
        next();
    } catch (error) {
        return res.status(401).json({
            ok: false,
            msg: 'Token no válido'
        });
    }
}

module.exports = {
    validateJWT
};
