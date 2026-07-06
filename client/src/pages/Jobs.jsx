import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Play, Pencil, Trash2, Pause, ChevronLeft, ChevronRight, CalendarClock, TerminalSquare, Download, Copy, BellRing, Check, Loader2 } from 'lucide-react';
import { api, apiText, fmtBytes, fmtDate, fmtDuration, timeUntil } from '../api.js';
import { Card, Button, Modal, Field, Input, Select, Toggle, StatusBadge, EmptyState } from '../components.jsx';

const PRESETS = [
  { label: 'Hourly', expr: '0 * * * *' },
  { label: 'Daily 03:00', expr: '0 3 * * *' },
  { label: 'Weekly Sun 03:00', expr: '0 3 * * 0' },
  { label: 'Custom', expr: null }
];

const blankJob = {
  name: '', source_id: '', destination_id: '', cron_expr: '0 3 * * *', tz: '',
  compress: true, encrypt_mode: 'none', passphrase: '', age_recipient: '',
  keep_last: 7, keep_daily_days: '', keep_weekly_weeks: '',
  alert_webhook_url: '', alert_email: '', alert_on_success: false, enabled: true
};

export default function Jobs({ focusId, clearFocus, goTo }) {
  const [jobs, setJobs] = useState([]);
  const [sources, setSources] = useState([]);
  const [dests, setDests] = useState([]);
  const [wizard, setWizard] = useState(null); // form state
  const [detailId, setDetailId] = useState(focusId || null);

  const load = () => api('/api/jobs').then(setJobs).catch(() => {});
  useEffect(() => {
    load();
    api('/api/sources').then(setSources).catch(() => {});
    api('/api/destinations').then(setDests).catch(() => {});
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (focusId) setDetailId(focusId); }, [focusId]);

  const remove = async (id) => {
    if (!confirm('Delete this job and its run history? Artifacts on the destination are NOT deleted.')) return;
    await api(`/api/jobs/${id}`, { method: 'DELETE' });
    load();
  };

  const detailJob = jobs.find((j) => j.id === detailId);

  if (detailId && detailJob) {
    return <JobDetail job={detailJob} onBack={() => { setDetailId(null); clearFocus(); }} refresh={load} onEdit={() => setWizard(editForm(detailJob))} wizard={wizard} setWizard={setWizard} sources={sources} dests={dests} />;
  }

  return (
    <div>
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Backup Jobs</h1>
          <p className="text-sm text-zinc-500">Source + schedule + encryption + destination + retention.</p>
        </div>
        <Button onClick={() => setWizard({ ...blankJob, step: 0 })} disabled={sources.length === 0 || dests.length === 0}>
          <Plus size={15} /> New job
        </Button>
      </header>

      {(sources.length === 0 || dests.length === 0) && (
        <Card className="mb-4 p-4 text-sm text-zinc-400">
          You need at least one <button className="text-emerald-400 hover:underline" onClick={() => goTo('sources')}>source</button> and one{' '}
          <button className="text-emerald-400 hover:underline" onClick={() => goTo('destinations')}>destination</button> before creating a job.
        </Card>
      )}

      {jobs.length === 0 ? (
        <Card><EmptyState icon={CalendarClock} title="No jobs yet" subtitle="A job ties a source to a destination on a cron schedule with optional compression, encryption and retention." /></Card>
      ) : (
        <Card className="divide-y divide-zinc-800/80">
          {jobs.map((job) => {
            const status = job.running ? 'running' : !job.enabled ? 'paused' : job.last_run?.status || 'never';
            return (
              <div key={job.id} className="flex items-center gap-4 px-4 py-3 hover:bg-zinc-900/50 cursor-pointer" onClick={() => setDetailId(job.id)}>
                <StatusBadge status={status} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-zinc-200">{job.name}</div>
                  <div className="text-xs text-zinc-500 truncate">
                    {job.source_name} → {job.destination_name} · <span className="font-mono">{job.cron_expr}</span>
                    {job.enabled && <> · next {timeUntil(job.next_run_at)}</>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Button variant="secondary" className="!py-1 !px-2.5 text-xs" disabled={job.running}
                    onClick={() => api(`/api/jobs/${job.id}/run`, { method: 'POST', body: {} }).then(() => setTimeout(load, 500))}>
                    <Play size={12} /> Run
                  </Button>
                  <Button variant="ghost" className="!p-2" title={job.enabled ? 'Pause' : 'Resume'}
                    onClick={() => api(`/api/jobs/${job.id}/toggle`, { method: 'POST', body: {} }).then(load)}>
                    {job.enabled ? <Pause size={14} /> : <Play size={14} />}
                  </Button>
                  <Button variant="ghost" className="!p-2" onClick={() => setWizard(editForm(job))}><Pencil size={14} /></Button>
                  <Button variant="ghost" className="!p-2 hover:!text-red-400" onClick={() => remove(job.id)}><Trash2 size={14} /></Button>
                </div>
              </div>
            );
          })}
        </Card>
      )}

      <JobWizard wizard={wizard} setWizard={setWizard} sources={sources} dests={dests} onSaved={load} />
    </div>
  );
}

function editForm(job) {
  return {
    ...blankJob,
    ...Object.fromEntries(Object.entries(job).filter(([k]) => k in blankJob || k === 'id')),
    compress: !!job.compress,
    alert_on_success: !!job.alert_on_success,
    enabled: !!job.enabled,
    keep_last: job.keep_last ?? '',
    keep_daily_days: job.keep_daily_days ?? '',
    keep_weekly_weeks: job.keep_weekly_weeks ?? '',
    passphrase: '',
    has_passphrase: job.has_passphrase,
    step: 0
  };
}

const STEPS = ['Source', 'Schedule', 'Compress & Encrypt', 'Destination & Retention', 'Alerts'];

function JobWizard({ wizard, setWizard, sources, dests, onSaved }) {
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const f = wizard || {};

  useEffect(() => {
    if (!wizard) return;
    setPreview(null);
    const t = setTimeout(() => {
      api(`/api/cron/preview?expr=${encodeURIComponent(f.cron_expr)}&tz=${encodeURIComponent(f.tz || '')}`)
        .then((r) => setPreview({ next: r.next }))
        .catch((e) => setPreview({ error: e.message }));
    }, 300);
    return () => clearTimeout(t);
  }, [wizard && f.cron_expr, wizard && f.tz]);

  if (!wizard) return null;
  const step = f.step ?? 0;
  const set = (patch) => setWizard({ ...f, ...patch });

  const canNext = () => {
    if (step === 0) return f.name.trim() && f.source_id;
    if (step === 1) return preview?.next;
    if (step === 2) return f.encrypt_mode !== 'aes' || f.passphrase || f.has_passphrase;
    if (step === 3) return !!f.destination_id;
    return true;
  };

  const save = async () => {
    setError('');
    try {
      const body = { ...f };
      delete body.step; delete body.id; delete body.has_passphrase;
      body.keep_last = f.keep_last === '' ? null : parseInt(f.keep_last, 10);
      body.keep_daily_days = f.keep_daily_days === '' ? null : parseInt(f.keep_daily_days, 10);
      body.keep_weekly_weeks = f.keep_weekly_weeks === '' ? null : parseInt(f.keep_weekly_weeks, 10);
      if (f.id) await api(`/api/jobs/${f.id}`, { method: 'PUT', body });
      else await api('/api/jobs', { method: 'POST', body });
      setWizard(null);
      onSaved();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Modal open onClose={() => setWizard(null)} title={f.id ? `Edit job: ${f.name}` : 'New backup job'} wide>
      <div className="flex items-center gap-1 mb-5">
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <button onClick={() => i < step && set({ step: i })}
              className={`text-[11px] px-2 py-1 rounded-md whitespace-nowrap ${i === step ? 'bg-emerald-950/80 text-emerald-300 font-medium' : i < step ? 'text-zinc-300 hover:bg-zinc-800' : 'text-zinc-600'}`}>
              {i + 1}. {s}
            </button>
            {i < STEPS.length - 1 && <div className="flex-1 h-px bg-zinc-800 min-w-1" />}
          </React.Fragment>
        ))}
      </div>

      <div className="min-h-[220px] space-y-4">
        {step === 0 && (
          <>
            <Field label="Job name">
              <Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Nightly production backup" autoFocus />
            </Field>
            <Field label="Source">
              <Select value={f.source_id} onChange={(e) => set({ source_id: parseInt(e.target.value, 10) || '' })}>
                <option value="">Select a source…</option>
                {sources.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.engine})</option>)}
              </Select>
            </Field>
          </>
        )}

        {step === 1 && (
          <>
            <div className="flex gap-2 flex-wrap">
              {PRESETS.map((p) => (
                <button key={p.label} onClick={() => p.expr && set({ cron_expr: p.expr })}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${f.cron_expr === p.expr ? 'border-emerald-600 bg-emerald-950/60 text-emerald-300' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Cron expression">
                <Input value={f.cron_expr} onChange={(e) => set({ cron_expr: e.target.value })} className="font-mono" />
              </Field>
              <Field label="Timezone (IANA, optional)" hint="e.g. America/Chicago — server timezone if empty">
                <Input value={f.tz} onChange={(e) => set({ tz: e.target.value })} placeholder="UTC" />
              </Field>
            </div>
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs">
              {preview?.error ? (
                <span className="text-red-400">{preview.error}</span>
              ) : preview?.next ? (
                <>
                  <div className="text-zinc-500 mb-1">Next 3 runs:</div>
                  {preview.next.map((n) => <div key={n} className="text-zinc-300 font-mono">{new Date(n).toLocaleString()}</div>)}
                </>
              ) : (
                <span className="text-zinc-600">computing…</span>
              )}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <Toggle checked={f.compress} onChange={(v) => set({ compress: v })} label="Compress with gzip (recommended)" />
            <Field label="Encryption">
              <Select value={f.encrypt_mode} onChange={(e) => set({ encrypt_mode: e.target.value })}>
                <option value="none">None</option>
                <option value="aes">Built-in AES-256-GCM (passphrase)</option>
                <option value="age">age (requires age binary + recipient key)</option>
              </Select>
            </Field>
            {f.encrypt_mode === 'aes' && (
              <Field label="Passphrase" hint={f.has_passphrase ? 'Leave empty to keep the current passphrase. Losing it means losing the backups.' : 'Key derived via scrypt. Losing the passphrase means losing the backups.'}>
                <Input type="password" value={f.passphrase} onChange={(e) => set({ passphrase: e.target.value })} />
              </Field>
            )}
            {f.encrypt_mode === 'age' && (
              <Field label="age recipient (public key)" hint="age1…  — decrypt with your identity key">
                <Input value={f.age_recipient} onChange={(e) => set({ age_recipient: e.target.value })} placeholder="age1..." className="font-mono" />
              </Field>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <Field label="Destination">
              <Select value={f.destination_id} onChange={(e) => set({ destination_id: parseInt(e.target.value, 10) || '' })}>
                <option value="">Select a destination…</option>
                {dests.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.type})</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Keep last N" hint="Most recent artifacts always kept">
                <Input type="number" min="0" value={f.keep_last} onChange={(e) => set({ keep_last: e.target.value })} placeholder="7" />
              </Field>
              <Field label="Daily for X days" hint="One per day (GFS-lite)">
                <Input type="number" min="0" value={f.keep_daily_days} onChange={(e) => set({ keep_daily_days: e.target.value })} placeholder="14" />
              </Field>
              <Field label="Weekly for Y weeks" hint="One per ISO week">
                <Input type="number" min="0" value={f.keep_weekly_weeks} onChange={(e) => set({ keep_weekly_weeks: e.target.value })} placeholder="8" />
              </Field>
            </div>
            <p className="text-[11px] text-zinc-500">Pruning runs on the destination after each successful backup. Leave all empty to keep everything.</p>
          </>
        )}

        {step === 4 && (
          <>
            <Field label="Webhook URL (POST JSON on failure)" hint="Slack/Discord-compatible; payload includes job, status, error and stderr tail">
              <Input value={f.alert_webhook_url} onChange={(e) => set({ alert_webhook_url: e.target.value })} placeholder="https://hooks.slack.com/…" />
            </Field>
            <Field label="Alert email" hint="Requires SMTP in Settings">
              <Input value={f.alert_email} onChange={(e) => set({ alert_email: e.target.value })} placeholder="you@example.com" />
            </Field>
            <Toggle checked={f.alert_on_success} onChange={(v) => set({ alert_on_success: v })} label="Also alert on success" />
            <Toggle checked={f.enabled} onChange={(v) => set({ enabled: v })} label="Job enabled (scheduled)" />
          </>
        )}
      </div>

      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      <div className="flex justify-between pt-4 mt-2 border-t border-zinc-800">
        <Button variant="secondary" onClick={() => (step === 0 ? setWizard(null) : set({ step: step - 1 }))}>
          <ChevronLeft size={14} /> {step === 0 ? 'Cancel' : 'Back'}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => set({ step: step + 1 })} disabled={!canNext()}>
            Next <ChevronRight size={14} />
          </Button>
        ) : (
          <Button onClick={save} disabled={!canNext()}>
            <Check size={14} /> {f.id ? 'Save job' : 'Create job'}
          </Button>
        )}
      </div>
    </Modal>
  );
}

