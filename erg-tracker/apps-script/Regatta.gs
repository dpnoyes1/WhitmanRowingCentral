/**
 * Regatta view (coach-only): each race's result next to the crew's erg
 * numbers, so coaches can compare erg standards with racing year to year.
 * Pure functions; the Sheet report lives in RegattaSheet.gs.
 *
 * Decisions (David, 2026-10-22):
 * - One Races row per race: regatta, date, championship, event, boat (8+/4+),
 *   round, our time and place, top 3 times, and the lineup by seat.
 * - Each rower's best 2k and best 20' in the school year up to race day,
 *   shown separately, as raw averages and as GMS %.
 * - Racing is compared by % off the winner, not by GMS predicted time:
 *   that only holds on flat water with no wind, which is rare.
 */

var RACE_SEATS = ['Seat 1', 'Seat 2', 'Seat 3', 'Seat 4', 'Seat 5', 'Seat 6', 'Seat 7', 'Seat 8'];

/** Seconds from a coach-typed m:ss cell (or a number of seconds), else null. */
function raceTime_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return v > 0 ? v : null;
  try { return parseTime(String(v)); } catch (e) { return null; }
}

function racePct_(a, b) {
  return a && b ? 100 * (a - b) / b : null;
}

/**
 * One summary per Races row, newest first within each regatta and event.
 * opts: { races, benchmarks, weights, roster, settings }.
 * vsWinnerPct is % slower than 1st; when we won it is the (negative) margin
 * over 2nd. vsThirdPct is % off the last medal time.
 */
function raceSummaries(opts) {
  var mmdd = (opts.settings || {}).school_year_start;
  var byName = {};
  opts.roster.forEach(function (r) { byName[String(r.Name).trim().toLowerCase()] = r; });

  var out = opts.races.filter(function (r) {
    return teamGmsIsDate_(r.Date) && String(r.Regatta || '').trim();
  }).map(function (r) {
    var end = new Date(r.Date.getFullYear(), r.Date.getMonth(), r.Date.getDate(), 23, 59, 59);
    var athletes = {};
    teamGmsAthletes(opts, teamGmsYearStart_(r.Date, mmdd), end).forEach(function (a) { athletes[a.athleteId] = a; });

    var seats = /4/.test(String(r.Boat)) ? RACE_SEATS.slice(0, 4) : RACE_SEATS;
    var crew = [], unknown = [], untested = [];
    seats.forEach(function (seat) {
      var name = String(r[seat] || '').trim();
      if (!name) return;
      var ros = byName[name.toLowerCase()];
      if (!ros) { unknown.push(name); return; }
      var a = athletes[ros['Athlete ID']];
      if (!a) { untested.push(name); return; }
      crew.push(a);
    });

    var stat = function (test, field) {
      var vals = crew.map(function (a) { return a.byTest[test] ? a.byTest[test][field] : null; })
        .filter(function (v) { return v !== null; });
      return { avg: teamGmsMean_(vals), n: vals.length };
    };

    var time = raceTime_(r.Time), first = raceTime_(r['1st time']);
    var second = raceTime_(r['2nd time']), third = raceTime_(r['3rd time']);
    var won = Number(r.Place) === 1 || (time && first && time <= first);
    return {
      date: r.Date,
      regatta: String(r.Regatta).trim(),
      championship: r.Championship === true || /^(y|yes|true)$/i.test(String(r.Championship).trim()),
      event: String(r.Event || '').trim(),
      boat: String(r.Boat || '').trim(),
      round: String(r.Round || '').trim(),
      time: time,
      place: Number(r.Place) || null,
      vsWinnerPct: won ? racePct_(time, second) : racePct_(time, first),
      vsThirdPct: racePct_(time, third),
      seats: seats.length,
      tested: crew.length,
      avg2k: stat('2000m', 'raw'),
      gms2k: stat('2000m', 'gms'),
      avg20min: stat('20min', 'raw'),
      gms20min: stat('20min', 'gms'),
      unknown: unknown,
      untested: untested
    };
  });

  out.sort(function (a, b) {
    return a.regatta.localeCompare(b.regatta) || a.event.localeCompare(b.event) || b.date - a.date;
  });
  return out;
}
