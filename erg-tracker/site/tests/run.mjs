// Site tests against the dummy feed: `node erg-tracker/site/tests/run.mjs` (no dependencies).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as S from '../lib/stats.mjs';
import { missedNotMadeUp, teamView, teamSplitsView, athleteView, leaderboardsView, starsView, oyoView, weekView, comingMonday, insightsView, activeRowers, balanceView } from '../lib/views.mjs';
import * as A from '../lib/auth.mjs';
import { getFeed, clearFeedCache, refreshFeed } from '../lib/feed.mjs';
import { handle } from '../functions/api.mjs';
import login, { handleLogin } from '../functions/login.mjs';
import { handleHealth } from '../functions/health.mjs';
import { handleSlackAction } from '../functions/slack-background.mjs';
import { handleSlack } from '../functions/slack.mjs';
import { handlePhotoEvent, handlePhotoButton } from '../lib/slackphoto.mjs';
import * as SL from '../lib/slacklog.mjs';
import * as SLB from '../lib/slacklogbook.mjs';
import { createHmac } from 'node:crypto';
import * as C2 from '../lib/concept2.mjs';
import { handleConcept2 } from '../functions/concept2.mjs';
import { handleCallback } from '../functions/concept2-callback.mjs';
import * as LS from '../lib/logbook-sync.mjs';
import { handleWebhookRequest } from '../functions/concept2-webhook.mjs';
import photoTests from './photo.mjs';

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
  assert.strictEqual(S.schoolYearStart('2026-10-23'), '2026-07-01');
  assert.strictEqual(S.schoolYearStart('2027-03-01'), '2026-07-01');
  assert.strictEqual(S.todayIn('America/New_York', new Date('2026-10-23T03:00:00Z')), '2026-10-22');
});

test('weighted minutes: activity multiplier, modified practice, out', () => {
  const st = feed.settings;
  // 1800 s of work over 7000 m is a 2:08/500m split, faster than 3:00, so warm-up and cool-down count (erg only).
  const base = { warmupS: 600, workS: 1800, workM: 7000, restS: 0, cooldownS: 600, status: 'Full', type: 'OYO', activity: 'Erg (RowErg)' };
  assert.strictEqual(S.rawMinutes(base), 50);
  assert.strictEqual(S.weightedMinutes({ ...base, activity: 'Run' }, st), 36);   // no warm-up or cool-down for non-erg: 30 x 1.2
  assert.strictEqual(S.weightedMinutes({ ...base, activity: 'Lifting' }, st), 0);
  assert.strictEqual(S.weightedMinutes({ ...base, type: 'Practice', status: 'Modified', activity: 'BikeErg', workM: 14000 }, st), 50);
  assert.strictEqual(S.weightedMinutes({ ...base, type: 'Practice', status: 'Modified', activity: 'Bike', workM: '' }, st), 18);
  assert.strictEqual(S.weightedMinutes({ ...base, type: 'Practice', status: 'Out' }, st), 0);
  // Lifting (David, 2026-10-23): no OYO minutes, no meters.
  const lift = { ...base, athleteId: 'A1', date: '2026-10-19', type: 'OYO', activity: 'Lifting', workM: 40, restM: 5 };
  assert.strictEqual(S.weekMinutes([lift], st, '2026-10-19').A1.oyo, 0);
  assert.strictEqual(S.meterTotal(lift), 0);
  // Rest never counts (David, 2026-10-25): rest time and rest meters are left out.
  assert.strictEqual(S.rawMinutes({ ...base, restS: 120 }), 50);
  assert.strictEqual(S.meterTotal({ ...lift, activity: 'Erg (RowErg)' }), 40);
  assert.strictEqual(S.meterTotal({ ...lift, activity: 'Erg (RowErg)', warmupM: 500, cooldownM: 200 }), 740);
  assert.strictEqual(S.bucket({ type: 'Make-up' }), 'practice');
});

test('warm-up and cool-down: erg only, split must be faster than 3:00/500m, rest never counts', () => {
  const erg = { warmupS: 600, workS: 1800, restS: 900, cooldownS: 300, status: 'Full', activity: 'Erg (RowErg)' };
  assert.strictEqual(S.rawMinutes({ ...erg, workM: 5100 }), 45);    // 2:56/500m: faster, so 1800 + 600 + 300 s; rest out
  assert.strictEqual(S.rawMinutes({ ...erg, workM: 5000 }), 30);    // exactly 3:00/500m is not faster: work only
  assert.strictEqual(S.rawMinutes({ ...erg, workM: 4800 }), 30);    // slower
  assert.strictEqual(S.rawMinutes({ ...erg, workM: 0 }), 30);       // no meters, so no split to check
  assert.strictEqual(S.rawMinutes({ ...erg, activity: 'SkiErg', workM: 5100 }), 30);  // not rowing or BikeErg
  assert.strictEqual(S.rawMinutes({ ...erg, activity: 'Run', workM: 5100 }), 30);
  // Counted warm-up and cool-down go to Aerobic, whatever the session's zone.
  const z = S.zoneMinutes([{ ...erg, workM: 5100, zone: 'Threshold', date: '2026-10-20' }], '2026-10-19', '2026-10-25');
  assert.strictEqual(z.Threshold, 30);
  assert.strictEqual(z.Aerobic, 15);
  assert.deepStrictEqual(Object.keys(z), ['Aerobic', 'Threshold', 'Anaerobic']);
});

