// Engine adapters: tool probing, connection tests, and dump pipelines.
// Dumps are spawned with child_process.spawn and an args ARRAY — never a shell
// string. Passwords travel via env (PGPASSWORD / MYSQL_PWD) or a temp config
// file (mongodump), never argv.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openSqlite } from './db.js';
import { decryptSecret } from './crypto.js';

const ENGINE_TOOLS = {
  postgres: 'pg_dump',
  mysql: 'mysqldump',
  mongo: 'mongodump',
  sqlite: 'sqlite3'
};

const INSTALL_HINTS = {
  pg_dump: 'Install PostgreSQL client tools: apt install postgresql-client / winget install PostgreSQL.PostgreSQL / brew install libpq',
  mysqldump: 'Install MySQL client tools: apt install default-mysql-client / winget install Oracle.MySQL / brew install mysql-client',
  mongodump: 'Install MongoDB Database Tools: https://www.mongodb.com/try/download/database-tools',
  sqlite3: 'Optional — Vaultkeeper has a built-in SQLite engine (better-sqlite3 backup API). CLI: apt install sqlite3 / winget install SQLite.SQLite',
  age: 'Optional encryption backend: https://github.com/FiloSottile/age (built-in AES-256-GCM is used otherwise)'
};

function probeBinary(bin) {
  try {
    const r = spawnSync(bin, ['--version'], { timeout: 8000, windowsHide: true });
    if (r.error || r.status !== 0) return { available: false };
    const version = String(r.stdout || r.stderr || '').trim().split('\n')[0];
    return { available: true, version };
  } catch {
    return { available: false };
  }
}

/** Probe PATH for every engine CLI + age. SQLite is always available (built-in). */
export function toolCheck() {
  const tools = {};
  for (const bin of ['pg_dump', 'mysqldump', 'mongodump', 'sqlite3', 'age']) {
    tools[bin] = { ...probeBinary(bin), hint: INSTALL_HINTS[bin] };
  }
  // The sqlite ENGINE never needs a CLI — better-sqlite3's backup() API is built in.
  tools.sqlite = {
    available: true,
    builtin: true,
    version: 'built-in (better-sqlite3 online backup API)',
    hint: 'No external tool required.'
  };
  return tools;
}

function binFor(source) {
  return source.custom_bin_path?.trim() || ENGINE_TOOLS[source.engine];
}

function extraFlags(source) {
  const raw = (source.extra_flags || '').trim();
  return raw ? raw.split(/\s+/) : [];
}

function collectStderr(child, sink) {
  child.stderr?.on('data', (d) => {
    sink.text = (sink.text + d.toString()).slice(-4000);
  });
}

