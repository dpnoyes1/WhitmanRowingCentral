import { passwordMatches, sessionSecret, makeToken, sessionCookie, clearCookie } from '../lib/auth.mjs';

const env = (k) => Netlify.env.get(k);
const json = (body, status = 200, headers = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

export default async (req) => {
  if (new URL(req.url).pathname === '/api/logout') {
    return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
  }
  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  const secret = sessionSecret(env);
  if (!secret) return json({ error: 'The site is not set up yet (missing TEAM_PASSWORD or FEED_KEY).' }, 500);
  if (!passwordMatches(env, body.password)) {
    await new Promise((r) => setTimeout(r, 600));   // slows down guessing
    return json({ error: 'That password is not right.' }, 401);
  }
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(makeToken(secret)) });
};

export const config = {
  path: ['/api/login', '/api/logout'],
  method: 'POST',
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
