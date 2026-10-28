// Concept2 Logbook connection (phase 2). Each athlete connects her own Logbook
// account once; tokens are kept encrypted in Netlify Blobs, never in the repo
// or the Sheet. Read-only: scope user:read,results:read, passed explicitly
// because the Logbook default includes results:write.
//
// Env (Netlify only): CONCEPT2_CLIENT_ID, CONCEPT2_CLIENT_SECRET,
// CONCEPT2_TOKEN_KEY (random 64 hex characters), optional CONCEPT2_REDIRECT_URI.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const LOGBOOK = 'https://log.concept2.com';
export const SCOPE = 'user:read,results:read';
export const CALLBACK_PATH = '/.netlify/functions/concept2-callback';   // registered with Concept2
const STATE_MINUTES = 10;
const REFRESH_MARGIN_MS = 60 * 60 * 1000;
const STORE = 'concept2';

export function configured(env) {
  return !!(env('CONCEPT2_CLIENT_ID') && env('CONCEPT2_CLIENT_SECRET') && env('CONCEPT2_TOKEN_KEY'));
}

export function redirectUri(env, req) {
  return env('CONCEPT2_REDIRECT_URI') || new URL(req.url).origin + CALLBACK_PATH;
}

function keyBytes(env) {
  const k = String(env('CONCEPT2_TOKEN_KEY') || '');
  return /^[0-9a-f]{64}$/i.test(k) ? Buffer.from(k, 'hex') : createHash('sha256').update(k).digest();
}

// ---- encrypted token blobs (AES-256-GCM) -------------------------------------

export function seal(env, obj) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyBytes(env), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}

