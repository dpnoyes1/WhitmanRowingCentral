// Runs the pure parts of the Apps Script in Node: `node tests/run.js`
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const dir = path.join(__dirname, '..', 'apps-script');
const ctx = vm.createContext({ console });
['Config.gs', 'Time.gs', 'Gms.gs', 'Sheet.gs', 'Form.gs', 'Submit.gs', 'Setup.gs', 'Plan.gs', 'PlanSheet.gs', 'Profile.gs'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
const g = ctx;

let passed = 0;
const test = (name, fn) => { fn(); passed++; };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('parseTime', () => {
  assert.strictEqual(g.parseTime('2:13.5'), 133.5);
  assert.strictEqual(g.parseTime('0:17.5'), 17.5);
  assert.strictEqual(g.parseTime('7:42.8'), 462.8);
  assert.strictEqual(g.parseTime('15:00'), 900);
  assert.strictEqual(g.parseTime('75:00.0'), 4500);
  assert.strictEqual(g.parseTime('1:05:00'), 3900);
  assert.strictEqual(g.parseTime(' 1:52.3 '), 112.3);
  assert.strictEqual(g.parseTime('133.5'), 133.5);
  assert.strictEqual(g.parseTime(''), null);
  assert.throws(() => g.parseTime('7:60.0'));
  assert.throws(() => g.parseTime('abc'));
  assert.throws(() => g.parseTime('7.42.8'));
});

test('formatTime', () => {
  assert.strictEqual(g.formatTime(133.5), '2:13.5');
  assert.strictEqual(g.formatTime(17.5), '0:17.5');
  assert.strictEqual(g.formatTime(59.96), '1:00.0');
  assert.strictEqual(g.formatTime(4500), '75:00.0');
  assert.strictEqual(g.formatTime(''), '');
  for (const t of ['0:17.5', '7:42.8', '19:59.9', '1:00.0']) assert.strictEqual(g.formatTime(g.parseTime(t)), t);
});

test('form time regex', () => {
  const re = new RegExp(g.TIME_PATTERN);
  ['7:42.8', '0:17.5', '15:00', '120:00.0'].forEach(t => assert.ok(re.test(t), t));
  ['7:4', '7:60', '742.8', '7:42.85', ':42.8'].forEach(t => assert.ok(!re.test(t), t));
});

test('GMS 2k at reference weight', () => {
  // 7:00 2k at 270 lb predicts exactly 5:15 = 2v8 slower edge
  near(g.gmsPredicted1500(420, 270), 315, 1e-9, 'P');
  near(g.gmsPercent('2000m', 420, 270), 95.238, 0.001, 'pct');
  assert.strictEqual(g.gmsStars('2000m', 420, 270), 2);
});

test('GMS planning-notes example (99.5%, 2.2s to next star, 7:42.8)', () => {
  const W = 140;
  near(g.gmsPercent('2000m', 465.0, W), 99.5, 0.05, 'pct');
  assert.strictEqual(g.gmsStars('2000m', 465.0, W), 2);
  const next = g.gmsNextStar('2000m', 465.0, W);
  assert.strictEqual(next.stars, 3);
  near(next.secondsFaster, 2.2, 0.1, 'gap');
  assert.strictEqual(g.formatTime(next.targetSeconds), '7:42.8');
  near(next.splitFaster, 0.55, 0.05, 'split');
});

test('GMS conversions and star rules', () => {
  // 500m split / 0.895 then x4
  near(g.gmsEquivalent2k('500m', 100), 100 / 0.895 * 4, 1e-9, '500m');
  near(g.gmsEquivalent2k('100m', 20), 100 / 0.786 * 4, 1e-9, '100m');
  // 5000m in 20 min = 2:00 split -> 1:51.5 2k split
  near(g.gmsEquivalent2k('20min', 5000), 111.5 * 4, 1e-9, '20min');
  assert.strictEqual(g.gmsEquivalent2k('30r20', 7000), null);
  assert.strictEqual(g.gmsStars('500m', 80, 150), 0, 'no stars on 500m');
  assert.strictEqual(g.gmsNextStar('2000m', 380, 150), null, 'already 3 stars');
  const n20 = g.gmsNextStar('20min', 5000, 270);
  assert.ok(n20.targetMeters > 5000 && n20.metersMore > 0);
});

const ctxFor = () => {
  let i = 0;
  return {
    submittedAt: new Date(2026, 0, 12, 18, 0), responseId: 'R1',
    athleteIds: { 'Jane Smith': 'A001' },
    newId: p => p + (++i),
    parseDate: s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  };
};

test('parse practice with intervals', () => {
  const Q = g.Q, i1 = g.qInterval(1), i2 = g.qInterval(2), i3 = g.qInterval(3);
  const ans = {
    [Q.ATHLETE]: 'Jane Smith', [Q.ENTERED_BY]: 'Coach Greta', [Q.DATE]: '2026-01-12',
    [Q.LOG_TYPE]: g.LOG_TYPES.PRACTICE, [Q.STATUS]: g.STATUSES.FULL,
    [Q.ACTIVITY]: 'Erg (RowErg)', [Q.WARMUP]: '15:00', [Q.MAIN_SET]: "3x10' r2'", [Q.ZONE]: 'UT1',
    [i1.WORK_TIME]: '10:00.0', [i1.WORK_M]: '2650', [i1.RATE]: '22', [i1.REST_TIME]: '2:00', [i1.REST_M]: '300', [i1.ANOTHER]: 'Yes',
    [i2.WORK_TIME]: '10:00.0', [i2.WORK_M]: '2660', [i2.REST_TIME]: '2:00', [i2.ANOTHER]: 'Yes',
    [i3.WORK_TIME]: '10:00.0', [i3.WORK_M]: '2675', [i3.ANOTHER]: 'No, that was the last one',
    [Q.COOLDOWN]: '5:00', [Q.RPE]: '6', [Q.DRAG]: '105'
  };
  const r = g.parseSubmission(ans, ctxFor());
  assert.strictEqual(r.entry['Session type'], 'Practice');
  assert.strictEqual(r.entry['Status'], 'Full');
  assert.strictEqual(r.entry['Warmup s'], 900);
  assert.strictEqual(r.entry['Work s'], 1800);
  assert.strictEqual(r.entry['Rest s'], 240);
  assert.strictEqual(r.entry['Cooldown s'], 300);
  assert.strictEqual(r.entry['Work m'], 7985);
  assert.strictEqual(r.entry['Rest m'], 300);
  assert.strictEqual(r.entry['Intervals'], 3);
  assert.strictEqual(r.entry['Athlete ID'], 'A001');
  assert.strictEqual(r.intervals.length, 3);
  assert.strictEqual(r.intervals[2]['Rest s'], '');
  const headers = g.HEADERS[g.TABS.ENTRIES];
  Object.keys(r.entry).forEach(k => assert.ok(headers.includes(k), 'entry column ' + k));
  Object.keys(r.intervals[0]).forEach(k => assert.ok(g.HEADERS[g.TABS.INTERVALS].includes(k), 'interval column ' + k));
});

test('parse practice out, make-up, OYO', () => {
  const Q = g.Q;
  const base = { [Q.ATHLETE]: 'Jane Smith', [Q.ENTERED_BY]: 'Jane Smith', [Q.DATE]: '2026-01-13' };
  const out = g.parseSubmission({ ...base, [Q.LOG_TYPE]: g.LOG_TYPES.PRACTICE, [Q.STATUS]: g.STATUSES.OUT, [Q.OUT_NOTE]: 'sick' }, ctxFor());
  assert.strictEqual(out.entry.Status, 'Out');
  assert.strictEqual(out.intervals.length, 0);
  const session = { [Q.ACTIVITY]: 'Run', [Q.WARMUP]: '5:00', [Q.MAIN_SET]: 'easy run', [Q.ZONE]: 'UT2',
    [g.qInterval(1).WORK_TIME]: '30:00', [g.qInterval(1).WORK_M]: '5000', [Q.RPE]: '4' };
  const mk = g.parseSubmission({ ...base, ...session, [Q.LOG_TYPE]: g.LOG_TYPES.MAKEUP, [Q.MAKEUP_FOR]: '2026-01-12' }, ctxFor());
  assert.strictEqual(mk.entry['Session type'], 'Make-up');
  assert.strictEqual(mk.entry['Make-up for date'].getDate(), 12);
  const oyo = g.parseSubmission({ ...base, ...session, [Q.LOG_TYPE]: g.LOG_TYPES.OYO }, ctxFor());
  assert.strictEqual(oyo.entry['Session type'], 'OYO');
  assert.strictEqual(oyo.entry['Cooldown s'], 0);
  assert.strictEqual(oyo.entry['Work s'], 1800);
  assert.throws(() => g.parseSubmission({ ...base, [Q.ATHLETE]: 'Nobody', [Q.LOG_TYPE]: g.LOG_TYPES.OYO }, ctxFor()), /Roster/);
});

test('parse benchmarks', () => {
  const Q = g.Q;
  const base = { [Q.ATHLETE]: 'Jane Smith', [Q.ENTERED_BY]: 'Coach David', [Q.DATE]: '2026-02-01', [Q.LOG_TYPE]: g.LOG_TYPES.BENCHMARK,
    [Q.B_WHERE]: g.TEST_WHERE.PRACTICE, [Q.B_WARMUP]: '15:00', [Q.B_RPE]: '9' };
  const twok = g.parseSubmission({ ...base, [Q.TEST]: '2000m', [Q.T_TIME]: '7:42.8', [Q.T_RATE]: '30', [Q.T_SPLITS]: '1:55.2, 1:56.0,1:56.1 1:55.5' }, ctxFor());
  assert.strictEqual(twok.benchmark.Test, '2000m');
  assert.strictEqual(twok.benchmark['Time s'], 462.8);
  assert.strictEqual(twok.benchmark['Splits s'], '115.2,116,116.1,115.5');
  const twenty = g.parseSubmission({ ...base, [Q.TEST]: "20' (20 min)", [Q.D_METERS]: '5000', [Q.D_RATE]: '24' }, ctxFor());
  assert.strictEqual(twenty.benchmark.Test, '20min');
  assert.strictEqual(twenty.benchmark.Meters, 5000);
  assert.strictEqual(twenty.benchmark['Time s'], '');
  Object.keys(twok.benchmark).forEach(k => assert.ok(g.HEADERS[g.TABS.BENCHMARKS].includes(k), 'bench column ' + k));
  // A test also counts as a session, linked both ways
  assert.strictEqual(twok.entry['Session type'], 'Practice');
  assert.strictEqual(twok.entry['Status'], 'Full');
  assert.strictEqual(twok.entry['Work s'], 462.8);
  assert.strictEqual(twok.entry['Work m'], 2000);
  assert.strictEqual(twok.entry['Warmup s'], 900);
  assert.strictEqual(twok.entry['Cooldown s'], 0);
  assert.strictEqual(twok.entry['RPE'], 9);
  assert.strictEqual(twok.entry['Benchmark ID'], twok.benchmark['Benchmark ID']);
  assert.strictEqual(twok.benchmark['Entry ID'], twok.entry['Entry ID']);
  assert.strictEqual(twok.intervals.length, 1);
  assert.strictEqual(twok.intervals[0]['Avg rate'], 30);
  assert.strictEqual(twenty.entry['Work s'], 1200);
  assert.strictEqual(twenty.entry['Work m'], 5000);
  assert.strictEqual(twenty.entry['Zone'], 'AT');
  const oyoTest = g.parseSubmission({ ...base, [Q.B_WHERE]: g.TEST_WHERE.OYO, [Q.B_COOLDOWN]: '5:00', [Q.TEST]: '30r20', [Q.D_METERS]: '7200', [Q.D_RATE]: '20' }, ctxFor());
  assert.strictEqual(oyoTest.entry['Session type'], 'OYO');
  assert.strictEqual(oyoTest.entry['Work s'], 1800);
  assert.strictEqual(oyoTest.entry['Cooldown s'], 300);
  Object.keys(twok.entry).forEach(k => assert.ok(g.HEADERS[g.TABS.ENTRIES].includes(k), 'entry column ' + k));
});

test('practice schedule: even Fri early, odd Fri late, no weekends', () => {
  const s = {};
  g.SETTINGS_DEFAULTS.forEach(([k, v]) => { s[k] = v; });
  // Mon 2027-01-11 .. Sun 2027-01-17. Fri the 15th is odd -> late.
  const rows = g.practiceDays(new Date(2027, 0, 11), new Date(2027, 0, 17), s);
  assert.strictEqual(rows.map(r => r.Date.getDate() + r.Shift).join(), ['11Early', '12Late', '13Early', '14Late', '15Late'].join());
  assert.strictEqual(rows[0]['Window start'], '15:00');
  assert.strictEqual(rows[0]['Window end'], '18:00');
  assert.strictEqual(rows[1]['Window start'], '16:30');
  assert.strictEqual(rows[1]['Window end'], '19:30');
  const fri22 = g.practiceDays(new Date(2027, 0, 22), new Date(2027, 0, 22), s);
  assert.strictEqual(fri22[0].Shift, 'Early');
});

test('no weight anywhere in the form', () => {
  const titles = JSON.stringify(g.Q) + fs.readFileSync(path.join(dir, 'Form.gs'), 'utf8');
  assert.ok(!/weight|\blbs?\b/i.test(titles), 'form must never mention weight');
});

// ---- Weekly plan and targets (dummy athletes only) ----
const planSettings = () => { const s = {}; g.SETTINGS_DEFAULTS.forEach(([k, v]) => { s[k] = v; }); return s; };
const D = (y, m, d) => new Date(y, m - 1, d);
const WORKOUTS = [
  { 'Workout ID': 'W1', Name: 'Steady 3x20', 'Piece #': 1, Reps: 3, 'Work type': 'Time', Work: '20:00', Rest: '2:00', Zone: 'UT1', Base: '', 'Target low %': '', 'Target high %': '' },
  { 'Workout ID': 'P1', Name: 'Pyramid', 'Piece #': 1, Reps: 1, 'Work type': 'Distance', Work: '2000m', Rest: '8:00', Zone: 'AT', Base: '2k', 'Target low %': 85 },
  { 'Workout ID': 'P1', 'Piece #': 3, Reps: 1, 'Work type': 'Distance', Work: '1000', Rest: '4:00', Zone: 'AT', 'Target low %': 92 },
  { 'Workout ID': 'P1', 'Piece #': 2, Reps: 1, 'Work type': 'Distance', Work: '1500', Rest: '6:00', Zone: 'AT', 'Target low %': 88 },
  { 'Workout ID': 'P1', 'Piece #': 4, Reps: 1, 'Work type': 'Distance', Work: '500', Rest: '2:00', Zone: 'AN', 'Target low %': 98 },
  { 'Workout ID': 'P1', 'Piece #': 5, Reps: 1, 'Work type': 'Distance', Work: '250', Rest: '', Zone: 'AN', 'Target low %': 105 },
  { 'Workout ID': 'S8', Name: '8x500 on the clock', 'Piece #': 1, Reps: 8, 'Work type': 'Distance', Work: '500', Rest: '', 'Start every': '3:30', Zone: 'AN', Base: '2k' },
  { 'Workout ID': 'U8', 'Piece #': 1, Reps: 8, 'Work type': 'Distance', Work: '500', Rest: 'Undefined', Zone: 'AN' },
  { 'Workout ID': 'X1', 'Piece #': 1, Reps: 1, 'Work type': 'Time', Work: '45:00', Activity: 'Run', Zone: 'UT2' }
];
// Fake athletes: Test Rower One has tests, Test Rower Two has none.
const ROSTER = [
  { 'Athlete ID': 'A901', Name: 'Test Rower One', Squad: 'Varsity' },
  { 'Athlete ID': 'A902', Name: 'Test Rower Two', Squad: 'Novice' }
];
const BENCH = [
  { 'Athlete ID': 'A901', Test: '2000m', Date: D(2026, 9, 20), 'Time s': 480, Meters: '' },     // 2:00.0 split, this season
  { 'Athlete ID': 'A901', Test: '2000m', Date: D(2026, 10, 5), 'Time s': 470, Meters: '', 'Review status': 'Rejected' },
  { 'Athlete ID': 'A901', Test: '2000m', Date: D(2027, 3, 1), 'Time s': 450, Meters: '' },       // future, ignored
  { 'Athlete ID': 'A901', Test: '20min', Date: D(2026, 2, 1), Meters: 4800, 'Time s': '' },      // last season only
  { 'Athlete ID': 'A901', Test: '20min', Date: D(2025, 2, 1), Meters: 5200, 'Time s': '' }       // two seasons ago, ignored
];

test('watts and split conversions', () => {
  near(g.wattsFromSplit(120), 202.546, 0.001, '2:00 split');
  near(g.splitFromWatts(g.wattsFromSplit(107.3)), 107.3, 1e-9, 'round trip');
  near(g.benchmarkWatts('2000m', 480, ''), 202.546, 0.001, '8:00 2k');
  near(g.benchmarkWatts('20min', '', 5000), 202.546, 0.001, '5000m 20min');
  assert.strictEqual(g.benchmarkWatts('500m', 90, ''), null);
});

test('season best: this school year, else last, never rejected or future', () => {
  assert.strictEqual(g.schoolYearStart(D(2026, 10, 22), '08-01').getTime(), D(2026, 8, 1).getTime());
  assert.strictEqual(g.schoolYearStart(D(2027, 3, 1), '08-01').getTime(), D(2026, 8, 1).getTime());
  const b2k = g.seasonBestWatts(BENCH, 'A901', '2k', D(2026, 11, 2), '08-01');
  near(b2k.watts, 202.546, 0.001, '2k best ignores rejected 7:50');
  assert.strictEqual(b2k.season, 'current');
  const b20 = g.seasonBestWatts(BENCH, 'A901', "20'", D(2026, 11, 2), '08-01');
  assert.strictEqual(b20.season, 'previous');
  near(b20.watts, g.benchmarkWatts('20min', '', 4800), 1e-9, '20min falls back one season only');
  assert.strictEqual(g.seasonBestWatts(BENCH, 'A902', '2k', D(2026, 11, 2), '08-01'), null);
});

test('workout pieces: variable intervals, start-every, undefined rest', () => {
  const p = g.workoutPieces(WORKOUTS, 'P1');
  assert.strictEqual(p.map(x => x.workM).join(), '2000,1500,1000,500,250');
  assert.strictEqual(p.map(x => x.restS).join(), '480,360,240,120,0');
  assert.strictEqual(g.pieceLabel(p[0]), '2000m r8:00 AT');
  assert.strictEqual(g.pieceLabel(g.workoutPieces(WORKOUTS, 'W1')[0]), '3 x 20:00 r2:00 UT1');
  const s8 = g.workoutPieces(WORKOUTS, 'S8')[0];
  assert.strictEqual(g.pieceLabel(s8), '8 x 500m start every 3:30 AN');
  assert.ok(s8.restUndefined);
  assert.strictEqual(g.pieceLabel(g.workoutPieces(WORKOUTS, 'U8')[0]), '8 x 500m r undefined AN');
  assert.throws(() => g.workoutPieces([{ 'Workout ID': 'B', 'Piece #': 1, 'Work type': 'Laps', Work: '3' }], 'B'), /Time or Distance/);
  assert.throws(() => g.workoutPieces([{ 'Workout ID': 'B', 'Piece #': 1, 'Work type': 'Distance', Work: 'far' }], 'B'), /Work is missing/);
});

test('targets: steady state range, AT/AN single, overrides, erg only', () => {
  const s = planSettings();
  const ut1 = g.workoutPieces(WORKOUTS, 'W1')[0];
  assert.deepStrictEqual({ ...g.pieceTargetPct(ut1, s) }, { base: '2k', low: 65, high: 75 });
  const t = g.pieceTarget(ut1, 202.546, s);
  assert.strictEqual(t.range, true);
  assert.strictEqual(t.lowW, 132);
  assert.strictEqual(t.highW, 152);
  assert.ok(t.slowSplit > t.fastSplit);
  assert.strictEqual(g.formatTarget(t), g.formatTime(t.slowSplit) + ' to ' + g.formatTime(t.fastSplit) + ' /500m (132-152 W)');
  const at = g.pieceTarget(g.workoutPieces(WORKOUTS, 'P1')[0], 202.546, s);
  assert.strictEqual(at.range, false);
  assert.strictEqual(at.highW, 172);
  assert.strictEqual(g.formatTarget(at), g.formatTime(at.fastSplit) + ' /500m (172 W)');
  assert.strictEqual(g.pieceTargetPct(g.workoutPieces(WORKOUTS, 'X1')[0], s), null, 'no erg target on a run');
  // AN default from Settings when the piece leaves % blank
  assert.strictEqual(g.pieceTargetPct(g.workoutPieces(WORKOUTS, 'U8')[0], s).low, 95);
});

const SCHEDULE = [
  { Date: D(2026, 11, 2), Squad: 'All', Session: 'Practice', 'Workout ID': 'W1', Published: true },
  { Date: D(2026, 11, 4), Squad: 'Varsity', Session: 'Practice', 'Workout ID': 'P1', Published: true },
  { Date: D(2026, 11, 5), Squad: 'All', Session: 'OYO', 'Workout ID': 'S8', Published: false },
  { Date: D(2026, 11, 9), Squad: 'All', Session: 'Practice', 'Workout ID': 'W1', Published: true }
];

test('week plan: published filter, squads, missing-benchmark flag', () => {
  const inputs = { schedule: SCHEDULE, workouts: WORKOUTS, roster: ROSTER, benchmarks: BENCH, settings: planSettings() };
  const all = g.buildWeekPlan({ ...inputs, weekStart: D(2026, 11, 2), publishedOnly: false });
  assert.strictEqual(all.sessions.length, 3, 'next Monday is out of the week');
  const pub = g.buildWeekPlan({ ...inputs, weekStart: D(2026, 11, 2), publishedOnly: true });
  assert.strictEqual(pub.sessions.length, 2, 'draft hidden');
  assert.strictEqual(pub.sessions[1].athletes.length, 1, 'Varsity only');
  const two = pub.sessions[0].athletes.find(a => a.athleteId === 'A902');
  assert.strictEqual(two.targets[0].text, '', 'no benchmark, no target');
  assert.strictEqual(pub.flags.map(f => f.athleteId + f.base).join(), 'A9022k');
  const typo = g.buildWeekPlan({ ...inputs, schedule: [{ Date: D(2026, 11, 3), 'Workout ID': 'NOPE', Published: true }], weekStart: D(2026, 11, 2), publishedOnly: true });
  assert.match(typo.flags[0].message, /NOPE on 2026-11-03 is not on the Workouts tab/);
  const site = g.weekPlanForSite(inputs, D(2026, 11, 2));
  assert.strictEqual(site.weekStart, '2026-11-02');
  assert.strictEqual(site.sessions[1].pieces.length, 5);
  assert.ok(site.sessions[0].athletes[0].targets[0].target.includes('W'));
  assert.ok(!/weight|\blbs?\b/i.test(JSON.stringify(site)), 'site payload never mentions weight');
});

test('plan check: make-up uses missed date, interval match and target hit', () => {
  const s = planSettings();
  const mk = { 'Session type': 'Make-up', Date: D(2026, 11, 6), 'Make-up for date': D(2026, 11, 4) };
  assert.strictEqual(g.plannedFor(mk, 'Varsity', SCHEDULE)['Workout ID'], 'P1');
  assert.strictEqual(g.plannedFor(mk, 'Novice', SCHEDULE), null, 'P1 was Varsity only');
  assert.strictEqual(g.plannedFor({ 'Session type': 'OYO', Date: D(2026, 11, 5) }, 'Novice', SCHEDULE)['Workout ID'], 'S8');
  const pieces = g.workoutPieces(WORKOUTS, 'W1');
  const iv = (n, s2, m) => ({ 'Interval #': n, 'Work s': s2, 'Work m': m });
  // Target 132-152 W is about 2:18.5 to 2:12.0. 2:13 and 2:16 are in, 2:20 is below
  const metersAt = split => Math.round(1200 * 500 / split);
  let c = g.checkAgainstPlan([iv(1, 1200, metersAt(133)), iv(2, 1200, metersAt(136)), iv(3, 1200, metersAt(140))], pieces, { '2k': 202.546 }, s);
  assert.strictEqual(c.matches, true);
  assert.strictEqual(c.intervals.map(x => x.status).join(), 'in,in,below');
  assert.strictEqual(c.hit, false);
  c = g.checkAgainstPlan([iv(1, 1200, metersAt(132)), iv(2, 1200, metersAt(132))], pieces, {}, s);
  assert.strictEqual(c.matches, false);
  assert.match(c.reason, /2 intervals logged, plan has 3/);
  assert.strictEqual(c.hit, null, 'no benchmark, no target check');
  // 8 x 500 on a start clock: rest is ignored, single target within 2%
  const s8 = g.workoutPieces(WORKOUTS, 'S8');
  const w = Math.round(202.546 * 0.95);
  const t500 = 500 * Math.pow(2.8 / w, 1 / 3);
  c = g.checkAgainstPlan(Array.from({ length: 8 }, (_, i) => iv(i + 1, t500, 500)), s8, { '2k': 202.546 }, s);
  assert.strictEqual(c.matches, true);
  assert.strictEqual(c.hit, true);
});

test('copy last week: dates +7, drafts only, other weeks untouched', () => {
  const rows = g.copyWeekRows(SCHEDULE, D(2026, 11, 9));
  assert.strictEqual(rows.length, 3, 'only 2-8 Nov is copied');
  assert.strictEqual(rows.map(r => r.Date.getDate()).join(), '9,11,12');
  assert.ok(rows.every(r => r.Published === false));
  assert.strictEqual(rows[1]['Workout ID'], 'P1');
  assert.strictEqual(rows[1].Squad, 'Varsity');
  Object.keys(rows[0]).forEach(k => assert.ok(g.HEADERS[g.TABS.SCHEDULE].includes(k), 'schedule column ' + k));
  assert.strictEqual(g.copyWeekRows(SCHEDULE, D(2026, 12, 7)).length, 0);
});

test('no weight anywhere in plan code', () => {
  for (const f of ['Plan.gs', 'PlanSheet.gs']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/Weight is never an input here\./, '').replace(/setFontWeight/g, '');
    assert.ok(!/weight|\blbs?\b/i.test(src), f + ' must not use weight');
  }
  assert.ok(!/weight/i.test(JSON.stringify([g.HEADERS[g.TABS.WORKOUTS], g.HEADERS[g.TABS.SCHEDULE]])));
});

