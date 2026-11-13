// Coaches, managed by the admin only (David, 2026-11-13). The admin is the name in the Netlify setting ADMIN_COACH.
// GET lists coaches; POST { add: "First Last" } makes a coach with a random temporary password (shown once, changed at first
// sign-in); POST { reset: key } makes a new temporary password; POST { remove: key } deletes the coach, who is signed out on their
// next request (lib/auth.mjs liveSession). A coach is a record in the Blobs store `coachpw`; nothing about coaches goes to the Sheet.
// Without ADMIN_COACH set this answers 404 and the older Sheet-based coach list keeps working.
import { liveSession, adminKey, nameKey, displayName } from '../lib/auth.mjs';
import { getFeed } from '../lib/feed.mjs';
import { defaultCoachStore, setCoachPassword, generateTempPassword, coachesWithPassword, resetCoachPassword } from '../lib/coachpw.mjs';

const env = (k) => Netlify.env.get(k);
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function handleCoaches(req, envFn, deps = {}) {
  const admin = adminKey(envFn);
  if (!admin) return json({ error: 'Not found' }, 404);
  const who = await liveSession(envFn, req, deps);
  if (!who) return json({ error: 'signin' }, 401);
  if (who.kind !== 'team') return json({ error: 'Coaches only.' }, 403);
  if (!who.admin) return json({ error: 'Only the admin can manage coaches.' }, 403);
  const store = deps.coachStore === undefined ? await defaultCoachStore() : deps.coachStore;
  if (req.method === 'GET') {
    if (!store) return json({ admin: displayName(admin), coaches: [] });
    try {
      const list = (await coachesWithPassword(store)).filter((c) => c.key !== admin);
      return json({ admin: displayName(admin), coaches: list.map((c) => ({ key: c.key, name: displayName(c.key), status: c.temp ? 'temporary' : 'set', updatedAt: c.updatedAt })) });
    } catch (err) {
      console.error('coach list error:', err.message);
      return json({ error: 'The list could not be loaded. Try again in a minute.' }, 502);
    }
  }
  if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
  const origin = req.headers.get('origin');
  if (!/^application\/json/i.test(req.headers.get('content-type') || '') || (origin && origin !== new URL(req.url).origin)) {
    return json({ error: 'Bad request.' }, 400);
  }
  if (!store) return json({ error: 'Coaches cannot be changed right now.' }, 503);
  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  const fail502 = (err, what) => { console.error(what + ' error:', err.message); return json({ error: 'That did not work. Try again in a minute.' }, 502); };

  if (typeof body.remove === 'string') {
    const key = nameKey(body.remove);
    if (!key || key === admin) return json({ error: 'Pick a coach.' }, 400);
    let had;
    try { had = await resetCoachPassword(store, key); } catch (err) { return fail502(err, 'coach remove'); }
    console.log('coach removed:', JSON.stringify({ coach: displayName(key), by: who.name, had }));
    return had ? json({ ok: true, name: displayName(key) }) : json({ error: 'That coach is not on the list.' }, 404);
  }

  if (typeof body.reset === 'string') {
    const key = nameKey(body.reset);
    if (!key || key === admin) return json({ error: 'Pick a coach.' }, 400);
    let exists;
    try { exists = (await coachesWithPassword(store)).some((c) => c.key === key); } catch (err) { return fail502(err, 'coach reset'); }
    if (!exists) return json({ error: 'That coach is not on the list.' }, 404);
    const password = generateTempPassword();
    try { await setCoachPassword(store, key, password, { temp: true }); } catch (err) { return fail502(err, 'coach reset'); }
    console.log('coach password reset:', JSON.stringify({ coach: displayName(key), by: who.name }));
    return json({ ok: true, name: displayName(key), password });
  }

  if (typeof body.add === 'string') {
    const name = displayName(body.add), key = nameKey(name);
    if (key.split(' ').length < 2) return json({ error: 'Type the coach\'s first and last name.' }, 400);
    if (key === admin) return json({ error: 'That is you. The admin is already a coach.' }, 400);
    let feed, exists;
    try {
      feed = (await getFeed(envFn, deps)).data;
      exists = (await coachesWithPassword(store)).some((c) => c.key === key);
    } catch (err) { return fail502(err, 'coach add'); }
    // Sign-in sends a name that is on the Roster down the athlete path, so a coach cannot share an athlete's name.
    if (feed.athletes.some((a) => nameKey(a.name) === key)) return json({ error: 'An athlete on the Roster has that name. Use a different spelling, such as adding a middle initial.' }, 409);
    if (exists) return json({ error: 'That coach is already on the list.' }, 409);
    const password = generateTempPassword();
    try { await setCoachPassword(store, key, password, { temp: true }); } catch (err) { return fail502(err, 'coach add'); }
    console.log('coach added:', JSON.stringify({ coach: name, by: who.name }));
    return json({ ok: true, name, password });
  }
  return json({ error: 'Nothing to do.' }, 400);
}

export default (req) => handleCoaches(req, env);

export const config = { path: '/api/coaches', method: ['GET', 'POST'], rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
