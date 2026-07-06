import React, { useEffect, useState } from 'react';
import { Plus, Database, Pencil, Trash2, PlugZap } from 'lucide-react';
import { api } from '../api.js';
import { Card, Button, Modal, Field, Input, Select, TestResult, EmptyState } from '../components.jsx';

const ENGINES = [
  { value: 'postgres', label: 'PostgreSQL', port: 5432 },
  { value: 'mysql', label: 'MySQL / MariaDB', port: 3306 },
  { value: 'sqlite', label: 'SQLite', port: null },
  { value: 'mongo', label: 'MongoDB', port: 27017 }
];

const blank = { name: '', engine: 'postgres', host: 'localhost', port: 5432, database: '', username: '', password: '', sqlite_path: '', extra_flags: '', custom_bin_path: '' };

export default function Sources() {
  const [sources, setSources] = useState([]);
  const [editing, setEditing] = useState(null); // null | {..form}
  const [tests, setTests] = useState({});
  const [error, setError] = useState('');

  const load = () => api('/api/sources').then(setSources).catch(() => {});
  useEffect(() => { load(); }, []);

  const test = async (id) => {
    setTests((t) => ({ ...t, [id]: { loading: true } }));
    try {
      const r = await api(`/api/sources/${id}/test`, { method: 'POST', body: {} });
      setTests((t) => ({ ...t, [id]: r }));
    } catch (e) {
      setTests((t) => ({ ...t, [id]: { ok: false, error: e.message } }));
    }
  };

  const save = async () => {
    setError('');
    try {
      const body = { ...editing };
      delete body.id;
      if (editing.id) await api(`/api/sources/${editing.id}`, { method: 'PUT', body });
      else await api('/api/sources', { method: 'POST', body });
      setEditing(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this source?')) return;
    try {
      await api(`/api/sources/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const f = editing || {};
  const isSqlite = f.engine === 'sqlite';

  return (
    <div>
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Sources</h1>
          <p className="text-sm text-zinc-500">Database connection profiles Vaultkeeper dumps from.</p>
        </div>
        <Button onClick={() => { setEditing({ ...blank }); setError(''); }}>
          <Plus size={15} /> Add source
        </Button>
      </header>

      {sources.length === 0 ? (
        <Card>
          <EmptyState icon={Database} title="No sources yet" subtitle="Add a Postgres, MySQL, SQLite or MongoDB connection to back up." />
        </Card>
      ) : (
        <Card className="divide-y divide-zinc-800/80">
          {sources.map((s) => (
            <div key={s.id} className="flex items-center gap-4 px-4 py-3">
              <div className="w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400 shrink-0">
                <Database size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-zinc-200">{s.name}</div>
                <div className="text-xs text-zinc-500 truncate">
                  {ENGINES.find((e) => e.value === s.engine)?.label} ·{' '}
                  {s.engine === 'sqlite' ? s.sqlite_path : `${s.host}:${s.port || '—'}/${s.database}`}
                </div>
                <TestResult result={tests[s.id]} />
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button variant="secondary" onClick={() => test(s.id)} className="!py-1 !px-2.5 text-xs">
                  <PlugZap size={13} /> Test
                </Button>
                <Button variant="ghost" onClick={() => { setEditing({ ...blank, ...s, password: '' }); setError(''); }} className="!p-2">
                  <Pencil size={14} />
                </Button>
                <Button variant="ghost" onClick={() => remove(s.id)} className="!p-2 hover:!text-red-400">
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={f.id ? 'Edit source' : 'Add source'} wide>
        {editing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Name">
                <Input value={f.name} onChange={(e) => setEditing({ ...f, name: e.target.value })} placeholder="Production DB" />
              </Field>
              <Field label="Engine">
                <Select
                  value={f.engine}
                  onChange={(e) => {
                    const eng = ENGINES.find((x) => x.value === e.target.value);
                    setEditing({ ...f, engine: eng.value, port: eng.port ?? '' });
                  }}
                >
                  {ENGINES.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
                </Select>
              </Field>
            </div>

            {isSqlite ? (
              <Field label="Database file path" hint="Backed up via the SQLite online backup API — safe on live WAL databases, no CLI needed.">
                <Input value={f.sqlite_path} onChange={(e) => setEditing({ ...f, sqlite_path: e.target.value })} placeholder="C:\apps\myapp\data\app.db or /var/lib/app/app.db" />
              </Field>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <Field label="Host" className="col-span-2">
                    <Input value={f.host} onChange={(e) => setEditing({ ...f, host: e.target.value })} />
                  </Field>
                  <Field label="Port">
                    <Input type="number" value={f.port ?? ''} onChange={(e) => setEditing({ ...f, port: e.target.value })} />
                  </Field>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <Field label="Database">
                    <Input value={f.database} onChange={(e) => setEditing({ ...f, database: e.target.value })} />
                  </Field>
                  <Field label="Username">
                    <Input value={f.username} onChange={(e) => setEditing({ ...f, username: e.target.value })} />
                  </Field>
                  <Field label="Password" hint={f.id && f.has_password ? 'Leave empty to keep current' : 'Stored AES-256-GCM encrypted'}>
                    <Input type="password" value={f.password} onChange={(e) => setEditing({ ...f, password: e.target.value })} />
                  </Field>
                </div>
              </>
            )}

            <details className="text-sm">
              <summary className="text-zinc-500 cursor-pointer hover:text-zinc-300 text-xs">Advanced</summary>
              <div className="grid grid-cols-2 gap-4 mt-3">
                <Field label="Extra dump flags" hint="Appended to the dump command (space separated)">
                  <Input value={f.extra_flags} onChange={(e) => setEditing({ ...f, extra_flags: e.target.value })} placeholder="--exclude-table=logs" />
                </Field>
                <Field label="Custom binary path" hint="Full path if the tool isn't on PATH">
                  <Input value={f.custom_bin_path} onChange={(e) => setEditing({ ...f, custom_bin_path: e.target.value })} placeholder="C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" />
                </Field>
              </div>
            </details>

            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={save} disabled={!f.name}>{f.id ? 'Save changes' : 'Add source'}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
