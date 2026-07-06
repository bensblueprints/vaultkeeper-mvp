// The backup runner: dump → gzip → encrypt → destination, streamed via
// pipeline() (temp-file staging for the upload step), then retention pruning.
// Child processes are tracked per run — cancel/cleanup ONLY ever touches PIDs
// we spawned ourselves.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { getDb } from './db.js';
import { startDump } from './engines.js';
import { createAdapter } from './destinations.js';
import { decryptSecret, writeVK1File, sha256File } from './crypto.js';
import { sendAlerts } from './alerts.js';

const locks = new Set(); // job ids currently running
const runChildren = new Map(); // run id -> Set of spawned child processes

export function isJobRunning(jobId) {
  return locks.has(jobId);
}

export function jobSlug(name) {
  return String(name).trim().replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'job';
}

export function artifactExt(job) {
  let ext = '.dump';
  if (job.compress) ext += '.gz';
  if (job.encrypt_mode === 'age') ext += '.age';
  else if (job.encrypt_mode === 'aes') ext += '.enc';
  return ext;
}

function stamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/** `{job}_{engine}_{YYYY-MM-DD_HHmmss}.dump.gz[.age|.enc]` — bumps the
 *  timestamp forward a second on collision so names stay unique per job. */
function buildArtifactName(db, job, engine) {
  const slug = jobSlug(job.name);
  const ext = artifactExt(job);
  const when = new Date();
  for (let i = 0; i < 3600; i++) {
    const name = `${slug}_${engine}_${stamp(when)}${ext}`;
    const clash = db.prepare('SELECT 1 FROM runs WHERE job_id = ? AND artifact_name = ?').get(job.id, name);
    if (!clash) return name;
    when.setSeconds(when.getSeconds() + 1);
  }
  throw new Error('Could not generate a unique artifact name');
}

function tmpDir() {
  const dir = process.env.BACKUP_TMP_DIR || path.join(os.tmpdir(), 'vaultkeeper');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Execute one backup run for a job. Returns the run id immediately-created;
 *  resolves when the run finished (ok or failed). */
export async function runJob(jobId, { trigger = 'manual' } = {}) {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (locks.has(jobId)) {
    const err = new Error('Job is already running');
    err.code = 'LOCKED';
    throw err;
  }
  locks.add(jobId);

  const started = Date.now();
  const { lastInsertRowid: runId } = db
    .prepare("INSERT INTO runs (job_id, status, started_at) VALUES (?, 'running', ?)")
    .run(jobId, new Date(started).toISOString());
  runChildren.set(runId, new Set());

  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(job.source_id);
  const dest = db.prepare('SELECT * FROM destinations WHERE id = ?').get(job.destination_id);

  let tmpArtifact = null;
  let dump = null;
  try {
    if (!source) throw new Error('Source no longer exists');
    if (!dest) throw new Error('Destination no longer exists');

    const artifactName = buildArtifactName(db, job, source.engine);
    tmpArtifact = path.join(tmpDir(), `run-${runId}-${artifactName}`);

    dump = await startDump(source);
    if (dump.child) runChildren.get(runId)?.add(dump.child);

    const transforms = job.compress ? [zlib.createGzip()] : [];
    if (job.encrypt_mode === 'aes') {
      const passphrase = decryptSecret(job.passphrase_enc);
      if (!passphrase) throw new Error('Job has encrypt_mode=aes but no passphrase stored');
      await writeVK1File(dump.stream, transforms, tmpArtifact, passphrase);
    } else if (job.encrypt_mode === 'age') {
      if (!job.age_recipient) throw new Error('Job has encrypt_mode=age but no age recipient set');
      await ageEncrypt(dump.stream, transforms, tmpArtifact, job.age_recipient, runId);
    } else {
      await pipeline(dump.stream, ...transforms, fs.createWriteStream(tmpArtifact));
    }
    await dump.done(); // surface non-zero exit from the dump tool

    const size = fs.statSync(tmpArtifact).size;
    if (size === 0) throw new Error('Dump produced an empty artifact');
    // sha256 of the FINAL artifact bytes (post-compress/encrypt) — what restore validates.
    const sha256 = await sha256File(tmpArtifact);

    const adapter = createAdapter(dest);
    await adapter.putFile(tmpArtifact, artifactName);

    const durationMs = Date.now() - started;
    db.prepare(
      "UPDATE runs SET status = 'ok', finished_at = ?, artifact_name = ?, size_bytes = ?, sha256 = ?, duration_ms = ?, stderr_tail = ? WHERE id = ?"
    ).run(new Date().toISOString(), artifactName, size, sha256, durationMs, dump.stderr.text.trim(), runId);

    await pruneRetention(job, source.engine, adapter).catch((e) => {
      console.warn(`[retention] prune failed for job ${job.id}:`, e.message);
    });

    if (job.alert_on_success) {
      await sendAlerts(job, {
        status: 'ok',
        run_id: runId,
        artifact: artifactName,
        size_bytes: size,
        duration_ms: durationMs
      }).catch(() => {});
    }
    return { runId, status: 'ok' };
  } catch (e) {
    const stderrTail = (dump?.stderr?.text || '').trim().slice(-2000);
    db.prepare(
      "UPDATE runs SET status = 'failed', finished_at = ?, duration_ms = ?, error = ?, stderr_tail = ? WHERE id = ?"
    ).run(new Date().toISOString(), Date.now() - started, String(e.message || e), stderrTail, runId);
    await sendAlerts(job, {
      status: 'failed',
      run_id: runId,
      error: String(e.message || e),
      stderr_tail: stderrTail
    }).catch((alertErr) => console.warn('[alerts] delivery failed:', alertErr.message));
    return { runId, status: 'failed', error: String(e.message || e) };
  } finally {
    try { dump?.cleanup(); } catch { /* ignore */ }
    if (tmpArtifact) fs.rmSync(tmpArtifact, { force: true });
    runChildren.delete(runId);
    locks.delete(jobId);
  }
}

async function ageEncrypt(sourceStream, transforms, outPath, recipient, runId) {
  const child = spawn('age', ['-r', recipient, '-o', outPath], {
    stdio: ['pipe', 'ignore', 'pipe'],
    windowsHide: true
  });
  runChildren.get(runId)?.add(child);
  let stderr = '';
  child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
  const exited = new Promise((resolve, reject) => {
    child.on('error', (e) => reject(new Error(`Failed to start age: ${e.message} — is age installed?`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`age exited ${code}: ${stderr.trim()}`))));
  });
  await pipeline(sourceStream, ...transforms, child.stdin);
  await exited;
}