function JobDetail({ job, onBack, refresh, onEdit, wizard, setWizard, sources, dests }) {
  const [runs, setRuns] = useState([]);
  const [restore, setRestore] = useState(null); // { run, text }
  const [alertResult, setAlertResult] = useState('');

  const loadRuns = () => api(`/api/jobs/${job.id}/runs`).then(setRuns).catch(() => {});
  useEffect(() => {
    loadRuns();
    const t = setInterval(loadRuns, 4000);
    return () => clearInterval(t);
  }, [job.id]);

  const openRestore = async (run) => {
    setRestore({ run, text: null });
    try {
      setRestore({ run, text: await apiText(`/api/runs/${run.id}/restore-commands`) });
    } catch (e) {
      setRestore({ run, text: `Error: ${e.message}` });
    }
  };

  const testAlert = async () => {
    setAlertResult('sending…');
    try {
      await api(`/api/jobs/${job.id}/test-alert`, { method: 'POST', body: {} });
      setAlertResult('Test alert sent ✓');
    } catch (e) {
      setAlertResult(`Failed: ${e.message}`);
    }
    setTimeout(() => setAlertResult(''), 5000);
  };

  const status = job.running ? 'running' : !job.enabled ? 'paused' : job.last_run?.status || 'never';

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-200 mb-4 transition-colors">
        <ChevronLeft size={15} /> All jobs
      </button>
      <header className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-zinc-100">{job.name}</h1>
            <StatusBadge status={status} />
          </div>
          <p className="text-sm text-zinc-500 mt-1">
            {job.source_name} ({job.engine}) → {job.destination_name} · <span className="font-mono">{job.cron_expr}</span>
            {job.enabled && <> · next run {timeUntil(job.next_run_at)}</>}
            {job.compress ? ' · gzip' : ''} {job.encrypt_mode !== 'none' ? `· ${job.encrypt_mode === 'aes' ? 'AES-256-GCM' : 'age'} encrypted` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(job.alert_webhook_url || job.alert_email) && (
            <Button variant="secondary" onClick={testAlert}><BellRing size={14} /> Test alert</Button>
          )}
          <Button variant="secondary" onClick={onEdit}><Pencil size={14} /> Edit</Button>
          <Button disabled={job.running}
            onClick={() => api(`/api/jobs/${job.id}/run`, { method: 'POST', body: {} }).then(() => setTimeout(() => { refresh(); loadRuns(); }, 500))}>
            <Play size={14} /> Run now
          </Button>
        </div>
      </header>
      {alertResult && <p className="text-xs text-zinc-400 mb-3">{alertResult}</p>}

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-500 border-b border-zinc-800">
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Started</th>
              <th className="px-4 py-2.5 font-medium">Artifact</th>
              <th className="px-4 py-2.5 font-medium">Size</th>
              <th className="px-4 py-2.5 font-medium">Duration</th>
              <th className="px-4 py-2.5 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {runs.length === 0 && (
              <tr><td colSpan="6" className="px-4 py-8 text-center text-zinc-600">No runs yet — hit "Run now".</td></tr>
            )}
            {runs.map((r) => (
              <tr key={r.id} className="hover:bg-zinc-900/40">
                <td className="px-4 py-2.5"><StatusBadge status={r.status} />{r.pruned ? <span className="ml-1.5 text-[10px] text-zinc-600">pruned</span> : null}</td>
                <td className="px-4 py-2.5 text-zinc-400 whitespace-nowrap">{fmtDate(r.started_at)}</td>
                <td className="px-4 py-2.5">
                  <span className="font-mono text-xs text-zinc-300 break-all">{r.artifact_name || '—'}</span>
                  {r.error && <div className="text-xs text-red-400 mt-0.5 max-w-md" title={r.stderr_tail}>{r.error}</div>}
                </td>
                <td className="px-4 py-2.5 text-zinc-400 whitespace-nowrap">{r.status === 'ok' ? fmtBytes(r.size_bytes) : '—'}</td>
                <td className="px-4 py-2.5 text-zinc-400 whitespace-nowrap">{fmtDuration(r.duration_ms)}</td>
                <td className="px-4 py-2.5">
                  {r.status === 'ok' && !r.pruned && (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" className="!p-1.5" title="Restore helper" onClick={() => openRestore(r)}>
                        <TerminalSquare size={14} />
                      </Button>
                      <a href={`/api/runs/${r.id}/download${job.encrypt_mode === 'aes' ? '?decrypt=1' : ''}`}
                         className="p-1.5 rounded-lg hover:bg-zinc-800/70 text-zinc-400 hover:text-zinc-200 transition-colors" title="Download artifact">
                        <Download size={14} />
                      </a>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={!!restore} onClose={() => setRestore(null)} title="Restore helper" wide>
        {restore && (
          <div>
            <p className="text-xs text-zinc-500 mb-3">Exact command chain to restore <span className="font-mono text-zinc-300">{restore.run.artifact_name}</span>:</p>
            <div className="relative bg-zinc-950 border border-zinc-800 rounded-lg p-4 max-h-96 overflow-y-auto">
              {restore.text === null ? (
                <Loader2 size={16} className="animate-spin text-zinc-600" />
              ) : (
                <pre className="restore text-zinc-300">{restore.text}</pre>
              )}
              <button
                onClick={() => navigator.clipboard.writeText(restore.text || '')}
                className="absolute top-2 right-2 p-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                title="Copy commands"
              >
                <Copy size={13} />
              </button>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <a href={`/api/runs/${restore.run.id}/download`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors">
                <Download size={14} /> Download artifact
              </a>
              {job.encrypt_mode === 'aes' && (
                <a href={`/api/runs/${restore.run.id}/download?decrypt=1`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors">
                  <Download size={14} /> Download decrypted
                </a>
              )}
            </div>
          </div>
        )}
      </Modal>

      <JobWizard wizard={wizard} setWizard={setWizard} sources={sources} dests={dests} onSaved={refresh} />
    </div>
  );
}
