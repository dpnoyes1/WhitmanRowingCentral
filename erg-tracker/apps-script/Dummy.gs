/**
 * Fake squad for exploring the tracker before real setup (David 2026-10-23).
 * 30 made-up athletes (12 novices in 7th-9th, 18 varsity in 10th-12th), three
 * weeks of practices (Oct 5-23 2026), OYO, make-ups, weights, a published
 * plan, and three rounds of 2k and 20' tests about a month apart. Not every
 * athlete improves every round.
 *
 * buildDummyData() is pure and seeded, so the same data comes back every run.
 * Every row it makes is marked so "Clear dummy data" removes only those rows:
 *   Roster Notes and Weights Note start with "DUMMY", Entries and Benchmarks
 *   have Source = Dummy, Entry/Benchmark IDs contain "-DUMMY-", Workout IDs
 *   start with "DUMMY-", Practices Notes = DUMMY. Athlete IDs are A901-A930.
 */

var DUMMY = {
  MARK: 'DUMMY',
  SOURCE: 'Dummy',
  WORKOUT_PREFIX: 'DUMMY-',
  FIRST_ID: 901,
  SEED: 20261023,
  // Practice weeks, plus one planned-only week so "Preview week ahead" has something.
  PRACTICE_START: [2026, 9, 5],
  PRACTICE_END: [2026, 9, 23],
  PLAN_END: [2026, 9, 30],
  // Test rounds: [20' date, 2k date]. Months are 0-based (7 = August).
  ROUNDS: [[[2026, 7, 24], [2026, 7, 27]], [[2026, 8, 21], [2026, 8, 24]], [[2026, 9, 19], [2026, 9, 22]]]
};

// Grad years for school year 2026-27 (12th grade = class of 2027).
var DUMMY_GRAD = { '7th': 2032, '8th': 2031, '9th': 2030, '10th': 2029, '11th': 2028, '12th': 2027 };

// [name, grade, special]. Made-up names; any match to a real person is chance.
var DUMMY_ATHLETES = [
  ['Maya Brennan', '7th', 'lateJoiner'], ['Chloe Albright', '7th', ''], ['Nora Castellano', '7th', ''],
  ['Ruby Okafor', '7th', ''],
  ['Lily Hartwell', '8th', 'lateJoiner'], ['Ella Marchetti', '8th', 'lowAttendance'], ['Zoe Kaplan', '8th', ''],
  ['Ivy Sandoval', '8th', ''],
  ['Hazel Whitcomb', '9th', 'noTests'], ['Grace Lindqvist', '9th', ''], ['Sadie Moreau', '9th', ''],
  ['Leah Prescott', '9th', ''],
  ['Avery Callahan', '10th', ''], ['Harper Delgado', '10th', 'lowAttendance'], ['Quinn Ashby', '10th', ''],
  ['Elena Vasquez', '10th', ''], ['Clara Jennings', '10th', ''], ['Margot Feld', '10th', ''],
  ['Julia Thornton', '11th', 'injured'], ['Sophie Nakamura', '11th', 'standout'], ['Tessa Radcliffe', '11th', ''],
  ['Annika Holm', '11th', ''], ['Brooke Ellison', '11th', ''], ['Camila Ortiz', '11th', ''],
  ['Lauren Whitaker', '12th', 'standout'], ['Natalie Szabo', '12th', ''], ['Olivia Grant', '12th', ''],
  ['Mia Fairbanks', '12th', ''], ['Eva Pemberton', '12th', ''], ['Charlotte Reyes', '12th', '']
];

// Workout library: [id, name, pieces]. Piece: [reps, type, work, rest, startEvery, zone, rate].
var DUMMY_WORKOUTS = [
  ['W01', "Steady 3 x 20'", [[3, 'Time', '20:00', '3:00', '', 'UT2', '18-20']]],
  ['W02', "Novice steady 3 x 12'", [[3, 'Time', '12:00', '3:00', '', 'UT2', '20']]],
  ['W03', "4 x 10' UT1", [[4, 'Time', '10:00', '2:00', '', 'UT1', '22']]],
  ['W04', 'Variable intervals', [[1, 'Distance', '2000', '8:00', '', 'AN', ''], [1, 'Distance', '1500', '6:00', '', 'AN', ''],
    [1, 'Distance', '1000', '4:00', '', 'AN', ''], [1, 'Distance', '500', '2:00', '', 'AN', ''], [1, 'Distance', '250', '', '', 'AN', '']]],
  ['W05', '8 x 500m start every 3:30', [[8, 'Distance', '500', '', '3:30', 'AN', '']]],
  ['W06', '6 x 1000m r3:00', [[6, 'Distance', '1000', '3:00', '', 'AT', '26']]],
  ['W07', '2 x 5000m r5:00', [[2, 'Distance', '5000', '5:00', '', 'UT1', '22']]],
  ['W08', "20' test", [[1, 'Time', '20:00', '', '', 'AT', '']]],
  ['W09', '2k test', [[1, 'Distance', '2000', '', '', 'AN', '']]],
  ['W10', "Novice 4 x 6' r2:00", [[4, 'Time', '6:00', '2:00', '', 'UT1', '22']]]
];

