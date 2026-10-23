// Site tests against the dummy feed: `node erg-tracker/site/tests/run.mjs` (no dependencies).
import assert from 'node:assert';
import { createRequire } from 'node:module';
import * as S from '../lib/stats.mjs';
import { teamView, athleteView, leaderboardsView, starsView, oyoView, weekView, comingMonday } from '../lib/views.mjs';
import * as A from '../lib/auth.mjs';
import { getFeed, clearFeedCache } from '../lib/feed.mjs';
import { handle } from '../functions/api.mjs';
import login, { handleLogin } from '../functions/login.mjs';

const require = createRequire(import.meta.url);
const { dummyFeed, dummyBirthday } = require('../scripts/dummy-feed.js');
const feed = dummyFeed();
const TODAY = '2026-10-23';

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('dates', () => {
  assert.strictEqual(S.weekStart('2026-10-23'), '2026-10-19');
  assert.strictEqual(S.weekStart('2026-10-19'), '2026-10-19');
  assert.strictEqual(S.weekStart('2026-10-25'), '2026-10-19');
  assert.strictEqual(S.addDays('2026-10-30', 3), '2026-11-02');
  assert.strictEqual(S.daysBetween('2026-10-20', '2026-10-27'), 7);
  assert.strictEqual(S.schoolYearStart('2026-10-23'), '2026-08-01');
  assert.strictEqual(S.schoolYearStart('2027-03-01'), '2026-08-01');
  assert.strictEqual(S.todayIn('America/New_York', new Date('2026-10-23T03:00:00Z')), '2026-10-22');
});

test('weighted minutes: activity multiplier, modified practice, out', () => {
  const st = feed.settings;
  const base = { warmupS: 600, workS: 1800, restS: 0, cooldownS: 600, status: 'Full', type: 'OYO' };
  assert.strictEqual(S.rawMinutes(base), 50);
  assert.strictEqual(S.weightedMinutes({ ...base, activity: 'Run' }, st), 60);
  assert.strictEqual(S.weightedMinutes({ ...base, activity: 'Lifting' }, st), 0);
  assert.strictEqual(S.weightedMinutes({ ...base, type: 'Practice', status: 'Modified', activity: 'BikeErg' }, st), 50);
  assert.strictEqual(S.weightedMinutes({ ...base, type: 'Practice', status: 'Modified', activity: 'Bike' }, st), 30);
  assert.strictEqual(S.weightedMinutes({ ...base, type: 'Practice', status: 'Out' }, st), 0);
  assert.strictEqual(S.bucket({ type: 'Make-up' }), 'practice');
});

test('practice record: make-ups fill misses, today never counts as missed', () => {
  const madeUp = feed.entries.find((e) => e.type === 'Make-up');
  const a = feed.athletes.find((x) => x.id === madeUp.athleteId);
  const rec = S.practiceRecord(a, feed, TODAY);
  const r = rec.find((x) => x.date === madeUp.makeupFor);
  assert.ok(r && r.done && r.how === 'Make-up', JSON.stringify(r));
  feed.athletes.forEach((x) => S.practiceRecord(x, feed, TODAY).forEach((p) => assert.ok(p.done || p.date < TODAY)));
  assert.ok(rec.every((p) => p.date <= TODAY));
});

test('team view: three groups, averages only', () => {
  const t = teamView(feed, TODAY);
  assert.strictEqual(t.weekStart, '2026-10-19');
  assert.strictEqual(t.athletes.length, 30);
  assert.strictEqual(t.groups.all.rowers, 30);
  assert.strictEqual(t.groups.varsity.rowers + t.groups.novice.rowers, 30);
  const w = t.groups.all.week;
  assert.ok(w.completionPct > 50 && w.completionPct <= 100, w.completionPct);
  assert.ok(w.oyoMetRequired >= w.oyoElite && w.oyoMetRequired <= 30);
  assert.strictEqual(t.groups.all.weekly.length, 8);
  assert.ok(t.groups.all.weekly.at(-1).practiceAvg > 0);
  assert.ok(Object.values(t.groups.all.zones).some((z) => z > 0));
  assert.ok(t.recent.length > 0 && t.recent.every((r) => r.status !== 'Out'));
  assert.ok(!/gms|"weight(lb|s)?"|weight lb|birthday|stars/i.test(JSON.stringify(t)), 'no GMS or weight on the team view');
});

