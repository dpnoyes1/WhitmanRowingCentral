/**
 * Team GMS % averages: team-wide, by squad and by rank band, compared
 * school year to date across years. Pure functions so the Netlify site can
 * port them line for line; the Sheet report lives in TeamGmsSheet.gs.
 *
 * Decisions (David, 2026-10-22):
 * - Only 2k and 20' results count.
 * - Each athlete counts once, with her best GMS % in the window.
 * - Rank bands are team-wide and use raw erg rank (best 2k-equivalent time,
 *   no weight), not boat placement.
 * - Years are compared school year to date: last year runs from its Aug 1
 *   to the same number of days in as today.
 *
 * Weight is read here only to compute each GMS %. Nothing returned by
 * teamGmsForSite names an athlete or carries a weight.
 */

var TEAM_GMS_TESTS = ['2000m', '20min'];
var TEAM_GMS_GROUPS = [
  { key: 'team', label: 'Team' },
  { key: 'varsity', label: 'Varsity' },
  { key: 'novice', label: 'Novice' },
  { key: 'rank1_8', label: 'Rank 1-8' },
  { key: 'rank9_16', label: 'Rank 9-16' },
  { key: 'rank17', label: 'Rank 17+' }
];

/** GMS constants from Settings (text values), falling back to GMS_DEFAULTS. */
function gmsOptionsFromSettings(s) {
  s = s || {};
  var num = function (key, fallback) {
    var v = parseFloat(s[key]);
    return isNaN(v) ? fallback : v;
  };
  var d = GMS_DEFAULTS;
  return {
    factor1500: num('gms.factor_1500', d.factor1500),
    refWeight: num('gms.ref_weight_lb', d.refWeight),
    exponent: num('gms.exponent', d.exponent),
    standard: num('gms.standard_s', d.standard),
    offset20min: num('gms.offset_20min_s', d.offset20min),
    divisor500: num('gms.divisor_500m', d.divisor500),
    divisor100: num('gms.divisor_100m', d.divisor100),
    stars: [
      { stars: 3, label: '1v8', maxP: num('gms.star3_s', 300) },
      { stars: 2, label: '2v8', maxP: num('gms.star2_s', 315) },
      { stars: 1, label: '3v/Fr8', maxP: num('gms.star1_s', 330) }
    ]
  };
}

/** Start of the school year containing `date`. mmdd like "08-01". */
function teamGmsYearStart_(date, mmdd) {
  var p = String(mmdd || '08-01').split('-').map(Number);
  var start = new Date(date.getFullYear(), p[0] - 1, p[1]);
  if (start > date) start = new Date(date.getFullYear() - 1, p[0] - 1, p[1]);
  return start;
}

/** "2026-27" for the school year starting in 2026. */
function schoolYearLabel(startYear) {
  return startYear + '-' + String((startYear + 1) % 100).replace(/^(\d)$/, '0$1');
}

function teamGmsIsDate_(d) {
  return Object.prototype.toString.call(d) === '[object Date]' && !isNaN(d.getTime());
}

/** Most recent weight on or before `date` for one athlete, or null. */
function weightOn_(weights, athleteId, date) {
  var best = null;
  weights.forEach(function (w) {
    if (w['Athlete ID'] !== athleteId || !teamGmsIsDate_(w.Date) || w.Date > date) return;
    var lb = Number(w['Weight lb']);
    if (!lb) return;
    if (!best || w.Date >= best.date) best = { date: w.Date, lb: lb };
  });
  return best ? best.lb : null;
}

/** Benchmark row -> its result value for gmsEquivalent2k, or null. */
function teamGmsResult_(b) {
  var v = b.Test === '20min' ? Number(b.Meters) : Number(b['Time s']);
  return v > 0 ? v : null;
}

function teamGmsMean_(list) {
  if (!list.length) return null;
  return list.reduce(function (s, x) { return s + x; }, 0) / list.length;
}

/**
 * Per-athlete bests for one window. Rowers only (coxswains and IDs not on
 * the Roster are skipped); rejected results are ignored.
 * Returns [{ athleteId, name, squad, best2k, bestGms, rank }] sorted by rank.
 * bestGms is null when no result in the window has a weight on or before it.
 */