test('OYO minimum piece length: run 10, bike 20, other cardio 15; practices unaffected', () => {
  const st = feed.settings;
  const piece = (activity, rawMin) => ({ warmupS: 0, workS: rawMin * 60, restS: 0, cooldownS: 0, status: 'Full', type: 'OYO', activity });
  assert.strictEqual(S.weightedMinutes(piece('Run', 9), st), 0);
  assert.strictEqual(S.weightedMinutes(piece('Run', 10), st), 12);          // 10 x 1.2
  assert.strictEqual(S.weightedMinutes(piece('Bike', 19), st), 0);
  assert.strictEqual(S.weightedMinutes(piece('Bike', 20), st), 12);         // 20 x 0.6
  assert.strictEqual(S.weightedMinutes(piece('Erg (RowErg)', 14), st), 0);
  assert.strictEqual(S.weightedMinutes(piece('Erg (RowErg)', 15), st), 15);
  assert.strictEqual(S.weightedMinutes(piece('BikeErg', 14), st), 0);      // BikeErg is erg-like, not a bike
  assert.strictEqual(S.weightedMinutes(piece('Swim', 15), st), 12);         // 15 x 0.8
  assert.strictEqual(S.weightedMinutes({ ...piece('Erg (RowErg)', 5), type: 'Practice' }, st), 5);
  const short = { ...piece('Erg (RowErg)', 8), athleteId: 'A1', date: '2026-10-19' };
  assert.strictEqual(S.weekMinutes([short], st, '2026-10-19').A1.oyo, 0);
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

test('coach split averages: 2k and 20\' as split per 500m, ranked, groups add up', () => {
  // Hand-made: a 2k at 7:00 (105.0 split) beats a 20' of 5000 m (111.5 split: 120 - 8.5).
  const small = {
    settings: { schoolYearStart: '08-01' },
    athletes: [
      { id: 'A1', name: 'Fake One', role: 'Rower', active: true, squad: 'Varsity', grade: '9th' },
      { id: 'A2', name: 'Fake Two', role: 'Rower', active: true, squad: 'Novice', grade: '11th' }
    ],
    benchmarks: [
      { athleteId: 'A1', test: '2000m', date: '2026-09-01', valid: true, timeS: 420, meters: 2000 },
      { athleteId: 'A2', test: '20min', date: '2026-09-01', valid: true, timeS: null, meters: 5000 }
    ]
  };
  const s = teamSplitsView(small, TODAY);
  const g = Object.fromEntries(s.groups.map((x) => [x.key, x]));
  assert.strictEqual(g.all.avgSplit, 108.3, 'mean of 105.0 and 111.5');
  assert.strictEqual(g.top8.n, 2, 'both ranked');
  assert.strictEqual(g.second8.n, 0, 'nobody ranked 9th to 16th');
  assert.strictEqual(g.varsity.avgSplit, 105, 'varsity is the squad, not the rank');
  assert.strictEqual(g.freshman.rowers, 1, 'freshman is 9th grade');
  assert.strictEqual(g.freshman.avgSplit, 105);
  assert.deepStrictEqual(g.all.twoK, { n: 1, avgSplit: 105, avgTime: 420 }, '2k average counts only 2k tests');
  assert.deepStrictEqual(g.all.twenty, { n: 1, avgMeters: 5000, avgSplit: 120 }, "20' average is the mean of real splits, plus average meters");
  assert.strictEqual(g.varsity.twenty.avgMeters, null, 'no 20 in the varsity group');

  const v = teamSplitsView(feed, TODAY);
  const d = Object.fromEntries(v.groups.map((x) => [x.key, x]));
  assert.ok(d.top8.n <= 8 && d.second8.n <= 8, 'bands hold at most 8 each');
  assert.strictEqual(d.top16.n, d.top8.n + d.second8.n, 'top 16 = top 8 + second 8');
  assert.ok(d.all.n >= d.top16.n && d.all.n <= 30, 'all counts every rower with a result');
  assert.ok(v.groups.every((x) => x.avgSplit === null || (x.avgSplit > 90 && x.avgSplit < 200)), 'splits in a sane range');
  assert.ok(!/A9\d\d|Name/.test(JSON.stringify(v)), 'group averages carry no names or IDs');
});

test('insights: missed practices not made up in the last 4 weeks', () => {
  const rec = (date, done) => ({ date, done });
  const m = missedNotMadeUp([rec('2026-09-01', false), rec('2026-10-05', false), rec('2026-10-19', false), rec('2026-10-21', true), rec('2026-10-22', false)], '2026-10-23', 7);
  assert.strictEqual(m.count, 3, 'Oct 5 is 18 days ago, inside 28; Sep 1 is outside');
  assert.strictEqual(m.open, 2, 'Oct 19 and Oct 22 are within the 7-day make-up window');
  assert.strictEqual(m.overdue, 1);
  assert.strictEqual(m.flag, true);
  assert.strictEqual(missedNotMadeUp([rec('2026-10-22', false)], '2026-10-23', 7).flag, false, 'one miss is not flagged');
  const v = insightsView(feed, TODAY);
  assert.ok(v.rowers.every((r) => typeof r.missed.count === 'number'), 'every rower has a missed count');
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
  assert.ok(!/gms|"weight(lb|s)?"|weight lb|birthday/i.test(JSON.stringify(t)), 'no GMS or weight on the team view');
  // Athletes list carries public stars only: average of 2k and 20', halves allowed.
  assert.ok(t.athletes.every((a) => a.stars === null || (a.stars >= 1 && a.stars <= 5 && Number.isInteger(a.stars * 2))));
  assert.ok(t.athletes.every((a) => Object.keys(a).join() === 'id,name,squad,grade,stars'));
});

test('athlete view: bests, streaks, make-ups; GMS kept in its own field', () => {
  feed.athletes.forEach((a) => {
    const v = athleteView(feed, a.id, TODAY);
    assert.strictEqual(v.athlete.name, a.name);
    assert.ok(v.season.practicesDone <= v.season.practicesExpected);
    assert.ok(v.streaks.practices <= v.season.practicesExpected);
    v.openMakeups.forEach((m) => assert.ok(S.daysBetween(m.date, TODAY) <= 7));
    v.openMakeups.forEach((m) => assert.ok(m.sessions.every((s) => s.pieces.length && s.workout), a.name));
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

test('grade at the time: Freshman 7th-9th, Varsity 10th-12th', () => {
  assert.strictEqual(S.gradeAt(2029, '2025-10-01'), 9);
  assert.strictEqual(S.gradeAt(2029, '2026-08-01'), 10);
  assert.strictEqual(S.gradeAt(2029, '2026-07-31'), 9);
  assert.strictEqual(S.gradeAt(2029, '2022-10-01'), null);
  assert.strictEqual(S.gradeAt(2025, '2026-10-01'), null);
  assert.strictEqual(S.gradeAt('', '2026-10-01'), null);
  assert.strictEqual(S.boardGroup(2029, '2025-10-01'), 'freshman');
  assert.strictEqual(S.boardGroup(2029, '2026-10-01'), 'varsity');
  assert.strictEqual(S.boardGroup(2030, '2024-10-01'), 'freshman');
  assert.strictEqual(S.schoolYearLabel('2025-10-01'), '2025-26');
});

test('leaderboards: a freshman record stays frozen after she moves up', () => {
  const f = {
    settings: feed.settings,
    athletes: [
      { id: 'X1', name: 'Frosh Star', squad: '', grade: '10th', gradYear: 2029, active: false, role: 'Rower' },
      { id: 'X2', name: 'Old Timer', squad: '', grade: 'Graduated', gradYear: 2024, active: false, role: 'Rower' },
      { id: 'X3', name: 'No Year', squad: '', grade: '', gradYear: null, active: true, role: 'Rower' }
    ],
    benchmarks: [
      { id: 'b1', athleteId: 'X1', test: '2000m', date: '2025-10-01', timeS: 468.4, valid: true, dateApprox: true },
      { id: 'b2', athleteId: 'X1', test: '2000m', date: '2026-09-15', timeS: 455, valid: true },
      { id: 'b3', athleteId: 'X2', test: '2000m', date: '2023-10-01', timeS: 480, valid: true, dateApprox: true },
      { id: 'b4', athleteId: 'X3', test: '2000m', date: '2026-09-20', timeS: 500, valid: true }
    ]
  };
  const t = leaderboardsView(f, TODAY).tests.find((x) => x.test === '2000m');
  assert.deepStrictEqual(t.allTime.map((r) => r.id), ['X1', 'X2', 'X3']);
  assert.strictEqual(t.allTime[0].timeS, 455);
  assert.strictEqual(t.freshman.allTime.find((r) => r.id === 'X1').timeS, 468.4);
  assert.strictEqual(t.varsity.allTime.find((r) => r.id === 'X1').timeS, 455);
  assert.deepStrictEqual(t.freshman.allTime.map((r) => r.id), ['X1']);
  assert.deepStrictEqual(t.varsity.allTime.map((r) => r.id), ['X1', 'X2']);   // X2 was a senior in 2023-24; X3 has no grad year, so All only
  assert.deepStrictEqual(t.freshman.season, []);
  assert.strictEqual(t.varsity.season[0].id, 'X1');
  const row = t.freshman.allTime[0];
  assert.strictEqual(row.dateApprox, true);
  assert.strictEqual(row.schoolYear, '2025-26');
  assert.strictEqual(t.allTime.find((r) => r.id === 'X2').alum, true);
  assert.strictEqual(t.allTime.find((r) => r.id === 'X3').alum, false);
  assert.strictEqual(t.allTime.find((r) => r.id === 'X1').alum, false);
});

test('leaderboards: Alum squad shows only on the All Time boards', () => {
  const f = {
    settings: feed.settings,
    athletes: [
      { id: 'Y1', name: 'Fake Alum', squad: 'Alum', grade: 'Graduated', gradYear: 2025, active: true, role: 'Rower' },
      { id: 'Y2', name: 'Fake Varsity', squad: 'Varsity', grade: '11th', gradYear: 2028, active: true, role: 'Rower' },
      { id: 'Y3', name: 'Fake Alum Two', squad: 'alum', grade: '', gradYear: 2020, active: false, role: 'Rower' }
    ],
    benchmarks: [
      { id: 'c1', athleteId: 'Y1', test: '2000m', date: '2024-10-01', timeS: 440, valid: true },
      { id: 'c2', athleteId: 'Y1', test: '2000m', date: '2026-09-15', timeS: 430, valid: true },
      { id: 'c3', athleteId: 'Y2', test: '2000m', date: '2026-09-20', timeS: 470, valid: true },
      { id: 'c4', athleteId: 'Y3', test: '2000m', date: '2019-10-01', timeS: 450, valid: true }
    ]
  };
  const t = leaderboardsView(f, TODAY).tests.find((x) => x.test === '2000m');
  assert.deepStrictEqual(t.allTime.map((r) => r.id), ['Y1', 'Y3', 'Y2']);
  assert.strictEqual(t.allTime[0].alum, true);
  assert.deepStrictEqual(t.season.map((r) => r.id), ['Y2']);
  assert.deepStrictEqual(t.varsity.allTime.map((r) => r.id), ['Y1', 'Y3', 'Y2']);   // by grade when the piece was done
  assert.deepStrictEqual(t.varsity.season.map((r) => r.id), ['Y2']);
  assert.deepStrictEqual(t.freshman.season, []);
  assert.deepStrictEqual(activeRowers(f).map((a) => a.id), ['Y2'], 'Alum is on no team view');
});

test('stars board: stars public, GMS % never; team averages only', () => {
  const v = starsView(feed, TODAY);
  assert.strictEqual(v.rowers.length, 30);
  assert.ok(v.rowers.every((r) => r.stars === null || (r.stars >= 1 && r.stars <= 5)));
  // Stars are the average of the 2k and 20' stars (one test: that test's).
  v.rowers.forEach((r) => {
    const have = Object.values(r.byTest).filter((s) => s !== null);
    assert.strictEqual(r.stars, have.length ? have.reduce((x, y) => x + y, 0) / have.length : null, r.name);
  });
  assert.ok(v.rowers.some((r) => r.stars % 1 === 0.5), 'some half stars');
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
  await getFeed(env, { fetchImpl, now: 30000 });
  assert.strictEqual(calls, 1);
  fail = true;
  const r = await getFeed(env, { fetchImpl, now: 6 * 60000 });
  assert.strictEqual(r.stale, true);
  await assert.rejects(getFeed(env, { fetchImpl, now: 25 * 3600000 }));
  clearFeedCache();
  await assert.rejects(getFeed(env, { fetchImpl: async () => new Response('{"error":"unauthorized"}'), now: 0 }), /unauthorized/);
  clearFeedCache();
  // Shared copy (Netlify Blobs): a fresh one means no Sheet call at all.
  let saved = null;
  const shared = { get: async () => saved, set: async (e) => { saved = e; } };
  calls = 0; fail = false;
  await refreshFeed(env, { fetchImpl, now: 0, shared });
  assert.strictEqual(calls, 1);
  clearFeedCache();
  let got = await getFeed(env, { fetchImpl, now: 10 * 60000, shared });
  assert.ok(!got.stale && got.data.athletes.length === 30 && calls === 1, 'served from the shared copy');
  clearFeedCache();
  await getFeed(env, { fetchImpl, now: 20 * 60000, shared });
  assert.strictEqual(calls, 2, 'old shared copy: ask the Sheet');
  assert.strictEqual(saved.at, 20 * 60000, 'and save what it said');
  clearFeedCache(); fail = true;
  got = await getFeed(env, { fetchImpl, now: 60 * 60000, shared });
  assert.ok(got.stale, 'Sheet down: the shared copy, marked stale');
  await assert.rejects(refreshFeed(env, { fetchImpl, shared: null }), /Blobs/);
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
  const coachTeam = await res.json();
  assert.strictEqual(coachTeam.athletes.length, 30);
  assert.ok(coachTeam.splits && coachTeam.splits.groups.length === 6, 'coaches get the split averages');
  const athleteCookie = A.COOKIE + '=' + A.makeToken(A.sessionSecret(env), 'A901');
  res = await handle(new Request('https://x/api/team', { headers: { cookie: athleteCookie } }), env, deps);
  assert.strictEqual((await res.json()).splits, undefined, 'athletes never get the split averages');
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
  // A cookie for an inactive or dropped athlete is refused on every route, not just /api/session.
  for (const id of ['X1', 'NOPE1']) {
    const gone = A.COOKIE + '=' + A.makeToken(A.sessionSecret(env), id);
    for (const p of ['/api/session', '/api/team', '/api/leaderboards']) {
      res = await handle(new Request('https://x' + p, { headers: { cookie: gone } }), env, deps);
      assert.strictEqual(res.status, 401, p + ' for ' + id);
    }
  }
  res = await handle(new Request('https://x/api/athlete/' + tested.id, { headers: { cookie: her } }), env, deps);
  body = await res.json();
  assert.ok(body.own && body.gms.some((g) => g.gmsPct > 0));
  const mate = starsView(feed, TODAY).rowers.find((r) => r.stars !== null && r.id !== tested.id);
  res = await handle(new Request('https://x/api/athlete/' + mate.id, { headers: { cookie: her } }), env, deps);
  const mateText = await res.text();
  assert.ok(!/gmsPct|nextStar/.test(mateText) && JSON.parse(mateText).coach === false);
  res = await handle(new Request('https://x/api/week', { headers: { cookie: her } }), env, deps);
  assert.strictEqual((await res.json()).athlete.id, tested.id);
  // Star rankings are coaches only.
  assert.strictEqual((await handle(new Request('https://x/api/stars', { headers: { cookie: her } }), env, deps)).status, 403);
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

test('week results: her own vs goal; coaches see everyone and last week', async () => {
  const rower = feed.athletes.find((a) => a.squad === 'Varsity' && a.active && a.role === 'Rower');
  const v = weekView(feed, TODAY, rower.id, { results: 'own' });
  const past = v.days.filter((d) => d.day < TODAY).flatMap((d) => d.sessions);
  assert.ok(past.length > 0);
  assert.ok(past.every((s) => s.result || s.missed), 'each past session is logged or missed');
  const r = past.find((s) => s.result).result;
  const sn = past.find((s) => s.result);
  assert.strictEqual(r.pieces.length, sn.pieces.length, 'splits grouped per piece');
  assert.ok(['in', 'below', 'above', ''].includes(r.pieces[0][0].status));
  assert.ok(!('results' in sn), 'no one else in her week');
  const others = feed.athletes.filter((a) => a.id !== rower.id).map((a) => a.name);
  assert.ok(others.every((n) => !JSON.stringify(v).includes(n)));
  // Coaches: every rower in the session's squad, logged or not.
  const all = weekView(feed, TODAY, null, { results: 'all' });
  const s0 = all.days[0].sessions[0];
  assert.ok(s0.results.length > 5 && s0.results.some((x) => x.result) && s0.results.every((x) => 'targets' in x));
  const prev = weekView(feed, TODAY, null, { offset: -1, results: 'all' });
  assert.strictEqual(prev.weekStart, '2026-10-12');
  assert.ok(prev.days.flatMap((d) => d.sessions).some((s) => s.results.some((x) => x.result)), 'last week has results');
  // A feed from before results (v2) shows no "Not logged".
  const old = JSON.parse(JSON.stringify(feed));
  old.weeks.forEach((w) => w.sessions.forEach((x) => delete x.results));
  assert.ok(weekView(old, TODAY, rower.id, { results: 'own' }).days.flatMap((d) => d.sessions).every((x) => !x.missed && !x.result));
  // Over the API: an athlete gets only her own result, never a teammate's, and can't look back.
  const env = (k) => ({ TEAM_PASSWORD: 'fake-team-pw', FEED_KEY: 'fake-key', FEED_URL: 'https://script.example/exec' })[k];
  const deps = { fetchImpl: async () => new Response(JSON.stringify(feed)), today: TODAY };
  clearFeedCache();
  const her = A.COOKIE + '=' + A.makeToken(A.sessionSecret(env), rower.id);
  const team = A.COOKIE + '=' + A.makeToken(A.sessionSecret(env), 'team');
  const get = async (p, cookie) => (await handle(new Request('https://x' + p, { headers: { cookie } }), env, deps)).json();
  let body = await get('/api/week?week=prev', her);
  assert.strictEqual(body.weekStart, '2026-10-19', 'athletes cannot look back');
  assert.ok(body.days.flatMap((d) => d.sessions).some((x) => x.result) && !JSON.stringify(body).includes('"results"'));
  const mate = feed.athletes.find((a) => a.squad === 'Varsity' && a.active && a.id !== rower.id);
  body = await get('/api/week/' + mate.id, her);
  assert.ok(body.days.flatMap((d) => d.sessions).every((x) => !('result' in x)), 'no teammate results');
  body = await get('/api/athlete/' + mate.id, her);
  assert.deepStrictEqual(body.todayPlan, [], 'no teammate Today card');
  body = await get('/api/week?week=prev', team);
  assert.strictEqual(body.weekStart, '2026-10-12');
  body = await get('/api/week/' + mate.id, team);
  assert.ok(body.days.flatMap((d) => d.sessions).some((x) => x.result), 'coach sees her results');
  clearFeedCache();
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
  // An athlete with two codes (her birthday and the shared test date) signs in with either.
  const two = { ...feed, logins: [...feed.logins, { id: a.id, code: sign(a.id, '2010-01-01') }] };
  const tdeps = { ...deps, fetchImpl: async () => new Response(JSON.stringify(two)) };
  clearFeedCache();
  assert.strictEqual(who(await handleLogin(post({ name: a.name, password: '1/1/2010' }), env, tdeps)).id, a.id);
  assert.strictEqual(who(await handleLogin(post({ name: a.name, password: day }), env, tdeps)).id, a.id);
  // The coach password works with or without a name.
  assert.deepStrictEqual(who(await handleLogin(post({ password: 'fake-team-pw' }), env, deps)), { kind: 'team' });
  assert.deepStrictEqual(who(await handleLogin(post({ name: a.name, password: 'fake-team-pw' }), env, deps)), { kind: 'team' });
  clearFeedCache();
});

test('health: key required, counts only, flags a broken feed or missing sign-in codes', async () => {
  const env = (k) => ({ TEAM_PASSWORD: 'fake-team-pw', FEED_KEY: 'fake-key', FEED_URL: 'https://script.example/exec' })[k];
  const post = (body) => new Request('https://x/api/health', { method: 'POST', body: JSON.stringify(body) });
  const serve = (f) => ({ fetchImpl: async () => new Response(JSON.stringify(f)), shared: null });
  clearFeedCache();
  assert.strictEqual((await handleHealth(post({}), env, serve(feed))).status, 401);
  assert.strictEqual((await handleHealth(post({ key: 'wrong' }), env, serve(feed))).status, 401);
  let res = await handleHealth(post({ key: 'fake-key' }), env, serve(feed));
  let b = await res.json();
  assert.strictEqual(res.status, 200);
  assert.ok(b.ok && b.athletes === 30 && b.athleteCodes > 0, JSON.stringify(b));
  assert.ok(!JSON.stringify(b).includes(feed.athletes[0].name), 'no names');
  assert.ok(!JSON.stringify(b).includes(feed.logins[0].code), 'no codes');
  clearFeedCache();
  b = await (await handleHealth(post({ key: 'fake-key' }), env, serve({ ...feed, logins: [] }))).json();
  assert.ok(!b.ok && b.checks.athleteLogins === false);
  clearFeedCache();
  res = await handleHealth(post({ key: 'fake-key' }), env, { fetchImpl: async () => new Response('oops', { status: 500 }), shared: null });
  b = await res.json();
  assert.ok(res.status === 503 && b.checks.feed === false && /500/.test(b.feedError), JSON.stringify(b));
  const noTeam = (k) => (k === 'TEAM_PASSWORD' ? undefined : env(k));
  clearFeedCache();
  b = await (await handleHealth(post({ key: 'fake-key' }), noTeam, serve(feed))).json();
  assert.ok(!b.ok && b.checks.env === false);
  clearFeedCache();
});

test('slack buttons: signature, coach check by the Sheet, first press wins, message update', async () => {
  const env = (k) => ({ SLACK_SIGNING_SECRET: 'fake-secret', SLACK_BOT_TOKEN: 'xoxb-FAKE', FEED_URL: 'https://script.example/exec', FEED_KEY: 'fake-key' })[k];
  const NOW = 1_800_000_000;
  const press = (action, { ts = NOW, secret = 'fake-secret', user = { id: 'U1', name: 'coach.one' } } = {}) => {
    const payload = { type: 'block_actions', user, response_url: 'https://hooks.slack.example/r', channel: { id: 'C1' },
      message: { ts: '1.2', text: ':warning: Plan check: Fake Athlete, Wed Oct 21, Practice. Logged Full, short of plan (3 of 4): Modified?' },
      actions: [action] };
    const raw = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
    const sig = 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${raw}`).digest('hex');
    return new Request('https://x/.netlify/functions/slack-background', { method: 'POST', body: raw,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-slack-request-timestamp': String(ts), 'x-slack-signature': sig } });
  };
  const world = (sheetAnswer, { responseOk = true } = {}) => {
    const calls = [];
    return { calls, deps: { nowS: NOW, fetchImpl: async (url, init) => {
      calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
      if (url === 'https://script.example/exec') return Response.json(sheetAnswer);
      if (url === 'https://hooks.slack.example/r') return new Response('ok', { status: responseOk ? 200 : 404 });
      return Response.json({ ok: true });
    } } };
  };
  const btn = (id) => ({ action_id: id, value: 'E0007' });

  let w = world({ status: 'ok', op: 'modified' });
  let out = await handleSlackAction(press(btn('plan_modified')), env, w.deps);
  assert.deepStrictEqual(out, { status: 'ok', via: 'response_url' });
  assert.deepStrictEqual(w.calls[0].body, { action: 'plan-flag-action', entryId: 'E0007', op: 'modified', slackUserId: 'U1', slackName: 'coach.one', key: 'fake-key' });
  assert.ok(/Set to Modified by coach\.one/.test(w.calls[1].body.text) && w.calls[1].body.replace_original === true);
  assert.ok(!JSON.stringify(w.calls[1].body.blocks).includes('"actions"'), 'buttons removed after a decision');

  w = world({ status: 'ok' });
  await handleSlackAction(press(btn('plan_reviewed')), env, w.deps);
  assert.strictEqual(w.calls[0].body.op, 'reviewed');
  assert.ok(/Looks right, marked by coach\.one/.test(w.calls[1].body.text));

  w = world({ status: 'already', reviewStatus: 'Reviewed, Full' });
  await handleSlackAction(press(btn('plan_modified')), env, w.deps);
  assert.ok(/Already decided \(Reviewed, Full\)/.test(w.calls[1].body.text) && w.calls[1].body.replace_original);

  w = world({ status: 'forbidden' });
  await handleSlackAction(press(btn('plan_modified'), { user: { id: 'U9', name: 'someone' } }), env, w.deps);
  assert.strictEqual(w.calls[1].body.response_type, 'ephemeral');
  assert.ok(/Only the coaches/.test(w.calls[1].body.text) && w.calls[1].body.replace_original === false);

  assert.deepStrictEqual(await handleSlackAction(press({ action_id: 'plan_open' }), env, world({}).deps), { ignored: 'not a plan button' });
  w = world({});
  assert.deepStrictEqual(await handleSlackAction(press(btn('plan_modified'), { secret: 'wrong' }), env, w.deps), { ignored: 'signature' });
  assert.deepStrictEqual(await handleSlackAction(press(btn('plan_modified'), { ts: NOW - 600 }), env, w.deps), { ignored: 'signature' }, 'replayed request');
  assert.strictEqual(w.calls.length, 0, 'nothing reaches the Sheet without a good signature');

  w = { calls: [], deps: { nowS: NOW, fetchImpl: async () => new Response('x', { status: 500 }) } };
  out = await handleSlackAction(press(btn('plan_modified')), env, w.deps);
  assert.strictEqual(out.status, 'error', 'Sheet down: the coach is told');

  w = world({ status: 'ok' }, { responseOk: false });
  out = await handleSlackAction(press(btn('plan_modified')), env, w.deps);
  assert.strictEqual(out.via, 'chat.update', 'expired response_url falls back to chat.update');
  assert.strictEqual(w.calls[w.calls.length - 1].body.ts, '1.2');
});

test('slack /log: modal, reading it back, validation, and the same rules as Apps Script', async () => {
  const vm = require('node:vm');
  const ctx = vm.createContext({ console });
  for (const f of ['Config.gs', 'Time.gs', 'SlackLog.gs']) vm.runInContext(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps-script', f), 'utf8'), ctx);
  assert.deepStrictEqual(SL.ACTIVITIES, JSON.parse(vm.runInContext('JSON.stringify(ACTIVITIES.map(function (a) { return a[0]; }))', ctx)));
  assert.deepStrictEqual(SL.ZONES, JSON.parse(vm.runInContext('JSON.stringify(ZONES)', ctx)));
  assert.strictEqual(SL.MAX_INTERVALS, vm.runInContext('MAX_INTERVALS', ctx));
  const modal = SL.logModal('2026-10-28');
  assert.strictEqual(modal.callback_id, 'log_modal');
  assert.ok(modal.blocks.length <= 100 && modal.blocks.every((b) => b.element.action_id === 'v'));
  assert.strictEqual(new Set(modal.blocks.map((b) => b.block_id)).size, modal.blocks.length);
  // pieces rules agree with SlackLog.gs on good and bad boxes
  for (const box of ['2:00.0, 500, 24, 1:00, 0', '2:00,500', '2:00,500,,1:00', '', '2:00', ',500', '2:75,500', '2:00,abc', '2:00,500,99', '2:00,500,24,1,0', '1:00,1,1,1:00,1,1',
    Array.from({ length: 11 }, () => '2:00,500').join('\n'), '2:00,500\n\n2:00,500']) {
    ctx.box = box;
    const gs = vm.runInContext('(function () { try { parsePiecesText(box); return ""; } catch (e) { return e.message; } })()', ctx);
    assert.strictEqual(SL.piecesError(box), gs, 'pieces box ' + JSON.stringify(box));
  }
  // reading a submitted view
  const view = { state: { values: {
    date: { v: { type: 'datepicker', selected_date: '2026-10-28' } },
    type: { v: { type: 'static_select', selected_option: { value: 'practice' } } },
    status: { v: { type: 'static_select', selected_option: null } },
    warmup: { v: { type: 'plain_text_input', value: ' 15:00 ' } },
    hr: { v: { type: 'plain_text_input', value: null } }
  } } };
  assert.deepStrictEqual(SL.readLogForm(view), { date: '2026-10-28', type: 'practice', status: '', warmup: '15:00', hr: '' });
  const good = { athlete: 'Fake Athlete', date: '2026-10-28', type: 'practice', status: 'full', activity: 'Erg (RowErg)', warmup: '15:00', main_set: "3x10' r2'", zone: 'Aerobic', pieces: '10:00, 2400, 20', rpe: '6', drag: '105' };
  assert.deepStrictEqual(SL.validateLogForm(good, '2026-10-28'), {});
  assert.deepStrictEqual(SL.validateLogForm({ athlete: 'Fake Athlete', date: '2026-10-28', type: 'practice', status: 'out' }, '2026-10-28'), {}, 'Out needs nothing else');
  const bad = SL.validateLogForm({ ...good, date: '2026-10-29', warmup: '15', hr: '300', drag: '20', pieces: '10:00', zone: '', main_set: '' }, '2026-10-28');
  assert.deepStrictEqual(Object.keys(bad).sort(), ['date', 'drag', 'hr', 'main_set', 'pieces', 'warmup', 'zone']);
  assert.deepStrictEqual(SL.validateLogForm({ ...good, athlete: '' }, '2026-10-28'), {}, 'athlete box is optional: athletes leave it blank');
  assert.ok(SL.validateLogForm({ ...good, type: 'makeup' }, '2026-10-28').makeup_for);
  assert.ok(SL.validateLogForm({ ...good, type: 'makeup', makeup_for: '2026-10-28' }, '2026-10-28').makeup_for, 'missed practice must be earlier');
  assert.deepStrictEqual(SL.validateLogForm({ ...good, type: 'makeup', makeup_for: '2026-10-27' }, '2026-10-28'), {});
  assert.strictEqual(SL.todayEastern(new Date('2026-10-28T02:00:00Z')), '2026-10-27');
  assert.ok(/Saved \(Practice, Erg \(RowErg\), 2 pieces\)/.test(SL.logReply({ status: 'ok', sessionType: 'Practice', activity: 'Erg (RowErg)', pieces: 2 })));
  assert.ok(/Saved for Fake Athlete/.test(SL.logReply({ status: 'ok', athlete: 'Fake Athlete', sessionType: 'Practice', pieces: 1 })));
  assert.ok(/plan/.test(SL.logReply({ status: 'ok', sessionType: 'Practice', activity: 'Run', pieces: 1, flagged: true })));
  assert.ok(/you were Out/.test(SL.logReply({ status: 'ok', entryStatus: 'Out' })));
  assert.ok(/Coach greta logged a workout for you \(Practice, Run, 1 piece\)/.test(SL.fyiText({ status: 'ok', notifySlackId: 'UJ1', by: 'Coach greta', sessionType: 'Practice', activity: 'Run', pieces: 1 })));
  assert.ok(/marked you Out/.test(SL.fyiText({ status: 'ok', notifySlackId: 'UJ1', entryStatus: 'Out' })));
  assert.strictEqual(SL.fyiText({ status: 'ok', pieces: 1 }), '', 'no target, no FYI');
  assert.strictEqual(SL.fyiText({ status: 'duplicate', notifySlackId: 'UJ1' }), '');
  assert.ok(/Slack member ID/.test(SL.logReply({ status: 'not_allowed' })) && /only log for yourself/.test(SL.logReply({ status: 'not_yourself' })) && /isn't an active athlete/.test(SL.logReply({ status: 'unknown_name' })) && /already saved/.test(SL.logReply({ status: 'duplicate' })) && /Not saved: boom/.test(SL.logReply({ status: 'error', error: 'boom' })));
});

test('slack /api/slack: slash command opens the modal, submissions are checked and handed on', async () => {
  const env = (k) => ({ SLACK_SIGNING_SECRET: 'fake-secret', SLACK_BOT_TOKEN: 'xoxb-FAKE', FEED_URL: 'https://script.example/exec', FEED_KEY: 'fake-key' })[k];
  const NOW = 1_800_000_000;
  const signed = (raw, { ts = NOW, secret = 'fake-secret' } = {}) => new Request('https://site.example/api/slack', { method: 'POST', body: raw,
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-slack-request-timestamp': String(ts), 'x-slack-signature': 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${raw}`).digest('hex') } });
  const world = (opts = {}) => {
    const calls = [];
    return { calls, deps: { nowS: NOW, today: '2026-10-28', fetchImpl: async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body });
      if (url === 'https://slack.com/api/views.open') return Response.json(opts.openFails ? { ok: false, error: 'expired_trigger_id' } : { ok: true });
      if (url.endsWith('/slack-background')) return new Response('', { status: opts.bgStatus || 202 });
      return Response.json({ ok: true });
    } } };
  };
  const submit = (values) => new URLSearchParams({ payload: JSON.stringify({ type: 'view_submission', user: { id: 'U1' }, view: { id: 'V1', callback_id: 'log_modal', state: { values } } }) }).toString();
  const sel = (v) => ({ v: { type: 'static_select', selected_option: { value: v } } });
  const txt = (v) => ({ v: { type: 'plain_text_input', value: v } });
  const goodValues = { athlete: txt('Fake Athlete'), date: { v: { type: 'datepicker', selected_date: '2026-10-28' } }, type: sel('practice'), status: sel('full'), activity: sel('Erg (RowErg)'),
    warmup: txt('15:00'), main_set: txt('Steady'), zone: sel('Aerobic'), pieces: txt('20:00, 5000, 20'), rpe: sel('5'), drag: txt('105') };

  let w = world();
  let res = await handleSlack(signed('command=%2Flog&trigger_id=T1&user_id=U1'), env, w.deps);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(w.calls[0].url, 'https://slack.com/api/views.open');
  assert.strictEqual(JSON.parse(w.calls[0].body).trigger_id, 'T1');
  assert.strictEqual(JSON.parse(w.calls[0].body).view.callback_id, 'log_modal');
  assert.strictEqual(w.calls[0].headers.authorization, 'Bearer xoxb-FAKE');

  w = world({ openFails: true });
  res = await handleSlack(signed('command=%2Flog&trigger_id=T1'), env, w.deps);
  assert.ok(/Could not open the log form \(expired_trigger_id\)/.test((await res.json()).text));

  w = world();
  res = await handleSlack(signed(submit(goodValues)), env, w.deps);
  assert.deepStrictEqual(await res.json(), { response_action: 'clear' });
  assert.strictEqual(w.calls.length, 1);
  assert.strictEqual(w.calls[0].url, 'https://site.example/.netlify/functions/slack-background');
  assert.strictEqual(w.calls[0].body, submit(goodValues), 'raw signed body passes through untouched');
  assert.strictEqual(w.calls[0].headers['x-slack-request-timestamp'], String(NOW));

  w = world();
  res = await handleSlack(signed(submit({ ...goodValues, pieces: txt('20:00') })), env, w.deps);
  const out = await res.json();
  assert.strictEqual(out.response_action, 'errors');
  assert.ok(/Piece 1: work meters are missing/.test(out.errors.pieces));
  assert.strictEqual(w.calls.length, 0, 'an invalid form is not sent on');

  w = world({ bgStatus: 500 });
  assert.strictEqual((await (await handleSlack(signed(submit(goodValues)), env, w.deps)).json()).response_action, 'errors', 'handoff failed: she can press Save again');

  const hello = JSON.stringify({ type: 'url_verification', challenge: 'fake-challenge-123', token: 'x' });
  w = world();
  res = await handleSlack(signed(hello), env, w.deps);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(await res.text(), 'fake-challenge-123', 'Slack\'s URL check gets its challenge back');
  assert.strictEqual((await handleSlack(signed(hello, { secret: 'wrong' }), env, w.deps)).status, 401, 'handshake needs a good signature too');
  assert.strictEqual((await handleSlack(signed(JSON.stringify({ type: 'event_callback', event: { type: 'message' } })), env, w.deps)).status, 200);
  assert.strictEqual(w.calls.length, 0);

  w = world();
  const btnBody = new URLSearchParams({ payload: JSON.stringify({ type: 'block_actions', actions: [{ action_id: 'plan_modified' }] }) }).toString();
  assert.strictEqual((await handleSlack(signed(btnBody), env, w.deps)).status, 200);
  assert.strictEqual(w.calls.length, 1, 'button presses go to the background function');
  assert.strictEqual((await handleSlack(signed(btnBody, { secret: 'wrong' }), env, w.deps)).status, 401);
  assert.strictEqual((await handleSlack(signed(btnBody, { ts: NOW - 600 }), env, w.deps)).status, 401);
  assert.strictEqual(w.calls.length, 1, 'bad signatures do nothing');
});

test('slack /log background: Sheet call with member ID and view ID, then a DM', async () => {
  const env = (k) => ({ SLACK_SIGNING_SECRET: 'fake-secret', SLACK_BOT_TOKEN: 'xoxb-FAKE', FEED_URL: 'https://script.example/exec', FEED_KEY: 'fake-key' })[k];
  const NOW = 1_800_000_000;
  const raw = new URLSearchParams({ payload: JSON.stringify({ type: 'view_submission', user: { id: 'U1', name: 'fake.athlete' }, view: { id: 'V1', callback_id: 'log_modal',
    state: { values: { warmup: { v: { type: 'plain_text_input', value: '15:00' } } } } } }) }).toString();
  const req = () => new Request('https://x/.netlify/functions/slack-background', { method: 'POST', body: raw, headers: { 'x-slack-request-timestamp': String(NOW),
    'x-slack-signature': 'v0=' + createHmac('sha256', 'fake-secret').update(`v0:${NOW}:${raw}`).digest('hex') } });
  const world = (sheet) => {
    const calls = [];
    return { calls, deps: { nowS: NOW, fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      if (url === 'https://script.example/exec') return sheet instanceof Error ? new Response('x', { status: 500 }) : Response.json(sheet);
      return Response.json({ ok: true });
    } } };
  };
  let w = world({ status: 'ok', sessionType: 'Practice', activity: 'Erg (RowErg)', pieces: 3 });
  let out = await handleSlackAction(req(), env, w.deps);
  assert.deepStrictEqual(w.calls[0].body, { action: 'slack-log', slackUserId: 'U1', slackName: 'fake.athlete', viewId: 'V1', form: { warmup: '15:00' }, key: 'fake-key' });
  assert.strictEqual(w.calls[1].url, 'https://slack.com/api/chat.postMessage');
  assert.strictEqual(w.calls[1].body.channel, 'U1');
  assert.ok(/Saved \(Practice, Erg \(RowErg\), 3 pieces\)/.test(w.calls[1].body.text));
  assert.deepStrictEqual(out, { status: 'ok', dm: true });
  w = world(new Error('down'));
  out = await handleSlackAction(req(), env, w.deps);
  assert.strictEqual(out.status, 'error');
  assert.ok(/Not saved/.test(w.calls[1].body.text), 'Sheet down: she is told, nothing is half saved');
  w = world({ status: 'not_allowed' });
  await handleSlackAction(req(), env, w.deps);
  assert.ok(/Slack member ID/.test(w.calls[1].body.text));
});

test('slack photo: coach sends a screen, bot asks which athlete, card saves with one-tap RPE', async () => {
  const env = (k) => ({ SLACK_SIGNING_SECRET: 'fake-secret', SLACK_BOT_TOKEN: 'xoxb-FAKE', FEED_URL: 'https://script.example/exec', FEED_KEY: 'fake-key', ANTHROPIC_API_KEY: 'fake-ai-key' })[k];
  const seg = (marker, body) => Buffer.concat([Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff]), Buffer.from(body)]);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe1, 'Exif\0\0GPS'), seg(0xc0, 'frame'), Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0xff, 0xd9])]);
  const piece = (time, meters, split) => ({ time, meters, split, rate: 24 });
  const single = { title: '2000m', date: '', split_label: '/500m', total: { time: '8:00.0', meters: 2000, avg_split: '2:00.0', avg_rate: 24 }, total_time_incl_rest: '', rest_meters: null,
    meters_column: 'cumulative', pieces: [piece('2:00.0', 500, '2:00.0'), piece('2:00.0', 1000, '2:00.0'), piece('2:00.0', 1500, '2:00.0'), piece('2:00.0', 2000, '2:00.0')], flags: [] };
  const bad = { ...single, total: { ...single.total, time: '9:30.0' } };   // time does not match meters at that split
  const intervals = { ...single, title: '4x500m/2:00r', meters_column: 'per_piece', total: { time: '6:40.0', meters: 2000, avg_split: '1:40.0', avg_rate: 28 },
    pieces: [0, 1, 2, 3].map(() => piece('1:40.0', 500, '1:40.0')) };
  const world = ({ answers = [single], sheet = {}, copy = null } = {}) => {
    const calls = []; const store = new Map(); let ai = 0;
    const fake = { get: async (k) => store.get(k) || null, set: async (k, v) => { store.set(k, JSON.parse(JSON.stringify(v))); }, delete: async (k) => { store.delete(k); } };
    const deps = { today: '2026-10-28', store: fake, makeCopy: copy || (async (b) => ({ bytes: Buffer.from('small-copy') })), fetchImpl: async (url, init) => {
      const body = init && init.body ? JSON.parse(init.body) : null;
      calls.push({ url, body, headers: init && init.headers });
      if (url === 'https://script.example/exec') {
        if (body.action === 'slack-access') {
          if (sheet.access) return Response.json(sheet.access(body));
          if (body.slackUserId !== 'UC1') return Response.json({ status: 'not_allowed' });
          return Response.json(body.athleteName ? (/^olivia/i.test(body.athleteName) ? { status: 'ok', athlete: 'Olivia Fake' } : { status: 'unknown_name' }) : { status: 'ok' });
        }
        return Response.json(sheet.save || { status: 'ok', athlete: 'Olivia Fake', flagged: false });
      }
      if (url === 'https://files.slack.example/p.jpg') return new Response(jpeg, { status: 200 });
      if (url === 'https://api.anthropic.com/v1/messages') return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answers[Math.min(ai++, answers.length - 1)]) }], usage: { input_tokens: 1, output_tokens: 1 } });
      return Response.json({ ok: true });
    } };
    const dms = () => calls.filter((c) => c.url === 'https://slack.com/api/chat.postMessage').map((c) => c.body);
    return { calls, store, deps, dms };
  };
  const photoMsg = (over = {}) => ({ type: 'message', channel_type: 'im', subtype: 'file_share', user: 'UC1', text: '', files: [{ mimetype: 'image/jpeg', url_private_download: 'https://files.slack.example/p.jpg' }], ...over });
  const textMsg = (text, user = 'UC1') => ({ type: 'message', channel_type: 'im', user, text });
  const press = (id, token, user = { id: 'UC1', name: 'coach.one' }) => ({ type: 'block_actions', user, response_url: 'https://hooks.slack.example/r', channel: { id: 'D1' },
    message: { ts: '1.2', text: '*For Olivia Fake:* card' }, actions: [{ action_id: id, value: token }] });

  // photo -> ask
  let w = world();
  let out = await handlePhotoEvent(photoMsg(), env, w.deps);
  assert.strictEqual(out.status, 'asked');
  assert.ok(/Which athlete is this for/.test(w.dms()[0].text) && /2000m, RowErg, one piece, 2000 m in 8:00\.0/.test(w.dms()[0].text), w.dms()[0].text);
  assert.strictEqual(w.dms()[0].channel, 'UC1');
  const ai = w.calls.find((c) => c.url === 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(ai.body.model, 'claude-haiku-5-5');
  assert.strictEqual(ai.headers['x-api-key'], 'fake-ai-key');
  assert.ok(!JSON.stringify(ai.body).includes('GPS'), 'metadata stripped before it leaves');

  // name -> card
  out = await handlePhotoEvent(textMsg('olivia fake'), env, w.deps);
  assert.strictEqual(out.status, 'card');
  assert.strictEqual(w.calls.filter((c) => c.body && c.body.action === 'slack-access').pop().body.athleteName, 'olivia fake');
  const card = w.dms()[1];
  assert.ok(/For Olivia Fake/.test(card.text));
  assert.strictEqual(card.blocks[1].elements.length, 10);
  assert.deepStrictEqual(card.blocks[2].elements.map((b) => b.action_id), ['photo_norpe', 'photo_cancel']);
  const token = card.blocks[1].elements[0].value;
  assert.ok(token && !w.store.has('pending:UC1') && w.store.has('card:' + token));

  // someone else cannot press, then RPE 7 saves
  out = await handlePhotoButton(press('photo_rpe_7', token, { id: 'UC2', name: 'coach.two' }), env, w.deps);
  assert.strictEqual(out.status, 'not_owner');
  out = await handlePhotoButton(press('photo_rpe_7', token), env, w.deps);
  assert.strictEqual(out.status, 'ok');
  const save = w.calls.filter((c) => c.body && c.body.action === 'slack-photo')[0].body;
  assert.strictEqual(save.token, token);
  assert.strictEqual(save.athlete, 'Olivia Fake');
  assert.strictEqual(save.slackName, 'coach.one');
  assert.strictEqual(save.photo.rpe, '7');
  assert.strictEqual(save.photo.date, '2026-10-28');
  assert.strictEqual(save.photo.machine, 'RowErg');
  assert.deepStrictEqual(save.photo.pieces, [{ timeS: 480, meters: 2000, rate: 24, restS: 0 }], 'single piece saves totals only');
  assert.ok(/Splits: 2:00\.0, 2:00\.0, 2:00\.0, 2:00\.0/.test(save.photo.note));
  assert.strictEqual(save.photo.image, Buffer.from('small-copy').toString('base64'), 'the small copy goes with the save, not the original');
  const sent = w.calls.filter((c) => c.url === 'https://hooks.slack.example/r').pop().body;
  assert.ok(/Saved for Olivia Fake with RPE 7/.test(sent.text) && sent.replace_original);
  assert.ok(!w.dms().some((d) => d.channel === 'UO9'), 'no FYI when the Sheet names nobody');
  out = await handlePhotoButton(press('photo_rpe_7', token), env, w.deps);
  assert.strictEqual(out.status, 'gone', 'second press does nothing');
  assert.strictEqual(w.calls.filter((c) => c.body && c.body.action === 'slack-photo').length, 1);

  // caption names the athlete at once; unknown name keeps the photo waiting; interval pieces and rests
  w = world({ answers: [intervals] });
  out = await handlePhotoEvent(photoMsg({ text: 'Olivia' }), env, w.deps);
  assert.strictEqual(out.status, 'card');
  const tok2 = w.dms()[0].blocks[1].elements[0].value;
  await handlePhotoButton(press('photo_norpe', tok2), env, w.deps);
  const iv = w.calls.find((c) => c.body && c.body.action === 'slack-photo').body.photo;
  assert.strictEqual(iv.rpe, '');
  assert.deepStrictEqual(iv.pieces.map((p) => p.restS), [120, 120, 120, 0]);
  assert.deepStrictEqual(iv.pieces.map((p) => p.meters), [500, 500, 500, 500]);
  w = world();
  await handlePhotoEvent(photoMsg(), env, w.deps);
  out = await handlePhotoEvent(textMsg('Nobody'), env, w.deps);
  assert.strictEqual(out.status, 'unknown_name');
  assert.ok(w.store.has('pending:UC1') && /can't find "Nobody"/.test(w.dms().pop().text));
  assert.deepStrictEqual(await handlePhotoEvent(textMsg('hello'), env, world().deps), { ignored: 'nothing pending' });

  // a copy that cannot be made never blocks the workout; Logbook already having it says so
  w = world({ copy: async () => { throw new Error('bad image'); } });
  await handlePhotoEvent(photoMsg({ text: 'Olivia' }), env, w.deps);
  const tokC = w.dms()[0].blocks[1].elements[0].value;
  await handlePhotoButton(press('photo_norpe', tokC), env, w.deps);
  const noCopy = w.calls.find((c) => c.body && c.body.action === 'slack-photo').body.photo;
  assert.strictEqual(noCopy.image, '');
  assert.ok(/No photo copy kept \(bad image\)/.test(noCopy.note));
  w = world({ sheet: { save: { status: 'merged', athlete: 'Olivia Fake', photo: 'added' } } });
  await handlePhotoEvent(photoMsg({ text: 'Olivia' }), env, w.deps);
  out = await handlePhotoButton(press('photo_norpe', w.dms()[0].blocks[1].elements[0].value), env, w.deps);
  assert.strictEqual(out.status, 'merged');
  assert.ok(/Logbook already has this workout.*photo is kept with it/.test(w.calls.filter((c) => c.url === 'https://hooks.slack.example/r').pop().body.text));
  w = world({ sheet: { save: { status: 'ok', athlete: 'Olivia Fake', photo: 'failed' } } });
  await handlePhotoEvent(photoMsg({ text: 'Olivia' }), env, w.deps);
  await handlePhotoButton(press('photo_norpe', w.dms()[0].blocks[1].elements[0].value), env, w.deps);
  assert.ok(/photo copy could not be kept/.test(w.calls.filter((c) => c.url === 'https://hooks.slack.example/r').pop().body.text));

  // cancel, and a failed save lets her press again
  w = world();
  await handlePhotoEvent(photoMsg({ text: 'Olivia' }), env, w.deps);
  const tok3 = w.dms()[0].blocks[1].elements[0].value;
  assert.strictEqual((await handlePhotoButton(press('photo_cancel', tok3), env, w.deps)).status, 'cancelled');
  assert.ok(!w.store.has('card:' + tok3) && !w.calls.some((c) => c.body && c.body.action === 'slack-photo'));
  w = world({ sheet: { save: { status: 'error', error: 'boom' } } });
  await handlePhotoEvent(photoMsg({ text: 'Olivia' }), env, w.deps);
  const tok4 = w.dms()[0].blocks[1].elements[0].value;
  assert.strictEqual((await handlePhotoButton(press('photo_rpe_5', tok4), env, w.deps)).status, 'error');
  assert.ok(w.store.has('card:' + tok4), 'card kept for another try');

  // a coach's photo save with a Roster Slack ID on the athlete: she gets an FYI DM, then the coach is told
  w = world({ sheet: { save: { status: 'ok', athlete: 'Olivia Fake', flagged: false, notifySlackId: 'UO9', by: 'Coach coach.one', sessionType: 'Practice', activity: 'Erg (RowErg)', pieces: 1 } } });
  await handlePhotoEvent(photoMsg({ text: 'Olivia' }), env, w.deps);
  await handlePhotoButton(press('photo_norpe', w.dms()[0].blocks[1].elements[0].value), env, w.deps);
  const fyi = w.dms().find((d) => d.channel === 'UO9');
  assert.ok(fyi && /Coach coach\.one logged a workout for you/.test(fyi.text));

  // an athlete on the Roster sends a photo: no name question, the card is for herself, and she cannot type another name
  const athleteAccess = (b) => (b.slackUserId !== 'UA1' ? { status: 'not_allowed' }
    : b.athleteName && !/^olivia/i.test(b.athleteName) ? { status: 'not_yourself' } : { status: 'ok', role: 'athlete', athlete: 'Olivia Fake' });
  w = world({ sheet: { access: athleteAccess } });
  out = await handlePhotoEvent(photoMsg({ user: 'UA1', text: 'Someone Else' }), env, w.deps);
  assert.strictEqual(out.status, 'card');
  assert.strictEqual(out.athlete, 'Olivia Fake', 'a caption cannot redirect an athlete\'s photo');
  const aCard = w.dms()[0];
  assert.ok(/For Olivia Fake/.test(aCard.text) && !/Which athlete/.test(aCard.text));
  const aTok = aCard.blocks[1].elements[0].value;
  out = await handlePhotoButton(press('photo_rpe_6', aTok, { id: 'UA1', name: 'olivia.fake' }), env, w.deps);
  assert.strictEqual(out.status, 'ok');
  const aSave = w.calls.find((c) => c.body && c.body.action === 'slack-photo').body;
  assert.strictEqual(aSave.athlete, 'Olivia Fake');
  assert.strictEqual(aSave.slackUserId, 'UA1');
  assert.ok(/Logged from an erg photo\./.test(aSave.photo.note) && !/by a coach/.test(aSave.photo.note));
  w = world({ sheet: { access: athleteAccess } });
  assert.strictEqual((await handlePhotoEvent(textMsg('Someone Else', 'UA1'), env, w.deps)).ignored, 'nothing pending');

  // guards: Slack accounts not on the Roster, missing key, unreadable numbers (retried on the stronger model), wrong file type
  w = world();
  out = await handlePhotoEvent(photoMsg({ user: 'UA9' }), env, w.deps);
  assert.strictEqual(out.status, 'not_allowed');
  assert.ok(!w.calls.some((c) => c.url.includes('anthropic')), 'no model spend for unknown accounts');
  assert.ok(/Slack member ID/.test(w.dms()[0].text));
  w = world();
  assert.strictEqual((await handlePhotoEvent(photoMsg(), (k) => (k === 'ANTHROPIC_API_KEY' ? '' : env(k)), w.deps)).status, 'no_key');
  w = world({ answers: [bad] });
  out = await handlePhotoEvent(photoMsg(), env, w.deps);
  assert.strictEqual(out.status, 'hold');
  assert.deepStrictEqual(w.calls.filter((c) => c.url.includes('anthropic')).map((c) => c.body.model), ['claude-haiku-5-5', 'claude-sonnet-5-5']);
  assert.ok(/can't save this one yet/.test(w.dms()[0].text) && !/coach has been told/i.test(w.dms()[0].text));
  w = world({ answers: [bad, single] });
  assert.strictEqual((await handlePhotoEvent(photoMsg(), env, w.deps)).status, 'asked', 'the retry fixed it');
  w = world();
  assert.strictEqual((await handlePhotoEvent(photoMsg({ files: [{ mimetype: 'image/heic' }] }), env, w.deps)).status, 'bad_file');
  assert.deepStrictEqual(await handlePhotoEvent({ type: 'message', channel_type: 'im', bot_id: 'B1', user: 'UB' }, env, world().deps), { ignored: 'not a person message' });
});

test('slack photo: router hands DM messages to the background function once, never retries or other channels', async () => {
  const env = (k) => ({ SLACK_SIGNING_SECRET: 'fake-secret' })[k];
  const NOW = 1_800_000_000;
  const signed = (obj, headers = {}) => { const raw = JSON.stringify(obj); return new Request('https://site.example/api/slack', { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': String(NOW),
    'x-slack-signature': 'v0=' + createHmac('sha256', 'fake-secret').update(`v0:${NOW}:${raw}`).digest('hex'), ...headers } }); };
  const run = async (req) => { const calls = []; const res = await handleSlack(req, env, { nowS: NOW, fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response('', { status: 202 }); } }); return { res, calls }; };
  const dm = (over = {}) => ({ type: 'event_callback', event: { type: 'message', channel_type: 'im', user: 'UC1', subtype: 'file_share', text: '', ...over } });
  let r = await run(signed(dm()));
  assert.strictEqual(r.res.status, 200);
  assert.strictEqual(r.calls.length, 1);
  assert.strictEqual(r.calls[0].url, 'https://site.example/.netlify/functions/slack-background');
  assert.strictEqual(r.calls[0].init.headers['content-type'], 'application/json');
  assert.strictEqual((await run(signed(dm(), { 'x-slack-retry-num': '1' }))).calls.length, 0, 'Slack retries are not repeated');
  assert.strictEqual((await run(signed(dm({ bot_id: 'B1' })))).calls.length, 0);
  assert.strictEqual((await run(signed(dm({ channel_type: 'channel' })))).calls.length, 0);
  assert.strictEqual((await run(signed(dm({ subtype: 'message_changed' })))).calls.length, 0);
  assert.strictEqual((await run(signed(dm({ subtype: undefined, text: 'Olivia' })))).calls.length, 1, 'plain text reply');
});