test('athlete view: bests, streaks, make-ups; GMS kept in its own field', () => {
  feed.athletes.forEach((a) => {
    const v = athleteView(feed, a.id, TODAY);
    assert.strictEqual(v.athlete.name, a.name);
    assert.ok(v.season.practicesDone <= v.season.practicesExpected);
    assert.ok(v.streaks.practices <= v.season.practicesExpected);
    v.openMakeups.forEach((m) => assert.ok(S.daysBetween(m.date, TODAY) <= 7));
    v.bests.forEach((b) => {
      const all = v.tests.filter((t) => t.test === b.test && t.valid).map((t) => t.result);
      const best = /min|30r20/.test(b.test) ? Math.max(...all) : Math.min(...all);
      assert.strictEqual(b.allTime.result, best);
    });
    const { gms, ...rest } = v;
    assert.ok(!/gms|"weight(lb|s)?"|weight lb|birthday|stars|nextStar/i.test(JSON.stringify(rest)), a.name);
    assert.ok(!/"weight(lb|s)?"|weight lb|birthday/i.test(JSON.stringify(gms)), a.name);
  });
  assert.strictEqual(athleteView(feed, 'A000', TODAY), null);
  const tested = feed.athletes.filter((a) => athleteView(feed, a.id, TODAY).bests.length > 0).length;
  assert.ok(tested >= 28, 'most athletes have bests: ' + tested);
});

test('leaderboards: ranked best valid result per athlete, raw scores only', () => {
  const v = leaderboardsView(feed, TODAY);
  const b2k = v.tests.find((t) => t.test === '2000m');
  assert.ok(b2k.season.length >= 25);
  b2k.season.forEach((r, i) => {
    assert.strictEqual(r.rank, i + 1);
    if (i) assert.ok(r.timeS >= b2k.season[i - 1].timeS);
    const mine = feed.benchmarks.filter((b) => b.athleteId === r.id && b.test === '2000m' && b.valid && b.date >= v.yearStart);
    assert.strictEqual(r.timeS, Math.min(...mine.map((b) => b.timeS)));
  });
  const m20 = v.tests.find((t) => t.test === '20min').allTime;
  m20.forEach((r, i) => { if (i) assert.ok(r.meters <= m20[i - 1].meters); });
  assert.ok(!/gms|weight/i.test(JSON.stringify(v)));
  const stars = starsView(feed, TODAY).rowers;
  b2k.season.forEach((r) => { const s = stars.find((x) => x.id === r.id); if (s) assert.strictEqual(r.stars, s.stars); });
});

test('stars board: stars public, GMS % never; team averages only', () => {
  const v = starsView(feed, TODAY);
  assert.strictEqual(v.rowers.length, 30);
  assert.ok(v.rowers.every((r) => r.stars === null || (r.stars >= 1 && r.stars <= 5)));
  assert.ok(new Set(v.rowers.map((r) => r.stars)).size >= 3, 'a spread of stars');
  const { teamGms, ...rest } = v;
  assert.ok(!/gmsPct|nextStar|weight/i.test(JSON.stringify(rest)));
  assert.ok(!/A9\d\d|name/.test(JSON.stringify(teamGms)), 'team GMS has no names or IDs');
});

test('OYO board: everyone, sorted by share of Required, statuses match goals', () => {
  const v = oyoView(feed, TODAY);
  assert.strictEqual(v.rowers.length, 30);
  v.rowers.forEach((r, i) => {
    assert.strictEqual(r.status, r.minutes >= r.elite ? 'elite' : r.minutes >= r.required ? 'required' : 'short');
    if (i) assert.ok(r.minutes / r.required <= v.rowers[i - 1].minutes / v.rowers[i - 1].required + 1e-9);
  });
  assert.strictEqual(v.lastWeekStart, '2026-10-12');
});

test('own-page GMS: next star in time or meters, never weight', () => {
  const withNext = feed.athletes.map((a) => athleteView(feed, a.id, TODAY).gms).flat().filter((g) => g.nextStar);
  assert.ok(withNext.length > 10);
  withNext.forEach((g) => {
    if (g.test === '2000m') assert.ok(g.nextStar.secondsFaster > 0 && g.nextStar.targetS < g.timeS);
    else assert.ok(g.nextStar.metersMore > 0 && g.nextStar.targetM > g.meters);
  });
});

