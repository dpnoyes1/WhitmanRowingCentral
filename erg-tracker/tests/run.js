// Runs the pure parts of the Apps Script in Node: `node tests/run.js`
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const dir = path.join(__dirname, '..', 'apps-script');
const ctx = vm.createContext({ console });
['Config.gs', 'Time.gs', 'Gms.gs', 'Sheet.gs', 'Form.gs', 'Submit.gs', 'Setup.gs', 'Plan.gs', 'PlanSheet.gs', 'Profile.gs', 'Dummy.gs', 'TeamGms.gs', 'Regatta.gs', 'Feed.gs', 'Ops.gs', 'Logbook.gs', 'PlanFlags.gs', 'SlackLog.gs'].forEach(f =>
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
  assert.strictEqual(g.gmsStars('2000m', 420, 270), 2, '95.2% is 2 stars');
  assert.strictEqual(g.gmsStars('2000m', 300 / 0.75 / 0.95, 270), 2, 'exactly 95% counts as 2 stars');
  assert.strictEqual(g.gmsStars('2000m', 300 / 0.75, 270), 5, 'exactly 100% is 5 stars');
  assert.strictEqual(g.gmsStars('2000m', 600, 270), 1, 'every 2k earns at least 1 star');
});

test('GMS planning-notes example (99.5%, 2.2s to next star, 7:42.8)', () => {
  const W = 140;
  near(g.gmsPercent('2000m', 465.0, W), 99.5, 0.05, 'pct');
  assert.strictEqual(g.gmsStars('2000m', 465.0, W), 4);
  const next = g.gmsNextStar('2000m', 465.0, W);
  assert.strictEqual(next.stars, 5);
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
    [Q.ACTIVITY]: 'Erg (RowErg)', [Q.WARMUP]: '15:00', [Q.MAIN_SET]: "3x10' r2'", [Q.ZONE]: 'Aerobic',
    [i1.WORK_TIME]: '10:00.0', [i1.WORK_M]: '2650', [i1.RATE]: '22', [i1.REST_TIME]: '2:00', [i1.REST_M]: '300', [i1.ANOTHER]: 'Yes',
    [i2.WORK_TIME]: '10:00.0', [i2.WORK_M]: '2660', [i2.REST_TIME]: '2:00', [i2.ANOTHER]: 'Yes',
    [i3.WORK_TIME]: '10:00.0', [i3.WORK_M]: '2675', [i3.ANOTHER]: 'No, that was the last one',
    [Q.COOLDOWN]: '5:00', [Q.RPE]: '6', [Q.DRAG]: '105', [Q.WARMUP_M]: '2000', [Q.COOLDOWN_M]: ''
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
  assert.strictEqual(r.entry['Warmup m'], 2000);
  assert.strictEqual(r.entry['Cooldown m'], '');
  assert.strictEqual(r.entry['Intervals'], 3);
  assert.strictEqual(r.entry['Athlete ID'], 'A001');
  assert.strictEqual(r.intervals.length, 3);
  assert.strictEqual(r.intervals[2]['Rest s'], '');
  const headers = g.HEADERS[g.TABS.ENTRIES];
  Object.keys(r.entry).forEach(k => assert.ok(headers.includes(k), 'entry column ' + k));
  assert.strictEqual(headers.slice(-2).join(), 'Warmup m,Cooldown m');
  Object.keys(r.intervals[0]).forEach(k => assert.ok(g.HEADERS[g.TABS.INTERVALS].includes(k), 'interval column ' + k));
});

