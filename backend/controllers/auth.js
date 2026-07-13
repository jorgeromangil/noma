const User = require('../models/users');
const { response } = require('express');
const bcrypt = require('bcryptjs');
const { generateJWT } = require('../helpers/jwt');
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const USER_DISABLED_CODE = 'USER_DISABLED';

const sendDisabledUserResponse = (res = response) => res.status(403).json({
    ok: false,
    code: USER_DISABLED_CODE,
    msg: 'Tu cuenta está desactivada. Contacta con administración.',
    token: ''
});

/*
login: Realiza el login de un usuario
*/
const login = async(req, res = response) => {
    const { email, password } = req.body;

    try {
        // Importante no dar pistas si el email o la contraseña son incorrectos
        // Verificar si el usuario existe
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({
                ok: false,
                msg: 'Credenciales incorrectas',
                token: ''
            });
        }
        if (user.active === false) {
            return sendDisabledUserResponse(res);
        }
        // Confirmar las contraseñas
        const validPassword = bcrypt.compareSync(password, user.password);
        if (!validPassword) {
            return res.status(400).json({
                ok: false,
                msg: 'Credenciales incorrectas',
                token: ''
            });
        }
        // Generar JWT
        const token = await generateJWT(user._id, user.role);
        res.json({
            ok: true,
            msg: 'Login exitoso',
            user,
            token
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            msg: 'Error en el login',
            token: ''
        });
    }
};

// export at the end of the file

/*
register: Registro público de usuarios
<--- name, surname, email, password, role (solo 'regular' o 'artisan' permitidos)
---> Devuelve el usuario creado y token
*/
const register = async(req, res = response) => {
    const { name, surname, email, password, role, company_name, description, address_text, contact, province } = req.body;
    try {
        // No permitir creación de admin desde la ruta pública
        if (role === 'admin') {
            return res.status(403).json({
                ok: false,
                msg: 'No autorizado para crear usuarios administradores'
            });
        }

        const existingEmail = await User.findOne({ email });
        if (existingEmail) {
            return res.status(400).json({
                ok: false,
                msg: 'El email ya existe'
            });
        }

        const salt = bcrypt.genSaltSync();
        const hashedPassword = bcrypt.hashSync(password, salt);

        // Forzar role a 'regular' por defecto si no viene, o aceptar 'artisan'
        const finalRole = (role === 'artisan') ? 'artisan' : 'regular';

        // Construir el objeto usuario incluyendo campos artisan si corresponde
        const userData = { name, surname, email, password: hashedPassword, role: finalRole };
        if (finalRole === 'artisan') {
            userData.company_name = company_name;
            userData.description = description;
            userData.address_text = address_text;
            userData.contact = contact;
            userData.province = province;
        }

        const user = new User(userData);
        await user.save();

        // Generar token para login inmediato
        const token = await generateJWT(user._id, user.role);

        return res.status(201).json({
            ok: true,
            msg: 'Usuario registrado',
            user,
            token
        });
    } catch (error) {
        return res.status(500).json({
            ok: false,
            msg: 'Error registrando usuario'
        });
    }
};

/*
googleSignIn: Verifica id_token de Google, crea/actualiza usuario y devuelve JWT
*/
const googleSignIn = async(req, res = response) => {
    const { id_token } = req.body;
    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: id_token,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();
        const { email, name, picture, given_name, family_name } = payload;

        let user = await User.findOne({ email });
        if (user && user.active === false) {
            return sendDisabledUserResponse(res);
        }
        if (!user) {
            // Crear usuario regular vinculado a Google
            // Intentamos obtener name/surname de payload: given_name/family_name o dividir name completo
            let firstName = given_name;
            let lastName = family_name;
            if (!firstName && name) {
                const parts = name.trim().split(/\s+/);
                firstName = parts.shift();
                lastName = parts.join(' ');
            }
            // Asegurar que ambos campos no sean cadenas vacías para pasar validación
            if (!firstName) {
                // derivar del email antes del @ si no existe nombre
                const local = email ? email.split('@')[0] : '';
                firstName = local ? local.split(/[\.\-_]/)[0] : 'Usuario';
            }
            if (!lastName) lastName = '';

            const salt = bcrypt.genSaltSync();
            const placeholderPassword = bcrypt.hashSync(Math.random().toString(36), salt);
            // generar avatar si Google no proporciona picture
            const avatar = picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName + (lastName ? ' ' + lastName : ''))}&background=random`;
            user = new User({
                name: firstName,
                surname: lastName,
                email,
                password: placeholderPassword,
                image: avatar,
                role: 'regular',
                google: true
            });
            await user.save();
        } else {
            // Si existe, marcar google = true si no estaba
            if (!user.google) {
                user.google = true;
                if (picture && !user.image) user.image = picture;
                await user.save();
            }
        }

        const token = await generateJWT(user._id, user.role);
        return res.json({
            ok: true,
            msg: 'Google sign-in exitoso',
            user,
            token
        });
    } catch (error) {
        console.error(error);
        return res.status(401).json({
            ok: false,
            msg: 'Token de Google no válido'
        });
    }
};

const validateSession = async (req, res = response) => {
    return res.json({
        ok: true,
        msg: 'Sesión válida',
        user: req.user
    });
};

// Export adicional
module.exports = {
    login,
    register,
    googleSignIn,
    validateSession
};