test('slack background: a signed DM event and a photo button reach the photo flow', async () => {
  const env = (k) => ({ SLACK_SIGNING_SECRET: 'fake-secret', SLACK_BOT_TOKEN: 'xoxb-FAKE', FEED_URL: 'https://script.example/exec', FEED_KEY: 'fake-key' })[k];
  const NOW = 1_800_000_000;
  const req = (raw, secret = 'fake-secret') => new Request('https://x/.netlify/functions/slack-background', { method: 'POST', body: raw, headers: { 'x-slack-request-timestamp': String(NOW),
    'x-slack-signature': 'v0=' + createHmac('sha256', secret).update(`v0:${NOW}:${raw}`).digest('hex') } });
  const store = new Map();
  const deps = { nowS: NOW, store: { get: async (k) => store.get(k) || null, set: async (k, v) => store.set(k, v), delete: async (k) => store.delete(k) },
    fetchImpl: async () => Response.json({ ok: true }) };
  const ev = JSON.stringify({ type: 'event_callback', event: { type: 'message', channel_type: 'im', user: 'UC1', text: 'hi' } });
  assert.deepStrictEqual(await handleSlackAction(req(ev), env, deps), { ignored: 'nothing pending' });
  assert.deepStrictEqual(await handleSlackAction(req(ev, 'wrong'), env, deps), { ignored: 'signature' });
  const btn = new URLSearchParams({ payload: JSON.stringify({ type: 'block_actions', user: { id: 'UC1' }, response_url: 'https://hooks.slack.example/r', actions: [{ action_id: 'photo_rpe_5', value: 'nope' }] }) }).toString();
  assert.strictEqual((await handleSlackAction(req(btn), env, deps)).status, 'gone');
});

