import { session } from '../lib/auth.mjs';
import { getFeed } from '../lib/feed.mjs';
import { todayIn } from '../lib/stats.mjs';
import { teamView, athleteView, leaderboardsView, starsView, oyoView, weekView } from '../lib/views.mjs';

const env = (k) => Netlify.env.get(k);
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

export async function handle(req, envFn, deps = {}) {
  const who = session(envFn, req);
  if (!who) return json({ error: 'signin' }, 401);
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

  if (path === '/api/session') {
    const a = who.kind === 'athlete' && data.athletes.find((x) => x.id === who.id);
    if (who.kind === 'athlete' && !a) return json({ error: 'signin' }, 401);   // dropped from the Roster
    return json({ kind: who.kind, athlete: a ? { id: a.id, name: a.name, squad: a.squad } : null, meta });
  }
  if (path === '/api/team') return json({ ...teamView(data, today), meta });
  if (path === '/api/leaderboards') return json({ ...leaderboardsView(data, today), meta });
  if (path === '/api/stars') return json({ ...starsView(data, today), meta });
  if (path === '/api/oyo') return json({ ...oyoView(data, today), meta });
  if (path === '/api/week') return json({ ...weekView(data, today, who.kind === 'athlete' ? who.id : null), meta });
  const w = path.match(/^\/api\/week\/([A-Za-z0-9-]+)$/);
  if (w) {
    const view = weekView(data, today, w[1]);
    return view ? json({ ...view, meta }) : json({ error: 'No athlete with that ID.' }, 404);
  }
  const m = path.match(/^\/api\/athlete\/([A-Za-z0-9-]+)$/);
  if (m) {
    const view = athleteView(data, m[1], today);
    if (!view) return json({ error: 'No athlete with that ID.' }, 404);
    // GMS % to the athlete herself and to coaches (they see everything); teammates see stars only.
    const own = who.kind === 'athlete' && who.id === m[1];
    const coach = who.kind === 'team';
    return json({ ...view, gms: own || coach ? view.gms : view.gms.map((g) => ({ test: g.test, stars: g.stars })), own, coach, meta });
  }
  return json({ error: 'Not found' }, 404);
}

export default (req) => handle(req, env);

export const config = { path: ['/api/team', '/api/athlete/:id', '/api/leaderboards', '/api/stars', '/api/oyo', '/api/week', '/api/week/:id', '/api/session'], method: 'GET' };
