// An athlete logs her own run, ride, swim and so on (David, 2026-11-12). POST only, athletes only, always for herself:
// the athlete ID comes from her sign-in, never from the request. Erg workouts and tests are not allowed here (they come from
// Concept2 Logbook, Slack or the Form). Goes to the Sheet's `site-log` action with self = true, which checks the form again.
import { liveSession, athleteStillActive } from '../lib/auth.mjs';
import { callSheet } from '../lib/slack.mjs';
import { prepPhoto } from '../lib/logphoto.mjs';

const env = (k) => Netlify.env.get(k);
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

const FIELDS = ['date', 'type', 'activity', 'pieces', 'rpe', 'note'];
const ACTIVITIES = ['Run', 'Bike', 'Stair stepper', 'Swim', 'Elliptical'];
const MAX_DAYS_BACK = 14;

export async function handleLogMine(req, envFn, deps = {}) {
  const who = await liveSession(envFn, req, deps);
  if (!who) return json({ error: 'signin' }, 401);
  if (who.kind !== 'athlete') return json({ error: 'This page is for athletes.' }, 403);
  // A cookie lasts a year; an athlete set inactive on the Roster is signed out here too (David, 2026-11-13).
  try { if (!(await athleteStillActive(envFn, who, deps))) return json({ error: 'signin' }, 401); } catch (err) {
    console.error('feed error:', err.message);
    return json({ error: 'The team data could not be loaded. Try again in a minute.' }, 502);
  }
  if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
  const origin = req.headers.get('origin');
  if (!/^application\/json/i.test(req.headers.get('content-type') || '') || (origin && origin !== new URL(req.url).origin)) {
    return json({ error: 'Bad request.' }, 400);
  }
  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  const f = body.form;
  if (!f || typeof f !== 'object' || Array.isArray(f)) return json({ error: 'Nothing to save.' }, 400);
  const form = {};
  for (const k of FIELDS) {
    if (f[k] === undefined || f[k] === null || f[k] === '') continue;
    if (typeof f[k] !== 'string' || f[k].length > 600) return json({ error: 'Nothing to save.' }, 400);
    form[k] = f[k];
  }
  if (!ACTIVITIES.includes(form.activity)) return json({ error: 'Choose a run, bike, swim or another activity that is not on an erg.' }, 422);
  if (form.type !== 'oyo' && form.type !== 'practice') return json({ error: 'Choose On my own or At practice.' }, 422);
  const now = deps.now ? deps.now() : Date.now();
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(form.date || '');
  const t = day ? Date.UTC(+day[1], +day[2] - 1, +day[3]) : NaN;
  if (!(t <= now + 86400000) || !(t >= now - (MAX_DAYS_BACK + 1) * 86400000)) return json({ error: `Pick a date from the last ${MAX_DAYS_BACK} days.` }, 422);
  const pp = await prepPhoto(body.photo, deps);
  if (pp.error) return json({ error: pp.error }, pp.status);
  const requestId = typeof body.requestId === 'string' ? body.requestId.slice(0, 60) : '';
  let out;
  try {
    out = await callSheet(envFn, deps.fetchImpl || fetch, { action: 'site-log', self: true, athleteId: who.id, requestId, form, ...(pp.photo ? { photo: pp.photo } : {}) });
  } catch (err) {
    console.error('log mine error:', err.message);
    return json({ error: 'The Sheet did not answer, so nothing was saved. Try again in a minute.' }, 502);
  }
  if (out.status === 'invalid') return json({ error: out.message }, 422);
  if (out.status === 'duplicate') return json({ status: 'duplicate' });
  if (out.status !== 'ok') {
    console.error('log mine said:', out.error);
    return json({ error: 'The Sheet could not save that. Nothing was changed.' }, 502);
  }
  return json({ status: 'ok', photo: pp.photo ? (out.photo || 'saved') : '' });
}

export default (req) => handleLogMine(req, env);

export const config = { path: '/api/log-mine', method: 'POST' };