test('parse practice out, make-up, OYO', () => {
  const Q = g.Q;
  const base = { [Q.ATHLETE]: 'Jane Smith', [Q.ENTERED_BY]: 'Jane Smith', [Q.DATE]: '2026-01-13' };
  const out = g.parseSubmission({ ...base, [Q.LOG_TYPE]: g.LOG_TYPES.PRACTICE, [Q.STATUS]: g.STATUSES.OUT, [Q.OUT_NOTE]: 'sick' }, ctxFor());
  assert.strictEqual(out.entry.Status, 'Out');
  assert.strictEqual(out.intervals.length, 0);
  const session = { [Q.ACTIVITY]: 'Run', [Q.WARMUP]: '5:00', [Q.MAIN_SET]: 'easy run', [Q.ZONE]: 'Aerobic',
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
  const withDrag = g.parseSubmission({ ...base, [Q.TEST]: '2000m', [Q.T_TIME]: '7:42.8', [Q.T_DRAG]: '105' }, ctxFor());
  assert.strictEqual(withDrag.benchmark['Drag factor'], 105);
  assert.strictEqual(withDrag.benchmark['Drag check'], '', 'a test with drag has no flag');
  assert.strictEqual(twok.benchmark['Drag check'], 'FLAG: no drag factor', 'a benchmark with no drag is flagged');
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
  assert.strictEqual(twenty.entry['Zone'], 'Threshold');
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

test('team GMS: best 2k/20\' per rower, team-wide raw rank bands, year to date', () => {
  // Fake athletes. All at the reference weight (270) so GMS % = 100 * 300 / (0.75 * t2k).
  const roster = [];
  const weights = [];
  const benchmarks = [];
  for (let i = 1; i <= 18; i++) {
    const id = 'T' + String(i).padStart(3, '0');
    roster.push({ 'Athlete ID': id, Name: 'Test Rower ' + i, Squad: i % 2 ? 'Varsity' : 'Novice', Role: 'Rower' });
    weights.push({ Date: new Date(2025, 7, 1), 'Athlete ID': id, 'Weight lb': 270 });
    benchmarks.push({ Date: new Date(2026, 8, 15), 'Athlete ID': id, Test: '2000m', 'Time s': 400 + i, Meters: '' });
  }
  roster.push({ 'Athlete ID': 'C001', Name: 'Test Cox', Squad: 'Varsity', Role: 'Coxswain' });
  benchmarks.push({ Date: new Date(2026, 8, 15), 'Athlete ID': 'C001', Test: '2000m', 'Time s': 380 });
  // Ignored: 500m (not in this view), rejected, after the as-of date.
  benchmarks.push({ Date: new Date(2026, 8, 16), 'Athlete ID': 'T018', Test: '500m', 'Time s': 80 });
  benchmarks.push({ Date: new Date(2026, 8, 16), 'Athlete ID': 'T018', Test: '2000m', 'Time s': 390, 'Review status': 'Rejected' });
  benchmarks.push({ Date: new Date(2026, 9, 30), 'Athlete ID': 'T017', Test: '2000m', 'Time s': 390 });
  // A 20' that beats T001's 2k: 2k split = 600000/6200 - 8.5
  benchmarks.push({ Date: new Date(2026, 9, 1), 'Athlete ID': 'T001', Test: '20min', 'Time s': '', Meters: 6200 });
  // Last year: same window (Jul 1 + 82 days) vs a later full-year result. T002 was Novice then.
  benchmarks.push({ Date: new Date(2025, 8, 20), 'Athlete ID': 'T002', Test: '2000m', 'Time s': 450 });
  benchmarks.push({ Date: new Date(2026, 1, 20), 'Athlete ID': 'T002', Test: '2000m', 'Time s': 420 });
  benchmarks.push({ Date: new Date(2025, 8, 20), 'Athlete ID': 'T003', Test: '2000m', 'Time s': 440 });
  const squadHistory = [{ 'School year': '2025-26', 'Athlete ID': 'T002', Squad: 'Novice' }];
  const settings = {}; g.SETTINGS_DEFAULTS.forEach(([k, v]) => { settings[k] = v; });
  const asOf = new Date(2026, 9, 22);
  const years = g.teamGmsByYear({ benchmarks, weights, roster, squadHistory, settings, asOf });
  const pct = t => 100 * 300 / (0.75 * t);

  assert.strictEqual(years.map(y => y.schoolYear).join(), '2026-27,2025-26');
  const cur = years[0];
  assert.strictEqual(cur.athletes.length, 18, 'coxswain left out');
  const t1 = (600000 / 6200 - 8.5) * 4;
  assert.strictEqual(cur.athletes[0].athleteId, 'T001');
  near(cur.athletes[0].best2k, t1, 1e-9, 'T001 ranks on 20\' equivalent');
  near(cur.athletes[0].bestGms, pct(t1), 1e-9, 'T001 best GMS from 20\'');
  near(cur.athletes.find(a => a.athleteId === 'T018').best2k, 418, 1e-9, 'rejected and 500m ignored');
  near(cur.athletes.find(a => a.athleteId === 'T017').best2k, 417, 1e-9, 'future result ignored');

  const avg = ids => ids.reduce((s, i) => s + (i === 1 ? pct(t1) : pct(400 + i)), 0) / ids.length;
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
  near(cur.groups.team.avg, avg(range(1, 18)), 1e-9, 'team');
  assert.strictEqual(cur.groups.team.n, 18);
  near(cur.groups.varsity.avg, avg(range(1, 18).filter(i => i % 2)), 1e-9, 'varsity');
  near(cur.groups.novice.avg, avg(range(1, 18).filter(i => !(i % 2))), 1e-9, 'novice');
  near(cur.groups.rank1_8.avg, avg(range(1, 8)), 1e-9, '1-8');
  near(cur.groups.rank9_16.avg, avg(range(9, 16)), 1e-9, '9-16');
  near(cur.groups.rank17.avg, avg([17, 18]), 1e-9, '17+');

  const last = years[1];
  assert.strictEqual(last.end.getMonth(), 9, 'last year to date ends Oct');
  assert.strictEqual(last.end.getDate(), 22);
  near(last.groups.team.avg, (pct(450) + pct(440)) / 2, 1e-9, 'last year to date');
  assert.strictEqual(last.groups.novice.n, 1, 'squad from history');
  assert.strictEqual(last.groups.varsity.n, 1, 'no history falls back to Roster');
  near(last.fullYear.team.avg, (pct(420) + pct(440)) / 2, 1e-9, 'last full year');

  // No weight on or before the test: still ranked, but no GMS %.
  const early = g.teamGmsByYear({ benchmarks: [{ Date: new Date(2026, 7, 5), 'Athlete ID': 'T001', Test: '2000m', 'Time s': 420 }],
    weights: [{ Date: new Date(2026, 7, 10), 'Athlete ID': 'T001', 'Weight lb': 270 }], roster, squadHistory: [], settings, asOf });
  assert.strictEqual(early[0].athletes[0].bestGms, null);
  assert.strictEqual(early[0].groups.team.avg, null);
  assert.strictEqual(early[0].groups.team.tested, 1);

  // Site view: averages only, small groups hidden, no names or weights.
  const site = g.teamGmsForSite(years, 3);
  assert.strictEqual(site[0].groups.rank17.hidden, true);
  assert.strictEqual(site[0].groups.rank17.avg, null);
  assert.strictEqual(site[0].groups.rank1_8.avg, Math.round(avg(range(1, 8)) * 10) / 10);
  assert.strictEqual(site[1].groups.team.hidden, true);
  const json = JSON.stringify(site);
  assert.ok(!/Test Rower|T0\d\d|weight|lb|best2k|rank"/i.test(json), 'site view leaks no athlete data: ' + json);
});

test('team GMS settings and labels', () => {
  assert.strictEqual(g.schoolYearLabel(2026), '2026-27');
  assert.strictEqual(g.schoolYearLabel(2099), '2099-00');
  const o = g.gmsOptionsFromSettings({ 'gms.standard_s': '310', 'gms.exponent': 'x' });
  assert.strictEqual(o.standard, 310);
  assert.strictEqual(o.exponent, 0.222);
  assert.ok(g.HEADERS[g.TABS.SQUAD_HISTORY].includes('Squad'));
});

test('regatta: crew erg averages up to race day, % off winner and 3rd', () => {
  const roster = [];
  const weights = [];
  const benchmarks = [];
  for (let i = 1; i <= 9; i++) {
    const id = 'T' + String(i).padStart(3, '0');
    roster.push({ 'Athlete ID': id, Name: 'Test Rower ' + i, Squad: 'Varsity', Role: i === 9 ? 'Coxswain' : 'Rower' });
    weights.push({ Date: new Date(2025, 7, 1), 'Athlete ID': id, 'Weight lb': 270 });
    if (i <= 7) benchmarks.push({ Date: new Date(2026, 2, 1), 'Athlete ID': id, Test: '2000m', 'Time s': 420 });
  }
  benchmarks.push({ Date: new Date(2026, 2, 2), 'Athlete ID': 'T001', Test: '20min', Meters: 5000 });
  benchmarks.push({ Date: new Date(2026, 2, 3), 'Athlete ID': 'T001', Test: '20min', Meters: 5100 });
  benchmarks.push({ Date: new Date(2026, 4, 20), 'Athlete ID': 'T002', Test: '2000m', 'Time s': 400 }); // after race day
  benchmarks.push({ Date: new Date(2025, 2, 1), 'Athlete ID': 'T003', Test: '2000m', 'Time s': 390 }); // last school year
  const seats = {};
  for (let i = 1; i <= 8; i++) seats['Seat ' + i] = 'Test Rower ' + i;
  const settings = {}; g.SETTINGS_DEFAULTS.forEach(([k, v]) => { settings[k] = v; });
  const races = [
    { Date: new Date(2026, 4, 16), Regatta: 'Fake Cup', Championship: true, Event: 'Girls V8', Boat: '8+', Round: 'Final',
      Time: '5:10.0', Place: 3, '1st time': '5:00.0', '2nd time': '5:05.0', '3rd time': '5:10.0', ...seats, Cox: 'Test Rower 9' },
    { Date: new Date(2026, 4, 9), Regatta: 'Fake Cup', Championship: false, Event: 'Girls V8', Boat: '8+', Round: 'Heat',
      Time: '5:00.0', Place: 1, '1st time': '5:00.0', '2nd time': '5:06.0', '3rd time': '', ...seats, 'Seat 8': 'Not A Rower' },
    { Date: new Date(2026, 4, 9), Regatta: 'Fake Cup', Event: 'Girls 4+', Boat: '4+', Time: '', Place: '', ...seats },
    { Date: '', Regatta: 'Blank row' }
  ];
  const out = g.raceSummaries({ races, benchmarks, weights, roster, settings });
  assert.strictEqual(out.length, 3);
  assert.strictEqual(out.map(r => r.event + r.round).join(), 'Girls 4+,Girls V8Final,Girls V8Heat', 'grouped by event, newest first');

  const final = out[1];
  assert.strictEqual(final.championship, true);
  near(final.vsWinnerPct, 100 * 10 / 300, 1e-9, 'vs winner');
  near(final.vsThirdPct, 0, 1e-9, 'vs 3rd');
  assert.strictEqual(final.seats, 8);
  assert.strictEqual(final.tested, 7, 'seat 8 has no test; cox never counted');
  assert.strictEqual(final.untested.join(), 'Test Rower 8');
  near(final.avg2k.avg, 420, 1e-9, 'later 2k and last-year 2k ignored');
  assert.strictEqual(final.avg2k.n, 7);
  near(final.gms2k.avg, 100 * 300 / (0.75 * 420), 1e-9, '2k GMS');
  assert.strictEqual(final.avg20min.avg, 5100, 'best 20\'');
  assert.strictEqual(final.avg20min.n, 1);
  near(final.gms20min.avg, g.gmsPercent('20min', 5100, 270), 1e-9, '20\' GMS');

  const heat = out[2];
  near(heat.vsWinnerPct, 100 * (300 - 306) / 306, 1e-9, 'win shows margin over 2nd');
  assert.strictEqual(heat.vsThirdPct, null);
  assert.strictEqual(heat.unknown.join(), 'Not A Rower');

  const four = out[0];
  assert.strictEqual(four.seats, 4);
  assert.strictEqual(four.tested, 4, '4+ reads Seats 1-4 only');
  assert.strictEqual(four.vsWinnerPct, null);
  assert.strictEqual(four.place, null);
  Object.keys(races[0]).forEach(k => assert.ok(g.HEADERS[g.TABS.RACES].includes(k), 'race column ' + k));
});

test('no weight anywhere in the form', () => {
  const titles = JSON.stringify(g.Q) + fs.readFileSync(path.join(dir, 'Form.gs'), 'utf8');
  assert.ok(!/weight|\blbs?\b/i.test(titles), 'form must never mention weight');
});

// ---- Weekly plan and targets (dummy athletes only) ----
const planSettings = () => { const s = {}; g.SETTINGS_DEFAULTS.forEach(([k, v]) => { s[k] = v; }); return s; };
const D = (y, m, d) => new Date(y, m - 1, d);
const WORKOUTS = [
  { 'Workout ID': 'W1', Name: 'Steady 3x20', 'Piece #': 1, Reps: 3, 'Work type': 'Time', Work: '20:00', Rest: '2:00', Zone: 'Aerobic', Base: '', 'Target low %': '', 'Target high %': '' },
  { 'Workout ID': 'P1', Name: 'Pyramid', 'Piece #': 1, Reps: 1, 'Work type': 'Distance', Work: '2000m', Rest: '8:00', Zone: 'Threshold', Base: '2k', 'Target low %': 85 },
  { 'Workout ID': 'P1', 'Piece #': 3, Reps: 1, 'Work type': 'Distance', Work: '1000', Rest: '4:00', Zone: 'Threshold', 'Target low %': 92 },
  { 'Workout ID': 'P1', 'Piece #': 2, Reps: 1, 'Work type': 'Distance', Work: '1500', Rest: '6:00', Zone: 'Threshold', 'Target low %': 88 },
  { 'Workout ID': 'P1', 'Piece #': 4, Reps: 1, 'Work type': 'Distance', Work: '500', Rest: '2:00', Zone: 'Anaerobic', 'Target low %': 98 },
  { 'Workout ID': 'P1', 'Piece #': 5, Reps: 1, 'Work type': 'Distance', Work: '250', Rest: '', Zone: 'Anaerobic', 'Target low %': 105 },
  { 'Workout ID': 'S8', Name: '8x500 on the clock', 'Piece #': 1, Reps: 8, 'Work type': 'Distance', Work: '500', Rest: '', 'Start every': '3:30', Zone: 'Anaerobic', Base: '2k' },
  { 'Workout ID': 'U8', 'Piece #': 1, Reps: 8, 'Work type': 'Distance', Work: '500', Rest: 'Undefined', Zone: 'Anaerobic' },
  { 'Workout ID': 'X1', 'Piece #': 1, Reps: 1, 'Work type': 'Time', Work: '45:00', Activity: 'Run', Zone: 'Aerobic' }
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
  assert.strictEqual(g.schoolYearStart(D(2026, 10, 22), '07-01').getTime(), D(2026, 7, 1).getTime());
  assert.strictEqual(g.schoolYearStart(D(2027, 3, 1), '07-01').getTime(), D(2026, 7, 1).getTime());
  const b2k = g.seasonBestWatts(BENCH, 'A901', '2k', D(2026, 11, 2), '07-01');
  near(b2k.watts, 202.546, 0.001, '2k best ignores rejected 7:50');
  assert.strictEqual(b2k.season, 'current');
  const b20 = g.seasonBestWatts(BENCH, 'A901', "20'", D(2026, 11, 2), '07-01');
  assert.strictEqual(b20.season, 'previous');
  near(b20.watts, g.benchmarkWatts('20min', '', 4800), 1e-9, '20min falls back one season only');
  assert.strictEqual(g.seasonBestWatts(BENCH, 'A902', '2k', D(2026, 11, 2), '07-01'), null);
});

test('workout pieces: variable intervals, start-every, undefined rest', () => {
  const p = g.workoutPieces(WORKOUTS, 'P1');
  assert.strictEqual(p.map(x => x.workM).join(), '2000,1500,1000,500,250');
  assert.strictEqual(p.map(x => x.restS).join(), '480,360,240,120,0');
  assert.strictEqual(g.pieceLabel(p[0]), '2000m r8:00 Threshold');
  assert.strictEqual(g.pieceLabel(g.workoutPieces(WORKOUTS, 'W1')[0]), '3 x 20:00 r2:00 Aerobic');
  const s8 = g.workoutPieces(WORKOUTS, 'S8')[0];
  assert.strictEqual(g.pieceLabel(s8), '8 x 500m start every 3:30 Anaerobic');
  assert.ok(s8.restUndefined);
  assert.strictEqual(g.pieceLabel(g.workoutPieces(WORKOUTS, 'U8')[0]), '8 x 500m r undefined Anaerobic');
  assert.throws(() => g.workoutPieces([{ 'Workout ID': 'B', 'Piece #': 1, 'Work type': 'Laps', Work: '3' }], 'B'), /Time or Distance/);
  assert.throws(() => g.workoutPieces([{ 'Workout ID': 'B', 'Piece #': 1, 'Work type': 'Distance', Work: 'far' }], 'B'), /Work is missing/);
});

test('targets: steady state range, Threshold/Anaerobic single, overrides, erg only', () => {
  const s = planSettings();
  const ut1 = g.workoutPieces(WORKOUTS, 'W1')[0];
  assert.deepStrictEqual({ ...g.pieceTargetPct(ut1, s) }, { base: '2k', low: 60, high: 70 });
  const t = g.pieceTarget(ut1, 202.546, s);
  assert.strictEqual(t.range, true);
  assert.strictEqual(t.lowW, 122);   // 60% of 202.5 W
  assert.strictEqual(t.highW, 142);  // 70% of 202.5 W
  assert.ok(t.slowSplit > t.fastSplit);
  assert.strictEqual(g.formatTarget(t), g.formatTime(t.slowSplit) + ' to ' + g.formatTime(t.fastSplit) + ' /500m (122-142 W)');
  const at = g.pieceTarget(g.workoutPieces(WORKOUTS, 'P1')[0], 202.546, s);
  assert.strictEqual(at.range, false);
  assert.strictEqual(at.highW, 172);
  assert.strictEqual(g.formatTarget(at), g.formatTime(at.fastSplit) + ' /500m (172 W)');
  assert.strictEqual(g.pieceTargetPct(g.workoutPieces(WORKOUTS, 'X1')[0], s), null, 'no erg target on a run');
  // Anaerobic default from Settings when the piece leaves % blank
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
  // Target 122-142 W is about 2:22.1 to 2:15.1. 2:16 and 2:19 are in, 2:25 is below
  const metersAt = split => Math.round(1200 * 500 / split);
  let c = g.checkAgainstPlan([iv(1, 1200, metersAt(136)), iv(2, 1200, metersAt(139)), iv(3, 1200, metersAt(145))], pieces, { '2k': 202.546 }, s);
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

test('plan flag: Full but short of plan asks about Modified', () => {
  assert.strictEqual(g.planFlag({ Status: 'Full' }, { matches: false, logged: 5, planned: 8, reason: '5 intervals logged, plan has 8' }),
    'Logged Full, short of plan (5 of 8): Modified?');
  assert.strictEqual(g.planFlag({ Status: 'Modified' }, { matches: false, logged: 5, planned: 8 }), '');
  assert.strictEqual(g.planFlag({ Status: 'Full' }, { matches: true, logged: 8, planned: 8 }), '');
  assert.ok(/does not match plan \(Interval 2 is not/.test(g.planFlag({ Status: 'Full' }, { matches: false, logged: 8, planned: 8, reason: 'Interval 2 is not 500m' })));
  const c = g.checkAgainstPlan([], [], {}, {});
  assert.strictEqual(c.logged, 0); assert.strictEqual(c.planned, 0);
});

const dummySettings = () => { const s = {}; g.SETTINGS_DEFAULTS.forEach(r => { s[r[0]] = r[1]; }); return s; };
const dummy = g.buildDummyData({ settings: dummySettings() });

test('dummy: 30 athletes, novices 7th-9th, varsity 10th-12th, unique fake-marked names', () => {
  const today = new Date(2026, 9, 23);
  assert.strictEqual(dummy.roster.length, 30);
  const grades = {};
  dummy.roster.forEach(r => {
    const y = g.schoolYear(r['Grad year'], today);
    grades[r.Squad + ' ' + y] = (grades[r.Squad + ' ' + y] || 0) + 1;
    assert.ok(g.isDummyRow_(g.TABS.ROSTER, r), r.Name);
    assert.ok(/^A9\d\d$/.test(r['Athlete ID']), r['Athlete ID']);
    assert.ok(g.ageGroup(r.Birthday, today), r.Name);
  });
  assert.deepStrictEqual(grades, { 'Novice 7th': 4, 'Novice 8th': 4, 'Novice 9th': 4,
    'Varsity 10th': 6, 'Varsity 11th': 6, 'Varsity 12th': 6 });
  assert.strictEqual(new Set(dummy.roster.map(r => r.Name)).size, 30);
});

test('dummy: same data every run, every row marked, columns match headers', () => {
  const again = g.buildDummyData({ settings: dummySettings() });
  assert.strictEqual(JSON.stringify(again), JSON.stringify(dummy));
  const tabs = { roster: 'ROSTER', weights: 'WEIGHTS', practices: 'PRACTICES', workouts: 'WORKOUTS',
    schedule: 'SCHEDULE', entries: 'ENTRIES', intervals: 'INTERVALS', benchmarks: 'BENCHMARKS' };
  Object.keys(tabs).forEach(k => {
    const name = g.TABS[tabs[k]];
    const writable = g.HEADERS[name].slice(0, g.writableWidth_(name));
    dummy[k].forEach(r => {
      Object.keys(r).forEach(h => assert.ok(writable.includes(h), k + ' has unknown column ' + h));
      assert.ok(g.isDummyRow_(name, r), k + ' row not marked');
    });
  });
  assert.strictEqual(g.writableWidth_(g.TABS.ROSTER), g.HEADERS[g.TABS.ROSTER].indexOf('Age group'));
  assert.ok(!g.isDummyRow_(g.TABS.ENTRIES, { 'Entry ID': 'E12AB', Source: 'Form' }));
  assert.ok(!g.isDummyRow_(g.TABS.ROSTER, { Notes: 'Captain' }));
});

test('dummy: clear picks only marked rows, never real rows around them', () => {
  const roster = [{ Notes: '' }, { Notes: 'DUMMY: sprinter' }, { Notes: 'DUMMY' }, { Notes: 'Captain' }, { Notes: '' }, { Notes: 'DUMMY' }];
  assert.deepStrictEqual(Array.from(g.dummyRowNumbers_(g.TABS.ROSTER, roster)), [3, 4, 7]);
  const bench = [{ Source: 'Form' }, { Source: 'Dummy' }, { Source: 'Import' }, { 'Benchmark ID': 'B-DUMMY-0001' }];
  assert.deepStrictEqual(Array.from(g.dummyRowNumbers_(g.TABS.BENCHMARKS, bench)), [3, 5]);
  assert.deepStrictEqual(Array.from(g.dummyRowNumbers_(g.TABS.WORKOUTS, [{ 'Workout ID': 'W01' }, { 'Workout ID': 'DUMMY-W01' }])), [3]);
});

test('dummy: sessions link to intervals and tests, times in seconds, at most 10 intervals', () => {
  const byEntry = {};
  dummy.intervals.forEach(iv => { (byEntry[iv['Entry ID']] = byEntry[iv['Entry ID']] || []).push(iv); });
  const entryIds = new Set(dummy.entries.map(e => e['Entry ID']));
  assert.strictEqual(entryIds.size, dummy.entries.length);
  dummy.intervals.forEach(iv => assert.ok(entryIds.has(iv['Entry ID'])));
  dummy.entries.forEach(e => {
    const ivs = byEntry[e['Entry ID']] || [];
    if (e.Status === 'Out') { assert.strictEqual(ivs.length, 0); return; }
    assert.ok(ivs.length >= 1 && ivs.length <= g.MAX_INTERVALS, e['Entry ID']);
    near(e['Work s'], ivs.reduce((s, iv) => s + Number(iv['Work s']), 0), 0.05, 'work s');
    assert.strictEqual(typeof e['Warmup s'], 'number');
    ivs.forEach(iv => assert.strictEqual(iv['Work s'], Math.round(iv['Work s'] * 10) / 10));
  });
  const benchIds = new Set(dummy.benchmarks.map(b => b['Benchmark ID']));
  dummy.benchmarks.forEach(b => {
    const e = dummy.entries.find(x => x['Entry ID'] === b['Entry ID']);
    assert.ok(e && e['Benchmark ID'] === b['Benchmark ID'], b['Benchmark ID']);
    if (b.Test === '2000m') near(b['Splits s'].split(',').reduce((s, x) => s + Number(x), 0), b['Time s'], 0.05, 'splits');
  });
  dummy.entries.filter(e => e['Benchmark ID']).forEach(e => assert.ok(benchIds.has(e['Benchmark ID'])));
  assert.ok(dummy.entries.every(e => !Object.keys(e).some(k => /weight/i.test(k))));
});

test('dummy: three test rounds a month apart, mostly better but not always', () => {
  const dates = [...new Set(dummy.benchmarks.map(b => g.dayKey_(b.Date)))].sort();
  assert.deepStrictEqual(dates, ['2026-08-24', '2026-08-27', '2026-09-21', '2026-09-24', '2026-10-19', '2026-10-22']);
  const twoK = {};
  dummy.benchmarks.filter(b => b.Test === '2000m').forEach(b => { (twoK[b['Athlete ID']] = twoK[b['Athlete ID']] || []).push(b); });
  let improvedOverall = 0, slower = 0, full = 0;
  Object.values(twoK).forEach(rows => {
    rows.sort((a, b) => a.Date - b.Date);
    const t = rows.map(r => r['Time s']);
    if (t.length === 3) { full++; if (t[2] < t[0]) improvedOverall++; }
    for (let i = 1; i < t.length; i++) if (t[i] > t[i - 1]) { slower++; break; }
  });
  assert.ok(full >= 20, 'most athletes took all three 2ks: ' + full);
  assert.ok(improvedOverall >= full * 0.75, 'most improved: ' + improvedOverall + '/' + full);
  assert.ok(slower >= 4, 'some got slower in a round: ' + slower);
});

test('dummy: weights only on Weights, one per athlete per round they joined for', () => {
  assert.ok(dummy.weights.length >= 80 && dummy.weights.length <= 90, dummy.weights.length);
  dummy.weights.forEach(w => assert.ok(w['Weight lb'] >= 90 && w['Weight lb'] <= 185, w['Weight lb']));
  ['entries', 'intervals', 'benchmarks', 'roster', 'schedule', 'workouts'].forEach(k =>
    assert.ok(!JSON.stringify(dummy[k]).match(/weight|\blb\b/i), k + ' mentions weight'));
});

test('dummy: practices Oct 5-23, plan checks run, one rower flagged with no benchmark', () => {
  const pr = dummy.entries.filter(e => e['Session type'] === 'Practice');
  const days = [...new Set(pr.map(e => g.dayKey_(e.Date)).filter(k => k >= '2026-10-01'))].sort();
  assert.strictEqual(days.length, 15);
  assert.strictEqual(days[0], '2026-10-05');
  assert.strictEqual(days[14], '2026-10-23');
  const squads = {}; dummy.roster.forEach(r => { squads[r['Athlete ID']] = r.Squad; });
  let checked = 0, matched = 0;
  dummy.entries.forEach(e => {
    if (e.Status === 'Out' || e['Session type'] === 'OYO') return;
    const p = g.plannedFor(e, squads[e['Athlete ID']], dummy.schedule);
    assert.ok(p, 'no plan for ' + e['Entry ID']);
    const c = g.checkAgainstPlan(dummy.intervals.filter(iv => iv['Entry ID'] === e['Entry ID']),
      g.workoutPieces(dummy.workouts, p['Workout ID']), {}, dummySettings());
    checked++; if (c.matches) matched++;
  });
  assert.ok(matched / checked > 0.95, matched + '/' + checked);
  const plan = g.buildWeekPlan({ schedule: dummy.schedule, workouts: dummy.workouts, roster: dummy.roster,
    benchmarks: dummy.benchmarks, settings: dummySettings(), weekStart: new Date(2026, 9, 26), publishedOnly: true });
  assert.ok(plan.sessions.length >= 5);
  assert.deepStrictEqual([...new Set(plan.flags.map(f => f.athlete))], ['Hazel Whitcomb']);
});

test('dummy: varied attendance, a 5+ day absence, make-ups and OYO below and above goals', () => {
  const outs = {};
  dummy.entries.filter(e => e.Status === 'Out').forEach(e => { (outs[e.Athlete] = outs[e.Athlete] || []).push(e); });
  assert.ok((outs['Julia Thornton'] || []).length >= 5, 'return-to-training case');
  assert.ok(Object.keys(outs).length >= 8, 'several athletes logged an Out');
  const makeups = dummy.entries.filter(e => e['Session type'] === 'Make-up');
  assert.ok(makeups.length >= 5);
  makeups.forEach(m => {
    const gap = (m.Date - m['Make-up for date']) / 864e5;
    assert.ok(gap > 0 && gap <= 7, 'make-up within 7 days');
  });
  assert.ok(dummy.entries.filter(e => e.Status === 'Modified').length >= 5);
  const mult = {}; g.ACTIVITIES.forEach(a => { mult[a[0]] = a[1]; });
  const week1 = {};
  dummy.entries.filter(e => e['Session type'] === 'OYO' && e.Date < new Date(2026, 9, 12)).forEach(e => {
    week1[e.Athlete] = (week1[e.Athlete] || 0) + e['Work s'] / 60 * mult[e.Activity];
  });
  const v = Object.values(week1);
  assert.ok(v.filter(x => x < 60).length >= 3, 'some miss Required');
  assert.ok(v.filter(x => x >= 120).length >= 5, 'some reach Elite');
  assert.ok(new Set(dummy.entries.filter(e => e['Session type'] === 'OYO').map(e => e.Activity)).size >= 6);
});

test('dummy: athletes at every star level, some earning a new star', () => {
  const weightOn = (id, date) => dummy.weights.filter(w => w['Athlete ID'] === id && w.Date <= date)
    .sort((a, b) => b.Date - a.Date)[0]['Weight lb'];
  const stars = {};
  dummy.benchmarks.forEach(b => {
    const n = g.gmsStars(b.Test, b.Test === '2000m' ? b['Time s'] : b.Meters, weightOn(b['Athlete ID'], b.Date));
    const a = stars[b['Athlete ID']] = stars[b['Athlete ID']] || { first: null, best: 0 };
    if (a.first === null) a.first = n;
    a.best = Math.max(a.best, n);
  });
  const levels = [0, 0, 0, 0, 0, 0];
  Object.values(stars).forEach(a => { levels[a.best] += 1; });
  assert.strictEqual(levels[0], 0, 'everyone tested has at least 1 star');
  // The 1-point bands are narrow, so only ask that every level shows up.
  levels.slice(1).forEach((n, i) => assert.ok(n >= 1, (i + 1) + ' stars: ' + n + ' athletes'));
  assert.ok(Object.values(stars).filter(a => a.best > a.first).length >= 5, 'some earn a new star');
});

const dummyFeedInputs = () => ({
  roster: dummy.roster, entries: dummy.entries, intervals: dummy.intervals, benchmarks: dummy.benchmarks, weights: dummy.weights,
  practices: dummy.practices, schedule: dummy.schedule, workouts: dummy.workouts, squadHistory: [],
  settings: dummySettings()
});

test('site feed: never sends weight, birthdays or coach notes', () => {
  const feed = JSON.parse(JSON.stringify(g.siteFeed(dummyFeedInputs(), new Date(2026, 9, 23, 12))));
  const text = JSON.stringify(feed);
  assert.ok(!/weight|birthday|coach ?note|slack|notes"?:"DUMMY/i.test(text.replace(/"multipliers":\{[^}]*\}/, '')), 'forbidden key in feed');
  dummy.roster.forEach(r => assert.ok(!text.includes(JSON.stringify(r.Birthday)), 'birthday leaked for ' + r.Name));
  const lbs = new Set(dummy.weights.map(w => w['Weight lb']));
  feed.athletes.forEach(a => Object.values(a).forEach(v => assert.ok(typeof v !== 'number' || !lbs.has(v) || v === a.oyoRequired || v === a.oyoElite)));
  const outNotes = dummy.entries.filter(e => e['Coach note']).map(e => e['Coach note']);
  assert.ok(outNotes.length > 0);
  outNotes.forEach(n => assert.ok(!text.includes(n), 'coach note leaked: ' + n));
  feed.entries.forEach(e => assert.deepStrictEqual(Object.keys(e).filter(k => /note|hr|weight/i.test(k)), []));
});

test('site feed: sign-in codes are keyed HMACs of the birthday, never the date', () => {
  const crypto = require('crypto');
  const sign = (id, day) => crypto.createHmac('sha256', 'k').update('login:' + id + ':' + day).digest('hex');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(g.siteFeed(dummyFeedInputs(), new Date(2026, 9, 23, 12)))).logins, [], 'no signer, no codes');
  const feed = JSON.parse(JSON.stringify(g.siteFeed(Object.assign(dummyFeedInputs(), { signLogin: sign }), new Date(2026, 9, 23, 12))));
  const withBirthday = dummy.roster.filter(r => r.Birthday && g.isActive_(r.Active));
  assert.strictEqual(feed.logins.length, withBirthday.length);
  withBirthday.forEach(r => {
    const day = g.dayKey_(r.Birthday);
    assert.strictEqual(feed.logins.find(l => l.id === r['Athlete ID']).code, sign(r['Athlete ID'], day));
    assert.ok(!JSON.stringify(feed).includes(day), 'birthday date leaked for ' + r.Name);
  });
  assert.ok(!/birthday/i.test(JSON.stringify(feed)));
  // Settings test password: every athlete gets the same date; coaches by name (made-up people).
  const inputs = Object.assign(dummyFeedInputs(), { signLogin: sign });
  inputs.settings['site.test_password'] = 'Fri Jan 01 2010 00:00:00 GMT-0500 (Eastern Standard Time)';
  inputs.settings['site.coaches'] = 'Pat Example 02/03/1980; Sam  O\'Test 1975-12-31; no date here';
  const t = JSON.parse(JSON.stringify(g.siteFeed(inputs, new Date(2026, 9, 23, 12))));
  withBirthday.forEach(r => assert.strictEqual(t.logins.find(l => l.id === r['Athlete ID']).code, sign(r['Athlete ID'], '2010-01-01')));
  assert.deepStrictEqual(t.logins.filter(l => l.coach).map(l => l.code), [sign('coach:pat example', '1980-02-03'), sign('coach:sam otest', '1975-12-31')]);
  assert.ok(!/Pat|1980|1975/.test(JSON.stringify(t.logins)), 'coach names and dates stay out');
  assert.strictEqual(g.feedParseDay_('1/1/2010'), '2010-01-01');
  assert.strictEqual(g.feedParseDay_(''), '');
  // Same bytes as Apps Script's signer (Utilities returns signed bytes).
  g.Utilities = { computeHmacSha256Signature: (v, key) => Array.from(crypto.createHmac('sha256', key).update(v).digest()).map(b => (b > 127 ? b - 256 : b)) };
  assert.strictEqual(g.feedLoginSigner_('k')('A901', '2010-03-14'), sign('A901', '2010-03-14'));
});

test('site feed: shape, GMS and stars per result, week plans without coach flags', () => {
  const feed = JSON.parse(JSON.stringify(g.siteFeed(dummyFeedInputs(), new Date(2026, 9, 23, 12))));
  assert.strictEqual(feed.today, '2026-10-23');
  assert.strictEqual(feed.athletes.length, 30);
  assert.ok(feed.athletes.every(a => a.grade && a.oyoRequired > 0 && a.oyoElite >= a.oyoRequired));
  assert.strictEqual(feed.entries.length, dummy.entries.length);
  assert.ok(feed.entries.every(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date)));
  const twoK = feed.benchmarks.filter(b => b.test === '2000m');
  assert.ok(twoK.length > 0 && twoK.every(b => b.gmsPct > 50 && b.gmsPct < 130 && b.stars >= 1 && b.stars <= 5));
  // Matches Gms.gs directly for one result.
  const b0 = dummy.benchmarks.find(b => b.Test === '2000m');
  const lb = g.weightOn_(dummy.weights, b0['Athlete ID'], b0.Date);
  const f0 = feed.benchmarks.find(b => b.id === b0['Benchmark ID']);
  near(f0.gmsPct, g.gmsPercent('2000m', b0['Time s'], lb), 0.05, 'gms %');
  assert.strictEqual(f0.stars, g.gmsStars('2000m', b0['Time s'], lb));
  feed.benchmarks.filter(b => b.nextStar).forEach(b => {
    const keys = Object.keys(b.nextStar).sort().join(',');
    assert.ok(keys === 'secondsFaster,splitFaster,stars,targetS' || keys === 'metersMore,splitFaster,stars,targetM', keys);
  });
  assert.ok(feed.benchmarks.filter(b => b.test === '20min').every(b => b.gmsPct === null || b.gmsPct > 50));
  assert.strictEqual(feed.weeks.length, 3);
  assert.deepStrictEqual(feed.weeks.map(w => w.weekStart), ['2026-10-12', '2026-10-19', '2026-10-26']);
  assert.ok(feed.weeks[2].sessions.length > 0, 'planned week of Oct 26');
  // Results: logged sessions checked against the plan, raw splits only.
  const done = feed.weeks[1].sessions.flatMap(sn => sn.results);
  assert.ok(done.length > 50, 'this week has results: ' + done.length);
  assert.ok(feed.weeks[2].sessions.every(sn => sn.results.length === 0), 'nothing logged ahead');
  assert.ok(done.every(r => r.intervals.every(iv => iv.splitS === null || (iv.splitS > 80 && iv.splitS < 200))));
  assert.ok(done.some(r => r.test) && done.filter(r => r.test).every(r => r.hit === null), 'tests are scored, not ranged');
  // BikeErg: half the meters, so its /1000m split lines up with the RowErg /500m target.
  const bike = feed.weeks.flatMap(w => w.sessions.flatMap(sn => sn.results)).filter(r => r.activity === 'BikeErg');
  assert.ok(bike.length > 0 && bike.every(r => r.intervals.every(iv => iv.splitS > 80 && iv.splitS < 200)), 'bike splits are row-equivalent');
  assert.ok(bike.some(r => r.hit !== null), 'bike sessions are ranged');
  const conv = g.rowEquivalentIntervals([{ 'Work s': 120, 'Work m': 1000 }], 'BikeErg')[0];
  assert.strictEqual(Math.round(g.wattsFromSplit(conv['Work s'] * 500 / conv['Work m']) * 10) / 10, 202.5, '2:00/1000m bike = 202.5 W');
  assert.strictEqual(g.rowEquivalentIntervals([{ 'Work m': 1000 }], 'Erg (RowErg)')[0]['Work m'], 1000);
  const lastWeek = feed.weeks[0].sessions.flatMap(sn => sn.results);
  assert.ok(lastWeek.some(r => r.hit === true) && lastWeek.some(r => r.hit === false), 'a mix of in and out of range');
  assert.ok(done.every(r => ['in', 'below', 'above', ''].includes(r.intervals[0] ? r.intervals[0].status : '')));
  assert.deepStrictEqual(Object.keys(done[0]).sort(), ['activity', 'athleteId', 'date', 'entryId', 'flag', 'hit', 'intervals', 'matches', 'reason', 'status', 'test', 'type']);
  assert.ok(feed.weeks.every(w => !('coachFlags' in w)));
  assert.ok(feed.teamGms.length >= 1 && feed.teamGms[0].schoolYear === '2026-27');
  assert.ok(JSON.parse(JSON.stringify(feed)), 'JSON-safe');
});

test('site feed: key check', () => {
  assert.ok(g.feedKeyMatches_('abc123', 'abc123'));
  assert.ok(!g.feedKeyMatches_('abc123', 'abc124'));
  assert.ok(!g.feedKeyMatches_('abc123', 'abc12'));
  assert.ok(!g.feedKeyMatches_('abc123', ''));
  assert.ok(!g.feedKeyMatches_('abc123', undefined));
});

test('ops: site health problems', () => {
  const ok = { status: 200, body: { ok: true, checks: { env: true, feed: true, fresh: true, athleteLogins: true } } };
  assert.deepStrictEqual(Array.from(g.healthProblems(200, ok)), []);
  assert.ok(/down/.test(g.healthProblems(503, ok)[0]));
  assert.ok(/could not reach/.test(g.healthProblems('no answer', { error: 'DNS' }).join(' ')));
  assert.ok(/FEED_KEY/.test(g.healthProblems(200, { status: 401, body: { error: 'unauthorized' } })[0]));
  const broken = { status: 503, body: { ok: false, feedError: 'feed HTTP 500', checks: { env: true, feed: false } } };
  assert.ok(/feed HTTP 500/.test(g.healthProblems(200, broken)[0]));
  const stale = { status: 503, body: { checks: { env: true, feed: true, fresh: false, athleteLogins: true }, generatedAt: 'x' } };
  assert.ok(/old data/.test(g.healthProblems(200, stale)[0]));
  const noCodes = { status: 503, body: { athletes: 30, checks: { env: true, feed: true, fresh: true, athleteLogins: false } } };
  assert.ok(/can't sign in/.test(g.healthProblems(200, noCodes)[0]));
  assert.ok(/404/.test(g.healthProblems(200, { status: 404, body: null })[0]), 'health endpoint not deployed');
});

test('ops: alert once on break, daily while broken, once on recovery', () => {
  const H = 3600 * 1000;
  let t = g.alertTransition(null, [], 0);
  assert.strictEqual(t.send, null);
  t = g.alertTransition(t.state, ['x'], 1 * H);
  assert.strictEqual(t.send, 'down');
  t = g.alertTransition(t.state, ['x'], 2 * H);
  assert.strictEqual(t.send, null);
  t = g.alertTransition(t.state, ['x'], 25 * H);
  assert.strictEqual(t.send, 'still');
  assert.strictEqual(t.state.since, 1 * H);
  t = g.alertTransition(t.state, [], 26 * H);
  assert.strictEqual(t.send, 'up');
  t = g.alertTransition(t.state, [], 27 * H);
  assert.strictEqual(t.send, null);
  assert.ok(/working again/.test(g.alertText('up', [], '', 'https://x')));
  assert.ok(/• a\n• b/.test(g.alertText('down', ['a', 'b'], '', 'https://x')));
});

test('plan flags: only recent Full entries short of plan, once, until a coach decides', () => {
  const today = new Date(2026, 9, 23, 12);
  const squads = {}; dummy.roster.forEach(r => { squads[r['Athlete ID']] = r.Squad; });
  const inp = { schedule: dummy.schedule, workouts: dummy.workouts, benchmarks: dummy.benchmarks, settings: dummySettings() };
  const day = (d) => g.dayKey_(d);
  const full = dummy.entries.find(e => e['Session type'] === 'Practice' && e.Status === 'Full' && day(e.Date) === '2026-10-21' &&
    dummy.intervals.filter(iv => iv['Entry ID'] === e['Entry ID']).length > 2);
  assert.ok(full, 'dummy has a Full practice on Oct 21');
  const all = dummy.intervals.filter(iv => iv['Entry ID'] === full['Entry ID']);
  const short = all.slice(0, -1);
  const pending = (e, ivs, posted) => Array.from(g.pendingPlanFlags([e], ivs, squads, inp, today, posted || []));
  assert.strictEqual(pending(full, all).length, 0, 'matches the plan: no flag');
  const hit = pending(full, short);
  assert.strictEqual(hit.length, 1);
  assert.ok(/short of plan/.test(hit[0].flag) && hit[0].entryId === full['Entry ID'], hit[0].flag);
  assert.strictEqual(pending(full, short, [full['Entry ID']]).length, 0, 'posted once');
  assert.strictEqual(pending(Object.assign({}, full, { 'Review status': 'Reviewed, Full' }), short).length, 0, 'decided');
  assert.strictEqual(pending(Object.assign({}, full, { Status: 'Modified' }), short).length, 0, 'already Modified');
  assert.strictEqual(pending(Object.assign({}, full, { Date: new Date(2026, 9, 10) }), short).length, 0, 'too old');
  assert.strictEqual(pending(Object.assign({}, full, { Date: new Date(2026, 9, 25) }), short).length, 0, 'in the future');
  const msg = g.planFlagMessage(hit[0], 'https://sheet.example/#gid=1');
  assert.ok(/^:warning: Plan check: .*, Wed Oct 21, Practice\. Logged Full, short of plan/.test(msg.text), msg.text);
  const ids = msg.blocks[1].elements.map(b => b.action_id);
  assert.deepStrictEqual(Array.from(ids), ['plan_modified', 'plan_reviewed', 'plan_open']);
  assert.strictEqual(msg.blocks[1].elements[0].value, full['Entry ID']);
  assert.strictEqual(msg.blocks[1].elements[2].url, 'https://sheet.example/#gid=1');
  assert.ok(g.OPS_TRIGGERS.indexOf('sweepPlanFlags') >= 0);
});

test('plan flag buttons: coaches only, first press wins, what each press writes', () => {
  const coaches = Array.from(g.slackCoachIds_({ 'slack.coach_ids': 'U1, U2;U3' }));
  assert.deepStrictEqual(coaches, ['U1', 'U2', 'U3']);
  assert.deepStrictEqual(Array.from(g.slackCoachIds_({})), []);
  const row = { 'Entry ID': 'E1', Status: 'Full', 'Review status': '' };
  const plain = (x) => JSON.parse(JSON.stringify(x));
  assert.deepStrictEqual(plain(g.decidePlanFlagAction(row, 'modified', 'U9', coaches)), { status: 'forbidden' }, 'not a coach');
  assert.deepStrictEqual(plain(g.decidePlanFlagAction(row, 'modified', '', coaches)), { status: 'forbidden' });
  assert.deepStrictEqual(plain(g.decidePlanFlagAction(row, 'modified', 'U1', [])), { status: 'forbidden' }, 'no coach IDs set');
  assert.deepStrictEqual(plain(g.decidePlanFlagAction(null, 'modified', 'U1', coaches)), { status: 'missing' });
  assert.deepStrictEqual(plain(g.decidePlanFlagAction(row, 'modified', 'U1', coaches)),
    { status: 'ok', set: { Status: 'Modified', 'Review status': 'Reviewed, Modified' } });
  assert.deepStrictEqual(plain(g.decidePlanFlagAction(row, 'reviewed', 'U2', coaches)),
    { status: 'ok', set: { 'Review status': 'Reviewed, Full' } });
  assert.deepStrictEqual(plain(g.decidePlanFlagAction(Object.assign({}, row, { 'Review status': 'Reviewed, Full' }), 'modified', 'U3', coaches)),
    { status: 'already', reviewStatus: 'Reviewed, Full' }, 'first press wins');
  assert.strictEqual(g.decidePlanFlagAction(row, 'nope', 'U1', coaches).status, 'error');
  assert.ok(g.SETTINGS_DEFAULTS.some(r => r[0] === 'slack.coach_ids'));
  assert.strictEqual(g.PLAN_FLAG_ACTION, 'plan-flag-action');
});

test('Monday list: rowers missing a 2k or a 20\' test', () => {
  const today = new Date(2026, 9, 26);
  const row = (id, name, extra) => Object.assign({ 'Athlete ID': id, Name: name, Squad: 'Varsity' }, extra);
  const roster = [row('A1', 'Fake One'), row('A2', 'Fake Two'), row('A3', 'Fake Three'), row('A4', 'Fake Four'), row('A5', 'Fake Five'), row('A6', 'Fake Six', { Squad: 'Alum' }), row('A7', 'Fake Seven')];
  const bm = (id, test, extra) => Object.assign({ 'Athlete ID': id, Test: test, Date: new Date(2026, 8, 20), 'Time s': test === '2000m' ? 420 : 1200, Meters: test === '20min' ? 5200 : '', 'Review status': '' }, extra);
  const benchmarks = [
    bm('A2', '2000m'),                                                  // has a 2k, no 20'
    bm('A3', '20min', { Date: new Date(2025, 9, 5) }),                  // 20' last school year still counts
    bm('A4', '2000m', { 'Review status': 'Rejected' }),                 // rejected rows are ignored
    bm('A5', '2000m', { Date: new Date(2024, 9, 5) }),                  // two seasons old: no target
    bm('A7', '2000m'), bm('A7', '20min')                                // both: not listed
  ];
  const plain = (l) => JSON.parse(JSON.stringify(l));
  assert.deepStrictEqual(plain(g.noTargetAthletes(roster, benchmarks, today, '07-01')), [
    { name: 'Fake One', missing: ['2k', "20'"] },
    { name: 'Fake Two', missing: ["20'"] },
    { name: 'Fake Three', missing: ['2k'] },
    { name: 'Fake Four', missing: ['2k', "20'"] },
    { name: 'Fake Five', missing: ['2k', "20'"] }
  ]);
  assert.deepStrictEqual(plain(g.noTargetAthletes([], benchmarks, today, '07-01')), []);
  assert.strictEqual(g.noTargetText([]), '', 'silent when nobody is missing');
  assert.ok(/1 athlete is missing a 2k or 20' test.*\n\u2022 Fake Two \(no 20'\)/.test(g.noTargetText([{ name: 'Fake Two', missing: ["20'"] }])));
  assert.ok(/2 athletes are[\s\S]*\u2022 A \(no 2k, no 20'\)\n\u2022 B \(no 2k\)/.test(g.noTargetText([{ name: 'A', missing: ['2k', "20'"] }, { name: 'B', missing: ['2k'] }])));
  assert.ok(g.OPS_TRIGGERS.indexOf('sendNoTargetList') >= 0, 'reinstalled with the other ops triggers');
});

test('ops: backups keep the newest, never archives', () => {
  const names = ['Erg tracker backup 2026-10-04 2300', 'Erg tracker backup 2026-10-18 2300', 'Erg tracker backup 2026-10-11 2300',
    'Erg tracker archive 2025-26', 'Something else'];
  assert.deepStrictEqual(Array.from(g.backupsToTrash(names, 2)), ['Erg tracker backup 2026-10-04 2300']);
  assert.deepStrictEqual(Array.from(g.backupsToTrash(names, 12)), []);
  assert.strictEqual(g.backupsToTrash(names, 0).length, 2, 'always keep at least one');
});

test('alum squad: no plan targets, not in team GMS', () => {
  assert.strictEqual(g.squadMatches_('All', 'Alum'), false);
  assert.strictEqual(g.squadMatches_('Varsity', 'Alum'), false);
  assert.strictEqual(g.squadMatches_('All', 'Varsity'), true);
  const settings = {}; g.SETTINGS_DEFAULTS.forEach(([k, v]) => { settings[k] = v; });
  const roster = [
    { 'Athlete ID': 'T001', Name: 'Test Rower', Squad: 'Varsity', Role: 'Rower' },
    { 'Athlete ID': 'T002', Name: 'Test Alum', Squad: 'Alum', Role: 'Rower' }
  ];
  const weights = ['T001', 'T002'].map((id) => ({ Date: new Date(2025, 7, 1), 'Athlete ID': id, 'Weight lb': 270 }));
  const benchmarks = ['T001', 'T002'].map((id) => ({ Date: new Date(2026, 8, 15), 'Athlete ID': id, Test: '2000m', 'Time s': 420 }));
  const years = g.teamGmsByYear({ benchmarks, weights, roster, squadHistory: [], settings, asOf: new Date(2026, 9, 22) });
  assert.deepStrictEqual(Array.from(years[0].athletes.map((a) => a.athleteId)), ['T001']);
  assert.strictEqual(years[0].groups.team.tested, 1);
});

test('ops: new school year closes the right year and retires graduates', () => {
  const y = (d) => { const r = g.rolloverYear(new Date(d + 'T12:00:00'), '07-01'); return [r.label, r.gradYear]; };
  assert.deepStrictEqual(y('2027-06-10'), ['2026-27', 2027]);
  assert.deepStrictEqual(y('2027-07-31'), ['2026-27', 2027]);
  assert.deepStrictEqual(y('2027-08-15'), ['2026-27', 2027], 'just after Jul 1: the year that ended');
  assert.deepStrictEqual(y('2027-10-31'), ['2027-28', 2028]);
  assert.deepStrictEqual(y('2027-11-02'), ['2027-28', 2028]);
  const roster = [
    { Name: 'Fake Senior', Active: 'Yes', 'Grad year': 2027 },
    { Name: 'Fake Junior', Active: 'Yes', 'Grad year': 2028 },
    { Name: 'Fake Old', Active: 'No', 'Grad year': 2025 },
    { Name: 'Fake Missed', Active: 'Yes', 'Grad year': 2026 },
    { Name: 'Fake NoYear', Active: 'Yes', 'Grad year': '' }
  ];
  assert.deepStrictEqual(Array.from(g.graduatesToRetire(roster, 2027)).map((r) => r.Name), ['Fake Senior', 'Fake Missed']);
});

test('site feed: break ranges from Settings', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(g.feedBreakRanges_('12/23/2026-01/03/2027; 2027-02-19 to 2027-02-15'))),
    [{ from: '2026-12-23', to: '2027-01-03' }, { from: '2027-02-15', to: '2027-02-19' }]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(g.feedBreakRanges_(''))), []);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(g.feedBreakRanges_('12/23/2026'))), []);
  const inputs = dummyFeedInputs();
  inputs.settings = Object.assign({}, inputs.settings, { 'oyo.break.dates': '12/23/2026-01/03/2027', 'oyo.break.required': '30', 'oyo.break.elite': '' });
  const b = JSON.parse(JSON.stringify(g.siteFeed(inputs, new Date(2026, 9, 23, 12)))).settings.oyoBreak;
  assert.deepStrictEqual(b, { ranges: [{ from: '2026-12-23', to: '2027-01-03' }], required: 30, elite: null });
});

