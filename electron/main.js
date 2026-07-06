// Thin Electron wrapper: boots the same Express server on a free local port
// with data stored in Electron's userData dir, then opens a window pointing
// at it. Auth is disabled (local desktop = already the admin).
import { app, BrowserWindow } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });

  process.env.DB_PATH = path.join(userData, 'vaultkeeper.db');
  process.env.BACKUP_TMP_DIR = path.join(userData, 'tmp');
  process.env.AUTH_DISABLED = 'true';

  // Persistent SECRET_KEY in userData so stored credentials survive restarts.
  const keyFile = path.join(userData, 'secret.key');
  if (!fs.existsSync(keyFile)) {
    fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  process.env.SECRET_KEY = fs.readFileSync(keyFile, 'utf8').trim();

  // Import server modules only after env is set (db.js reads DB_PATH lazily,
  // but keep the same discipline as the other suite apps).
  const { createApp } = await import('../server/app.js');
  const { startScheduler } = await import('../server/scheduler.js');

  const server = createApp().listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    startScheduler();

    const win = new BrowserWindow({
      width: 1360,
      height: 880,
      backgroundColor: '#09090b',
      autoHideMenuBar: true,
      title: 'Vaultkeeper'
    });
    win.loadURL(`http://127.0.0.1:${port}/`);
  });

  app.on('window-all-closed', () => {
    server.close();
    app.quit();
  });
});
