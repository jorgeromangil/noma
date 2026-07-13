const Stats = require('../models/stats');
const jwt = require('jsonwebtoken');

const MAX_PRODUCTS_PER_ARTISAN = 20;
// Registrar una consulta de producto
// const registrarConsultaProducto = async (productoId, ciudad, usuarioId) => {
//     await Stats.create({
//         tipo: 'consulta',
//         producto: productoId,
//         ciudad,
//         usuario: usuarioId || null
//     });
// };

// Registrar una descarga de datos abiertos
const registrarDescarga = async (ciudad, usuarioId) => {
    await Stats.create({
        tipo: 'descarga',
        ciudad,
        usuario: usuarioId || null
    });
};

// Endpoint para consultar estadísticas agregadas
const getEstadisticasUso = async (req, res = response) => {
    try {
        // Agrupar por fecha y ciudad, contar descargas y consultas, y producto más consultado
        const stats = await Stats.aggregate([
            {
                $group: {
                    _id: {
                        fecha: { $dateToString: { format: '%Y-%m-%d', date: '$fecha' } },
                        ciudad: '$ciudad'
                    },
                    descargas: {
                        $sum: { $cond: [{ $eq: ['$tipo', 'descarga'] }, 1, 0] }
                    },
                    consultas: {
                        $sum: { $cond: [{ $eq: ['$tipo', 'consulta'] }, 1, 0] }
                    },
                    productos: { $push: '$producto' }
                }
            },
            {
                $lookup: {
                    from: 'products',
                    localField: 'productos',
                    foreignField: '_id',
                    as: 'productosInfo'
                }
            },
            {
                $addFields: {
                    productoMasConsultado: {
                        $arrayElemAt: [
                            {
                                $map: {
                                    input: {
                                        $slice: [
                                            {
                                                $sortArray: {
                                                    input: '$productosInfo',
                                                    sortBy: { consultas: -1 }
                                                }
                                            }, 1
                                        ]
                                    },
                                    as: 'prod',
                                    in: '$$prod.name'
                                }
                            }, 0
                        ]
                    }
                }
            },
            {
                $project: {
                    fecha: '$_id.fecha',
                    ciudad: '$_id.ciudad',
                    descargas: 1,
                    consultas: 1,
                    productoMasConsultado: 1,
                    _id: 0
                }
            },
            { $sort: { fecha: -1 } }
        ]);
        res.json({ ok: true, stats });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, msg: 'Error obteniendo estadísticas' });
    }
};
const Product = require('../models/products');
const User = require('../models/users');
const { response } = require('express');
const { slugify, ensureUniqueSlug } = require('../helpers/slug');
const { geocodeAddress, parseAddressText } = require('../helpers/geocode');
const { getAutonomousCommunity, isProvinceValid, getCanonicalProvinceName } = require('../helpers/provincias');
const { deleteModelFile } = require('../helpers/model3d-storage');

// Normaliza los datos del producto para el dataset abierto (evita el toJSON que oculta _id)
const mapProductToOpenData = (product) => {
    const coords = Array.isArray(product && product.location && product.location.coordinates) ?
        product.location.coordinates : [];
    return {
        _id: (product && product._id && product._id.toString()) || '',
        name: (product && product.name) || '',
        description: (product && product.description) || '',
        historia_origen: (product && product.historia_origen) || '',
        importancia_cultural: (product && product.importancia_cultural) || '',
        proceso_elaboracion: (product && product.proceso_elaboracion) || '',
        materias_primas: (product && product.materias_primas) || '',
        tiempo_elaboracion: (product && product.tiempo_elaboracion) || '',
        certificaciones_protecciones: (product && product.certificaciones_protecciones) || '',
        province: (product && product.province) || '',
        autonomous_community: (product && product.autonomous_community) || '',
        address_text: (product && product.address_text) || '',
        coordinates: coords.length ? coords : [],
        longitude: coords.length ? coords[0] : '',
        latitude: coords.length ? coords[1] : ''
    };
};