function tmpFilePath(prefix) {
  const dir = process.env.BACKUP_TMP_DIR || path.join(os.tmpdir(), 'vaultkeeper');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

/**
 * Start a dump for a source row. Returns:
 *   { stream, child, stderr, done(), cleanup() }
 * - stream: readable of raw dump bytes
 * - child: spawned process (or null for built-in sqlite) — tracked by the
 *   runner so ONLY this PID can ever be killed on cancel
 * - done(): resolves when the producer finished OK, rejects with stderr detail
 */
export async function startDump(source) {
  const engine = source.engine;
  if (engine === 'sqlite') return sqliteDump(source);
  if (engine === 'postgres') return spawnDump(source, buildPostgresArgs(source), { PGPASSWORD: decryptSecret(source.password_enc) });
  if (engine === 'mysql') return spawnDump(source, buildMysqlArgs(source), { MYSQL_PWD: decryptSecret(source.password_enc) });
  if (engine === 'mongo') return mongoDump(source);
  throw new Error(`Unknown engine: ${engine}`);
}

function buildPostgresArgs(source) {
  const args = ['--no-password'];
  if (source.host) args.push('-h', source.host);
  if (source.port) args.push('-p', String(source.port));
  if (source.username) args.push('-U', source.username);
  args.push(...extraFlags(source));
  args.push('-d', source.database);
  return args;
}

function buildMysqlArgs(source) {
  const args = ['--single-transaction', '--routines', '--triggers'];
  if (source.host) args.push('-h', source.host);
  if (source.port) args.push('-P', String(source.port), '--protocol=TCP');
  if (source.username) args.push('-u', source.username);
  args.push(...extraFlags(source));
  args.push(source.database);
  return args;
}

function spawnDump(source, args, envExtra) {
  const stderr = { text: '' };
  const child = spawn(binFor(source), args, {
    env: { ...process.env, ...envExtra },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  collectStderr(child, stderr);
  const done = new Promise((resolve, reject) => {
    child.on('error', (e) => reject(new Error(`Failed to start ${binFor(source)}: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${binFor(source)} exited with code ${code}: ${stderr.text.trim().slice(-500)}`));
    });
  });
  done.catch(() => {}); // observed later by the runner; avoid unhandled rejection
  return { stream: child.stdout, child, stderr, done: () => done, cleanup: () => {} };
}

function mongoDump(source) {
  const stderr = { text: '' };
  const args = ['--archive', '--db', source.database];
  if (source.host) args.push('--host', source.host);
  if (source.port) args.push('--port', String(source.port));
  args.push(...extraFlags(source));
  let cfgPath = null;
  if (source.username) {
    args.push('--username', source.username, '--authenticationDatabase', 'admin');
    const password = decryptSecret(source.password_enc);
    if (password) {
      // Password via config file — never argv (visible in process list).
      cfgPath = tmpFilePath('mongo-cfg');
      fs.writeFileSync(cfgPath, `password: ${JSON.stringify(password)}\n`, { mode: 0o600 });
      args.push('--config', cfgPath);
    }
  }
  const child = spawn(binFor(source), args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  collectStderr(child, stderr);
  const done = new Promise((resolve, reject) => {
    child.on('error', (e) => reject(new Error(`Failed to start ${binFor(source)}: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`mongodump exited with code ${code}: ${stderr.text.trim().slice(-500)}`));
    });
  });
  done.catch(() => {});
  const cleanup = () => { if (cfgPath) fs.rmSync(cfgPath, { force: true }); };
  return { stream: child.stdout, child, stderr, done: () => done, cleanup };
}

/** SQLite: consistent snapshot via better-sqlite3's online backup API — never
 *  a raw fs.copyFile on a hot WAL database. */
async function sqliteDump(source) {
  const file = source.sqlite_path;
  if (!file || !fs.existsSync(file)) {
    throw new Error(`SQLite database file not found: ${file || '(no path set)'}`);
  }
  const snapPath = tmpFilePath('sqlite-snap');
  const src = openSqlite(file, { fileMustExist: true, readonly: true });
  try {
    await src.backup(snapPath);
  } finally {
    src.close();
  }
  const stream = fs.createReadStream(snapPath);
  const done = new Promise((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  done.catch(() => {});
  return {
    stream,
    child: null,
    stderr: { text: '' },
    done: () => done,
    cleanup: () => fs.rmSync(snapPath, { force: true })
  };
}

/** Cheap connection probe per engine ("Test connection" button). */
export async function testSource(source) {
  const engine = source.engine;
  if (engine === 'sqlite') {
    if (!source.sqlite_path || !fs.existsSync(source.sqlite_path)) {
      throw new Error(`File not found: ${source.sqlite_path || '(no path set)'}`);
    }
    const db = openSqlite(source.sqlite_path, { fileMustExist: true, readonly: true });
    try {
      const row = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get();
      return { ok: true, detail: `Opened OK — ${row.n} table(s)` };
    } finally {
      db.close();
    }
  }

  let args, envExtra = {};
  if (engine === 'postgres') {
    args = [...buildPostgresArgs(source)];
    args.splice(args.length - 2, 0, '--schema-only'); // before -d <db>
    envExtra = { PGPASSWORD: decryptSecret(source.password_enc) };
  } else if (engine === 'mysql') {
    args = [...buildMysqlArgs(source)];
    args.splice(args.length - 1, 0, '--no-data');
    envExtra = { MYSQL_PWD: decryptSecret(source.password_enc) };
  } else if (engine === 'mongo') {
    // Probing a nonexistent collection validates connectivity + auth cheaply.
    const probe = await startDump({ ...source, extra_flags: `${source.extra_flags || ''} --collection __vaultkeeper_probe__`.trim() });
    probe.stream.resume();
    try {
      await probe.done();
      return { ok: true, detail: 'mongodump handshake OK' };
    } finally {
      probe.cleanup();
    }
  } else {
    throw new Error(`Unknown engine: ${engine}`);
  }

  const stderr = { text: '' };
  const bin = binFor(source);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: { ...process.env, ...envExtra },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 20000
    });
    child.stdout.resume(); // discard
    collectStderr(child, stderr);
    child.on('error', (e) => reject(new Error(`Failed to start ${bin}: ${e.message} — is it installed / on PATH?`)));
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true, detail: `${bin} handshake OK` });
      else reject(new Error(stderr.text.trim().slice(-500) || `${bin} exited with code ${code}`));
    });
  });
}
