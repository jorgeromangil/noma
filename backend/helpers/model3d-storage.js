const path = require('path');
const crypto = require('crypto');
const { GoogleAuth, OAuth2Client } = require('google-auth-library');

const MAX_MB = parseInt(process.env.MODEL3D_MAX_MB || '100', 10);
const DRIVE_FOLDER_ID = process.env.MODEL3D_DRIVE_FOLDER_ID || '';
const DRIVE_CREDENTIALS_PATH = process.env.MODEL3D_DRIVE_CREDENTIALS_PATH || 'google-credentials.json';
const DRIVE_PUBLIC_READ = String(process.env.MODEL3D_DRIVE_PUBLIC_READ || 'false').toLowerCase() === 'true';
const DRIVE_AUTH_MODE = String(process.env.MODEL3D_DRIVE_AUTH_MODE || 'service_account').toLowerCase();
const DRIVE_OAUTH_CLIENT_ID = process.env.MODEL3D_DRIVE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
const DRIVE_OAUTH_CLIENT_SECRET = process.env.MODEL3D_DRIVE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';
const DRIVE_OAUTH_REFRESH_TOKEN = process.env.MODEL3D_DRIVE_OAUTH_REFRESH_TOKEN || '';
const DRIVE_OAUTH_REDIRECT_URI = process.env.MODEL3D_DRIVE_OAUTH_REDIRECT_URI || 'https://developers.google.com/oauthplayground';

const driveAuth = new GoogleAuth({
    keyFilename: path.resolve(process.cwd(), DRIVE_CREDENTIALS_PATH),
    scopes: ['https://www.googleapis.com/auth/drive.file'],
});

const driveOAuthClient = new OAuth2Client(
    DRIVE_OAUTH_CLIENT_ID,
    DRIVE_OAUTH_CLIENT_SECRET,
    DRIVE_OAUTH_REDIRECT_URI
);

let cachedAccessToken = null;
let cachedAccessTokenExp = 0;

const getDriveAccessToken = async () => {
    const now = Date.now();
    if (cachedAccessToken && cachedAccessTokenExp - 60_000 > now) {
        return cachedAccessToken;
    }

    let tokenResponse;

    if (DRIVE_AUTH_MODE === 'oauth_user') {
        if (!DRIVE_OAUTH_CLIENT_ID || !DRIVE_OAUTH_CLIENT_SECRET || !DRIVE_OAUTH_REFRESH_TOKEN) {
            throw new Error(
                'Falta configurar OAuth de usuario para Drive. Define MODEL3D_DRIVE_OAUTH_CLIENT_ID, ' +
                'MODEL3D_DRIVE_OAUTH_CLIENT_SECRET y MODEL3D_DRIVE_OAUTH_REFRESH_TOKEN en .env.'
            );
        }
        driveOAuthClient.setCredentials({ refresh_token: DRIVE_OAUTH_REFRESH_TOKEN });
        tokenResponse = await driveOAuthClient.getAccessToken();
    } else {
        const client = await driveAuth.getClient();
        tokenResponse = await client.getAccessToken();
    }

    const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;
    if (!token) {
        throw new Error('No se pudo obtener token de acceso para Google Drive');
    }

    cachedAccessToken = token;
    cachedAccessTokenExp = now + 50 * 60 * 1000;
    return token;
};

const isValidGlbName = (originalName) => {
    const safeName = String(originalName || '').toLowerCase();
    if (!safeName.endsWith('.glb')) return false;
    // Reject double extensions
    const parts = safeName.split('.');
    return parts.length === 2; // e.g., model.glb
};

const allowedMimes = new Set([
    'model/gltf-binary',
    'model/gltf+json',
    'application/octet-stream'
]);

const checkMagicGlbBuffer = (buffer) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
    return buffer.subarray(0, 4).toString('utf8') === 'glTF';
};

const computeSha256Buffer = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const requireDriveConfig = () => {
    if (!DRIVE_FOLDER_ID) {
        throw new Error('Falta MODEL3D_DRIVE_FOLDER_ID en variables de entorno');
    }
};