const escapeCsvValue = (value) => {
    const stringValue = value === null || value === undefined ? '' : String(value);
    const escaped = stringValue.replace(/"/g, '""');
    return `"${escaped}"`;
};

const CSV_DELIMITER = ';';

const PUBLIC_PRODUCTS_FILTER = {
    $or: [{ active: true }, { active: { $exists: false } }]
};
const PRODUCT_BATCH_DETAILS_LIMIT = 20;
const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 100;
const ACTIVE_ARTISAN_FILTER = {
    role: 'artisan',
    $or: [{ active: true }, { active: { $exists: false } }]
};

const MAP_PRODUCTS_FILTER = {
    ...PUBLIC_PRODUCTS_FILTER,
    'location.coordinates.0': { $exists: true },
    'location.coordinates.1': { $exists: true }
};

const mapProductToMapLite = (product) => {
    const coordinates = Array.isArray(product?.location?.coordinates)
        ? product.location.coordinates
        : [];
    const thumbnail = Array.isArray(product?.media) && product.media.length > 0
        ? product.media[0]
        : (product?.image || null);
    const has3D = Boolean(product?.model3d?.url || product?.model3d?.filename);

    return {
        id: String(product?._id || ''),
        name: product?.name || '',
        lat: Number(coordinates[1]),
        lng: Number(coordinates[0]),
        city: product?.city || undefined,
        province: product?.province || undefined,
        autonomous_community: product?.autonomous_community || undefined,
        category: product?.category || undefined,
        certificaciones_protecciones: product?.certificaciones_protecciones || undefined,
        thumbnail: thumbnail || undefined,
        has3D
    };
};

const isAdminFromRequestToken = (req) => {
    try {
        const authHeader = req.header('authorization') || req.header('Authorization') || '';
        const bearerToken = authHeader.startsWith('Bearer ')
            ? authHeader.slice(7).trim()
            : null;
        const legacyToken = req.header('x-token');
        const token = bearerToken || legacyToken;

        if (!token) return false;

        const payload = jwt.verify(token, process.env.JWT_SECRET);
        return payload?.role === 'admin';
    } catch (error) {
        return false;
    }
};

/*
getProductsCacheMetadata: devuelve una firma ligera del dataset público de productos
para validar la caché del mapa en frontend sin descargar todos los registros.
*/
const getProductsCacheMetadata = async(req, res = response) => {
    try {
        const [total, latestProduct] = await Promise.all([
            Product.countDocuments(PUBLIC_PRODUCTS_FILTER),
            Product.findOne(PUBLIC_PRODUCTS_FILTER)
                .sort({ updatedAt: -1, _id: -1 })
                .select('updatedAt')
                .lean()
        ]);

        const lastUpdated = latestProduct?.updatedAt
            ? new Date(latestProduct.updatedAt).toISOString()
            : null;

        res.json({
            ok: true,
            meta: {
                total,
                lastUpdated,
                signature: `${total}:${lastUpdated ?? 'null'}`
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error obteniendo metadatos de caché de productos'
        });
    }
};

const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getPaginationParams = (query = {}, defaultPageSize = DEFAULT_PAGE_SIZE) => {
    const hasPagination = typeof query.from !== 'undefined' ||
        typeof query.recordsPerPage !== 'undefined' ||
        typeof query.page !== 'undefined' ||
        typeof query.pageSize !== 'undefined';

    if (!hasPagination) {
        return {
            enabled: false,
            from: 0,
            recordsPerPage: null
        };
    }

    const rawPage = Math.max(parseInt(query.page, 10) || 1, 1);
    const rawFrom = typeof query.from !== 'undefined'
        ? parseInt(query.from, 10)
        : (rawPage - 1) * (parseInt(query.pageSize || query.recordsPerPage, 10) || defaultPageSize);
    const rawRecords = parseInt(query.recordsPerPage || query.pageSize, 10) || defaultPageSize;

    return {
        enabled: true,
        from: Math.max(rawFrom || 0, 0),
        recordsPerPage: Math.min(Math.max(rawRecords, 1), MAX_PAGE_SIZE)
    };
};

const buildPaginationPayload = (pagination, total) => ({
    from: pagination.from,
    recordsPerPage: pagination.recordsPerPage,
    total,
    page: Math.floor(pagination.from / pagination.recordsPerPage) + 1,
    totalPages: Math.max(Math.ceil(total / pagination.recordsPerPage), 1)
});

const resolveOwnerForCreate = async(req) => {
    if (req.role === 'artisan') {
        return { ownerId: req.uid };
    }

    if (req.role !== 'admin') {
        return { error: { status: 403, msg: 'No autorizado' } };
    }

    const ownerId = String(req.body?.owner || '').trim();
    if (!ownerId) {
        return { error: { status: 400, msg: 'Debes seleccionar un artesano para crear el producto' } };
    }

    const owner = await User.findOne({ _id: ownerId, ...ACTIVE_ARTISAN_FILTER })
        .select('_id role active')
        .lean();

    if (!owner) {
        return { error: { status: 400, msg: 'El artesano seleccionado no es válido o está inactivo' } };
    }

    return { ownerId };
};

const enforceOwnerProductLimit = async(ownerId, isAdminRequest = false) => {
    const productCount = await Product.countDocuments({ owner: ownerId });
    if (productCount >= MAX_PRODUCTS_PER_ARTISAN) {
        return {
            status: 403,
            msg: isAdminRequest
                ? `El artesano seleccionado ya ha alcanzado el límite de ${MAX_PRODUCTS_PER_ARTISAN} productos`
                : `Has alcanzado el límite de ${MAX_PRODUCTS_PER_ARTISAN} productos por artesano`
        };
    }

    return null;
};

const getMapLiteProducts = async(req, res = response) => {
    try {
        const products = await Product.find(MAP_PRODUCTS_FILTER)
            .select('_id name city province autonomous_community category certificaciones_protecciones media image model3d location')
            .lean();

        const mapLiteProducts = products
            .map(mapProductToMapLite)
            .filter((product) => (
                product.id &&
                Number.isFinite(product.lat) &&
                Number.isFinite(product.lng)
            ));

        res.json({
            ok: true,
            msg: 'Lista de productos ligera para mapa',
            products: mapLiteProducts,
            total: mapLiteProducts.length
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error obteniendo productos ligeros para mapa'
        });
    }
};

const getBatchProductDetails = async(req, res = response) => {
    try {
        const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id) => String(id)) : [];

        const products = await Product.find({
            _id: { $in: ids },
            ...PUBLIC_PRODUCTS_FILTER
        })
            .populate('owner', 'name surname email contact company_name slug image')
            .lean();

        const productOrder = new Map(ids.map((id, index) => [id, index]));
        const orderedProducts = products.sort((left, right) => {
            const leftOrder = productOrder.get(String(left?._id)) ?? Number.MAX_SAFE_INTEGER;
            const rightOrder = productOrder.get(String(right?._id)) ?? Number.MAX_SAFE_INTEGER;
            return leftOrder - rightOrder;
        });

        res.json({
            ok: true,
            products: orderedProducts,
            total: orderedProducts.length,
            limit: PRODUCT_BATCH_DETAILS_LIMIT
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error obteniendo detalles completos de productos'
        });
    }
};

