import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// SECRET_KEY encrypts stored credentials at rest. Generate one into .env on
// first run so a fresh install is secure by default.
if (!process.env.SECRET_KEY) {
  const key = crypto.randomBytes(32).toString('hex');
  const envPath = path.join(__dirname, '..', '.env');
  try {
    fs.appendFileSync(envPath, `${fs.existsSync(envPath) ? '\n' : ''}SECRET_KEY=${key}\n`);
    console.log('[init] Generated SECRET_KEY and saved it to .env — keep this file safe; it decrypts your stored credentials.');
  } catch (e) {
    console.warn('[init] Could not persist SECRET_KEY to .env:', e.message);
  }
  process.env.SECRET_KEY = key;
}

const { createApp } = await import('./app.js');
const { startScheduler } = await import('./scheduler.js');

const PORT = parseInt(process.env.PORT || '5323', 10);

if (!process.env.ADMIN_PASSWORD && process.env.AUTH_DISABLED !== 'true') {
  console.warn('[warn] ADMIN_PASSWORD is not set — admin login will be impossible. Set it in .env');
}

const app = createApp();
app.listen(PORT, () => {
  console.log(`Vaultkeeper listening on http://localhost:${PORT}`);
  startScheduler();
});
