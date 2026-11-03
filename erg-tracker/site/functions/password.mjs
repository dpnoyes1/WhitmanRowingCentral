// Coach password change (David, 2026-11-03): POST /api/password { current, next }.
// Only a coach who signed in with a name can use it. The current password is her personal
// password if she has one, otherwise her birthday. The new one is kept as a salted hash in Netlify Blobs.
import { session, athleteFor, nameKey } from '../lib/auth.mjs';
import { getFeed } from '../lib/feed.mjs';
import { defaultCoachStore, checkCoachPassword, setCoachPassword, passwordProblem } from '../lib/coachpw.mjs';

const env = (k) => Netlify.env.get(k);
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function handlePassword(req, envFn, deps = {}) {
  const who = session(envFn, req);
  if (!who) return json({ error: 'signin' }, 401);
  if (who.kind !== 'team') return json({ error: 'Coaches only.' }, 403);
  // A form on another site cannot send JSON, so this also stops other sites from changing it for a signed-in coach.
  const origin = req.headers.get('origin');
  if (!/^application\/json/i.test(req.headers.get('content-type') || '') || (origin && origin !== new URL(req.url).origin)) {
    return json({ error: 'Bad request.' }, 400);
  }
  if (!who.name) return json({ error: 'Sign out, then sign in with your name and birthday to set your own password.' }, 400);
  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  const current = String(body.current || '').trim(), next = String(body.next || '');
  const problem = passwordProblem(next);
  if (problem) return json({ error: problem }, 400);
  const store = deps.coachStore === undefined ? await defaultCoachStore() : deps.coachStore;
  if (!store) return json({ error: 'Passwords cannot be saved right now.' }, 503);
  const key = nameKey(who.name);
  let ok;
  try {
    const own = await checkCoachPassword(store, key, current);
    if (own !== null) ok = own;
    else ok = athleteFor(envFn, (await getFeed(envFn, deps)).data, who.name, current) === 'team';
  } catch (err) {
    console.error('password check error:', err.message);
    return json({ error: 'That did not work. Try again in a minute.' }, 502);
  }
  if (!ok) {
    await new Promise((r) => setTimeout(r, deps.failDelayMs ?? 600));
    return json({ error: 'Your current password is not right. If you have not set one yet, it is your birthday (MM/DD/YYYY).' }, 403);
  }
  try { await setCoachPassword(store, key, next); } catch (err) {
    console.error('password save error:', err.message);
    return json({ error: 'The new password could not be saved. Try again.' }, 502);
  }
  return json({ ok: true });
}

export default (req) => handlePassword(req, env);

export const config = { path: '/api/password', method: 'POST', rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
