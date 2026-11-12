// Coach "Log for an athlete" (David, 2026-11-11). POST only, coaches only. Goes to the Sheet's `site-log`
// action (apps-script/SiteLog.gs), which runs the same parser as the Form and /log. The Sheet checks every value.
import { session } from '../lib/auth.mjs';
import { callSheet } from '../lib/slack.mjs';
import { prepPhoto } from '../lib/logphoto.mjs';

const env = (k) => Netlify.env.get(k);
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

const FIELDS = ['date', 'type', 'status', 'makeup_for', 'activity', 'pieces', 'warmup', 'cooldown', 'rpe', 'drag', 'main_set', 'zone', 'note', 'test', 'test_where'];

export async function handleLog(req, envFn, deps = {}) {
  const who = session(envFn, req);
  if (!who) return json({ error: 'signin' }, 401);
  if (who.kind !== 'team') return json({ error: 'Coaches only.' }, 403);
  if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
  const origin = req.headers.get('origin');
  if (!/^application\/json/i.test(req.headers.get('content-type') || '') || (origin && origin !== new URL(req.url).origin)) {
    return json({ error: 'Bad request.' }, 400);
  }
  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  const f = body.form;
  if (typeof body.athleteId !== 'string' || !body.athleteId || body.athleteId.length > 20 || !f || typeof f !== 'object' || Array.isArray(f)) return json({ error: 'Nothing to save.' }, 400);
  const form = {};
  for (const k of FIELDS) {
    if (f[k] === undefined || f[k] === null || f[k] === '') continue;
    if (typeof f[k] !== 'string' || f[k].length > 600) return json({ error: 'Nothing to save.' }, 400);
    form[k] = f[k];
  }
  const pp = await prepPhoto(body.photo, deps);
  if (pp.error) return json({ error: pp.error }, pp.status);
  const photo = pp.photo;
  const requestId = typeof body.requestId === 'string' ? body.requestId.slice(0, 60) : '';
  let out;
  try {
    out = await callSheet(envFn, deps.fetchImpl || fetch, { action: 'site-log', athleteId: body.athleteId, coachName: who.name || 'Coach', requestId, form, ...(photo ? { photo } : {}) });
  } catch (err) {
    console.error('site log error:', err.message);
    return json({ error: 'The Sheet did not answer, so nothing was saved. Try again in a minute.' }, 502);
  }
  if (out.status === 'invalid') return json({ error: out.message }, 422);
  if (out.status === 'duplicate') return json({ status: 'duplicate' });
  if (out.status !== 'ok') {
    console.error('site log said:', out.error);
    return json({ error: 'The Sheet could not save that. Nothing was changed.' }, 502);
  }
  return json({ status: 'ok', athlete: out.athlete, test: out.test, sessionType: out.sessionType, photo: photo ? (out.photo || 'saved') : '' });
}

export default (req) => handleLog(req, env);

export const config = { path: '/api/log', method: 'POST' };