/*
getProducts: Obtener todos los productos (paginado)
<--- from?, recordsPerPage?
---> Devuelve una lista con todos los productos
*/
const getProducts = async(req, res = response) => {
    try {
        // Permitir filtrar por owner (artesano)
        const filter = { ...PUBLIC_PRODUCTS_FILTER };
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;
        const sortByFavorites = req.query.sort === 'favorites';
        const pagination = getPaginationParams(req.query);
        if (req.query.owner) {
            filter["owner"] = req.query.owner;
        }
        if (req.query.category) {
            filter["category"] = req.query.category;
        }
        if (req.query.q) {
            const rx = new RegExp(escapeRegExp(String(req.query.q).trim()), 'i');
            filter.$and = [
                ...(Array.isArray(filter.$and) ? filter.$and : []),
                {
                    $or: [
                        { name: rx },
                        { description: rx },
                        { resumen: rx }
                    ]
                }
            ];
        }
        let query = Product.find(filter)
            .populate('owner', 'name surname email contact company_name slug image');
        if (!sortByFavorites && pagination.enabled) {
            query = query.skip(pagination.from).limit(pagination.recordsPerPage);
        } else if (!sortByFavorites && limit) {
            query = query.limit(limit);
        }
        const total = await Product.countDocuments(filter);
        let products = await query;

        if (sortByFavorites && products.length > 0) {
            const productIdStrings = products.map((product) => String(product._id));
            const favoritesAgg = await User.aggregate([
                { $match: { favorites: { $exists: true, $ne: [] } } },
                { $unwind: '$favorites' },
                { $addFields: { favoritesString: { $toString: '$favorites' } } },
                { $match: { favoritesString: { $in: productIdStrings } } },
                { $group: { _id: '$favoritesString', total: { $sum: 1 } } }
            ]);

            const countsById = new Map(
                favoritesAgg.map((item) => [String(item._id), Number(item.total || 0)])
            );

            products = products.sort((a, b) => {
                const favoritesA = countsById.get(String(a._id)) || 0;
                const favoritesB = countsById.get(String(b._id)) || 0;
                if (favoritesA !== favoritesB) {
                    return favoritesB - favoritesA;
                }
                return String(a.name || '').localeCompare(String(b.name || ''), 'es', {
                    sensitivity: 'base'
                });
            });

            if (limit) {
                products = products.slice(0, limit);
            }
            if (pagination.enabled) {
                products = products.slice(pagination.from, pagination.from + pagination.recordsPerPage);
            }
        }

        res.json({
            ok: true,
            msg: 'Lista de productos',
            products,
            total,
            ...(pagination.enabled ? { page: buildPaginationPayload(pagination, total) } : {})
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error obteniendo productos'
        });
    }
};

/*
getOpenDataDataset: Exporta el dataset de productos en JSON (por defecto) o CSV.
 Campos: _id, name, description, historia_origen, importancia_cultural, proceso_elaboracion, materias_primas, tiempo_elaboracion, certificaciones_protecciones, province, autonomous_community, address_text, coordinates, longitude, latitude
*/
const getOpenDataDataset = async (req, res = response) => {
    try {
        const rawFormat = req.query.format;
        const format = String(rawFormat || 'json').toLowerCase();
        const allowedFormats = ['json', 'csv'];
        const chosenFormat = allowedFormats.includes(format) ? format : 'json';

        // Obtener productos activos excluyendo campos internos de moderación/reportes
        const products = await Product.find({
            $or: [{ active: true }, { active: { $exists: false } }]
        })
            .select('-reports -report_count -last_reported_at -report_status -model3d -media -slug -active -favoritesCount -createdAt -updatedAt -model3dUpdatedAt')
            .populate('owner', 'company_name name surname slug image')
            .lean();
        // Mapear los productos para que el campo owner sea solo el nombre de la compañía/taller o nombre completo
        const records = products.map(prod => {
            let ownerName = '';
            if (prod.owner && typeof prod.owner === 'object') {
                ownerName = prod.owner.company_name || prod.owner.name || prod.owner.surname || '';
                // Si tiene nombre y apellido, los unimos
                if (!prod.owner.company_name && prod.owner.name && prod.owner.surname) {
                    ownerName = prod.owner.name + ' ' + prod.owner.surname;
                }
            } else if (prod.owner) {
                ownerName = prod.owner;
            }
            const {
                reports,
                report_count,
                last_reported_at,
                report_status,
                model3d,
                media,
                __v,
                slug,
                active,
                favoritesCount,
                fvoritescount,
                createdAt,
                updatedAt,
                updateAt,
                model3dUpdatedAt,
                ...safeProduct
            } = prod;

            return { ...safeProduct, owner: ownerName };
        });

        const datasetMetadata = {
            name: 'Productos artesanos Syncro - Datos abiertos',
            description: 'Listado abierto de productos con identificador, descripción, procedencia y coordenadas geográficas.',
            publisher: 'Grupo Syncro ABP 2025/26',
            license: 'CC BY 4.0',
            formats: allowedFormats,
            languages: ['es'],
            notes: 'Las coordenadas se sirven en orden longitud, latitud. Solo se incluyen campos no sensibles.'
        };

        if (chosenFormat === 'csv') {
            // Obtener todos los campos únicos de todos los productos
            const allKeys = Array.from(new Set(records.flatMap((prod) => Object.keys(prod))));
            const csvRows = [
                `sep=${CSV_DELIMITER}`,
                allKeys.map((key) => escapeCsvValue(key)).join(CSV_DELIMITER),
                ...records.map((record) => allKeys.map((key) => {
                    const value = record[key];
                    if (typeof value === 'object') return escapeCsvValue(JSON.stringify(value));
                    return escapeCsvValue(value);
                }).join(CSV_DELIMITER))
            ];

            const csvContent = `\uFEFF${csvRows.join('\r\n')}`;
            return res
                .set('Content-Type', 'text/csv; charset=utf-8')
                .set('Content-Disposition', 'attachment; filename="productos-open-data.csv"')
                .send(csvContent);
        }

        res.json({
            ok: true,
            dataset: datasetMetadata,
            records
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error generando dataset abierto'
        });
    }
};