test('refreshFormQuestions_ resets the Activity choices from ACTIVITIES', () => {
  let choices = ['Erg (RowErg)', 'Hike', 'Walk'];
  const listItem = { getTitle: () => g.Q.ACTIVITY, asListItem() { return this; }, setChoiceValues(v) { choices = v; return this; } };
  const otherList = { getTitle: () => g.Q.ATHLETE, asListItem() { throw new Error('must not touch other lists'); } };
  ctx.FormApp = {
    ItemType: { LIST: 'LIST', TEXT: 'TEXT' },
    createTextValidation: () => ({ setHelpText() { return this; }, requireNumberBetween() { return this; }, build() { return {}; } })
  };
  g.refreshFormQuestions_({ getItems: (t) => (t === 'LIST' ? [otherList, listItem] : []) });
  delete ctx.FormApp;
  assert.deepStrictEqual(Array.from(choices), Array.from(g.ACTIVITIES, (a) => a[0]));
  assert.ok(!choices.includes('Hike') && !choices.includes('Walk'));
});

// Logbook sync: normalized Netlify payload -> pending Entries/Intervals rows
const lbPractices = [
  { date: '2026-10-26', squad: 'Girls', canceled: false, windowStart: '15:00', windowEnd: '18:00' },
  { date: '2026-10-27', squad: 'Girls', canceled: false, windowStart: '16:30', windowEnd: '19:30' },
  { date: '2026-10-28', squad: 'Girls', canceled: true, windowStart: '15:00', windowEnd: '18:00' },
  { date: '2026-10-29', squad: 'Girls', canceled: false, windowStart: '16:30', windowEnd: '19:30' }
];
const lbCtx = (entries = []) => {
  let i = 0;
  return {
    athlete: { id: 'A001', name: 'Jane Smith', squad: 'Girls' }, practices: lbPractices, entries,
    now: new Date(2026, 9, 29, 20, 0), newId: p => p + (++i),
    parseDate: s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  };
};
const lbResult = (over = {}) => ({
  id: 122191976, localDate: '2026-10-29', localTime: '17:15', machine: 'rower', name: '3x0:30/0:30r',
  workoutType: 'VariableInterval', timeS: 90, distanceM: 290, dragFactor: 98,
  intervals: [
    { timeS: 30, distanceM: 87, rate: 22, restTimeS: 30, restDistanceM: 48 },
    { timeS: 30, distanceM: 101, rate: 22, restTimeS: 30, restDistanceM: 47 },
    { timeS: 30, distanceM: 101, rate: 22, restTimeS: '', restDistanceM: '' }
  ], ...over
});

