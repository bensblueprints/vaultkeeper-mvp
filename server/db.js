import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function nativeBindingPath() {
  // Under Electron the Node-ABI binding won't load; use the vendored Electron prebuild.
  if (!process.versions.electron) return null;
  const p = path.join(__dirname, '..', 'vendor', 'better_sqlite3-electron.node');
  return fs.existsSync(p) ? p : null;
}

/** Open a SQLite database honoring the dual-runtime vendored binding. */
export function openSqlite(file, options = {}) {
  const nativeBinding = nativeBindingPath();
  return new Database(file, nativeBinding ? { ...options, nativeBinding } : options);
}

let db = null;

export function getDb() {
  if (db) return db;
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'vaultkeeper.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = openSqlite(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      engine TEXT NOT NULL,                -- postgres | mysql | sqlite | mongo
      host TEXT DEFAULT '',
      port INTEGER,
      database TEXT DEFAULT '',
      username TEXT DEFAULT '',
      password_enc TEXT DEFAULT '',
      sqlite_path TEXT DEFAULT '',
      extra_flags TEXT DEFAULT '',
      custom_bin_path TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS destinations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,                  -- local | s3 | ftp
      config_enc TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      destination_id INTEGER NOT NULL,
      cron_expr TEXT NOT NULL DEFAULT '0 3 * * *',
      tz TEXT DEFAULT '',
      compress INTEGER NOT NULL DEFAULT 1,
      encrypt_mode TEXT NOT NULL DEFAULT 'none',  -- none | age | aes
      age_recipient TEXT DEFAULT '',
      passphrase_enc TEXT DEFAULT '',
      keep_last INTEGER,
      keep_daily_days INTEGER,
      keep_weekly_weeks INTEGER,
      alert_webhook_url TEXT DEFAULT '',
      alert_email TEXT DEFAULT '',
      alert_on_success INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',     -- running | ok | failed
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      artifact_name TEXT DEFAULT '',
      size_bytes INTEGER DEFAULT 0,
      sha256 TEXT DEFAULT '',
      duration_ms INTEGER DEFAULT 0,
      error TEXT DEFAULT '',
      stderr_tail TEXT DEFAULT '',
      pruned INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_runs_job ON runs(job_id);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
  `);
  return db;
}

export function getSetting(key, fallback = '') {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value ?? ''));
}
