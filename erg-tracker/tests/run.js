// Runs the pure parts of the Apps Script in Node: `node tests/run.js`
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const dir = path.join(__dirname, '..', 'apps-script');
const ctx = vm.createContext({ console });
['Config.gs', 'Time.gs', 'Gms.gs', 'Sheet.gs', 'Form.gs', 'Submit.gs', 'Setup.gs', 'Plan.gs', 'PlanSheet.gs', 'Profile.gs', 'Dummy.gs', 'TeamGms.gs', 'Regatta.gs', 'Feed.gs', 'Ops.gs', 'Logbook.gs', 'PlanFlags.gs', 'SlackLog.gs', 'Photos.gs', 'SlackPhoto.gs', 'SettingsPage.gs', 'Weights.gs', 'SiteLog.gs', 'WorkoutBuilder.gs', 'AttendanceMark.gs'].forEach(f =>
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
  ['1:01:52', '1:01:52.0', '2:00:00.5'].forEach(t => assert.ok(re.test(t), t));
  ['7:4', '7:60', '742.8', '7:42.85', ':42.8', '1:60:00', '1:00:60', '1:2:3:4'].forEach(t => assert.ok(!re.test(t), t));
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
  // Two active athletes with one name: refuse, never guess.
  const twin = ctxFor(); twin.athleteIds = { 'Jane Smith': null };
  assert.throws(() => g.parseSubmission(ans, twin), /Two active athletes are named "Jane Smith"/);
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
  assert.strictEqual(headers.slice(headers.indexOf('Warmup m'), headers.indexOf('Warmup m') + 3).join(), 'Warmup m,Cooldown m,Photo link');
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

  // No weight on or before the test: her latest weight overall scores it (David, 2026-11-13).
  const early = g.teamGmsByYear({ benchmarks: [{ Date: new Date(2026, 7, 5), 'Athlete ID': 'T001', Test: '2000m', 'Time s': 420 }],
    weights: [{ Date: new Date(2026, 9, 20), 'Athlete ID': 'T001', 'Weight lb': 270 },
      { Date: new Date(2026, 7, 10), 'Athlete ID': 'T001', 'Weight lb': 150 }], roster, squadHistory: [], settings, asOf });
  near(early[0].athletes[0].bestGms, pct(420), 1e-9, 'later weight used');
  near(early[0].groups.team.avg, pct(420), 1e-9, 'later weight counts in averages');

  // No weight at all: still ranked, but no GMS %.
  const none = g.teamGmsByYear({ benchmarks: [{ Date: new Date(2026, 7, 5), 'Athlete ID': 'T001', Test: '2000m', 'Time s': 420 }],
    weights: [{ Date: new Date(2026, 7, 10), 'Athlete ID': 'T002', 'Weight lb': 270 }], roster, squadHistory: [], settings, asOf });
  assert.strictEqual(none[0].athletes[0].bestGms, null);
  assert.strictEqual(none[0].groups.team.avg, null);
  assert.strictEqual(none[0].groups.team.tested, 1);

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
  // Aerobic bases on the 20' first, like power zones off FTP (David, 2026-11-16)
  assert.deepStrictEqual({ ...g.pieceTargetPct(ut1, s) }, { base: "20'", low: 70, high: 80 });
  const t = g.pieceTarget(ut1, 202.546, s);
  assert.strictEqual(t.range, true);
  assert.strictEqual(t.lowW, 142);   // 70% of 202.5 W
  assert.strictEqual(t.highW, 162);  // 80% of 202.5 W
  assert.ok(t.slowSplit > t.fastSplit);
  assert.strictEqual(g.formatTarget(t), g.formatTime(t.slowSplit) + ' to ' + g.formatTime(t.fastSplit) + ' /500m (142-162 W)');
  const at = g.pieceTarget(g.workoutPieces(WORKOUTS, 'P1')[0], 202.546, s);
  assert.strictEqual(at.range, false);
  assert.strictEqual(at.highW, 172);
  assert.strictEqual(g.formatTarget(at), g.formatTime(at.fastSplit) + ' /500m (172 W)');
  assert.strictEqual(g.pieceTargetPct(g.workoutPieces(WORKOUTS, 'X1')[0], s), null, 'no erg target on a run');
  // Sprint work (Anaerobic zone) never has a target (David, 2026-11-16), even with an explicit %
  assert.strictEqual(g.pieceTargetPct(g.workoutPieces(WORKOUTS, 'U8')[0], s), null);
  assert.strictEqual(g.pieceTargetPct(g.workoutPieces(WORKOUTS, 'P1')[3], s), null);
});

test('targets: a piece with no test on its base falls back to the other test (David, 2026-11-16)', () => {
  const s = planSettings();
  const aero = g.workoutPieces(WORKOUTS, 'W1')[0];           // Aerobic, base 2k
  const only2k = g.pieceTargetFromBases(aero, { '2k': 200 }, s);
  assert.ok(only2k, 'a 2k-only rower still gets a target');
  assert.strictEqual(only2k.base, '2k');
  assert.strictEqual(only2k.lowPct, 60, "uses the zone's own % for the 2k");
  assert.strictEqual(only2k.highPct, 70);
  const only20 = g.pieceTargetFromBases(aero, { "20'": 180 }, s);
  assert.strictEqual(only20.base, "20'");
  const both = g.pieceTargetFromBases(aero, { '2k': 200, "20'": 180 }, s);
  assert.strictEqual(both.base, "20'", "aerobic uses the 20' first when she has one");
  const thr = g.pieceTargetFromBases(g.workoutPieces(WORKOUTS, 'P1')[0], { '2k': 200, "20'": 180 }, s);
  assert.strictEqual(thr.base, '2k', 'a piece with its own base keeps it');
  assert.strictEqual(g.pieceTargetFromBases(aero, {}, s), null, 'neither test: no target');
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
  assert.strictEqual(pub.sessions[1].athletes.length, 2, 'Varsity workout with no Novice one that day: the novice does it too (David, 2026-11-03)');
  const two = pub.sessions[0].athletes.find(a => a.athleteId === 'A902');
  assert.strictEqual(two.targets[0].text, '', 'no benchmark, no target');
  assert.strictEqual(pub.flags.map(f => f.athleteId).join(), 'A902');
  // A custom goal pace is everyone's target, even a rower with no 2k or 20' (no "no benchmark" flag for it).
  const goalWk = g.workoutBuildRows_('WGOAL', { name: '2k test', pieces: [{ workType: 'Distance', work: '2000', pace: '1:45.0' }] }).rows;
  const goalPlan = g.buildWeekPlan({ ...inputs, workouts: inputs.workouts.concat(goalWk), schedule: [{ Date: D(2026, 11, 3), Squad: 'All', Session: 'Practice', 'Workout ID': 'WGOAL', Published: true }], weekStart: D(2026, 11, 2), publishedOnly: true });
  assert.deepStrictEqual(goalPlan.sessions[0].athletes.map(a => a.targets[0].text), goalPlan.sessions[0].athletes.map(() => '1:45 /500m'));
  assert.strictEqual(goalPlan.flags.length, 0);
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
  assert.strictEqual(g.plannedFor(mk, 'Novice', SCHEDULE)['Workout ID'], 'P1', 'no Novice workout that day: a novice does the Varsity one');
  const withNovice = SCHEDULE.concat([{ Date: D(2026, 11, 4), Squad: 'Novice', Session: 'Practice', 'Workout ID': 'W1', Published: true }]);
  assert.strictEqual(g.plannedFor(mk, 'Novice', withNovice)['Workout ID'], 'W1', 'a Novice workout wins when there is one');
  assert.strictEqual(g.plannedFor(mk, 'Varsity', withNovice)['Workout ID'], 'P1');
  assert.strictEqual(g.plannedFor(mk, 'Alum', SCHEDULE), null, 'Alum has no plan');
  const nov = g.buildWeekPlan({ schedule: SCHEDULE, workouts: WORKOUTS, roster: ROSTER.filter((r) => r.Squad === 'Novice'), benchmarks: BENCH, settings: s, weekStart: D(2026, 11, 2), publishedOnly: true });
  if (ROSTER.some((r) => r.Squad === 'Novice')) assert.ok(nov.sessions.find((x) => x.squad === 'Varsity').athletes.length > 0, 'novices get targets on a Varsity-only day');
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
  assert.match(c.reason, /^2 of 3 pieces done$/);
  assert.strictEqual(c.short, true);
  assert.strictEqual(c.hit, null, 'no benchmark, no target check');
  // 8 x 500 on a start clock: rest is ignored, single target within 2%
  const s8 = g.workoutPieces(WORKOUTS, 'S8');
  const w = Math.round(202.546 * 0.95);
  const t500 = 500 * Math.pow(2.8 / w, 1 / 3);
  c = g.checkAgainstPlan(Array.from({ length: 8 }, (_, i) => iv(i + 1, t500, 500)), s8, { '2k': 202.546 }, s);
  assert.strictEqual(c.matches, true);
  assert.strictEqual(c.hit, null, 'Anaerobic (sprint) work has no target, so nothing to hit');
  const s8t = s8.map((p) => ({ ...p, zone: 'Threshold', lowPct: 95 }));
  c = g.checkAgainstPlan(Array.from({ length: 8 }, (_, i) => iv(i + 1, t500, 500)), s8t, { '2k': 202.546 }, s);
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
  assert.strictEqual(h.slice(0, 7).join(), 'Athlete ID,Name,Slack member ID,Squad,Role,Active,Notes');
  assert.strictEqual(h.slice(7).join(), 'Birthday,Grad year,Age group,School year');
  // a live Sheet that still has the retired OYO columns loses exactly those, last first
  const live = JSON.parse(JSON.stringify(g.retiredColumnsIn_(['Athlete ID', 'Name', 'Slack member ID', 'Squad', 'Role', 'OYO group', 'OYO required min', 'OYO elite min', 'Active', 'Notes'], g.RETIRED_ROSTER_COLUMNS)));
  assert.deepStrictEqual(live, [8, 7, 6]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(g.retiredColumnsIn_(h, g.RETIRED_ROSTER_COLUMNS))), [], 'already migrated: nothing to drop');
  const letters = {}; h.forEach((x, i) => { letters[x] = g.columnLetter_(i + 1); });
  assert.strictEqual(letters['Birthday'], 'H');
  assert.strictEqual(letters['Grad year'], 'I');
  assert.strictEqual(g.columnLetter_(27), 'AA');
  const ag = g.COMPUTED_COLUMNS[g.TABS.ROSTER]['Age group'](letters);
  const sy = g.COMPUTED_COLUMNS[g.TABS.ROSTER]['School year'](letters);
  assert.ok(ag.startsWith('={"Age group";') && ag.includes('H2:H') && ag.includes('DATE(YEAR(TODAY()),1,1)'), ag);
  assert.ok(sy.startsWith('={"School year";') && sy.includes('I2:I') && sy.includes('MONTH(TODAY())>=7'), sy);
  for (const f of [ag, sy]) {
    let depth = 0; for (const c of f) { if (c === '(') depth++; if (c === ')') depth--; assert.ok(depth >= 0, f); }
    assert.strictEqual(depth, 0, 'balanced parens: ' + f);
  }
});