test('logbook: classify practice, OYO and possible make-up', () => {
  const c = (d, t, e = []) => g.classifyLogbook('Girls', d, t, lbPractices, e);
  assert.strictEqual(c('2026-10-29', '17:15').type, 'Practice');
  assert.strictEqual(c('2026-10-29', '16:30').type, 'Practice');
  // after the window: no missed practice in the last 7 days if all are logged
  const logged = [{ date: '2026-10-26', type: 'Practice', status: 'Full' }, { date: '2026-10-27', type: 'Practice', status: 'Full' }];
  assert.strictEqual(c('2026-10-29', '21:00', logged).type, 'OYO');
  // missed Oct 27 (Out on Oct 26 counts as missed), canceled Oct 28 never counts
  const m = c('2026-10-29', '21:00', [{ date: '2026-10-26', type: 'Practice', status: 'Out' }]);
  assert.deepStrictEqual([m.type, m.makeupFor, m.possible], ['Make-up', '2026-10-27', true]);
  // already covered by a make-up
  const covered = c('2026-10-29', '21:00', [{ date: '2026-10-26', type: 'Practice', status: 'Full' }, { date: '2026-10-27', type: 'Make-up', makeupFor: '2026-10-27' }]);
  assert.strictEqual(covered.type, 'OYO');
  // older than 7 days or a canceled day never match; no practice that day is OYO
  assert.strictEqual(g.classifyLogbook('Girls', '2026-11-06', '17:00', lbPractices, logged).type, 'OYO');
  assert.strictEqual(c('2026-10-28', '16:00', logged).type, 'OYO');
  assert.strictEqual(g.classifyLogbook('Boys', '2026-10-29', '17:15', lbPractices, []).type, 'OYO');
});

