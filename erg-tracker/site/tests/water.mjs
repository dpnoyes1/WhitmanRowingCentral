// On-water tests (plan Step 0): `node erg-tracker/site/tests/water.mjs` (no dependencies). Made-up FIT files only.
import assert from 'node:assert';
import { readFit, readMessages, unitFromName, fitCrc } from '../lib/fit.mjs';
import * as W from '../lib/water.mjs';
import { writeFit, practiceFit, piecesFit, strokesFor } from '../scripts/make-fit.mjs';

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

for (const [name, fn] of tests) {
  try { fn(); passed++; } catch (e) { console.error('FAIL ' + name + '\n  ' + (e && e.message)); process.exitCode = 1; }
}
console.log(passed + '/' + tests.length + ' water tests passed');