test('plan flag: Full but not the planned workout is flagged', () => {
  assert.strictEqual(g.planFlag({ Status: 'Full' }, { matches: false, logged: 5, planned: 8, reason: '5 intervals logged, plan has 8' }),
    '5 of 8 pieces logged');
  assert.strictEqual(g.planFlag({ Status: 'Full' }, { matches: false, short: true, logged: 4, planned: 4, reason: 'Piece 4 stopped at 11:32 of 15:00' }),
    'Piece 4 stopped at 11:32 of 15:00');
  assert.strictEqual(g.planFlag({ Status: 'Modified' }, { matches: false, logged: 5, planned: 8 }), '');
  assert.strictEqual(g.planFlag({ Status: 'Full' }, { matches: true, logged: 8, planned: 8 }), '');
  assert.ok(/^Not the planned workout \(Interval 2 is not/.test(g.planFlag({ Status: 'Full' }, { matches: false, logged: 8, planned: 8, reason: 'Interval 2 is not 500m' })));
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
  withBirthday.forEach(r => {
    const codes = t.logins.filter(l => l.id === r['Athlete ID']).map(l => l.code);
    assert.ok(codes.includes(sign(r['Athlete ID'], '2010-01-01')), 'test date signs in');
    assert.ok(codes.includes(sign(r['Athlete ID'], g.dayKey_(r.Birthday))), 'her birthday still signs in while the test date is set');
  });
  // A birthday typed as text in the Roster still gets a code.
  const textB = Object.assign(dummyFeedInputs(), { signLogin: sign });
  textB.roster[0].Birthday = '3/14/2010';
  const tb = JSON.parse(JSON.stringify(g.siteFeed(textB, new Date(2026, 9, 23, 12))));
  assert.ok(tb.logins.some(l => l.id === textB.roster[0]['Athlete ID'] && l.code === sign(textB.roster[0]['Athlete ID'], '2010-03-14')));
  assert.deepStrictEqual(t.logins.filter(l => l.coach).map(l => l.code), [sign('coach:pat example', '1980-02-03'), sign('coach:sam otest', '1975-12-31')]);
  assert.ok(!/Pat|Sam|1980-|1975-/.test(JSON.stringify(t.logins)), 'coach names and dates stay out');
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
  assert.ok(new RegExp('^' + short.length + ' of ' + all.length + ' pieces done$').test(hit[0].flag) && hit[0].entryId === full['Entry ID'], hit[0].flag);
  assert.deepStrictEqual(Array.from(hit[0].entryIds), [full['Entry ID']]);
  assert.strictEqual(pending(full, short, [full['Entry ID']]).length, 0, 'posted once');
  assert.strictEqual(pending(Object.assign({}, full, { 'Review status': 'Reviewed, Full' }), short).length, 0, 'decided');
  assert.strictEqual(pending(Object.assign({}, full, { Status: 'Modified' }), short).length, 0, 'already Modified');
  assert.strictEqual(pending(Object.assign({}, full, { Date: new Date(2026, 9, 10) }), short).length, 0, 'too old');
  assert.strictEqual(pending(Object.assign({}, full, { Date: new Date(2026, 9, 25) }), short).length, 0, 'in the future');
  const msg = g.planFlagMessage(hit[0], 'https://sheet.example/#gid=1');
  assert.ok(/^:warning: Plan check: .*, Wed Oct 21, Practice\. Marked Modified: \d+ of \d+ pieces done\./.test(msg.text), msg.text);
  // The coach sees the plan and what was logged, so the decision can be made from Slack.
  const lines = msg.text.split('\n');
  assert.ok(/^\*Planned:\* \S/.test(lines[1]) && !/not found/.test(lines[1]), lines[1]);
  assert.ok(/^\*Logged\* \((Google Form|Concept2 Logbook|Slack|Dummy)/.test(lines[2]), lines[2]);
  assert.strictEqual(lines.filter(l => /^\d+\. \d+:\d\d\.\d, \d+ m/.test(l)).length, short.length, 'one line per logged piece');
  assert.ok(lines.some(l => /^Total: \d+ pieces?, \d+ m in \d+:\d\d\.\d$/.test(l)), msg.text);
  assert.strictEqual(msg.blocks[0].text.text, msg.text);
  const noted = g.planFlagDetail({ ...full, Athlete: 'Jane', 'Entered by': 'Coach Greta', Source: 'Logbook', 'Coach note': 'secret note', Activity: 'Run', 'Main set': 'Easy', RPE: 4 }, short, []);
  assert.ok(/Concept2 Logbook, entered by Coach Greta\): Run, "Easy"/.test(noted) && /RPE 4/.test(noted) && !/secret/.test(noted), noted);
  assert.ok(/Planned:\* not found/.test(noted));
  const mk = (o) => Object.assign({ reps: 1, workType: 'Distance', workS: null, workM: 500, restS: 0, restUndefined: false, startEveryS: null, zone: '', rate: '' }, o);
  assert.strictEqual(g.planFlagPieceLabel_(mk({ reps: 8, restUndefined: true, zone: 'Threshold' })), '8 x 500m, undefined rest, Threshold');
  assert.strictEqual(g.planFlagPieceLabel_(mk({ reps: 4, workType: 'Time', workS: 360, workM: null, restS: 120, zone: 'Aerobic', rate: '22' })), '4 x 6:00, rest 2:00, Aerobic, rate 22');
  assert.strictEqual(g.planFlagPieceLabel_(mk({ reps: 8, startEveryS: 210, restUndefined: true, zone: 'Anaerobic' })), '8 x 500m, start every 3:30, Anaerobic');
  assert.strictEqual(g.planFlagPieceLabel_(mk({ workType: 'Time', workS: 1200, workM: null, zone: 'Threshold' })), '20:00, Threshold');
  assert.ok(g.planFlagDetail(full, Array(200).fill(all[0]), []).length <= 2400, 'stays inside Slack\'s block limit');
  const ids = msg.blocks[1].elements.map(b => b.action_id);
  assert.deepStrictEqual(Array.from(ids), ['plan_confirm', 'plan_full', 'plan_open']);
  assert.strictEqual(msg.blocks[1].elements[0].value, full['Entry ID']);
  assert.strictEqual(msg.blocks[1].elements[2].url, 'https://sheet.example/#gid=1');
  assert.ok(g.OPS_TRIGGERS.indexOf('sweepPlanFlags') >= 0);
});

test('matching several workouts (David, 2026-11-21): total-row saves, poor guesses, ties in the order done', () => {
  const s = planSettings();
  const W = [
    { 'Workout ID': 'YW', Name: '15:00 Warm Up', 'Piece #': 1, Reps: 1, 'Work type': 'Time', Work: '15:00', Rest: '', Zone: 'Aerobic' },
    { 'Workout ID': 'YS', Name: '6 x 0:30 Sprint', 'Piece #': 1, Reps: 6, 'Work type': 'Time', Work: '0:30', Rest: '3:30', Zone: 'Anaerobic' },
    { 'Workout ID': 'YC', Name: '20:00 Cool Down', 'Piece #': 1, Reps: 1, 'Work type': 'Time', Work: '20:00', Rest: '', Zone: 'Aerobic' },
    { 'Workout ID': 'YC15', Name: '15:00 Cool Down', 'Piece #': 1, Reps: 1, 'Work type': 'Time', Work: '15:00', Rest: '', Zone: 'Aerobic' }
  ];
  const day = D(2026, 11, 20);
  const row = (id, order) => ({ Date: day, Squad: 'All', Session: 'Practice', 'Workout ID': id, Published: true, Order: order });
  const sched = [row('YW', 1), row('YS', 2), row('YC', 3)];
  const entry = (id, at) => ({ 'Entry ID': id, 'Athlete ID': 'A901', Athlete: 'Fake One', Date: day, 'Session type': 'Practice', Status: 'Full', 'Review status': '', Activity: 'Erg (RowErg)', 'Submitted at': at });
  const iv = (id, n, sec, m) => ({ 'Entry ID': id, 'Interval #': n, 'Work s': sec, 'Work m': m });
  const best = (e, ivs, sc) => g.plannedBest(e, 'Varsity', sc || sched, W, ivs);
  // Six 0:30 intervals match the sprint exactly.
  const six = [1, 2, 3, 4, 5, 6].map((n) => iv('ES', n, 30, 145));
  assert.strictEqual(best(entry('ES'), six).row['Workout ID'], 'YS');
  // The same sprint saved as one 3:00 total row (Nov 20) is compared on total work: the sprint, not the 15:00 warm-up.
  const one = [iv('E1', 1, 180, 869)];
  let b = best(entry('E1'), one);
  assert.strictEqual(b.row['Workout ID'], 'YS');
  assert.strictEqual(b.poor, false);
  // A 14:00 warm-up still finds the warm-up, a 19:00 cool-down the cool-down.
  assert.strictEqual(best(entry('E2'), [iv('E2', 1, 840, 3000)]).row['Workout ID'], 'YW');
  assert.strictEqual(best(entry('E3'), [iv('E3', 1, 1140, 4000)]).row['Workout ID'], 'YC');
  // A 5:00 row fits nothing well: closest is the warm-up, marked as a guess.
  b = best(entry('E4'), [iv('E4', 1, 300, 1100)]);
  assert.strictEqual(b.row['Workout ID'], 'YW');
  assert.strictEqual(b.poor, true);
  assert.ok(Math.abs(b.fraction - 1 / 3) < 1e-9);
  // One workout that day: never a guess, the old rules apply.
  assert.strictEqual(best(entry('E4'), [iv('E4', 1, 300, 1100)], [row('YW', 1)]).poor, false);
  // The coach message says it is a guess, flags it even though the closest is a warm-up, and keeps it Modified, not Missed.
  const inp = { schedule: sched, workouts: W, benchmarks: [], settings: s };
  const flags = (entries, ivs) => JSON.parse(JSON.stringify(g.pendingPlanFlags(entries, ivs, { A901: 'Varsity' }, inp, new Date(2026, 10, 21, 9), [])));
  let f = flags([entry('E4', '2026-11-20 16:30')], [iv('E4', 1, 300, 1100)]);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].flag, "Doesn't clearly match a planned workout (closest: 15:00 Warm Up, 33% of its work). Not logged: 6 x 0:30 Sprint");
  assert.deepStrictEqual(f[0].missedIds, []);
  // Nov 20 again: warm-up, the sprint as a 3:00 total row, cool-down. The sprint is not "Not logged"; it is flagged as 1 of 6 pieces.
  f = flags([entry('EW', '2026-11-20 16:00'), entry('E1', '2026-11-20 16:28'), entry('EC', '2026-11-20 16:56')],
    [iv('EW', 1, 900, 3000), ...one, iv('EC', 1, 1200, 4000)]);
  assert.strictEqual(f.length, 1);
  assert.deepStrictEqual(f[0].entryIds, ['E1']);
  assert.ok(!/Not logged/.test(f[0].flag), f[0].flag);
  // Ties go in the order done: a 15:00 warm-up and a 15:00 cool-down, two 15:00 rows.
  const same = [row('YW', 1), row('YS', 2), row('YC15', 3)];
  const first = entry('EA', '2026-11-20 16:00'), second = entry('EB', '2026-11-20 16:56');
  const ivs = { EA: [iv('EA', 1, 900, 3000)], EB: [iv('EB', 1, 900, 3100)] };
  let all = g.plannedBestAll([second, first], { A901: 'Varsity' }, same, W, ivs);   // sheet order reversed: time decides
  assert.deepStrictEqual([all.EA.row['Workout ID'], all.EB.row['Workout ID']], ['YW', 'YC15']);
  all = g.plannedBestAll([first, second], { A901: 'Varsity' }, same, W, ivs);
  assert.deepStrictEqual([all.EA.row['Workout ID'], all.EB.row['Workout ID']], ['YW', 'YC15']);
  // Same submitted time: sheet order decides. Short pieces tie too (14:00 and 14:00).
  const short = { EA: [iv('EA', 1, 840, 3000)], EB: [iv('EB', 1, 840, 3000)] };
  all = g.plannedBestAll([entry('EA', '2026-11-20 18:24'), entry('EB', '2026-11-20 18:24')], { A901: 'Varsity' }, same, W, short);
  assert.deepStrictEqual([all.EA.row['Workout ID'], all.EB.row['Workout ID']], ['YW', 'YC15']);
  // No tie: a different athlete or a later day does not take anything.
  assert.strictEqual(g.planSubmittedMs_('2026-11-20 16:00') < g.planSubmittedMs_('2026-11-20 16:56'), true);
  assert.strictEqual(g.planSubmittedMs_(''), 0);
});