test('logbook: interval result becomes a pending entry with pieces', () => {
  const r = g.logbookRows(lbResult(), lbCtx());
  assert.strictEqual(r.entry['Source'], 'Logbook');
  assert.strictEqual(r.entry['Review status'], 'Pending');
  assert.strictEqual(r.entry['Response ID'], 'logbook:122191976');
  assert.strictEqual(r.entry['Session type'], 'Practice');
  assert.strictEqual(r.entry['Status'], 'Full');
  assert.strictEqual(r.entry['Activity'], 'Erg (RowErg)');
  assert.strictEqual(r.entry['Work s'], 90);
  assert.strictEqual(r.entry['Work m'], 289);
  assert.strictEqual(r.entry['Rest s'], 60);
  assert.strictEqual(r.entry['Rest m'], 95);
  assert.strictEqual(r.entry['Intervals'], 3);
  assert.strictEqual(r.entry['Drag factor'], 98);
  assert.strictEqual(r.intervals.length, 3);
  assert.strictEqual(r.intervals[2]['Rest s'], '');
  const headers = g.HEADERS[g.TABS.ENTRIES];
  Object.keys(r.entry).forEach(k => assert.ok(headers.includes(k), 'entry column ' + k));
  Object.keys(r.intervals[0]).forEach(k => assert.ok(g.HEADERS[g.TABS.INTERVALS].includes(k), 'interval column ' + k));
  assert.ok(!JSON.stringify(r).match(/weight/i));
});