test('auth: tokens, cookies, password', () => {
  const env = (k) => ({ TEAM_PASSWORD: 'fake-team-pw', FEED_KEY: 'fake-key' })[k];
  const secret = A.sessionSecret(env);
  const tok = A.makeToken(secret, 'team', 0);
  assert.deepStrictEqual(A.readToken(secret, tok, 1000), { kind: 'team' });
  assert.deepStrictEqual(A.readToken(secret, A.makeToken(secret, 'A901', 0), 1000), { kind: 'athlete', id: 'A901' });
  const forged = A.makeToken(secret, 'A901', 0).replace('ath:A901', 'ath:A902');
  assert.strictEqual(A.readToken(secret, forged, 1000), null, 'cannot swap the athlete');
  assert.ok(A.tokenValid(secret, tok, 1000));
  assert.ok(!A.tokenValid(secret, tok, (A.SESSION_DAYS + 1) * 86400000), 'expires');
  assert.ok(!A.tokenValid(secret, tok.slice(0, -2) + 'xx', 1000), 'tampered');
  assert.ok(!A.tokenValid(A.sessionSecret((k) => ({ TEAM_PASSWORD: 'new-pw', FEED_KEY: 'fake-key' })[k]), tok, 1000), 'rotated');
  assert.ok(A.passwordMatches(env, 'fake-team-pw'));
  assert.ok(!A.passwordMatches(env, 'fake-team-p'));
  assert.ok(!A.passwordMatches((k) => undefined, ''));
  assert.strictEqual(A.sessionSecret(() => undefined), null);
  const req = new Request('https://x/api/team', { headers: { cookie: 'a=1; ' + A.COOKIE + '=' + tok } });
  assert.strictEqual(A.readCookie(req), tok);
  assert.ok(/HttpOnly; Secure; SameSite=Lax/.test(A.sessionCookie(tok)));
});

test('feed: posts the key, caches 5 minutes, serves stale on error', async () => {
  clearFeedCache();
  const env = (k) => ({ FEED_URL: 'https://script.example/exec', FEED_KEY: 'fake-key' })[k];
  let calls = 0, fail = false;
  const fetchImpl = async (url, opts) => {
    calls++;
    assert.strictEqual(opts.method, 'POST');
    assert.strictEqual(JSON.parse(opts.body).key, 'fake-key');
    if (fail) throw new Error('down');
    return new Response(JSON.stringify(feed));
  };
  await getFeed(env, { fetchImpl, now: 0 });
  await getFeed(env, { fetchImpl, now: 60000 });
  assert.strictEqual(calls, 1);
  fail = true;
  const r = await getFeed(env, { fetchImpl, now: 6 * 60000 });
  assert.strictEqual(r.stale, true);
  await assert.rejects(getFeed(env, { fetchImpl, now: 25 * 3600000 }));
  clearFeedCache();
  await assert.rejects(getFeed(env, { fetchImpl: async () => new Response('{"error":"unauthorized"}'), now: 0 }), /unauthorized/);
  clearFeedCache();
});