test('extra work at practice counts as OYO (David, 2026-11-21)', () => {
  const W = [
    { 'Workout ID': 'ZW', Name: '15:00 Warm Up', 'Piece #': 1, Reps: 1, 'Work type': 'Time', Work: '15:00', Rest: '', Zone: 'Aerobic' },
    { 'Workout ID': 'ZS', Name: '6 x 0:30 Sprint', 'Piece #': 1, Reps: 6, 'Work type': 'Time', Work: '0:30', Rest: '3:30', Zone: 'Anaerobic' },
    { 'Workout ID': 'ZC', Name: '20:00 Cool Down', 'Piece #': 1, Reps: 1, 'Work type': 'Time', Work: '20:00', Rest: '', Zone: 'Aerobic' },
    { 'Workout ID': 'Z4', Name: '4 x 15:00', 'Piece #': 1, Reps: 4, 'Work type': 'Time', Work: '15:00', Rest: '1:30', Zone: 'Aerobic' }
  ];
  const day = D(2026, 11, 20);
  const row = (id, order) => ({ Date: day, Squad: 'All', Session: 'Practice', 'Workout ID': id, Published: true, Order: order });
  const three = [row('ZW', 1), row('ZS', 2), row('ZC', 3)];
  const e = (id, at, o) => Object.assign({ 'Entry ID': id, 'Athlete ID': 'A901', Athlete: 'Fake One', Date: day, 'Session type': 'Practice', Status: 'Full', 'Review status': '', Activity: 'Erg (RowErg)', 'Submitted at': at }, o || {});
  const iv = (id, n, sec, m) => ({ 'Entry ID': id, 'Interval #': n, 'Work s': sec, 'Work m': m });
  const work = (id, sec, m) => ({ 'Work s': sec, 'Work m': m });
  const extras = (entries, ivs, sched, today) => JSON.parse(JSON.stringify(g.planExtras(entries, ivs, { A901: 'Varsity' }, { schedule: sched, workouts: W, benchmarks: [], settings: planSettings() }, today || new Date(2026, 10, 21, 9))));
  // Early 30:00, then warm-up, sprint and cool-down: the 30:00 is extra (the cool-down was done by another entry).
  const early = e('EX', '2026-11-20 15:30', work(0, 1800, 7000));
  const day3 = [early, e('EW', '2026-11-20 16:00', work(0, 900, 3000)), e('ES', '2026-11-20 16:28', work(0, 180, 870)), e('EC', '2026-11-20 16:56', work(0, 1200, 4000))];
  const ivs3 = [iv('EX', 1, 1800, 7000), iv('EW', 1, 900, 3000), ...[1, 2, 3, 4, 5, 6].map((n) => iv('ES', n, 30, 145)), iv('EC', 1, 1200, 4000)];
  let x = extras(day3, ivs3, three);
  assert.deepStrictEqual(x.map((r) => r.entryId), ['EX']);
  assert.ok(/20:00 Cool Down was done by another entry/.test(x[0].why));
  // Not until the day is over.
  assert.deepStrictEqual(extras(day3, ivs3, three, new Date(2026, 10, 20, 19)), []);
  // Only the 30:00 logged: it is the athlete's practice, not extra.
  assert.deepStrictEqual(extras([early], [iv('EX', 1, 1800, 7000)], three), []);
  // Under 15:00 stays practice; a coach-reviewed entry, a test and lifting are never moved.
  const short = e('EX', '2026-11-20 15:30', work(0, 600, 2300));
  assert.deepStrictEqual(extras([short, ...day3.slice(1)], [iv('EX', 1, 600, 2300), ...ivs3.slice(1)], three), []);
  for (const o of [{ 'Review status': 'Reviewed, Full' }, { 'Benchmark ID': 'B1' }, { Activity: 'Lifting' }]) {
    assert.deepStrictEqual(extras([Object.assign({}, early, o), ...day3.slice(1)], ivs3, three), [], JSON.stringify(o));
  }
  // The plan check's own Auto Modified mark does not protect it.
  assert.deepStrictEqual(extras([Object.assign({}, early, { Status: 'Modified', 'Review status': 'Auto Modified' }), ...day3.slice(1)], ivs3, three).map((r) => r.entryId), ['EX']);
  // One main workout: an early 30:00 and the full 4 x 15:00. The 30:00 is extra.
  const main = [e('EX', '2026-11-20 15:30', work(0, 1800, 7000)), e('E4', '2026-11-20 17:00', work(0, 3600, 13000))];
  const ivs4 = [iv('EX', 1, 1800, 7000), ...[1, 2, 3, 4].map((n) => iv('E4', n, 900, 3250))];
  assert.deepStrictEqual(extras(main, ivs4, [row('Z4', 1)]).map((r) => r.entryId), ['EX']);
  // The main workout cut short (3 of 4): the other piece may be the rest of it, so nothing moves.
  const cut = [iv('EX', 1, 1800, 7000), ...[1, 2, 3].map((n) => iv('E4', n, 900, 3250))];
  assert.deepStrictEqual(extras([main[0], e('E4', '2026-11-20 17:00', work(0, 2700, 9750))], cut, [row('Z4', 1)]), []);
  // The same workout twice (a photo and Logbook): not extra work, left alone.
  const dup = [e('E4', '2026-11-20 17:00', work(0, 3600, 13000)), e('E5', '2026-11-20 18:00', work(0, 3600, 13010))];
  const ivsDup = [...[1, 2, 3, 4].map((n) => iv('E4', n, 900, 3250)), ...[1, 2, 3, 4].map((n) => iv('E5', n, 900, 3252))];
  assert.deepStrictEqual(extras(dup, ivsDup, [row('Z4', 1)]), []);
  // A 45:00 that fits nothing (closest the 15:00 warm-up, 300%) while the sprint and cool-down are logged: extra.
  const stray = [e('EL', '2026-11-20 15:00', work(0, 2700, 10000)), e('ES', '2026-11-20 16:28', work(0, 180, 870)), e('EC', '2026-11-20 16:56', work(0, 1200, 4000))];
  const ivsStray = [iv('EL', 1, 2700, 10000), ...[1, 2, 3, 4, 5, 6].map((n) => iv('ES', n, 30, 145)), iv('EC', 1, 1200, 4000)];
  x = extras(stray, ivsStray, three);
  assert.deepStrictEqual(x.map((r) => r.entryId), ['EL']);
  assert.ok(/fits no planned workout/.test(x[0].why));
  // ...but not when the sprint was not logged.
  assert.deepStrictEqual(extras([stray[0], stray[2]], [ivsStray[0], ivsStray[7]], three), []);
});

test('incomplete workouts (David, 2026-11-17): stopped early, best of several workouts, skipped workout, auto Modified', () => {
  const s = planSettings();
  const W = [
    { 'Workout ID': 'X4', Name: '4x15', 'Piece #': 1, Reps: 4, 'Work type': 'Time', Work: '15:00', Rest: '2:00', Zone: 'Aerobic' },
    { 'Workout ID': 'X20', Name: '20 min steady', 'Piece #': 1, Reps: 1, 'Work type': 'Time', Work: '20:00', Rest: '', Zone: 'Aerobic' },
    { 'Workout ID': 'X40', Name: '40 min steady', 'Piece #': 1, Reps: 1, 'Work type': 'Time', Work: '40:00', Rest: '', Zone: 'Aerobic' },
    { 'Workout ID': 'XW', Name: 'Warm up', 'Piece #': 1, Reps: 1, 'Work type': 'Time', Work: '10:00', Rest: '', Zone: 'Aerobic' }
  ];
  const iv = (n, sec, m) => ({ 'Interval #': n, 'Work s': sec, 'Work m': m || Math.round(sec * 500 / 125) });
  const x4 = g.workoutPieces(W, 'X4');
  // Scenario 1: 3 of 4, no 4th piece.
  let c = g.checkAgainstPlan([iv(1, 900), iv(2, 900), iv(3, 900)], x4, {}, s);
  assert.strictEqual(c.matches, false); assert.strictEqual(c.short, true);
  assert.strictEqual(c.reason, '3 of 4 pieces done');
  // Scenario 2: 3 full pieces, then 11:32 on the 4th.
  c = g.checkAgainstPlan([iv(1, 900), iv(2, 900), iv(3, 900), iv(4, 692)], x4, {}, s);
  assert.strictEqual(c.reason, 'Piece 4 stopped at 11:32 of 15:00'); assert.strictEqual(c.short, true);
  c = g.checkAgainstPlan([iv(1, 900), iv(2, 692)], x4, {}, s);
  assert.strictEqual(c.reason, 'Piece 2 stopped at 11:32 of 15:00, 1 of 4 pieces done');
  // A different workout is not "stopped early": a longer piece, or a short one before the end.
  c = g.checkAgainstPlan([iv(1, 900), iv(2, 600), iv(3, 900)], x4, {}, s);
  assert.strictEqual(c.short, false); assert.match(c.reason, /^3 intervals logged, plan has 4/);
  c = g.checkAgainstPlan([iv(1, 900), iv(2, 900), iv(3, 900), iv(4, 1000)], x4, {}, s);
  assert.strictEqual(c.short, false); assert.strictEqual(c.matches, false);
  assert.strictEqual(g.planShortReason_([iv(1, 900), iv(2, 900), iv(3, 900), iv(4, 900)], [1, 2, 3, 4].map(() => x4[0])), '');
  // Scenario 3: a 20:00 and a 40:00 at one practice. The 40:00 is checked against the 40:00, whatever the order.
  const day = D(2026, 11, 10);
  const sched = [
    { Date: day, Squad: 'All', Session: 'Practice', 'Workout ID': 'XW', Published: true, Order: 1 },
    { Date: day, Squad: 'All', Session: 'Practice', 'Workout ID': 'X20', Published: true, Order: 2 },
    { Date: day, Squad: 'All', Session: 'Practice', 'Workout ID': 'X40', Published: true, Order: 3 }
  ];
  const e40 = { 'Entry ID': 'E40', 'Athlete ID': 'A901', Athlete: 'Fake One', Date: day, 'Session type': 'Practice', Status: 'Full', 'Review status': '', Activity: 'Erg (RowErg)' };
  const ivs40 = [Object.assign(iv(1, 2400), { 'Entry ID': 'E40' })];
  assert.strictEqual(g.plannedFor(e40, 'Varsity', sched)['Workout ID'], 'XW', 'first in the day');
  assert.strictEqual(g.plannedBest(e40, 'Varsity', sched, W, ivs40).row['Workout ID'], 'X40');
  assert.strictEqual(g.plannedBest(e40, 'Varsity', sched.slice().reverse(), W, ivs40).row['Workout ID'], 'X40');
  assert.strictEqual(g.plannedBest(e40, 'Varsity', sched, W, [iv(1, 1500)]).row['Workout ID'], 'X20', 'closest: 25:00 is nearer 20:00');
  assert.strictEqual(g.plannedBest(e40, 'Varsity', [], W, ivs40), null);
  const inp = { schedule: sched, workouts: W, benchmarks: [], settings: s };
  const squads = { A901: 'Varsity' };
  const flags = (entries, ivs, today, posted) => JSON.parse(JSON.stringify(g.pendingPlanFlags(entries, ivs, squads, inp, today, posted || [])));
  assert.deepStrictEqual(flags([e40], ivs40, new Date(2026, 10, 10, 18)), [], 'same day: the 20:00 can still be logged');
  let f = flags([e40], ivs40, new Date(2026, 10, 11, 9));
  assert.strictEqual(f.length, 1);
  assert.deepStrictEqual(f[0].entryIds, ['E40']);
  assert.strictEqual(f[0].flag, 'Not logged: 20 min steady', 'warm-ups are logged as warmup, never "not logged"');
  const e20 = Object.assign({}, e40, { 'Entry ID': 'E20' });
  const both = ivs40.concat([Object.assign(iv(1, 1200), { 'Entry ID': 'E20' })]);
  assert.deepStrictEqual(flags([e40, e20], both, new Date(2026, 10, 11, 9)), [], 'both logged');
  assert.deepStrictEqual(flags([e40, Object.assign({}, e20, { Status: 'Out' })], both, new Date(2026, 10, 11, 9)), [], 'an Out that day: no skip flag');
  assert.deepStrictEqual(flags([e40], ivs40, new Date(2026, 10, 11, 9), ['E40']), [], 'posted once');
  const draft = sched.map((r) => (r['Workout ID'] === 'X20' ? Object.assign({}, r, { Published: false }) : r));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(g.pendingPlanFlags([e40], ivs40, squads, Object.assign({}, inp, { schedule: draft }), new Date(2026, 10, 11, 9), []))), [], 'a draft is not a skipped workout');
  // A warm-up logged short of plan (14:00 of 15:00) is never flagged; the day's work still is checked.
  const W15 = W.map((w) => (w['Workout ID'] === 'XW' ? Object.assign({}, w, { Work: '15:00' }) : w));
  const eW = Object.assign({}, e40, { 'Entry ID': 'EW' });
  const ivW = [Object.assign(iv(1, 840), { 'Entry ID': 'EW' })];
  const withWarm = Object.assign({}, inp, { workouts: W15 });
  assert.strictEqual(g.plannedBest(eW, 'Varsity', sched, W15, ivW).row['Workout ID'], 'XW');
  const wf = (entries, ivs) => JSON.parse(JSON.stringify(g.pendingPlanFlags(entries, ivs, squads, withWarm, new Date(2026, 10, 11, 9), [])));
  assert.deepStrictEqual(wf([eW, e40, e20], ivW.concat(both)), [], 'short warm-up, both workouts done: no flag');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(g.pendingPlanFlags([eW], ivW, squads, withWarm, new Date(2026, 10, 10, 18), []))), [], 'same day, warm-up alone: no flag');
  assert.deepStrictEqual(wf([eW, e40], ivW.concat(ivs40))[0].entryIds, ['EW', 'E40'], 'a skipped workout still flags the day');
  // Stopped early on the 40:00, and the 20:00 skipped: one message for the day.
  f = flags([e40], [Object.assign(iv(1, 1800), { 'Entry ID': 'E40' })], new Date(2026, 10, 11, 9));
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].flag, 'Piece 1 stopped at 30:00 of 40:00. Not logged: 20 min steady');
  const msg = g.planFlagMessage(Object.assign({}, f[0], { date: day, entryIds: ['E40', 'E41'] }), 'https://sheet.example');
  assert.ok(/Marked Modified: Piece 1 stopped at 30:00 of 40:00\. Not logged: 20 min steady\./.test(msg.text), msg.text);
  assert.strictEqual(msg.blocks[1].elements[0].value, 'E40,E41');
  // Marking and the buttons.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(g.planFlagAutoSet_({ Status: 'Full', 'Review status': '' }))), { Status: 'Modified', 'Review status': 'Auto Modified' });
  assert.strictEqual(g.planFlagAutoSet_({ Status: 'Modified', 'Review status': '' }), null);
  assert.strictEqual(g.planFlagAutoSet_({ Status: 'Full', 'Review status': 'Reviewed, Full' }), null);
  const auto = { 'Entry ID': 'E40', Status: 'Modified', 'Review status': 'Auto Modified' };
  const plain = (x) => JSON.parse(JSON.stringify(x));
  assert.deepStrictEqual(plain(g.decidePlanFlagAction(auto, 'confirm', 'U1', ['U1'])), { status: 'ok', mark: 'Modified', set: { 'Review status': 'Reviewed, Modified' } });
  assert.deepStrictEqual(plain(g.decidePlanFlagAction(auto, 'full', 'U1', ['U1'])), { status: 'ok', set: { Status: 'Full', 'Review status': 'Reviewed, Full' } });
  assert.deepStrictEqual(plain(g.decidePlanFlagAction(auto, 'modified', 'U1', ['U1'])), { status: 'ok', set: { 'Review status': 'Reviewed, Modified' } }, 'older message button');
  assert.strictEqual(g.decidePlanFlagAction(Object.assign({}, auto, { 'Review status': 'Reviewed, Full' }), 'confirm', 'U1', ['U1']).status, 'already');
  assert.strictEqual(g.decidePlanFlagAction(auto, 'full', 'U9', ['U1']).status, 'forbidden');
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
  inputs.settings = Object.assign({}, inputs.settings, { 'oyo.break.dates': '12/23/2026-01/03/2027', 'oyo.break.required': '30' });
  const b = JSON.parse(JSON.stringify(g.siteFeed(inputs, new Date(2026, 9, 23, 12)))).settings.oyoBreak;
  assert.deepStrictEqual(b, { ranges: [{ from: '2026-12-23', to: '2027-01-03' }], required: 30, elite: 60 });   // Elite is double the break Standard goal
  const f = JSON.parse(JSON.stringify(g.siteFeed(inputs, new Date(2026, 9, 23, 12)))).settings;
  assert.strictEqual(f.oyoElite, f.oyoRequired * 2, 'Elite = Standard + 100%');
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
  assert.strictEqual(g.classifyLogbook('Boys', '2026-10-29', '17:15', lbPractices, []).type, 'Practice', 'a Girls row is for every rower, whatever the roster squad');
  const vn = [{ date: '2026-10-29', squad: 'Varsity', canceled: false, windowStart: '16:30', windowEnd: '19:30' }];
  assert.strictEqual(g.classifyLogbook('Novice', '2026-10-29', '17:15', vn, []).type, 'OYO', 'a Varsity-only row is not for a Novice');
  assert.strictEqual(g.classifyLogbook('Varsity', '2026-10-29', '17:15', vn, []).type, 'Practice');
  // Live Sheet (launch day 2026-11-18): Practices say 'Girls', Roster says Varsity / Novice.
  assert.strictEqual(g.classifyLogbook('Varsity', '2026-10-29', '17:15', lbPractices, []).type, 'Practice', 'regression: Girls practice, Varsity rower');
  assert.strictEqual(g.classifyLogbook('Novice', '2026-10-29', '17:15', lbPractices, []).type, 'Practice', 'regression: Girls practice, Novice rower');
});

