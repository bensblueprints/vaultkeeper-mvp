import React, { useEffect, useState } from 'react';
import { Save, Loader2, Wrench, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../api.js';
import { Card, Button, Field, Input, Toggle } from '../components.jsx';

export default function Settings() {
  const [form, setForm] = useState(null);
  const [tools, setTools] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api('/api/settings').then((s) => setForm({ ...s, smtp_pass: '' })).catch(() => {});
    api('/api/tools').then(setTools).catch(() => {});
  }, []);

  if (!form) return <div className="py-20 flex justify-center text-zinc-600"><Loader2 className="animate-spin" /></div>;

  const set = (patch) => setForm({ ...form, ...patch });
  const save = async () => {
    const body = { ...form };
    delete body.smtp_pass_set;
    if (!body.smtp_pass) delete body.smtp_pass;
    await api('/api/settings', { method: 'PUT', body });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="max-w-2xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-100">Settings</h1>
        <p className="text-sm text-zinc-500">SMTP for email alerts, staging directory, and environment health.</p>
      </header>

      <Card className="p-5 mb-4 space-y-4">
        <h2 className="font-medium text-zinc-200">SMTP (email alerts)</h2>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Host" className="col-span-2">
            <Input value={form.smtp_host} onChange={(e) => set({ smtp_host: e.target.value })} placeholder="smtp.mailgun.org" />
          </Field>
          <Field label="Port">
            <Input type="number" value={form.smtp_port || 587} onChange={(e) => set({ smtp_port: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Username">
            <Input value={form.smtp_user} onChange={(e) => set({ smtp_user: e.target.value })} />
          </Field>
          <Field label="Password" hint={form.smtp_pass_set ? 'Set — leave empty to keep' : 'Stored encrypted'}>
            <Input type="password" value={form.smtp_pass} onChange={(e) => set({ smtp_pass: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4 items-end">
          <Field label="From address">
            <Input value={form.smtp_from} onChange={(e) => set({ smtp_from: e.target.value })} placeholder="vaultkeeper@yourdomain.com" />
          </Field>
          <Toggle checked={form.smtp_secure === 'true'} onChange={(v) => set({ smtp_secure: String(v) })} label="Implicit TLS (port 465)" />
        </div>
      </Card>

      <Card className="p-5 mb-4 space-y-4">
        <h2 className="font-medium text-zinc-200">Staging</h2>
        <Field label="Temp directory" hint="Where dumps are staged before upload. Empty = OS temp dir.">
          <Input value={form.tmp_dir} onChange={(e) => set({ tmp_dir: e.target.value })} placeholder="D:\vaultkeeper-tmp" />
        </Field>
      </Card>

      <Card className="p-5 mb-6">
        <h2 className="font-medium text-zinc-200 flex items-center gap-2 mb-3"><Wrench size={15} /> Engine tools on this machine</h2>
        {!tools ? (
          <Loader2 size={16} className="animate-spin text-zinc-600" />
        ) : (
          <div className="space-y-2">
            {Object.entries(tools).map(([name, t]) => (
              <div key={name} className="flex items-start gap-2 text-sm">
                {t.available ? <CheckCircle2 size={15} className="text-emerald-400 mt-0.5 shrink-0" /> : <XCircle size={15} className="text-red-400 mt-0.5 shrink-0" />}
                <div>
                  <span className="font-mono text-zinc-300">{name}</span>
                  <span className="text-zinc-500 ml-2 text-xs">{t.available ? t.version : t.hint}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Button onClick={save}>
        <Save size={14} /> {saved ? 'Saved ✓' : 'Save settings'}
      </Button>
    </div>
  );
}