test('api: 401 without a session, team and athlete with one', async () => {
  clearFeedCache();
  const env = (k) => ({ TEAM_PASSWORD: 'fake-team-pw', FEED_KEY: 'fake-key', FEED_URL: 'https://script.example/exec' })[k];
  const deps = { fetchImpl: async () => new Response(JSON.stringify(feed)), today: TODAY };
  let res = await handle(new Request('https://x/api/team'), env, deps);
  assert.strictEqual(res.status, 401);
  const cookie = A.COOKIE + '=' + A.makeToken(A.sessionSecret(env), 'team');
  res = await handle(new Request('https://x/api/team', { headers: { cookie } }), env, deps);
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).athletes.length, 30);
  res = await handle(new Request('https://x/api/athlete/A901', { headers: { cookie } }), env, deps);
  assert.strictEqual((await res.json()).athlete.id, 'A901');
  for (const p of ['/api/leaderboards', '/api/stars', '/api/oyo', '/api/week', '/api/week/A901']) {
    res = await handle(new Request('https://x' + p, { headers: { cookie } }), env, deps);
    assert.strictEqual(res.status, 200, p);
  }
  res = await handle(new Request('https://x/api/athlete/nope', { headers: { cookie } }), env, deps);
  assert.strictEqual(res.status, 404);
  res = await handle(new Request('https://x/api/week/nope', { headers: { cookie } }), env, deps);
  assert.strictEqual(res.status, 404);
  // Coach session: no athlete, and sees everything, GMS % included, on every page.
  res = await handle(new Request('https://x/api/session', { headers: { cookie } }), env, deps);
  assert.deepStrictEqual((await res.json()).athlete, null);
  const tested = starsView(feed, TODAY).rowers.find((r) => r.stars !== null);
  res = await handle(new Request('https://x/api/athlete/' + tested.id, { headers: { cookie } }), env, deps);
  let body = await res.json();
  assert.strictEqual(body.own, false);
  assert.strictEqual(body.coach, true);
  assert.ok(body.gms.some((g) => g.gmsPct > 0));
  // Athlete session: her own GMS %, only stars for a teammate, her week by default.
  const her = A.COOKIE + '=' + A.makeToken(A.sessionSecret(env), tested.id);
  res = await handle(new Request('https://x/api/session', { headers: { cookie: her } }), env, deps);
  assert.strictEqual((await res.json()).athlete.id, tested.id);
  res = await handle(new Request('https://x/api/athlete/' + tested.id, { headers: { cookie: her } }), env, deps);
  body = await res.json();
  assert.ok(body.own && body.gms.some((g) => g.gmsPct > 0));
  const mate = starsView(feed, TODAY).rowers.find((r) => r.stars !== null && r.id !== tested.id);
  res = await handle(new Request('https://x/api/athlete/' + mate.id, { headers: { cookie: her } }), env, deps);
  const mateText = await res.text();
  assert.ok(!/gmsPct|nextStar/.test(mateText) && JSON.parse(mateText).coach === false);
  res = await handle(new Request('https://x/api/week', { headers: { cookie: her } }), env, deps);
  assert.strictEqual((await res.json()).athlete.id, tested.id);
  // No response ever carries a sign-in code.
  const codes = feed.logins.map((l) => l.code);
  assert.ok(codes.length > 0);
  for (const p of ['/api/team', '/api/leaderboards', '/api/stars', '/api/oyo', '/api/week', '/api/session', '/api/athlete/' + tested.id]) {
    const text = await (await handle(new Request('https://x' + p, { headers: { cookie: her } }), env, deps)).text();
    assert.ok(codes.every((c) => !text.includes(c)) && !/logins/.test(text), p);
  }
  clearFeedCache();
});

test('week ahead: coming week Mon-Sat, her squad, only her own targets', () => {
  assert.strictEqual(comingMonday('2026-10-23'), '2026-10-19');   // Friday: this week
  assert.strictEqual(comingMonday('2026-10-24'), '2026-10-19');   // Saturday: still this week
  assert.strictEqual(comingMonday('2026-10-25'), '2026-10-26');   // Sunday: next week
  const novice = feed.athletes.find((a) => a.squad === 'Novice' && a.active);
  const v = weekView(feed, '2026-10-25', novice.id);
  assert.strictEqual(v.days.length, 6);
  assert.deepStrictEqual([v.days[0].day, v.days[5].day], ['2026-10-26', '2026-10-31']);
  const sessions = v.days.flatMap((d) => d.sessions);
  assert.ok(sessions.length > 0);
  assert.ok(sessions.every((s) => s.squad !== 'Varsity'), 'no varsity sessions for a novice');
  assert.ok(sessions.some((s) => s.pieces.some((p) => p.target)), 'she has targets');
  const others = feed.athletes.filter((a) => a.id !== novice.id).map((a) => a.name);
  const body = JSON.stringify(v);
  assert.ok(others.every((n) => !body.includes(n)), 'no other athlete in her week');
  assert.ok(!/gms|weight|birthday/i.test(body));
  assert.strictEqual(v.noTargets, false);
  // No 2k or 20' yet: she sees the note, no targets.
  const untested = starsView(feed, TODAY).rowers.find((r) => r.stars === null);
  const u = weekView(feed, '2026-10-25', untested.id);
  assert.strictEqual(u.noTargets, true);
  // No athlete picked: every session, no targets.
  const all = weekView(feed, '2026-10-25');
  assert.ok(all.days.flatMap((d) => d.sessions).length > sessions.length);
  assert.ok(all.days.every((d) => d.sessions.every((s) => s.pieces.every((p) => p.target === undefined))));
  assert.strictEqual(weekView(feed, TODAY, 'nope'), null);
  // Her own page carries today's plan.
  const today = athleteView(feed, novice.id, TODAY).todayPlan;
  assert.ok(today.length > 0 && today.every((s) => s.squad !== 'Varsity'));
});