test('logbook: interval result becomes a pending entry with pieces', () => {
  const r = g.logbookRows(lbResult(), lbCtx());
  assert.strictEqual(r.entry['Source'], 'Logbook');
  assert.strictEqual(r.entry['Review status'], '', 'a plain result counts at once (David, 2026-11-19)');
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

test('logbook: every Logbook field lands in a column; the raw copy is split into chunks', () => {
  const r = g.logbookRows(lbResult({
    calories: 412, strokeCount: 1900, hrAvg: 150, hrMin: 90, hrMax: 181, hrEnding: 160, hrRest: 70, hrRecovery: 120, logbookSource: 'ErgData',
    verified: 'No', ranked: 'Yes', timezone: 'US/Eastern', dateUtc: '2026-10-28 15:23:00', privacy: 'partners', comments: 'hi',
    restTimeTotalS: 120, restDistanceTotalM: 40, targets: { pace: 1020 }, splits: [{ timeS: 30 }],
    intervals: [{ timeS: 30, distanceM: 87, rate: 22, restTimeS: 30, restDistanceM: 48, calories: 9, wattMinutes: 70, hrAvg: 140, hrMax: 160, targetPaceS: 101, targetWatts: 200, type: 'time', machine: 'rower' }]
  }), lbCtx());
  const e = r.entry, iv = r.intervals[0];
  assert.deepStrictEqual([e['Avg HR'], e['HR min'], e['HR max'], e['HR ending'], e['HR rest'], e['HR recovery'], e['Calories'], e['Stroke count']], [150, 90, 181, 160, 70, 120, 412, 1900]);
  assert.deepStrictEqual([e['Logbook source'], e['Verified'], e['Ranked'], e['Timezone'], e['Date UTC'], e['Privacy'], e['Rest s total'], e['Rest m total']], ['ErgData', 'No', 'Yes', 'US/Eastern', '2026-10-28 15:23:00', 'partners', 120, 40]);
  assert.strictEqual(e['Targets JSON'], '{"pace":1020}');
  assert.strictEqual(e['Splits JSON'], '[{"timeS":30}]');
  assert.deepStrictEqual([iv['Calories'], iv['Watt-min'], iv['Avg HR'], iv['HR max'], iv['Target pace s'], iv['Target watts'], iv['Piece type'], iv['Machine']], [9, 70, 140, 160, 101, 200, 'time', 'rower']);
  // a totals-only result puts its calories and heart rate on its one piece
  const tot = g.logbookRows(lbResult({ intervals: [], timeS: 64.8, distanceM: 222, calories: 12, hrAvg: 130 }), lbCtx());
  assert.deepStrictEqual([tot.intervals[0]['Calories'], tot.intervals[0]['Avg HR']], [12, 130]);
  // raw copy: result JSON plus strokes, long text split at the chunk size, and nothing without a raw copy
  assert.strictEqual(g.logbookRawRows(1, 'A001', null, 'now').length, 0);
  const now = new Date();
  const small = g.logbookRawRows(122191976, 'A001', { result: { id: 122191976 }, strokes: [{ t: 1 }] }, now);
  assert.strictEqual(JSON.stringify(small.map((x) => [x.Kind, x.Part, x['Result ID']])), '[["Result",1,"122191976"],["Strokes",1,"122191976"]]');
  const big = g.logbookRawRows(1, 'A001', { result: {}, strokes: Array.from({ length: 5000 }, () => ({ t: 100, d: 1000, p: 1000, spm: 30, hr: 140 })) }, now);
  const parts = big.filter((x) => x.Kind === 'Strokes');
  assert.ok(parts.length >= 2 && parts.every((x) => x.JSON.length <= g.LOGBOOK_RAW_CHUNK));
  assert.strictEqual(JSON.parse(parts.map((x) => x.JSON).join('')).length, 5000);
  Object.keys(big[0]).forEach((k) => assert.ok(g.HEADERS[g.TABS.LOGBOOK_RAW].includes(k), 'raw column ' + k));
});

test('logbook: totals only, just row, possible make-up, benchmark shape, unsupported machine', () => {
  const totals = g.logbookRows(lbResult({ intervals: [], timeS: 64.8, distanceM: 222, workoutType: 'JustRow', name: '' }), lbCtx());
  assert.strictEqual(totals.intervals.length, 1);
  assert.strictEqual(totals.entry['Work s'], 64.8);
  assert.strictEqual(totals.entry['Work m'], 222);
  const makeup = g.logbookRows(lbResult({ localTime: '21:00' }), lbCtx([{ date: '2026-10-26', type: 'Practice', status: 'Out' }]));
  assert.deepStrictEqual([makeup.entry['Session type'], makeup.entry['Review status']], ['Make-up', 'Pending: possible make-up']);
  assert.strictEqual(makeup.entry['Make-up for date'].getDate(), 27);
  const twoK = g.logbookRows(lbResult({ intervals: [{ timeS: 440, distanceM: 2000, rate: 28 }], timeS: 440, distanceM: 2000, name: '2000m test' }), lbCtx());
  assert.ok(/possible benchmark/.test(twoK.entry['Coach note']));
  assert.strictEqual(twoK.benchmark, undefined);
  // David, 2026-11-21: no "test" in the title (or warm up / cool down in it) means it is not a possible test.
  const cool = g.logbookRows(lbResult({ intervals: [{ timeS: 1200, distanceM: 4100, rate: 20 }], timeS: 1200, distanceM: 4100, name: '20:00 Cool Down' }), lbCtx());
  assert.ok(!/possible benchmark/.test(cool.entry['Coach note']) && cool.entry['Review status'] === '');
  const plain20 = g.logbookRows(lbResult({ intervals: [{ timeS: 1200, distanceM: 4100, rate: 20 }], timeS: 1200, distanceM: 4100, name: '' }), lbCtx());
  assert.strictEqual(plain20.entry['Review status'], '');
  const bike = g.logbookRows(lbResult({ machine: 'bikerg' }), lbCtx());
  assert.strictEqual(bike.entry['Activity'], 'BikeErg');
  assert.ok(g.logbookRows(lbResult({ machine: 'skierg' }), lbCtx()).skip);
  const many = g.logbookRows(lbResult({ intervals: Array.from({ length: 14 }, () => ({ timeS: 60, distanceM: 200, rate: 24, restTimeS: 30, restDistanceM: 50 })) }), lbCtx());
  assert.strictEqual(many.intervals.length, g.MAX_INTERVALS);
  assert.strictEqual(many.entry['Work s'], 840);
});

test('logbook: a 2k-shaped result still waits for the athlete; a plain one counts at once', () => {
  const twoK = g.logbookRows(lbResult({ intervals: [{ timeS: 440, distanceM: 2000, rate: 28 }], timeS: 440, distanceM: 2000, name: '2000m test' }), lbCtx());
  assert.strictEqual(twoK.entry['Review status'], 'Pending');
  assert.strictEqual(g.logbookRows(lbResult(), lbCtx()).entry['Review status'], '');
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
  // since 2026-11-19 a plain Pending row left from before is accepted now; a test-shaped one still waits
  const fresh = entry({ 'Entry ID': 'fresh', 'Submitted at': new Date(2026, 9, 30, 4, 30) });
  const longer = entry({ 'Entry ID': 'long', 'Submitted at': new Date(2026, 9, 30, 4, 30), 'Work s': 1500, 'Work m': 5500 });
  const lIv = [{ 'Entry ID': 'long', 'Interval #': 1, 'Work s': 1500, 'Work m': 5500 }];
  assert.deepStrictEqual(Array.from(g.logbookDueIds([fresh, longer], now, [{ ...ivs[0], 'Entry ID': 'fresh' }].concat(lIv))), ['long']);
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

test('slack /log: coach or own-Roster access, pieces box, modal values parse like the Form', () => {
  const roster = [{ 'Athlete ID': 'A001', Name: 'Jane Smith', 'Slack member ID': 'UJ1', Active: 'Yes' }, { 'Athlete ID': 'A002', Name: 'Old Athlete', 'Slack member ID': 'UO2', Active: 'No' },
    { 'Athlete ID': 'A003', Name: 'Kim Lee', 'Slack member ID': 'UK3', Active: 'Yes' }];
  const coaches = ['UC1', 'UC2'];
  const co = g.slackLogAccess_(roster, coaches, 'UC1', ' jane  SMITH ');
  assert.strictEqual(co.athlete.Name, 'Jane Smith');
  assert.strictEqual(co.role, 'coach');
  assert.strictEqual(g.slackLogAccess_(roster, coaches, 'UA9', 'Jane Smith').status, 'not_allowed', 'unknown Slack account');
  assert.strictEqual(g.slackLogAccess_(roster, coaches, '', 'Jane Smith').status, 'not_allowed');
  assert.strictEqual(g.slackLogAccess_(roster, [], 'UC1', 'Jane Smith').status, 'not_allowed', 'no coach IDs set and not on the Roster: nobody');
  assert.strictEqual(g.slackLogAccess_(roster, coaches, 'UC1', 'Old Athlete').status, 'unknown_name', 'inactive');
  assert.strictEqual(g.slackLogAccess_(roster, coaches, 'UC1', '').status, 'unknown_name');
  // athletes: found by Roster Slack member ID, only herself
  const self = g.slackLogAccess_(roster, coaches, 'UJ1', '');
  assert.deepStrictEqual([self.status, self.role, self.athlete.Name], ['ok', 'athlete', 'Jane Smith']);
  assert.strictEqual(g.slackLogAccess_(roster, coaches, 'UJ1', ' jane smith ').status, 'ok', 'typing her own name is fine');
  assert.strictEqual(g.slackLogAccess_(roster, coaches, 'UJ1', 'Kim Lee').status, 'not_yourself', 'cannot log for a teammate');
  assert.strictEqual(g.slackLogAccess_(roster, coaches, 'UO2', '').status, 'not_allowed', 'inactive athlete');
  assert.strictEqual(g.slackLogAccess_(roster, coaches, 'UJ1', 'Old Athlete').status, 'not_yourself');

  // FYI DM target: only when a coach logged, a real Slack ID, not the coach herself
  assert.strictEqual(g.slackFyiTarget_('coach', { 'Slack member ID': ' UJ1 ' }, 'UC1'), 'UJ1');
  assert.strictEqual(g.slackFyiTarget_('athlete', { 'Slack member ID': 'UJ1' }, 'UJ1'), '', 'no FYI for her own entry');
  assert.strictEqual(g.slackFyiTarget_('coach', { 'Slack member ID': '' }, 'UC1'), '');
  assert.strictEqual(g.slackFyiTarget_('coach', { 'Slack member ID': 'jane smith' }, 'UC1'), '', 'not a member ID');
  assert.strictEqual(g.slackFyiTarget_('coach', { 'Slack member ID': 'UC1' }, 'UC1'), '', 'coach logging for herself');

  const p = g.parsePiecesText('10:00.0, 2650, 22, 2:00, 300\n\n 10:00, 2660 \n10:00,2675,,');
  assert.strictEqual(p.length, 3);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(p[0])), { WORK_TIME: '10:00.0', WORK_M: '2650', RATE: '22', REST_TIME: '2:00', REST_M: '300' });
  assert.strictEqual(p[1].RATE, '');
  assert.throws(() => g.parsePiecesText(''), /at least one/);
  assert.throws(() => g.parsePiecesText('10:00'), /Piece 1: work meters are missing/);
  assert.strictEqual(g.parsePiecesText('1:01:52.0, 10000')[0].WORK_TIME, '1:01:52.0', 'a run over an hour is accepted');
  assert.strictEqual(g.parseTime('1:01:52.0'), 3712);
  assert.strictEqual(g.parsePiecesText('1:00:00.0, 0')[0].WORK_M, '0', 'a stair stepper has no distance: 0 m is accepted');
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
  assert.throws(() => g.slackLogAnswers({ ...form, type: 'bogus' }, 'Jane Smith'), /Pick Practice/);

  // Test (2k / 20') = the Form's Benchmark test path: linked Benchmarks + Entries rows (David, 2026-11-07)
  const t2k = { date: '2026-01-12', type: 'test', activity: 'Erg (RowErg)', warmup: '15:00', cooldown: '5:00', pieces: '7:30.4, 2000, 31', rpe: '9', drag: '105', note: 'felt good' };
  const slack2k = g.parseSubmission(g.slackLogAnswers(t2k, 'Jane Smith', 'Jane Smith'), ctxFor());
  const form2k = g.parseSubmission({
    [Q.ATHLETE]: 'Jane Smith', [Q.ENTERED_BY]: 'Jane Smith', [Q.DATE]: '2026-01-12', [Q.LOG_TYPE]: g.LOG_TYPES.BENCHMARK, [Q.B_WHERE]: g.TEST_WHERE.PRACTICE,
    [Q.TEST]: '2000m', [Q.B_WARMUP]: '15:00', [Q.B_COOLDOWN]: '5:00', [Q.B_RPE]: '9', [Q.T_TIME]: '7:30.4', [Q.T_RATE]: '31', [Q.T_DRAG]: '105', [Q.T_NOTE]: 'felt good'
  }, ctxFor());
  assert.deepStrictEqual(JSON.parse(JSON.stringify(slack2k)), JSON.parse(JSON.stringify(form2k)), '2k via /log = 2k via the Form');
  assert.strictEqual(slack2k.benchmark.Test, '2000m');
  assert.strictEqual(slack2k.benchmark['Time s'], 450.4);
  assert.strictEqual(slack2k.benchmark['Drag check'], '', 'drag given, no flag');
  assert.strictEqual(slack2k.entry['Benchmark ID'], slack2k.benchmark['Benchmark ID']);
  assert.strictEqual(slack2k.benchmark['Entry ID'], slack2k.entry['Entry ID']);
  assert.strictEqual(slack2k.entry['Session type'], 'Practice');
  const t20 = g.parseSubmission(g.slackLogAnswers({ ...t2k, pieces: '20:00.0, 5400, 24', test_where: 'oyo' }, 'Jane Smith'), ctxFor());
  assert.strictEqual(t20.benchmark.Test, '20min');
  assert.strictEqual(t20.benchmark.Meters, 5400);
  assert.strictEqual(t20.entry['Session type'], 'OYO');
  assert.strictEqual(t20.entry['Benchmark ID'], t20.benchmark['Benchmark ID']);
  assert.throws(() => g.slackLogAnswers({ ...t2k, pieces: '3:00, 750' }, 'Jane Smith'), /2000 m or a 20:00/);
  assert.throws(() => g.slackLogAnswers({ ...t2k, pieces: '3:45, 1000\n3:45, 1000' }, 'Jane Smith'), /one piece/);
  assert.throws(() => g.slackLogAnswers({ ...t2k, activity: 'BikeErg' }, 'Jane Smith'), /RowErg/);
});

test('slack photo: saved read becomes the same entry the Form would make', () => {
  const photo = { date: '2026-10-28', machine: 'RowErg', title: '4x500m/2:00r', rpe: '7', note: 'From erg photo',
    pieces: [{ timeS: 100.4, meters: 500, rate: 28, restS: 120 }, { timeS: 101.2, meters: 500, rate: 29, restS: 120 }, { timeS: 99.9, meters: 500, rate: null, restS: 0 }] };
  const r = g.parseSubmission(g.slackPhotoAnswers(photo, 'Jane Smith', 'Coach Greta'), ctxFor());
  assert.strictEqual(r.entry['Session type'], 'Practice');
  assert.strictEqual(r.entry.Status, 'Full');
  assert.strictEqual(r.entry.Activity, 'Erg (RowErg)');
  assert.strictEqual(r.entry['Entered by'], 'Coach Greta');
  assert.strictEqual(r.entry['Main set'], '4x500m/2:00r');
  assert.strictEqual(r.entry.RPE, 7);
  assert.strictEqual(r.entry['Work m'], 1500);
  assert.strictEqual(r.entry['Work s'], 301.5);
  assert.strictEqual(r.intervals.length, 3);
  assert.strictEqual(r.intervals[0]['Work s'], 100.4);
  assert.strictEqual(r.intervals[0]['Rest s'], 120);
  assert.strictEqual(r.intervals[2]['Avg rate'], '');
  const bike = g.parseSubmission(g.slackPhotoAnswers({ ...photo, machine: 'BikeErg', rpe: '', title: '' }, 'Jane Smith'), ctxFor());
  assert.strictEqual(bike.entry.Activity, 'BikeErg');
  assert.strictEqual(bike.entry.RPE, '');
  assert.strictEqual(bike.entry['Main set'], 'Erg screen photo');
  assert.throws(() => g.slackPhotoAnswers({ ...photo, pieces: [] }, 'Jane Smith'), /No pieces/);
  assert.throws(() => g.slackPhotoAnswers({ ...photo, pieces: Array(11).fill(photo.pieces[0]) }, 'Jane Smith'), /More than 10/);
});

test('slack photo: a 2k or 20-minute piece the athlete calls a test writes the Benchmarks row and the session', () => {
  const two = { benchmark: '2000m', date: '2026-10-28', machine: 'RowErg', title: '2000m', rpe: '9', note: 'From erg photo', pieces: [{ timeS: 452.3, meters: 2000, rate: 31, restS: 0 }] };
  const r = g.parseSubmission(g.slackPhotoAnswers(two, 'Jane Smith'), ctxFor());
  assert.strictEqual(r.benchmark.Test, '2000m');
  assert.strictEqual(r.benchmark['Time s'], 452.3);
  assert.strictEqual(r.benchmark['Drag check'], 'FLAG: no drag factor', 'the screen has no drag factor');
  assert.strictEqual(r.entry['Benchmark ID'], r.benchmark['Benchmark ID']);
  assert.strictEqual(r.entry['Session type'], 'Practice');
  assert.strictEqual(r.entry.RPE, 9);
  assert.strictEqual(r.entry['Work m'], 2000);
  assert.strictEqual(r.intervals.length, 1);
  const twenty = { ...two, benchmark: '20min', title: '20:00', pieces: [{ timeS: 1200, meters: 5210, rate: 24, restS: 0 }] };
  const t = g.parseSubmission(g.slackPhotoAnswers(twenty, 'Jane Smith'), ctxFor());
  assert.strictEqual(t.benchmark.Test, '20min');
  assert.strictEqual(t.benchmark.Meters, 5210);
  assert.strictEqual(t.entry['Work s'], 1200);
  assert.throws(() => g.slackPhotoAnswers({ ...two, pieces: [{ timeS: 452.3, meters: 1990 }] }, 'Jane Smith'), /not a 2000m test/);
  assert.throws(() => g.slackPhotoAnswers({ ...twenty, pieces: [{ timeS: 1190, meters: 5000 }] }, 'Jane Smith'), /not a 20min test/);
  assert.throws(() => g.slackPhotoAnswers({ ...two, machine: 'BikeErg' }, 'Jane Smith'), /never a benchmark/);
  assert.throws(() => g.slackPhotoAnswers({ ...two, pieces: [two.pieces[0], two.pieces[0]] }, 'Jane Smith'), /one piece/);
  assert.strictEqual(g.parseSubmission(g.slackPhotoAnswers({ ...two, benchmark: '' }, 'Jane Smith'), ctxFor()).benchmark, undefined, 'no answer means a normal workout');
});

test('slack photo: a weekend or no-practice day is OYO unless the athlete has an open make-up (David, 2026-11-18)', () => {
  // Fake schedule: Girls practice Mon 11/16 (missed), Tue 11/17 (logged), Wed 11/18 canceled; nothing Sat 11/21.
  const practices = [
    { date: '2026-11-16', squad: 'Girls', canceled: false },
    { date: '2026-11-17', squad: 'Girls', canceled: false },
    { date: '2026-11-18', squad: 'Girls', canceled: true },
    { date: '2026-11-19', squad: 'Novice', canceled: false }
  ];
  const logged = [{ date: '2026-11-17', type: 'Practice', status: 'Full', makeupFor: '' }];
  const plain = (x) => JSON.parse(JSON.stringify(x));
  const s = (date, entries, chosen, isTest) => g.slackPhotoSession_('Varsity', date, practices, entries, chosen, isTest);
  assert.deepStrictEqual(plain(s('2026-11-17', logged)), { type: 'Practice', makeupFor: '' }, 'a practice day stays Practice');
  assert.deepStrictEqual(plain(s('2026-11-21', logged)), { ask: true, missed: ['2026-11-16'] }, 'Saturday with a missed Monday asks');
  const coveredMon = logged.concat([{ date: '2026-11-20', type: 'Make-up', status: 'Full', makeupFor: '2026-11-16' }]);
  assert.deepStrictEqual(plain(s('2026-11-21', coveredMon)), { type: 'OYO', makeupFor: '' }, 'nothing open: OYO, no question');
  assert.deepStrictEqual(plain(s('2026-11-18', coveredMon)), { type: 'OYO', makeupFor: '' }, 'a canceled practice day is not a practice day');
  assert.deepStrictEqual(plain(s('2026-11-19', coveredMon)), { type: 'OYO', makeupFor: '' }, "another squad's practice doesn't count");
  assert.deepStrictEqual(plain(s('2026-11-28', [])), { type: 'OYO', makeupFor: '' }, 'missed practices over 7 days old are not open');
  assert.deepStrictEqual(plain(s('2026-11-18', [])), { ask: true, missed: ['2026-11-17', '2026-11-16'] }, 'newest missed first');
  assert.deepStrictEqual(plain(s('2026-11-21', logged, { sessionType: 'oyo' })), { type: 'OYO', makeupFor: '' });
  assert.deepStrictEqual(plain(s('2026-11-21', logged, { sessionType: 'makeup', makeupFor: '2026-11-16' })), { type: 'Make-up', makeupFor: '2026-11-16' });
  assert.throws(() => s('2026-11-21', logged, { sessionType: 'makeup', makeupFor: '2026-11-21' }), /missed practice/);
  assert.deepStrictEqual(plain(s('2026-11-21', logged, {}, true)), { type: 'OYO', makeupFor: '' }, 'a test never asks');
  assert.deepStrictEqual(plain(s('2026-11-17', logged, {}, true)), { type: 'Practice', makeupFor: '' });

  const photo = { date: '2026-11-21', machine: 'RowErg', title: '3x15:00', note: 'From erg photo',
    pieces: [{ timeS: 900, meters: 3600, rate: 20, restS: 120 }, { timeS: 900, meters: 3610, rate: 20, restS: 120 }, { timeS: 900, meters: 3620, rate: 20, restS: 0 }] };
  const oyo = g.parseSubmission(g.slackPhotoAnswers(photo, 'Jane Smith', '', { type: 'OYO', makeupFor: '' }), ctxFor());
  assert.strictEqual(oyo.entry['Session type'], 'OYO');
  assert.ok(!oyo.entry.Status, 'OYO has no practice status');
  assert.strictEqual(oyo.intervals.length, 3);
  const mk = g.parseSubmission(g.slackPhotoAnswers(photo, 'Jane Smith', '', { type: 'Make-up', makeupFor: '2026-11-16' }), ctxFor());
  assert.strictEqual(mk.entry['Session type'], 'Make-up');
  assert.strictEqual(mk.entry.Status, 'Full');
  assert.ok(mk.entry['Make-up for date'], 'make-up date saved');
  const test2k = { ...photo, benchmark: '2000m', title: '2000m', pieces: [{ timeS: 452.3, meters: 2000, rate: 31, restS: 0 }] };
  const t = g.parseSubmission(g.slackPhotoAnswers(test2k, 'Jane Smith', '', { type: 'OYO', makeupFor: '' }), ctxFor());
  assert.strictEqual(t.entry['Session type'], 'OYO', 'a test on a day with no practice is on my own');
  assert.strictEqual(t.benchmark.Test, '2000m');
});

test('photos: Drive link, same-workout match, Logbook wins, feed says only that a photo exists', () => {
  assert.strictEqual(g.photoFileId_('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp-_/view?usp=drivesdk'), '1AbCdEfGhIjKlMnOp-_');
  assert.strictEqual(g.photoFileId_('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp'), '1AbCdEfGhIjKlMnOp');
  assert.strictEqual(g.photoFileId_(''), '');
  assert.strictEqual(g.photoFileId_('hello'), '');
  assert.ok(g.HEADERS['Entries'].indexOf('Photo link') === g.HEADERS['Entries'].indexOf('Cooldown m') + 1, 'Photo link keeps its place');
  const mine = { athleteId: 'A001', date: '2026-10-28', workS: 480, workM: 2000 };
  const twin = (over) => g.photoSameWorkout_(mine, { ...mine, ...over });
  assert.ok(twin({}) && twin({ workS: 482.3, workM: 2008 }), 'close totals match');
  assert.ok(!twin({ workM: 2060 }) && !twin({ workS: 490 }) && !twin({ date: '2026-10-27' }) && !twin({ athleteId: 'A002' }), 'different meters, time, day or athlete');
  assert.ok(!twin({ workM: 0 }) && !twin({ workM: '' }), 'blank totals never match');
  const row = (over) => ({ 'Entry ID': 'E1', 'Athlete ID': 'A001', Date: new Date(2026, 9, 28), 'Work s': 480.4, 'Work m': 2000, Source: 'Logbook', 'Review status': '', 'Photo link': '', ...over });
  assert.strictEqual(g.photoFindLogbookTwin_(mine, [row({ Source: 'Form' }), row({ 'Review status': 'Rejected' })]), null, 'only live Logbook entries');
  assert.strictEqual(g.photoFindLogbookTwin_(mine, [row({ 'Entry ID': 'E2' }), row({ 'Entry ID': 'E3' })])['Entry ID'], 'E2');
  assert.strictEqual(g.photoFindSlackTwins_(mine, [row({ Source: 'Slack' })]).length, 0, 'a Slack entry with no photo is left alone');
  assert.strictEqual(g.photoFindSlackTwins_(mine, [row({ Source: 'Slack', 'Photo link': 'https://drive.google.com/file/d/xyz/view' }), row({ Source: 'Form', 'Photo link': 'x' })]).length, 1);
  // the feed carries a yes/no, never the link
  const inputs = dummyFeedInputs();
  inputs.entries.slice(0, 2).forEach((e, i) => { e['Photo link'] = i ? '' : 'https://drive.google.com/file/d/SECRETFILEID123456/view'; });
  const feed = JSON.parse(JSON.stringify(g.siteFeed(inputs, new Date(2026, 9, 23, 12))));
  assert.ok(feed.entries.some((e) => e.hasPhoto === true) && feed.entries.some((e) => e.hasPhoto === false));
  assert.ok(!JSON.stringify(feed).includes('SECRETFILEID'), 'no Drive link in the feed');
});

test('settings page: values are checked and stored the way the Sheet code reads them', () => {
  const field = (k) => g.settingsPageField_(k);
  const parse = (k, v) => JSON.parse(JSON.stringify(g.settingsParse_(field(k), v)));
  assert.deepStrictEqual(parse('multiplier.Run', ' 1.2 '), { value: '1.2' });
  assert.deepStrictEqual(parse('multiplier.Lifting', '0'), { value: '0' });
  assert.ok(parse('multiplier.Run', '-1').error && parse('multiplier.Run', 'abc').error && parse('multiplier.Run', '9').error);
  assert.deepStrictEqual(parse('oyo.standard.required', '60'), { value: '60' });
  assert.ok(parse('oyo.standard.required', '60.5').error, 'whole minutes only');
  assert.ok(parse('oyo.standard.required', '').error, 'a needed setting is never blanked');
  assert.deepStrictEqual(parse('oyo.break.required', ''), { value: '' });
  assert.deepStrictEqual(parse('gms.standard_s', '5:00.0'), { value: '300' });
  assert.deepStrictEqual(parse('gms.standard_s', '4:58.5'), { value: '298.5' });
  assert.ok(parse('gms.standard_s', '25:00').error && parse('gms.standard_s', 'fast').error);
  assert.deepStrictEqual(parse('shift.early.start', '3:30 pm'), { value: '15:30' });
  assert.deepStrictEqual(parse('shift.early.end', '17:30'), { value: '17:30' });
  assert.deepStrictEqual(parse('shift.late.start', '5:00PM'), { value: '17:00' });
  assert.ok(parse('shift.early.start', '3:30').error, 'a bare 3:30 could be morning or afternoon');
  assert.ok(parse('shift.early.start', '25:00').error && parse('shift.early.start', '3:75 pm').error);
  assert.deepStrictEqual(parse('shift.early.days', 'Mon, Wed,Fri-even'), { value: 'Mon,Wed,Fri-even' });
  assert.ok(parse('shift.early.days', 'Monday').error && parse('shift.early.days', '').error);
  assert.deepStrictEqual(parse('school_year_start', '7-1'), { value: '07-01' });
  assert.ok(parse('school_year_start', '02-30').error && parse('school_year_start', 'July').error);
  assert.deepStrictEqual(parse('season.winter_start', '2026-11-30'), { value: '2026-11-30' });
  assert.ok(parse('season.winter_start', '11/30/2026').error);
  assert.deepStrictEqual(parse('oyo.break.dates', '12/23/2026 - 1/3/2027 ; '), { value: '12/23/2026-1/3/2027' });
  assert.ok(parse('oyo.break.dates', '12/23/2026').error && parse('oyo.break.dates', '1/3/2027-12/23/2026').error);
  // what is stored reads back through the existing feed code
  const r = g.feedBreakRanges_(parse('oyo.break.dates', '12/23/2026-1/3/2027').value);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), [{ from: '2026-12-23', to: '2027-01-03' }]);
  assert.strictEqual(g.settingsDisplay_(field('gms.standard_s'), '300'), '5:00.0');
  assert.strictEqual(g.settingsDisplay_(field('shift.late.start'), '17:00'), '5:00 pm');
  assert.strictEqual(g.settingsDisplay_(field('shift.early.end'), '15:30'), '3:30 pm');
  assert.strictEqual(g.settingsDisplay_(field('shift.early.start'), '0:15'), '12:15 am');
});

