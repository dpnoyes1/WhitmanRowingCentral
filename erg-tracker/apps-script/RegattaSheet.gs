/**
 * Sheet side of the regatta view: Races tab validation and the coach report.
 * The math lives in Regatta.gs. Coach-only; never sent to the team site.
 */

var REGATTA_REPORT_TAB = 'Regatta report (coach)';

function addRaceValidation_(sheet) {
  var h = HEADERS[TABS.RACES];
  var rows = sheet.getMaxRows() - 1;
  var col = function (name) { return sheet.getRange(2, h.indexOf(name) + 1, rows, 1); };
  col('Boat').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['8+', '4+'], true).setAllowInvalid(false).build());
  col('Round').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Heat', 'Repechage', 'Semifinal', 'Petite final', 'Final', 'Time trial'], true).setAllowInvalid(true).build());
  col('Championship').insertCheckboxes();
  col('Place').setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(1, 50).setAllowInvalid(false).build());
  ['Time', '1st time', '2nd time', '3rd time'].forEach(function (name) {
    var letter = String.fromCharCode(64 + h.indexOf(name) + 1);
    col(name).setDataValidation(SpreadsheetApp.newDataValidation()
      .requireFormulaSatisfied('=OR(' + letter + '2="",REGEXMATCH(TO_TEXT(' + letter + '2),"' + TIME_PATTERN + '"))')
      .setHelpText('m:ss.0, e.g. 5:12.4').setAllowInvalid(false).build());
  });
  var names = tab_(TABS.ROSTER).getRange(2, HEADERS[TABS.ROSTER].indexOf('Name') + 1, 500, 1);
  RACE_SEATS.concat(['Cox']).forEach(function (seat) {
    col(seat).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(names, true).setAllowInvalid(false).build());
  });
}

/** Regenerates the coach report: one row per race, grouped by regatta and event. */
function regattaReport() {
  var rows = raceSummaries({
    races: readObjects_(TABS.RACES),
    benchmarks: readObjects_(TABS.BENCHMARKS),
    weights: readObjects_(TABS.WEIGHTS),
    roster: readObjects_(TABS.ROSTER),
    settings: getSettings()
  });
  var tz = ss_().getSpreadsheetTimeZone();
  var pct = function (x) { return x === null ? '' : (x > 0 ? '+' : '') + (Math.round(x * 10) / 10) + '%'; };
  var gms = function (s) { return s.avg === null ? '' : (Math.round(s.avg * 10) / 10) + '% (' + s.n + ')'; };
  var head = ['Regatta', 'Event', 'Date', 'Champ', 'Boat', 'Round', 'Time', 'Place', 'vs winner', 'vs 3rd',
    'Avg 2k', '2k GMS % (n)', "Avg 20' m", "20' GMS % (n)", 'Rowers with a test', 'Check'];
  var out = [
    ["Regatta report. Erg numbers are each rower's best 2k and best 20' this school year up to race day. vs winner: % slower than 1st (negative = winning margin over 2nd)."],
    ['Generated ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm') + '. Coach-only.'],
    [''],
    head
  ];
  rows.forEach(function (r) {
    var check = [];
    if (r.unknown.length) check.push('Not on Roster: ' + r.unknown.join(', '));
    if (r.untested.length) check.push("No 2k/20' yet: " + r.untested.join(', '));
    out.push([
      r.regatta, r.event, Utilities.formatDate(r.date, tz, 'yyyy-MM-dd'), r.championship ? 'Yes' : '', r.boat, r.round,
      r.time ? formatTime(r.time) : '', r.place || '', pct(r.vsWinnerPct), pct(r.vsThirdPct),
      r.avg2k.avg === null ? '' : formatTime(r.avg2k.avg), gms(r.gms2k),
      r.avg20min.avg === null ? '' : Math.round(r.avg20min.avg), gms(r.gms20min),
      r.tested + ' of ' + r.seats, check.join('; ')
    ]);
  });

  var sheet = ss_().getSheetByName(REGATTA_REPORT_TAB) || ss_().insertSheet(REGATTA_REPORT_TAB);
  sheet.clear();
  var width = head.length;
  sheet.getRange(1, 1, out.length, width).setValues(out.map(function (r) {
    while (r.length < width) r.push('');
    return r;
  }));
  sheet.getRange(4, 1, 1, width).setFontWeight('bold');
  sheet.setFrozenRows(4);
  sheet.activate();
}
