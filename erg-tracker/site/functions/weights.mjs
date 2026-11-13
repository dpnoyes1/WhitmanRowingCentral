// Coach Weights page (David, 2026-11-11). Reads and writes the Sheet's Weights tab through the feed key
// (apps-script/Weights.gs). Coaches only, never from the cached feed (weight is never in the feed) and
// never cached by the browser. Athletes get a 403, so weight cannot reach a team or athlete view.
import { liveSession } from '../lib/auth.mjs';
import { callSheet } from '../lib/slack.mjs';

const env = (k) => Netlify.env.get(k);
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

export async function handleWeights(req, envFn, deps = {}) {
  const who = await liveSession(envFn, req, deps);
  if (!who) return json({ error: 'signin' }, 401);
  if (who.kind !== 'team') return json({ error: 'Coaches only.' }, 403);
  const fetchImpl = deps.fetchImpl || fetch;
  if (req.method === 'GET') {
    try {
      const out = await callSheet(envFn, fetchImpl, { action: 'weights-get' });
      return json({ today: out.today, yearStart: out.yearStart, rows: out.rows });
    } catch (err) {
      console.error('weights read error:', err.message);
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
  if (typeof body.athleteId !== 'string' || !body.athleteId || body.athleteId.length > 20 || (typeof body.lb !== 'string' && typeof body.lb !== 'number')) {
    return json({ error: 'Nothing to save.' }, 400);
  }
  let out;
  try {
    out = await callSheet(envFn, fetchImpl, { action: 'weights-save', athleteId: body.athleteId, lb: String(body.lb).slice(0, 12), coachName: who.name || 'Coach' });
  } catch (err) {
    console.error('weights save error:', err.message);
    return json({ error: 'The Sheet did not answer, so nothing was saved. Try again in a minute.' }, 502);
  }
  if (out.status === 'invalid') return json({ error: out.message }, 422);
  if (out.status !== 'ok') {
    console.error('weights save said:', out.error);
    return json({ error: 'The Sheet could not save that. Nothing was changed.' }, 502);
  }
  return json({ today: out.today, yearStart: out.yearStart, rows: out.rows });
}

export default (req) => handleWeights(req, env);

export const config = { path: '/api/weights', method: ['GET', 'POST'] };