/*
createProduct: Crear un nuevo producto
<--- name, description, historia_origen, importancia_cultural, proceso_elaboracion, materias_primas, tiempo_elaboracion, certificaciones_protecciones?, media (array), province, autonomous_community, address_text
---> Devuelve el producto creado
*/
const createProduct = async(req, res = response) => {
    const { media } = req.body;
    let province = req.body.province;

    try {
        if (!media || !Array.isArray(media) || media.length === 0) {
            return res.status(400).json({
                ok: false,
                msg: 'Se requiere al menos un elemento en media'
            });
        }

        const ownerResolution = await resolveOwnerForCreate(req);
        if (ownerResolution.error) {
            return res.status(ownerResolution.error.status).json({
                ok: false,
                msg: ownerResolution.error.msg
            });
        }

        const ownerId = ownerResolution.ownerId;
        const ownerLimitError = await enforceOwnerProductLimit(ownerId, req.role === 'admin');
        if (ownerLimitError) {
            return res.status(ownerLimitError.status).json({
                ok: false,
                msg: ownerLimitError.msg
            });
        }

        // Validar y normalizar el nombre
        const name = req.body.name && String(req.body.name).trim();
        if (!name) return res.status(400).json({ ok: false, msg: 'El nombre es obligatorio' });

        // Validar provincia
        if (!province || !isProvinceValid(province)) {
            return res.status(400).json({ ok: false, msg: 'La provincia proporcionada no es válida' });
        }

        // Normalizar provincia a nombre canónico
        const canonicalProvince = getCanonicalProvinceName(province);
        if (canonicalProvince) {
            province = canonicalProvince;
        }

        // Auto-completar comunidad autónoma a partir de la provincia
        let autonomousCommunity = req.body.autonomous_community;
        const autodetectedCommunity = getAutonomousCommunity(province);
        
        if (!autodetectedCommunity) {
            return res.status(400).json({ ok: false, msg: 'No se pudo determinar la comunidad autónoma para la provincia indicada' });
        }

        // Si el usuario no proporciona comunidad autónoma, usar la detectada
        // Si la proporciona, usarla para respetar su intención (pero se valida contra la provincia)
        if (!autonomousCommunity) {
            autonomousCommunity = autodetectedCommunity;
        }


        // Si hay direccion_forzada, usarla directamente para location
        let location;
        if (req.body.direccion_forzada && typeof req.body.direccion_forzada === 'object' && req.body.direccion_forzada.lat && req.body.direccion_forzada.lon) {
            location = { type: 'Point', coordinates: [req.body.direccion_forzada.lon, req.body.direccion_forzada.lat] };
        } else if (req.body.address_text) {
            // Parse address_text to extract street, city, and postal code
            const parsed = parseAddressText(req.body.address_text);
            if (!parsed.street) {
                return res.status(400).json({
                    ok: false,
                    msg: 'La dirección debe incluir calle/lugar. Ejemplos: "Calle Mayor 23, Valencia" o "Plaza Central, 28001"'
                });
            }

            // Usar geocodeAddress (ahora devuelve array de coincidencias)
            const opciones = await geocodeAddress(
                parsed.street,
                parsed.city,
                province,
                'Spain',
                parsed.postalcode
            );
            if (opciones.length === 1) {
                location = { type: 'Point', coordinates: [opciones[0].lon, opciones[0].lat] };
            } else if (opciones.length > 1) {
                // Hay varias coincidencias, devolver opciones al frontend
                return res.status(200).json({
                    ok: false,
                    multiple: true,
                    options: opciones.map(o => ({
                        display: o.display,
                        lat: o.lat,
                        lon: o.lon,
                        city: o.raw?.address?.city || o.raw?.address?.town || o.raw?.address?.village || '',
                        state: o.raw?.address?.state || '',
                        postcode: o.raw?.address?.postcode || ''
                    }))
                });
            } else {
                // No se obtienen coordenadas válidas
                return res.status(422).json({
                    ok: false,
                    msg: `La dirección "${req.body.address_text}" no se ha encontrado en la provincia de ${province}. Comprueba que la calle existe y está bien escrita.`
                });
            }
        }

        const rawSlug = slugify(name);
        const slug = await ensureUniqueSlug(Product, rawSlug);


        // Permitir el campo resumen si viene en el body
        const resumen = req.body.resumen;

        const productBody = { ...req.body };
        delete productBody.owner;

        const product = new Product({
            ...productBody,
            name,
            slug,
            province,
            autonomous_community: autonomousCommunity,
            owner: ownerId,
            ...(location ? { location } : {}),
            ...(resumen ? { resumen } : {})
        });
        await product.save();

        res.status(201).json({ ok: true, msg: 'Producto creado', product });

    } catch (error) {
        console.error(error);
        // Manejo de error de clave duplicada (por índice único)
        if (error && (error.code === 11000 || error.codeName === 'DuplicateKey')) {
            return res.status(400).json({ ok: false, msg: 'Nombre de producto duplicado' });
        }

        res.status(500).json({
            ok: false,
            msg: 'Error creando producto',
            detail: error && (error.message || error.toString())
        });
    }
};

