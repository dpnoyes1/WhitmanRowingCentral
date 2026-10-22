// Runs the pure parts of the Apps Script in Node: `node tests/run.js`
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const dir = path.join(__dirname, '..', 'apps-script');
const ctx = vm.createContext({ console });
['Config.gs', 'Time.gs', 'Gms.gs', 'Sheet.gs', 'Form.gs', 'Submit.gs', 'Setup.gs', 'TeamGms.gs', 'Regatta.gs'].forEach(f =>
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
  // Last year: same window (Aug 1 + 82 days) vs a later full-year result. T002 was Novice then.
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

console.log(`${passed} tests passed`);
