/**
 * Weekly plan: workout library, schedule, per-athlete targets and plan checks.
 * Pure functions only (no Sheet calls) so the Netlify site can port them.
 *
 * Targets come from watts only: a % of the athlete's season-best 2k or 20'
 * watts. Weight is never an input here.
 */

var PLAN_BASES = { '2k': '2000m', "20'": '20min' };
var PLAN_RANGE_ZONES = ['Aerobic'];   // steady state shows a range; Threshold/Anaerobic a single number

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

/** Start of the school year containing `date`. mmdd like "07-01". */
function schoolYearStart(date, mmdd) {
  var p = String(mmdd || '07-01').split('-').map(Number);
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
        notes: String(r.Notes || '').trim(),
        unit: String(r.Unit || '').trim(),
        paceS: String(r['Pace target'] === undefined ? '' : r['Pace target']).trim() ? parseTime(r['Pace target']) : null
      };
      if (type === 'Time') piece.workS = parseTime(r.Work);
      else if (type === 'Distance') piece.workM = Number(String(r.Work).replace(/\s*m$/i, ''));
      else throw new Error(where + ': Work type must be Time or Distance');
      if (!(piece.workS > 0 || piece.workM > 0)) throw new Error(where + ': Work is missing or not a number');
      return piece;
    });
}

/** Metres in a mile, for run distances kept in metres and shown in miles. */
var METERS_PER_MILE = 1609.344;

/** "3 mi" or "5 km" for a Run piece kept in metres, else "500m". Pure. */
function pieceDistanceText_(p) {
  if (p.activity === 'Run' && p.unit === 'km') return Math.round(p.workM / 10) / 100 + ' km';
  if (p.activity === 'Run') return Math.round(p.workM / METERS_PER_MILE * 100) / 100 + ' mi';
  return p.workM + 'm';
}

/** A coach's custom goal pace as text: "1:45.0 /500m", or "8:00 /mi" for a Run. '' when none. Pure. */
function pieceGoalText_(p) {
  if (!p.paceS) return '';
  return formatTime(p.paceS).replace(/\.0$/, '') + (p.activity === 'Run' ? (p.unit === 'km' ? ' /km' : ' /mi') : ' /500m');
}

/** "3 x 20:00 r2:00 Aerobic" style label for one piece row. */
function pieceLabel(p) {
  var work = p.workType === 'Time' ? formatTime(p.workS).replace(/\.0$/, '') : pieceDistanceText_(p);
  var rest = p.startEveryS ? ' start every ' + formatTime(p.startEveryS).replace(/\.0$/, '')
    : p.restUndefined ? ' r undefined'
    : p.restS ? ' r' + formatTime(p.restS).replace(/\.0$/, '') : '';
  var rate = p.rate ? ' @ r' + p.rate : '';
  var goal = p.paceS ? ' goal ' + pieceGoalText_(p) : '';
  return (p.activity === 'Run' ? 'Run ' : '') + (p.reps > 1 ? p.reps + ' x ' : '') + work + rest + (p.zone ? ' ' + p.zone : '') + rate + goal;
}

/**
 * Target % for a piece: the piece's own % if set, else the zone default from
 * Settings (target.<zone>.<2000m|20min>, "55-65" or "80"). Returns
 * { base, low, high } or null when the piece has no erg target.
 */
