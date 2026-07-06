// Smoke test (uptime-monitor style): boots the real server against a temp DB,
// exercises the full backup pipeline with the always-available SQLite engine
// (no external daemons), and proves the artifact is a RESTORABLE backup by
// decrypting + gunzipping it and reading the rows back.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const TEST_PORT = 5397;
const WEBHOOK_PORT = 5398;
const ADMIN_PASSWORD = 'smoke-test-password';
const SECRET_KEY = 'smoke-secret-key-not-for-prod';
const PASSPHRASE = 'smoke-pass';
const BASE = `http://127.0.0.1:${TEST_PORT}`;

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-smoke-'));
const DB_PATH = path.join(workDir, 'app.db');
const destDir = path.join(workDir, 'backups');
const tmpDir = path.join(workDir, 'staging');
const fixturePath = path.join(workDir, 'fixture.db');
fs.mkdirSync(destDir, { recursive: true });
fs.mkdirSync(tmpDir, { recursive: true });

let serverProc = null;
let webhookServer = null;
const webhookHits = [];

const { default: Database } = await import('better-sqlite3');

function makeFixture() {
  const db = new Database(fixturePath);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, email TEXT)');
  const ins = db.prepare('INSERT INTO customers (name, email) VALUES (?, ?)');
  for (let i = 1; i <= 50; i++) ins.run(`Customer ${i}`, `customer${i}@example.com`);
  db.close();
}

function startWebhookReceiver() {
  return new Promise((resolve) => {
    webhookServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        webhookHits.push(body);
        res.writeHead(200).end('ok');
      });
    });
    webhookServer.listen(WEBHOOK_PORT, '127.0.0.1', resolve);
  });
}

async function waitFor(fn, label, tries = 60, delay = 250) {
  for (let i = 0; i < tries; i++) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

let cookie = '';
async function api(pathname, options = {}) {
  const res = await fetch(BASE + pathname, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function runJobAndWait(jobId, expectStatus = 'ok', prevRunCount = 0) {
  const kicked = await api(`/api/jobs/${jobId}/run`, { method: 'POST' });
  assert.strictEqual(kicked.status, 200, 'run-now must accept');
  const run = await waitFor(async () => {
    const { data } = await api(`/api/jobs/${jobId}/runs`);
    if (!Array.isArray(data) || data.length <= prevRunCount) return null;
    const latest = data[0];
    return latest.status !== 'running' ? latest : null;
  }, `job ${jobId} run to finish`);
  assert.strictEqual(run.status, expectStatus, `run must be ${expectStatus}, got ${run.status}: ${run.error}`);
  return run;
}

function decryptVK1(buf, passphrase) {
  assert.strictEqual(buf.subarray(0, 3).toString(), 'VK1', 'artifact must start with VK1 magic');
  const salt = buf.subarray(3, 19);
  const iv = buf.subarray(19, 31);
  const tag = buf.subarray(31, 47);
  const key = crypto.scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(47)), d.final()]);
}

