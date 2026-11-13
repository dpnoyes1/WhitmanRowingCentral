// Coach workout builder (Plan page). Reads the upcoming sessions and workout library from the Sheet and saves a new
// workout and/or schedules one, through the feed key (apps-script/WorkoutBuilder.gs). Coaches only, never cached.
import { liveSession } from '../lib/auth.mjs';
import { callSheet } from '../lib/slack.mjs';

const env = (k) => Netlify.env.get(k);
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : v === undefined || v === null ? '' : typeof v === 'number' ? String(v) : null);
const PIECE_KEYS = ['workType', 'reps', 'work', 'rest', 'startEvery', 'activity', 'zone', 'base', 'lowPct', 'highPct', 'rate', 'notes'];

/** Only whitelisted, size-limited fields go to the Sheet; the Sheet validates the content. */
export function cleanWorkoutBody(body) {
  const out = {};
  for (const k of ['name', 'workoutId', 'squad', 'session', 'notes']) {
    const v = str(body[k], 200);
    if (v === null) return null;
    if (v) out[k] = v;
  }
  out.publish = body.publish === true;
  if (body.dates !== undefined) {
    if (!Array.isArray(body.dates) || body.dates.length > 31 || body.dates.some((d) => typeof d !== 'string' || d.length > 10)) return null;
    out.dates = body.dates;
  }
  if (body.pieces !== undefined) {
    if (!Array.isArray(body.pieces) || body.pieces.length > 12) return null;
    out.pieces = [];
    for (const p of body.pieces) {
      if (!p || typeof p !== 'object') return null;
      const c = {};
      for (const k of PIECE_KEYS) {
        const v = str(p[k], 200);
        if (v === null) return null;
        c[k] = v;
      }
      out.pieces.push(c);
    }
  }
  return out;
}

export async function handleWorkouts(req, envFn, deps = {}) {
  const who = await liveSession(envFn, req, deps);
  if (!who) return json({ error: 'signin' }, 401);
  if (who.kind !== 'team') return json({ error: 'Coaches only.' }, 403);
  const fetchImpl = deps.fetchImpl || fetch;
  if (req.method === 'GET') {
    try {
      const out = await callSheet(envFn, fetchImpl, { action: 'workout-list' });
      return json({ today: out.today, library: out.library, upcoming: out.upcoming });
    } catch (err) {
      console.error('workouts read error:', err.message);
      return json({ error: 'The Sheet did not answer. Try again in a minute.' }, 502);
    }
  }
  if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
  const origin = req.headers.get('origin');
  if (!/^application\/json/i.test(req.headers.get('content-type') || '') || (origin && origin !== new URL(req.url).origin)) {
    return json({ error: 'Bad request.' }, 400);
  }
  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  const clean = cleanWorkoutBody(body || {});
  if (!clean || (!clean.workoutId && !clean.pieces)) return json({ error: 'Nothing to save.' }, 400);
  let out;
  try {
    out = await callSheet(envFn, fetchImpl, { action: 'workout-save', ...clean, coachName: who.name || 'Coach' });
  } catch (err) {
    console.error('workouts save error:', err.message);
    return json({ error: 'The Sheet did not answer, so check the list before saving again.' }, 502);
  }
  if (out.status === 'invalid') return json({ error: out.message }, 422);
  if (out.status !== 'ok') {
    console.error('workouts save said:', out.error);
    return json({ error: 'The Sheet could not save that. Nothing was changed.' }, 502);
  }
  return json({ today: out.today, library: out.library, upcoming: out.upcoming, savedId: out.savedId });
}

export default (req) => handleWorkouts(req, env);

export const config = { path: '/api/workouts', method: ['GET', 'POST'] };