/*
updateProduct: Actualizar un producto (/:id)
<--- name?, description?, historia_origen?, importancia_cultural?, proceso_elaboracion?, materias_primas?, tiempo_elaboracion?, certificaciones_protecciones?, media?, province?, autonomous_community?, address_text?
---> Devuelve el producto actualizado
*/
const updateProduct = async(req, res = response) => {
    const uid = req.params.id;
    const object = {...req.body };
    const ownerProvided = Object.prototype.hasOwnProperty.call(object, 'owner');
    const requestedOwnerId = ownerProvided ? String(object.owner || '').trim() : '';
    delete object.owner;

    try {
        const product = await Product.findById(uid);
        if (!product) return res.status(404).json({ ok: false, msg: 'Producto no encontrado' });

        // Autorización: solo el propietario o admin pueden actualizar
        const productOwnerId = product.owner.toString();
        if (req.role !== 'admin' && productOwnerId !== req.uid) {
            return res.status(403).json({ ok: false, msg: 'No autorizado' });
        }

        let nextOwnerId = null;
        if (ownerProvided && req.role === 'admin') {
            if (!requestedOwnerId) {
                return res.status(400).json({
                    ok: false,
                    msg: 'Debes seleccionar un artesano para asignar el producto'
                });
            }

            if (requestedOwnerId !== productOwnerId) {
                const newOwner = await User.findOne({ _id: requestedOwnerId, ...ACTIVE_ARTISAN_FILTER })
                    .select('_id role active')
                    .lean();

                if (!newOwner) {
                    return res.status(400).json({
                        ok: false,
                        msg: 'El artesano seleccionado no es válido o está inactivo'
                    });
                }

                const ownerLimitError = await enforceOwnerProductLimit(requestedOwnerId, true);
                if (ownerLimitError) {
                    return res.status(ownerLimitError.status).json({
                        ok: false,
                        msg: ownerLimitError.msg
                    });
                }

                nextOwnerId = requestedOwnerId;
            }
        }

        const requestedFields = Object.keys(object);
        const isActiveOnlyUpdate = requestedFields.length === 1 && requestedFields.includes('active');
        const hasOnlySimpleAdminFields = requestedFields.every((field) => field === 'active');

        // Para ocultar/mostrar productos o reasignar propietario no necesitamos
        // revalidar toda la ficha. Esto evita errores con productos legacy
        // incompletos pero cuyo cambio operativo sí debe seguir funcionando.
        if ((isActiveOnlyUpdate || (ownerProvided && hasOnlySimpleAdminFields)) && (requestedFields.length > 0 || ownerProvided)) {
            const updateSet = {};
            if (requestedFields.includes('active')) {
                updateSet.active = object.active === false || object.active === 'false'
                    ? false
                    : Boolean(object.active);
            }
            if (nextOwnerId) {
                updateSet.owner = nextOwnerId;
            }

            const updatedProduct = Object.keys(updateSet).length > 0
                ? await Product.findByIdAndUpdate(
                    uid,
                    { $set: updateSet },
                    { new: true }
                ).populate('owner', 'name surname email contact company_name slug image active role')
                : await Product.findById(uid)
                    .populate('owner', 'name surname email contact company_name slug image active role');

            return res.json({
                ok: true,
                msg: 'Producto actualizado',
                product: updatedProduct
            });
        }

        // Si se cambia el nombre, asegurar que sea único
        if (object.name) {
            const desiredName = String(object.name).trim();
            object.name = desiredName;
            const rawSlug = slugify(desiredName);
            product.slug = await ensureUniqueSlug(Product, rawSlug, uid);
        }

        // Aplicar lista blanca de campos editables para evitar actualizaciones accidentales
        const allowed = ['name', 'description', 'category', 'historia_origen', 'importancia_cultural', 'proceso_elaboracion', 'materias_primas', 'tiempo_elaboracion', 'certificaciones_protecciones', 'media', 'province', 'autonomous_community', 'address_text', 'active', 'resumen'];
        allowed.forEach(k => { if (k in object) product[k] = object[k]; });
        if (nextOwnerId) {
            product.owner = nextOwnerId;
        }

        // Si se actualiza la provincia, validar y auto-completar comunidad autónoma si es necesario
        if ('province' in object) {
            const newProvince = object.province;
            if (!isProvinceValid(newProvince)) {
                return res.status(400).json({ ok: false, msg: 'La provincia proporcionada no es válida' });
            }

            const canonicalProvince = getCanonicalProvinceName(newProvince);
            const provinceToUse = canonicalProvince || newProvince;
            if (canonicalProvince) {
                object.province = canonicalProvince;
                product.province = canonicalProvince;
            }
            
            const autodetectedCommunity = getAutonomousCommunity(provinceToUse);
            if (!autodetectedCommunity) {
                return res.status(400).json({ ok: false, msg: 'No se pudo determinar la comunidad autónoma para la provincia indicada' });
            }
            
            // Si no se actualiza la comunidad autónoma explícitamente, auto-completar
            if (!('autonomous_community' in object)) {
                product.autonomous_community = autodetectedCommunity;
            }
        }

        // Si se actualiza dirección o provincia, re-geocodificar y actualizar `location`, salvo que venga direccion_forzada
        if ('direccion_forzada' in object && object.direccion_forzada && typeof object.direccion_forzada === 'object' && object.direccion_forzada.lat && object.direccion_forzada.lon) {
            product.location = { type: 'Point', coordinates: [object.direccion_forzada.lon, object.direccion_forzada.lat] };
        } else if ('address_text' in object || 'province' in object) {
            const addressText = 'address_text' in object ? object.address_text : product.address_text;
            const provinceValue = 'province' in object ? object.province : product.province;
            // Parse address_text to extract street, city, and postal code
            const parsed = parseAddressText(addressText);
            if (!parsed.street) {
                return res.status(400).json({
                    ok: false,
                    msg: 'La dirección debe incluir calle/lugar. Ejemplos: "Calle Mayor 23, Valencia" o "Plaza Central, 28001"'
                });
            }

            // Usar geocodeAddress (ahora devuelve array de coincidencias)
            const opciones = await geocodeAddress(
                parsed.street,
                parsed.city,
                provinceValue,
                'Spain',
                parsed.postalcode
            );
            if (opciones.length === 1) {
                product.location = { type: 'Point', coordinates: [opciones[0].lon, opciones[0].lat] };
            } else if (opciones.length > 1) {
                // Hay varias coincidencias, devolver opciones al frontend
                return res.status(200).json({
                    ok: false,
                    multiple: true,
                    options: opciones.map(o => ({
                        display: o.display,
                        lat: o.lat,
                        lon: o.lon,
                        city: o.raw?.address?.city || o.raw?.address?.town || o.raw?.address?.village || '',
                        state: o.raw?.address?.state || '',
                        postcode: o.raw?.address?.postcode || ''
                    }))
                });
            } else {
                // No se obtienen coordenadas válidas
                return res.status(422).json({
                    ok: false,
                    msg: `La dirección "${addressText}" no se ha encontrado en la provincia de ${provinceValue}. Comprueba que la calle existe y está bien escrita.`
                });
            }
        }

        const savedProduct = await product.save();
        if (!savedProduct) {
            return res.status(404).json({
                ok: false,
                msg: 'Producto no encontrado'
            });
        }

        const updatedProduct = await Product.findById(uid)
            .populate('owner', 'name surname email contact company_name slug image active role');

        res.json({
            ok: true,
            msg: 'Producto actualizado',
            product: updatedProduct
        });

    } catch (error) {
        console.error(error);
        if (error && (error.code === 11000 || error.codeName === 'DuplicateKey')) {
            return res.status(400).json({ ok: false, msg: 'Nombre de producto duplicado' });
        }
        res.status(500).json({ ok: false, msg: 'Error actualizando producto' });
    }
};