test('logbook: totals only, just row, possible make-up, benchmark shape, unsupported machine', () => {
  const totals = g.logbookRows(lbResult({ intervals: [], timeS: 64.8, distanceM: 222, workoutType: 'JustRow', name: '' }), lbCtx());
  assert.strictEqual(totals.intervals.length, 1);
  assert.strictEqual(totals.entry['Work s'], 64.8);
  assert.strictEqual(totals.entry['Work m'], 222);
  const makeup = g.logbookRows(lbResult({ localTime: '21:00' }), lbCtx([{ date: '2026-10-26', type: 'Practice', status: 'Out' }]));
  assert.deepStrictEqual([makeup.entry['Session type'], makeup.entry['Review status']], ['Make-up', 'Pending: possible make-up']);
  assert.strictEqual(makeup.entry['Make-up for date'].getDate(), 27);
  const twoK = g.logbookRows(lbResult({ intervals: [{ timeS: 440, distanceM: 2000, rate: 28 }], timeS: 440, distanceM: 2000, name: '2000m' }), lbCtx());
  assert.ok(/possible benchmark/.test(twoK.entry['Coach note']));
  assert.strictEqual(twoK.benchmark, undefined);
  const bike = g.logbookRows(lbResult({ machine: 'bikerg' }), lbCtx());
  assert.strictEqual(bike.entry['Activity'], 'BikeErg');
  assert.ok(g.logbookRows(lbResult({ machine: 'skierg' }), lbCtx()).skip);
  const many = g.logbookRows(lbResult({ intervals: Array.from({ length: 14 }, () => ({ timeS: 60, distanceM: 200, rate: 24, restTimeS: 30, restDistanceM: 50 })) }), lbCtx());
  assert.strictEqual(many.intervals.length, g.MAX_INTERVALS);
  assert.strictEqual(many.entry['Work s'], 840);
});

