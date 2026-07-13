const User = require('../models/users');
const Product = require('../models/products');
const { response } = require('express');
const bcrypt = require('bcryptjs');
const { generateJWT } = require('../helpers/jwt');
const { slugify, ensureUniqueSlug } = require('../helpers/slug');
const { deleteModelFile } = require('../helpers/model3d-storage');
const { getCanonicalProvinceName } = require('../helpers/provincias');

const ACTIVE_USERS_MATCH = {
    $or: [{ active: true }, { active: { $exists: false } }]
};
const ADMIN_USER_LIST_FIELDS = 'name surname email role active company_name description address_text contact province artisanStatus image slug createdAt updatedAt';

const isUserActive = (user) => !!user && user.active !== false;

const serializeUser = (user) => {
    if (!user) return null;

    if (typeof user.toJSON === 'function') {
        return user.toJSON();
    }

    const plainUser = { ...user };
    plainUser.uid = String(plainUser._id || plainUser.uid || '');
    delete plainUser._id;
    delete plainUser.__v;
    delete plainUser.password;
    return plainUser;
};

const serializeUsers = (users = []) => users.map(serializeUser).filter(Boolean);

const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildUserStatusFilter = (status = 'all') => {
    if (status === 'active') {
        return ACTIVE_USERS_MATCH;
    }

    if (status === 'inactive') {
        return { active: false };
    }

    return null;
};

const buildUsersFilter = ({ q = '', role = '', status = 'all' }) => {
    const clauses = [];
    const statusClause = buildUserStatusFilter(status);

    if (statusClause) {
        clauses.push(statusClause);
    }

    if (role) {
        clauses.push({ role });
    }

    const trimmedQuery = String(q || '').trim();
    if (trimmedQuery) {
        const rx = new RegExp(escapeRegExp(trimmedQuery), 'i');
        clauses.push({
            $or: [
                { name: rx },
                { surname: rx },
                { email: rx },
                { company_name: rx }
            ]
        });
    }

    if (!clauses.length) {
        return {};
    }

    return clauses.length === 1 ? clauses[0] : { $and: clauses };
};

const normalizeProvince = (province) => {
    if (!province) return province;
    return getCanonicalProvinceName(province) || province;
};

const validateArtisanData = (userData) => {
    const requiredFields = ['company_name', 'description', 'address_text', 'contact', 'province'];

    for (const field of requiredFields) {
        if (!String(userData?.[field] || '').trim()) {
            return field;
        }
    }

    return null;
};

const hideOwnedProducts = async (ownerId) => {
    await Product.updateMany({ owner: ownerId }, { $set: { active: false } });
};

const deleteOwnedProducts = async (ownerId) => {
    const products = await Product.find({ owner: ownerId }).select('_id model3d').lean();
    const productIds = products.map((product) => product._id);

    for (const product of products) {
        const model3d = product?.model3d || null;
        if (model3d && (model3d.driveFileId || model3d.filename)) {
            await deleteModelFile(String(product._id), model3d.filename, model3d.driveFileId);
        }
    }

    if (productIds.length > 0) {
        await User.updateMany(
            { favorites: { $in: productIds } },
            { $pull: { favorites: { $in: productIds } } }
        );
        await Product.deleteMany({ _id: { $in: productIds } });
    }
};

const buildUserSlugBase = (user) => {
    if (!user) return 'usuario';
    const company = user.company_name && String(user.company_name).trim();
    if (company) return company;
    const name = [user.name, user.surname].filter(Boolean).join(' ').trim();
    if (name) return name;
    return user.email || 'usuario';
};

/*
getPublicArtisanById: Obtener perfil público de un artesano (sin JWT)
---> Devuelve campos no sensibles del artesano para su ficha pública
*/
const getPublicArtisanById = async (req, res = response) => {
    const id = req.params.id;

    try {
        const artisan = await User.findById(id)
            .select('name surname email contact company_name description address_text province image role artisanStatus slug active')
            .exec();

        if (!artisan || artisan.role !== 'artisan' || !isUserActive(artisan)) {
            return res.status(404).json({
                ok: false,
                msg: 'Artesano no encontrado'
            });
        }

        const artisanData = artisan.toJSON();
        delete artisanData.active;

        return res.json({
            ok: true,
            msg: 'Artesano encontrado',
            artisan: artisanData
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            ok: false,
            msg: 'Error obteniendo artesano'
        });
    }
};