test('settings page: only listed keys change, errors block everything, unchanged values are skipped', () => {
  const settings = {}; g.SETTINGS_DEFAULTS.forEach((d) => { settings[d[0]] = d[1]; });
  settings['site.coaches'] = 'Fake Coach 01/01/1980';
  const plan = (changes) => JSON.parse(JSON.stringify(g.settingsPlanSave_(settings, changes)));
  assert.deepStrictEqual(plan({ 'multiplier.Run': '1.2' }), { updates: [], errors: {} }, 'same value is not a change');
  assert.deepStrictEqual(plan({ 'multiplier.Run': '1.1' }).updates, [{ key: 'multiplier.Run', old: '1.2', value: '1.1' }]);
  // keys that carry sign-in dates, Slack IDs, addresses and ids are refused
  ['site.coaches', 'site.test_password', 'slack.coach_ids', 'alerts.email', 'form.id', 'backup.folder_id', 'gms.exponent', 'nope'].forEach((k) => {
    assert.deepStrictEqual(plan({ [k]: 'x' }).errors, { [k]: 'Not a setting you can change here.' }, k);
  });
  const bad = plan({ 'multiplier.Run': '1.1', 'load.jump_pct': 'lots' });
  assert.ok(bad.errors['load.jump_pct'] && !bad.errors['multiplier.Run']);
  // star bands must rise, judged on the values as they will be
  assert.ok(plan({ 'gms.star3_pct': '94' }).errors['gms.star3_pct'], '3 stars below 2 stars');
  assert.deepStrictEqual(plan({ 'gms.star2_pct': '90', 'gms.star3_pct': '93' }).errors, {});
  // star labels: one box per star level with its text (David, 2026-11-14); blank allowed, long text refused
  assert.strictEqual(plan({ 'gms.star2_label': 'Rising' }).updates.map((u) => u.value).join(), 'Rising');
  assert.deepStrictEqual(plan({ 'gms.star1_label': '' }).errors, {});
  assert.ok(plan({ 'gms.star5_label': 'x'.repeat(41) }).errors['gms.star5_label']);
  assert.strictEqual(g.settingsPageSections_().filter((s) => /^star\d$/.test(s.id)).map((s) => s.id).join(), 'star5,star4,star3,star2,star1');
  // the page lists every field with a value, and none of the withheld keys
  const view = JSON.parse(JSON.stringify(g.settingsPageView_({ 'multiplier.Run': '1.3' })));
  const keys = view.reduce((a, s) => a.concat(s.fields.map((f) => f.key)), []);
  assert.strictEqual(keys.length, new Set(keys).size);
  assert.ok(keys.includes('multiplier.BikeErg') && keys.includes('oyo.standard.required') && !keys.includes('oyo.standard.elite') && keys.includes('shift.late.days'));
  assert.ok(!keys.some((k) => /^(site|slack|alerts|form|backup)\./.test(k)));
  assert.strictEqual(view[0].fields.find((f) => f.key === 'multiplier.Run').value, '1.3');
  assert.strictEqual(view[0].fields.find((f) => f.key === 'multiplier.Swim').value, '0.8', 'a missing row shows its default');
  // every listed key exists in the defaults, so setup() always creates its row
  const known = g.SETTINGS_DEFAULTS.map((d) => d[0]);
  keys.forEach((k) => assert.ok(known.includes(k), k + ' has no default row'));
});