/*
deleteProduct: Eliminar producto
(Físico mediante findByIdAndDelete o lógico si prefieres active = false)
*/
const deleteProduct = async(req, res = response) => {
    const uid = req.params.id;

    try {
        const product = await Product.findById(uid);

        if (!product) {
            return res.status(404).json({
                ok: false,
                msg: 'Producto no encontrado'
            });
        }

        // Autorización: solo el propietario o un administrador pueden eliminar
        const productOwnerId = product.owner.toString();
        if (req.role !== 'admin' && productOwnerId !== req.uid) {
            return res.status(403).json({
                ok: false,
                msg: 'No tiene privilegios para eliminar este producto'
            });
        }

        // Si el producto tiene modelo 3D, eliminar archivo asociado (Drive o almacenamiento local legacy)
        if (product.model3d && (product.model3d.driveFileId || product.model3d.filename)) {
            await deleteModelFile(uid, product.model3d.filename, product.model3d.driveFileId);
        }

        // Eliminación física de la base de datos
        await Product.findByIdAndDelete(uid);

        res.json({
            ok: true,
            msg: 'Producto eliminado correctamente'
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            msg: 'Error eliminando producto'
        });
    }
};

/*
reportProduct: Reportar un producto por contenido inapropiado
<--- reason, details?
---> Guarda reporte asociado al usuario autenticado
*/
const reportProduct = async(req, res = response) => {
    const productId = req.params.id;
    const reporterId = req.uid;
    const reason = String(req.body.reason || '').trim();
    const details = String(req.body.details || '').trim();

    try {
        const product = await Product.findById(productId);
        if (!product || product.active === false) {
            return res.status(404).json({ ok: false, msg: 'Producto no encontrado' });
        }

        const productOwnerId = product.owner ? product.owner.toString() : '';
        if (productOwnerId === reporterId) {
            return res.status(400).json({ ok: false, msg: 'No puedes reportar tu propio producto' });
        }

        const canReReportAfterDismissal = product.report_status === 'dismissed';
        const alreadyReported = Array.isArray(product.reports) &&
            product.reports.some((report) => {
                if (!report.reporter || report.reporter.toString() !== reporterId) {
                    return false;
                }

                return !canReReportAfterDismissal;
            });

        if (alreadyReported) {
            return res.status(409).json({ ok: false, msg: 'Ya has reportado este producto' });
        }

        const now = new Date();

        if (canReReportAfterDismissal) {
            if (!Array.isArray(product.reports)) {
                product.reports = [];
            }

            product.reports.push({
                reason,
                details,
                reporter: reporterId,
                createdAt: now
            });
            product.report_count = (product.report_count || 0) + 1;
            product.last_reported_at = now;
            product.report_status = 'pending';

            await product.save();
        } else {
            const updateResult = await Product.updateOne(
                {
                    _id: productId,
                    'reports.reporter': { $ne: reporterId }
                },
                {
                    $push: {
                        reports: {
                            reason,
                            details,
                            reporter: reporterId,
                            createdAt: now
                        }
                    },
                    $inc: { report_count: 1 },
                    $set: {
                        last_reported_at: now,
                        report_status: 'pending'
                    }
                }
            );

            if (!updateResult || updateResult.modifiedCount === 0) {
                return res.status(409).json({ ok: false, msg: 'Ya has reportado este producto' });
            }
        }

        res.status(201).json({
            ok: true,
            msg: 'Reporte enviado correctamente'
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, msg: 'Error enviando reporte' });
    }
};

