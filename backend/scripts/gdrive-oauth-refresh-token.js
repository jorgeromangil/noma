require('dotenv').config();

const { OAuth2Client } = require('google-auth-library');
const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');

const CLIENT_ID = process.env.MODEL3D_DRIVE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.MODEL3D_DRIVE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.MODEL3D_DRIVE_OAUTH_REDIRECT_URI || 'https://developers.google.com/oauthplayground';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Faltan credenciales OAuth. Define GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET o MODEL3D_DRIVE_OAUTH_* en .env');
  process.exit(1);
}

const oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const scopes = ['https://www.googleapis.com/auth/drive.file'];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: scopes,
});


(async () => {
  const rl = readline.createInterface({ input, output });
  try {
    const code = (await rl.question('Authorization code: ')).trim();
    if (!code) {
      throw new Error('No se recibió authorization code');
    }

    const tokenResponse = await oauth2Client.getToken(code);
    const tokens = tokenResponse.tokens || {};

    if (!tokens.refresh_token) {
      console.error('\nNo se recibió refresh token. Repite autorizando con prompt=consent y/o revoca accesos previos de la app.');
      process.exit(1);
    }

  } catch (err) {
    console.error('\nError obteniendo refresh token:', err.message || err);
    process.exit(1);
  } finally {
    rl.close();
  }
})();
