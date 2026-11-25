import crypto from 'node:crypto';

const COOKIE = 'vt_session';
const MAX_AGE_SECONDS = 12 * 60 * 60; // sign in again after 12 hours

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET is missing or too short');
  return s;
}

function sign(data) {
  return crypto.createHmac('sha256', secret()).update(data).digest('base64url');
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab); // keep timing similar
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

export function credentialsConfigured() {
  return Boolean(process.env.SITE_USERNAME && process.env.SITE_PASSWORD && process.env.SESSION_SECRET);
}

export function checkCredentials(username, password) {
  if (!credentialsConfigured()) return false;
  const userOk = safeEqual(username || '', process.env.SITE_USERNAME);
  const passOk = safeEqual(password || '', process.env.SITE_PASSWORD);
  return userOk && passOk;
}

export function createSessionCookie(username) {
  const payload = Buffer.from(
    JSON.stringify({ u: username, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS })
  ).toString('base64url');
  const value = `${payload}.${sign(payload)}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function getSession(req) {
  try {
    const header = req.headers.cookie || '';
    const match = header.split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
    if (!match) return null;
    const [payload, sig] = match.slice(COOKIE.length + 1).split('.');
    if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

export function securityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}
