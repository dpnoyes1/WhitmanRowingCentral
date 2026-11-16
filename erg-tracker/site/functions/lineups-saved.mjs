// Saved lineups for a practice (on-water plan Step 1). Coaches only. Reads and writes the Sheet's Lineups tab through the feed key
// (apps-script/Lineups.gs), never the cached feed, so lineups never reach athletes. GET ?date=YYYY-MM-DD lists that day;
// POST { date, shift, boats } replaces that practice's boats (an empty list clears it).
import { liveSession } from '../lib/auth.mjs';
import { callSheet } from '../lib/slack.mjs';

const env = (k) => Netlify.env.get(k);
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = (v) => (typeof v === 'string' && v.length <= 20 ? v.trim() : '');

/** Only the fields the Sheet reads, each trimmed and capped; anything else in the request is dropped. */
export function cleanLineupsBody(body) {
  if (!body || typeof body !== 'object' || !DAY.test(String(body.date || '')) || typeof body.shift !== 'string' || !Array.isArray(body.boats) || body.boats.length > 12) return null;
  return {
    date: body.date, shift: body.shift.slice(0, 10),
    boats: body.boats.map((b) => ({
      lineupId: ID(b && b.lineupId), boatName: String((b && b.boatName) || '').slice(0, 40), boatClass: String((b && b.boatClass) || '').slice(0, 3),
      seats: Array.isArray(b && b.seats) ? b.seats.slice(0, 8).map(ID) : [], cox: ID(b && b.cox),
      fromPiece: b && (typeof b.fromPiece === 'number' || /^\d{1,2}$/.test(String(b.fromPiece))) ? Number(b.fromPiece) : '',
    })),
  };
}

export async function handleLineupsSaved(req, envFn, deps = {}) {
  const who = await liveSession(envFn, req, deps);
  if (!who) return json({ error: 'signin' }, 401);
  if (who.kind !== 'team') return json({ error: 'Coaches only.' }, 403);
  const fetchImpl = deps.fetchImpl || fetch;
  const reply = (out) => ({ date: out.date, lineups: out.lineups || [], days: out.days || [], coxes: out.coxes || [], saved: out.saved || null });
  if (req.method === 'GET') {
    const date = new URL(req.url).searchParams.get('date') || '';
    if (date && !DAY.test(date)) return json({ error: 'Bad date.' }, 400);
    try {
      return json(reply(await callSheet(envFn, fetchImpl, { action: 'lineups-list', date })));
    } catch (err) {
      console.error('lineups read error:', err.message);
      return json({ error: 'The Sheet did not answer. Try again in a minute.' }, 502);
    }
  }
  if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
  const origin = req.headers.get('origin');
  if (!/^application\/json/i.test(req.headers.get('content-type') || '') || (origin && origin !== new URL(req.url).origin)) return json({ error: 'Bad request.' }, 400);
  let body = null;
  try { body = cleanLineupsBody(await req.json()); } catch { body = null; }
  if (!body) return json({ error: 'Nothing to save.' }, 400);
  let out;
  try {
    out = await callSheet(envFn, fetchImpl, { action: 'lineups-save', ...body, coachName: who.name || 'Coach' });
  } catch (err) {
    console.error('lineups save error:', err.message);
    return json({ error: 'The Sheet did not answer, so nothing was saved. Try again in a minute.' }, 502);
  }
  if (out.status === 'invalid') return json({ error: out.message }, 422);
  if (out.status !== 'ok') return json({ error: 'The Sheet could not save that. Nothing was changed.' }, 502);
  return json(reply(out));
}

export default (req) => handleLineupsSaved(req, env);

export const config = { path: '/api/lineups/saved', method: ['GET', 'POST'] };