test('logbook: pending rows stay out of the feed', () => {
  assert.ok(g.feedPending_({ 'Review status': 'Pending' }));
  assert.ok(g.feedPending_({ 'Review status': 'Pending: possible make-up' }));
  assert.ok(!g.feedPending_({ 'Review status': '' }));
  assert.ok(!g.feedPending_({ 'Review status': 'Rejected' }));
});

test('logbook: confirm plan, benchmark row, auto-accept and the pending list', () => {
  const day = (y, m, d) => new Date(y, m - 1, d);
  const entry = (over = {}) => ({
    'Entry ID': 'E1', 'Athlete ID': 'A001', 'Athlete': 'Jane Smith', 'Entered by': 'Jane Smith', 'Date': day(2026, 10, 29),
    'Session type': 'OYO', 'Status': '', 'Activity': 'Erg (RowErg)', 'Work s': 440, 'Work m': 2000, 'Drag factor': 98,
    'Source': 'Logbook', 'Review status': 'Pending', 'Response ID': 'logbook:5', 'Submitted at': new Date(2026, 9, 29, 8, 0), ...over
  });
  const ivs = [{ 'Entry ID': 'E1', 'Interval #': 1, 'Work s': 440, 'Work m': 2000, 'Avg rate': 28 }];
  const cx = { newId: (p) => p + '9', now: new Date(2026, 9, 29, 9, 0), parseDate: (s) => { const [y, m, d] = s.split('-').map(Number); return day(y, m, d); }, formatDay: () => '2026-10-27' };
  const plain = g.logbookConfirmPlan(entry(), ivs, 'A001', {}, cx);
  assert.deepStrictEqual(Object.assign({}, plain.updates), { 'Session type': 'OYO', 'Status': '', 'Make-up for date': '', 'Review status': '' });
  assert.strictEqual(plain.benchmark, null);
  // change to Practice with RPE; make-up needs a date unless one was suggested
  const prac = g.logbookConfirmPlan(entry(), ivs, 'A001', { sessionType: 'Practice', rpe: '7' }, cx);
  assert.deepStrictEqual([prac.updates['Session type'], prac.updates['Status'], prac.updates['RPE']], ['Practice', 'Full', 7]);
  assert.ok(g.logbookConfirmPlan(entry(), ivs, 'A001', { sessionType: 'Make-up' }, { ...cx, formatDay: () => '' }).error);
  assert.strictEqual(g.logbookConfirmPlan(entry({ 'Make-up for date': day(2026, 10, 27) }), ivs, 'A001', { sessionType: 'Make-up' }, cx).updates['Make-up for date'].getDate(), 27);
  assert.ok(g.logbookConfirmPlan(entry(), ivs, 'A001', { rpe: '11' }, cx).error);
  // only her own, only pending Logbook rows
  assert.ok(g.logbookConfirmPlan(entry(), ivs, 'A002', {}, cx).error);
  assert.ok(g.logbookConfirmPlan(entry({ 'Review status': '' }), ivs, 'A001', {}, cx).error);
  assert.ok(g.logbookConfirmPlan(entry({ Source: 'Form' }), ivs, 'A001', {}, cx).error);
  // 2k test: also a Benchmarks row, linked both ways
  const test2k = g.logbookConfirmPlan(entry(), ivs, 'A001', { benchmark: '2000m' }, cx);
  assert.deepStrictEqual([test2k.benchmark['Test'], test2k.benchmark['Time s'], test2k.benchmark['Meters'], test2k.benchmark['Entry ID'], test2k.updates['Benchmark ID']], ['2000m', 440, '', 'E1', 'B9']);
  Object.keys(test2k.benchmark).forEach((k) => assert.ok(g.HEADERS[g.TABS.BENCHMARKS].includes(k), 'benchmark column ' + k));
  Object.keys(test2k.updates).forEach((k) => assert.ok(g.HEADERS[g.TABS.ENTRIES].includes(k), 'entry column ' + k));
  assert.ok(g.logbookConfirmPlan(entry(), ivs, 'A001', { benchmark: '20min' }, cx).error);
  const twenty = g.logbookConfirmPlan(entry({ 'Work s': 1200, 'Work m': 5100 }), [{ 'Entry ID': 'E1', 'Interval #': 1, 'Work s': 1200, 'Work m': 5100, 'Avg rate': 22 }], 'A001', { benchmark: '20min' }, cx);
  assert.deepStrictEqual([twenty.benchmark['Test'], twenty.benchmark['Time s'], twenty.benchmark['Meters']], ['20min', '', 5100]);
  // auto-accept: plain Pending older than 20 h; possible make-ups and fresh ones wait
  const now = new Date(2026, 9, 30, 5, 0);
  assert.deepStrictEqual(Array.from(g.logbookDueIds([
    entry({ 'Entry ID': 'old' }),
    entry({ 'Entry ID': 'fresh', 'Submitted at': new Date(2026, 9, 30, 1, 0) }),
    entry({ 'Entry ID': 'mk', 'Review status': 'Pending: possible make-up' }),
    entry({ 'Entry ID': 'done', 'Review status': '' }),
    entry({ 'Entry ID': 'form', Source: 'Form', 'Review status': 'Pending' })
  ], now)), ['old']);
  // the pending list for the site: only pending Logbook rows of known athletes
  const list = g.feedLogbookPending_({
    entries: [entry(), entry({ 'Entry ID': 'E2', 'Review status': '' }), entry({ 'Entry ID': 'E3', 'Athlete ID': 'A999' }), entry({ 'Entry ID': 'E4', 'Review status': 'Pending: possible make-up', 'Make-up for date': day(2026, 10, 27) })],
    intervals: ivs
  }, { A001: true });
  assert.deepStrictEqual(list.map((x) => x.id), ['E1', 'E4']);
  assert.strictEqual(list[0].benchmark, '2000m');
  assert.strictEqual(list[0].pieces.length, 1);
  assert.strictEqual(list[1].possibleMakeup, true);
  assert.ok(!JSON.stringify(list).match(/weight/i));
  // the per-athlete list used by her page: only hers, all pending cards together
  const two = [entry(), entry({ 'Entry ID': 'E5' }), entry({ 'Entry ID': 'E6', 'Athlete ID': 'A002' }), entry({ 'Entry ID': 'E7', 'Review status': '' })];
  const mineOnly = g.logbookPendingFor(two, ivs, 'A001');
  assert.deepStrictEqual(mineOnly.map((x) => x.id), ['E1', 'E5']);
  assert.deepStrictEqual(g.logbookPendingFor(two, ivs, 'A404'), []);
});