/*
getPublicArtisanBySlug: Obtener perfil publico de un artesano por slug (sin JWT)
---> Devuelve campos no sensibles del artesano para su ficha publica
*/
const getPublicArtisanBySlug = async (req, res = response) => {
    const slug = req.params.slug;

    try {
        const artisan = await User.findOne({ slug })
            .select('name surname email contact company_name description address_text province image role artisanStatus slug active')
            .exec();

        if (!artisan || artisan.role !== 'artisan' || !isUserActive(artisan)) {
            return res.status(404).json({
                ok: false,
                msg: 'Artesano no encontrado'
            });
        }

        const artisanData = artisan.toJSON();
        delete artisanData.active;

        return res.json({
            ok: true,
            msg: 'Artesano encontrado',
            artisan: artisanData
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            ok: false,
            msg: 'Error obteniendo artesano'
        });
    }
};

/*
getUsers: Obtener todos los usuarios
<--- id? from?, recordsPerPage?
---> Devuelve una lista con todos los usuarios registrados
*/
const getUsers = async(req, res = response) => {
    // Recibir parámetros de paginación
    const from = Math.max(Number(req.query.from) || 0, 0);
    const recordsPerPage = Math.max(Number(req.query.recordsPerPage) || 5, 1);
    const shouldReturnAll = req.query.all === true || req.query.all === 'true';
    // Obtenemos el ID de usuario por si quiere buscar solo un usuario
    const id = req.params.id || '';
    const q = String(req.query.q || '').trim();
    const role = String(req.query.role || '').trim();
    const status = String(req.query.status || 'all').trim() || 'all';

    try {
        let users;
        let total = 0;

        if(id) {
            if (req.role !== 'admin' && req.uid !== id) {
                return res.status(403).json({
                    ok: false,
                    msg: 'No autorizado para listar usuarios'
                });
            }

            //Buscar un usuario específico por ID
            const user = await User.findById(id); 

            if (!user) {
                 return res.status(404).json({
                    ok: false,
                    msg: 'Usuario no encontrado'
                });
            }

            users = [user]; 
            total = 1;      
        }

        // Si no se proporciona ID, obtener todos los usuarios con paginación
        else{
            if (req.role !== 'admin') {
                return res.status(403).json({
                    ok: false,
                    msg: 'No autorizado para listar usuarios'
                });
            }

            const filter = buildUsersFilter({ q, role, status });

            if (shouldReturnAll) {
                users = await User.find(filter)
                    .select(ADMIN_USER_LIST_FIELDS)
                    .sort({ createdAt: -1, _id: -1 })
                    .lean();
                total = users.length;
            } else {
                // Ejecutar las dos promesas de forma simultánea
                [users, total] = await Promise.all([
                    User.find(filter)
                        .select(ADMIN_USER_LIST_FIELDS)
                        .sort({ createdAt: -1, _id: -1 })
                        .skip(from)
                        .limit(recordsPerPage)
                        .lean(),
                    User.countDocuments(filter)
                ]);
            }
        }

        res.json({
            ok: true,
            msg: id ? 'Usuario encontrado' : 'Lista de usuarios',
            users: serializeUsers(users), // En JavaScript es igual a poner users: users
            page: {
                from,
                recordsPerPage: shouldReturnAll ? total : recordsPerPage,
                total // Interesante para el frontend para saber cuántas páginas hay
            }
        });

    } catch (error) {
        // Manejo de errores
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error obteniendo usuarios'
        });
    }
};