const buildDrivePublicUrl = (fileId) => `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;

const uploadModelBufferToDrive = async ({ filename, buffer, mimeType = 'model/gltf-binary' }) => {
    requireDriveConfig();
    const accessToken = await getDriveAccessToken();

    const boundary = `syncro-model3d-${crypto.randomBytes(12).toString('hex')}`;
    const metadata = {
        name: filename,
        parents: [DRIVE_FOLDER_ID],
    };

    const metadataPart = Buffer.from(
        `--${boundary}\r\n` +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        `${JSON.stringify(metadata)}\r\n`
    );

    const fileHeaderPart = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n`
    );
    const endPart = Buffer.from(`\r\n--${boundary}--`);
    const body = Buffer.concat([metadataPart, fileHeaderPart, buffer, endPart]);

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,mimeType,size', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
    });

    if (!response.ok) {
        const rawText = await response.text().catch(() => '');
        let parsed;
        try {
            parsed = rawText ? JSON.parse(rawText) : null;
        } catch {
            parsed = null;
        }

        const serviceDisabledReason =
            parsed?.error?.details?.find((d) => d?.reason === 'SERVICE_DISABLED') ||
            parsed?.error?.errors?.find((e) => e?.reason === 'accessNotConfigured');

        if (serviceDisabledReason) {
            const activationUrl =
                parsed?.error?.details?.find((d) => d?.metadata?.activationUrl)?.metadata?.activationUrl ||
                parsed?.error?.errors?.[0]?.extendedHelp ||
                'https://console.cloud.google.com/apis/library/drive.googleapis.com';
            const consumer = parsed?.error?.details?.find((d) => d?.metadata?.consumer)?.metadata?.consumer || '';
            throw new Error(
                `Google Drive API desactivada para la credencial actual${consumer ? ` (${consumer})` : ''}. ` +
                `Actívala en: ${activationUrl} y espera 2-5 minutos antes de reintentar.`
            );
        }

        const quotaExceededReason = parsed?.error?.errors?.find((e) => e?.reason === 'storageQuotaExceeded');
        if (quotaExceededReason) {
            throw new Error(
                'La credencial actual no tiene cuota de almacenamiento en Drive. ' +
                'Usa OAuth de usuario (MODEL3D_DRIVE_AUTH_MODE=oauth_user) con refresh token, ' +
                'o sube a un Shared Drive de Google Workspace.'
            );
        }

        const noPermissionReason =
            parsed?.error?.errors?.find((e) => e?.reason === 'insufficientFilePermissions' || e?.reason === 'forbidden');
        if (noPermissionReason) {
            throw new Error('La credencial actual no tiene permisos sobre la carpeta de Drive. Compártela como Editor y reintenta.');
        }

        throw new Error(`Google Drive rechazó la subida (${response.status})${rawText ? `: ${rawText}` : ''}`);
    }

    const created = await response.json();

    if (DRIVE_PUBLIC_READ && created?.id) {
        await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(created.id)}/permissions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ role: 'reader', type: 'anyone' }),
        });
    }

    return {
        driveFileId: created?.id || null,
        driveMimeType: created?.mimeType || mimeType,
        sizeBytes: created?.size ? Number(created.size) : buffer.length,
        publicUrl: created?.id ? buildDrivePublicUrl(created.id) : null,
    };
};

const downloadModelFromDrive = async (driveFileId) => {
    if (!driveFileId) {
        const err = new Error('driveFileId requerido');
        err.status = 400;
        throw err;
    }

    const accessToken = await getDriveAccessToken();
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        const err = new Error(`No se pudo descargar el modelo de Drive (${response.status})`);
        err.status = response.status === 404 ? 404 : 502;
        throw err;
    }

    const contentType = response.headers.get('content-type') || 'model/gltf-binary';
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, contentType };
};

const deleteModelFile = async (productId, filename, driveFileId) => {
    if (driveFileId) {
        try {
            const accessToken = await getDriveAccessToken();
            const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}`, {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });
            if (!response.ok && response.status !== 404) {
                const detail = await response.text().catch(() => '');
                console.warn(`[model3d] No se pudo eliminar archivo de Drive ${driveFileId}: ${response.status} ${detail}`);
            }
            return;
        } catch (err) {
            console.warn(`[model3d] Error eliminando archivo de Drive ${driveFileId}:`, err.message || err);
            return;
        }
    }
};

module.exports = {
    MAX_MB,
    isValidGlbName,
    allowedMimes,
    checkMagicGlbBuffer,
    computeSha256Buffer,
    uploadModelBufferToDrive,
    downloadModelFromDrive,
    deleteModelFile,
};
