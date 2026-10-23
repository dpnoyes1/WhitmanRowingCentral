// Team password check and a signed session cookie. Passwords live only in
// Netlify environment variables. Changing TEAM_PASSWORD signs everyone out.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'wrc_session';
export const SESSION_DAYS = 120;

function sign(secret, payload) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function sameText(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Signing secret derived from the password and feed key, so rotating either ends old sessions. */
export function sessionSecret(env) {
  const team = env('TEAM_PASSWORD'), key = env('FEED_KEY');
  if (!team || !key) return null;
  return createHmac('sha256', key).update('team-session:' + team).digest();
}

export function passwordMatches(env, given) {
  const team = env('TEAM_PASSWORD');
  return !!team && sameText(team, String(given || ''));
}

export function makeToken(secret, now = Date.now()) {
  const exp = Math.floor(now / 1000) + SESSION_DAYS * 86400;
  const payload = 'team.' + exp;
  return payload + '.' + sign(secret, payload);
}

export function tokenValid(secret, token, now = Date.now()) {
  if (!secret || !token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 3 || parts[0] !== 'team') return false;
  const payload = parts[0] + '.' + parts[1];
  if (!sameText(sign(secret, payload), parts[2])) return false;
  return Number(parts[1]) * 1000 > now;
}

export function readCookie(req, name = COOKIE) {
  const header = req.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function sessionCookie(token) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function signedIn(env, req) {
  return tokenValid(sessionSecret(env), readCookie(req));
}