test('load trend: trailing average of up to 3 earlier weeks, flag above the jump %', () => {
  const st = { ...feed.settings, loadJumpPct: 15 };
  const day = (d, min, rpe = 5) => ({ date: d, status: 'Full', type: 'OYO', activity: 'Run', workS: (min / 1.2) * 60, rpe });
  // Weighted 60, 60, 60, 80, 66 minutes over five weeks (Run counts 1.2).
  const es = [day('2026-09-07', 60), day('2026-09-14', 60), day('2026-09-21', 60), day('2026-09-28', 80), day('2026-10-05', 66)];
  const mondays = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'];
  const t = S.loadTrend(es, st, mondays);
  assert.strictEqual(t[0].trailing, null);          // before her first week
  assert.strictEqual(t[1].trailing, null);          // her first week: nothing to compare with
  assert.strictEqual(t[2].trailingWeeks, 1);        // 2nd week uses the one week that exists
  assert.strictEqual(t[3].trailingWeeks, 2);
  assert.strictEqual(Math.round(t[4].trailing), 60);
  assert.strictEqual(Math.round(t[4].changePct), 33);
  assert.ok(t[4].flag);
  assert.strictEqual(t[5].trailingWeeks, 3);         // 3 weeks back: (60 + 60 + 80) / 3 = 66.7
  assert.ok(!t[5].flag && t[5].changePct < 0);
  assert.strictEqual(t[4].rpe, 5);
  // Exactly at the threshold is not a jump; the setting changes it.
  const edge = S.loadTrend([day('2026-09-07', 100), day('2026-09-14', 115)], st, ['2026-09-14']);
  assert.ok(!edge[0].flag);
  assert.ok(S.loadTrend([day('2026-09-07', 100), day('2026-09-14', 115)], { ...st, loadJumpPct: 10 }, ['2026-09-14'])[0].flag);
  assert.strictEqual(feed.settings.loadJumpPct, 15);
});