// Weekday plan: [varsity, novice] Workout IDs, Mon..Fri for each week.
var DUMMY_WEEKS = [
  [['W01', 'W02'], ['W06', 'W10'], ['W03', 'W03'], ['W05', 'W05'], ['W07', 'W02']],
  [['W01', 'W02'], ['W04', 'W10'], ['W03', 'W03'], ['W06', 'W10'], ['W07', 'W02']],
  [['W08', 'W08'], ['W01', 'W02'], ['W10', 'W10'], ['W09', 'W09'], ['W01', 'W02']],
  [['W01', 'W02'], ['W06', 'W10'], ['W03', 'W03'], ['W04', 'W05'], ['W07', 'W02']]
];

var DUMMY_OUT_NOTES = ['Sick', 'Doctor appointment', 'Family trip', 'Concert rehearsal', 'Big test tomorrow', 'Migraine'];
var DUMMY_MODIFIED_NOTES = ['Sore back, did BikeErg', 'Blister on hand, BikeErg instead', 'Tight hip, coach said bike'];

/** Small seeded random generator (mulberry32). */
function dummyRng_(seed) {
  var a = seed >>> 0;
  var next = function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next: next,
    range: function (lo, hi) { return lo + (hi - lo) * next(); },
    int: function (lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); },
    pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
    chance: function (p) { return next() < p; }
  };
}

function dummyDate_(ymd, hours, minutes) {
  return new Date(ymd[0], ymd[1], ymd[2], hours || 0, minutes || 0);
}