test('logbook: Slack notice goes only to a valid Roster member ID; Slack confirm finds her by that ID', () => {
  const entry = { 'Entry ID': 'E9', 'Athlete ID': 'A001', Date: new Date(2026, 9, 28), 'Session type': 'OYO', 'Review status': 'Pending', Source: 'Logbook',
    Activity: 'Erg (RowErg)', 'Work s': 300, 'Work m': 1200, 'Drag factor': 105, 'Make-up for date': '' };
  const ivs = [{ 'Entry ID': 'E9', 'Interval #': 1, 'Work s': 300, 'Work m': 1200, 'Avg rate': 22 }];
  const n = g.logbookSlackNotice(entry, ivs, { 'Slack member ID': ' U0ABC123 ' });
  assert.strictEqual(n.slackUserId, 'U0ABC123');
  assert.strictEqual(n.card.id, 'E9');
  assert.strictEqual(n.card.sessionType, 'OYO');
  assert.strictEqual(g.logbookSlackNotice(entry, ivs, { 'Slack member ID': '' }), null);
  assert.strictEqual(g.logbookSlackNotice(entry, ivs, { 'Slack member ID': 'jane smith' }), null, 'not a member ID');
  const roster = [{ 'Athlete ID': 'A001', 'Slack member ID': 'U1', Active: 'Yes' }, { 'Athlete ID': 'A002', 'Slack member ID': 'U2', Active: 'No' }];
  assert.strictEqual(g.slackAthleteFor_(roster, 'U1')['Athlete ID'], 'A001');
  assert.strictEqual(g.slackAthleteFor_(roster, 'U2'), null, 'inactive');
  assert.strictEqual(g.slackAthleteFor_(roster, ''), null);
});

test('slack /log: coach-only access, pieces box, modal values parse like the Form', () => {
  const roster = [{ Name: 'Jane Smith', Active: 'Yes' }, { Name: 'Old Athlete', Active: 'No' }];
  const coaches = ['UC1', 'UC2'];
  assert.strictEqual(g.slackLogAccess_(roster, coaches, 'UC1', ' jane  SMITH ').athlete.Name, 'Jane Smith');
  assert.strictEqual(g.slackLogAccess_(roster, coaches, 'UA9', 'Jane Smith').status, 'not_allowed', 'athletes cannot use /log yet');
  assert.strictEqual(g.slackLogAccess_(roster, coaches, '', 'Jane Smith').status, 'not_allowed');
  assert.strictEqual(g.slackLogAccess_(roster, [], 'UC1', 'Jane Smith').status, 'not_allowed', 'no coach IDs set: nobody');
  assert.strictEqual(g.slackLogAccess_(roster, coaches, 'UC1', 'Old Athlete').status, 'unknown_name', 'inactive');
  assert.strictEqual(g.slackLogAccess_(roster, coaches, 'UC1', '').status, 'unknown_name');

  const p = g.parsePiecesText('10:00.0, 2650, 22, 2:00, 300\n\n 10:00, 2660 \n10:00,2675,,');
  assert.strictEqual(p.length, 3);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(p[0])), { WORK_TIME: '10:00.0', WORK_M: '2650', RATE: '22', REST_TIME: '2:00', REST_M: '300' });
  assert.strictEqual(p[1].RATE, '');
  assert.throws(() => g.parsePiecesText(''), /at least one/);
  assert.throws(() => g.parsePiecesText('10:00'), /Piece 1: work meters are missing/);
  assert.throws(() => g.parsePiecesText('10:00,2650\n10:99,2650'), /Piece 2: work time "10:99" should look like/);
  assert.throws(() => g.parsePiecesText(Array(11).fill('1:00,100').join('\n')), /At most 10/);

  const form = { date: '2026-01-12', type: 'practice', status: 'full', activity: 'Erg (RowErg)', warmup: '15:00', warmup_m: '2000', main_set: "3x10' r2'",
    zone: 'Aerobic', pieces: '10:00.0, 2650, 22, 2:00, 300\n10:00.0, 2660, , 2:00\n10:00.0, 2675', cooldown: '5:00', cooldown_m: '', rpe: '6', drag: '105', hr: '', note: '' };
  const viaSlack = g.parseSubmission(g.slackLogAnswers(form, 'Jane Smith', 'Jane Smith'), ctxFor());
  const Q = g.Q, i1 = g.qInterval(1), i2 = g.qInterval(2), i3 = g.qInterval(3);
  const viaForm = g.parseSubmission({
    [Q.ATHLETE]: 'Jane Smith', [Q.ENTERED_BY]: 'Jane Smith', [Q.DATE]: '2026-01-12', [Q.LOG_TYPE]: g.LOG_TYPES.PRACTICE, [Q.STATUS]: g.STATUSES.FULL,
    [Q.ACTIVITY]: 'Erg (RowErg)', [Q.WARMUP]: '15:00', [Q.MAIN_SET]: "3x10' r2'", [Q.ZONE]: 'Aerobic',
    [i1.WORK_TIME]: '10:00.0', [i1.WORK_M]: '2650', [i1.RATE]: '22', [i1.REST_TIME]: '2:00', [i1.REST_M]: '300',
    [i2.WORK_TIME]: '10:00.0', [i2.WORK_M]: '2660', [i2.REST_TIME]: '2:00',
    [i3.WORK_TIME]: '10:00.0', [i3.WORK_M]: '2675',
    [Q.COOLDOWN]: '5:00', [Q.RPE]: '6', [Q.DRAG]: '105', [Q.WARMUP_M]: '2000', [Q.COOLDOWN_M]: ''
  }, ctxFor());
  assert.deepStrictEqual(JSON.parse(JSON.stringify(viaSlack)), JSON.parse(JSON.stringify(viaForm)), 'same entry and intervals as the Form');
  assert.strictEqual(viaSlack.entry['Entered by'], 'Jane Smith');
  assert.strictEqual(g.parseSubmission(g.slackLogAnswers(form, 'Jane Smith', 'Coach Greta'), ctxFor()).entry['Entered by'], 'Coach Greta');

  const out = g.parseSubmission(g.slackLogAnswers({ date: '2026-01-12', type: 'practice', status: 'out', note: 'sick' }, 'Jane Smith'), ctxFor());
  assert.strictEqual(out.entry.Status, 'Out');
  assert.strictEqual(out.entry['Coach note'], 'sick');
  assert.strictEqual(out.intervals.length, 0);
  const oyo = g.parseSubmission(g.slackLogAnswers({ ...form, type: 'oyo', status: '' }, 'Jane Smith'), ctxFor());
  assert.strictEqual(oyo.entry['Session type'], 'OYO');
  const mk = g.parseSubmission(g.slackLogAnswers({ ...form, type: 'makeup', makeup_for: '2026-01-10' }, 'Jane Smith'), ctxFor());
  assert.strictEqual(mk.entry['Session type'], 'Make-up');
  assert.strictEqual(mk.entry['Make-up for date'].getDate(), 10);
  assert.throws(() => g.slackLogAnswers({ ...form, type: 'test' }, 'Jane Smith'), /Pick Practice/);
});

console.log(`${passed} tests passed`);