test('profile: age group by age on Jan 1', () => {
  const today = new Date(2027, 2, 15);              // racing season 2027
  const D = (y, m, d) => new Date(y, m - 1, d);
  // 17 on Dec 31 2026 -> 17 on Jan 1 2027 -> not U17
  assert.strictEqual(g.ageGroup(D(2009, 12, 31), today), 'U19');
  assert.strictEqual(g.ageGroup(D(2010, 1, 1), today), 'U19');   // turns 17 on Jan 1 itself
  assert.strictEqual(g.ageGroup(D(2010, 1, 2), today), 'U17');   // still 16 on Jan 1
  assert.strictEqual(g.ageGroup(D(2011, 1, 2), today), 'U16');
  assert.strictEqual(g.ageGroup(D(2012, 1, 2), today), 'U15');
  assert.strictEqual(g.ageGroup(D(2014, 6, 1), today), 'U15');
  assert.strictEqual(g.ageGroup(D(2007, 5, 5), today), 'U19');
  assert.strictEqual(g.ageGroup('', today), '');
});

test('profile: school year rolls over July 1', () => {
  assert.strictEqual(g.schoolYear(2029, new Date(2026, 5, 30)), '9th');   // June 30 2026, end of 2025-26
  assert.strictEqual(g.schoolYear(2029, new Date(2026, 6, 1)), '10th');   // July 1 2026, start of 2026-27
  assert.strictEqual(g.schoolYear(2027, new Date(2026, 9, 23)), '12th');
  assert.strictEqual(g.schoolYear(2031, new Date(2026, 9, 23)), '8th');
  assert.strictEqual(g.schoolYear(2032, new Date(2026, 9, 23)), '7th');
  assert.strictEqual(g.schoolYear(2033, new Date(2026, 9, 23)), '');
  assert.strictEqual(g.schoolYear(2026, new Date(2026, 9, 23)), 'Graduated');
  assert.strictEqual(g.schoolYear('', new Date(2026, 9, 23)), '');
});