/*
getMyProducts: Obtener productos del usuario autenticado
---> Devuelve la lista de productos del usuario
*/
const getMyProducts = async(req, res = response) => {
    const productId = req.params.id;
    const ownerId = req.uid;

    try {
        if (req.role !== 'artisan' && req.role !== 'admin') {
            return res.status(403).json({ ok: false, msg: 'No autorizado' });
        }

        let query = { owner: ownerId };

        // Si hay un ID de producto, lo añadimos a la query
        if (productId) {
            query._id = productId;
        }

        const products = await Product.find(query)
            .populate('owner', 'name surname email contact company_name slug image');

        if (productId && products.length === 0) {
            return res.status(404).json({
                ok: false,
                msg: 'Producto no encontrado o no pertenece al usuario autenticado'
            });
        }

        res.json({
            ok: true,
            msg: productId ? 'Producto propio encontrado' : 'Lista de productos propios',
            products
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, msg: 'Error obteniendo productos' });
    }
};

const getAdminProducts = async(req, res = response) => {
    try {
        if (req.role !== 'admin') {
            return res.status(403).json({ ok: false, msg: 'No autorizado' });
        }

        const owner = String(req.query.owner || '').trim();
        const q = String(req.query.q || '').trim();
        const category = String(req.query.category || '').trim();
        const province = String(req.query.province || '').trim();
        const status = String(req.query.status || 'all').trim() || 'all';
        const pagination = getPaginationParams(req.query, 12);
        const clauses = [];

        if (owner) {
            clauses.push({ owner });
        }

        if (category) {
            clauses.push({ category });
        }

        if (province) {
            clauses.push({ province });
        }

        if (status === 'visible') {
            clauses.push({ $or: [{ active: true }, { active: { $exists: false } }] });
        } else if (status === 'hidden') {
            clauses.push({ active: false });
        }

        if (q) {
            const rx = new RegExp(escapeRegExp(q), 'i');
            const matchingOwners = await User.find({
                role: 'artisan',
                $or: [
                    { name: rx },
                    { surname: rx },
                    { company_name: rx }
                ]
            }).select('_id').lean();

            const matchingOwnerIds = matchingOwners.map((user) => user._id);
            clauses.push({
                $or: [
                    { name: rx },
                    { category: rx },
                    { province: rx },
                    { owner: { $in: matchingOwnerIds } }
                ]
            });
        }

        const query = clauses.length === 0
            ? {}
            : clauses.length === 1
                ? clauses[0]
                : { $and: clauses };

        const products = await Product.find(query)
            .populate('owner', 'name surname email contact company_name slug image active role')
            .sort({ updatedAt: -1, _id: -1 })
            .skip(pagination.enabled ? pagination.from : 0)
            .limit(pagination.enabled ? pagination.recordsPerPage : 0);

        const [total, categories, provinces] = await Promise.all([
            Product.countDocuments(query),
            Product.distinct('category', {}),
            Product.distinct('province', {})
        ]);

        return res.json({
            ok: true,
            msg: 'Lista de productos para administración',
            products,
            total,
            facets: {
                categories: categories.filter(Boolean),
                provinces: provinces.filter(Boolean)
            },
            ...(pagination.enabled ? { page: buildPaginationPayload(pagination, total) } : {})
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            ok: false,
            msg: 'Error obteniendo productos para administración'
        });
    }
};

