/**
 * Weekly plan: workout library, schedule, per-athlete targets and plan checks.
 * Pure functions only (no Sheet calls) so the Netlify site can port them.
 *
 * Targets come from watts only: a % of the athlete's season-best 2k or 20'
 * watts. Weight is never an input here.
 */

var PLAN_BASES = { '2k': '2000m', "20'": '20min' };
var PLAN_RANGE_ZONES = ['UT2', 'UT1'];   // steady state shows a range; AT/AN a single number

/** Concept2 pace/watts: watts = 2.80 / (sec per meter)^3. */
function wattsFromSplit(split500) {
  if (!split500) return null;
  return 2.80 / Math.pow(split500 / 500, 3);
}

function splitFromWatts(watts) {
  if (!watts) return null;
  return 500 * Math.pow(2.80 / watts, 1 / 3);
}

/** Watts for a 2000m (Time s) or 20min (Meters) benchmark row. */
function benchmarkWatts(test, timeS, meters) {
  if (test === '2000m' && Number(timeS) > 0) return wattsFromSplit(Number(timeS) / 4);
  if (test === '20min' && Number(meters) > 0) return wattsFromSplit(1200 * 500 / Number(meters));
  return null;
}

/** Start of the school year containing `date`. mmdd like "08-01". */
function schoolYearStart(date, mmdd) {
  var p = String(mmdd || '08-01').split('-').map(Number);
  var start = new Date(date.getFullYear(), p[0] - 1, p[1]);
  if (start > date) start = new Date(date.getFullYear() - 1, p[0] - 1, p[1]);
  return start;
}

/**
 * Season-best watts for an athlete on a base ('2k' or "20'") as of `onDate`.
 * Uses this school year's best; if there is none, last school year's best.
 * Rows with a Review status containing "reject" are ignored.
 * Returns { watts, date, test, season: 'current' | 'previous' } or null.
 */
function seasonBestWatts(benchmarks, athleteId, base, onDate, yearStartMMDD) {
  var test = PLAN_BASES[base];
  if (!test) return null;
  var start = schoolYearStart(onDate, yearStartMMDD);
  var prevStart = new Date(start.getFullYear() - 1, start.getMonth(), start.getDate());
  var best = { current: null, previous: null };
  benchmarks.forEach(function (b) {
    if (b['Athlete ID'] !== athleteId || b.Test !== test) return;
    if (/reject/i.test(String(b['Review status'] || ''))) return;
    var d = b.Date;
    if (!isDate_(d) || d > onDate || d < prevStart) return;
    var w = benchmarkWatts(test, b['Time s'], b.Meters);
    if (!w) return;
    var season = d >= start ? 'current' : 'previous';
    if (!best[season] || w > best[season].watts) best[season] = { watts: w, date: d, test: test, season: season };
  });
  return best.current || best.previous;
}

/** Workouts tab rows for one Workout ID, parsed and in Piece # order. Throws on bad rows. */
function workoutPieces(workoutRows, workoutId) {
  return workoutRows
    .filter(function (r) { return String(r['Workout ID']).trim() === String(workoutId).trim(); })
    .sort(function (a, b) { return Number(a['Piece #']) - Number(b['Piece #']); })
    .map(function (r) {
      var where = 'Workout ' + workoutId + ' piece ' + r['Piece #'];
      var type = String(r['Work type']).trim();
      var reps = Number(r.Reps || 1);
      if (!(reps >= 1)) throw new Error(where + ': Reps must be 1 or more');
      var piece = {
        piece: Number(r['Piece #']),
        name: String(r.Name || '').trim(),
        reps: reps,
        workType: type,
        workS: null,
        workM: null,
        // Rest: a time, blank, or "Undefined" (PM5 undefined rest). "Start every"
        // is a common send-off (8 x 500m start every 3:30), so rest varies by athlete.
        restS: /^undef/i.test(String(r.Rest || '').trim()) ? null : (parseTime(r.Rest) || 0),
        restUndefined: /^undef/i.test(String(r.Rest || '').trim()) || !!String(r['Start every'] || '').trim(),
        startEveryS: parseTime(r['Start every']) || null,
        activity: String(r.Activity || 'Erg (RowErg)').trim(),
        zone: String(r.Zone || '').trim(),
        base: String(r.Base || '').trim(),
        lowPct: r['Target low %'] === '' || r['Target low %'] === undefined ? null : Number(r['Target low %']),
        highPct: r['Target high %'] === '' || r['Target high %'] === undefined ? null : Number(r['Target high %']),
        rate: String(r.Rate || '').trim(),
        notes: String(r.Notes || '').trim()
      };
      if (type === 'Time') piece.workS = parseTime(r.Work);
      else if (type === 'Distance') piece.workM = Number(String(r.Work).replace(/\s*m$/i, ''));
      else throw new Error(where + ': Work type must be Time or Distance');
      if (!(piece.workS > 0 || piece.workM > 0)) throw new Error(where + ': Work is missing or not a number');
      return piece;
    });
}