/*
createUser: Crear un nuevo usuario
<--- name, surname, email, password, role?, image?
---> Devuelve el usuario creado
*/
// Cuando se llame a createUsers, ya se han validado los campos en la ruta gracias al middleware validate-fields
const createUser = async(req, res = response) => {
    const { email, password, role } = req.body;
    try {
        if (req.role !== 'admin') {
            return res.status(403).json({
                ok: false,
                msg: 'No autorizado para crear usuarios'
            });
        }

        const existingEmail = await User.findOne({ email: email });
        if (existingEmail) {
            return res.status(400).json({
                ok: false,
                msg: 'El email ya existe'
            });
        }

        const salt = bcrypt.genSaltSync();
        const hashedPassword = bcrypt.hashSync(password, salt);

        const finalRole = role || 'regular';
        const userPayload = {
            ...req.body,
            role: finalRole,
            password: hashedPassword,
            active: true
        };

        if (finalRole === 'artisan') {
            const missingField = validateArtisanData(userPayload);
            if (missingField) {
                return res.status(400).json({
                    ok: false,
                    msg: `El campo ${missingField} es obligatorio para usuarios artesanos`
                });
            }

            userPayload.province = normalizeProvince(userPayload.province);
            userPayload.artisanStatus = 'approved';
        } else if (finalRole !== 'artisan') {
            userPayload.artisanStatus = 'none';
        }

        const user = new User(userPayload);
        const slugBase = buildUserSlugBase(user);
        user.slug = await ensureUniqueSlug(User, slugify(slugBase));
        await user.save();

        res.status(201).json({
            ok: true,
            msg: 'Usuario creado',
            user
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({
            ok: false,
            msg: 'Error creando usuario'
        });
    }
};

/*
updateUser: Actualizar un usuario (/:id)
<--- name?, surname?, email?, role?, image?
---> Devuelve el usuario actualizado
*/
const updateUser = async(req, res = response) => {
    const {
        password,
        google,
        email,
        role: requestedRole,
        active: requestedActive,
        ...rest
    } = req.body;
    const uid = req.params.id;

    try {
        // Verificar si el usuario existe
        const existingUser = await User.findById(uid);
        if (!existingUser) {
            return res.status(404).json({
                ok: false,
                msg: 'Usuario no encontrado'
            });
        }

        const isAdminRequest = req.role === 'admin';
        const isSelfRequest = req.uid === uid;

        // Verificar permisos: solo el propio usuario o admin pueden actualizar
        if (!isAdminRequest && !isSelfRequest) {
            return res.status(403).json({
                ok: false,
                msg: 'No autorizado para actualizar este usuario'
            });
        }

        if (isAdminRequest && !isSelfRequest && existingUser.role === 'admin') {
            return res.status(403).json({
                ok: false,
                msg: 'No autorizado para modificar otros administradores'
            });
        }

        if (isAdminRequest && isSelfRequest && requestedActive === false) {
            return res.status(400).json({
                ok: false,
                msg: 'No puedes desactivar tu propia cuenta'
            });
        }

        const nextEmail = email || existingUser.email;

        // 2. Validación del Email
        if (existingUser.email !== nextEmail) {
            const emailExists = await User.findOne({ email: nextEmail });
            if (emailExists) {
                return res.status(400).json({
                    ok: false,
                    msg: 'El email ya existe'
                });
            }
        }

        const object = {};
        const mutableFields = ['name', 'surname', 'company_name', 'description', 'address_text', 'contact', 'province', 'image'];
        mutableFields.forEach((field) => {
            if (field in rest) {
                object[field] = rest[field];
            }
        });

        let finalRole = existingUser.role;
        if (isAdminRequest && typeof requestedRole === 'string' && requestedRole.trim()) {
            finalRole = requestedRole;
            object.role = finalRole;
        }

        if (isAdminRequest && typeof requestedActive !== 'undefined') {
            object.active = requestedActive !== false && requestedActive !== 'false';
        }

        // 3. LOGICA DE LA CONTRASEÑA (¡Nueva!)
        // Si el usuario envió una contraseña, la encriptamos y la añadimos al objeto a actualizar
        if (password) {
            const salt = bcrypt.genSaltSync();
            object.password = bcrypt.hashSync(password, salt);
        }

        object.email = nextEmail;

        const mergedUserData = {
            ...existingUser.toObject(),
            ...object,
            role: finalRole,
            email: nextEmail
        };

        if (finalRole === 'artisan') {
            const missingField = validateArtisanData(mergedUserData);
            if (missingField) {
                return res.status(400).json({
                    ok: false,
                    msg: `El campo ${missingField} es obligatorio para usuarios artesanos`
                });
            }

            object.province = normalizeProvince(mergedUserData.province);
            object.artisanStatus = 'approved';
            mergedUserData.province = object.province;
        } else if (isAdminRequest && finalRole !== 'artisan') {
            object.artisanStatus = 'none';
        }

        const slugFields = ['name', 'surname', 'company_name', 'email'];
        if (slugFields.some((field) => field in object) || finalRole !== existingUser.role) {
            const slugBase = buildUserSlugBase({ ...mergedUserData, role: finalRole });
            object.slug = await ensureUniqueSlug(User, slugify(slugBase), uid);
        }

        // Actualizamos (new: true devuelve el usuario ya actualizado)
        const updatedUser = await User.findByIdAndUpdate(uid, object, { new: true });

        if (isAdminRequest && object.active === false && existingUser.role === 'artisan') {
            await hideOwnedProducts(uid);
        }

        res.json({
            ok: true,
            msg: 'Usuario actualizado',
            user: updatedUser
        });

    } catch (error) {
        return res.status(500).json({
            ok: false,
            msg: 'Error actualizando usuario'
        });
    }
};


/*
deleteUser: Borrar un usuario (/:id)
---> Devuelve el usuario eliminado
*/
/*
Método de borrado no definitivo, los desactivaremos ya que los usuarios
tienen mucha relación con otros datos (registros de otras colecciones).
*/
const deleteUser = async(req, res = response) => {
    const uid = req.params.id;

    try {
        if (req.role !== 'admin') {
            return res.status(403).json({
                ok: false,
                msg: 'No autorizado para eliminar usuarios'
            });
        }

        const existingUser = await User.findById(uid);
        if (!existingUser) {
            return res.status(404).json({
                ok: false,
                msg: 'Usuario no encontrado'
            });
        }

        if (req.uid === uid) {
            return res.status(400).json({
                ok: false,
                msg: 'No puedes eliminar tu propia cuenta desde este panel'
            });
        }

        if (existingUser.role === 'admin') {
            return res.status(400).json({
                ok: false,
                msg: 'Los administradores no se pueden eliminar desde este panel'
            });
        }

        if (isUserActive(existingUser)) {
            return res.status(400).json({
                ok: false,
                msg: 'Solo se pueden eliminar usuarios desactivados'
            });
        }

        if (existingUser.role === 'artisan') {
            await deleteOwnedProducts(uid);
        }

        const result = await User.findByIdAndDelete(uid);
        res.json({
            ok: true,
            msg: 'Usuario eliminado',
            user: result
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            ok: false,
            msg: 'Error eliminando usuario'
        });
    }
};

/*
getFavorites: Obtener productos favoritos del usuario autenticado
---> Devuelve lista de productos favoritos (optimizado: solo campos necesarios)
*/
const getFavorites = async (req, res = response) => {
    const uid = req.uid;

    try {
        const user = await User.findById(uid)
            .populate('favorites', '_id name media title description')
            .exec();

        if (!user) {
            return res.status(404).json({
                ok: false,
                msg: 'Usuario no encontrado'
            });
        }

        return res.json({
            ok: true,
            favorites: user.favorites || []
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            ok: false,
            msg: 'Error obteniendo favoritos'
        });
    }
};

/*
addFavorite: Agregar un producto a favoritos
*/
const addFavorite = async (req, res = response) => {
    const uid = req.uid;
    const productId = req.params.productId;

    try {
        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({
                ok: false,
                msg: 'Producto no encontrado'
            });
        }

        const before = await User.findById(uid).select('favorites').lean();
        const alreadyFavorited = before?.favorites?.map(String).includes(String(productId));

        const updatedUser = await User.findByIdAndUpdate(
            uid,
            { $addToSet: { favorites: productId } },
            { new: true }
        ).populate('favorites', '_id name media title description');

        if (!updatedUser) {
            return res.status(404).json({
                ok: false,
                msg: 'Usuario no encontrado'
            });
        }

        if (!alreadyFavorited) {
            await Product.findByIdAndUpdate(productId, { $inc: { favoritesCount: 1 } });
        }

        return res.json({
            ok: true,
            msg: 'Producto añadido a favoritos',
            favorites: updatedUser.favorites || []
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            ok: false,
            msg: 'Error añadiendo favorito'
        });
    }
};

/*
removeFavorite: Eliminar un producto de favoritos
*/
const removeFavorite = async (req, res = response) => {
    const uid = req.uid;
    const productId = req.params.productId;

    try {
        const before = await User.findById(uid).select('favorites').lean();
        const wasFavorited = before?.favorites?.map(String).includes(String(productId));

        const updatedUser = await User.findByIdAndUpdate(
            uid,
            { $pull: { favorites: productId } },
            { new: true }
        ).populate('favorites', '_id name media title description');

        if (!updatedUser) {
            return res.status(404).json({
                ok: false,
                msg: 'Usuario no encontrado'
            });
        }

        if (wasFavorited) {
            await Product.findByIdAndUpdate(productId, { $inc: { favoritesCount: -1 } });
        }

        return res.json({
            ok: true,
            msg: 'Producto eliminado de favoritos',
            favorites: updatedUser.favorites || []
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            ok: false,
            msg: 'Error eliminando favorito'
        });
    }
};

/*
completeArtisan: Permite al usuario autenticado completar su perfil artisan
Requiere JWT. Si se envían los campos se actualiza role -> 'artisan' y artisanStatus -> 'pending'
*/
const completeArtisan = async(req, res = response) => {
    const uid = req.uid;
    const { company_name, description, address_text, contact, province } = req.body;

    try {
        const user = await User.findById(uid);
        if (!user) {
            return res.status(404).json({ ok: false, msg: 'Usuario no encontrado' });
        }

        // Actualizar campos artisan
        user.company_name = company_name;
        user.description = description;
        user.address_text = address_text;
        user.contact = contact;
        user.province = province;
        user.role = 'artisan';
        user.artisanStatus = 'pending';
        const slugBase = buildUserSlugBase(user);
        user.slug = await ensureUniqueSlug(User, slugify(slugBase), user._id);

        await user.save();

        // Generar nuevo token con rol actualizado
        const token = await generateJWT(user._id, user.role);

        return res.json({
            ok: true,
            msg: 'Perfil artisan actualizado y pendiente de revisión',
            user,
            token
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, msg: 'Error actualizando perfil artisan' });
    }
}

// Añadir export
module.exports = {
    getUsers,
    createUser,
    updateUser,
    deleteUser,
    getFavorites,
    addFavorite,
    removeFavorite,
    completeArtisan,
    getPublicArtisanById,
    getPublicArtisanBySlug
};