test('steady splits, trend, projected 2k and month consistency', () => {
  const row = (d, s, m, act = 'Erg (RowErg)', zone = 'Aerobic') => ({ date: d, status: 'Full', activity: act, zone, workS: s, workM: m });
  const es = [row('2026-09-07', 1200, 4800), row('2026-09-14', 1200, 4800), row('2026-09-21', 1200, 4900),
    row('2026-09-28', 1200, 5000), row('2026-09-28', 1200, 10000, 'BikeErg'), row('2026-09-28', 600, 3000, 'Erg (RowErg)', 'Anaerobic')];
  const w = S.steadySplits(es, ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']);
  assert.strictEqual(w[0].splitS, 125);
  assert.strictEqual(w[3].splitS, 120);              // BikeErg at half meters: 2400 s over 10000 m; Anaerobic left out
  assert.strictEqual(w[4].splitS, null);
  const t = S.splitTrend(w);
  assert.strictEqual(t.weeksEach, 2);
  assert.ok(t.changeS < 0);                          // faster
  assert.strictEqual(S.splitTrend(w.slice(0, 1)), null);
  // 20' of 5000 m: split 120 - 8.5 = 111.5, x 4 = 446.
  assert.strictEqual(S.twoKFrom20(5000), 446);
  const bm = [{ athleteId: 'X', test: '2000m', date: '2026-09-01', timeS: 460, valid: true },
    { athleteId: 'X', test: '20min', date: '2026-10-01', meters: 5000, valid: true }];
  assert.strictEqual(S.projected2k('X', bm, '2026-07-01').timeS, 446);
  assert.strictEqual(S.projected2k('X', [...bm, { ...bm[0], date: '2026-10-02' }], '2026-07-01'), null);
  const rec = [{ date: '2026-09-30', done: false }, { date: '2026-10-01', done: true }, { date: '2026-10-02', done: false }, { date: '2026-10-05', done: true }];
  assert.deepStrictEqual(S.monthConsistency(rec, '2026-10-23'), { done: 2, expected: 3, pct: 67 });
});

test('break weeks: 4+ break days use the break OYO goals; blank keeps her own', () => {
  const st = { ...feed.settings, oyoBreak: { ranges: [{ from: '2026-12-23', to: '2027-01-03' }], required: 30, elite: null } };
  assert.ok(!S.isBreakWeek('2026-12-14', st));
  assert.ok(S.isBreakWeek('2026-12-21', st));      // Dec 23-27: 5 break days
  assert.ok(S.isBreakWeek('2026-12-28', st));
  assert.ok(!S.isBreakWeek('2027-01-04', st));
  assert.ok(!S.isBreakWeek('2026-12-21', feed.settings));
  const a = { oyoRequired: 60, oyoElite: 120 };
  assert.deepStrictEqual(S.oyoGoals(a, '2026-12-28', st), { oyoRequired: 30, oyoElite: 120, breakWeek: true });
  assert.deepStrictEqual(S.oyoGoals(a, '2026-12-14', st), { oyoRequired: 60, oyoElite: 120, breakWeek: false });
  assert.strictEqual(S.oyoStatus(40, S.oyoGoals(a, '2026-12-28', st)), 'required');
  // The OYO board and her page use the break goals in a break week.
  const f = { ...feed, settings: { ...feed.settings, oyoBreak: { ranges: [{ from: '2026-10-19', to: '2026-10-25' }], required: 1, elite: 2 } } };
  const o = oyoView(f, TODAY);
  assert.ok(o.breakWeek && !o.lastBreakWeek && o.rowers.every((r) => r.required === 1 && r.lastWeek.required >= 60));
  assert.ok(athleteView(f, 'A901', TODAY).athlete.breakWeek);
});

test('balance: watts ratios, recency weighting, rule comparison (coaches only)', () => {
  const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, a + ' vs ' + b);
  near(S.wattsFromSplit(120), 202.5, 0.1);
  near(S.benchmarkWatts({ test: '2000m', timeS: 480 }), 202.5, 0.1);
  near(S.benchmarkWatts({ test: '100m', timeS: 24 }), S.wattsFromSplit(120), 0.01);   // 100m time x 5 = split
  assert.strictEqual(S.benchmarkWatts({ test: '500m', timeS: 100 }), null);
  const r = S.ruleSplits(120);
  near(r.paul20, 126.3, 0.1);
  assert.strictEqual(r.rule20, 128.5);
  near(r.rule100, 94.32, 0.01);
  near(r.paul100, 120 - 5 * Math.log2(20), 0.01);
  const bm = (test, date, v) => ({ athleteId: 'X', test, date, valid: true, ...(test === '20min' ? { meters: v } : { timeS: v }) });
  const rows = [bm('2000m', '2026-09-01', 480), bm('2000m', '2026-01-15', 500), bm('20min', '2026-09-08', 4700), bm('2000m', '2025-08-01', 470), { ...bm('20min', '2026-10-01', 4800), valid: false }];
  const g = S.balanceGap('X', rows, '2026-10-23', '2000m', '20min');
  assert.strictEqual(g.pairs, 2);                      // the 2025 2k is outside 12 months; the invalid 20' is ignored
  assert.strictEqual(g.best.hi.date, '2026-09-01');    // a week apart outranks eight months apart
  near(g.best.weight, Math.pow(0.5, 7 / 56), 1e-9);
  assert.strictEqual(g.weak, false);
  assert.ok(g.avgRatio !== g.best.ratio);
  near(g.best.ratio, S.wattsFromSplit(120) / S.wattsFromSplit(1200 * 500 / 4700), 1e-9);
  assert.strictEqual(S.balanceGap('X', rows, '2026-10-23', '100m', '2000m'), null);
  const far = S.balanceGap('X', [bm('2000m', '2026-01-01', 480), bm('20min', '2026-09-30', 4700)], '2026-10-23', '2000m', '20min');
  assert.strictEqual(far.weak, true);
  const bv = balanceView(feed, TODAY);
  assert.strictEqual(bv.rowers.length, 30);
  assert.ok(bv.rowers.some((x) => x.endurance && x.endurance.rules.paul.ratioPct > 100));
  const withSprint = { ...feed, benchmarks: [...feed.benchmarks, { athleteId: 'A922', test: '100m', date: '2026-10-21', timeS: 19, valid: true }] };
  const sp = balanceView(withSprint, TODAY).rowers.find((x) => x.id === 'A922').sprint;
  assert.strictEqual(sp.daysApart, 1);
  assert.ok(sp.ratioPct > 150 && sp.rules.tracker.ratioPct > sp.rules.paul.ratioPct);   // 0.786 rule is steeper than Paul's Law
  assert.ok(!/weight|birthday/i.test(JSON.stringify(bv)));
});

