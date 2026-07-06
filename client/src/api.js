export async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : {},
    ...options,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function apiText(path) {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export function fmtBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60000).toFixed(1)} min`;
}

export function timeUntil(iso) {
  if (!iso) return '—';
  const diff = new Date(iso) - Date.now();
  if (diff <= 0) return 'due now';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `in ${hours}h ${mins % 60}m`;
  return `in ${Math.round(hours / 24)} days`;
}
