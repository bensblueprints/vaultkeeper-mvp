import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { getDb, getSetting, setSetting } from './db.js';
import { COOKIE_NAME, checkPassword, createSession, destroySession, requireAuth, isAuthed } from './auth.js';
import { encryptSecret, decryptSecret, decryptVK1File } from './crypto.js';
import { toolCheck, testSource } from './engines.js';
import { createAdapter, destinationConfig } from './destinations.js';
import { runJob, isJobRunning, cancelRun } from './runner.js';
import { computeNextRun, previewRuns } from './scheduler.js';
import { sendAlerts } from './alerts.js';
import { restoreCommands } from './restore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ENGINES = ['postgres', 'mysql', 'sqlite', 'mongo'];
const DEST_TYPES = ['local', 's3', 'ftp'];
const DEST_SECRET_FIELDS = ['secretAccessKey', 'pass'];

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createApp() {
  const db = getDb();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // Apply persisted tmp dir setting
  const tmpSetting = getSetting('tmp_dir');
  if (tmpSetting && !process.env.BACKUP_TMP_DIR) process.env.BACKUP_TMP_DIR = tmpSetting;

  /* ---------- auth / meta ---------- */

  app.get('/api/health', (req, res) => res.json({ ok: true, app: 'vaultkeeper', version: '1.0.0' }));
  app.get('/api/session', (req, res) => res.json({ authed: isAuthed(req) }));

  app.post('/api/login', (req, res) => {
    if (!checkPassword(req.body?.password)) return res.status(401).json({ error: 'Wrong password' });
    const token = createSession();
    res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 });
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    destroySession(req.cookies?.[COOKIE_NAME]);
    res.clearCookie(COOKIE_NAME);
    res.json({ ok: true });
  });

  app.get('/api/tools', requireAuth, (req, res) => res.json(toolCheck()));

  app.get('/api/cron/preview', requireAuth, (req, res) => {
    try {
      res.json({ next: previewRuns(String(req.query.expr || ''), String(req.query.tz || '') || null, 3) });
    } catch (e) {
      res.status(400).json({ error: `Invalid cron expression: ${e.message}` });
    }
  });

  /* ---------- sources ---------- */

  const publicSource = (row) => {
    const { password_enc, ...rest } = row;
    return { ...rest, has_password: !!password_enc };
  };

  app.get('/api/sources', requireAuth, (req, res) => {
    res.json(db.prepare('SELECT * FROM sources ORDER BY id').all().map(publicSource));
  });

  function sourceFields(body, existing = {}) {
    const engine = body.engine ?? existing.engine;
    if (!ENGINES.includes(engine)) throw httpError(400, `engine must be one of ${ENGINES.join(', ')}`);
    if (!String(body.name ?? existing.name ?? '').trim()) throw httpError(400, 'name is required');
    return {
      name: String(body.name ?? existing.name).trim(),
      engine,
      host: String(body.host ?? existing.host ?? ''),
      port: body.port != null && body.port !== '' ? parseInt(body.port, 10) : existing.port ?? null,
      database: String(body.database ?? existing.database ?? ''),
      username: String(body.username ?? existing.username ?? ''),
      password_enc:
        body.password !== undefined && body.password !== ''
          ? encryptSecret(body.password)
          : body.password === '' && body.clear_password
            ? ''
            : existing.password_enc ?? '',
      sqlite_path: String(body.sqlite_path ?? existing.sqlite_path ?? ''),
      extra_flags: String(body.extra_flags ?? existing.extra_flags ?? ''),
      custom_bin_path: String(body.custom_bin_path ?? existing.custom_bin_path ?? '')
    };
  }

  app.post('/api/sources', requireAuth, wrap(async (req, res) => {
    const f = sourceFields(req.body || {});
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO sources (name, engine, host, port, database, username, password_enc, sqlite_path, extra_flags, custom_bin_path)
                VALUES (@name, @engine, @host, @port, @database, @username, @password_enc, @sqlite_path, @extra_flags, @custom_bin_path)`)
      .run(f);
    res.status(201).json(publicSource(db.prepare('SELECT * FROM sources WHERE id = ?').get(lastInsertRowid)));
  }));

  app.put('/api/sources/:id', requireAuth, wrap(async (req, res) => {
    const existing = db.prepare('SELECT * FROM sources WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const f = sourceFields(req.body || {}, existing);
    db.prepare(`UPDATE sources SET name=@name, engine=@engine, host=@host, port=@port, database=@database,
                username=@username, password_enc=@password_enc, sqlite_path=@sqlite_path,
                extra_flags=@extra_flags, custom_bin_path=@custom_bin_path WHERE id=@id`)
      .run({ ...f, id: existing.id });
    res.json(publicSource(db.prepare('SELECT * FROM sources WHERE id = ?').get(existing.id)));
  }));

  app.delete('/api/sources/:id', requireAuth, (req, res) => {
    const used = db.prepare('SELECT count(*) AS n FROM jobs WHERE source_id = ?').get(req.params.id);
    if (used.n > 0) return res.status(409).json({ error: `Source is used by ${used.n} job(s)` });
    db.prepare('DELETE FROM sources WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/sources/:id/test', requireAuth, wrap(async (req, res) => {
    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(req.params.id);
    if (!source) return res.status(404).json({ error: 'Not found' });
    try {
      res.json(await testSource(source));
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e.message || e) });
    }
  }));

  /* ---------- destinations ---------- */

  const publicDest = (row) => {
    const config = destinationConfig(row);
    const masked = { ...config };
    for (const k of DEST_SECRET_FIELDS) {
      if (masked[k]) masked[k] = '';
    }
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      config: masked,
      has_secrets: DEST_SECRET_FIELDS.some((k) => !!config[k]),
      created_at: row.created_at
    };
  };

  function destFields(body, existing = null) {
    const type = body.type ?? existing?.type;
    if (!DEST_TYPES.includes(type)) throw httpError(400, `type must be one of ${DEST_TYPES.join(', ')}`);
    if (!String(body.name ?? existing?.name ?? '').trim()) throw httpError(400, 'name is required');
    const prev = existing ? destinationConfig(existing) : {};
    const config = { ...(body.config || {}) };
    for (const k of DEST_SECRET_FIELDS) {
      if ((config[k] === '' || config[k] === undefined) && prev[k]) config[k] = prev[k]; // keep unchanged secrets
    }
    return { name: String(body.name ?? existing.name).trim(), type, config_enc: encryptSecret(JSON.stringify(config)) };
  }

  app.get('/api/destinations', requireAuth, (req, res) => {
    res.json(db.prepare('SELECT * FROM destinations ORDER BY id').all().map(publicDest));
  });

  app.post('/api/destinations', requireAuth, wrap(async (req, res) => {
    const f = destFields(req.body || {});
    const { lastInsertRowid } = db
      .prepare('INSERT INTO destinations (name, type, config_enc) VALUES (@name, @type, @config_enc)')
      .run(f);
    res.status(201).json(publicDest(db.prepare('SELECT * FROM destinations WHERE id = ?').get(lastInsertRowid)));
  }));

  app.put('/api/destinations/:id', requireAuth, wrap(async (req, res) => {
    const existing = db.prepare('SELECT * FROM destinations WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const f = destFields(req.body || {}, existing);
    db.prepare('UPDATE destinations SET name=@name, type=@type, config_enc=@config_enc WHERE id=@id').run({ ...f, id: existing.id });
    res.json(publicDest(db.prepare('SELECT * FROM destinations WHERE id = ?').get(existing.id)));
  }));

  app.delete('/api/destinations/:id', requireAuth, (req, res) => {
    const used = db.prepare('SELECT count(*) AS n FROM jobs WHERE destination_id = ?').get(req.params.id);
    if (used.n > 0) return res.status(409).json({ error: `Destination is used by ${used.n} job(s)` });
    db.prepare('DELETE FROM destinations WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/destinations/:id/test', requireAuth, wrap(async (req, res) => {
    const dest = db.prepare('SELECT * FROM destinations WHERE id = ?').get(req.params.id);
    if (!dest) return res.status(404).json({ error: 'Not found' });
    try {
      res.json(await createAdapter(dest).test());
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e.message || e) });
    }
  }));

  /* ---------- jobs ---------- */

  const publicJob = (row) => {
    const { passphrase_enc, ...rest } = row;
    return { ...rest, has_passphrase: !!passphrase_enc };
  };

  function jobFields(body, existing = {}) {
    const name = String(body.name ?? existing.name ?? '').trim();
    if (!name) throw httpError(400, 'name is required');
    const source_id = parseInt(body.source_id ?? existing.source_id, 10);
    const destination_id = parseInt(body.destination_id ?? existing.destination_id, 10);
    if (!db.prepare('SELECT 1 FROM sources WHERE id = ?').get(source_id)) throw httpError(400, 'source_id does not exist');
    if (!db.prepare('SELECT 1 FROM destinations WHERE id = ?').get(destination_id)) throw httpError(400, 'destination_id does not exist');
    const cron_expr = String(body.cron_expr ?? existing.cron_expr ?? '0 3 * * *').trim();
    const tz = String(body.tz ?? existing.tz ?? '');
    try {
      computeNextRun(cron_expr, tz || null);
    } catch (e) {
      throw httpError(400, `Invalid cron expression: ${e.message}`);
    }
    const encrypt_mode = body.encrypt_mode ?? existing.encrypt_mode ?? 'none';
    if (!['none', 'age', 'aes'].includes(encrypt_mode)) throw httpError(400, 'encrypt_mode must be none|age|aes');
    const passphrase_enc =
      body.passphrase !== undefined && body.passphrase !== ''
        ? encryptSecret(body.passphrase)
        : existing.passphrase_enc ?? '';
    if (encrypt_mode === 'aes' && !passphrase_enc) throw httpError(400, 'aes encryption requires a passphrase');
    if (encrypt_mode === 'age' && !String(body.age_recipient ?? existing.age_recipient ?? '').trim())
      throw httpError(400, 'age encryption requires a recipient public key');
    const intOrNull = (v, prev) => {
      if (v === undefined) return prev ?? null;
      if (v === null || v === '') return null;
      return parseInt(v, 10) || null;
    };
    return {
      name,
      source_id,
      destination_id,
      cron_expr,
      tz,
      compress: body.compress !== undefined ? (body.compress ? 1 : 0) : existing.compress ?? 1,
      encrypt_mode,
      age_recipient: String(body.age_recipient ?? existing.age_recipient ?? ''),
      passphrase_enc,
      keep_last: intOrNull(body.keep_last, existing.keep_last),
      keep_daily_days: intOrNull(body.keep_daily_days, existing.keep_daily_days),
      keep_weekly_weeks: intOrNull(body.keep_weekly_weeks, existing.keep_weekly_weeks),
      alert_webhook_url: String(body.alert_webhook_url ?? existing.alert_webhook_url ?? ''),
      alert_email: String(body.alert_email ?? existing.alert_email ?? ''),
      alert_on_success: body.alert_on_success !== undefined ? (body.alert_on_success ? 1 : 0) : existing.alert_on_success ?? 0,
      enabled: body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled ?? 1
    };
  }

  const enrichJob = (job) => {
    const lastRun = db.prepare('SELECT * FROM runs WHERE job_id = ? ORDER BY id DESC LIMIT 1').get(job.id);
    const spark = db
      .prepare("SELECT size_bytes FROM runs WHERE job_id = ? AND status = 'ok' ORDER BY id DESC LIMIT 14")
      .all(job.id)
      .map((r) => r.size_bytes)
      .reverse();
    const source = db.prepare('SELECT name, engine FROM sources WHERE id = ?').get(job.source_id);
    const dest = db.prepare('SELECT name, type FROM destinations WHERE id = ?').get(job.destination_id);
    return {
      ...publicJob(job),
      source_name: source?.name,
      engine: source?.engine,
      destination_name: dest?.name,
      destination_type: dest?.type,
      running: isJobRunning(job.id),
      last_run: lastRun
        ? {
            id: lastRun.id,
            status: lastRun.status,
            started_at: lastRun.started_at,
            finished_at: lastRun.finished_at,
            size_bytes: lastRun.size_bytes,
            duration_ms: lastRun.duration_ms,
            error: lastRun.error
          }
        : null,
      spark
    };
  };

  app.get('/api/jobs', requireAuth, (req, res) => {
    res.json(db.prepare('SELECT * FROM jobs ORDER BY id').all().map(enrichJob));
  });

  app.post('/api/jobs', requireAuth, wrap(async (req, res) => {
    const f = jobFields(req.body || {});
    const next_run_at = f.enabled ? computeNextRun(f.cron_expr, f.tz || null) : null;
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO jobs (name, source_id, destination_id, cron_expr, tz, compress, encrypt_mode, age_recipient,
                passphrase_enc, keep_last, keep_daily_days, keep_weekly_weeks, alert_webhook_url, alert_email,
                alert_on_success, enabled, next_run_at)
                VALUES (@name, @source_id, @destination_id, @cron_expr, @tz, @compress, @encrypt_mode, @age_recipient,
                @passphrase_enc, @keep_last, @keep_daily_days, @keep_weekly_weeks, @alert_webhook_url, @alert_email,
                @alert_on_success, @enabled, @next_run_at)`)
      .run({ ...f, next_run_at });
    res.status(201).json(enrichJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(lastInsertRowid)));
  }));

  app.get('/api/jobs/:id', requireAuth, (req, res) => {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    res.json(enrichJob(job));
  });

  app.put('/api/jobs/:id', requireAuth, wrap(async (req, res) => {
    const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const f = jobFields(req.body || {}, existing);
    const next_run_at = f.enabled ? computeNextRun(f.cron_expr, f.tz || null) : null;
    db.prepare(`UPDATE jobs SET name=@name, source_id=@source_id, destination_id=@destination_id, cron_expr=@cron_expr,
                tz=@tz, compress=@compress, encrypt_mode=@encrypt_mode, age_recipient=@age_recipient,
                passphrase_enc=@passphrase_enc, keep_last=@keep_last, keep_daily_days=@keep_daily_days,
                keep_weekly_weeks=@keep_weekly_weeks, alert_webhook_url=@alert_webhook_url, alert_email=@alert_email,
                alert_on_success=@alert_on_success, enabled=@enabled, next_run_at=@next_run_at WHERE id=@id`)
      .run({ ...f, next_run_at, id: existing.id });
    res.json(enrichJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(existing.id)));
  }));

  app.delete('/api/jobs/:id', requireAuth, (req, res) => {
    db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
    db.prepare('DELETE FROM runs WHERE job_id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/jobs/:id/toggle', requireAuth, (req, res) => {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    const enabled = job.enabled ? 0 : 1;
    const next_run_at = enabled ? computeNextRun(job.cron_expr, job.tz || null) : null;
    db.prepare('UPDATE jobs SET enabled = ?, next_run_at = ? WHERE id = ?').run(enabled, next_run_at, job.id);
    res.json(enrichJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id)));
  });

  app.post('/api/jobs/:id/run', requireAuth, (req, res) => {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    if (isJobRunning(job.id)) return res.status(409).json({ error: 'Job is already running' });
    runJob(job.id, { trigger: 'manual' }).catch((e) => console.error(`[run] job ${job.id}:`, e.message));
    res.json({ ok: true, started: true });
  });

  app.post('/api/jobs/:id/test-alert', requireAuth, wrap(async (req, res) => {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    if (!job.alert_webhook_url && !job.alert_email)
      return res.status(400).json({ error: 'Job has no alert channels configured' });
    try {
      await sendAlerts(job, { status: 'test', error: null });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e.message || e) });
    }
  }));

  app.get('/api/jobs/:id/runs', requireAuth, (req, res) => {
    res.json(db.prepare('SELECT * FROM runs WHERE job_id = ? ORDER BY id DESC LIMIT 200').all(req.params.id));
  });

  /* ---------- runs ---------- */

  const runContext = (id) => {
    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
    if (!run) return null;
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(run.job_id);
    const source = job && db.prepare('SELECT * FROM sources WHERE id = ?').get(job.source_id);
    const dest = job && db.prepare('SELECT * FROM destinations WHERE id = ?').get(job.destination_id);
    return { run, job, source, dest };
  };

  app.get('/api/runs/:id', requireAuth, (req, res) => {
    const ctx = runContext(req.params.id);
    if (!ctx) return res.status(404).json({ error: 'Not found' });
    res.json(ctx.run);
  });

  app.post('/api/runs/:id/cancel', requireAuth, (req, res) => {
    res.json({ ok: cancelRun(req.params.id) });
  });

  app.get('/api/runs/:id/restore-commands', requireAuth, (req, res) => {
    const ctx = runContext(req.params.id);
    if (!ctx || !ctx.run.artifact_name) return res.status(404).json({ error: 'Run or artifact not found' });
    if (!ctx.job || !ctx.source || !ctx.dest) return res.status(410).json({ error: 'Job, source or destination was deleted' });
    res.type('text/plain').send(
      restoreCommands({ ...ctx, destConfig: destinationConfig(ctx.dest) })
    );
  });

  app.get('/api/runs/:id/download', requireAuth, wrap(async (req, res) => {
    const ctx = runContext(req.params.id);
    if (!ctx || !ctx.run.artifact_name) return res.status(404).json({ error: 'Run or artifact not found' });
    if (!ctx.dest) return res.status(410).json({ error: 'Destination was deleted' });
    const decrypt = req.query.decrypt === '1' && ctx.job?.encrypt_mode === 'aes';
    const staging = path.join(process.env.BACKUP_TMP_DIR || path.join(os.tmpdir(), 'vaultkeeper'), `dl-${Date.now()}-${ctx.run.artifact_name}`);
    fs.mkdirSync(path.dirname(staging), { recursive: true });
    try {
      await createAdapter(ctx.dest).downloadTo(ctx.run.artifact_name, staging);
      if (decrypt) {
        const outName = ctx.run.artifact_name.replace(/\.enc$/, '');
        res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
        await decryptVK1File(staging, res, decryptSecret(ctx.job.passphrase_enc));
      } else {
        await new Promise((resolve, reject) =>
          res.download(staging, ctx.run.artifact_name, (err) => (err ? reject(err) : resolve()))
        );
      }
    } finally {
      fs.rmSync(staging, { force: true });
    }
  }));

  /* ---------- settings ---------- */

  const SETTING_KEYS = ['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_from', 'tmp_dir'];

  app.get('/api/settings', requireAuth, (req, res) => {
    const out = {};
    for (const k of SETTING_KEYS) out[k] = getSetting(k);
    out.smtp_pass_set = !!getSetting('smtp_pass');
    res.json(out);
  });

  app.put('/api/settings', requireAuth, (req, res) => {
    const body = req.body || {};
    for (const k of SETTING_KEYS) {
      if (body[k] !== undefined) setSetting(k, body[k]);
    }
    if (body.smtp_pass !== undefined && body.smtp_pass !== '') setSetting('smtp_pass', encryptSecret(body.smtp_pass));
    if (body.tmp_dir !== undefined) process.env.BACKUP_TMP_DIR = body.tmp_dir || '';
    res.json({ ok: true });
  });

  /* ---------- static frontend ---------- */

  const dist = path.join(__dirname, '..', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // error handler
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || 500;
    if (status === 500) console.error('[api]', err);
    res.status(status).json({ error: String(err.message || err) });
  });

  return app;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