test('api routes: every /api path the handler answers is in the function config', () => {
  // A route missing from config.path 404s on Netlify without ever reaching the handler (the Balance page, 2026-10-27).
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../functions/api.mjs'), 'utf8');
  const routed = [...src.match(/export const config = \{ path: \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const handled = [...new Set([...src.matchAll(/path === '(\/api\/[a-z]+)'/g)].map((m) => m[1]))];
  assert.ok(handled.length >= 8);
  handled.forEach((p) => assert.ok(routed.includes(p), p + ' is handled but not routed'));
  assert.ok(routed.includes('/api/balance'));
});

test('insights: own page without flags, teammates none, coaches everything', async () => {
  const v = athleteView(feed, 'A901', TODAY);
  assert.strictEqual(v.insights.load.length, 8);
  assert.ok(v.insights.progress['2000m'].length >= 1 && v.insights.progress['2000m'][0].change === null);
  assert.ok(v.insights.month.expected > 0);
  const iv = insightsView(feed, TODAY);
  assert.strictEqual(iv.rowers.length, 30);
  assert.ok(!/weight|birthday/i.test(JSON.stringify(iv)));
  clearFeedCache();
  const env = (k) => ({ TEAM_PASSWORD: 'fake-team-pw', FEED_KEY: 'fake-key', FEED_URL: 'https://script.example/exec' })[k];
  const deps = { fetchImpl: async () => new Response(JSON.stringify(feed)), today: TODAY };
  const coach = A.COOKIE + '=' + A.makeToken(A.sessionSecret(env), 'team');
  const her = A.COOKIE + '=' + A.makeToken(A.sessionSecret(env), 'A901');
  const get = async (p, cookie) => handle(new Request('https://x' + p, { headers: { cookie } }), env, deps);
  assert.strictEqual((await get('/api/insights', coach)).status, 200);
  assert.strictEqual((await get('/api/insights', her)).status, 403);
  assert.strictEqual((await get('/api/balance', coach)).status, 200);
  assert.strictEqual((await get('/api/balance', her)).status, 403);
  let body = await (await get('/api/athlete/A901', coach)).json();
  assert.ok(body.insights.load.every((l) => 'flag' in l && 'trailing' in l));
  body = await (await get('/api/athlete/A901', her)).json();
  assert.ok(body.insights && body.insights.load.every((l) => !('flag' in l) && !('trailing' in l) && !('changePct' in l)));
  assert.ok(!('jumpPct' in body.insights));
  body = await (await get('/api/athlete/A902', her)).json();
  assert.strictEqual(body.insights, null);
  clearFeedCache();
});

test('home-screen install: manifest and icons match their declared sizes', () => {
  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
  const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, 'manifest.webmanifest'), 'utf8'));
  assert.strictEqual(manifest.start_url, '/');
  assert.strictEqual(manifest.display, 'standalone');
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  assert.ok(html.includes('href="/manifest.webmanifest"'));
  const icons = [...manifest.icons, { src: '/icons/apple-touch-icon.png', sizes: '180x180' }];
  for (const icon of icons) {
    const file = fs.readFileSync(path.join(publicDir, icon.src));
    assert.strictEqual(file.toString('ascii', 1, 4), 'PNG', icon.src);
    const [w, h] = [file.readUInt32BE(16), file.readUInt32BE(20)];
    assert.strictEqual(`${w}x${h}`, icon.sizes, icon.src);
  }
});

test('workout photo: any signed-in person gets the kept copy, only when the workout has one', async () => {
  clearFeedCache();
  const env = (k) => ({ TEAM_PASSWORD: 'fake-team-pw', FEED_KEY: 'fake-key', FEED_URL: 'https://script.example/exec' })[k];
  const mine = feed.entries.find((e) => e.athleteId === 'A901' && e.status !== 'Out');
  const other = feed.entries.find((e) => e.athleteId !== 'A901' && e.status !== 'Out');
  const withPhoto = { ...feed, entries: feed.entries.map((e) => (e.id === mine.id || e.id === other.id ? { ...e, hasPhoto: true } : e)) };
  const calls = [];
  const deps = { today: TODAY, fetchImpl: async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.action === 'photo-get') { calls.push(body); return Response.json({ status: 'ok', mime: 'image/jpeg', data: Buffer.from('JPEGBYTES').toString('base64') }); }
    return new Response(JSON.stringify(withPhoto));
  } };
  const coach = A.COOKIE + '=' + A.makeToken(A.sessionSecret(env), 'team');
  const her = A.COOKIE + '=' + A.makeToken(A.sessionSecret(env), 'A901');
  const get = async (p, cookie) => handle(new Request('https://x' + p, { headers: { cookie } }), env, deps);
  let res = await get('/api/photo/' + mine.id, her);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'image/jpeg');
  assert.strictEqual(Buffer.from(await res.arrayBuffer()).toString(), 'JPEGBYTES');
  assert.deepStrictEqual(calls[0], { action: 'photo-get', entryId: mine.id, key: 'fake-key' });
  assert.strictEqual((await get('/api/photo/' + other.id, her)).status, 200, 'photos are team-visible');
  assert.strictEqual((await get('/api/photo/' + other.id, coach)).status, 200);
  const noPhoto = feed.entries.find((e) => e.athleteId === 'A901' && e.id !== mine.id && e.status !== 'Out');
  assert.strictEqual((await get('/api/photo/' + noPhoto.id, her)).status, 404, 'no photo, no call to the Sheet');
  assert.strictEqual(calls.length, 3);
  assert.strictEqual((await get('/api/photo/' + mine.id, '')).status, 401, 'sign-in needed');
  // the workout page is told a photo exists (and nothing else about it)
  const wv = await (await get('/api/workout/' + mine.id, her)).json();
  assert.strictEqual(wv.workout.photo, true);
  assert.ok(!/drive\.google|Photo link/i.test(JSON.stringify(wv)), 'no Drive link reaches the browser');
  clearFeedCache();
});

test('my workouts: own and coaches see splits, teammates and strangers do not', async () => {
  clearFeedCache();
  const env = (k) => ({ TEAM_PASSWORD: 'fake-team-pw', FEED_KEY: 'fake-key', FEED_URL: 'https://script.example/exec' })[k];
  const deps = { fetchImpl: async () => new Response(JSON.stringify(feed)), today: TODAY };
  const coach = A.COOKIE + '=' + A.makeToken(A.sessionSecret(env), 'team');
  const her = A.COOKIE + '=' + A.makeToken(A.sessionSecret(env), 'A901');
  const get = async (p, cookie) => handle(new Request('https://x' + p, { headers: { cookie } }), env, deps);
  // Her workout list: this school year's workouts with splits, every zone tag she logged.
  let body = await (await get('/api/athlete/A901', her)).json();
  assert.ok(body.workouts.length > 0 && body.workouts.every((w) => w.id && w.status !== 'Out'));
  assert.ok(body.workouts.some((w) => w.zone === 'Threshold'), 'zone tags come through');
  assert.strictEqual((await (await get('/api/athlete/A902', her)).json()).workouts.length, 0, 'teammates get no list');
  // Her own workout: totals plus splits for the current school year.
  const mine = body.workouts.find((w) => w.date >= body.yearStart && feed.logged.some((l) => l.id === w.id));
  body = await (await get('/api/workout/' + mine.id, her)).json();
  assert.strictEqual(body.athlete.id, 'A901');
  assert.ok(body.detail && body.detail.intervals.length > 0, 'splits this year');
  assert.ok(!/logins|"weight"|birthday/i.test(JSON.stringify(body)), "no weight, birthday or logins");
  // Someone else's workout: refused to her, open to coaches.
  const theirs = feed.logged.find((l) => l.athleteId !== 'A901');
  assert.strictEqual((await get('/api/workout/' + theirs.id, her)).status, 404);
  assert.strictEqual((await get('/api/workout/' + theirs.id, coach)).status, 200);
  assert.strictEqual((await get('/api/workout/nope', coach)).status, 404);
  // An older workout keeps its totals and no splits.
  const old = feed.entries.find((e) => e.athleteId === 'A901' && e.date < feed.settings.schoolYearStart && e.status !== 'Out');
  if (old) {
    body = await (await get('/api/workout/' + old.id, her)).json();
    assert.strictEqual(body.detail, null);
    assert.ok(body.workout.minutes >= 0);
  }
  clearFeedCache();
});

// ---- Concept2 Logbook connect (fake keys, fake Logbook, in-memory store) ----
const c2env = (k) => ({
  TEAM_PASSWORD: 'fake-team-pw', FEED_KEY: 'fake-key', CONCEPT2_CLIENT_ID: 'fake-client',
  CONCEPT2_CLIENT_SECRET: 'fake-secret', CONCEPT2_TOKEN_KEY: 'ab'.repeat(32)
})[k];
const memStore = () => {
  const m = new Map();
  return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, list: async (p) => [...m.keys()].filter((k) => k.startsWith(p)), m };
};
const c2cookie = (who) => A.COOKIE + '=' + A.makeToken(A.sessionSecret(c2env), who);
const fakeLogbook = (log = []) => async (url, init = {}) => {
  log.push({ url: String(url), body: init.body ? String(init.body) : '', auth: init.headers && init.headers.authorization });
  if (String(url).endsWith('/oauth/access_token')) {
    const grant = new URLSearchParams(String(init.body)).get('grant_type');
    return Response.json(grant === 'refresh_token'
      ? { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 604800 }
      : { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 604800 });
  }
  if (String(url).endsWith('/api/users/me')) return Response.json({ data: { id: 777, username: 'fake-rower' } });
  return new Response('no', { status: 404 });
};