test('profile: roster columns appended and formulas reference them', () => {
  const h = g.HEADERS[g.TABS.ROSTER];
  assert.strictEqual(h.slice(0, 10).join(), 'Athlete ID,Name,Slack member ID,Squad,Role,OYO group,OYO required min,OYO elite min,Active,Notes');
  assert.strictEqual(h.slice(10).join(), 'Birthday,Grad year,Age group,School year');
  const letters = {}; h.forEach((x, i) => { letters[x] = g.columnLetter_(i + 1); });
  assert.strictEqual(letters['Birthday'], 'K');
  assert.strictEqual(letters['Grad year'], 'L');
  assert.strictEqual(g.columnLetter_(27), 'AA');
  const ag = g.COMPUTED_COLUMNS[g.TABS.ROSTER]['Age group'](letters);
  const sy = g.COMPUTED_COLUMNS[g.TABS.ROSTER]['School year'](letters);
  assert.ok(ag.startsWith('={"Age group";') && ag.includes('K2:K') && ag.includes('DATE(YEAR(TODAY()),1,1)'), ag);
  assert.ok(sy.startsWith('={"School year";') && sy.includes('L2:L') && sy.includes('MONTH(TODAY())>=7'), sy);
  for (const f of [ag, sy]) {
    let depth = 0; for (const c of f) { if (c === '(') depth++; if (c === ')') depth--; assert.ok(depth >= 0, f); }
    assert.strictEqual(depth, 0, 'balanced parens: ' + f);
  }
});

console.log(`${passed} tests passed`);