function pieceTargetPct(p, settings) {
  if (p.activity !== 'Erg (RowErg)') return null;
  if (p.paceS) return null;   // the coach typed a goal pace: that is the target, no % of her test
  // Sprint work (the builder's Sprint category = Anaerobic zone) never gets a target (David, 2026-11-16).
  if (p.zone === 'Anaerobic') return null;
  // Aerobic zones work like cycling power zones off FTP: % of her 20' watts first, the 2k only when she has no 20' (David, 2026-11-16).
  var base = p.base || (p.zone === 'Aerobic' ? "20'" : (settings['target.default_base'] || '2k'));
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

/**
 * Target for a piece from an athlete's season-best watts per base ({ '2k': w, "20'": w }).
 * Uses the piece's own base; with no test on that base it falls back to the other one,
 * using that zone's own % for the other test (David, 2026-11-16), so a rower with only a 20'
 * still gets an aerobic target. Null when she has neither, or the piece has no erg target.
 */
function pieceTargetFromBases(p, baseWatts, settings) {
  var pct = pieceTargetPct(p, settings);
  if (!pct) return null;
  if (baseWatts[pct.base]) return pieceTarget(p, baseWatts[pct.base], settings);
  var other = pct.base === '2k' ? "20'" : '2k';
  if (!baseWatts[other]) return null;
  return pieceTarget(Object.assign({}, p, { base: other }), baseWatts[other], settings);
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

/** Alum is an explicit squad: only the All Time boards show alumni. */
function isAlumSquad_(squad) {
  return /^alum$/i.test(String(squad || '').trim());
}

function squadMatches_(planSquad, athleteSquad) {
  if (isAlumSquad_(athleteSquad)) return false;   // Alum: no weekly plan (David, 2026-10-27)
  var s = String(planSquad || 'All').trim();
  return s === '' || s === 'All' || s === String(athleteSquad).trim();
}

/**
 * Novices do the Varsity workout when no Novice workout is scheduled for that day and session
 * (David, 2026-11-03: workouts rarely differ, so no Novice row means everyone does the Varsity one).
 * hasNoviceRow: true when the day and session has a row tagged Novice.
 */
function noviceDoesVarsity_(planSquad, athleteSquad, hasNoviceRow) {
  return !hasNoviceRow && String(planSquad || '').trim() === 'Varsity' && String(athleteSquad || '').trim() === 'Novice';
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
  });
  var nameById = {};
  (opts.workouts || []).forEach(function (w) { var id = String(w['Workout ID']).trim(); if (id && !(id in nameById)) nameById[id] = String(w.Name || ''); });
  rows = scheduleSorted_(rows, function (id) { return nameById[String(id).trim()] || ''; });   // by day, then the coach's Order

  var flags = {};
  var noviceRows = {};
  rows.forEach(function (r) { if (String(r.Squad || '').trim() === 'Novice') noviceRows[dayKey_(r.Date) + '|' + (r.Session || 'Practice')] = true; });
  var sessions = rows.map(function (r) {
    var hasNovice = !!noviceRows[dayKey_(r.Date) + '|' + (r.Session || 'Practice')];
    var pieces = workoutPieces(opts.workouts, r['Workout ID']);
    if (!pieces.length) {
      flags['missing ' + r['Workout ID']] = { athleteId: '', athlete: '', base: '',
        message: 'Workout ' + r['Workout ID'] + ' on ' + dayKey_(r.Date) + ' is not on the Workouts tab' };
    }
    var athletes = opts.roster.filter(function (a) { return squadMatches_(r.Squad, a.Squad) || noviceDoesVarsity_(r.Squad, a.Squad, hasNovice); }).map(function (a) {
      var bests = {};
      Object.keys(PLAN_BASES).forEach(function (b) { bests[b] = seasonBestWatts(opts.benchmarks, a['Athlete ID'], b, r.Date, s.school_year_start); });
      var bases = {};
      Object.keys(bests).forEach(function (b) { if (bests[b]) bases[b] = bests[b].watts; });
      var targets = pieces.map(function (p) {
        if (p.paceS) return { label: pieceLabel(p), text: pieceGoalText_(p) };   // custom goal pace: the same for everyone
        var pct = pieceTargetPct(p, s);
        if (!pct) return { label: pieceLabel(p), text: '' };
        var t = pieceTargetFromBases(p, bases, s);
        if (!t) {
          flags[a['Athlete ID'] + 'none'] = { athleteId: a['Athlete ID'], athlete: a.Name, base: "2k or 20'",
            message: 'No 2k or 20\' test this season or last; no target shown' };
          return { label: pieceLabel(p), text: '' };
        }
        return { label: pieceLabel(p), text: formatTarget(t), target: t, from: bests[t.base] };
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

/**
 * Every Schedule row an entry could be checked against, in the day's order (the coach's Order, else warm up,
 * the work, cool down). Make-ups use the missed date's practice. A day can hold several workouts (David,
 * 2026-11-17). A novice also gets the Varsity workouts when no Novice workout is scheduled that day and
 * session. `workouts` is optional (used only to order rows with no Order by name).
 */
function planCandidates(entry, athleteSquad, schedule, workouts) {
  var type = entry['Session type'];
  var date = type === 'Make-up' ? entry['Make-up for date'] : entry.Date;
  var session = type === 'OYO' ? 'OYO' : 'Practice';
  if (!isDate_(date)) return [];
  var key = dayKey_(date);
  var hasNovice = false, own = [], varsity = [];
  for (var i = 0; i < schedule.length; i++) {
    var r = schedule[i];
    if (!isDate_(r.Date) || dayKey_(r.Date) !== key) continue;
    if ((r.Session || 'Practice') !== session) continue;
    if (String(r['Workout ID']).trim() === '') continue;
    if (String(r.Squad || '').trim() === 'Novice') hasNovice = true;
    if (squadMatches_(r.Squad, athleteSquad)) own.push(r);
    else if (noviceDoesVarsity_(r.Squad, athleteSquad, false)) varsity.push(r);
  }
  // No Novice workout that day: a novice is held to the Varsity ones.
  var rows = own.concat(hasNovice ? [] : varsity);
  if (rows.length < 2) return rows;
  var names = {};
  (workouts || []).forEach(function (w) { var id = String(w['Workout ID']).trim(); if (id && !(id in names)) names[id] = String(w.Name || ''); });
  var keys = scheduleOrderKeys_(rows, function (id) { return names[String(id).trim()] || ''; });
  return rows.map(function (r, i) { return i; }).sort(function (a, b) {
    return (own.indexOf(rows[a]) < 0) - (own.indexOf(rows[b]) < 0) || (keys[a] - keys[b]) || (a - b);
  }).map(function (i) { return rows[i]; });
}

/** The first Schedule row for the entry's day (see planCandidates), or null. */
function plannedFor(entry, athleteSquad, schedule, workouts) {
  return planCandidates(entry, athleteSquad, schedule, workouts)[0] || null;
}

/**
 * How far logged intervals are from a planned workout: 0 is an exact match. Each planned interval adds its
 * relative difference in time (or meters for a distance piece), capped at 1; a missing or extra interval
 * adds 1; a run against an erg plan (or the other way) adds 1. Lower is closer. Pure.
 */
function planFitScore_(intervals, pieces, activity) {
  var planned = [];
  pieces.forEach(function (p) { for (var i = 0; i < p.reps; i++) planned.push(p); });
  var done = intervals.slice().sort(function (a, b) { return Number(a['Interval #']) - Number(b['Interval #']); });
  var score = Math.abs(done.length - planned.length);
  for (var i = 0; i < Math.min(done.length, planned.length); i++) {
    var p = planned[i];
    var got = p.workType === 'Time' ? Number(done[i]['Work s']) : Number(done[i]['Work m']);
    var want = p.workType === 'Time' ? p.workS : p.workM;
    score += want > 0 ? Math.min(1, Math.abs((got || 0) - want) / want) : 1;
  }
  var isRun = String(activity || '') === 'Run';
  var planRun = pieces.length > 0 && pieces.every(function (p) { return p.activity === 'Run'; });
  if (isRun !== planRun) score += 1;
  return score;
}

/**
 * The planned workout a logged session was most likely meant for (David, 2026-11-17: a practice can have a
 * 20:00 and a 40:00 erg; the 40:00 must be checked against the 40:00). The first one it matches exactly,
 * else the closest (planFitScore_), ties to the earlier one in the day. `intervals` are the entry's own
 * Intervals rows (BikeErg meters are halved here). Returns { row, pieces } or null with no plan that day.
 */
function plannedBest(entry, athleteSquad, schedule, workouts, intervals) {
  var rows = planCandidates(entry, athleteSquad, schedule, workouts);
  if (!rows.length) return null;
  var ivs = rowEquivalentIntervals(intervals || [], entry.Activity);
  var best = null;
  for (var i = 0; i < rows.length; i++) {
    var pieces;
    try { pieces = workoutPieces(workouts || [], rows[i]['Workout ID']); } catch (err) { continue; }
    if (!pieces.length) continue;
    if (rows.length === 1) return { row: rows[i], pieces: pieces };
    if (checkAgainstPlan(ivs, pieces, {}, {}, entry.Activity).matches) return { row: rows[i], pieces: pieces };
    var score = planFitScore_(ivs, pieces, entry.Activity);
    if (!best || score < best.score) best = { row: rows[i], pieces: pieces, score: score };
  }
  if (best) return { row: best.row, pieces: best.pieces };
  return { row: rows[0], pieces: [] };
}

/** A warm-up or cool-down scheduled as its own workout. It is logged in the session's warmup and cooldown, so it is never "skipped". */
function isWarmCoolWorkout_(name) {
  return /warm|cool/i.test(String(name || ''));
}

/**
 * BikeErg intervals as RowErg-equivalent meters. Same monitor, double the
 * distance: 2:00/1000m on the bike = 2:00/500m on the rower = 202.5 W
 * (David, 2026-10-23). Other activities come back unchanged.
 */
function rowEquivalentIntervals(intervals, activity) {
  if (!/bikeerg/i.test(String(activity || ''))) return intervals;
  return intervals.map(function (iv) {
    var out = Object.assign({}, iv);
    ['Work m', 'Rest m'].forEach(function (k) { if (Number(iv[k]) > 0) out[k] = Number(iv[k]) / 2; });
    return out;
  });
}

/**
 * Checks a logged session against its planned pieces.
 * baseWatts: { '2k': w, "20'": w } season bests (missing = no target check).
 * Returns { matches, reason, hit, logged, planned, intervals: [{ n, watts, status }] } where
 * status is 'in' | 'below' | 'above' | '' (no target). hit is null when no
 * piece had a target. Computed at display, never stored.
 */
function checkAgainstPlan(intervals, pieces, baseWatts, settings, activity) {
  // A planned run is matched loosely: reasonably close or longer counts, and its goal pace (if any) is checked (David, 2026-11-17).
  if (String(activity || '') === 'Run' && pieces.length && pieces.every(function (p) { return p.activity === 'Run'; })) {
    var loose = checkRunAgainstPlan_(intervals, pieces, settings);
    if (loose) return loose;
  }
  var planned = [];
  pieces.forEach(function (p) { for (var i = 0; i < p.reps; i++) planned.push(p); });
  var done = intervals.slice().sort(function (a, b) { return Number(a['Interval #']) - Number(b['Interval #']); });
  var out = { matches: true, reason: '', hit: null, logged: done.length, planned: planned.length, intervals: [], short: false };
  if (done.length !== planned.length) {
    out.matches = false;
    out.reason = done.length + ' intervals logged, plan has ' + planned.length;
  }
  var cut = planShortReason_(done, planned);
  if (cut) { out.matches = false; out.short = true; out.reason = cut; }
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
      var goalW = p.paceS && p.activity === 'Erg (RowErg)' ? wattsFromSplit(p.paceS) : null;
      var t = pieceTargetFromBases(p, baseWatts, settings);
      if (goalW && watts) {
        // A custom goal pace is met at that pace or faster, or within the tolerance of it.
        anyTarget = true;
        row.status = watts >= goalW * (1 - tol) ? 'in' : 'below';
        if (row.status !== 'in') allIn = false;
      } else if (t && watts) {
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

/** "11:32" for a time, "1450 m" for meters: a short form for reasons. */
function planShortAmount_(p, iv) {
  if (p.workType === 'Time') return formatTime(Number(iv['Work s'])).replace(/\.0$/, '') + ' of ' + formatTime(p.workS).replace(/\.0$/, '');
  return (Number(iv['Work m']) || 0) + ' of ' + p.workM + ' m';
}

/**
 * The reason for a workout that stopped early, or '' (David, 2026-11-17): every logged piece matches the plan
 * except that the last one may be shorter, and there are no more pieces than planned. "3 of 4 pieces done",
 * "Piece 4 stopped at 11:32 of 15:00", or both. Pure.
 */
function planShortReason_(done, planned) {
  if (!done.length || done.length > planned.length) return '';
  var sameAt = function (i) {
    var p = planned[i], ws = Number(done[i]['Work s']), wm = Number(done[i]['Work m']);
    return p.workType === 'Time' ? Math.abs(ws - p.workS) <= 1 : Math.abs(wm - p.workM) <= Math.max(1, p.workM * 0.005);
  };
  for (var i = 0; i < done.length - 1; i++) if (!sameAt(i)) return '';
  var n = done.length - 1, p = planned[n];
  var lastShort = !sameAt(n) && (p.workType === 'Time' ? Number(done[n]['Work s']) < p.workS : Number(done[n]['Work m']) < p.workM);
  if (!lastShort && sameAt(n) && done.length === planned.length) return '';
  if (!lastShort && !sameAt(n)) return '';
  var parts = [];
  if (lastShort) parts.push('Piece ' + done.length + ' stopped at ' + planShortAmount_(p, done[n]));
  var finished = lastShort ? done.length - 1 : done.length;
  if (done.length < planned.length) parts.push(finished + ' of ' + planned.length + ' pieces done');
  return parts.join(', ');
}

/**
 * A logged run against a planned run. It matches when the logged total is at least 90% of the planned total
 * (time for a plan by time, meters for one by distance); longer always counts. A goal pace is met at that pace
 * or faster, or within the single-target tolerance. Null when the plan mixes time and distance (the usual check runs).
 */
function checkRunAgainstPlan_(intervals, pieces, settings) {
  var byTime = pieces.every(function (p) { return p.workType === 'Time'; });
  var byDist = pieces.every(function (p) { return p.workType === 'Distance'; });
  if (!byTime && !byDist) return null;
  var tol = Number(settings['target.single_tolerance_pct'] || 2) / 100;
  var planned = [];
  pieces.forEach(function (p) { for (var i = 0; i < p.reps; i++) planned.push(p); });
  var done = intervals.slice().sort(function (a, b) { return Number(a['Interval #']) - Number(b['Interval #']); });
  var planS = 0, planM = 0, ws = 0, wm = 0;
  planned.forEach(function (p) { planS += p.workS || 0; planM += p.workM || 0; });
  done.forEach(function (iv) { ws += Number(iv['Work s']) || 0; wm += Number(iv['Work m']) || 0; });
  var out = { matches: true, reason: '', hit: null, logged: done.length, planned: planned.length, intervals: [] };
  var plan = byTime ? planS : planM, got = byTime ? ws : wm;
  if (got > 0 && plan > 0 && got < plan * 0.9) {
    out.matches = false;
    out.reason = 'Run is ' + Math.round(got / plan * 100) + '% of the plan';
  }
  var anyGoal = false, allIn = true;
  done.forEach(function (iv, i) {
    var p = planned[Math.min(i, planned.length - 1)], row = { n: i + 1, watts: null, status: '' };
    var s = Number(iv['Work s']), m = Number(iv['Work m']);
    if (p && p.paceS && s > 0 && m > 0) {
      anyGoal = true;
      var pace = s / (m / (p.unit === 'km' ? 1000 : METERS_PER_MILE));   // seconds per mile or km
      row.status = pace <= p.paceS * (1 + tol) ? 'in' : 'below';
      if (row.status !== 'in') allIn = false;
    }
    out.intervals.push(row);
  });
  out.hit = anyGoal ? allIn : null;
  return out;
}

/**
 * The plan-check flag for a session marked Full that is not exactly what was planned, '' when fine.
 * Since 2026-11-17 (David) such a session is marked Modified automatically and the coaches are told,
 * with buttons to confirm Modified or set it back to Full (PlanFlags.gs).
 */
function planFlag(entry, check) {
  if (check.matches || String(entry.Status) !== 'Full') return '';
  if (check.short) return check.reason;
  if (check.logged < check.planned && /intervals logged/.test(check.reason)) return check.logged + ' of ' + check.planned + ' pieces logged';
  return 'Not the planned workout (' + check.reason + ')';
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
