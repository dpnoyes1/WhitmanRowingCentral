// POST /api/health { key }: for the Sheet's hourly check (apps-script/Ops.gs),
// which alerts David when the feed or sign-in breaks. Needs FEED_KEY, so the
// public gets nothing; the answer has counts and times only, no names or codes.
import { sessionSecret } from '../lib/auth.mjs';
import { getFeed } from '../lib/feed.mjs';
import { createHash, timingSafeEqual } from 'node:crypto';

const env = (k) => Netlify.env.get(k);
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const digest = (s) => createHash('sha256').update(String(s || '')).digest();

export async function handleHealth(req, envFn, deps = {}) {
  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  const key = envFn('FEED_KEY');
  if (!key || !timingSafeEqual(digest(key), digest(body.key))) return json({ error: 'unauthorized' }, 401);

  const checks = { env: !!(sessionSecret(envFn) && envFn('FEED_URL')) };
  const out = { checks };
  try {
    const feed = await getFeed(envFn, deps);
    const logins = feed.data.logins || [];
    out.generatedAt = feed.data.generatedAt;
    out.feedVersion = feed.data.version;
    out.athletes = feed.data.athletes.length;
    out.athleteCodes = logins.filter((l) => !l.coach).length;
    out.coachCodes = logins.filter((l) => l.coach).length;
    checks.feed = true;
    checks.fresh = !feed.stale;
    checks.athleteLogins = out.athletes === 0 || out.athleteCodes > 0;
  } catch (err) {
    checks.feed = false;
    out.feedError = err.message;
  }
  out.ok = Object.values(checks).every(Boolean);
  return json(out, out.ok ? 200 : 503);
}

export default (req) => handleHealth(req, env);

export const config = { path: '/api/health', method: 'POST' };
