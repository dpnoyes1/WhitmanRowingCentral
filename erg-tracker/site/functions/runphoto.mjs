// Reads a run screenshot for the athlete's Log activity page and sends back distance and time to fill in (David, 2026-11-17).
// Live; answers 404 whenever RUN_PHOTO_CHECK in lib/runscreen.mjs is false. Athletes only; nothing is saved here, the
// athlete checks the numbers and saves through /api/log-mine as before. A failed read is a normal answer, never an error page.
import { liveSession, athleteStillActive } from '../lib/auth.mjs';
import { anthropicClient } from '../lib/slackphoto.mjs';
import { RUN_PHOTO_CHECK, readRunScreen } from '../lib/runscreen.mjs';

const env = (k) => Netlify.env.get(k);
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
const fmtClock = (s) => `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${String(Math.floor(s % 3600 / 60)).padStart(Math.floor(s / 3600) ? 2 : 1, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** A read -> what the form fills in. Distance keeps the unit the screen used when it is mi, km or m. */
export function fillFromRead(read) {
  const out = { dist: '', unit: '', time: '', hr: '', hrEstimated: false, flags: read.flags || [], person: read.person || '', activity: read.activity || '' };
  if (read.meters) {
    const unit = read.unit || 'mi';
    out.unit = unit;
    out.dist = String(Math.round(read.meters / (unit === 'mi' ? 1609.344 : unit === 'km' ? 1000 : 1) * 100) / 100);
  }
  const t = read.movingS || read.elapsedS;
  if (t > 0) out.time = fmtClock(t);
  if (read.avgHr > 0) { out.hr = String(read.avgHr); out.hrEstimated = !!read.hrEstimated; }
  return out;
}

export async function handleRunPhoto(req, envFn, deps = {}) {
  if (!(deps.enabled ?? RUN_PHOTO_CHECK)) return json({ error: 'Not found' }, 404);
  const who = await liveSession(envFn, req, deps);
  if (!who) return json({ error: 'signin' }, 401);
  if (who.kind !== 'athlete') return json({ error: 'This page is for athletes.' }, 403);
  try { if (!(await athleteStillActive(envFn, who, deps))) return json({ error: 'signin' }, 401); } catch (err) {
    console.error('feed error:', err.message);
    return json({ error: 'The team data could not be loaded. Try again in a minute.' }, 502);
  }
  if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
  const origin = req.headers.get('origin');
  if (!/^application\/json/i.test(req.headers.get('content-type') || '') || (origin && origin !== new URL(req.url).origin)) return json({ error: 'Bad request.' }, 400);
  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  const raw = body.photo;
  if (typeof raw !== 'string' || raw.length > 6_000_000 || !/^[A-Za-z0-9+/=]+$/.test(raw)) return json({ error: 'That photo could not be used.' }, 400);
  const key = envFn('ANTHROPIC_API_KEY');
  const client = deps.client || (key ? anthropicClient(key, deps.fetchImpl || fetch) : null);
  if (!client) return json({ status: 'unread' });
  const out = await readRunScreen({ client, bytes: Buffer.from(raw, 'base64') });
  if (!out.ok) { console.error('run photo read failed:', out.reason); return json({ status: 'unread' }); }
  const fill = fillFromRead(out.read);
  if (!fill.dist && !fill.time && !fill.hr) return json({ status: 'unread', flags: fill.flags });
  return json({ status: 'read', ...fill });
}

export default (req) => handleRunPhoto(req, env);

export const config = { path: '/api/run-photo', method: 'POST' };
