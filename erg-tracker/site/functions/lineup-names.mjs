// Boat names for the Lineups page (David, 2026-11-13): shared by every coach, so a rename on one device shows on the others.
// Coaches only. GET returns { names }, POST { names } replaces them. Kept in Netlify Blobs store `lineups`, key `boat-names`;
// nothing about athletes in it, only labels like "Varsity 8".
import { liveSession } from '../lib/auth.mjs';
import { defaultCoachStore } from '../lib/coachpw.mjs';

const env = (k) => Netlify.env.get(k);
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const KEY = 'boat-names';
export const MAX_NAME = 24, MAX_NAMES = 40;

/** Keeps only short text-to-text pairs: the default name ("1st 8+") maps to the coach's name. Anything else is dropped. */
export function cleanNames(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw).slice(0, MAX_NAMES)) {
    const key = String(k).trim().slice(0, MAX_NAME), val = typeof v === 'string' ? v.trim().slice(0, MAX_NAME) : '';
    if (key && val && key !== val) out[key] = val;
  }
  return out;
}

export async function handleLineupNames(req, envFn, deps = {}) {
  const who = await liveSession(envFn, req, deps);
  if (!who) return json({ error: 'signin' }, 401);
  if (who.kind !== 'team') return json({ error: 'Coaches only.' }, 403);
  const store = deps.lineupStore === undefined ? await defaultCoachStore('lineups') : deps.lineupStore;
  if (req.method === 'GET') {
    try { return json({ names: cleanNames(store ? await store.get(KEY) : null) }); } catch (err) {
      console.error('lineup names read error:', err.message);
      return json({ error: 'Names could not be loaded.' }, 502);
    }
  }
  if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
  const origin = req.headers.get('origin');
  if (!/^application\/json/i.test(req.headers.get('content-type') || '') || (origin && origin !== new URL(req.url).origin)) {
    return json({ error: 'Bad request.' }, 400);
  }
  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  if (!store) return json({ error: 'Names cannot be saved right now.' }, 503);
  const names = cleanNames(body.names);
  try { await store.set(KEY, names); } catch (err) {
    console.error('lineup names save error:', err.message);
    return json({ error: 'That did not save. Try again in a minute.' }, 502);
  }
  return json({ ok: true, names });
}

export default (req) => handleLineupNames(req, env);

export const config = { path: '/api/lineup-names', method: ['GET', 'POST'], rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
