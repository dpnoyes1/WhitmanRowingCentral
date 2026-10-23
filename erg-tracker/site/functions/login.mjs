import { passwordMatches, sessionSecret, makeToken, sessionCookie, clearCookie, athleteFor } from '../lib/auth.mjs';
import { getFeed } from '../lib/feed.mjs';

const env = (k) => Netlify.env.get(k);
const json = (body, status = 200, headers = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

/**
 * POST /api/login { name, password }. An athlete types her name and her
 * birthday as the password; coaches use the coach password (TEAM_PASSWORD)
 * and no name is needed.
 */
export async function handleLogin(req, envFn, deps = {}) {
  if (new URL(req.url).pathname === '/api/logout') {
    return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
  }
  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  const secret = sessionSecret(envFn);
  if (!secret) return json({ error: 'The site is not set up yet (missing TEAM_PASSWORD or FEED_KEY).' }, 500);
  if (passwordMatches(envFn, body.password)) {
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(makeToken(secret, 'team')) });
  }
  let athlete = null;
  if (body.name) {
    try {
      athlete = athleteFor(envFn, (await getFeed(envFn, deps)).data, body.name, body.password);
    } catch (err) {
      console.error('feed error:', err.message);
      return json({ error: 'Sign-in is not working right now. Try again in a minute.' }, 502);
    }
  }
  if (!athlete) {
    await new Promise((r) => setTimeout(r, deps.failDelayMs ?? 600));   // slows down guessing
    return json({ error: "That name and password don't match. Use your first and last name." }, 401);
  }
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(makeToken(secret, athlete.id)) });
}

export default (req) => handleLogin(req, env);

export const config = {
  path: ['/api/login', '/api/logout'],
  method: 'POST',
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