async function main() {
  console.log('0. Fixture: SQLite db with 50 rows +', workDir);
  makeFixture();
  await startWebhookReceiver();

  console.log('1. Starting Vaultkeeper on port', TEST_PORT);
  serverProc = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      ADMIN_PASSWORD,
      DB_PATH,
      SECRET_KEY,
      BACKUP_TMP_DIR: tmpDir,
      SCHED_TICK_MS: '500',
      AUTH_DISABLED: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProc.stdout.on('data', (d) => process.stdout.write(`   [server] ${d}`));
  serverProc.stderr.on('data', (d) => process.stderr.write(`   [server] ${d}`));
  await waitFor(async () => (await api('/api/health')).data.ok, 'server health');

  console.log('1b. Auth gates + tool check');
  const bad = await api('/api/login', { method: 'POST', body: { password: 'wrong' } });
  assert.strictEqual(bad.status, 401, 'wrong password must 401');
  cookie = '';
  const unauth = await api('/api/jobs');
  assert.strictEqual(unauth.status, 401, '/api/jobs must require auth');
  const good = await api('/api/login', { method: 'POST', body: { password: ADMIN_PASSWORD } });
  assert.strictEqual(good.status, 200, 'login must succeed');
  const tools = await api('/api/tools');
  assert.strictEqual(tools.status, 200);
  assert.ok(tools.data.sqlite, '/api/tools must list sqlite');
  assert.strictEqual(tools.data.sqlite.available, true, 'sqlite engine must be available (built-in)');
  console.log('   tools:', Object.entries(tools.data).map(([k, v]) => `${k}=${v.available ? 'ok' : 'missing'}`).join(' '));

  console.log('2. Local destination create + test');
  const destRes = await api('/api/destinations', {
    method: 'POST',
    body: { name: 'Smoke Local', type: 'local', config: { path: destDir } }
  });
  assert.strictEqual(destRes.status, 201, 'destination create must 201');
  const destId = destRes.data.id;
  const destTest = await api(`/api/destinations/${destId}/test`, { method: 'POST' });
  assert.strictEqual(destTest.status, 200);
  assert.strictEqual(destTest.data.ok, true, 'destination test must pass');

  console.log('3. SQLite source create + test; secrets encrypted at rest');
  const srcRes = await api('/api/sources', {
    method: 'POST',
    body: { name: 'Smoke Fixture', engine: 'sqlite', sqlite_path: fixturePath }
  });
  assert.strictEqual(srcRes.status, 201, 'source create must 201');
  const sourceId = srcRes.data.id;
  const srcTest = await api(`/api/sources/${sourceId}/test`, { method: 'POST' });
  assert.strictEqual(srcTest.status, 200);
  assert.strictEqual(srcTest.data.ok, true, 'source test must pass');

  // Secrets at rest: create a pg source with password hunter2, inspect raw row.
  const pgRes = await api('/api/sources', {
    method: 'POST',
    body: { name: 'PG Secret Probe', engine: 'postgres', host: 'localhost', port: 5432, database: 'x', username: 'u', password: 'hunter2' }
  });
  assert.strictEqual(pgRes.status, 201);
  const rawDb = new Database(DB_PATH, { readonly: true });
  const pgRow = rawDb.prepare('SELECT * FROM sources WHERE id = ?').get(pgRes.data.id);
  assert.ok(pgRow.password_enc && pgRow.password_enc.length > 0, 'password must be stored');
  assert.ok(!JSON.stringify(pgRow).includes('hunter2'), 'password must NOT be stored in plaintext');
  assert.ok(pgRow.password_enc.startsWith('enc:v1:'), 'password must use the enc:v1 envelope');
  assert.ok(!JSON.stringify(srcRes.data).includes('password_enc'), 'API must not leak password_enc');
  console.log('   password_enc =', pgRow.password_enc.slice(0, 24) + '…');

  console.log('4. Job create (gzip + AES + keep_last 2, cron 0 3 * * *)');
  const jobRes = await api('/api/jobs', {
    method: 'POST',
    body: {
      name: 'Smoke Backup',
      source_id: sourceId,
      destination_id: destId,
      cron_expr: '0 3 * * *',
      compress: true,
      encrypt_mode: 'aes',
      passphrase: PASSPHRASE,
      keep_last: 2
    }
  });
  assert.strictEqual(jobRes.status, 201, 'job create must 201');
  const jobId = jobRes.data.id;
  assert.ok(jobRes.data.next_run_at, 'next_run_at must be populated');
  assert.ok(new Date(jobRes.data.next_run_at) > new Date(), 'next_run_at must be in the future');
  console.log('   next_run_at =', jobRes.data.next_run_at);

  console.log('5. Run now → artifact lands on destination with correct size/sha256/name');
  const run1 = await runJobAndWait(jobId, 'ok', 0);
  assert.match(
    run1.artifact_name,
    /^Smoke-Backup_sqlite_\d{4}-\d{2}-\d{2}_\d{6}\.dump\.gz\.enc$/,
    `artifact name pattern (got ${run1.artifact_name})`
  );
  const artifactPath = path.join(destDir, run1.artifact_name);
  assert.ok(fs.existsSync(artifactPath), 'artifact file must exist in destination dir');
  const artifactBytes = fs.readFileSync(artifactPath);
  assert.ok(run1.size_bytes > 0, 'size_bytes must be > 0');
  assert.strictEqual(run1.size_bytes, artifactBytes.length, 'size_bytes must match actual file size');
  const sha = crypto.createHash('sha256').update(artifactBytes).digest('hex');
  assert.strictEqual(run1.sha256, sha, 'recorded sha256 must match recomputed file hash');
  console.log(`   ${run1.artifact_name} (${run1.size_bytes} bytes, sha256 ${sha.slice(0, 12)}…)`);

  console.log('6. Integrity round-trip: decrypt (VK1) → gunzip → open → 50 rows');
  const gz = decryptVK1(artifactBytes, PASSPHRASE);
  const plain = zlib.gunzipSync(gz);
  const restoredPath = path.join(workDir, 'restored.db');
  fs.writeFileSync(restoredPath, plain);
  const restored = new Database(restoredPath, { readonly: true });
  const count = restored.prepare('SELECT count(*) AS n FROM customers').get().n;
  restored.close();
  assert.strictEqual(count, 50, 'restored database must contain all 50 rows');
  console.log('   restorable backup confirmed: 50/50 rows');

  console.log('7. Retention: 3 runs, keep_last 2 → 2 artifacts, oldest pruned=1');
  await new Promise((r) => setTimeout(r, 1100)); // distinct per-second timestamps
  await runJobAndWait(jobId, 'ok', 1);
  await new Promise((r) => setTimeout(r, 1100));
  await runJobAndWait(jobId, 'ok', 2);
  const artifactsOnDisk = fs.readdirSync(destDir).filter((f) => f.startsWith('Smoke-Backup_'));
  assert.strictEqual(artifactsOnDisk.length, 2, `exactly 2 artifacts must remain, found ${artifactsOnDisk.length}`);
  assert.ok(!artifactsOnDisk.includes(run1.artifact_name), 'oldest artifact must be deleted');
  const prunedDb = new Database(DB_PATH, { readonly: true }); // fresh connection sees latest WAL state
  const prunedFresh = prunedDb.prepare('SELECT pruned FROM runs WHERE id = ?').get(run1.id);
  prunedDb.close();
  assert.strictEqual(prunedFresh.pruned, 1, 'oldest run must be marked pruned=1');
  console.log('   remaining:', artifactsOnDisk.join(', '));

  console.log('8. Failure path: broken source → failed run + webhook alert');
  const badSrc = await api('/api/sources', {
    method: 'POST',
    body: { name: 'Broken Fixture', engine: 'sqlite', sqlite_path: path.join(workDir, 'does-not-exist.db') }
  });
  const badJob = await api('/api/jobs', {
    method: 'POST',
    body: {
      name: 'Smoke Failing',
      source_id: badSrc.data.id,
      destination_id: destId,
      cron_expr: '0 4 * * *',
      compress: true,
      encrypt_mode: 'none',
      alert_webhook_url: `http://127.0.0.1:${WEBHOOK_PORT}/hook`
    }
  });
  assert.strictEqual(badJob.status, 201);
  const failedRun = await runJobAndWait(badJob.data.id, 'failed', 0);
  assert.ok(failedRun.error && failedRun.error.length > 0, 'failed run must record an error');
  await waitFor(() => webhookHits.length > 0, 'webhook alert delivery');
  const hook = JSON.parse(webhookHits[0]);
  assert.strictEqual(hook.status, 'failed', 'webhook payload status must be failed');
  assert.strictEqual(hook.job, 'Smoke Failing', 'webhook payload must contain the job name');
  assert.ok(webhookHits[0].includes('"status":"failed"'), 'raw webhook JSON must contain "status":"failed"');
  console.log('   failed run error:', failedRun.error.slice(0, 80));
  console.log('   webhook received:', webhookHits[0].slice(0, 100) + '…');

  console.log('9. Restore-commands endpoint');
  const latestRuns = await api(`/api/jobs/${jobId}/runs`);
  const latestOk = latestRuns.data.find((r) => r.status === 'ok');
  const rc = await fetch(`${BASE}/api/runs/${latestOk.id}/restore-commands`, { headers: { Cookie: cookie } });
  assert.strictEqual(rc.status, 200, 'restore-commands must 200');
  const rcText = await rc.text();
  assert.ok(rcText.includes('gunzip'), 'restore commands must include gunzip');
  assert.ok(rcText.includes(latestOk.artifact_name), 'restore commands must reference the artifact name');
  assert.ok(rcText.includes('vk-decrypt'), 'restore commands must include the decrypt step');

  rawDb.close();
  console.log('\nSMOKE TEST PASSED ✔  (auth, tools, encrypted secrets, backup pipeline,');
  console.log('  restorable AES+gzip artifact, retention pruning, failure webhook, restore helper)');
}

main()
  .then(() => cleanup(0))
  .catch((err) => {
    console.error('\nSMOKE TEST FAILED ✖');
    console.error(err);
    cleanup(1);
  });

function cleanup(code) {
  // Kill ONLY the children this test spawned — never any other node process.
  try { serverProc?.kill(); } catch { /* ignore */ }
  try { webhookServer?.close(); } catch { /* ignore */ }
  setTimeout(() => {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
    process.exit(code);
  }, 400);
}