/** "3 x 20:00 r2:00 UT1" style label for one piece row. */
function pieceLabel(p) {
  var work = p.workType === 'Time' ? formatTime(p.workS).replace(/\.0$/, '') : p.workM + 'm';
  var rest = p.startEveryS ? ' start every ' + formatTime(p.startEveryS).replace(/\.0$/, '')
    : p.restUndefined ? ' r undefined'
    : p.restS ? ' r' + formatTime(p.restS).replace(/\.0$/, '') : '';
  var rate = p.rate ? ' @ r' + p.rate : '';
  return (p.reps > 1 ? p.reps + ' x ' : '') + work + rest + (p.zone ? ' ' + p.zone : '') + rate;
}

/**
 * Target % for a piece: the piece's own % if set, else the zone default from
 * Settings (target.<zone>.<2k|20min>, "55-65" or "80"). Returns
 * { base, low, high } or null when the piece has no erg target.
 */
function pieceTargetPct(p, settings) {
  if (p.activity !== 'Erg (RowErg)') return null;
  var base = p.base || settings['target.default_base'] || '2k';
  if (!PLAN_BASES[base]) return null;
  var low = p.lowPct;
  var high = p.highPct;
  if (low === null && high === null) {
    if (!p.zone) return null;
    var def = settings['target.' + p.zone + '.' + PLAN_BASES[base]];
    if (!def) return null;
    var parts = String(def).split('-').map(Number);
    low = parts[0];
    high = parts.length > 1 ? parts[1] : parts[0];
  }
  if (low === null) low = high;
  if (high === null) high = low;
  if (!(low > 0)) return null;
  return { base: base, low: Math.min(low, high), high: Math.max(low, high) };
}

/**
 * Target for one athlete on one piece. baseWatts is their season-best watts on
 * the piece's base. Returns watts and splits (seconds per 500m, slow edge and
 * fast edge), or null if no target applies.
 */
function pieceTarget(p, baseWatts, settings) {
  var pct = pieceTargetPct(p, settings);
  if (!pct || !baseWatts) return null;
  var lowW = Math.round(baseWatts * pct.low / 100);
  var highW = Math.round(baseWatts * pct.high / 100);
  return {
    base: pct.base,
    lowPct: pct.low,
    highPct: pct.high,
    range: lowW !== highW,
    lowW: lowW,
    highW: highW,
    slowSplit: roundTenths_(splitFromWatts(lowW)),
    fastSplit: roundTenths_(splitFromWatts(highW))
  };
}

/** "2:05.3 to 2:00.1 /500m (150-170 W)" or "1:48.2 /500m (220 W)". */
function formatTarget(t) {
  if (!t) return '';
  if (!t.range) return formatTime(t.fastSplit) + ' /500m (' + t.highW + ' W)';
  return formatTime(t.slowSplit) + ' to ' + formatTime(t.fastSplit) + ' /500m (' + t.lowW + '-' + t.highW + ' W)';
}

