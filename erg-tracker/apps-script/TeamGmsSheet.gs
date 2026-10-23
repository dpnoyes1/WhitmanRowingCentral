/**
 * Sheet side of the team GMS view: the coach report tab and the yearly
 * squad snapshot. The math lives in TeamGms.gs; athletes see averages on the
 * Netlify team site (teamGmsForSite).
 */

var TEAM_GMS_TAB = 'Team GMS (coach)';

function teamGmsInputs_() {
  return {
    benchmarks: readObjects_(TABS.BENCHMARKS),
    weights: readObjects_(TABS.WEIGHTS),
    roster: readObjects_(TABS.ROSTER),
    squadHistory: readObjects_(TABS.SQUAD_HISTORY),
    settings: getSettings(),
    asOf: new Date()
  };
}

/**
 * Regenerates the coach tab: one row per school year, to date, plus the full
 * past year for reference. Shows every average, including small groups the
 * team site hides, and lists rowers whose tests have no weight on file.
 */
function teamGmsReport() {
  var inp = teamGmsInputs_();
  var years = teamGmsByYear(inp);
  var tz = ss_().getSpreadsheetTimeZone();
  var cell = function (s) {
    return s.avg === null ? '' : (Math.round(s.avg * 10) / 10) + '% (' + s.n + ')';
  };
  var head = ['School year', 'Window'].concat(TEAM_GMS_GROUPS.map(function (g) { return g.label; }));
  var rows = [];
  years.forEach(function (y) {
    var window = Utilities.formatDate(y.start, tz, 'MMM d') + ' - ' + Utilities.formatDate(y.end, tz, 'MMM d');
    rows.push([y.schoolYear, 'To date (' + window + ')'].concat(TEAM_GMS_GROUPS.map(function (g) { return cell(y.groups[g.key]); })));
    if (y.fullYear) {
      rows.push([y.schoolYear, 'Full year'].concat(TEAM_GMS_GROUPS.map(function (g) { return cell(y.fullYear[g.key]); })));
    }
  });

  var sheet = ss_().getSheetByName(TEAM_GMS_TAB) || ss_().insertSheet(TEAM_GMS_TAB);
  sheet.clear();
  var out = [['Team GMS % (best 2k or 20\' result per rower, school year to date). Cells: average % (rowers with a GMS %). Rank bands are team-wide by raw 2k-equivalent erg.']];
  out.push(['Generated ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm') + '. The team site hides any average with fewer than ' +
    teamGmsMinGroup_(inp.settings) + ' rowers.']);
  out.push(['']);
  out.push(head);
  rows.forEach(function (r) { out.push(r); });
  var noWeight = years.length ? years[0].athletes.filter(function (a) { return a.bestGms === null; }) : [];
  out.push(['']);
  out.push(['Tested this year with no weight on file (left out of averages): ' +
    (noWeight.length ? noWeight.map(function (a) { return a.name; }).join(', ') : 'none')]);

  var width = head.length;
  sheet.getRange(1, 1, out.length, width).setValues(out.map(function (r) {
    while (r.length < width) r.push('');
    return r;
  }));
  sheet.getRange(4, 1, 1, width).setFontWeight('bold');
  sheet.setFrozenRows(4);
  sheet.activate();
}

function teamGmsMinGroup_(settings) {
  return parseInt(settings['team_gms.min_group'], 10) || 3;
}

/**
 * Copies each rower's current Roster squad into Squad history for this school
 * year (replacing this year's rows), so later years still compare against the
 * squads as they were. Run once near the end of each season.
 */
function snapshotSquads() {
  var s = getSettings();
  var label = schoolYearLabel(teamGmsYearStart_(new Date(), s.school_year_start).getFullYear());
  var sheet = tab_(TABS.SQUAD_HISTORY);
  var keep = readObjects_(TABS.SQUAD_HISTORY).filter(function (h) { return String(h['School year']).trim() !== label; });
  var add = readObjects_(TABS.ROSTER).filter(function (r) {
    return r['Athlete ID'] && r.Squad && !/cox/i.test(String(r.Role));
  }).map(function (r) {
    return { 'School year': label, 'Athlete ID': r['Athlete ID'], 'Athlete': r.Name, 'Squad': r.Squad };
  });
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  appendObjects_(TABS.SQUAD_HISTORY, keep.concat(add));
  SpreadsheetApp.getUi().alert('Saved ' + add.length + ' squads for ' + label + '.');
}
