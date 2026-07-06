import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Play, CalendarClock, Database, ArrowRight, Loader2 } from 'lucide-react';
import { api, fmtBytes, fmtDate, timeUntil } from '../api.js';
import { Card, Button, StatusBadge, Sparkline, EmptyState, WarnBanner } from '../components.jsx';

const ENGINE_LABEL = { postgres: 'PostgreSQL', mysql: 'MySQL', sqlite: 'SQLite', mongo: 'MongoDB' };
const ENGINE_TOOL = { postgres: 'pg_dump', mysql: 'mysqldump', mongo: 'mongodump' };

export default function Dashboard({ onOpenJob, goTo }) {
  const [jobs, setJobs] = useState(null);
  const [tools, setTools] = useState(null);
  const [running, setRunning] = useState({});

  const load = () => api('/api/jobs').then(setJobs).catch(() => {});
  useEffect(() => {
    load();
    api('/api/tools').then(setTools).catch(() => {});
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const runNow = async (id) => {
    setRunning((r) => ({ ...r, [id]: true }));
    try {
      await api(`/api/jobs/${id}/run`, { method: 'POST', body: {} });
      setTimeout(load, 600);
    } catch { /* surfaced by status */ }
    setTimeout(() => setRunning((r) => ({ ...r, [id]: false })), 1500);
  };

  const missingTools = tools
    ? [...new Set((jobs || []).map((j) => ENGINE_TOOL[j.engine]).filter((t) => t && !tools[t]?.available))]
    : [];

  return (
    <div>
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Dashboard</h1>
          <p className="text-sm text-zinc-500">Every job, its last run, and what happens next.</p>
        </div>
        <Button onClick={() => goTo('jobs')}>
          <CalendarClock size={15} /> Manage jobs
        </Button>
      </header>

      {missingTools.length > 0 && (
        <div className="mb-5">
          <WarnBanner>
            Missing CLI tools for some of your jobs: <b>{missingTools.join(', ')}</b>.{' '}
            <span className="text-amber-300/80">
              {missingTools.map((t) => tools[t]?.hint).filter(Boolean)[0]}
            </span>
          </WarnBanner>
        </div>
      )}

      {jobs === null ? (
        <div className="py-20 flex justify-center text-zinc-600"><Loader2 className="animate-spin" /></div>
      ) : jobs.length === 0 ? (
        <Card>
          <EmptyState
            icon={Database}
            title="No backup jobs yet"
            subtitle="Add a source, pick a destination, set a schedule — and stop worrying about losing data."
            action={
              <Button onClick={() => goTo('jobs')}>
                Create your first job <ArrowRight size={14} />
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {jobs.map((job, i) => {
            const status = job.running ? 'running' : !job.enabled ? 'paused' : job.last_run?.status || 'never';
            return (
              <motion.div key={job.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <Card className="p-4 hover:border-zinc-700 transition-colors cursor-pointer" >
                  <div onClick={() => onOpenJob(job.id)}>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="font-medium text-zinc-100">{job.name}</div>
                        <div className="text-xs text-zinc-500">
                          {ENGINE_LABEL[job.engine] || job.engine} · {job.source_name} → {job.destination_name}
                        </div>
                      </div>
                      <StatusBadge status={status} />
                    </div>
                    <div className="flex items-end justify-between">
                      <div className="text-xs text-zinc-500 space-y-0.5">
                        <div>
                          Last: <span className="text-zinc-300">{job.last_run ? `${fmtDate(job.last_run.started_at)} · ${fmtBytes(job.last_run.size_bytes)}` : 'never'}</span>
                        </div>
                        <div>
                          Next: <span className="text-zinc-300">{job.enabled ? `${timeUntil(job.next_run_at)}` : 'paused'}</span>
                        </div>
                        {job.last_run?.status === 'failed' && (
                          <div className="text-red-400 max-w-[260px] truncate" title={job.last_run.error}>{job.last_run.error}</div>
                        )}
                      </div>
                      <Sparkline points={job.spark} />
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-zinc-800/80 flex justify-between items-center">
                    <span className="text-[11px] text-zinc-600 font-mono">{job.cron_expr}</span>
                    <Button
                      variant="secondary"
                      onClick={(e) => { e.stopPropagation(); runNow(job.id); }}
                      disabled={job.running || running[job.id]}
                      className="!py-1 !px-2.5 text-xs"
                    >
                      <Play size={12} /> Run now
                    </Button>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
