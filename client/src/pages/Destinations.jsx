import React, { useEffect, useState } from 'react';
import { Plus, HardDrive, Cloud, Server, Pencil, Trash2, PlugZap } from 'lucide-react';
import { api } from '../api.js';
import { Card, Button, Modal, Field, Input, Select, Toggle, TestResult, EmptyState } from '../components.jsx';

const TYPES = [
  { value: 'local', label: 'Local directory', icon: HardDrive },
  { value: 's3', label: 'S3-compatible (AWS / B2 / R2 / MinIO)', icon: Cloud },
  { value: 'ftp', label: 'FTP / FTPS', icon: Server }
];

const blankConfig = {
  local: { path: '' },
  s3: { endpoint: '', region: 'us-east-1', bucket: '', prefix: '', accessKeyId: '', secretAccessKey: '' },
  ftp: { host: '', port: 21, user: '', pass: '', secure: false, basePath: '' }
};

export default function Destinations() {
  const [dests, setDests] = useState([]);
  const [editing, setEditing] = useState(null);
  const [tests, setTests] = useState({});
  const [error, setError] = useState('');

  const load = () => api('/api/destinations').then(setDests).catch(() => {});
  useEffect(() => { load(); }, []);

  const test = async (id) => {
    setTests((t) => ({ ...t, [id]: { loading: true } }));
    try {
      const r = await api(`/api/destinations/${id}/test`, { method: 'POST', body: {} });
      setTests((t) => ({ ...t, [id]: r }));
    } catch (e) {
      setTests((t) => ({ ...t, [id]: { ok: false, error: e.message } }));
    }
  };

  const save = async () => {
    setError('');
    try {
      const body = { name: editing.name, type: editing.type, config: editing.config };
      if (editing.id) await api(`/api/destinations/${editing.id}`, { method: 'PUT', body });
      else await api('/api/destinations', { method: 'POST', body });
      setEditing(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this destination?')) return;
    try {
      await api(`/api/destinations/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const f = editing || {};
  const setCfg = (patch) => setEditing({ ...f, config: { ...f.config, ...patch } });

  return (
    <div>
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Destinations</h1>
          <p className="text-sm text-zinc-500">Where your backup artifacts get shipped and pruned.</p>
        </div>
        <Button onClick={() => { setEditing({ name: '', type: 'local', config: { ...blankConfig.local } }); setError(''); }}>
          <Plus size={15} /> Add destination
        </Button>
      </header>

      {dests.length === 0 ? (
        <Card>
          <EmptyState icon={HardDrive} title="No destinations yet" subtitle="Add a local folder, S3 bucket or FTP server to store backups." />
        </Card>
      ) : (
        <Card className="divide-y divide-zinc-800/80">
          {dests.map((d) => {
            const Icon = TYPES.find((t) => t.value === d.type)?.icon || HardDrive;
            const summary =
              d.type === 'local' ? d.config.path :
              d.type === 's3' ? `${d.config.bucket}${d.config.prefix ? '/' + d.config.prefix : ''}${d.config.endpoint ? ' @ ' + d.config.endpoint : ' @ AWS'}` :
              `${d.config.host}:${d.config.port}${d.config.basePath ? '/' + d.config.basePath : ''}`;
            return (
              <div key={d.id} className="flex items-center gap-4 px-4 py-3">
                <div className="w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400 shrink-0">
                  <Icon size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-zinc-200">{d.name}</div>
                  <div className="text-xs text-zinc-500 truncate">{TYPES.find((t) => t.value === d.type)?.label} · {summary}</div>
                  <TestResult result={tests[d.id]} />
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button variant="secondary" onClick={() => test(d.id)} className="!py-1 !px-2.5 text-xs">
                    <PlugZap size={13} /> Test
                  </Button>
                  <Button variant="ghost" onClick={() => { setEditing({ id: d.id, name: d.name, type: d.type, config: { ...blankConfig[d.type], ...d.config } }); setError(''); }} className="!p-2">
                    <Pencil size={14} />
                  </Button>
                  <Button variant="ghost" onClick={() => remove(d.id)} className="!p-2 hover:!text-red-400">
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            );
          })}
        </Card>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={f.id ? 'Edit destination' : 'Add destination'} wide>
        {editing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Name">
                <Input value={f.name} onChange={(e) => setEditing({ ...f, name: e.target.value })} placeholder="Backblaze bucket" />
              </Field>
              <Field label="Type">
                <Select value={f.type} onChange={(e) => setEditing({ ...f, type: e.target.value, config: { ...blankConfig[e.target.value] } })}>
                  {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </Field>
            </div>

            {f.type === 'local' && (
              <Field label="Directory path" hint="Created automatically if it doesn't exist.">
                <Input value={f.config.path} onChange={(e) => setCfg({ path: e.target.value })} placeholder="D:\backups or /var/backups/vaultkeeper" />
              </Field>
            )}

            {f.type === 's3' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Endpoint" hint="Leave empty for AWS S3. B2: https://s3.us-west-004.backblazeb2.com · R2: https://<account>.r2.cloudflarestorage.com">
                    <Input value={f.config.endpoint} onChange={(e) => setCfg({ endpoint: e.target.value })} placeholder="https://…" />
                  </Field>
                  <Field label="Region">
                    <Input value={f.config.region} onChange={(e) => setCfg({ region: e.target.value })} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Bucket">
                    <Input value={f.config.bucket} onChange={(e) => setCfg({ bucket: e.target.value })} />
                  </Field>
                  <Field label="Key prefix (folder)">
                    <Input value={f.config.prefix} onChange={(e) => setCfg({ prefix: e.target.value })} placeholder="db-backups" />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Access key ID">
                    <Input value={f.config.accessKeyId} onChange={(e) => setCfg({ accessKeyId: e.target.value })} />
                  </Field>
                  <Field label="Secret access key" hint={f.id ? 'Leave empty to keep current' : 'Stored encrypted at rest'}>
                    <Input type="password" value={f.config.secretAccessKey} onChange={(e) => setCfg({ secretAccessKey: e.target.value })} />
                  </Field>
                </div>
              </>
            )}

            {f.type === 'ftp' && (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <Field label="Host" className="col-span-2">
                    <Input value={f.config.host} onChange={(e) => setCfg({ host: e.target.value })} />
                  </Field>
                  <Field label="Port">
                    <Input type="number" value={f.config.port} onChange={(e) => setCfg({ port: parseInt(e.target.value, 10) || 21 })} />
                  </Field>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <Field label="Username">
                    <Input value={f.config.user} onChange={(e) => setCfg({ user: e.target.value })} />
                  </Field>
                  <Field label="Password" hint={f.id ? 'Leave empty to keep current' : ''}>
                    <Input type="password" value={f.config.pass} onChange={(e) => setCfg({ pass: e.target.value })} />
                  </Field>
                  <Field label="Base path">
                    <Input value={f.config.basePath} onChange={(e) => setCfg({ basePath: e.target.value })} placeholder="backups" />
                  </Field>
                </div>
                <Toggle checked={!!f.config.secure} onChange={(v) => setCfg({ secure: v })} label="Use FTPS (explicit TLS)" />
              </>
            )}

            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={save} disabled={!f.name}>{f.id ? 'Save changes' : 'Add destination'}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
