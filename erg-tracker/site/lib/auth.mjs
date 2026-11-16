// Sign-in and a signed session cookie. Athletes sign in with their name and
// birthday (David, 2026-10-23), checked against keyed codes in the feed, so
// the site never holds a birthday. Coaches sign in the same way (Settings
// site.coaches) and can then set a personal password (lib/coachpw.mjs). There is
// no shared password (David, 2026-11-03). Rotating FEED_KEY signs everyone out.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { defaultCoachStore, defaultAthleteStore, hasCoachPassword, readCredential, credVersion } from './coachpw.mjs';
import { getFeed } from './feed.mjs';

export const COOKIE = 'wrc_session';
export const SESSION_DAYS = 365;   // stay signed in all season (David, 2026-10-23)

function sign(secret, payload) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function sameText(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Signing secret derived from the feed key, so rotating the key ends every session. */
export function sessionSecret(env) {
  const key = env('FEED_KEY');
  if (!key) return null;
  return createHmac('sha256', key).update('session-v2').digest();
}

/**
 * who: 'team' (a coach, who always carries her name) or an athlete ID. The name lets the menu show it and
 * the password change know whose password it is. It is signed, not secret.
 */
export function makeToken(secret, who = 'team', now = Date.now(), name = '', cred = '') {
  const exp = Math.floor(now / 1000) + SESSION_DAYS * 86400;
  if (who === 'team' && !name) throw new Error('A coach session needs her name');
  // cred: the password stamp she signed in with (credVersion; '' = birthday, no password of her own). See liveSession.
  const label = (who !== 'team' ? 'ath:' + who : 'coach:' + Buffer.from(String(name).slice(0, 80)).toString('base64url')) + '~' + String(cred || '');
  const payload = label + '.' + exp;
  return payload + '.' + sign(secret, payload);
}

/**
 * { kind: 'team', name } or { kind: 'athlete', id } for a good, unexpired token, else null, plus cred (the password stamp, or
 * null for a token made before stamps) and iat (when it was made, seconds). An old nameless 'team' token is not valid.
 */
export function readToken(secret, token, now = Date.now()) {
  if (!secret || !token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const payload = parts[0] + '.' + parts[1];
  if (!sameText(sign(secret, payload), parts[2]) || Number(parts[1]) * 1000 <= now) return null;
  const st = parts[0].match(/~([A-Za-z0-9_-]{0,16})$/);
  const label = st ? parts[0].slice(0, -st[0].length) : parts[0];
  const extra = { cred: st ? st[1] : null, iat: Number(parts[1]) - SESSION_DAYS * 86400 };
  const c = label.match(/^coach:([A-Za-z0-9_-]+)$/);
  if (c) return { kind: 'team', name: Buffer.from(c[1], 'base64url').toString('utf8'), ...extra };
  const m = label.match(/^ath:([A-Za-z0-9-]+)$/);
  return m ? { kind: 'athlete', id: m[1], ...extra } : null;
}

export function tokenValid(secret, token, now = Date.now()) {
  return readToken(secret, token, now) !== null;
}

// ---- athlete sign-in --------------------------------------------------------

/** A typed name tidied for display: "dAVID  noyes" -> "David Noyes". */
export function displayName(name) {
  return String(name || '').replace(/[^\p{L}\p{M}' .-]/gu, '').replace(/\s+/g, ' ').trim()
    .split(' ').map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ').slice(0, 80);
}

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
    // An athlete can have two codes: her birthday and the shared test date.
    const code = loginCode(env, a.id, day);
    if ((feed.logins || []).some((x) => !x.coach && x.id === a.id && sameText(x.code, code))) return a;
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

// ---- admin and live sessions (David, 2026-11-13) -------------------------------
// Only the admin adds or removes coaches. The admin is named in the Netlify setting ADMIN_COACH (a name, not a secret),
// so a copy of the site for another team names its own. With it set, a coach is whoever has a record in the coach store
// (made by the admin from Settings > Coaches); the admin signs in with the Sheet's site.coaches birthday until they set a password.
// With it unset, everything works as before.

/** The admin's name as matched at sign-in, or '' when no admin is set. */
export function adminKey(env) {
  const n = env('ADMIN_COACH');
  return n ? nameKey(n) : '';
}

/**
 * session(), plus a check on every request that a coach is still a coach. A removed coach's cookie stops working at once.
 * Returns the session ({ admin: true } for the admin) or null. If the coach store cannot be read, the coach is refused.
 */
export async function liveSession(env, req, deps = {}) {
  const who = session(env, req);
  if (!who) return null;
  const coach = who.kind === 'team';
  const key = coach ? nameKey(who.name) : who.id;
  const admin = adminKey(env);
  try {
    const store = coach
      ? (deps.coachStore === undefined ? await defaultCoachStore() : deps.coachStore)
      : (deps.athleteStore === undefined ? await defaultAthleteStore() : deps.athleteStore);
    if (coach && admin && key !== admin && !(await hasCoachPassword(store, key))) return null;
    if (!credStillGood(who, store ? await readCredential(store, key) : null, !store)) return null;
  } catch (err) {
    console.error('session check error:', err.message);
    return null;
  }
  return coach && admin && key === admin ? { ...who, admin: true } : who;
}

/**
 * Review 2026-11-16: a session ends when its password changes. A session carries the stamp of the password it signed in
 * with; it stays good only while that is still the saved password ('' = still no password of their own, so a coach's
 * reset or a removed coach ends it too). A token from before stamps is good unless the password was saved after it was
 * made. With no password store at all (local tests), a session that signed in with a password is refused.
 */
export function credStillGood(who, rec, noStore = false) {
  if (who.cred === null || who.cred === undefined) {
    const saved = rec && Date.parse(rec.updatedAt);
    return !(saved && saved > who.iat * 1000 + 2000);
  }
  if (noStore) return who.cred === '';
  return credVersion(rec) === who.cred;
}

/** False when a signed-in athlete is no longer active on the Roster (cookies last a year). Anyone else is true. A feed error is thrown. */
export async function athleteStillActive(env, who, deps = {}) {
  if (!who || who.kind !== 'athlete') return true;
  const { data } = await getFeed(env, { fetchImpl: deps.feedFetch, shared: deps.feedShared });
  return data.athletes.some((x) => x.id === who.id && x.active);
}