test('setup: retired Settings rows are found, last first, and no live setting is among them', () => {
  const keys = ['Key', 'timezone', 'default_warmup', 'oyo.standard.required', 'oyo.performance.elite', 'gms.star2_s', 'gms.star2_pct', 'target.UT2.20min', 'target.Aerobic.20min', 'multiplier.Run'];
  assert.deepStrictEqual(JSON.parse(JSON.stringify(g.retiredRowsIn_(keys, g.RETIRED_SETTING_KEYS))), [8, 6, 5, 3]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(g.retiredRowsIn_(['Key'], g.RETIRED_SETTING_KEYS))), []);
  // a retired key must never be one the code still defaults or the Settings page edits
  const live = g.SETTINGS_DEFAULTS.map((d) => d[0]);
  g.RETIRED_SETTING_KEYS.forEach((k) => assert.ok(!live.includes(k) && !g.settingsPageField_(k), k + ' is still used'));
});

test('ergbot-weights: rows for ErgBot, blank and dateless rows skipped', () => {
  const rows = JSON.parse(JSON.stringify(g.ergbotWeightRows_([
    { Date: new Date(2026, 9, 5), 'Athlete ID': 'A1', Athlete: 'Dummy Rower', 'Weight lb': 141 },
    { Date: '', 'Athlete ID': 'A1', Athlete: 'Dummy Rower', 'Weight lb': 140 },
    { Date: new Date(2026, 9, 6), 'Athlete ID': 'A2', Athlete: 'Dummy Two', 'Weight lb': '' }
  ])));
  assert.deepStrictEqual(rows, [{ date: '2026-10-05', athlete: 'Dummy Rower', lb: 141 }]);
});

test('site log: same rows as the Form, test question only for one exact piece', () => {
  const Q = g.Q;
  const base = { date: '2026-01-12', type: 'practice', status: 'full', pieces: '20:00.0, 4936, 22', rpe: '6', drag: '105' };
  const ans = (f) => g.siteLogAnswers_({ ...base, ...f }, 'Jane Smith', 'Coach Pat');
  const run = (f) => g.parseSubmission(ans(f), ctxFor());
  // a normal workout needs only a few typed numbers
  const plain = run({ test: 'no' });
  assert.strictEqual(plain.entry['Entered by'], 'Coach Pat');
  assert.strictEqual(plain.entry.Activity, 'Erg (RowErg)');
  assert.strictEqual(plain.benchmark, undefined);
  assert.strictEqual(plain.intervals.length, 1);
  // a run: typed time and meters, no test, no rate or drag
  const jog = run({ activity: 'Run', pieces: '25:00.0, 5000', drag: '', test: '' });
  assert.strictEqual(jog.entry.Activity, 'Run');
  assert.strictEqual(jog.benchmark, undefined);
  assert.strictEqual(jog.entry['Work m'], 5000);
  assert.throws(() => ans({ activity: 'Run', pieces: '25:00.0, 5000', test: 'yes' }), /test/i, 'a run is never a test');
  // an athlete logging for herself: non-erg only, OYO or practice, never a test
  assert.strictEqual(g.siteSelfLogError_({ activity: 'Run', type: 'oyo', pieces: '25:00.0, 5000' }), '');
  assert.strictEqual(g.siteSelfLogError_({ activity: 'Swim', type: 'practice' }), '');
  ['Erg (RowErg)', 'BikeErg', 'Lifting', 'Jetski', ''].forEach(x => assert.ok(g.siteSelfLogError_({ activity: x, type: 'oyo' }), 'activity ' + x));
  assert.ok(g.siteSelfLogError_({ activity: 'Run', type: 'makeup' }));
  assert.ok(g.siteSelfLogError_({ activity: 'Run', type: 'oyo', test: 'yes' }));
  assert.ok(g.siteSelfLogError_({ activity: 'Run', type: 'practice', status: 'out' }));
  assert.ok(g.siteSelfLogError_({ activity: 'Run', type: 'oyo', makeup_for: '2026-11-02' }));
  // kinds: exactly one piece of 2000 m, 500 m, 100 m or 20:00.0
  const kind = (t) => g.siteTestKind_(g.parsePiecesText(t));
  assert.strictEqual(kind('7:44.8, 2000, 31'), '2000m');
  assert.strictEqual(kind('1:34.9, 500, 40'), '500m');
  assert.strictEqual(kind('0:16.6, 100, 47'), '100m');
  assert.strictEqual(kind('20:00.0, 4936, 22'), '20min');
  assert.strictEqual(kind('20:00.3, 4938, 22'), null, 'near miss never asks');
  assert.strictEqual(kind('7:45.0, 1999, 31'), null);
  assert.strictEqual(kind('8:00, 2000\n8:00, 2000'), null, 'inside intervals never asks');
  assert.strictEqual(kind('8:00, 2000\n8:00, 2000\n8:00, 2000\n8:00, 2000'), null);
  // Yes saves linked Benchmarks + Entries rows
  const t20 = run({ test: 'yes' });
  assert.strictEqual(t20.benchmark.Test, '20min');
  assert.strictEqual(t20.benchmark.Meters, 4936);
  assert.strictEqual(t20.entry['Benchmark ID'], t20.benchmark['Benchmark ID']);
  const t2k = run({ test: 'yes', pieces: '7:44.8, 2000, 31' });
  assert.strictEqual(t2k.benchmark.Test, '2000m');
  assert.strictEqual(t2k.benchmark['Time s'], 464.8);
  const t500 = run({ test: 'yes', pieces: '1:34.9, 500, 40' });
  assert.strictEqual(t500.benchmark.Test, '500m');
  assert.strictEqual(t500.benchmark['Time s'], 94.9);
  const t100 = run({ test: 'yes', pieces: '0:16.6, 100, 47' });
  assert.strictEqual(t100.benchmark.Test, '100m');
  // No saves a normal workout; Yes on a non-test piece or on intervals is refused
  assert.strictEqual(run({ test: 'no', pieces: '7:44.8, 2000, 31' }).benchmark, undefined);
  assert.throws(() => ans({ test: 'yes', pieces: '20:00.3, 4938, 22' }), /not exactly/);
  assert.throws(() => ans({ test: 'yes', pieces: '8:00, 2000\n8:00, 2000' }), /not exactly/);
  assert.throws(() => ans({ test: 'yes', activity: 'BikeErg' }), /RowErg/);
  // out of practice and other types
  assert.strictEqual(g.parseSubmission(g.siteLogAnswers_({ date: '2026-01-12', type: 'practice', status: 'out', note: 'sick', pieces: '' }, 'Jane Smith', 'Coach Pat'), ctxFor()).entry.Status, 'Out');
  assert.strictEqual(run({ type: 'oyo', status: '' }).entry['Session type'], 'OYO');
  assert.strictEqual(run({ type: 'makeup', makeup_for: '2026-01-10' }).entry['Session type'], 'Make-up');
  assert.throws(() => ans({ type: 'bogus' }), /Pick/);
});