/** Cancel a running run — kills ONLY the child PIDs this run spawned. */
export function cancelRun(runId) {
  const children = runChildren.get(Number(runId));
  if (!children) return false;
  for (const child of children) {
    try { child.kill(); } catch { /* ignore */ }
  }
  return true;
}

/* ---------------- retention (GFS-lite) ---------------- */

function parseStamp(name) {
  const m = name.match(/_(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})\./);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

function isoWeekKey(ts) {
  const d = new Date(ts);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + 3); // Thursday of this week
  const year = d.getFullYear();
  const firstThu = new Date(year, 0, 4);
  const week = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getDay() + 6) % 7)) / 7);
  return `${year}-W${week}`;
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Keep set = union of:
 *  - the newest `keep_last` artifacts
 *  - the newest artifact per calendar day for the last `keep_daily_days` days
 *  - the newest artifact per ISO week for the last `keep_weekly_weeks` weeks
 * Everything else for this job is deleted from the destination and the run
 * rows are marked pruned=1. No policy configured -> keep everything.
 */
export async function pruneRetention(job, engine, adapter) {
  const hasPolicy = job.keep_last > 0 || job.keep_daily_days > 0 || job.keep_weekly_weeks > 0;
  if (!hasPolicy) return { deleted: [] };

  const prefix = `${jobSlug(job.name)}_${engine}_`;
  const artifacts = (await adapter.list(prefix))
    .map((a) => ({ ...a, ts: parseStamp(a.name) ?? a.mtime }))
    .sort((a, b) => b.ts - a.ts); // newest first

  const keep = new Set();
  if (job.keep_last > 0) {
    for (const a of artifacts.slice(0, job.keep_last)) keep.add(a.name);
  }
  const now = Date.now();
  if (job.keep_daily_days > 0) {
    const cutoff = now - job.keep_daily_days * 86400000;
    const byDay = new Map();
    for (const a of artifacts) {
      if (a.ts < cutoff) continue;
      const k = dayKey(a.ts);
      if (!byDay.has(k)) byDay.set(k, a); // artifacts sorted newest-first
    }
    for (const a of byDay.values()) keep.add(a.name);
  }
  if (job.keep_weekly_weeks > 0) {
    const cutoff = now - job.keep_weekly_weeks * 7 * 86400000;
    const byWeek = new Map();
    for (const a of artifacts) {
      if (a.ts < cutoff) continue;
      const k = isoWeekKey(a.ts);
      if (!byWeek.has(k)) byWeek.set(k, a);
    }
    for (const a of byWeek.values()) keep.add(a.name);
  }

  const db = getDb();
  const deleted = [];
  for (const a of artifacts) {
    if (keep.has(a.name)) continue;
    await adapter.remove(a.name);
    db.prepare('UPDATE runs SET pruned = 1 WHERE job_id = ? AND artifact_name = ?').run(job.id, a.name);
    deleted.push(a.name);
  }
  return { deleted };
}