function addDays_(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Interval rows for one workout done at baseWatts (season-best 2k watts). */
function dummyIntervals_(rng, pieces, baseWatts, settings, effort, bike) {
  var out = [];
  pieces.forEach(function (p) {
    var pct = pieceTargetPct(p, settings) || { low: 70, high: 70 };
    for (var r = 0; r < p.reps; r++) {
      var mid = (pct.low + pct.high) / 2 / 100;
      var watts = baseWatts * mid * effort * rng.range(0.975, 1.025) * (1 - 0.006 * r);
      var split = splitFromWatts(watts);
      var workS = p.workType === 'Time' ? p.workS : roundTenths_(p.workM / 500 * split);
      var workM = p.workType === 'Time' ? Math.round(p.workS / split * 500) : p.workM;
      var restS = p.startEveryS ? roundTenths_(Math.max(p.startEveryS - workS, 30)) : p.restS || '';
      var rateMid = { UT2: 19, UT1: 21, AT: 25, AN: 30 }[p.zone] || 20;
      out.push({
        'Work s': workS,
        'Work m': bike ? Math.round(workM * 2.1) : workM,
        'Avg rate': bike ? '' : rateMid + rng.int(-1, 2),
        'Rest s': restS,
        'Rest m': restS && !bike ? Math.round(restS * 0.5 / 165 * 500) : ''
      });
    }
  });
  if (out.length) { out[out.length - 1]['Rest s'] = ''; out[out.length - 1]['Rest m'] = ''; }
  return out;
}

var DUMMY_OYO_ACTIVITIES = {
  'Erg (RowErg)': function (rng, min) { return Math.round(min * 60 / rng.range(128, 150) * 500); },
  'SkiErg': function (rng, min) { return Math.round(min * 60 / rng.range(140, 165) * 500); },
  'Run': function (rng, min) { return Math.round(min / rng.range(5.4, 6.8) * 1000); },
  'Bike': function (rng, min) { return Math.round(min * rng.range(260, 360)); },
  'BikeErg': function (rng, min) { return Math.round(min * rng.range(380, 460)); },
  'Swim': function (rng, min) { return Math.round(min * rng.range(28, 40)); },
  'Elliptical': function () { return ''; },
  'Stair stepper': function () { return ''; },
  'Hike': function (rng, min) { return Math.round(min * rng.range(55, 75)); },
  'Walk': function (rng, min) { return Math.round(min * rng.range(80, 100)); },
  'Lifting': function () { return ''; }
};

/**
 * Pure: every dummy row, keyed by tab name.
 * opts: { settings } (Settings values, e.g. getSettings() or the defaults).
 */
function buildDummyData(opts) {
  var settings = opts.settings;
  var rng = dummyRng_(DUMMY.SEED);
  var coaches = String(settings.coaches || 'Coach David').split(',').map(function (s) { return s.trim(); }).filter(String);
  var mult = {};
  ACTIVITIES.forEach(function (a) { mult[a[0]] = Number(settings['multiplier.' + a[0]] || a[1]); });
  var seq = { E: 0, B: 0 };
  var id = function (p) { seq[p] += 1; return p + '-DUMMY-' + ('000' + seq[p]).slice(-4); };
  var data = { roster: [], weights: [], practices: [], workouts: [], schedule: [], entries: [], intervals: [], benchmarks: [] };

  // Workouts and the parsed pieces used to log them.
  DUMMY_WORKOUTS.forEach(function (w) {
    w[2].forEach(function (p, i) {
      data.workouts.push({
        'Workout ID': DUMMY.WORKOUT_PREFIX + w[0], 'Name': w[1], 'Piece #': i + 1, 'Reps': p[0],
        'Work type': p[1], 'Work': p[2], 'Rest': p[3], 'Start every': p[4], 'Activity': 'Erg (RowErg)',
        'Zone': p[5], 'Base': '', 'Target low %': '', 'Target high %': '', 'Rate': p[6],
        'Notes': /test/.test(w[1]) ? 'Benchmark test day' : ''
      });
    });
  });
  var pieces = {};
  DUMMY_WORKOUTS.forEach(function (w) { pieces[w[0]] = workoutPieces(data.workouts, DUMMY.WORKOUT_PREFIX + w[0]); });

  // Practices and Schedule, Mon-Fri.
  var planStart = dummyDate_(DUMMY.PRACTICE_START);
  var practiceEnd = dummyDate_(DUMMY.PRACTICE_END);
  var planEnd = dummyDate_(DUMMY.PLAN_END);
  var dayPlan = {};
  practiceDays(planStart, planEnd, settings).forEach(function (p) {
    var dayIndex = Math.round((p.Date - planStart) / 864e5);
    var week = DUMMY_WEEKS[Math.floor(dayIndex / 7)];
    var ids = week && week[p.Date.getDay() - 1];
    if (!ids) return;
    dayPlan[dayKey_(p.Date)] = { date: p.Date, Varsity: ids[0], Novice: ids[1] };
    var name = DUMMY_WORKOUTS.filter(function (w) { return w[0] === ids[0]; })[0][1];
    p['Planned workout'] = ids[0] === ids[1] ? name : name + ' (novices: ' +
      DUMMY_WORKOUTS.filter(function (w) { return w[0] === ids[1]; })[0][1] + ')';
    p.Notes = DUMMY.MARK;
    data.practices.push(p);
    var squads = ids[0] === ids[1] ? [['All', ids[0]]] : [['Varsity', ids[0]], ['Novice', ids[1]]];
    squads.forEach(function (sq) {
      data.schedule.push({ 'Date': p.Date, 'Squad': sq[0], 'Session': 'Practice',
        'Workout ID': DUMMY.WORKOUT_PREFIX + sq[1], 'Published': true, 'Notes': '' });
    });
  });

  // Earlier test days (before the practice weeks) still get a plan row.
  DUMMY.ROUNDS.forEach(function (round) {
    [[round[0], 'W08'], [round[1], 'W09']].forEach(function (t) {
      var d = dummyDate_(t[0]);
      if (dayPlan[dayKey_(d)]) return;
      data.schedule.push({ 'Date': d, 'Squad': 'All', 'Session': 'Practice',
        'Workout ID': DUMMY.WORKOUT_PREFIX + t[1], 'Published': true, 'Notes': '' });
    });
  });
  data.schedule.sort(function (x, y) { return x.Date - y.Date; });

  // Athletes: profile, fitness, habits.
  var grades = ['7th', '8th', '9th', '10th', '11th', '12th'];
  var base2k = { '7th': 565, '8th': 545, '9th': 520, '10th': 492, '11th': 480, '12th': 470 };
  var trajectories = ['steady', 'steady', 'steady', 'steady', 'plateau', 'dip', 'late', 'slump'];
  var athletes = DUMMY_ATHLETES.map(function (a, i) {
    var grade = a[1];
    var novice = grades.indexOf(grade) < 3;
    var gradYear = DUMMY_GRAD[grade];
    // Born between Sep of (grad - 19) and Aug of (grad - 18).
    var birthday = new Date(gradYear - 19, 8, 1 + rng.int(0, 360));
    var special = a[2];
    var oyo = special === 'lowAttendance' || rng.chance(0.12) ? 'low' : rng.chance(0.25) ? 'elite' : 'meets';
    return {
      id: 'A' + (DUMMY.FIRST_ID + i), name: a[0], grade: grade, gradYear: gradYear, birthday: birthday,
      squad: novice ? 'Novice' : 'Varsity', special: special, novice: novice,
      start2k: special === 'standout' ? rng.range(443, 455) : base2k[grade] + rng.range(-14, 14),
      gain: novice ? rng.range(7, 17) : rng.range(1, 5.5),
      trajectory: special === 'standout' ? 'steady' : trajectories[i % trajectories.length],
      offset20: rng.range(6.5, 11),
      weight: novice ? rng.range(98, 150) : rng.range(122, 172),
      attend: special === 'lowAttendance' ? rng.range(0.62, 0.72) : rng.range(0.88, 0.98),
      effort: rng.range(0.96, 1.05),
      drag: rng.chance(0.1) ? rng.pick([115, 120, 125]) : 105,
      hr: rng.chance(0.4),
      oyo: oyo,
      favorites: [rng.pick(['Run', 'Erg (RowErg)', 'Bike']), rng.pick(['Run', 'Swim', 'Elliptical', 'SkiErg', 'BikeErg']),
        rng.pick(['Walk', 'Hike', 'Stair stepper', 'Erg (RowErg)', 'Lifting'])],
      joined: special === 'noTests' ? dummyDate_([2026, 9, 12]) : special === 'lateJoiner' ? dummyDate_([2026, 8, 1]) : null
    };
  });
  // Top varsity use the Performance OYO group; one has a personal override.
  var perf = athletes.filter(function (a) { return !a.novice; })
    .sort(function (x, y) { return x.start2k - y.start2k; }).slice(0, 5);
  perf.forEach(function (a) { a.oyoGroup = 'Performance'; });
  perf[4].oyoOverride = [100, 200];

  athletes.forEach(function (a) {
    var notes = { lateJoiner: 'joined in September', noTests: 'joined Oct 12, not tested yet',
      injured: 'concussion Oct 12, cleared Oct 20', lowAttendance: 'often misses practice' }[a.special];
    data.roster.push({
      'Athlete ID': a.id, 'Name': a.name, 'Slack member ID': '', 'Squad': a.squad, 'Role': 'Rower',
      'OYO group': a.oyoGroup || 'Standard',
      'OYO required min': a.oyoOverride ? a.oyoOverride[0] : '', 'OYO elite min': a.oyoOverride ? a.oyoOverride[1] : '',
      'Active': 'Yes', 'Notes': DUMMY.MARK + (notes ? ': ' + notes : ''),
      'Birthday': a.birthday, 'Grad year': a.gradYear
    });
  });

  var submittedAt = function (d, late) {
    var day = late ? addDays_(d, 1) : d;
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), late ? rng.int(7, 21) : rng.int(19, 22), rng.int(0, 59));
  };
  var enteredBy = function (a) { return rng.chance(0.92) ? a.name : rng.pick(coaches); };
  var rpe = function (zone) { return { UT2: rng.int(3, 5), UT1: rng.int(5, 6), AT: rng.int(7, 8), AN: rng.int(8, 9) }[zone] || 5; };
  var hr = function (a, zone) {
    if (!a.hr) return '';
    var lo = { UT2: 142, UT1: 154, AT: 168, AN: 180 }[zone] || 140;
    return lo + rng.int(0, 10);
  };

  /** Writes one Entries row and its Intervals. */
  var addEntry = function (e, ivs) {
    var entryId = id('E');
    var sum = function (k) { return roundTenths_(ivs.reduce(function (s, iv) { return s + (Number(iv[k]) || 0); }, 0)); };
    var row = Object.assign({
      'Entry ID': entryId, 'Submitted at': '', 'Date': '', 'Athlete ID': '', 'Athlete': '', 'Entered by': '',
      'Session type': '', 'Make-up for date': '', 'Status': '', 'Activity': '', 'Warmup s': '', 'Work s': '',
      'Rest s': '', 'Cooldown s': '', 'Work m': '', 'Rest m': '', 'Main set': '', 'Zone': '', 'RPE': '',
      'Avg HR': '', 'Drag factor': '', 'Intervals': '', 'Coach note': '', 'Source': DUMMY.SOURCE,
      'Review status': '', 'Response ID': '', 'Benchmark ID': ''
    }, e);
    if (ivs.length) {
      Object.assign(row, { 'Work s': sum('Work s'), 'Rest s': sum('Rest s'), 'Work m': sum('Work m'),
        'Rest m': sum('Rest m'), 'Intervals': ivs.length });
    }
    data.entries.push(row);
    ivs.forEach(function (iv, i) {
      data.intervals.push(Object.assign({ 'Entry ID': entryId, 'Interval #': i + 1 }, iv));
    });
    return row;
  };

  // Benchmark rounds. True 2k time per round follows the athlete's trajectory.
  var roundTime = function (a, r) {
    var g = a.gain;
    var steps = { steady: [0, g, 2 * g], plateau: [0, g, g + rng.range(-1.5, 1)], dip: [0, -rng.range(2, 6), g * 1.6],
      late: [0, rng.range(-1, 1), g * 1.8], slump: [0, g, g - rng.range(2, 5)] }[a.trajectory];
    return a.start2k - steps[r];
  };
  var testSession = function (a, date, test, result2k, weightToday) {
    var timed = test === '2000m';
    var split2k = result2k / 4;
    var split20 = split2k + a.offset20 + rng.range(-1.5, 1.5);
    var meters = Math.round(1200 * 500 / split20);
    var splits = '';
    var timeS = '';
    if (timed) {
      var s = [split2k - rng.range(0.5, 2.5), split2k + rng.range(0.3, 1.5), split2k + rng.range(0.5, 2)];
      s = s.map(roundTenths_);
      s.push(roundTenths_(result2k - s[0] - s[1] - s[2]));
      timeS = roundTenths_(s[0] + s[1] + s[2] + s[3]);
      splits = s.join(',');
    }
    var benchId = id('B');
    var by = rng.pick(coaches);
    var at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 18, rng.int(0, 59));
    var rate = timed ? (a.novice ? rng.int(26, 30) : rng.int(29, 33)) : (a.novice ? rng.int(22, 25) : rng.int(23, 26));
    var entry = addEntry({
      'Submitted at': at, 'Date': date, 'Athlete ID': a.id, 'Athlete': a.name, 'Entered by': by,
      'Session type': 'Practice', 'Status': 'Full', 'Activity': 'Erg (RowErg)', 'Warmup s': rng.pick([900, 1200]),
      'Cooldown s': 600, 'Main set': (timed ? '2000m' : '20min') + ' test', 'Zone': timed ? 'AN' : 'AT',
      'RPE': rng.int(9, 10), 'Avg HR': a.hr ? rng.int(186, 198) : '', 'Drag factor': a.drag, 'Benchmark ID': benchId
    }, [{ 'Work s': timed ? timeS : 1200, 'Work m': timed ? 2000 : meters, 'Avg rate': rate, 'Rest s': '', 'Rest m': '' }]);
    data.benchmarks.push({
      'Benchmark ID': benchId, 'Submitted at': at, 'Date': date, 'Athlete ID': a.id, 'Athlete': a.name,
      'Entered by': by, 'Test': timed ? '2000m' : '20min', 'Time s': timeS, 'Meters': timed ? '' : meters,
      'Avg rate': rate, 'Drag factor': a.drag, 'Splits s': splits, 'Coach note': '', 'Source': DUMMY.SOURCE,
      'Review status': '', 'Response ID': '', 'Entry ID': entry['Entry ID']
    });
  };

  athletes.forEach(function (a) {
    if (a.special === 'noTests') return;
    DUMMY.ROUNDS.forEach(function (round, r) {
      var d20 = dummyDate_(round[0]);
      var d2k = dummyDate_(round[1]);
      if (a.joined && a.joined > d20) return;
      a.weight += r === 0 ? 0 : rng.range(-2, a.novice ? 3 : 2);
      data.weights.push({ 'Date': d20, 'Athlete ID': a.id, 'Athlete': a.name, 'Weight lb': Math.round(a.weight),
        'Entered by': rng.pick(coaches), 'Note': DUMMY.MARK });
      if (a.special === 'injured' && r === 2) return;   // out on 20' day, ramp-back week on 2k day
      var t = roundTime(a, r);
      if (!rng.chance(0.04)) testSession(a, d20, '20min', t + rng.range(-1, 1));
      if (!rng.chance(0.04)) testSession(a, d2k, '2000m', t + rng.range(-1.5, 1.5));
    });
  });

  // Practices, make-ups and OYO.
  var yearStart = settings.school_year_start || '07-01';
  var watts2k = function (a, date) {
    var best = seasonBestWatts(data.benchmarks, a.id, '2k', date, yearStart);
    return best ? best.watts : wattsFromSplit(a.start2k / 4);
  };
  var days = Object.keys(dayPlan).sort().map(function (k) { return dayPlan[k]; })
    .filter(function (p) { return p.date <= practiceEnd; });
  var injuredOut = [dummyDate_([2026, 9, 12]), dummyDate_([2026, 9, 19])];
  var testDays = {};
  DUMMY.ROUNDS[2].forEach(function (d) { testDays[dayKey_(dummyDate_(d))] = true; });

  athletes.forEach(function (a) {
    var missed = [];
    days.forEach(function (p) {
      if (a.joined && p.date < a.joined) return;
      if (testDays[dayKey_(p.date)] && a.special !== 'injured' && a.special !== 'noTests') return;   // logged above
      var wid = p[a.squad];
      var base = { 'Date': p.date, 'Athlete ID': a.id, 'Athlete': a.name, 'Session type': 'Practice' };
      var injured = a.special === 'injured' && p.date >= injuredOut[0] && p.date <= injuredOut[1];
      if (injured || (!testDays[dayKey_(p.date)] && !rng.chance(a.attend))) {
        if (!injured && rng.chance(0.35)) { missed.push(p); return; }   // missed and never logged it
        addEntry(Object.assign(base, { 'Submitted at': submittedAt(p.date, false), 'Entered by': enteredBy(a),
          'Status': 'Out', 'Coach note': injured ? 'Concussion protocol' : rng.pick(DUMMY_OUT_NOTES) }), []);
        if (!injured) missed.push(p);
        return;
      }
      var ramp = a.special === 'injured' && p.date > injuredOut[1] && p.date < dummyDate_([2026, 9, 23]);
      var newRower = a.special === 'noTests' && testDays[dayKey_(p.date)];
      var modified = ramp || rng.chance(0.04);
      var ps = newRower ? workoutPieces([{ 'Workout ID': 'x', 'Piece #': 1, 'Reps': 2, 'Work type': 'Time', 'Work': '10:00',
        'Rest': '2:00', 'Zone': 'UT2' }], 'x') : ramp && /W0[89]/.test(wid) ? pieces.W02 : pieces[wid.replace(DUMMY.WORKOUT_PREFIX, '')];
      var bike = modified && !newRower;
      var ivs = dummyIntervals_(rng, ps, watts2k(a, p.date), settings, a.effort, bike);
      addEntry(Object.assign(base, {
        'Submitted at': submittedAt(p.date, rng.chance(0.1)), 'Entered by': enteredBy(a),
        'Status': modified || newRower ? 'Modified' : 'Full', 'Activity': bike ? 'BikeErg' : 'Erg (RowErg)',
        'Warmup s': rng.chance(0.85) ? 900 : rng.pick([600, 1200]), 'Cooldown s': rng.pick([300, 300, 600]),
        'Main set': ps.map(pieceLabel).join(', '), 'Zone': ps[0].zone, 'RPE': rpe(ps[0].zone) + (bike ? -1 : 0),
        'Avg HR': hr(a, ps[0].zone), 'Drag factor': bike ? '' : a.drag,
        'Coach note': ramp ? 'Ramp-back week' : newRower ? 'New rower: technique steady state instead of the test'
          : bike ? rng.pick(DUMMY_MODIFIED_NOTES) : ''
      }), ivs);
    });
    // Make-ups: about half of misses, on the next weekend day within 7 days.
    missed.forEach(function (p) {
      var wid = p[a.squad].replace(DUMMY.WORKOUT_PREFIX, '');
      if (/W0[89]/.test(wid) || !rng.chance(0.5)) return;
      var sat = addDays_(p.date, 6 - p.date.getDay() + rng.int(0, 1));
      if (sat > practiceEnd) return;
      var ps = pieces[wid];
      addEntry({ 'Date': sat, 'Athlete ID': a.id, 'Athlete': a.name, 'Session type': 'Make-up', 'Make-up for date': p.date,
        'Status': 'Full', 'Submitted at': submittedAt(sat, false), 'Entered by': a.name, 'Activity': 'Erg (RowErg)',
        'Warmup s': 900, 'Cooldown s': 300, 'Main set': ps.map(pieceLabel).join(', '), 'Zone': ps[0].zone,
        'RPE': rpe(ps[0].zone), 'Avg HR': hr(a, ps[0].zone), 'Drag factor': a.drag
      }, dummyIntervals_(rng, ps, watts2k(a, p.date), settings, a.effort, false));
    });
    // OYO: weekly weighted minutes per habit. The last week is only partly done (it is Friday).
    var group = a.oyoGroup === 'Performance' ? [90, 180] : [60, 120];
    if (a.oyoOverride) group = a.oyoOverride;
    for (var w = 0; w < 3; w++) {
      var mon = addDays_(planStart, 7 * w);
      if (a.joined && mon < addDays_(a.joined, -6)) continue;
      var goal = { low: rng.range(0.15, 0.85), meets: rng.range(1.0, 1.6), elite: rng.range(1.0, 1.35) * 2 }[a.oyo] * group[0];
      if (a.special === 'injured' && w === 1) goal = 0;
      if (w === 2) goal *= rng.range(0.3, 0.7);
      var openDays = w === 2 ? [1, 2, 3, 4] : [6, 0, 6, 0, 1, 2, 3, 4, 5];
      var done = 0;
      var guard = 0;
      while (done < goal && guard++ < 12) {
        var dow = rng.pick(openDays);   // 0 Sun .. 6 Sat; weekends twice as likely, last week Mon-Thu only
        var date = addDays_(mon, (dow + 6) % 7);
        if (date > practiceEnd) continue;
        var act = rng.chance(0.75) ? rng.pick(a.favorites) : rng.pick(Object.keys(DUMMY_OYO_ACTIVITIES));
        var minutes = act === 'Walk' || act === 'Hike' ? rng.int(30, 75) : rng.int(20, 55);
        var two = act === 'Erg (RowErg)' && rng.chance(0.4);
        var each = two ? Math.round(minutes / 2) : minutes;
        var ivs = (two ? [1, 2] : [1]).map(function (n, i, arr) {
          return { 'Work s': each * 60, 'Work m': DUMMY_OYO_ACTIVITIES[act](rng, each),
            'Avg rate': /Erg \(RowErg\)|SkiErg/.test(act) ? rng.int(18, 22) : '',
            'Rest s': arr.length > 1 && i === 0 ? 120 : '', 'Rest m': '' };
        });
        var zone = act === 'Lifting' ? 'AN' : act === 'Run' && rng.chance(0.3) ? 'UT1' : 'UT2';
        var label = act === 'Erg (RowErg)' ? 'erg' : act.toLowerCase();
        addEntry({ 'Date': date, 'Athlete ID': a.id, 'Athlete': a.name, 'Session type': 'OYO',
          'Submitted at': submittedAt(date, rng.chance(0.15)), 'Entered by': a.name, 'Activity': act,
          'Warmup s': /Walk|Hike|Lifting/.test(act) ? 0 : 300, 'Cooldown s': 0,
          'Main set': (two ? '2 x ' + each + "'" + " r2'" : minutes + "'") + ' ' + label, 'Zone': zone,
          'RPE': act === 'Walk' ? rng.int(2, 3) : rpe(zone), 'Avg HR': hr(a, zone),
          'Drag factor': /Erg \(RowErg\)/.test(act) ? a.drag : ''
        }, ivs);
        done += minutes * (mult[act] || 0);
      }
    }
  });

  data.entries.sort(function (x, y) { return x['Submitted at'] - y['Submitted at']; });
  data.benchmarks.sort(function (x, y) { return x['Submitted at'] - y['Submitted at']; });
  return data;
}