test('concept2: tokens are sealed and the state is signed, tied to her and short-lived', () => {
  const sealed = C2.seal(c2env, { access: 'a-secret-token' });
  assert.ok(!sealed.includes('a-secret-token'));
  assert.deepStrictEqual(C2.unseal(c2env, sealed), { access: 'a-secret-token' });
  assert.strictEqual(C2.unseal((k) => ({ CONCEPT2_TOKEN_KEY: 'cd'.repeat(32) })[k], sealed), null);
  const st = C2.makeState(c2env, 'A901', 1_000_000);
  assert.strictEqual(C2.readState(c2env, st, 1_000_000 + 60_000), 'A901');
  assert.strictEqual(C2.readState(c2env, st, 1_000_000 + 11 * 60_000), null);
  assert.strictEqual(C2.readState(c2env, st.replace('A901', 'A902'), 1_000_000), null);
  assert.strictEqual(C2.readState(c2env, 'junk'), null);
});

test('concept2: connect redirects an athlete to Logbook with read-only scope', async () => {
  const store = memStore();
  let res = await handleConcept2(new Request('https://x/api/concept2/connect'), c2env, { store });
  assert.strictEqual(res.status, 401);
  res = await handleConcept2(new Request('https://x/api/concept2/connect', { headers: { cookie: c2cookie('team') } }), c2env, { store });
  assert.strictEqual(res.status, 403);
  res = await handleConcept2(new Request('https://x/api/concept2/connect', { headers: { cookie: c2cookie('A901') } }), c2env, { store });
  assert.strictEqual(res.status, 302);
  const loc = new URL(res.headers.get('location'));
  assert.strictEqual(loc.origin + loc.pathname, 'https://log.concept2.com/oauth/authorize');
  assert.strictEqual(loc.searchParams.get('scope'), 'user:read,results:read');
  assert.strictEqual(loc.searchParams.get('client_id'), 'fake-client');
  assert.strictEqual(loc.searchParams.get('redirect_uri'), 'https://x/.netlify/functions/concept2-callback');
  assert.strictEqual(C2.readState(c2env, loc.searchParams.get('state')), 'A901');
  assert.ok(!loc.search.includes('fake-secret'));
  const off = await handleConcept2(new Request('https://x/api/concept2/connect', { headers: { cookie: c2cookie('A901') } }), (k) => (k === 'CONCEPT2_CLIENT_SECRET' ? '' : c2env(k)), { store });
  assert.strictEqual(off.status, 503);
});

test('concept2: callback stores sealed tokens, status, refresh and disconnect', async () => {
  const store = memStore(), log = [];
  const cb = (qs, who = 'A901') => handleCallback(new Request('https://x/.netlify/functions/concept2-callback?' + qs, { headers: { cookie: c2cookie(who) } }), c2env, { store, fetch: fakeLogbook(log) });
  const state = C2.makeState(c2env, 'A901');
  // wrong athlete signed in, denied, bad state: nothing stored
  assert.ok((await cb('code=c&state=' + state, 'A902')).headers.get('location').startsWith('/?logbook=error'));
  assert.ok((await cb('error=access_denied&state=' + state)).headers.get('location').startsWith('/?logbook=denied'));
  assert.ok((await cb('code=c&state=nope')).headers.get('location').startsWith('/?logbook=error'));
  assert.strictEqual(store.m.size, 0);
  const ok = await cb('code=the-code&state=' + state);
  assert.strictEqual(ok.headers.get('location'), '/?logbook=connected#/me');
  const form = new URLSearchParams(log[0].body);
  assert.strictEqual(form.get('code'), 'the-code');
  assert.strictEqual(form.get('grant_type'), 'authorization_code');
  assert.strictEqual(log[1].auth, 'Bearer access-1');
  assert.ok(!JSON.stringify([...store.m.values()]).includes('access-1'), 'token never stored in the clear');
  assert.strictEqual(await C2.athleteForLogbookUser(store, '777'), 'A901');
  // status: athlete sees her own, coaches see who is connected, other athlete sees false
  const st = async (who) => (await (await handleConcept2(new Request('https://x/api/concept2/status', { headers: { cookie: c2cookie(who) } }), c2env, { store })).json());
  assert.deepStrictEqual(await st('A901'), { kind: 'athlete', connected: true, username: 'fake-rower' });
  assert.deepStrictEqual(await st('A902'), { kind: 'athlete', connected: false, username: '' });
  assert.deepStrictEqual(await st('team'), { kind: 'team', connected: [{ id: 'A901', username: 'fake-rower' }] });
  // fresh token is reused, an expiring one is refreshed and the new refresh token kept
  const fetchImpl = fakeLogbook(log);
  assert.strictEqual(await C2.accessTokenFor(c2env, store, fetchImpl, 'A901'), 'access-1');
  assert.strictEqual(await C2.accessTokenFor(c2env, store, fetchImpl, 'A901', Date.now() + 7 * 86400_000), 'access-2');
  assert.strictEqual(await C2.accessTokenFor(c2env, store, fetchImpl, 'A902'), null);
  // a second athlete cannot take the same Logbook account
  const taken = await cb('code=c2&state=' + C2.makeState(c2env, 'A902'), 'A902');
  assert.strictEqual(taken.headers.get('location'), '/?logbook=taken#/me');
  assert.strictEqual(await C2.athleteForLogbookUser(store, '777'), 'A901');
  assert.deepStrictEqual(await st('A902'), { kind: 'athlete', connected: false, username: '' });
  // reconnecting with a different account drops the old link
  const other = async (url) => (String(url).endsWith('/api/users/me') ? Response.json({ data: { id: 888, username: 'second' } }) : fakeLogbook([])(url, { body: 'grant_type=authorization_code' }));
  await C2.saveConnection(c2env, store, 'A901', { access: 'x', refresh: 'y', expiresAt: 1 }, await C2.fetchLogbookUser(other, 'x'));
  assert.strictEqual(await C2.athleteForLogbookUser(store, '777'), null);
  assert.strictEqual(await C2.athleteForLogbookUser(store, '888'), 'A901');
  assert.strictEqual((await st('A901')).username, 'second');
  // a coach disconnects by naming her; an athlete only herself
  const noName = await handleConcept2(new Request('https://x/api/concept2/disconnect', { method: 'POST', headers: { cookie: c2cookie('team') } }), c2env, { store });
  assert.strictEqual(noName.status, 400);
  const del = await handleConcept2(new Request('https://x/api/concept2/disconnect?athlete=A901', { method: 'POST', headers: { cookie: c2cookie('team') } }), c2env, { store });
  assert.strictEqual(del.status, 200);
  assert.strictEqual(store.m.size, 0);
  await C2.saveConnection(c2env, store, 'A902', { access: 'x', refresh: 'y', expiresAt: 1 }, { id: '999', username: 'u' });
  const self = await handleConcept2(new Request('https://x/api/concept2/disconnect?athlete=A901', { method: 'POST', headers: { cookie: c2cookie('A902') } }), c2env, { store });
  assert.strictEqual(self.status, 200);
  assert.strictEqual(store.m.size, 0, 'an athlete can only disconnect herself, whatever the query says');
});
// ---- Logbook sync: normalize, webhook, poll (fake Logbook and fake Sheet) ----
const lbApi = (over = {}) => ({
  id: 122191976, user_id: 777, date: '2026-10-28 11:23:00', type: 'rower', workout_type: 'VariableInterval',
  distance: 433, time: 1800, drag_factor: 98, comments: '3x0:30/0:30r row',
  workout: { intervals: [
    { type: 'time', time: 300, distance: 87, stroke_rate: 22, rest_time: 300, rest_distance: 48 },
    { type: 'time', time: 300, distance: 101, stroke_rate: 22, rest_time: 300, rest_distance: 47 },
    { type: 'time', time: 300, distance: 101, stroke_rate: 22, rest_time: 0, rest_distance: 0 }
  ] }, ...over
});
const syncWorld = (opts = {}) => {
  const store = memStore(), sheet = [], calls = [];
  const results = { 122191976: lbApi() };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push(u);
    if (u === 'https://sheet.example/exec') {
      const body = JSON.parse(init.body);
      if (opts.sheetFails) return Response.json({ status: 'error', error: 'boom' });
      sheet.push(body);
      return Response.json({ status: 'created' });
    }
    if (u.endsWith('/oauth/access_token')) return Response.json({ access_token: 'access-n', refresh_token: 'refresh-n', expires_in: 604800 });
    const one = u.match(/\/api\/users\/me\/results\/(\d+)$/);
    if (one) return results[one[1]] ? Response.json({ data: results[one[1]] }) : new Response('{}', { status: 404 });
    if (u.includes('/api/users/me/results?')) return Response.json({ data: Object.values(results) });
    return new Response('no', { status: 404 });
  };
  const env = (k) => ({ ...Object.fromEntries(['TEAM_PASSWORD', 'FEED_KEY', 'CONCEPT2_CLIENT_ID', 'CONCEPT2_CLIENT_SECRET', 'CONCEPT2_TOKEN_KEY'].map((n) => [n, c2env(n)])), FEED_URL: 'https://sheet.example/exec' })[k];
  return { store, sheet, calls, results, fetchImpl, env };
};
const connectA901 = (w) => C2.saveConnection(w.env, w.store, 'A901', { access: 'access-1', refresh: 'refresh-1', expiresAt: Date.now() + 5 * 86400000 }, { id: '777', username: 'fake-rower' });

test('logbook sync: normalize intervals, totals, bike and bad results', () => {
  const n = LS.normalizeResult(lbApi());
  assert.deepStrictEqual([n.localDate, n.localTime, n.machine, n.dragFactor, n.name], ['2026-10-28', '11:23', 'rower', 98, '3x0:30/0:30r row']);
  assert.strictEqual(n.intervals.length, 3);
  assert.deepStrictEqual(n.intervals[0], { timeS: 30, distanceM: 87, rate: 22, restTimeS: 30, restDistanceM: 48 });
  const just = LS.normalizeResult(lbApi({ workout: undefined, workout_type: 'JustRow', time: 648, distance: 222, comments: '' }));
  assert.deepStrictEqual([just.intervals.length, just.timeS, just.distanceM, just.name], [0, 64.8, 222, 'JustRow']);
  // splits on a continuous piece are not intervals
  assert.strictEqual(LS.normalizeResult(lbApi({ workout: { splits: [{ time: 1000 }, { time: 1000 }] }, time: 4400, distance: 2000 })).intervals.length, 0);
  assert.strictEqual(LS.normalizeResult(lbApi({ type: 'bike' })).machine, 'bikerg');
  assert.strictEqual(LS.normalizeResult(lbApi({ type: 'skierg' })).machine, 'skierg');
  assert.strictEqual(LS.normalizeResult(lbApi({ time: 0, workout: {} })), null);
  assert.strictEqual(LS.normalizeResult({ id: 1, time: 100 }), null);
});

test('logbook sync: a webhook fetches the result with her token and sends it once', async () => {
  const w = syncWorld();
  await connectA901(w);
  const hook = (body) => handleWebhookRequest(new Request('https://x/api/concept2/webhook', { method: 'POST', body: JSON.stringify(body) }), w.env, { store: w.store, fetch: w.fetchImpl });
  const added = { type: 'result-added', result: { id: 122191976, user_id: 777, time: 99999 } };   // payload data is not trusted
  assert.strictEqual((await hook(added)).status, 200);
  assert.strictEqual(w.sheet.length, 1);
  assert.strictEqual(w.sheet[0].athleteId, 'A901');
  assert.strictEqual(w.sheet[0].key, 'fake-key');
  assert.strictEqual(w.sheet[0].action, 'logbook-result');
  assert.strictEqual(w.sheet[0].result.timeS, 180, 'the fetched result is used, not the payload');
  assert.strictEqual(w.sheet[0].result.intervals.length, 3);
  await hook(added);
  assert.strictEqual(w.sheet.length, 1, 'same result again is not resent');
  w.results[122191976] = lbApi({ time: 1810 });
  await hook({ ...added, type: 'result-updated' });
  assert.strictEqual(w.sheet.length, 2, 'a changed result is resent');
  await hook({ type: 'result-added', result: { id: 5, user_id: 999 } });
  assert.strictEqual(w.sheet.length, 2, 'unknown Logbook user is ignored');
  assert.strictEqual((await hook('junk')).status, 200);
});

test('logbook sync: delete only counts when Logbook says the result is gone', async () => {
  const w = syncWorld();
  await connectA901(w);
  const hook = (body) => LS.handleWebhook(w.env, w.store, w.fetchImpl, body);
  await hook({ type: 'result-deleted', result_id: 122191976, user_id: 777 });
  assert.ok(w.sheet.every((c) => !c.result.deleted), 'forged delete: the result still exists, so it is synced, never deleted');
  delete w.results[122191976];
  assert.strictEqual((await hook({ type: 'result-deleted', result_id: 122191976, user_id: 777 })).status, 'deleted');
  assert.deepStrictEqual(w.sheet[w.sheet.length - 1].result, { id: '122191976', deleted: true });
});

