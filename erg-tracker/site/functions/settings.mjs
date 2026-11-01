// Coach Settings page (David, 2026-11-01). Reads and writes the Sheet's Settings
// tab through the feed key; the Sheet (apps-script/SettingsPage.gs) owns the list
// of fields and checks every value. Coaches only, and never from the cached
// feed: the page always shows what the Sheet holds right now.
import { session } from '../lib/auth.mjs';
import { callSheet } from '../lib/slack.mjs';

const env = (k) => Netlify.env.get(k);
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

export async function handleSettings(req, envFn, deps = {}) {
  const who = session(envFn, req);
  if (!who) return json({ error: 'signin' }, 401);
  if (who.kind !== 'team') return json({ error: 'Coaches only.' }, 403);
  const fetchImpl = deps.fetchImpl || fetch;
  if (req.method === 'GET') {
    try {
      const out = await callSheet(envFn, fetchImpl, { action: 'settings-get' });
      return json({ sections: out.sections });
    } catch (err) {
      console.error('settings read error:', err.message);
      return json({ error: 'The Sheet did not answer. Try again in a minute.' }, 502);
    }
  }
  if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
  // A form on another site cannot send JSON, so this also keeps other sites from saving for a signed-in coach.
  const origin = req.headers.get('origin');
  if (!/^application\/json/i.test(req.headers.get('content-type') || '') || (origin && origin !== new URL(req.url).origin)) {
    return json({ error: 'Bad request.' }, 400);
  }
  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  const c = body.changes;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return json({ error: 'Nothing to save.' }, 400);
  const keys = Object.keys(c);
  if (!keys.length || keys.length > 80 || keys.some((k) => typeof c[k] !== 'string' || c[k].length > 200)) {
    return json({ error: 'Nothing to save.' }, 400);
  }
  let out;
  try {
    out = await callSheet(envFn, fetchImpl, { action: 'settings-save', changes: c });
  } catch (err) {
    console.error('settings save error:', err.message);
    return json({ error: 'The Sheet did not answer, so nothing was saved. Try again in a minute.' }, 502);
  }
  if (out.status === 'invalid') return json({ error: 'Some values need fixing.', errors: out.errors }, 422);
  if (out.status !== 'ok') {
    console.error('settings save said:', out.error);
    return json({ error: 'The Sheet could not save that. Nothing was changed.' }, 502);
  }
  // Pages read the shared copy of the feed, which refreshes every 5 minutes, so a change reaches them within about that long.
  return json({ changed: out.changed, sections: out.sections });
}

export default (req) => handleSettings(req, env);

export const config = { path: '/api/settings', method: ['GET', 'POST'] };