test('weights page: parse, status and rows (pure)', () => {
  assert.strictEqual(g.weightsParse_('128').lb, 128);
  assert.strictEqual(g.weightsParse_(' 128.5 lb ').lb, 128.5);
  ['', 'abc', '5', '400', '12.55', '-130'].forEach(v => assert.ok(g.weightsParse_(v).error, v));
  assert.strictEqual(g.weightsStatus_('', '2026-07-01'), 'Missing');
  assert.strictEqual(g.weightsStatus_('2026-06-02', '2026-07-01'), 'Due');
  assert.strictEqual(g.weightsStatus_('2026-09-04', '2026-07-01'), 'Current');
  const roster = [
    { Name: 'A One', 'Athlete ID': 'A1', Squad: 'Varsity', Role: 'Rower', Active: 'Yes' },
    { Name: 'B Two', 'Athlete ID': 'A2', Squad: 'Novice', Role: 'Rower', Active: 'Yes' },
    { Name: 'C Three', 'Athlete ID': 'A3', Squad: 'Novice', Role: 'Rower', Active: 'Yes' },
    { Name: 'D Cox', 'Athlete ID': 'A4', Squad: 'Varsity', Role: 'Coxswain', Active: 'Yes' },
    { Name: 'E Gone', 'Athlete ID': 'A5', Squad: 'Varsity', Role: 'Rower', Active: 'No' },
    { Name: 'F Alum', 'Athlete ID': 'A6', Squad: 'Alum', Role: 'Rower', Active: 'Yes' }];
  const weights = [
    { Date: '2026-09-04', 'Athlete ID': 'A1', 'Weight lb': 130, 'Entered by': 'Coach' },
    { Date: '2026-10-10', 'Athlete ID': 'A1', 'Weight lb': 131, 'Entered by': 'Coach' },
    { Date: '2026-06-02', 'Athlete ID': 'A2', 'Weight lb': 140, 'Entered by': 'Coach' }];
  const rows = JSON.parse(JSON.stringify(g.weightsPageRows_(roster, weights, '2026-07-01')));
  assert.deepStrictEqual(rows.map(r => [r.id, r.status, r.lb]), [['A3', 'Missing', null], ['A2', 'Due', 140], ['A1', 'Current', 131]], 'missing first, then due; only the newest weight; no coxswain, inactive or alum');
});

test('workout builder: ids, piece rows validated by the plan parser, schedule rows, list view (pure)', () => {
  assert.strictEqual(g.workoutNextId_([]), 'W1');
  assert.strictEqual(g.workoutNextId_(['W2', 'W10', 'DUMMY-W3', ' W4 ']), 'W11');
  const ok = g.workoutBuildRows_('W7', { name: 'Tuesday 20s', pieces: [
    { workType: 'Time', work: '20:00', reps: 3, rest: '2:00', zone: 'Aerobic', base: "20'", rate: '18-20' },
    { workType: 'Distance', work: '500 m', reps: 8, startEvery: '3:30', lowPct: 95, highPct: 100, base: '2k' }] });
  assert.ok(!ok.error, ok.error);
  assert.strictEqual(ok.rows.length, 2);
  assert.strictEqual(ok.rows[1]['Piece #'], 2);
  assert.strictEqual(ok.rows[1].Work, '500');
  const back = g.workoutPieces(ok.rows, 'W7');
  assert.strictEqual(back[0].workS, 1200);
  assert.strictEqual(back[1].startEveryS, 210);
  [{ name: '', pieces: [{}] }, { name: 'x', pieces: [] },
   { name: 'x', pieces: [{ workType: 'Time', work: 'abc' }] },
   { name: 'x', pieces: [{ workType: 'Distance', work: '5' }] },
   { name: 'x', pieces: [{ workType: 'Time', work: '20:00', reps: 0 }] },
   { name: 'x', pieces: [{ workType: 'Time', work: '20:00', zone: 'Easy' }] },
   { name: 'x', pieces: [{ workType: 'Time', work: '20:00', rest: 'soon' }] },
   { name: 'x', pieces: [{ workType: 'Time', work: '20:00', lowPct: 500 }] },
   { name: 'x', pieces: [{ workType: 'Time', work: '20:00', activity: 'Jetski' }] }
  ].forEach((b, i) => assert.ok(g.workoutBuildRows_('W1', b).error, 'bad workout ' + i));
  const sch = g.scheduleBuildRows_('W7', { dates: ['2026-11-16', '2026-11-16', '2026-11-18'], squad: 'Varsity', session: 'Practice', publish: false });
  assert.strictEqual(sch.rows.length, 2, 'duplicate dates collapse');
  assert.strictEqual(sch.rows[0].Published, false, 'drafts unless Publish is ticked');
  assert.strictEqual(g.scheduleBuildRows_('W7', { dates: ['2026-11-16'], publish: true }).rows[0].Published, true);
  assert.strictEqual(g.scheduleBuildRows_('W7', {}).rows.length, 0);
  ['2026-02-30', 'tomorrow', '11/16/2026'].forEach(d => assert.ok(g.scheduleBuildRows_('W7', { dates: [d] }).error, d));
  assert.ok(g.scheduleBuildRows_('W7', { dates: ['2026-11-16'], squad: 'Alum' }).error);
  assert.ok(g.scheduleBuildRows_('W7', { dates: ['2026-11-16'], session: 'Race' }).error);
  const v = JSON.parse(JSON.stringify(g.workoutListView_(ok.rows, [
    { Date: '2026-11-16', Squad: 'Varsity', Session: 'Practice', 'Workout ID': 'W7', Published: true },
    { Date: '2026-11-10', Squad: 'All', Session: 'Practice', 'Workout ID': 'W7', Published: true },
    { Date: '2026-12-30', Squad: 'All', Session: 'Practice', 'Workout ID': 'W7', Published: true }], '2026-11-12')));
  assert.deepStrictEqual(v.upcoming.map(u => [u.day, u.published, u.name]), [['2026-11-16', true, 'Tuesday 20s']], 'only the next 28 days');
  assert.strictEqual(v.library[0].id, 'W7');
  assert.ok(/3 x 20:00/.test(v.library[0].summary));
  // Delete takes out one session, never the whole day, and never the other squad's row.
  const J = (x) => JSON.parse(JSON.stringify(x));
  const sched = [
    { Date: '2026-11-18', Squad: 'Varsity', Session: 'Practice', 'Workout ID': 'W7' },
    { Date: '2026-11-18', Squad: 'Novice', Session: 'Practice', 'Workout ID': 'W7' },
    { Date: '2026-11-18', Squad: 'All', Session: 'Practice', 'Workout ID': 'W8' },
    { Date: '2026-11-18', Squad: '', Session: '', 'Workout ID': 'W9' },
    { Date: '2026-11-19', Squad: 'Varsity', Session: 'Practice', 'Workout ID': 'W7' }];
  assert.deepStrictEqual(J(g.scheduleRowsToDelete_(sched, { day: '2026-11-18', workoutId: 'W7', squad: 'Varsity', session: 'Practice' })), [2]);
  assert.deepStrictEqual(J(g.scheduleRowsToDelete_(sched, { day: '2026-11-18', workoutId: 'W9', squad: 'All', session: 'Practice' })), [5], 'blank squad and session mean All and Practice');
  assert.deepStrictEqual(J(g.scheduleRowsToDelete_(sched, { day: '2026-11-18', workoutId: 'W7', squad: 'All', session: 'Practice' })), [], 'All does not match the squad rows');
  assert.deepStrictEqual(J(g.scheduleRowsToDelete_(sched.concat([sched[0]]), { day: '2026-11-18', workoutId: 'W7', squad: 'Varsity', session: 'Practice' })), [2, 7], 'identical duplicates go together');
  // Order within a day: an explicit Order wins; rows without one read warm up, the work, cool down.
  const nm = { A: 'Cool down', B: 'Main set', C: 'Warm up' };
  const nameOf = (id) => nm[id] || '';
  const day = (id, order, d = '2026-11-18') => ({ Date: d, Squad: 'All', Session: 'Practice', 'Workout ID': id, Order: order });
  assert.deepStrictEqual(J(g.scheduleSorted_([day('A', ''), day('B', ''), day('C', '')], nameOf).map(r => r['Workout ID'])), ['C', 'B', 'A'], 'old rows keep the warm/work/cool order');
  assert.deepStrictEqual(J(g.scheduleSorted_([day('A', 1), day('B', 2), day('C', 3)], nameOf).map(r => r['Workout ID'])), ['A', 'B', 'C'], 'explicit Order beats the names');
  assert.deepStrictEqual(J(g.scheduleSorted_([day('B', 1, '2026-11-19'), day('A', 2), day('C', 1)], nameOf).map(r => r.Date + r['Workout ID'])), ['2026-11-18C', '2026-11-18A', '2026-11-19B'], 'days stay in date order');
  assert.deepStrictEqual(J(g.scheduleNextOrder_([day('A', ''), day('B', '')], nameOf, ['2026-11-18', '2026-11-20'])), { '2026-11-18': 3, '2026-11-20': 1 }, 'a new session goes last');
  assert.deepStrictEqual(J(g.scheduleMoveList_([4, 7, 9], 1, -1)), [7, 4, 9]);
  assert.deepStrictEqual(J(g.scheduleMoveList_([4, 7, 9], 2, 1)), null, 'the last one cannot move down');
  assert.deepStrictEqual(J(g.scheduleMoveList_([4, 7, 9], 0, -1)), null, 'the first one cannot move up');
  assert.strictEqual(g.scheduleBuildRows_('W7', { dates: ['2026-11-16'] }, { '2026-11-16': 3 }).rows[0].Order, 3);
  // Runs and custom goal pace: stored in meters with their unit, shown in miles or km, never a % target.
  const runRows = g.workoutBuildRows_('W9', { name: 'Easy 5k', pieces: [{ workType: 'Distance', work: '5000', activity: 'Run', unit: 'km', pace: '5:30' }] });
  assert.ok(!runRows.error, runRows.error);
  assert.strictEqual(runRows.rows[0].Unit, 'km');
  const runPiece = g.workoutPieces(runRows.rows, 'W9')[0];
  assert.strictEqual(g.pieceLabel(runPiece), 'Run 5 km goal 5:30 /km');
  assert.strictEqual(g.pieceTargetPct(runPiece, {}), null);
  const mile = g.workoutPieces(g.workoutBuildRows_('W9', { name: 'Run', pieces: [{ workType: 'Distance', work: '4989', activity: 'Run' }] }).rows, 'W9')[0];
  assert.strictEqual(g.pieceLabel(mile), 'Run 3.1 mi', 'a run by distance defaults to miles');
  const t2k = g.workoutPieces(g.workoutBuildRows_('W9', { name: '2k test', pieces: [{ workType: 'Distance', work: '2000', zone: 'Threshold', pace: '1:45.0' }] }).rows, 'W9')[0];
  assert.strictEqual(g.pieceLabel(t2k), '2000m Threshold goal 1:45 /500m');
  assert.strictEqual(g.pieceGoalText_(t2k), '1:45 /500m');
  assert.strictEqual(g.pieceTargetPct(t2k, { 'target.Threshold.2000m': '95' }), null, 'a goal pace replaces the % target');
  ['0:20', '40:00', 'fast'].forEach(x => assert.ok(g.workoutBuildRows_('W9', { name: 'n', pieces: [{ workType: 'Time', work: '20:00', pace: x }] }).error, 'bad pace ' + x));
  assert.ok(g.workoutBuildRows_('W9', { name: 'n', pieces: [{ workType: 'Time', work: '20:00', unit: 'mi' }] }).error, 'a unit is for runs only');
  // Run plan matching and goal checks.
  const J2 = (x) => JSON.parse(JSON.stringify(x));
  const runPlan = (spec) => g.workoutPieces(g.workoutBuildRows_('WR', { name: 'Run', pieces: [spec] }).rows, 'WR');
  const logRun = (s, m) => [{ 'Interval #': 1, 'Work s': s, 'Work m': m }];
  const timeRun = runPlan({ workType: 'Time', work: '30:00', activity: 'Run' });
  assert.strictEqual(g.checkAgainstPlan(logRun(1750, 5000), timeRun, {}, {}, 'Run').matches, true, 'a bit short of 30:00 is close enough');
  assert.strictEqual(g.checkAgainstPlan(logRun(2400, 7000), timeRun, {}, {}, 'Run').matches, true, 'longer always counts');
  const shortRun = g.checkAgainstPlan(logRun(1200, 3500), timeRun, {}, {}, 'Run');
  assert.strictEqual(shortRun.matches, false);
  assert.match(shortRun.reason, /67% of the plan/);
  const distRun = runPlan({ workType: 'Distance', work: '4989', activity: 'Run', unit: 'mi' });
  assert.strictEqual(g.checkAgainstPlan(logRun(1800, 4600), distRun, {}, {}, 'Run').matches, true, '92% of 3.1 mi');
  assert.strictEqual(g.checkAgainstPlan(logRun(1800, 4000), distRun, {}, {}, 'Run').matches, false);
  const goalRun = runPlan({ workType: 'Distance', work: '4989', activity: 'Run', unit: 'mi', pace: '8:00' });
  assert.strictEqual(g.checkAgainstPlan(logRun(1440, 4989), goalRun, {}, {}, 'Run').hit, true, 'about 7:44/mi is faster than 8:00');
  assert.strictEqual(g.checkAgainstPlan(logRun(1860, 4989), goalRun, {}, {}, 'Run').hit, false, 'about 10:00/mi misses 8:00');
  assert.strictEqual(g.checkAgainstPlan(logRun(1860, 4989), goalRun, {}, {}, 'Run').intervals[0].status, 'below');
  assert.strictEqual(g.checkAgainstPlan(logRun(1600, 4989), timeRun, {}, {}, 'Run').hit, null, 'no goal, no verdict');
  // Erg goal pace: at the goal or faster is met; clearly slower is not.
  const goal2k = runPlan({ workType: 'Distance', work: '2000', pace: '1:45.0' });
  const erg = (s) => [{ 'Interval #': 1, 'Work s': s, 'Work m': 2000 }];
  assert.strictEqual(g.checkAgainstPlan(erg(416), goal2k, {}, {}).hit, true, '6:56 beats 7:00');
  assert.strictEqual(g.checkAgainstPlan(erg(420), goal2k, {}, {}).hit, true, 'exactly the goal');
  assert.strictEqual(g.checkAgainstPlan(erg(440), goal2k, {}, {}).hit, false);
  // Saves reuse an identical saved workout instead of copying it.
  const lib = [{ 'Workout ID': 'W1', Name: 'Tue 20s', 'Piece #': 1, Reps: 3, 'Work type': 'Time', Work: '20:00', Rest: '', 'Start every': '', Activity: 'Erg (RowErg)', Zone: '', Base: '', 'Target low %': '', 'Target high %': '', Rate: '', Notes: '' }];
  const same = g.workoutBuildRows_('W9', { name: 'Tue 20s', pieces: [{ workType: 'Time', reps: 3, work: '20:00' }] });
  assert.strictEqual(g.workoutFindSame_(lib, same.rows), 'W1');
  assert.strictEqual(g.workoutFindSame_(lib, g.workoutBuildRows_('W9', { name: 'Tue 20s', pieces: [{ workType: 'Time', reps: 4, work: '20:00' }] }).rows), '');
  assert.strictEqual(g.workoutFindSame_(lib, g.workoutBuildRows_('W9', { name: 'Other name', pieces: [{ workType: 'Time', reps: 3, work: '20:00' }] }).rows), '', 'the name counts');
  assert.deepStrictEqual(J(g.workoutPieceCompact_(lib[0])), { workType: 'Time', reps: '3', work: '20:00', activity: 'Erg (RowErg)' });
  // One-offs: only a workout saved on purpose joins the saved list; one in use stays visible for editing.
  const piece = [{ workType: 'Time', reps: 2, work: '10:00' }];
  assert.strictEqual(g.workoutBuildRows_('W5', { name: 'One off', pieces: piece }).rows[0].Saved, 'No');
  assert.strictEqual(g.workoutBuildRows_('W5', { name: 'One off', pieces: piece, keep: true }).rows[0].Saved, 'Yes');
  const kept = g.workoutBuildRows_('W5', { name: 'Kept', pieces: piece, keep: true }).rows;
  const once = g.workoutBuildRows_('W6', { name: 'Once', pieces: piece }).rows;
  const once2 = g.workoutBuildRows_('W8', { name: 'Once', pieces: piece, keep: true }).rows;
  assert.strictEqual(g.workoutFindSame_(once, once2), 'W6', 'Saved does not make a workout different');
  const old = lib.map(w => Object.assign({}, w));
  const lv = J(g.workoutListView_(kept.concat(once, old), [{ Date: '2026-11-20', Squad: 'All', Session: 'Practice', 'Workout ID': 'W6', Published: true }], '2026-11-12'));
  assert.deepStrictEqual(lv.library.map(w => [w.id, w.saved]).sort(), [['W1', true], ['W5', true], ['W6', false]], 'old rows count as saved; a used one-off is listed but not saved');
  const lv2 = J(g.workoutListView_(kept.concat(once, old), [], '2026-11-12'));
  assert.deepStrictEqual(lv2.library.map(w => w.id).sort(), ['W1', 'W5'], 'an unused one-off is hidden');
  assert.strictEqual(g.workoutIsOneOff_(once, 'W6'), true);
  assert.strictEqual(g.workoutIsOneOff_(old, 'W1'), false);
  assert.strictEqual(g.WORKOUT_UNSAVE_ACTION, 'workout-unsave');
});

