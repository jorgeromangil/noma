const multer = require('multer');
const {
    MAX_MB,
    isValidGlbName,
    allowedMimes,
} = require('../helpers/model3d-storage');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    const extOk = isValidGlbName(file.originalname || '');
    const mimeOk = allowedMimes.has(file.mimetype);
    if (!extOk) return cb(new Error('Solo se aceptan archivos .glb'));
    if (!mimeOk) return cb(new Error('MIME no permitido para modelos 3D'));
    cb(null, true);
};

const uploadModel3d = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: MAX_MB * 1024 * 1024,
        files: 1,
        fields: 5,
    }
}).single('model');

// Wrapper to use as Express middleware with async/await style
const handleUpload = (req, res, next) => {
    uploadModel3d(req, res, (err) => {
        if (err) {
            const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
            return res.status(status).json({ ok: false, msg: err.message || 'Error subiendo modelo 3D' });
        }
        if (!req.file) {
            return res.status(400).json({ ok: false, msg: 'Archivo no recibido (campo model)' });
        }
        next();
    });
};

module.exports = {
    handleUpload,
};