/** True for a row this generator made, on any tab. */
function isDummyRow_(tabName, row) {
  var has = function (v, re) { return re.test(String(v === undefined || v === null ? '' : v)); };
  if (tabName === TABS.ROSTER) return has(row.Notes, /^DUMMY/);
  if (tabName === TABS.WEIGHTS) return has(row.Note, /^DUMMY/);
  if (tabName === TABS.ENTRIES || tabName === TABS.BENCHMARKS) {
    return has(row.Source, /^Dummy$/) || has(row['Entry ID'], /-DUMMY-/) || has(row['Benchmark ID'], /-DUMMY-/);
  }
  if (tabName === TABS.INTERVALS) return has(row['Entry ID'], /-DUMMY-/);
  if (tabName === TABS.PRACTICES) return has(row.Notes, /^DUMMY$/);
  if (tabName === TABS.WORKOUTS || tabName === TABS.SCHEDULE) return has(row['Workout ID'], /^DUMMY-/);
  return false;
}

var DUMMY_TABS = [TABS.ROSTER, TABS.WEIGHTS, TABS.PRACTICES, TABS.WORKOUTS, TABS.SCHEDULE,
  TABS.BENCHMARKS, TABS.ENTRIES, TABS.INTERVALS];

/** Columns this code may write: everything left of the first computed column. */
function writableWidth_(tabName) {
  var computed = COMPUTED_COLUMNS[tabName] || {};
  var h = HEADERS[tabName];
  for (var i = 0; i < h.length; i++) if (computed[h[i]]) return i;
  return h.length;
}

