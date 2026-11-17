// On-water tests (plan Step 0): `node erg-tracker/site/tests/water.mjs` (no dependencies). Made-up FIT files only.
import assert from 'node:assert';
import { readFit, readMessages, unitFromName, fitCrc } from '../lib/fit.mjs';
import * as W from '../lib/water.mjs';
import { writeFit, practiceFit, piecesFit, strokesFor } from '../scripts/make-fit.mjs';
import * as A from '../lib/auth.mjs';
import { handleLineupsSaved, cleanLineupsBody } from '../functions/lineups-saved.mjs';
import { shiftFor, saveBody, boatsFromSaved, todayET } from '../public/lineups.mjs';
import { handleWater, suggestFor, easternDay } from '../functions/water.mjs';
import { clock, lineupFor, creditLine } from '../public/water.mjs';
import { waterReportView } from '../lib/waterreport.mjs';
import { athleteView, isWater } from '../lib/views.mjs';
import * as S from '../lib/stats.mjs';
import { createRequire } from 'node:module';
const { dummyFeed } = createRequire(import.meta.url)('../scripts/dummy-feed.js');
const feed = dummyFeed();
const TODAY = '2026-10-23';

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tolerance ${tol})`);

const practice = practiceFit();
const pieces = piecesFit();

test('FIT reader: a SpeedCoach practice reads back with its unit, strokes and checksum', () => {
  const f = readFit(writeFit(practice.spec), 'whatever.fit');
  assert.strictEqual(f.unit, '3121111');
  assert.strictEqual(f.unitSource, 'file');
  assert.strictEqual(f.crcOk, true);
  assert.strictEqual(f.rowing, true);
  assert.strictEqual(f.strokes.length, practice.spec.strokes.length);
  const s = f.strokes[5], src = practice.spec.strokes[5];
  assert.strictEqual(s.t, src.t);
  near(s.dist, src.dist, 0.01, 'distance');
  near(s.speed, src.speed, 0.001, 'speed');
  assert.strictEqual(s.rate, src.rate);
  near(s.lat, src.lat, 1e-6, 'latitude');
  assert.ok(f.session && f.session.start === practice.spec.start);
});

test('FIT reader: an impossible first-stroke speed (NK sample: 254 m/s) is dropped, the stroke kept, and a warning given', () => {
  const f = readFit(writeFit(practice.spec));
  assert.strictEqual(f.strokes[0].speed, null);
  assert.ok(f.strokes[0].dist != null);
  assert.ok(f.warnings.some((w) => /impossible speed/.test(w)));
});

test('FIT reader: a CoxBox file has no serial inside, so the unit comes from the file name', () => {
  const spec = piecesFit({ omitSerial: true }).spec;
  const f = readFit(writeFit(spec), 'CoxBox_011009863_2026-10-18_0915.fit');
  assert.strictEqual(f.unit, '011009863');
  assert.strictEqual(f.unitSource, 'name');
  assert.strictEqual(f.fileName, 'CoxBox_011009863_2026-10-18_0915.fit');
  const none = readFit(writeFit(spec), 'export.fit');
  assert.strictEqual(none.unit, null);
  assert.ok(none.warnings.some((w) => /No unit number/.test(w)));
});

test('Unit from file name: device word first, dates ignored', () => {
  assert.strictEqual(unitFromName('CoxBox_011009863_2026-10-18.fit'), '011009863');
  assert.strictEqual(unitFromName('/tmp/x/SpeedCoach-3121111.fit'), '3121111');
  assert.strictEqual(unitFromName('SpeedCoach GPS2 3121111 20261018T091500.fit'), '3121111');
  assert.strictEqual(unitFromName('2026-10-18 export 9876543.fit'), '9876543');
  assert.strictEqual(unitFromName('20261018.fit'), null);
  assert.strictEqual(unitFromName(''), null);
});

test('FIT reader: a damaged or cut-short file reads what it can; a non-FIT file is refused', () => {
  const bytes = writeFit(practice.spec);
  const cut = readFit(bytes.subarray(0, Math.floor(bytes.length / 2)));
  assert.ok(cut.strokes.length > 100 && cut.strokes.length < practice.spec.strokes.length);
  assert.ok(cut.warnings.some((w) => /cut short/.test(w)));
  const bad = Uint8Array.from(bytes); bad[bad.length - 100] ^= 0xff;
  assert.strictEqual(readFit(bad).crcOk, false);
  assert.throws(() => readFit(new TextEncoder().encode('Date,Time,Distance\n2026-10-18,0:01,5\n')), /Not a FIT file/);
  assert.throws(() => readFit(new Uint8Array(4)), /Not a FIT file/);
});

test('FIT reader: compressed timestamps and big-endian definitions read correctly', () => {
  // hand-built, big-endian: a normal record (timestamp 1000, 10 m), then a compressed-header record 3 s later (20 m)
  const body2 = [0x40, 0, 1, 0x00, 20, 2, 253, 4, 0x86, 5, 4, 0x86,             // local 0 = record: timestamp, distance
    0x00, 0, 0, 0x03, 0xe8, 0, 0, 0x03, 0xe8,                                     // ts 1000, dist 10.00 m
    0x41, 0, 1, 0x00, 20, 1, 5, 4, 0x86,                                          // local 1 = record with distance only
    0x80 | (1 << 5) | ((1000 + 3) & 0x1f), 0, 0, 0x07, 0xd0];                      // compressed header, local 1, dist 20.00 m
  const header = [12, 0x20, 0x08, 0x08, body2.length, 0, 0, 0, 0x2e, 0x46, 0x49, 0x54];
  const all = Uint8Array.from([...header, ...body2]);
  const crc = fitCrc(all);
  const { messages } = readMessages(Uint8Array.from([...all, crc & 0xff, crc >> 8]));
  assert.deepEqual(messages.map((m) => [m.fields.timestamp, m.fields.distance]), [[1000, 10], [1003, 20]]);
});

test('Moving time: rowing only (spins below drift speed and sits drop out); meters are the full distance', () => {
  const f = readFit(writeFit(practice.spec));
  const mv = W.movement(f.strokes);
  near(mv.movingS, 3600, 15, 'moving seconds = the four rowing stretches');
  const rowM = practice.stretches.filter((s) => s.kind === 'row').reduce((a, s) => a + (s.s / s.splitS) * 500, 0);
  near(mv.movingM, rowM, rowM * 0.01, 'rowing meters');
  assert.ok(mv.meters > mv.movingM, 'spin meters count in the full distance');
  assert.ok(mv.elapsedS > 4300 && mv.elapsedS < 4400, 'elapsed includes the rests (first stroke to last; the final sit has no strokes)');
});

test('Moving time: a programmed workout leaves rest out of the file, so minutes are the sum of the pieces', () => {
  const f = readFit(writeFit(pieces.spec));
  const mv = W.movement(f.strokes);
  near(mv.movingS, (2 * (100 + 101 + 99)), 6, 'sum of pieces');
  const lapM = pieces.spec.laps.reduce((a, l) => a + l.meters, 0);
  near(mv.meters, lapM, 3, 'distance restarts each piece but is counted once');
});

test('Pieces: each work lap is a piece with its own time, meters, split and rate; the session is guessed as Pieces', () => {
  const f = readFit(writeFit(pieces.spec));
  const p = W.piecesOf(f);
  assert.strictEqual(p.length, 3);
  [100, 101, 99].forEach((sp, i) => near(p[i].splitS, sp, 1.5, 'piece ' + (i + 1) + ' split'));
  assert.ok(p.every((x) => Math.abs(x.meters - 1000) <= 10 && x.rate === 32));
  assert.strictEqual(W.guessKind(f), 'Pieces');
  assert.strictEqual(W.guessKind(readFit(writeFit(practice.spec))), 'Practice');
});

test('Pieces: rest laps (slow or tiny) are not pieces', () => {
  const f = readFit(writeFit(pieces.spec));
  f.laps.push({ start: f.laps[2].end + 10, end: f.laps[2].end + 200, elapsedS: 190, timerS: 190, meters: 150, strokes: 40, avgRate: 14 });
  f.laps.push({ start: f.laps[2].end + 300, end: f.laps[2].end + 310, elapsedS: 10, timerS: 10, meters: 40, strokes: 5, avgRate: 30 });
  assert.strictEqual(W.piecesOf(f).length, 3);
});

test('Race guess: one hard continuous piece of race length', () => {
  const start = Date.UTC(2026, 9, 18, 13, 15) / 1000;
  const strokes = strokesFor(start, [{ kind: 'row', s: 1128, splitS: 118.9, rate: 34 }], { seed: 5 });
  const f = readFit(writeFit({ serial: 11009863, start, strokes }));
  const s = W.summarize(f);
  assert.strictEqual(s.kind, 'Race');
  assert.strictEqual(s.pieces.length, 1);
  near(s.avgSplitS, 118.9, 1, 'race average split');
  near(s.meters, 4744, 30, 'race meters');
});

test('Best split by duration: fastest stretch for each duration, never across a rest, with its rate', () => {
  const f = readFit(writeFit(practice.spec));
  const c = W.bestSplits(f.strokes);
  const at = (d) => c.find((p) => p.durS === d);
  near(at(600).splitS, 126, 1.5, 'best 10 min = the 126 block');
  assert.strictEqual(at(600).rate, 22);
  near(at(30).splitS, 126, 4, 'best 30 s');
  assert.ok(at(1200), '20 min fits in one stretch');
  assert.ok(!at(1800) && !at(3600), 'no 30 or 60 min: the longest stretch is 20 min');
  for (let i = 1; i < c.length; i++) assert.ok(c[i].splitS >= c[i - 1].splitS - 0.5, 'longer is not faster');
});

test('Season-best curve keeps the fastest point for each duration and where it came from', () => {
  const a = { from: 'S1', points: [{ durS: 60, splitS: 110 }, { durS: 600, splitS: 120 }] };
  const b = { from: 'S2', points: [{ durS: 60, splitS: 112 }, { durS: 600, splitS: 118 }, { durS: 1200, splitS: 125 }] };
  assert.deepEqual(W.bestCurve([a, b]).map((p) => [p.durS, p.splitS, p.from]), [[60, 110, 'S1'], [600, 118, 'S2'], [1200, 125, 'S2']]);
});

test('Matching: pieces that start within a minute and cover the same distance match across boats; a 4+ is put on the 8+ scale', () => {
  const t = 1800000000;
  const sessions = [
    { id: 'A', boatClass: '8+', pieces: [{ n: 1, start: t, workS: 200, meters: 1000 }, { n: 2, start: t + 600, workS: 204, meters: 1000 }] },
    { id: 'B', boatClass: '8+', pieces: [{ n: 1, start: t + 20, workS: 204, meters: 1000 }, { n: 2, start: t + 610, workS: 200, meters: 1000 }] },
    { id: 'C', boatClass: '4+', pieces: [{ n: 1, start: t + 40, workS: 226, meters: 1000 }] },
    { id: 'D', boatClass: '4x', pieces: [{ n: 1, start: t + 30, workS: 210, meters: 1000 }] },
    { id: 'E', boatClass: '8+', pieces: [{ n: 1, start: t + 300, workS: 200, meters: 1000 }] },
  ];
  const g = W.matchPieces(sessions);
  assert.strictEqual(g.length, 2, 'the lone piece at +5 min matches nothing');
  const first = Object.fromEntries(g[0].results.map((r) => [r.sessionId, r]));
  assert.deepEqual(Object.keys(first).sort(), ['A', 'B', 'C', 'D']);
  near(first.C.adjSplitS, 100, 0.1, '4+ at 1.13 = 8+ at 100');
  assert.strictEqual(first.A.place, 1);
  assert.ok(first.A.marginPct > 0 && first.B.marginPct < 0);
  assert.strictEqual(first.D.marginPct, null, 'sculling boat listed, not compared');
  assert.strictEqual(first.D.place, null);
  assert.strictEqual(g[1].results.find((r) => r.sessionId === 'B').place, 1);
});

test('Matching: timed pieces match by time even when the meters differ by more than 10%', () => {
  const t = 1800000000;
  const g = W.matchPieces([
    { id: 'A', boatClass: '8+', pieces: [{ n: 1, start: t, workS: 300, meters: 1500 }] },
    { id: 'B', boatClass: '4+', pieces: [{ n: 1, start: t + 10, workS: 300, meters: 1320 }] },
  ]);
  assert.strictEqual(g.length, 1);
});

test('Matching from real files: three boats on a piece day', () => {
  const ss = [[100, 101, 99], [102, 103, 100], [101, 99, 101]].map((splits, i) => {
    const f = readFit(writeFit(piecesFit({ serial: 1000 + i, splits, seed: 11 + i, start: Date.UTC(2027, 1, 4, 21, 0) / 1000 + i * 15 }).spec));
    return { id: 'S' + i, boatClass: '8+', pieces: W.summarize(f, 'Pieces').pieces };
  });
  const g = W.matchPieces(ss);
  assert.strictEqual(g.length, 3);
  assert.ok(g.every((x) => x.results.length === 3));
  assert.deepEqual(g.map((x) => x.results.find((r) => r.place === 1).sessionId), ['S0', 'S2', 'S0']);
});

// A made-up season of mixed lineups with known rower effects (in margin %), for the rating tests.
function season({ days = 16, perDay = 3, noise = 0.6, seed = 21, stuck = null } = {}) {
  let s = seed; const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const ids = Array.from({ length: 16 }, (_, i) => 'A9' + String(i + 1).padStart(2, '0'));
  const truth = Object.fromEntries(ids.map((id, i) => [id, 3 - i * 0.4]));    // A901 best ... A916 worst
  const results = [];
  let g = 0;
  for (let d = 0; d < days; d++) {
    const order = [...ids].sort(() => rand() - 0.5);
    if (stuck) { const [a, b] = stuck; const ia = order.indexOf(a), ib = order.indexOf(b); const target = ia < 8 ? (ib < 8 ? ib : order.findIndex((x, k) => k < 8 && x !== a)) : (ib >= 8 ? ib : order.findIndex((x, k) => k >= 8 && x !== a)); [order[ib], order[target]] = [order[target], order[ib]]; }
    const boats = [order.slice(0, 8), order.slice(8)];
    for (let p = 0; p < perDay; p++) {
      g++;
      const raw = boats.map((b) => b.reduce((a, id) => a + truth[id], 0) / 8 + (rand() - 0.5) * 2 * noise);
      const avg = (raw[0] + raw[1]) / 2;
      boats.forEach((b, bi) => results.push({ groupId: 'G' + g, boatClass: '8+', rowers: b, marginPct: Math.round((raw[bi] - avg) * 10) / 10, place: raw[bi] > raw[1 - bi] ? 1 : 2 }));
    }
  }
  return { results, truth, ids };
}
const rankCorr = (a, b) => { const n = a.length; const ra = a.map((x) => a.filter((y) => y > x).length), rb = b.map((x) => b.filter((y) => y > x).length); return 1 - (6 * ra.reduce((s, r, i) => s + (r - rb[i]) ** 2, 0)) / (n * (n * n - 1)); };

test('Win record: pieces, wins, average margin and lineups per rower', () => {
  const w = W.winRecord([
    { groupId: 'G1', boatClass: '8+', rowers: ['a', 'b'], marginPct: 1, place: 1 },
    { groupId: 'G1', boatClass: '8+', rowers: ['c', 'd'], marginPct: -1, place: 2 },
    { groupId: 'G2', boatClass: '8+', rowers: ['a', 'c'], marginPct: -0.5, place: 2 },
    { groupId: 'G2', boatClass: '8+', rowers: ['b', 'd'], marginPct: 0.5, place: 1 },
    { groupId: 'G3', boatClass: '2x', rowers: ['a'], marginPct: 3, place: 1 },
  ]);
  const a = w.find((x) => x.id === 'a');
  assert.deepEqual([a.pieces, a.wins, a.avgMarginPct, a.lineups], [2, 1, 0.3, 2]);
  assert.strictEqual(w[0].id, 'b');
});

test('Adjusted rating: recovers who is faster from mixed lineups, with a range', () => {
  const { results, truth, ids } = season();
  const r = W.adjustedRatings(results);
  assert.strictEqual(r.pieces, 48);
  const got = ids.map((id) => r.rowers.find((x) => x.id === id).rating);
  assert.ok(rankCorr(got, ids.map((id) => truth[id])) > 0.85, 'rank order close to the truth');
  const top = r.rowers.slice(0, 4).map((x) => x.id);
  assert.ok(['A901', 'A902', 'A903'].every((id) => r.rowers.findIndex((x) => x.id === id) < 6), 'the best three are near the top: ' + top);
  assert.ok(r.rowers.every((x) => x.range[0] <= x.rating + 0.05 && x.range[1] >= x.rating - 0.05 && x.status === 'ok'));
});

test('Adjusted rating: says "too early" before enough pieces and lineups', () => {
  const { results } = season({ days: 2 });
  const r = W.adjustedRatings(results);
  assert.ok(r.rowers.every((x) => x.status === 'too early'));
  const one = W.adjustedRatings(season({ days: 1, perDay: 8 }).results);
  assert.ok(one.rowers.every((x) => x.status === 'too early' && x.lineups === 1), '8 pieces, but all in one lineup');
});

test('Adjusted rating: two rowers who always sat together are flagged as not separable', () => {
  const { results } = season({ stuck: ['A901', 'A916'] });
  const r = W.adjustedRatings(results);
  assert.deepEqual(r.together, [['A901', 'A916']]);
  assert.deepEqual(r.rowers.find((x) => x.id === 'A901').sameAs, ['A916']);
});

test('Adjusted rating: optional shell and coxswain effects; sculling and unmatched results are ignored', () => {
  const { results } = season();
  results.forEach((x) => { x.shell = x.rowers.includes('A901') ? 'Hudson' : 'Vespoli'; x.cox = 'C1'; });
  results.push({ groupId: 'GX', boatClass: '2x', rowers: ['A901', 'A902'], marginPct: 5, place: 1 });
  results.push({ groupId: 'GY', boatClass: '8+', rowers: ['A903'], marginPct: 1, place: 1 });
  const r = W.adjustedRatings(results, { shells: true, coxes: true });
  assert.strictEqual(r.pieces, 48);
  assert.deepEqual(r.shells.map((s) => s.shell).sort(), ['Hudson', 'Vespoli']);
  assert.strictEqual(r.coxes.length, 1);
  assert.ok(r.rowers.every((x) => Number.isFinite(x.rating)));
});

test('Adjusted rating: nothing to rate gives empty lists, not an error', () => {
  assert.deepEqual(W.adjustedRatings([]), { rowers: [], shells: [], coxes: [], together: [], pieces: 0 });
});

test('Saved lineups API: coaches only, Sheet through the feed key, only known fields sent', async () => {
  const env = (k) => ({ FEED_KEY: 'fake-key', FEED_URL: 'https://script.example/exec' })[k];
  const coach = A.COOKIE + '=' + A.makeToken(A.sessionSecret(env), 'team', Date.now(), 'Pat Example');
  const athlete = A.COOKIE + '=' + A.makeToken(A.sessionSecret(env), 'A901');
  const calls = [];
  const sheet = (reply) => async (url, init) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify(reply)); };
  const get = (cookie, q = '') => new Request('https://x/api/lineups/saved' + q, { headers: cookie ? { cookie } : {} });
  const post = (cookie, body, extra = {}) => new Request('https://x/api/lineups/saved', { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
  const listed = { status: 'ok', date: '2027-02-03', lineups: [{ lineupId: 'L20270203-1', boatName: 'Hudson' }], days: ['2027-02-03'], coxes: [{ id: 'A905', name: 'Fake Cox' }] };
  assert.strictEqual((await handleLineupsSaved(get(''), env, {})).status, 401);
  assert.strictEqual((await handleLineupsSaved(get(athlete), env, { fetchImpl: sheet({}) })).status, 403);
  assert.strictEqual((await handleLineupsSaved(post(athlete, {}), env, { fetchImpl: sheet({}) })).status, 403);
  assert.strictEqual(calls.length, 0, 'an athlete never reaches the Sheet');
  let res = await handleLineupsSaved(get(coach, '?date=2027-02-03'), env, { fetchImpl: sheet(listed) });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('cache-control'), 'private, no-store');
  assert.deepStrictEqual((await res.json()).coxes, listed.coxes);
  assert.deepStrictEqual(calls[0], { action: 'lineups-list', date: '2027-02-03', key: 'fake-key' });
  assert.strictEqual((await handleLineupsSaved(get(coach, '?date=Feb3'), env, { fetchImpl: sheet(listed) })).status, 400);
  const body = { date: '2027-02-03', shift: 'Early', evil: 1, boats: [{ boatName: 'Hudson', boatClass: '4+', seats: ['A901', '', 'A903', 'A904'], cox: 'A905', extra: 'x', fromPiece: '' }] };
  res = await handleLineupsSaved(post(coach, body), env, { fetchImpl: sheet({ ...listed, saved: ['L20270203-1'] }) });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual((await res.json()).saved, ['L20270203-1']);
  assert.deepStrictEqual(calls[1], { action: 'lineups-save', date: '2027-02-03', shift: 'Early', coachName: 'Pat Example', key: 'fake-key',
    boats: [{ lineupId: '', boatName: 'Hudson', boatClass: '4+', seats: ['A901', '', 'A903', 'A904'], cox: 'A905', fromPiece: '' }] });
  assert.strictEqual((await handleLineupsSaved(post(coach, body), env, { fetchImpl: sheet({ status: 'invalid', message: 'Name every boat.' }) })).status, 422);
  assert.strictEqual((await handleLineupsSaved(post(coach, body, { origin: 'https://evil.example' }), env, { fetchImpl: sheet(listed) })).status, 400);
  assert.strictEqual((await handleLineupsSaved(post(coach, { date: 'x' }), env, { fetchImpl: sheet(listed) })).status, 400);
  assert.strictEqual((await handleLineupsSaved(post(coach, body), env, { fetchImpl: sheet({ error: 'boom' }) })).status, 502);
  assert.strictEqual(cleanLineupsBody({ date: '2027-02-03', shift: 'Early', boats: Array(13).fill({}) }), null);
});

test('Lineups page helpers: default shift, the save body, opening a saved practice', () => {
  assert.deepStrictEqual(['2027-02-01', '2027-02-02', '2027-02-03', '2027-02-04', '2027-02-05', '2027-02-12', '2027-02-06'].map(shiftFor), ['Early', 'Late', 'Early', 'Late', 'Late', 'Early', 'Other']);
  assert.strictEqual(todayET(new Date('2027-02-04T03:30:00Z')), '2027-02-03', '10:30 pm ET is still the 3rd');
  const b = { n: 4, s: ['A901', null, 'A903', 'A904'], name: ' Hudson ', cls: '4x', cox: 'A905', lid: '' };
  assert.deepStrictEqual(saveBody('2027-02-03', 'Early', [b]).boats[0], { lineupId: '', boatName: 'Hudson', boatClass: '4x', seats: ['A901', '', 'A903', 'A904'], cox: '' }, 'a quad has no cox');
  const saved = [
    { lineupId: 'L1', shift: 'Early', boatName: 'Hudson', boatClass: '4+', seats: ['A901', 'A999', '', 'A904'], cox: 'A905', fromPiece: '' },
    { lineupId: 'L2', shift: 'Early', boatName: 'Pair', boatClass: '2-', seats: ['A902', 'A903'], cox: '', fromPiece: '' },
    { lineupId: 'L3', shift: 'Early', boatName: 'Hudson', boatClass: '4+', seats: ['A901', 'A902', '', 'A904'], cox: '', fromPiece: 3 },
    { lineupId: 'L4', shift: 'Late', boatName: 'Potomac', boatClass: '8+', seats: Array(8).fill('A906'), cox: '', fromPiece: '' }];
  const { boats, skipped } = boatsFromSaved(saved, 'Early', new Set(['A901', 'A902', 'A903', 'A904', 'A905']));
  assert.strictEqual(skipped, 2);
  assert.strictEqual(boats.length, 1);
  assert.deepStrictEqual([boats[0].s, boats[0].pin, boats[0].name, boats[0].lid, boats[0].cox], [['A901', null, null, 'A904'], [true, false, false, true], 'Hudson', 'L1', 'A905']);
});


test('Water API: coaches only; preview reads the file and suggests boat, shift and lineup; save re-reads the file', async () => {
  const env = (k) => ({ FEED_KEY: 'fake-key', FEED_URL: 'https://script.example/exec' })[k];
  const coach = A.COOKIE + '=' + A.makeToken(A.sessionSecret(env), 'team', Date.now(), 'Pat Example');
  const athlete = A.COOKIE + '=' + A.makeToken(A.sessionSecret(env), 'A901');
  const calls = [];
  const sheet = (reply) => async (url, init) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify(typeof reply === 'function' ? reply(JSON.parse(init.body)) : reply)); };
  const start = Date.UTC(2027, 1, 3, 20, 40) / 1000;   // Wed Feb 3, 3:40 pm ET
  const data = Buffer.from(writeFit(practiceFit({ start }).spec)).toString('base64');
  const post = (p, cookie, body, extra = {}) => new Request('https://x' + p, { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
  const ctx = { status: 'ok', units: { 3121111: 'Hudson' }, sessions: [],
    lineups: [{ lineupId: 'L20270203-1', date: '2027-02-03', shift: 'Early', boatName: 'Hudson', boatClass: '8+', fromPiece: '', seats: ['A901'], seatNames: ['Fake'], cox: '' }] };
  assert.strictEqual((await handleWater(post('/api/water/preview', athlete, { name: 'a.fit', data }), env, { fetchImpl: sheet(ctx) })).status, 403);
  assert.strictEqual(calls.length, 0, 'an athlete never reaches the Sheet');
  let res = await handleWater(post('/api/water/preview', coach, { name: 'SpeedCoach.fit', data }), env, { fetchImpl: sheet(ctx) });
  assert.strictEqual(res.status, 200);
  let out = await res.json();
  assert.deepStrictEqual(calls[0], { action: 'water-context', dates: ['2027-02-03'], key: 'fake-key' });
  assert.deepStrictEqual(out.suggest, { boatName: 'Hudson', boatClass: '8+', shift: 'Early', lineupId: 'L20270203-1' });
  assert.strictEqual(out.file.date, '2027-02-03');
  assert.strictEqual(out.file.clock, '3:40 PM');
  assert.strictEqual(out.file.sessionId, 'WS-3121111-' + start);
  assert.ok(Math.abs(out.file.movingS - 3600) < 15 && out.file.kind === 'Practice' && out.imported === null);
  // a file already imported keeps the boat it was saved with
  res = await handleWater(post('/api/water/preview', coach, { name: 'x.fit', data }), env, { fetchImpl: sheet({ ...ctx, sessions: [{ sessionId: out.file.sessionId, boatName: 'Severn', boatClass: '4+', shift: 'Late', lineupId: '', kind: 'Pieces', importedBy: 'Coach Pat' }] }) });
  out = await res.json();
  assert.deepStrictEqual([out.suggest.boatName, out.suggest.shift, out.file.kind, out.imported.by], ['Severn', 'Late', 'Pieces', 'Coach Pat']);
  // save: the numbers come from the file read here, not from the request
  let saved = null;
  res = await handleWater(post('/api/water/save', coach, { name: 'SpeedCoach.fit', data, boatName: 'Hudson', boatClass: '8+', shift: 'Early', kind: 'Practice', movingS: 99999 }), env,
    { fetchImpl: sheet((b) => { saved = b; return { status: 'ok', sessionId: b.session.sessionId, lineupId: 'L20270203-1', reimport: false, credited: [{ id: 'A901', name: 'Fake', cox: false }] }; }) });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(saved.action, 'water-save');
  assert.ok(Math.abs(saved.session.movingS - 3600) < 15, 'moving time from the file');
  assert.strictEqual(saved.session.boatName, 'Hudson');
  assert.strictEqual(saved.coachName, 'Pat Example');
  assert.ok(saved.file.base64.length > 1000 && saved.session.curve.all.length >= 5 && Array.isArray(saved.session.curve.r20));
  assert.strictEqual((await res.json()).credited.length, 1);
  // refusals
  const bad = async (p, body, extra) => (await handleWater(post(p, coach, body, extra), env, { fetchImpl: sheet(ctx) })).status;
  assert.strictEqual(await bad('/api/water/preview', { name: 'a.csv', data }), 422, 'CSV refused');
  assert.strictEqual(await bad('/api/water/preview', { name: 'a.fit', data: Buffer.from('Date,Time\n').toString('base64') }), 422);
  assert.strictEqual(await bad('/api/water/preview', { name: 'a.fit' }), 422);
  assert.strictEqual(await bad('/api/water/preview', { name: 'a.fit', data }, { origin: 'https://evil.example' }), 400);
  assert.strictEqual(await bad('/api/water/save', { name: 'a.fit', data, boatName: 'Hudson', boatClass: '9+', shift: 'Early', kind: 'Practice' }), 422);
  assert.strictEqual(await bad('/api/water/save', { name: 'a.fit', data, boatName: '', boatClass: '8+', shift: 'Early', kind: 'Practice' }), 422);
  assert.strictEqual((await handleWater(post('/api/water/save', coach, { name: 'a.fit', data, boatName: 'H', boatClass: '8+', shift: 'Early', kind: 'Practice' }), env, { fetchImpl: sheet({ status: 'invalid', message: 'Pick the shift.' }) })).status, 422);
  assert.strictEqual((await handleWater(post('/api/water/save', coach, { name: 'a.fit', data, boatName: 'H', boatClass: '8+', shift: 'Early', kind: 'Practice' }), env, { fetchImpl: sheet({ error: 'boom' }) })).status, 502);
  res = await handleWater(new Request('https://x/api/water?date=2027-02-03', { headers: { cookie: coach } }), env, { fetchImpl: sheet(ctx) });
  assert.strictEqual((await res.json()).lineups.length, 1);
});

test('Water suggestions: shift from the start time, or from the only lineup with that boat', () => {
  const wed = (h, m) => ({ minutes: h * 60 + m, weekday: 'Wed' });
  assert.strictEqual(suggestFor('1', wed(15, 40), { units: {} }).shift, 'Early');
  assert.strictEqual(suggestFor('1', wed(17, 10), { units: {} }).shift, 'Late');
  assert.strictEqual(suggestFor('1', { minutes: 600, weekday: 'Sat' }, { units: {} }).shift, 'Other');
  const ctx = { units: { 1: 'Hudson' }, lineups: [{ lineupId: 'L2', shift: 'Late', boatName: 'hudson', boatClass: '4+', fromPiece: '' }] };
  assert.deepStrictEqual(suggestFor('1', wed(15, 40), ctx), { boatName: 'Hudson', boatClass: '4+', shift: 'Late', lineupId: 'L2' });
  assert.deepStrictEqual(easternDay(Date.UTC(2027, 1, 4, 3, 30) / 1000).date, '2027-02-03', '10:30 pm ET still the 3rd');
});

test('Water on the site: a water practice counts as attended, its minutes count, and its meters stand beside erg meters', () => {
  const f = JSON.parse(JSON.stringify(feed));
  const a = f.athletes.find((x) => x.active && x.role === 'Rower');
  const day = f.practices.map((p) => p.date).filter((d) => d < TODAY).sort().pop();
  f.entries = f.entries.filter((e) => !(e.athleteId === a.id && e.date === day));
  const before = athleteView(f, a.id, TODAY);
  f.entries.push({ id: 'WTR-X-' + a.id, date: day, athleteId: a.id, type: 'Practice', status: 'Full', activity: 'Water', workS: 5400, workM: 15245, source: 'SpeedCoach', zone: '', mainSet: 'Water: Hudson (8+)' });
  const v = athleteView(f, a.id, TODAY);
  assert.strictEqual(v.season.waterMeters, 15245);
  assert.strictEqual(v.season.meters, before.season.meters, 'erg meters unchanged');
  assert.strictEqual(v.season.trainingMin - before.season.trainingMin, 90, 'water minutes weigh 1.0');
  assert.ok(v.recentPractices.find((r) => r.date === day).done, 'attended');
  assert.strictEqual(before.season.waterMeters, 0);
  assert.ok(isWater({ activity: 'Water' }) && !isWater({ activity: 'Run' }));
  const steady = S.steadySplits(f.entries.filter((e) => e.athleteId === a.id), [S.weekStart(day)]);
  const steadyBefore = S.steadySplits(f.entries.filter((e) => e.athleteId === a.id && e.activity !== 'Water'), [S.weekStart(day)]);
  assert.deepStrictEqual(steady, steadyBefore, 'water never feeds the steady-state split trend');
});

test('Water page helpers: clock, the lineup a file credits, what saving does', () => {
  assert.deepStrictEqual([clock(5397), clock(606), clock(null)], ['1:29:57', '10:06', '–']);
  const lus = [{ lineupId: 'L1', shift: 'Early', boatName: 'Hudson', fromPiece: '', seats: ['A1', '', 'A3'], cox: 'C1' }, { lineupId: 'L2', shift: 'Early', boatName: 'Hudson', fromPiece: 3, seats: [], cox: '' }];
  assert.strictEqual(lineupFor(lus, { boatName: ' hudson ', shift: 'Early' }).lineupId, 'L1');
  assert.strictEqual(lineupFor(lus, { boatName: 'Hudson', shift: 'Late' }), null);
  assert.strictEqual(creditLine(lus[0], { movingS: 5397, meters: 15245 }), '2 rowers and the cox · each rower gets 1:29:57 and 15,245 m; the cox gets attendance only');
});


test('Curves under a rate cap: only stretches at or under that average rate count', () => {
  const f = readFit(writeFit(practice.spec));
  const set = W.curveSet(f.strokes);
  const at = (c, d) => c.find((p) => p.durS === d);
  assert.ok(Math.abs(at(set.all, 600).splitS - 126) <= 1.5 && at(set.all, 600).rate === 22, 'any rate: the 126 block at 22');
  assert.ok(Math.abs(at(set.r20, 600).splitS - 130) <= 1.5 && at(set.r20, 600).rate <= 20, '20 and under: the 130 block at 20');
  assert.deepStrictEqual(set.r28.map((p) => p.splitS), set.all.map((p) => p.splitS), 'nothing above 28, so the same curve');
  const fast = readFit(writeFit(piecesFit().spec));
  assert.deepStrictEqual(W.bestSplits(fast.strokes, W.WATER, 28), [], 'pieces at 32 have nothing at 28 and under');
});

test('Water report: day boats, matched pieces with crews, season curves by boat, class and athlete, and ratings', () => {
  const day = (d, n) => `2027-02-0${d}`;
  const crew = (ids) => ids.map((id) => id);
  const lineups = [], sessions = [], pieces = [];
  const names = Object.fromEntries(Array.from({ length: 12 }, (_, i) => ['A' + (901 + i), 'Fake ' + (i + 1)]));
  for (let d = 1; d <= 3; d++) {
    const order = Object.keys(names).sort((a, b) => ((a.charCodeAt(4) * d) % 7) - ((b.charCodeAt(4) * d) % 7));
    const boats = [['Hudson', '8+', crew(order.slice(0, 8)), 100 + d * 0.1], ['Severn', '4+', crew(order.slice(8, 12)), 113.5]];
    boats.forEach(([name, cls, seats, split], b) => {
      const lid = `L${d}${b}`, sid = `WS-${b}-${d}`;
      lineups.push({ lineupId: lid, date: day(d), shift: 'Early', boatName: name, boatClass: cls, seats, seatNames: seats.map((id) => names[id]), cox: b ? '' : 'A990', coxName: b ? '' : 'Fake Cox', fromPiece: '' });
      sessions.push({ sessionId: sid, date: day(d), shift: 'Early', boatName: name, boatClass: cls, lineupId: lid, kind: d === 3 ? 'Practice' : 'Pieces', start: `2027-02-0${d}T21:00:${b}0Z`,
        movingS: 600, meters: 3000, avgSplitS: split, avgRate: 30, curve: { all: [{ durS: 60, splitS: split - 1, rate: 30 }, { durS: 600, splitS: split, rate: 30 }], r20: [] } });
      if (d !== 3) for (let n = 1; n <= 2; n++) pieces.push({ pieceId: `${sid}-P${n}`, sessionId: sid, n, start: `2027-02-0${d}T21:${n}0:${b}5Z`, workS: (split * 2) + n, meters: 1000, splitS: split + n / 10, rate: 32, lineupId: lid });
    });
  }
  const v = waterReportView({ sessions, pieces, lineups }, '2027-02-02', 'all');
  assert.deepStrictEqual(v.days, ['2027-02-03', '2027-02-02', '2027-02-01']);
  assert.strictEqual(v.boats.length, 2);
  assert.deepStrictEqual(v.boats[0].crew.names.length, 8);
  assert.strictEqual(v.boats[0].crew.cox, 'Fake Cox');
  assert.strictEqual(v.groups.length, 2, 'two pieces rowed side by side');
  assert.ok(v.groups.every((g) => g.results.length === 2 && g.results.every((r) => r.marginPct !== null && r.crew)));
  assert.strictEqual(v.unmatchedPieces, 0);
  assert.strictEqual(waterReportView({ sessions, pieces, lineups }, '2027-02-03').groups.length, 0, 'a continuous practice day has no comparisons');
  assert.strictEqual(waterReportView({ sessions, pieces, lineups }, '').date, '2027-02-03', 'no date: the latest day');
  const hud = v.season.byBoat.find((b) => b.boatName === 'Hudson');
  assert.deepStrictEqual(hud.points.map((p) => [p.durS, p.splitS, p.from]), [[60, 99.1, '2027-02-01'], [600, 100.1, '2027-02-01']]);
  assert.strictEqual(v.season.byClass.length, 2);
  const sev = v.season.byAthlete.find((a) => sessions.some((s) => s.boatName === 'Severn' && lineups.find((l) => l.lineupId === s.lineupId).seats.includes(a.id)));
  assert.ok(sev.points.every((p) => p.splitS < 101), 'athlete curves on the 8+ scale');
  assert.strictEqual(v.ratings.pieces, 4);
  assert.ok(v.ratings.rowers.every((r) => r.status === 'too early' && r.name.startsWith('Fake')));
  assert.strictEqual(v.ratings.record.length, 12);
  assert.strictEqual(waterReportView({ sessions, pieces, lineups }, '2027-02-02', 'r20').season.byBoat[0].points.length, 0);
  assert.deepStrictEqual(waterReportView({ sessions: [], pieces: [], lineups: [] }, '2027-02-02').ratings.rowers, []);
});

test('Water report API: coaches only, the season from July 1 to the date', async () => {
  const env = (k) => ({ FEED_KEY: 'fake-key', FEED_URL: 'https://script.example/exec' })[k];
  const coach = A.COOKIE + '=' + A.makeToken(A.sessionSecret(env), 'team', Date.now(), 'Pat Example');
  const athlete = A.COOKIE + '=' + A.makeToken(A.sessionSecret(env), 'A901');
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ status: 'ok', sessions: [], pieces: [], lineups: [] })); };
  const get = (cookie, q) => new Request('https://x/api/water/report' + q, { headers: { cookie } });
  assert.strictEqual((await handleWater(get(athlete, '?date=2027-02-03'), env, { fetchImpl })).status, 403);
  const res = await handleWater(get(coach, '?date=2027-02-03&rate=r20'), env, { fetchImpl });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(calls[0], { action: 'water-report', from: '2026-07-01', to: '2027-02-03', key: 'fake-key' });
  assert.strictEqual((await res.json()).rateKey, 'r20');
  assert.strictEqual((await handleWater(get(coach, '?rate=r99'), env, { fetchImpl })).status, 400);
});

for (const [name, fn] of tests) {
  try { await fn(); passed++; } catch (e) { console.error('FAIL ' + name + '\n  ' + (e && e.message)); process.exitCode = 1; }
}
console.log(passed + '/' + tests.length + ' water tests passed');
