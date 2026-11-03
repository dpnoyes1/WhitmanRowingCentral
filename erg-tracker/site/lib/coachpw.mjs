// Coach passwords (David, 2026-11-03). A coach who signs in with name and birthday can set a
// personal password. It is kept as a salted scrypt hash in Netlify Blobs (store `coachpw`, one key per
// coach name), never in the Sheet or the repo. Once set, the birthday no longer signs that coach in.
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { parseBirthday } from './auth.mjs';

export const MIN_LENGTH = 10;
const STORE = 'coachpw';

const derive = (password, salt) => new Promise((resolve, reject) => {
  scrypt(String(password), salt, 32, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)));
});

/** { get(key), set(key, value) } over Netlify Blobs, or null where Blobs is not available (tests, local dev). */
export async function defaultCoachStore() {
  try {
    const { getStore } = await import('@netlify/blobs');
    const s = getStore(STORE);
    return { get: (k) => s.get(k, { type: 'json' }), set: (k, v) => s.setJSON(k, v) };
  } catch {
    return null;
  }
}

/** Why a new password is not acceptable, or '' when it is. */
export function passwordProblem(next) {
  const p = String(next || '');
  if (p.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`;
  if (p.length > 200) return 'That password is too long.';
  if (parseBirthday(p)) return 'A date is easy to guess. Use something else.';
  return '';
}

export async function setCoachPassword(store, key, password) {
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  await store.set(key, { salt: salt.toString('base64'), hash: hash.toString('base64'), updatedAt: new Date().toISOString() });
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
  const given = await derive(password, Buffer.from(rec.salt, 'base64'));
  const want = Buffer.from(rec.hash, 'base64');
  return given.length === want.length && timingSafeEqual(given, want);
}