/** Date check that also works across contexts (Node tests). */
function isDate_(d) {
  return Object.prototype.toString.call(d) === '[object Date]' && !isNaN(d);
}

function dayKey_(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

function squadMatches_(planSquad, athleteSquad) {
  var s = String(planSquad || 'All').trim();
  return s === '' || s === 'All' || s === String(athleteSquad).trim();
}

/**
 * The week ahead: every scheduled session from weekStart for 7 days, with each
 * active rower's targets, plus coach flags for athletes missing a benchmark.
 * opts: { schedule, workouts, roster, benchmarks, settings, weekStart, publishedOnly }
 * roster rows should already be active rowers.
 */
function buildWeekPlan(opts) {
  var s = opts.settings;
  var start = new Date(opts.weekStart.getFullYear(), opts.weekStart.getMonth(), opts.weekStart.getDate());
  var end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  var rows = opts.schedule.filter(function (r) {
    return isDate_(r.Date) && r.Date >= start && r.Date < end && String(r['Workout ID']).trim() !== '' &&
      (!opts.publishedOnly || isActive_(r.Published));
  }).sort(function (a, b) { return a.Date - b.Date; });

  var flags = {};
  var sessions = rows.map(function (r) {
    var pieces = workoutPieces(opts.workouts, r['Workout ID']);
    if (!pieces.length) {
      flags['missing ' + r['Workout ID']] = { athleteId: '', athlete: '', base: '',
        message: 'Workout ' + r['Workout ID'] + ' on ' + dayKey_(r.Date) + ' is not on the Workouts tab' };
    }
    var athletes = opts.roster.filter(function (a) { return squadMatches_(r.Squad, a.Squad); }).map(function (a) {
      var targets = pieces.map(function (p) {
        var pct = pieceTargetPct(p, s);
        if (!pct) return { label: pieceLabel(p), text: '' };
        var best = seasonBestWatts(opts.benchmarks, a['Athlete ID'], pct.base, r.Date, s.school_year_start);
        if (!best) {
          flags[a['Athlete ID'] + pct.base] = { athleteId: a['Athlete ID'], athlete: a.Name, base: pct.base,
            message: 'No ' + pct.base + ' test this season or last; no target shown' };
          return { label: pieceLabel(p), text: '' };
        }
        var t = pieceTarget(p, best.watts, s);
        return { label: pieceLabel(p), text: formatTarget(t), target: t, from: best };
      });
      return { athleteId: a['Athlete ID'], athlete: a.Name, squad: a.Squad, targets: targets };
    });
    return {
      date: r.Date, day: dayKey_(r.Date), squad: r.Squad || 'All', session: r.Session || 'Practice',
      workoutId: String(r['Workout ID']).trim(), name: pieces.length ? pieces[0].name : '',
      notes: r.Notes || '', published: isActive_(r.Published),
      pieces: pieces.map(function (p) { return { label: pieceLabel(p), notes: p.notes, reps: p.reps }; }),
      athletes: athletes
    };
  });
  return { weekStart: start, sessions: sessions, flags: Object.keys(flags).map(function (k) { return flags[k]; }) };
}

/** The Schedule row an entry should be checked against, or null. Make-ups use the missed date's practice. */
function plannedFor(entry, athleteSquad, schedule) {
  var type = entry['Session type'];
  var date = type === 'Make-up' ? entry['Make-up for date'] : entry.Date;
  var session = type === 'OYO' ? 'OYO' : 'Practice';
  if (!isDate_(date)) return null;
  var key = dayKey_(date);
  for (var i = 0; i < schedule.length; i++) {
    var r = schedule[i];
    if (!isDate_(r.Date) || dayKey_(r.Date) !== key) continue;
    if ((r.Session || 'Practice') !== session || !squadMatches_(r.Squad, athleteSquad)) continue;
    if (String(r['Workout ID']).trim() === '') continue;
    return r;
  }
  return null;
}

/**
 * Checks a logged session against its planned pieces.
 * baseWatts: { '2k': w, "20'": w } season bests (missing = no target check).
 * Returns { matches, reason, hit, logged, planned, intervals: [{ n, watts, status }] } where
 * status is 'in' | 'below' | 'above' | '' (no target). hit is null when no
 * piece had a target. Computed at display, never stored.
 */
function checkAgainstPlan(intervals, pieces, baseWatts, settings) {
  var planned = [];
  pieces.forEach(function (p) { for (var i = 0; i < p.reps; i++) planned.push(p); });
  var done = intervals.slice().sort(function (a, b) { return Number(a['Interval #']) - Number(b['Interval #']); });
  var out = { matches: true, reason: '', hit: null, logged: done.length, planned: planned.length, intervals: [] };
  if (done.length !== planned.length) {
    out.matches = false;
    out.reason = done.length + ' intervals logged, plan has ' + planned.length;
  }
  var tol = Number(settings['target.single_tolerance_pct'] || 2) / 100;
  var anyTarget = false;
  var allIn = true;
  done.forEach(function (iv, i) {
    var p = planned[i];
    var ws = Number(iv['Work s']);
    var wm = Number(iv['Work m']);
    var watts = ws > 0 && wm > 0 ? Math.round(wattsFromSplit(ws * 500 / wm)) : null;
    var row = { n: i + 1, watts: watts, status: '' };
    if (p) {
      var same = p.workType === 'Time' ? Math.abs(ws - p.workS) <= 1 : Math.abs(wm - p.workM) <= Math.max(1, p.workM * 0.005);
      if (!same && out.matches) {
        out.matches = false;
        out.reason = 'Interval ' + (i + 1) + ' is not ' + pieceLabel(Object.assign({}, p, { reps: 1 }));
      }
      var pct = pieceTargetPct(p, settings);
      var t = pct && pieceTarget(p, baseWatts[pct.base], settings);
      if (t && watts) {
        anyTarget = true;
        var lo = t.range ? t.lowW : t.lowW * (1 - tol);
        var hi = t.range ? t.highW : t.highW * (1 + tol);
        row.status = watts < lo ? 'below' : watts > hi ? 'above' : 'in';
        if (row.status !== 'in') allIn = false;
      }
    }
    out.intervals.push(row);
  });
  out.hit = anyTarget ? allIn : null;
  return out;
}

/**
 * Coach heads-up for a session marked Full that did not match its plan,
 * e.g. 5 of 8 intervals logged without ticking Modified. '' when fine.
 * A coach decides; nothing is changed automatically.
 */
function planFlag(entry, check) {
  if (check.matches || String(entry.Status) !== 'Full') return '';
  if (check.logged < check.planned) {
    return 'Logged Full, short of plan (' + check.logged + ' of ' + check.planned + '): Modified?';
  }
  return 'Logged Full, does not match plan (' + check.reason + '): Modified?';
}

/**
 * Schedule rows for the week starting toStart, copied from the week before
 * with dates moved forward 7 days. Copies are drafts (Published = false) so
 * coaches edit them before athletes see anything.
 */
function copyWeekRows(schedule, toStart) {
  var from = new Date(toStart.getFullYear(), toStart.getMonth(), toStart.getDate() - 7);
  var to = new Date(toStart.getFullYear(), toStart.getMonth(), toStart.getDate());
  return schedule.filter(function (r) {
    return isDate_(r.Date) && r.Date >= from && r.Date < to;
  }).sort(function (a, b) { return a.Date - b.Date; }).map(function (r) {
    return {
      'Date': new Date(r.Date.getFullYear(), r.Date.getMonth(), r.Date.getDate() + 7),
      'Squad': r.Squad,
      'Session': r.Session,
      'Workout ID': r['Workout ID'],
      'Published': false,
      'Notes': r.Notes
    };
  });
}
