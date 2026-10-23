// Sign-in and a signed session cookie. Athletes sign in with their name and
// birthday (David, 2026-10-23), checked against keyed codes in the feed, so
// the site never holds a birthday. Coaches use TEAM_PASSWORD, which lives
// only in Netlify environment variables. Changing it or FEED_KEY signs
// everyone out.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'wrc_session';
export const SESSION_DAYS = 365;   // stay signed in all season (David, 2026-10-23)

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

/** who: 'team' (coach password) or an athlete ID. */
export function makeToken(secret, who = 'team', now = Date.now()) {
  const exp = Math.floor(now / 1000) + SESSION_DAYS * 86400;
  const payload = (who === 'team' ? 'team' : 'ath:' + who) + '.' + exp;
  return payload + '.' + sign(secret, payload);
}

/** { kind: 'team' } or { kind: 'athlete', id } for a good, unexpired token, else null. */
export function readToken(secret, token, now = Date.now()) {
  if (!secret || !token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const payload = parts[0] + '.' + parts[1];
  if (!sameText(sign(secret, payload), parts[2]) || Number(parts[1]) * 1000 <= now) return null;
  if (parts[0] === 'team') return { kind: 'team' };
  const m = parts[0].match(/^ath:([A-Za-z0-9-]+)$/);
  return m ? { kind: 'athlete', id: m[1] } : null;
}

export function tokenValid(secret, token, now = Date.now()) {
  return readToken(secret, token, now) !== null;
}

// ---- athlete sign-in --------------------------------------------------------

/** Name as typed, for matching: lower case letters only ("Mary-Kate O'Neil" = "marykate oneil"). */
export function nameKey(name) {
  return String(name || '').toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * A birthday typed any common way, as YYYY-MM-DD, or null: 3/14/2010,
 * 03-14-2010, 03142010, 031410, 2010-03-14. Two-digit years are 20xx.
 */
export function parseBirthday(text) {
  const t = String(text || '').trim();
  let y, m, d;
  let p = t.match(/^(\d{4})\D(\d{1,2})\D(\d{1,2})$/);
  if (p) [, y, m, d] = p;
  else if ((p = t.match(/^(\d{1,2})\D(\d{1,2})\D(\d{2}|\d{4})$/))) [, m, d, y] = p;
  else if ((p = t.match(/^(\d{2})(\d{2})(\d{4}|\d{2})$/))) [, m, d, y] = p;
  else return null;
  y = Number(y.length === 2 ? '20' + y : y); m = Number(m); d = Number(d);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** The code the Sheet's feed sends for this athlete and birthday (Feed.gs feedLoginSigner_). */
export function loginCode(env, id, day) {
  return createHmac('sha256', env('FEED_KEY')).update('login:' + id + ':' + day).digest('hex');
}

/**
 * Who a name and birthday sign in as: 'team' for a coach in the Sheet's
 * site.coaches, the matching active athlete, or null. The caller slows down failures.
 */
export function athleteFor(env, feed, name, password) {
  const day = parseBirthday(password), key = nameKey(name);
  if (!day || !key) return null;
  const coachCode = loginCode(env, 'coach:' + key, day);
  if ((feed.logins || []).some((l) => l.coach && sameText(l.code, coachCode))) return 'team';
  const matches = feed.athletes.filter((a) => a.active && nameKey(a.name) === key);
  for (const a of matches) {
    const l = (feed.logins || []).find((x) => !x.coach && x.id === a.id);
    if (l && sameText(l.code, loginCode(env, a.id, day))) return a;
  }
  return null;
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

export function session(env, req) {
  return readToken(sessionSecret(env), readCookie(req));
}

export function signedIn(env, req) {
  return session(env, req) !== null;
}