test('logbook sync: poll sends new results, skips repeats, survives one failure', async () => {
  const w = syncWorld();
  await connectA901(w);
  await C2.saveConnection(w.env, w.store, 'A902', { access: 'a2', refresh: 'r2', expiresAt: Date.now() - 1000 }, { id: '888', username: 'two' });
  w.results[2] = lbApi({ id: 2, time: 0, workout: {} });
  let out = await LS.pollAll(w.env, w.store, w.fetchImpl);
  assert.deepStrictEqual([out.athletes, out.sent, out.skipped, out.failed], [2, 1, 2, 0], JSON.stringify(out));   // the fake lists both results for both athletes; the second sees the first as already sent
  out = await LS.pollAll(w.env, w.store, w.fetchImpl);
  assert.strictEqual(out.sent, 0);
  const bad = syncWorld({ sheetFails: true });
  await connectA901(bad);
  out = await LS.pollAll(bad.env, bad.store, bad.fetchImpl);
  assert.strictEqual(out.failed, 1);
  assert.strictEqual((await bad.store.get('seen/122191976')), null, 'a failed send is retried next time');
});

test('logbook confirm: pending list is read fresh from the Sheet after a sync, confirm goes to the Sheet', async () => {
  const w = syncWorld();
  const pendingRows = [];
  const base = w.fetchImpl;
  w.sheetPending = pendingRows;
  const fetchImpl = async (url, init = {}) => {
    if (String(url) === 'https://sheet.example/exec') {
      const body = JSON.parse(init.body);
      if (body.action === 'logbook-pending') { w.sheet.push(body); return Response.json({ status: 'ok', pending: pendingRows.filter((p) => p.athleteId === body.athleteId) }); }
      if (body.action === 'logbook-confirm') { w.sheet.push(body); return Response.json({ status: 'confirmed', benchmark: !!body.benchmark }); }
      if (body.action === 'logbook-result') {   // the Sheet writes it, then it is pending right away
        pendingRows.push({ id: 'E' + body.result.id, athleteId: body.athleteId, date: '2026-10-28', sessionType: 'OYO', pieces: [], workS: body.result.timeS, workM: body.result.distanceM });
      }
    }
    return base(url, init);
  };
  const call = (path, who, init = {}) => handleConcept2(new Request('https://x' + path, { headers: { cookie: c2cookie(who) }, ...init }), w.env, { store: w.store, fetch: fetchImpl });
  // not connected: nothing to sync, just her list
  let out = await (await call('/api/concept2/pending', 'A901')).json();
  assert.deepStrictEqual(out.pending, []);
  await connectA901(w);
  w.results[2] = lbApi({ id: 2, date: '2026-10-28 12:30:00', time: 600, distance: 200 });   // two results waiting at Logbook
  out = await (await call('/api/concept2/pending', 'A901')).json();
  assert.deepStrictEqual(out.pending.map((p) => p.id).sort(), ['E122191976', 'E2'], 'every waiting card comes back in one answer, no waiting for the 5-minute feed copy');
  const sentBefore = w.sheet.filter((c) => c.action === 'logbook-result').length;
  await call('/api/concept2/pending', 'A901');
  assert.strictEqual(w.sheet.filter((c) => c.action === 'logbook-result').length, sentBefore, 'a second visit does not resend');
  // only her own list; coaches have none
  assert.deepStrictEqual((await (await call('/api/concept2/pending', 'A902')).json()).pending, []);
  assert.strictEqual((await call('/api/concept2/pending', 'team')).status, 403);
  // confirm
  const post = (body, who = 'A901') => call('/api/concept2/confirm', who, { method: 'POST', body: JSON.stringify(body) });
  assert.strictEqual((await post({ sessionType: 'OYO' })).status, 400);
  const ok = await post({ entryId: 'E2', sessionType: 'Practice', rpe: '7', benchmark: '2000m', junk: 'x', makeupFor: 'nope' });
  assert.strictEqual(ok.status, 200);
  const sent = w.sheet.filter((c) => c.action === 'logbook-confirm')[0];
  assert.deepStrictEqual(sent, { key: 'fake-key', action: 'logbook-confirm', athleteId: 'A901', entryId: 'E2', sessionType: 'Practice', rpe: 7, benchmark: '2000m' });
  // the poll still asks the Sheet to accept sessions older than 20 hours
  const polled = await LS.pollAll(w.env, w.store, w.fetchImpl);
  assert.ok(w.sheet.some((c) => c.action === 'logbook-accept-due'), JSON.stringify(polled));
});

test('logbook in Slack: a new pending session is DMed with Confirm/Change, buttons and the modal confirm through the Sheet', async () => {
  const card = { id: 'E77', athleteId: 'A901', date: '2026-10-27', sessionType: 'OYO', makeupFor: '', possibleMakeup: false, activity: 'Erg (RowErg)',
    mainSet: '4x5:00 r2:00', workS: 1200, workM: 5100, dragFactor: 105, benchmark: '', pieces: [{ n: 1, workS: 300, workM: 1275, rate: 22 }, { n: 2, workS: 300, workM: 1270, rate: 22 }] };
  const w = syncWorld();
  const slackEnv = (k) => ({ SLACK_BOT_TOKEN: 'xoxb-FAKE', SLACK_SIGNING_SECRET: 'fake-secret' })[k] || w.env(k);
  const posted = [];
  let notice = { slackUserId: 'U901', card };
  const fetchImpl = async (url, init = {}) => {
    if (String(url) === 'https://slack.com/api/chat.postMessage') { posted.push(JSON.parse(init.body)); return Response.json({ ok: true }); }
    if (String(url) === 'https://sheet.example/exec') { const out = await w.fetchImpl(url, init); const b = await out.json(); return Response.json(notice ? { ...b, slack: notice } : b); }
    return w.fetchImpl(url, init);
  };
  await connectA901(w);
  assert.strictEqual(await LS.syncResult(slackEnv, w.store, fetchImpl, 'A901', lbApi()), 'sent');
  assert.strictEqual(posted.length, 1);
  assert.strictEqual(posted[0].channel, 'U901', 'DM by member ID');
  assert.ok(/Found on Logbook/.test(posted[0].text));
  const acts = posted[0].blocks.find((b) => b.type === 'actions').elements;
  assert.deepStrictEqual(acts.map((a) => a.action_id), ['lb_rpe', 'lb_confirm', 'lb_change']);
  assert.ok(/after about 20 hours/.test(JSON.stringify(posted[0].blocks)));
  assert.strictEqual(await LS.syncResult(slackEnv, w.store, fetchImpl, 'A901', lbApi()), 'same');
  assert.strictEqual(posted.length, 1, 'an unchanged result is not DMed twice');
  // no Slack ID on the Roster, or Slack failing: the sync still works
  notice = null;
  assert.strictEqual(await LS.syncResult(slackEnv, w.store, fetchImpl, 'A901', lbApi({ id: 5 })), 'sent');
  assert.strictEqual(posted.length, 1);
  notice = { slackUserId: 'U901', card };
  const boom = async (url, init) => { if (String(url).includes('slack.com')) throw new Error('down'); return fetchImpl(url, init); };
  assert.strictEqual(await LS.syncResult(slackEnv, w.store, boom, 'A901', lbApi({ id: 6 })), 'sent', 'Slack down never blocks the sync');

  // possible make-up and a 2k shape
  const mk = SLB.logbookMessage({ ...card, sessionType: 'Make-up', makeupFor: '2026-10-26', possibleMakeup: true, benchmark: '2000m' });
  const mkActs = mk.blocks.find((b) => b.type === 'actions').elements;
  assert.deepStrictEqual(mkActs.map((a) => a.action_id), ['lb_rpe', 'lb_confirm', 'lb_confirm_test', 'lb_change']);
  assert.ok(/won't count until you tap/.test(JSON.stringify(mk.blocks)) && !/20 hours/.test(JSON.stringify(mk.blocks)), 'make-ups always wait for a tap');

  // buttons
  const NOW = 1_800_000_000;
  const signed = (url, payload) => { const raw = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
    return new Request(url, { method: 'POST', body: raw, headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-slack-request-timestamp': String(NOW),
      'x-slack-signature': 'v0=' + createHmac('sha256', 'fake-secret').update(`v0:${NOW}:${raw}`).digest('hex') } }); };
  const env2 = (k) => ({ SLACK_SIGNING_SECRET: 'fake-secret', SLACK_BOT_TOKEN: 'xoxb-FAKE', FEED_URL: 'https://script.example/exec', FEED_KEY: 'fake-key' })[k];
  const world = (answer) => { const calls = []; return { calls, deps: { nowS: NOW, fetchImpl: async (url, init) => {
    calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
    if (url === 'https://script.example/exec') return Response.json(answer);
    return new Response('ok', { status: 200 });
  } } }; };
  const press = (action, state) => ({ type: 'block_actions', user: { id: 'U901', name: 'fake.rower' }, response_url: 'https://hooks.slack.example/r', channel: { id: 'D1' },
    message: { ts: '1.2', text: SLB.summaryLine(card) }, state: { values: state || {} }, actions: [action] });
  let x = world({ status: 'confirmed', benchmark: false });
  let out = await handleSlackAction(signed('https://x/bg', press({ action_id: 'lb_confirm', value: 'E77' }, { lb_actions: { lb_rpe: { selected_option: { value: '7' } } } })), env2, x.deps);
  assert.deepStrictEqual(x.calls[0].body, { action: 'slack-logbook-confirm', slackUserId: 'U901', entryId: 'E77', rpe: 7, key: 'fake-key' });
  assert.ok(/Counted/.test(x.calls[1].body.text) && x.calls[1].body.replace_original && !JSON.stringify(x.calls[1].body.blocks).includes('"actions"'));
  x = world({ status: 'confirmed', benchmark: true });
  await handleSlackAction(signed('https://x/bg', press({ action_id: 'lb_confirm_test', value: 'E77|2000m' })), env2, x.deps);
  assert.deepStrictEqual([x.calls[0].body.benchmark, x.calls[0].body.rpe], ['2000m', undefined]);
  x = world({ status: 'error', error: 'not waiting for confirmation' });
  await handleSlackAction(signed('https://x/bg', press({ action_id: 'lb_confirm', value: 'E77' })), env2, x.deps);
  assert.ok(/Already counted/.test(x.calls[1].body.text), 'confirmed on the site or auto-accepted first');
  x = world({ status: 'error', error: 'session not found' });
  await handleSlackAction(signed('https://x/bg', press({ action_id: 'lb_confirm', value: 'E77' })), env2, x.deps);
  assert.ok(/changed on Logbook/.test(x.calls[1].body.text));
  x = world({ status: 'error', error: 'say which missed practice this makes up' });
  await handleSlackAction(signed('https://x/bg', press({ action_id: 'lb_confirm', value: 'E77' })), env2, x.deps);
  assert.strictEqual(x.calls[1].body.response_type, 'ephemeral');

  // Change: opens at /api/slack with the trigger id, validates, then saves in the background and updates her DM
  const changeBtn = { action_id: 'lb_change', value: acts[2].value };
  assert.ok(acts[2].value.length < 2000);
  const open = [];
  const front = { nowS: NOW, fetchImpl: async (url, init) => { open.push({ url, body: JSON.parse(init.body) }); return Response.json({ ok: true }); } };
  const res = await handleSlack(signed('https://x/api/slack', { ...press(changeBtn), trigger_id: 'T9' }), env2, front);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(open[0].url, 'https://slack.com/api/views.open');
  assert.strictEqual(open[0].body.trigger_id, 'T9');
  const view = open[0].body.view;
  assert.strictEqual(view.callback_id, 'lb_change_modal');
  assert.deepStrictEqual(JSON.parse(view.private_metadata).e, 'E77');
  assert.strictEqual(view.blocks.find((b) => b.block_id === 'type').element.initial_option.value, 'OYO');
  const submitView = (vals) => ({ type: 'view_submission', user: { id: 'U901', name: 'fake.rower' }, view: { id: 'V2', callback_id: 'lb_change_modal', private_metadata: view.private_metadata, state: { values: vals } } });
  const v = (type, extra = {}) => ({ type: { v: { selected_option: { value: type } } }, makeup_for: { v: { selected_date: extra.date || null } }, rpe: { v: { selected_option: extra.rpe ? { value: extra.rpe } : null } }, bench: { v: { selected_options: [] } } });
  const bad = await (await handleSlack(signed('https://x/api/slack', submitView(v('Make-up'))), env2, front)).json();
  assert.ok(bad.errors && bad.errors.makeup_for, 'make-up needs the missed practice date');
  const late = await (await handleSlack(signed('https://x/api/slack', submitView(v('Make-up', { date: '2026-10-27' }))), env2, front)).json();
  assert.ok(late.errors && late.errors.makeup_for, 'the missed practice is before the session');
  const fwd = { nowS: NOW, fetchImpl: async () => new Response('', { status: 202 }) };
  assert.deepStrictEqual(await (await handleSlack(signed('https://x/api/slack', submitView(v('Make-up', { date: '2026-10-26' }))), env2, fwd)).json(), { response_action: 'clear' });
  x = world({ status: 'confirmed' });
  await handleSlackAction(signed('https://x/bg', submitView(v('Make-up', { date: '2026-10-26', rpe: '6' }))), env2, x.deps);
  assert.deepStrictEqual(x.calls[0].body, { action: 'slack-logbook-confirm', slackUserId: 'U901', entryId: 'E77', sessionType: 'Make-up', makeupFor: '2026-10-26', rpe: 6, key: 'fake-key' });
  assert.strictEqual(x.calls[1].url, 'https://slack.com/api/chat.update');
  assert.deepStrictEqual([x.calls[1].body.channel, x.calls[1].body.ts], ['D1', '1.2']);
  assert.ok(/Counted/.test(x.calls[1].body.text));
});

photoTests(test);

for (const [name, fn] of tests) {
  try { await fn(); passed++; } catch (err) { console.error('FAIL', name); throw err; }
}
console.log(`${passed} site tests passed`);
