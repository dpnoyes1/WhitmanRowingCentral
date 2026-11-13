// Athlete password reset (David, 2026-11-12): coaches only. GET lists active athletes and whether each has set a
// password of her own; POST { reset: athleteId } makes a random temporary password, returns it ONCE for the coach to
// hand over, and marks it so the athlete must choose her own at her next sign-in. Hashes live in Netlify Blobs
// store `athletepw`; nothing about passwords goes to the Sheet or the feed.
import { liveSession } from '../lib/auth.mjs';
import { getFeed } from '../lib/feed.mjs';
import { defaultAthleteStore, setCoachPassword, generateTempPassword, coachesWithPassword } from '../lib/coachpw.mjs';

const env = (k) => Netlify.env.get(k);
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function handleAthletePasswords(req, envFn, deps = {}) {
  const who = await liveSession(envFn, req, deps);
  if (!who) return json({ error: 'signin' }, 401);
  if (who.kind !== 'team') return json({ error: 'Coaches only.' }, 403);
  const store = deps.athleteStore === undefined ? await defaultAthleteStore() : deps.athleteStore;
  let feed;
  try { feed = (await getFeed(envFn, deps)).data; } catch (err) {
    console.error('athlete passwords feed error:', err.message);
    return json({ error: 'The roster could not be loaded. Try again in a minute.' }, 502);
  }
  const active = feed.athletes.filter((a) => a.active);
  if (req.method === 'GET') {
    let have = [];
    try { have = await coachesWithPassword(store); } catch (err) {
      console.error('athlete passwords list error:', err.message);
      return json({ error: 'The list could not be loaded. Try again in a minute.' }, 502);
    }
    const by = new Map(have.map((h) => [h.key, h]));
    const athletes = active.map((a) => {
      const h = by.get(a.id);
      return { id: a.id, name: a.name, status: !h ? 'birthday' : h.temp ? 'temporary' : 'set', updatedAt: h ? h.updatedAt : null };
    }).sort((x, y) => x.name.localeCompare(y.name));
    return json({ athletes });
  }
  if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
  const origin = req.headers.get('origin');
  if (!/^application\/json/i.test(req.headers.get('content-type') || '') || (origin && origin !== new URL(req.url).origin)) {
    return json({ error: 'Bad request.' }, 400);
  }
  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  const a = active.find((x) => x.id === body.reset);
  if (!a) return json({ error: 'Pick an athlete on the roster.' }, 400);
  if (!store) return json({ error: 'Passwords cannot be changed right now.' }, 503);
  const password = generateTempPassword();
  try { await setCoachPassword(store, a.id, password, { temp: true }); } catch (err) {
    console.error('athlete reset error:', err.message);
    return json({ error: 'That did not work. Try again in a minute.' }, 502);
  }
  // Names only, never a password; shows in the Netlify function log.
  console.log('athlete password reset:', JSON.stringify({ athlete: a.name, by: who.name }));
  return json({ ok: true, name: a.name, password });
}

export default (req) => handleAthletePasswords(req, env);

export const config = { path: '/api/athlete-passwords', method: ['GET', 'POST'], rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
