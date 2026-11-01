import { session } from '../lib/auth.mjs';
import { getFeed } from '../lib/feed.mjs';
import { todayIn } from '../lib/stats.mjs';
import { callSheet } from '../lib/slack.mjs';
import { teamView, teamSplitsView, athleteView, leaderboardsView, starsView, oyoView, weekView, insightsView, workoutView, balanceView } from '../lib/views.mjs';

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
  // A cookie lasts a year; an athlete dropped from the Roster or set inactive is signed out of every route, not just the page.
  if (who.kind === 'athlete' && !data.athletes.some((x) => x.id === who.id && x.active)) return json({ error: 'signin' }, 401);

  if (path === '/api/session') {
    const a = who.kind === 'athlete' && data.athletes.find((x) => x.id === who.id);
    return json({ kind: who.kind, athlete: a ? { id: a.id, name: a.name, squad: a.squad } : null, meta });
  }
  // Coach split averages on the Team page: coaches only (David, 2026-10-25).
  if (path === '/api/team') return json({ ...teamView(data, today), ...(who.kind === 'team' ? { splits: teamSplitsView(data, today) } : {}), meta });
  if (path === '/api/leaderboards') return json({ ...leaderboardsView(data, today), meta });
  // Star rankings are coaches only (David, 2026-10-23); stars next to names stay public.
  if (path === '/api/stars') return who.kind === 'team' ? json({ ...starsView(data, today), meta }) : json({ error: 'Coaches only.' }, 403);
  // Load flags, consistency table and trends for every rower: coaches only (David, 2026-10-23).
  if (path === '/api/insights') return who.kind === 'team' ? json({ ...insightsView(data, today), meta }) : json({ error: 'Coaches only.' }, 403);
  // 100m / 2k / 20' watts balance beside Paul's Law: coaches only, nothing for athletes (David, 2026-10-27).
  if (path === '/api/balance') return who.kind === 'team' ? json({ ...balanceView(data, today), meta }) : json({ error: 'Coaches only.' }, 403);
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
    const { todayPlan, insights, workouts, pacing, gmsSummary, ...rest } = view;
    return json({ ...rest, gms: own || coach ? view.gms : view.gms.map((g) => ({ test: g.test, stars: g.stars })), todayPlan: own || coach ? todayPlan : [],
      insights: coach ? insights : own ? ownInsights(insights) : null, workouts: own || coach ? workouts : [], pacing: own || coach ? pacing : [], gmsSummary: own || coach ? gmsSummary : null, own, coach, meta });
  }
  // One logged workout: her own (or any, for coaches). Splits and targets come with it (David, 2026-10-25).
  const wk = path.match(/^\/api\/workout\/([A-Za-z0-9_-]+)$/);
  if (wk) {
    const entry = data.entries.find((x) => x.id === wk[1]);
    if (!entry || !(coach || (who.kind === 'athlete' && who.id === entry.athleteId))) return json({ error: 'No workout with that ID.' }, 404);
    return json({ ...workoutView(data, wk[1], today), meta });
  }
  // The kept copy of the erg-screen photo for one workout, visible to everyone signed in (David, 2026-10-28: all photos are team-visible). The Drive folder is private; the
  // Sheet's script hands the file to this function, which passes it on to a signed-in person. It is only asked for when a workout is opened.
  const ph = path.match(/^\/api\/photo\/([A-Za-z0-9_-]+)$/);
  if (ph) {
    const entry = data.entries.find((x) => x.id === ph[1]);
    if (!entry || !entry.hasPhoto) return json({ error: 'No photo for that workout.' }, 404);
    let out;
    try { out = await callSheet(envFn, deps.fetchImpl || fetch, { action: 'photo-get', entryId: entry.id }); } catch (err) {
      console.error('photo error:', err.message);
      return json({ error: 'The photo could not be loaded.' }, 502);
    }
    if (out.status !== 'ok') return json({ error: 'No photo for that workout.' }, 404);
    return new Response(Buffer.from(out.data, 'base64'), { headers: { 'content-type': out.mime || 'image/jpeg', 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' } });
  }
  return json({ error: 'Not found' }, 404);
}

/** Her own insights without the load-jump flag and trailing average, which are for coaches (David, 2026-10-23). */
function ownInsights(i) {
  const { jumpPct, ...rest } = i;
  return { ...rest, load: i.load.map((w) => ({ weekStart: w.weekStart, total: w.total, rpe: w.rpe, sessions: w.sessions })) };
}

export default (req) => handle(req, env);

export const config = { path: ['/api/team', '/api/athlete/:id', '/api/workout/:id', '/api/photo/:id', '/api/leaderboards', '/api/stars', '/api/oyo', '/api/insights', '/api/balance', '/api/week', '/api/week/:id', '/api/session'], method: 'GET' };
