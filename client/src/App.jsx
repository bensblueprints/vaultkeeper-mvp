import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Vault, LayoutDashboard, Database, HardDrive, CalendarClock, Settings as SettingsIcon, LogOut, Lock, Loader2 } from 'lucide-react';
import { api } from './api.js';
import { Button, Input } from './components.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Sources from './pages/Sources.jsx';
import Destinations from './pages/Destinations.jsx';
import Jobs from './pages/Jobs.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'jobs', label: 'Backup Jobs', icon: CalendarClock },
  { key: 'sources', label: 'Sources', icon: Database },
  { key: 'destinations', label: 'Destinations', icon: HardDrive },
  { key: 'settings', label: 'Settings', icon: SettingsIcon }
];

export default function App() {
  const [authed, setAuthed] = useState(null);
  const [page, setPage] = useState('dashboard');
  const [jobFocus, setJobFocus] = useState(null); // job id to open in detail

  useEffect(() => {
    api('/api/session').then((s) => setAuthed(s.authed)).catch(() => setAuthed(false));
  }, []);

  if (authed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-zinc-500">
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

  const openJob = (id) => {
    setJobFocus(id);
    setPage('jobs');
  };

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 shrink-0 border-r border-zinc-800/80 bg-zinc-950 flex flex-col">
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-zinc-800/80">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
            <Vault size={17} className="text-white" />
          </div>
          <div>
            <div className="font-semibold text-zinc-100 leading-tight">Vaultkeeper</div>
            <div className="text-[10px] text-zinc-500 leading-tight">backups you own</div>
          </div>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1">
          {NAV.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => { setPage(key); if (key !== 'jobs') setJobFocus(null); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                page === key ? 'bg-zinc-800/90 text-zinc-100 font-medium' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-zinc-800/80">
          <button
            onClick={() => api('/api/logout', { method: 'POST', body: {} }).then(() => location.reload())}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900 transition-colors"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-8">
          {page === 'dashboard' && <Dashboard onOpenJob={openJob} goTo={setPage} />}
          {page === 'jobs' && <Jobs focusId={jobFocus} clearFocus={() => setJobFocus(null)} goTo={setPage} />}
          {page === 'sources' && <Sources />}
          {page === 'destinations' && <Destinations />}
          {page === 'settings' && <Settings />}
        </div>
      </main>
    </div>
  );
}

function Login({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/login', { method: 'POST', body: { password } });
      onLogin();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-emerald-600 flex items-center justify-center mb-3 shadow-lg shadow-emerald-950">
            <Vault size={26} className="text-white" />
          </div>
          <h1 className="text-xl font-semibold text-zinc-100">Vaultkeeper</h1>
          <p className="text-sm text-zinc-500">Your databases, backed up nightly, encrypted, forever.</p>
        </div>
        <form onSubmit={submit} className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-5 space-y-3">
          <div className="relative">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Admin password"
              autoFocus
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg pl-9 pr-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-emerald-600 transition-colors"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <Button type="submit" disabled={busy || !password} className="w-full justify-center py-2.5">
            {busy ? <Loader2 size={15} className="animate-spin" /> : 'Unlock'}
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
