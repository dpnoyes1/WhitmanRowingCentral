import { session } from '../lib/auth.mjs';
import { getFeed } from '../lib/feed.mjs';
import { todayIn } from '../lib/stats.mjs';
import { teamView, teamSplitsView, athleteView, leaderboardsView, starsView, oyoView, weekView, insightsView } from '../lib/views.mjs';

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
  // Coach split averages on the Team page: coaches only (David, 2026-10-25).
  if (path === '/api/team') return json({ ...teamView(data, today), ...(who.kind === 'team' ? { splits: teamSplitsView(data, today) } : {}), meta });
  if (path === '/api/leaderboards') return json({ ...leaderboardsView(data, today), meta });
  // Star rankings are coaches only (David, 2026-10-23); stars next to names stay public.
  if (path === '/api/stars') return who.kind === 'team' ? json({ ...starsView(data, today), meta }) : json({ error: 'Coaches only.' }, 403);
  // Load flags, consistency table and trends for every rower: coaches only (David, 2026-10-23).
  if (path === '/api/insights') return who.kind === 'team' ? json({ ...insightsView(data, today), meta }) : json({ error: 'Coaches only.' }, 403);
  if (path === '/api/oyo') return json({ ...oyoView(data, today), meta });
  // Results vs goal: an athlete sees only her own; coaches see everyone's and can look back a week.
  const coach = who.kind === 'team';
  const offset = coach && new URL(req.url).searchParams.get('week') === 'prev' ? -1 : 0;
  if (path === '/api/week') {
    const view = coach ? weekView(data, today, null, { offset, results: 'all' }) : weekView(data, today, who.id, { results: 'own' });
    return json({ ...view, meta });
  }
  const w = path.match(/^\/api\/week\/([A-Za-z0-9-]+)$/);
  if (w) {
    const view = weekView(data, today, w[1], { offset, results: coach || (who.kind === 'athlete' && who.id === w[1]) ? 'own' : 'none' });
    return view ? json({ ...view, meta }) : json({ error: 'No athlete with that ID.' }, 404);
  }
  const m = path.match(/^\/api\/athlete\/([A-Za-z0-9-]+)$/);
  if (m) {
    const view = athleteView(data, m[1], today);
    if (!view) return json({ error: 'No athlete with that ID.' }, 404);
    // GMS % to the athlete herself and to coaches (they see everything); teammates see stars only.
    const own = who.kind === 'athlete' && who.id === m[1];
    const { todayPlan, insights, ...rest } = view;
    return json({ ...rest, gms: own || coach ? view.gms : view.gms.map((g) => ({ test: g.test, stars: g.stars })), todayPlan: own || coach ? todayPlan : [],
      insights: coach ? insights : own ? ownInsights(insights) : null, own, coach, meta });
  }
  return json({ error: 'Not found' }, 404);
}

/** Her own insights without the load-jump flag and trailing average, which are for coaches (David, 2026-10-23). */
function ownInsights(i) {
  const { jumpPct, ...rest } = i;
  return { ...rest, load: i.load.map((w) => ({ weekStart: w.weekStart, total: w.total, rpe: w.rpe, sessions: w.sessions })) };
}

export default (req) => handle(req, env);

export const config = { path: ['/api/team', '/api/athlete/:id', '/api/leaderboards', '/api/stars', '/api/oyo', '/api/insights', '/api/week', '/api/week/:id', '/api/session'], method: 'GET' };
