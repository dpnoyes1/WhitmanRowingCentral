// Coach passwords (David, 2026-11-03). A coach who signs in with name and birthday can set a
// personal password. It is kept as a salted scrypt hash in Netlify Blobs (store `coachpw`, one key per
// coach name), never in the Sheet or the repo. Once set, the birthday no longer signs that coach in.
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

const STORE = 'coachpw';
const ATHLETE_STORE = 'athletepw';

const derive = (password, salt) => new Promise((resolve, reject) => {
  scrypt(String(password), salt, 32, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)));
});

/** { get(key), set(key, value), keys(), remove(key) } over Netlify Blobs, or null where Blobs is not available (tests, local dev). */
export async function defaultCoachStore(name = STORE) {
  try {
    const { getStore } = await import('@netlify/blobs');
    const s = getStore(name);
    return {
      get: (k) => s.get(k, { type: 'json' }), set: (k, v) => s.setJSON(k, v),
      keys: async () => (await s.list()).blobs.map((b) => b.key), remove: (k) => s.delete(k)
    };
  } catch {
    return null;
  }
}

/**
 * A password as it is checked and saved: spaces at either end are dropped, the same way sign-in drops
 * them (a phone keyboard adds them), so a saved password always matches what sign-in sends.
 */
export function cleanPassword(p) {
  return String(p ?? '').trim();
}

/** Why a new password is not acceptable, or '' when it is. David sets no rules (2026-11-03); only empty and absurdly long are refused. */
export function passwordProblem(next) {
  const p = cleanPassword(next);
  if (!p) return 'Type a new password.';
  if (p.length > 1000) return 'That password is too long.';
  return '';
}

/** Athlete passwords (David, 2026-11-12): same hashing, own Blobs store `athletepw`, one key per athlete ID. */
export const defaultAthleteStore = () => defaultCoachStore(ATHLETE_STORE);

/** Athletes need at least 6 characters and nothing else (David, 2026-11-12). Coaches keep the no-rules choice. */
export const ATHLETE_MIN_LENGTH = 6;
export function athletePasswordProblem(next) {
  const p = cleanPassword(next);
  if (p.length < ATHLETE_MIN_LENGTH) return `Your password needs at least ${ATHLETE_MIN_LENGTH} characters.`;
  if (p.length > 1000) return 'That password is too long.';
  return '';
}

/** A random temporary password for a coach to hand over: 8 characters, no look-alikes (0/O, 1/l/I). */
const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function generateTempPassword(length = 8) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += TEMP_ALPHABET[bytes[i] % TEMP_ALPHABET.length];
  return out;
}

/** temp = true marks a coach-issued password the athlete must replace at her next sign-in. */
export async function setCoachPassword(store, key, password, { temp = false } = {}) {
  const salt = randomBytes(16);
  const hash = await derive(cleanPassword(password), salt);
  await store.set(key, { salt: salt.toString('base64'), hash: hash.toString('base64'), updatedAt: new Date().toISOString(), ...(temp ? { temp: true } : {}) });
}

/** { ok: true/false, temp } for a stored password, or null when there is none. A store error is thrown. */
export async function checkPasswordRecord(store, key, password) {
  if (!store) return null;
  const rec = await store.get(key);
  if (!rec || !rec.hash) return null;
  const given = await derive(cleanPassword(password), Buffer.from(rec.salt, 'base64'));
  const want = Buffer.from(rec.hash, 'base64');
  return { ok: given.length === want.length && timingSafeEqual(given, want), temp: !!rec.temp };
}

/** True when this coach has a personal password. */
export async function hasCoachPassword(store, key) {
  if (!store) return false;
  const rec = await store.get(key);
  return !!(rec && rec.hash);
}

/** true / false, or null when this coach has no personal password. A store error is thrown, never read as "no password". */
export async function checkCoachPassword(store, key, password) {
  if (!store) return null;
  const rec = await store.get(key);
  if (!rec || !rec.hash) return null;
  const given = await derive(cleanPassword(password), Buffer.from(rec.salt, 'base64'));
  const want = Buffer.from(rec.hash, 'base64');
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * Coaches who have set a personal password, for the reset list on the Settings page (David, 2026-11-03:
 * any coach can reset any coach). Names come from the store keys (lower case), never from the Sheet.
 */
export async function coachesWithPassword(store) {
  if (!store) return [];
  const keys = await store.keys();
  const out = [];
  for (const key of keys) {
    const rec = await store.get(key);
    if (rec && rec.hash) out.push({ key, updatedAt: rec.updatedAt || null, temp: !!rec.temp });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** Clears a coach's personal password, so their birthday signs them in again. True when there was one. */
export async function resetCoachPassword(store, key) {
  const rec = await store.get(key);
  if (!rec) return false;
  await store.remove(key);
  return true;
}
