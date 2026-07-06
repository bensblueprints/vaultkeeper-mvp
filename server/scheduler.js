// In-process scheduler: a light tick loop (default 30s, SCHED_TICK_MS
// override) compares jobs' next_run_at to now. cron-parser computes the next
// occurrence, honoring an optional per-job IANA timezone.
import cronParser from 'cron-parser';
import { getDb } from './db.js';
import { runJob, isJobRunning } from './runner.js';

export function computeNextRun(cronExpr, tz, from = new Date()) {
  const options = { currentDate: from };
  if (tz) options.tz = tz;
  return cronParser.parseExpression(cronExpr, options).next().toISOString();
}

/** Preview the next N occurrences (job wizard "next 3 runs"). */
export function previewRuns(cronExpr, tz, count = 3) {
  const options = { currentDate: new Date() };
  if (tz) options.tz = tz;
  const it = cronParser.parseExpression(cronExpr, options);
  const out = [];
  for (let i = 0; i < count; i++) out.push(it.next().toISOString());
  return out;
}

let timer = null;

export function startScheduler() {
  const tickMs = parseInt(process.env.SCHED_TICK_MS || '30000', 10);
  const db = getDb();

  const tick = () => {
    const nowIso = new Date().toISOString();
    let due;
    try {
      due = db
        .prepare('SELECT * FROM jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?')
        .all(nowIso);
    } catch (e) {
      console.error('[scheduler] tick failed:', e.message);
      return;
    }
    for (const job of due) {
      // Advance next_run_at FIRST so a long backup never double-fires.
      try {
        db.prepare('UPDATE jobs SET next_run_at = ? WHERE id = ?').run(computeNextRun(job.cron_expr, job.tz), job.id);
      } catch (e) {
        console.error(`[scheduler] bad cron for job ${job.id} (${job.cron_expr}):`, e.message);
        db.prepare('UPDATE jobs SET next_run_at = NULL WHERE id = ?').run(job.id);
        continue;
      }
      if (isJobRunning(job.id)) continue; // per-job concurrent-run lock
      runJob(job.id, { trigger: 'schedule' }).catch((e) =>
        console.error(`[scheduler] job ${job.id} run error:`, e.message)
      );
    }
  };

  timer = setInterval(tick, tickMs);
  timer.unref?.();
  console.log(`[scheduler] started (tick ${tickMs}ms)`);
  return timer;
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
