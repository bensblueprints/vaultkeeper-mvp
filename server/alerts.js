// Failure (and optional success) alerts: webhook POST + SMTP email.
import { getSetting } from './db.js';
import { decryptSecret } from './crypto.js';

function smtpConfig() {
  return {
    host: getSetting('smtp_host', process.env.SMTP_HOST || ''),
    port: parseInt(getSetting('smtp_port', process.env.SMTP_PORT || '587'), 10),
    secure: getSetting('smtp_secure', process.env.SMTP_SECURE || 'false') === 'true',
    user: getSetting('smtp_user', process.env.SMTP_USER || ''),
    pass: decryptSecret(getSetting('smtp_pass', '')) || process.env.SMTP_PASS || '',
    from: getSetting('smtp_from', process.env.SMTP_FROM || 'vaultkeeper@localhost')
  };
}

export async function sendWebhook(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
}

export async function sendEmail(to, subject, text) {
  const cfg = smtpConfig();
  if (!cfg.host) throw new Error('SMTP is not configured (Settings → SMTP or SMTP_* env vars)');
  const { default: nodemailer } = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined
  });
  await transport.sendMail({ from: cfg.from, to, subject, text });
}

/** Fire the per-job alert channels. `info.status` is 'ok'|'failed'|'test'. */
export async function sendAlerts(job, info) {
  const payload = {
    app: 'vaultkeeper',
    job: job.name,
    job_id: job.id,
    status: info.status,
    run_id: info.run_id ?? null,
    artifact: info.artifact ?? null,
    size_bytes: info.size_bytes ?? null,
    duration_ms: info.duration_ms ?? null,
    error: info.error ?? null,
    stderr_tail: info.stderr_tail ?? null,
    timestamp: new Date().toISOString()
  };
  const errors = [];
  if (job.alert_webhook_url) {
    await sendWebhook(job.alert_webhook_url, payload).catch((e) => errors.push(`webhook: ${e.message}`));
  }
  if (job.alert_email) {
    const subject =
      info.status === 'failed'
        ? `[Vaultkeeper] Backup FAILED: ${job.name}`
        : `[Vaultkeeper] Backup ${info.status}: ${job.name}`;
    const lines = [
      `Job: ${job.name}`,
      `Status: ${info.status}`,
      info.artifact ? `Artifact: ${info.artifact}` : null,
      info.size_bytes != null ? `Size: ${info.size_bytes} bytes` : null,
      info.duration_ms != null ? `Duration: ${info.duration_ms} ms` : null,
      info.error ? `Error: ${info.error}` : null,
      info.stderr_tail ? `\n--- dump tool stderr (tail) ---\n${info.stderr_tail}` : null
    ].filter(Boolean);
    await sendEmail(job.alert_email, subject, lines.join('\n')).catch((e) => errors.push(`email: ${e.message}`));
  }
  if (errors.length) throw new Error(errors.join('; '));
}