export function unseal(env, text) {
  try {
    const raw = Buffer.from(String(text), 'base64url');
    const d = createDecipheriv('aes-256-gcm', keyBytes(env), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'));
  } catch {
    return null;
  }
}

// ---- OAuth state: signed, short-lived, tied to the athlete -------------------

function stateSig(env, payload) {
  return createHmac('sha256', keyBytes(env)).update('c2-state:' + payload).digest('base64url');
}

export function makeState(env, athleteId, now = Date.now()) {
  const payload = athleteId + '.' + (Math.floor(now / 1000) + STATE_MINUTES * 60) + '.' + randomBytes(6).toString('hex');
  return payload + '.' + stateSig(env, payload);
}

/** Athlete ID for a good, unexpired state, else null. */
export function readState(env, state, now = Date.now()) {
  const parts = String(state || '').split('.');
  if (parts.length !== 4) return null;
  const payload = parts.slice(0, 3).join('.');
  const a = Buffer.from(stateSig(env, payload)), b = Buffer.from(parts[3]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(parts[1]) * 1000 <= now || !/^[A-Za-z0-9-]+$/.test(parts[0])) return null;
  return parts[0];
}

export function authorizeUrl(env, req, state) {
  const q = new URLSearchParams({
    client_id: env('CONCEPT2_CLIENT_ID'), scope: SCOPE, response_type: 'code',
    redirect_uri: redirectUri(env, req), state
  });
  return LOGBOOK + '/oauth/authorize?' + q;
}

// ---- Logbook calls -----------------------------------------------------------

async function tokenRequest(env, fetchImpl, params) {
  const res = await fetchImpl(LOGBOOK + '/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ client_id: env('CONCEPT2_CLIENT_ID'), client_secret: env('CONCEPT2_CLIENT_SECRET'), ...params })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error('Logbook token request failed (' + res.status + ')');
  return {
    access: body.access_token, refresh: body.refresh_token || '',
    expiresAt: Date.now() + (Number(body.expires_in) || 604800) * 1000, scope: body.scope || SCOPE
  };
}

export const exchangeCode = (env, fetchImpl, code, redirect) =>
  tokenRequest(env, fetchImpl, { grant_type: 'authorization_code', code, redirect_uri: redirect, scope: SCOPE });

export const refreshTokens = (env, fetchImpl, refresh) =>
  tokenRequest(env, fetchImpl, { grant_type: 'refresh_token', refresh_token: refresh, scope: SCOPE });

/** The Logbook account's numeric id and username (user:read). The id matches a webhook to an athlete. */
export async function fetchLogbookUser(fetchImpl, access) {
  const res = await fetchImpl(LOGBOOK + '/api/users/me', { headers: { authorization: 'Bearer ' + access, accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  const d = body && body.data;
  if (!res.ok || !d || !d.id) throw new Error('Logbook profile request failed (' + res.status + ')');
  return { id: String(d.id), username: String(d.username || '') };
}

/** Thrown when a Logbook account is already linked to a different athlete. */
export class AccountTaken extends Error {}

// ---- storage -----------------------------------------------------------------

/** Netlify Blobs store { get, set, delete, list(prefix) -> keys }, or null where Blobs isn't available. */
export async function defaultStore() {
  try {
    const { getStore } = await import('@netlify/blobs');
    const s = getStore(STORE);
    return {
      get: (k) => s.get(k),
      set: (k, v) => s.set(k, v),
      delete: (k) => s.delete(k),
      list: async (prefix) => (await s.list({ prefix })).blobs.map((b) => b.key)
    };
  } catch {
    return null;
  }
}

const tokKey = (athleteId) => 'tok/' + athleteId;
const userKey = (logbookId) => 'user/' + logbookId;
const connKey = (athleteId) => 'conn/' + athleteId;

/** Links a Logbook account to an athlete. One account per athlete and one athlete per account. */
export async function saveConnection(env, store, athleteId, tokens, user) {
  const owner = await store.get(userKey(user.id));
  if (owner && owner !== athleteId) throw new AccountTaken('Logbook account already linked to another athlete');
  const old = unseal(env, await store.get(tokKey(athleteId)));
  if (old && old.logbookUserId && old.logbookUserId !== user.id) await store.delete(userKey(old.logbookUserId));
  await store.set(tokKey(athleteId), seal(env, { ...tokens, logbookUserId: user.id }));
  await store.set(userKey(user.id), athleteId);
  await store.set(connKey(athleteId), JSON.stringify({ at: new Date().toISOString(), username: user.username }));
}

/** { at, username } or null. */
export async function connectionInfo(store, athleteId) {
  const raw = await store.get(connKey(athleteId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return { at: '', username: '' }; }
}

export async function isConnected(store, athleteId) {
  return !!(await store.get(connKey(athleteId)));
}

/** [{ id, username }] for every connected athlete (coaches only). */
export async function connectedList(store) {
  const ids = (await store.list('conn/')).map((k) => k.slice(5));
  return Promise.all(ids.map(async (id) => ({ id, username: ((await connectionInfo(store, id)) || {}).username || '' })));
}

export async function athleteForLogbookUser(store, logbookUserId) {
  return (await store.get(userKey(logbookUserId))) || null;
}

export async function disconnect(env, store, athleteId) {
  const t = unseal(env, await store.get(tokKey(athleteId)));
  if (t && t.logbookUserId) await store.delete(userKey(t.logbookUserId));
  await store.delete(tokKey(athleteId));
  await store.delete(connKey(athleteId));
}

/** A usable access token for her, refreshed when near expiry; null if not connected or the refresh failed. */
export async function accessTokenFor(env, store, fetchImpl, athleteId, now = Date.now()) {
  const t = unseal(env, await store.get(tokKey(athleteId)));
  if (!t) return null;
  if (t.expiresAt - REFRESH_MARGIN_MS > now) return t.access;
  try {
    const fresh = await refreshTokens(env, fetchImpl, t.refresh);
    await store.set(tokKey(athleteId), seal(env, { ...fresh, refresh: fresh.refresh || t.refresh, logbookUserId: t.logbookUserId }));
    return fresh.access;
  } catch (err) {
    console.error('logbook refresh failed:', err.message);
    return null;
  }
}
