import { signedIn } from '../lib/auth.mjs';
import { getFeed } from '../lib/feed.mjs';
import { todayIn } from '../lib/stats.mjs';
import { teamView, athleteView } from '../lib/views.mjs';

const env = (k) => Netlify.env.get(k);
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

export async function handle(req, envFn, deps = {}) {
  if (!signedIn(envFn, req)) return json({ error: 'signin' }, 401);
  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  let feed;
  try {
    feed = await getFeed(envFn, deps);
  } catch (err) {
    console.error('feed error:', err.message);
    return json({ error: 'The team data could not be loaded. Try again in a minute.' }, 502);
  }
  const data = feed.data;
  const today = deps.today || todayIn(data.settings.timezone || 'America/New_York');
  const meta = { generatedAt: data.generatedAt, stale: feed.stale };

  if (path === '/api/team') return json({ ...teamView(data, today), meta });
  const m = path.match(/^\/api\/athlete\/([A-Za-z0-9-]+)$/);
  if (m) {
    const view = athleteView(data, m[1], today);
    return view ? json({ ...view, meta }) : json({ error: 'No athlete with that ID.' }, 404);
  }
  return json({ error: 'Not found' }, 404);
}

export default (req) => handle(req, env);

export const config = { path: ['/api/team', '/api/athlete/:id'], method: 'GET' };