function writeRows_(tabName, objs) {
  if (!objs.length) return;
  var width = writableWidth_(tabName);
  var headers = HEADERS[tabName].slice(0, width);
  var rows = objs.map(function (o) {
    return headers.map(function (h) { return o[h] === undefined || o[h] === null ? '' : o[h]; });
  });
  var sheet = tab_(tabName);
  var start = lastDataRow_(sheet, width) + 1;
  var short = start + rows.length - 1 - sheet.getMaxRows();
  if (short > 0) sheet.insertRowsAfter(sheet.getMaxRows(), short);   // new rows keep the formats above
  sheet.getRange(start, 1, rows.length, width).setValues(rows);
}

/** Menu: loads the fake squad. Refuses if dummy rows are already there. */
function loadDummyData() {
  var ui = SpreadsheetApp.getUi();
  if (readObjects_(TABS.ROSTER).some(function (r) { return isDummyRow_(TABS.ROSTER, r); })) {
    ui.alert('Dummy data is already loaded. Run "Clear dummy data" first if you want a fresh copy.');
    return;
  }
  var ok = ui.alert('Load dummy data?', 'Adds 30 made-up athletes with three weeks of practices (Oct 5-23), OYO, ' +
    "weights and three rounds of 2k and 20' tests. Every row is marked DUMMY / Dummy so " +
    '"Clear dummy data" can remove it. Takes about a minute.', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  var data = buildDummyData({ settings: getSettings() });
  writeRows_(TABS.ROSTER, data.roster);
  writeRows_(TABS.WEIGHTS, data.weights);
  writeRows_(TABS.PRACTICES, data.practices);
  writeRows_(TABS.WORKOUTS, data.workouts);
  writeRows_(TABS.SCHEDULE, data.schedule);
  writeRows_(TABS.BENCHMARKS, data.benchmarks);
  writeRows_(TABS.ENTRIES, data.entries);
  writeRows_(TABS.INTERVALS, data.intervals);
  SpreadsheetApp.flush();
  refreshFormDropdowns();
  ui.alert('Loaded ' + data.roster.length + ' athletes, ' + data.entries.length + ' sessions, ' +
    data.intervals.length + ' intervals, ' + data.benchmarks.length + ' tests and ' + data.weights.length + ' weights.\n\n' +
    'Try Preview week ahead (Oct 26) and Check week against plan (Oct 5, 12 or 19).');
}

/** Menu: removes every dummy row from every tab, keeping everything else. */
function clearDummyData() {
  var ui = SpreadsheetApp.getUi();
  var ok = ui.alert('Clear dummy data?', 'Removes every row marked as dummy data from every tab. Other rows stay.',
    ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  var removed = 0;
  DUMMY_TABS.forEach(function (name) {
    var sheet = tab_(name);
    var width = writableWidth_(name);
    var last = lastDataRow_(sheet, width);
    if (last < 2) return;
    var keep = [];
    readObjects_(name).slice(0, last - 1).forEach(function (r) {
      if (isDummyRow_(name, r)) { removed += 1; return; }
      keep.push(HEADERS[name].slice(0, width).map(function (h) { return r[h]; }));
    });
    sheet.getRange(2, 1, last - 1, width).clearContent();
    if (keep.length) sheet.getRange(2, 1, keep.length, width).setValues(keep);
  });
  SpreadsheetApp.flush();
  refreshFormDropdowns();
  ui.alert('Removed ' + removed + ' dummy rows.');
}
