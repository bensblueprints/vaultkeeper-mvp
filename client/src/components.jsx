import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react';

export function Button({ children, variant = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    secondary: 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700',
    ghost: 'hover:bg-zinc-800/70 text-zinc-400 hover:text-zinc-200',
    danger: 'bg-red-900/60 hover:bg-red-800 text-red-200 border border-red-800/60'
  };
  return (
    <button
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = '' }) {
  return <div className={`bg-zinc-900/70 border border-zinc-800 rounded-xl ${className}`}>{children}</div>;
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs font-medium text-zinc-400 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-zinc-500 mt-1">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-emerald-600 transition-colors';

export function Input(props) {
  return <input className={inputCls} {...props} />;
}

export function Select({ children, ...props }) {
  return (
    <select className={inputCls} {...props}>
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2.5 text-sm text-zinc-300"
    >
      <span
        className={`w-9 h-5 rounded-full transition-colors relative ${checked ? 'bg-emerald-600' : 'bg-zinc-700'}`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`}
        />
      </span>
      {label}
    </button>
  );
}

export function StatusBadge({ status }) {
  const map = {
    ok: 'bg-emerald-950/80 text-emerald-400 border-emerald-800/60',
    running: 'bg-sky-950/80 text-sky-400 border-sky-800/60',
    failed: 'bg-red-950/80 text-red-400 border-red-800/60',
    never: 'bg-zinc-800/80 text-zinc-400 border-zinc-700',
    paused: 'bg-amber-950/80 text-amber-400 border-amber-800/60'
  };
  const label = { ok: 'OK', running: 'Running', failed: 'Failed', never: 'Never ran', paused: 'Paused' }[status] || status;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${map[status] || map.never}`}>
      {status === 'running' && <Loader2 size={10} className="animate-spin" />}
      {label}
    </span>
  );
}

export function Sparkline({ points, width = 120, height = 28 }) {
  if (!points || points.length < 2) {
    return <div className="text-[10px] text-zinc-600 h-[28px] flex items-center">size trend —</div>;
  }
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const step = width / (points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(height - 3 - ((p - min) / range) * (height - 6)).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={width} height={height} className="text-emerald-500">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle
        cx={(points.length - 1) * step}
        cy={height - 3 - ((points[points.length - 1] - min) / range) * (height - 6)}
        r="2.5"
        fill="currentColor"
      />
    </svg>
  );
}

export function Modal({ open, onClose, title, children, wide }) {
  useEffect(() => {
    const fn = (e) => e.key === 'Escape' && onClose();
    if (open) window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm overflow-y-auto py-10 px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            className={`bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <h2 className="font-semibold text-zinc-100">{title}</h2>
              <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function TestResult({ result }) {
  if (!result) return null;
  if (result.loading)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
        <Loader2 size={12} className="animate-spin" /> testing…
      </span>
    );
  return result.ok ? (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
      <CheckCircle2 size={13} /> {result.detail || 'OK'}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs text-red-400 max-w-md" title={result.error}>
      <XCircle size={13} className="shrink-0" /> {result.error?.slice(0, 140)}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-2xl bg-zinc-800/80 flex items-center justify-center mb-3 text-zinc-500">
        <Icon size={22} />
      </div>
      <p className="text-zinc-300 font-medium">{title}</p>
      <p className="text-sm text-zinc-500 mt-1 mb-4 max-w-sm">{subtitle}</p>
      {action}
    </div>
  );
}

export function WarnBanner({ children }) {
  return (
    <div className="flex items-start gap-2.5 bg-amber-950/40 border border-amber-800/50 text-amber-200 text-sm rounded-xl px-4 py-3">
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" />
      <div>{children}</div>
    </div>
  );
}
