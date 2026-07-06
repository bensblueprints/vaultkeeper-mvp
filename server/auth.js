import crypto from 'node:crypto';
import { getDb } from './db.js';

const SESSION_TTL = 7 * 24 * 3600 * 1000;
export const COOKIE_NAME = 'vk_session';

function authDisabled() {
  return process.env.AUTH_DISABLED === 'true';
}

export function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  getDb().prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').run(token, Date.now() + SESSION_TTL);
  return token;
}

export function isValidSession(token) {
  if (!token) return false;
  const row = getDb().prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token);
  if (!row) return false;
  if (Date.now() > row.expires_at) {
    destroySession(token);
    return false;
  }
  return true;
}

export function destroySession(token) {
  if (token) getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function checkPassword(password) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return timingSafeEqual(password || '', expected);
}

/** Express middleware guarding admin API routes. */
export function requireAuth(req, res, next) {
  if (authDisabled()) return next();
  const token = req.cookies?.[COOKIE_NAME];
  if (isValidSession(token)) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

export function isAuthed(req) {
  if (authDisabled()) return true;
  return isValidSession(req.cookies?.[COOKIE_NAME]);
}