/*
getProductBySlug: Obtener un producto por su slug
*/
const getProductBySlug = async(req, res = response) => {
    const slug = req.params.slug;
    try {
        const product = await Product.findOne({ slug }).populate('owner', 'name surname email contact company_name slug image');

        if (!product) {
            return res.status(404).json({ ok: false, msg: 'Producto no encontrado' });
        }

        if (product.active === false && !isAdminFromRequestToken(req)) {
            return res.status(404).json({ ok: false, msg: 'Producto no encontrado' });
        }

        const ciudad = req.query.ciudad || '';
        const usuarioId = req.uid || null;
        // Eliminado: no registrar evento 'consulta' automáticamente

        res.json({
            ok: true,
            msg: 'Producto encontrado',
            product
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, msg: 'Error obteniendo producto' });
    }
};

/*
getProductById: Obtener un producto por su id
*/
const getProductById = async(req, res = response) => {
    const id = req.params.id;
    try {
        const product = await Product.findById(id).populate('owner', 'name surname email contact company_name slug image');

        if (!product) {
            return res.status(404).json({ ok: false, msg: 'Producto no encontrado' });
        }

        if (product.active === false && !isAdminFromRequestToken(req)) {
            return res.status(404).json({ ok: false, msg: 'Producto no encontrado' });
        }
        // Registrar consulta de producto
        const ciudad = req.query.ciudad || '';
        const usuarioId = req.uid || null;
        // Eliminado: no registrar evento 'consulta' automáticamente
        res.json({
            ok: true,
            msg: 'Producto encontrado',
            product
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, msg: 'Error obteniendo producto' });
    }
};

/*
getReportedProducts: Obtener todos los productos que han sido reportados (solo para admin)
*/
const getReportedProducts = async(req, res = response) => {
    try {
        if (req.role !== 'admin') {
            return res.status(403).json({ ok: false, msg: 'No autorizado' });
        }

        // Parámetros de filtro y paginación
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const status = req.query.status || null; // Filtrar por estado del producto reportado
        const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
        const sortBy = req.query.sortBy || 'last_reported_at'; // Campo para ordenar
        const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

        // Query: Productos con al menos un reporte
        let query = {
            'reports.0': { $exists: true }
        };

        if (!includeInactive) {
            query.active = true;
        }

        // Filtrar por estado del producto reportado si se proporciona
        if (status) {
            if (status === 'pending') {
                query['$or'] = [
                    { report_status: 'pending' },
                    { report_status: { $exists: false } },
                    { report_status: null }
                ];
            } else {
                query['report_status'] = status;
            }
        }

        // Obtener total de productos reportados
        const total = await Product.countDocuments(query);

        // Obtener productos reportados con paginación
        const products = await Product.find(query)
            .populate('owner', 'name surname email contact company_name slug image')
            .populate('reports.reporter', 'name surname email')
            .sort({ [sortBy]: sortOrder })
            .skip(skip)
            .limit(limit)
            .lean();

        const normalizedProducts = products.map((product) => {
            const reports = Array.isArray(product.reports) ? product.reports : [];
            return {
                ...product,
                report_count: reports.length
            };
        });

        res.json({
            ok: true,
            msg: 'Productos reportados obtenidos',
            products: normalizedProducts,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, msg: 'Error obteniendo productos reportados' });
    }
};

/*
updateReportedProductStatus: Actualizar estado de moderación de un producto reportado (admin)
<--- status: pending | dismissed | actioned
pending se usa como "revertir/cancelar" un reporte aceptado
*/
const updateReportedProductStatus = async(req, res = response) => {
    const productId = req.params.id;
    const status = String(req.body.status || '').trim();

    try {
        if (req.role !== 'admin') {
            return res.status(403).json({ ok: false, msg: 'No autorizado' });
        }

        const product = await Product.findById(productId).select('_id reports report_count last_reported_at report_status active');
        if (!product) {
            return res.status(404).json({ ok: false, msg: 'Producto no encontrado' });
        }

        if (!Array.isArray(product.reports) || product.reports.length === 0) {
            return res.status(400).json({ ok: false, msg: 'El producto no tiene reportes para moderar' });
        }

        if (status === 'pending') {
            // Revertir un reporte aceptado: reactivar y devolver el caso a revisión.
            product.active = true;
            product.report_status = 'pending';
        } else if (status === 'dismissed') {
            // Denegar reporte: limpiar el caso para que no quede en cola de moderación.
            product.active = true;
            product.reports = [];
            product.report_count = 0;
            product.last_reported_at = null;
            product.report_status = 'dismissed';
        } else {
            product.report_status = status;

            // Si el admin acciona el reporte, ocultamos el producto del mapa/listados públicos.
            if (status === 'actioned') {
                product.active = false;
            }
        }

        await product.save();

        return res.json({
            ok: true,
            msg: status === 'pending'
                ? 'Reporte reabierto y producto reactivado'
                : status === 'dismissed'
                    ? 'Reporte denegado y limpieza aplicada'
                    : 'Estado del reporte actualizado',
            productId,
            report_status: product.report_status,
            active: product.active
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, msg: 'Error actualizando estado del reporte' });
    }
};

module.exports = {
    getProducts,
    getMapLiteProducts,
    getBatchProductDetails,
    getProductsCacheMetadata,
    getProductBySlug,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
    reportProduct,
    getMyProducts,
    getAdminProducts,
    getOpenDataDataset,
    getEstadisticasUso,
    getReportedProducts,
    updateReportedProductStatus
};