test('login: wrong password 401, right one sets the cookie, logout clears it', async () => {
  const vals = { TEAM_PASSWORD: 'fake-team-pw', FEED_KEY: 'fake-key' };
  globalThis.Netlify = { env: { get: (k) => vals[k] } };
  const post = (path, body) => new Request('https://x' + path, { method: 'POST', body: JSON.stringify(body) });
  let res = await login(post('/api/login', { password: 'nope' }));
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.headers.get('set-cookie'), null);
  res = await login(post('/api/login', { password: 'fake-team-pw' }));
  assert.strictEqual(res.status, 200);
  const token = res.headers.get('set-cookie').match(new RegExp(A.COOKIE + '=([^;]+)'))[1];
  assert.ok(A.tokenValid(A.sessionSecret((k) => vals[k]), token));
  res = await login(post('/api/logout', {}));
  assert.ok(/Max-Age=0/.test(res.headers.get('set-cookie')));
  delete vals.FEED_KEY;
  res = await login(post('/api/login', { password: 'fake-team-pw' }));
  assert.strictEqual(res.status, 500);
  delete globalThis.Netlify;
});

test('login: athletes sign in with name and birthday, typed any common way', async () => {
  clearFeedCache();
  const env = (k) => ({ TEAM_PASSWORD: 'fake-team-pw', FEED_KEY: 'fake-key', FEED_URL: 'https://script.example/exec' })[k];
  const deps = { fetchImpl: async () => new Response(JSON.stringify(feed)), failDelayMs: 0 };
  const a = feed.athletes.find((x) => x.active);
  const day = dummyBirthday(a.id);
  const [y, m, d] = day.split('-');
  const post = (body) => new Request('https://x/api/login', { method: 'POST', body: JSON.stringify(body) });
  const who = (res) => A.readToken(A.sessionSecret(env), res.headers.get('set-cookie').match(new RegExp(A.COOKIE + '=([^;]+)'))[1]);
  for (const pw of [`${m}/${d}/${y}`, `${Number(m)}/${Number(d)}/${y}`, `${m}${d}${y}`, `${m}${d}${y.slice(2)}`, day]) {
    const res = await handleLogin(post({ name: '  ' + a.name.toUpperCase() + ' ', password: pw }), env, deps);
    assert.strictEqual(res.status, 200, pw);
    assert.deepStrictEqual(who(res), { kind: 'athlete', id: a.id });
  }
  const wrongDay = `${m}/${String(Number(d) % 28 + 1).padStart(2, '0')}/${y}`;
  for (const body of [{ name: a.name, password: wrongDay }, { name: 'Nobody Here', password: day }, { name: a.name, password: 'fake-team-p' }, { password: day }]) {
    const res = await handleLogin(post(body), env, deps);
    assert.strictEqual(res.status, 401, JSON.stringify(body));
    assert.strictEqual(res.headers.get('set-cookie'), null);
  }
  // Another athlete's birthday does not open her page.
  const b = feed.athletes.find((x) => x.active && x.id !== a.id && dummyBirthday(x.id) !== day);
  assert.strictEqual((await handleLogin(post({ name: a.name, password: dummyBirthday(b.id) }), env, deps)).status, 401);
  // A coach from site.coaches signs in by name (made-up coach), as the coach view.
  const sign = (id, d) => A.loginCode(env, id, d);
  const withCoach = { ...feed, logins: [...feed.logins, { coach: true, code: sign('coach:pat example', '1980-02-03') }] };
  const cdeps = { ...deps, fetchImpl: async () => new Response(JSON.stringify(withCoach)) };
  clearFeedCache();
  assert.deepStrictEqual(who(await handleLogin(post({ name: 'Pat Example', password: '2/3/1980' }), env, cdeps)), { kind: 'team' });
  assert.strictEqual((await handleLogin(post({ name: 'Pat Example', password: '2/4/1980' }), env, cdeps)).status, 401);
  // The coach password works with or without a name.
  assert.deepStrictEqual(who(await handleLogin(post({ password: 'fake-team-pw' }), env, deps)), { kind: 'team' });
  assert.deepStrictEqual(who(await handleLogin(post({ name: a.name, password: 'fake-team-pw' }), env, deps)), { kind: 'team' });
  clearFeedCache();
});

for (const [name, fn] of tests) {
  try { await fn(); passed++; } catch (err) { console.error('FAIL', name); throw err; }
}
console.log(`${passed} site tests passed`);
