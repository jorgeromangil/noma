const jwt = require('jsonwebtoken');
const Product = require('../models/products');
const {
    checkMagicGlbBuffer,
    computeSha256Buffer,
    uploadModelBufferToDrive,
    downloadModelFromDrive,
    deleteModelFile,
} = require('../helpers/model3d-storage');

const streamModelFromRemoteUrl = async (remoteUrl, res) => {
    const upstream = await fetch(remoteUrl);
    if (!upstream.ok) {
        const err = new Error(`No se pudo descargar el modelo remoto (${upstream.status})`);
        err.status = upstream.status === 404 ? 404 : 502;
        throw err;
    }

    const contentType = upstream.headers.get('content-type') || 'model/gltf-binary';
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(buffer);
};

const sanitizeProductId = (id) => /^[a-f\d]{24}$/i.test(id) ? id : null;

const sanitizeForFilename = (value) => {
    const base = String(value || 'producto')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

    const safe = base || 'producto';
    return safe.slice(0, 80);
};

const getOptionalAuthContext = (req) => {
    const authHeader = req.header('authorization') || req.header('Authorization') || '';
    const bearerToken = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : null;
    const legacyToken = req.header('x-token');
    const token = bearerToken || legacyToken;

    if (!token) return null;

    try {
        const { uid, role } = jwt.verify(token, process.env.JWT_SECRET);
        return { uid, role };
    } catch (error) {
        return null;
    }
};

const assertOwnership = async (req, productId) => {
    const product = await Product.findById(productId);
    if (!product) {
        const err = new Error('Producto no encontrado');
        err.status = 404;
        throw err;
    }
    const ownerId = product.owner && product.owner.toString();
    const isOwner = ownerId === req.uid;
    const isAdmin = req.role === 'admin';
    if (!isOwner && !isAdmin) {
        const err = new Error('No autorizado');
        err.status = 403;
        throw err;
    }
    return product;
};

const uploadModel3d = async (req, res) => {
    const productId = sanitizeProductId(req.params.id);
    if (!productId) return res.status(400).json({ ok: false, msg: 'ID de producto inválido' });
    if (!req.file) return res.status(400).json({ ok: false, msg: 'Archivo no recibido' });

    try {
        const product = await assertOwnership(req, productId);
        const originalName = String(req.file.originalname || '').trim();
        const safeOriginalName = originalName.toLowerCase().endsWith('.glb') ? originalName : `${originalName || 'modelo'}.glb`;
        const filename = `${sanitizeForFilename(product?.name)}_modelo3D.glb`;
        const fileBuffer = req.file.buffer;

        // Validar cabecera glTF en memoria antes de subir
        const isGlb = checkMagicGlbBuffer(fileBuffer);
        if (!isGlb) {
            return res.status(400).json({ ok: false, msg: 'El archivo no es un glb válido (cabecera glTF)' });
        }

        const sha256 = computeSha256Buffer(fileBuffer);
        const uploaded = await uploadModelBufferToDrive({
            filename,
            buffer: fileBuffer,
            mimeType: req.file.mimetype || 'model/gltf-binary',
        });

        // Si ya existía un modelo, eliminarlo en Drive
        if (product.model3d && (product.model3d.driveFileId || product.model3d.filename)) {
            await deleteModelFile(productId, product.model3d.filename, product.model3d.driveFileId);
        }

        product.model3d = {
            url: uploaded.publicUrl,
            filename,
            driveFileId: uploaded.driveFileId,
            driveMimeType: uploaded.driveMimeType,
            originalName: safeOriginalName,
            sizeBytes: uploaded.sizeBytes,
            sha256,
            uploadedAt: new Date(),
            uploadedBy: req.uid,
        };
        await product.save();

        return res.json({ ok: true, model3d: product.model3d });
    } catch (error) {
        const status = error.status || 500;
        console.error('[uploadModel3d]', error.message || error);
        return res.status(status).json({ ok: false, msg: error.message || 'Error subiendo modelo 3D' });
    }
};

const getModel3dMetadata = async (req, res) => {
    const productId = sanitizeProductId(req.params.id);
    if (!productId) return res.status(400).json({ ok: false, msg: 'ID de producto inválido' });

    try {
        const product = await assertOwnership(req, productId);
        if (!product.model3d || !product.model3d.url) {
            return res.status(404).json({ ok: false, msg: 'Modelo 3D no encontrado' });
        }
        return res.json({ ok: true, model3d: product.model3d });
    } catch (error) {
        const status = error.status || 500;
        return res.status(status).json({ ok: false, msg: error.message || 'Error obteniendo modelo 3D' });
    }
};

const deleteModel3d = async (req, res) => {
    const productId = sanitizeProductId(req.params.id);
    if (!productId) return res.status(400).json({ ok: false, msg: 'ID de producto inválido' });

    try {
        const product = await assertOwnership(req, productId);
        if (product.model3d && (product.model3d.driveFileId || product.model3d.filename)) {
            await deleteModelFile(productId, product.model3d.filename, product.model3d.driveFileId);
        }
        product.model3d = null;
        await product.save();
        return res.json({ ok: true, msg: 'Modelo 3D eliminado', model3d: null });
    } catch (error) {
        const status = error.status || 500;
        return res.status(status).json({ ok: false, msg: error.message || 'Error eliminando modelo 3D' });
    }
};

const serveModel3dPublic = async (req, res) => {
    const productId = sanitizeProductId(req.params.id);
    if (!productId) return res.status(400).json({ ok: false, msg: 'ID de producto inválido' });

    try {
        const product = await Product.findById(productId).select('active model3d owner');
        if (!product) {
            return res.status(404).json({ ok: false, msg: 'Producto no encontrado' });
        }

        if (product.active === false) {
            const auth = getOptionalAuthContext(req);
            const ownerId = product.owner ? product.owner.toString() : '';
            const isOwner = ownerId && auth?.uid === ownerId;
            const isAdmin = auth?.role === 'admin';

            if (!isOwner && !isAdmin) {
                return res.status(404).json({ ok: false, msg: 'Producto no encontrado' });
            }
        }

        const model3d = product.model3d;
        if (!model3d || (!model3d.filename && !model3d.url)) {
            return res.status(404).json({ ok: false, msg: 'Modelo 3D no encontrado' });
        }

        if (model3d.driveFileId) {
            const { buffer, contentType } = await downloadModelFromDrive(model3d.driveFileId);
            res.setHeader('Content-Type', contentType || model3d.driveMimeType || 'model/gltf-binary');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            return res.send(buffer);
        }

        if (model3d.url) {
            return await streamModelFromRemoteUrl(model3d.url, res);
        }

        return res.status(404).json({ ok: false, msg: 'Modelo 3D no encontrado' });
    } catch (error) {
        const status = error.status || 500;
        return res.status(status).json({ ok: false, msg: error.message || 'Error sirviendo modelo 3D' });
    }
};

module.exports = {
    uploadModel3d,
    getModel3dMetadata,
    deleteModel3d,
    serveModel3dPublic,
};