function teamGmsAthletes(opts, start, end) {
  var o = gmsOptionsFromSettings(opts.settings);
  var roster = {};
  opts.roster.forEach(function (r) { roster[r['Athlete ID']] = r; });
  var history = {};
  (opts.squadHistory || []).forEach(function (h) {
    history[String(h['School year']).trim() + '|' + h['Athlete ID']] = String(h.Squad).trim();
  });
  var label = schoolYearLabel(start.getFullYear());

  var byId = {};
  opts.benchmarks.forEach(function (b) {
    if (TEAM_GMS_TESTS.indexOf(b.Test) < 0) return;
    if (/reject/i.test(String(b['Review status'] || ''))) return;
    if (!teamGmsIsDate_(b.Date) || b.Date < start || b.Date > end) return;
    var r = roster[b['Athlete ID']];
    if (!r || /cox/i.test(String(r.Role))) return;
    var result = teamGmsResult_(b);
    if (!result) return;
    var t2k = gmsEquivalent2k(b.Test, result, o);
    var lb = weightOn_(opts.weights, b['Athlete ID'], b.Date);
    var pct = lb ? gmsPercent(b.Test, result, lb, o) : null;
    var a = byId[b['Athlete ID']];
    if (!a) {
      a = byId[b['Athlete ID']] = {
        athleteId: b['Athlete ID'],
        name: r.Name,
        squad: history[label + '|' + b['Athlete ID']] || String(r.Squad || '').trim(),
        best2k: t2k,
        bestGms: pct
      };
    }
    if (t2k < a.best2k) a.best2k = t2k;
    if (pct !== null && (a.bestGms === null || pct > a.bestGms)) a.bestGms = pct;
  });

  var list = Object.keys(byId).map(function (k) { return byId[k]; });
  list.sort(function (x, y) { return x.best2k - y.best2k; });
  list.forEach(function (a, i) { a.rank = i + 1; });
  return list;
}

/** Group averages for a ranked athlete list (from teamGmsAthletes). */
function teamGmsGroups(athletes) {
  var inGroup = {
    team: function () { return true; },
    varsity: function (a) { return /^varsity$/i.test(a.squad); },
    novice: function (a) { return /^novice$/i.test(a.squad); },
    rank1_8: function (a) { return a.rank <= 8; },
    rank9_16: function (a) { return a.rank >= 9 && a.rank <= 16; },
    rank17: function (a) { return a.rank >= 17; }
  };
  var out = {};
  TEAM_GMS_GROUPS.forEach(function (g) {
    var members = athletes.filter(inGroup[g.key]);
    var pcts = members.map(function (a) { return a.bestGms; }).filter(function (p) { return p !== null; });
    out[g.key] = { avg: teamGmsMean_(pcts), n: pcts.length, tested: members.length };
  });
  return out;
}

/**
 * School-year-to-date comparison across years, newest first.
 * opts: { benchmarks, weights, roster, squadHistory, settings, asOf }.
 * Each year: { schoolYear, start, end, athletes, groups, fullYear }.
 * `end` is the same number of days into that year as asOf is into this one;
 * fullYear (past years only) is the whole school year for reference.
 */
function teamGmsByYear(opts) {
  var mmdd = (opts.settings || {}).school_year_start;
  var asOf = opts.asOf;
  var curStart = teamGmsYearStart_(asOf, mmdd);
  var daysIn = Math.round((asOf - curStart) / 86400000);
  var first = curStart.getFullYear();
  opts.benchmarks.forEach(function (b) {
    if (TEAM_GMS_TESTS.indexOf(b.Test) >= 0 && teamGmsIsDate_(b.Date)) {
      first = Math.min(first, teamGmsYearStart_(b.Date, mmdd).getFullYear());
    }
  });

  var years = [];
  for (var y = curStart.getFullYear(); y >= first; y--) {
    var start = new Date(y, curStart.getMonth(), curStart.getDate());
    var end = new Date(y, curStart.getMonth(), curStart.getDate() + daysIn, 23, 59, 59);
    var athletes = teamGmsAthletes(opts, start, end);
    var year = { schoolYear: schoolYearLabel(y), start: start, end: end, athletes: athletes, groups: teamGmsGroups(athletes) };
    if (y < curStart.getFullYear()) {
      var yearEnd = new Date(y + 1, curStart.getMonth(), curStart.getDate() - 1, 23, 59, 59);
      year.fullYear = teamGmsGroups(teamGmsAthletes(opts, start, yearEnd));
    }
    years.push(year);
  }
  return years;
}

/**
 * Athlete-facing team view: averages only, no names, ranks or weights.
 * A group with fewer than minGroup athletes with a GMS % shows no average,
 * so nobody can work out a teammate's number.
 */
function teamGmsForSite(years, minGroup) {
  var min = minGroup || 3;
  var round1 = function (x) { return Math.round(x * 10) / 10; };
  return years.map(function (y) {
    var groups = {};
    TEAM_GMS_GROUPS.forEach(function (g) {
      var s = y.groups[g.key];
      var show = s.n >= min;
      groups[g.key] = { label: g.label, avg: show ? round1(s.avg) : null, n: show ? s.n : null, hidden: !show };
    });
    return { schoolYear: y.schoolYear, throughDate: y.end, groups: groups };
  });
}