test('plan check: under half of the planned work is Not done, marked Missed (David, 2026-11-18)', () => {
  const s = planSettings();
  const W = [{ 'Workout ID': 'X4', Name: '4 x 15:00', 'Piece #': 1, Reps: 4, 'Work type': 'Time', Work: '15:00', Rest: '1:30', Zone: 'Aerobic' }];
  const x4 = g.workoutPieces(W, 'X4');
  const iv = (n, sec) => ({ 'Interval #': n, 'Work s': sec, 'Work m': Math.round(sec * 4) });
  // Launch day: one 20:07 piece against 4 x 15:00 is 34% of the planned time.
  let c = g.checkAgainstPlan([iv(1, 1207)], x4, {}, s);
  assert.strictEqual(c.notDone, true); assert.strictEqual(c.matches, false);
  assert.strictEqual(g.planFlag({ Status: 'Full' }, c).length > 0, true);
  // Exactly half is not under half; 3 of 4 pieces and a cut-short last piece stay Modified.
  assert.strictEqual(g.checkAgainstPlan([iv(1, 900), iv(2, 900)], x4, {}, s).notDone, false);
  assert.strictEqual(g.checkAgainstPlan([iv(1, 900), iv(2, 900), iv(3, 900)], x4, {}, s).notDone, false);
  assert.strictEqual(g.checkAgainstPlan([iv(1, 900), iv(2, 899)], x4, {}, s).notDone, true, '1799 s of 3600 is under half');
  assert.strictEqual(g.checkAgainstPlan([iv(1, 900), iv(2, 800)], x4, {}, s).notDone, true, '1700 s of 3600');
  assert.strictEqual(g.checkAgainstPlan([iv(1, 900), iv(2, 900), iv(3, 900), iv(4, 900)], x4, {}, s).notDone, false);
  // A distance plan counts meters.
  const D = g.workoutPieces([{ 'Workout ID': 'XD', Name: '4 x 1000m', 'Piece #': 1, Reps: 4, 'Work type': 'Distance', Work: '1000', Rest: '2:00', Zone: 'Aerobic' }], 'XD');
  assert.strictEqual(g.checkAgainstPlan([{ 'Interval #': 1, 'Work s': 240, 'Work m': 1000 }], D, {}, s).notDone, true);
  assert.strictEqual(g.checkAgainstPlan([{ 'Interval #': 1, 'Work s': 480, 'Work m': 1000 }, { 'Interval #': 2, 'Work s': 480, 'Work m': 1000 }], D, {}, s).notDone, false);
  // The marks and the buttons.
  const plain = (x) => JSON.parse(JSON.stringify(x));
  assert.deepStrictEqual(plain(g.planFlagAutoSet_({ Status: 'Full', 'Review status': '' }, true)), { Status: 'Missed', 'Review status': 'Auto Modified' });
  assert.deepStrictEqual(plain(g.planFlagAutoSet_({ Status: 'Full', 'Review status': '' }, false)), { Status: 'Modified', 'Review status': 'Auto Modified' });
  const auto = { 'Entry ID': 'E1', Status: 'Missed', 'Review status': 'Auto Modified' };
  assert.deepStrictEqual(plain(g.decidePlanFlagAction(auto, 'confirm', 'U1', ['U1'])), { status: 'ok', mark: 'Missed', set: { 'Review status': 'Reviewed, Missed' } });
  assert.deepStrictEqual(plain(g.decidePlanFlagAction(auto, 'full', 'U1', ['U1'])), { status: 'ok', set: { Status: 'Full', 'Review status': 'Reviewed, Full' } });
  const msg = g.planFlagMessage({ athlete: 'Fake Athlete', date: new Date(2026, 10, 18), sessionType: 'Practice', flag: 'x', entryIds: ['E1'], missedIds: ['E1'], detail: '' }, 'https://sheet.example');
  assert.match(msg.text, /Marked Missed/); assert.strictEqual(msg.blocks[1].elements[0].text.text, 'Confirm Missed');
  const mixed = g.planFlagMessage({ athlete: 'Fake Athlete', date: new Date(2026, 10, 18), sessionType: 'Practice', flag: 'x', entryIds: ['E1', 'E2'], missedIds: ['E1'], detail: '' }, 'https://sheet.example');
  assert.match(mixed.text, /Marked Modified/); assert.strictEqual(mixed.blocks[1].elements[0].text.text, 'Confirm Modified');
  // A Missed practice entry is not a practice done: it never covers a make-up window.
  const pr = [{ date: '2026-11-17', squad: 'Girls', canceled: false }];
  assert.deepStrictEqual(plain(g.openMakeups_('Varsity', '2026-11-18', pr, [{ date: '2026-11-17', type: 'Practice', status: 'Missed', makeupFor: '' }])), ['2026-11-17']);
  assert.deepStrictEqual(plain(g.openMakeups_('Varsity', '2026-11-18', pr, [{ date: '2026-11-17', type: 'Practice', status: 'Modified', makeupFor: '' }])), []);
});

test('attendance override: plan for one athlete and day (David, 2026-11-18)', () => {
  const day = (d) => d;
  const plain = (x) => JSON.parse(JSON.stringify(x));
  const E = (id, ath, date, type, review = '') => ({ 'Entry ID': id, 'Athlete ID': ath, 'Session type': type, Date: date, 'Review status': review });
  const entries = [E('E1', 'A1', '2026-11-18', 'Practice'), E('E2', 'A1', '2026-11-18', 'OYO'), E('E3', 'A1', '2026-11-18', 'Practice', 'REJECTED'), E('E4', 'A2', '2026-11-18', 'Practice'), E('E5', 'A1', '2026-11-18', 'Make-up')];
  assert.deepStrictEqual(plain(g.attendanceMarkPlan_(entries, 'A1', '2026-11-18', 'Full', day)), { update: ['E1'], create: false, nothing: false }, 'only her Practice entries, never OYO, rejected or make-up rows');
  assert.deepStrictEqual(plain(g.attendanceMarkPlan_(entries, 'A3', '2026-11-18', 'Full', day)), { update: [], create: true, nothing: false }, 'novices with no entry get one');
  assert.deepStrictEqual(plain(g.attendanceMarkPlan_(entries, 'A3', '2026-11-18', 'Modified', day)), { update: [], create: true, nothing: false });
  assert.deepStrictEqual(plain(g.attendanceMarkPlan_(entries, 'A3', '2026-11-18', 'Missed', day)), { update: [], create: false, nothing: true }, 'no entry already reads as missed');
  assert.deepStrictEqual(plain(g.attendanceMarkPlan_(entries, 'A1', '2026-11-19', 'Full', day)), { update: [], create: true, nothing: false }, 'another day');
  assert.strictEqual(g.ATTENDANCE_MARK_ACTION, 'attendance-mark');
  assert.deepStrictEqual(plain(g.ATTENDANCE_MARKS), { Full: 'Full', Modified: 'Modified', Missed: 'Missed' });
});

console.log(`${passed} tests passed`);
