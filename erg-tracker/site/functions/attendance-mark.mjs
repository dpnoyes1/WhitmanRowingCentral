// Coach attendance override (David, 2026-11-18). POST only, coaches only. A coach changes one athlete's mark for
// one practice day to Completed, Modified or Missed (for example novices who showed up on a day with no workout to
// log). Goes to the Sheet's `attendance-mark` action (apps-script/AttendanceMark.gs), which checks the athlete, the
// practice day and the mark again and logs the change.
import { liveSession } from '../lib/auth.mjs';
import { callSheet } from '../lib/slack.mjs';

const env = (k) => Netlify.env.get(k);
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

export const MARKS = { completed: 'Full', modified: 'Modified', missed: 'Missed' };

export async function handleAttendanceMark(req, envFn, deps = {}) {
  const who = await liveSession(envFn, req, deps);
  if (!who) return json({ error: 'signin' }, 401);
  if (who.kind !== 'team') return json({ error: 'Coaches only.' }, 403);
  if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
  const origin = req.headers.get('origin');
  if (!/^application\/json/i.test(req.headers.get('content-type') || '') || (origin && origin !== new URL(req.url).origin)) {
    return json({ error: 'Bad request.' }, 400);
  }
  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  const mark = MARKS[body.mark];
  if (typeof body.athleteId !== 'string' || !body.athleteId || body.athleteId.length > 20 ||
      typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !mark ||
      (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 200))) {
    return json({ error: 'Pick an athlete, a practice day and a mark.' }, 400);
  }
  const requestId = typeof body.requestId === 'string' ? body.requestId.slice(0, 60) : '';
  let out;
  try {
    out = await callSheet(envFn, deps.fetchImpl || fetch, { action: 'attendance-mark', athleteId: body.athleteId, date: body.date, mark, note: (body.note || '').trim(), coachName: who.name || 'Coach', requestId });
  } catch (err) {
    console.error('attendance mark error:', err.message);
    return json({ error: 'The Sheet did not answer, so nothing was changed. Try again in a minute.' }, 502);
  }
  if (out.status === 'invalid') return json({ error: out.message }, 422);
  if (out.status === 'duplicate') return json({ status: 'duplicate' });
  if (out.status !== 'ok') {
    console.error('attendance mark said:', out.error);
    return json({ error: 'The Sheet could not save that. Nothing was changed.' }, 502);
  }
  return json({ status: 'ok', changed: out.changed || 0, created: !!out.created, message: out.message || '' });
}

export default (req) => handleAttendanceMark(req, env);

export const config = { path: '/api/attendance-mark', method: 'POST' };
