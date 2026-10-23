/**
 * Sheet side of the weekly plan: tab validation and the two coach reports.
 * The math lives in Plan.gs. Both reports are regenerated tabs for coaches;
 * athletes see the week on the Netlify site (weekPlanForSite).
 */

var WEEK_AHEAD_TAB = 'Week ahead (preview)';
var PLAN_CHECK_TAB = 'Plan check';

function addPlanValidation_(sheet, name) {
  var h = HEADERS[name];
  var rows = sheet.getMaxRows() - 1;
  var list = function (col, values) {
    sheet.getRange(2, h.indexOf(col) + 1, rows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build());
  };
  var timeText = function (col, allowUndefined) {
    var letter = String.fromCharCode(64 + h.indexOf(col) + 1);
    var re = allowUndefined ? '^\\s*(\\d{1,3}:[0-5]\\d(\\.\\d)?|[Uu]ndefined)\\s*$' : TIME_PATTERN;
    sheet.getRange(2, h.indexOf(col) + 1, rows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireFormulaSatisfied('=OR(' + letter + '2="",REGEXMATCH(TO_TEXT(' + letter + '2),"' + re + '"))')
        .setHelpText(allowUndefined ? 'm:ss, e.g. 2:00, or Undefined' : 'm:ss, e.g. 3:30')
        .setAllowInvalid(false).build());
  };
  if (name === TABS.WORKOUTS) {
    list('Work type', ['Time', 'Distance']);
    list('Activity', ACTIVITIES.map(function (a) { return a[0]; }));
    list('Zone', ZONES);
    list('Base', Object.keys(PLAN_BASES));
    timeText('Rest', true);
    timeText('Start every', false);
  }
  if (name === TABS.SCHEDULE) {
    list('Squad', ['All', 'Varsity', 'Novice']);
    list('Session', ['Practice', 'OYO']);
    sheet.getRange(2, h.indexOf('Published') + 1, rows, 1).insertCheckboxes();
  }
}

function planInputs_() {
  return {
    schedule: readObjects_(TABS.SCHEDULE),
    workouts: readObjects_(TABS.WORKOUTS),
    roster: activeRoster_(false),
    benchmarks: readObjects_(TABS.BENCHMARKS),
    settings: getSettings()
  };
}

/** Monday on or after today (offsetWeeks = 0) or n weeks from it. */
function mondayFrom_(offsetWeeks) {
  var d = new Date();
  d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7) + 7 * (offsetWeeks || 0));
  return d;
}

function askWeekStart_(title, fallback) {
  var ui = SpreadsheetApp.getUi();
  var tz = ss_().getSpreadsheetTimeZone();
  var def = Utilities.formatDate(fallback, tz, 'yyyy-MM-dd');
  var res = ui.prompt(title, 'First day of the week (YYYY-MM-DD). Leave blank for ' + def + '.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return null;
  var text = res.getResponseText().trim();
  return text ? parseFormDate_(text) : fallback;
}

function freshTab_(name) {
  var sheet = ss_().getSheetByName(name) || ss_().insertSheet(name);
  sheet.clear();
  return sheet;
}

/** Copies last week's Schedule rows into the chosen week as unpublished drafts. */
function copyLastWeek() {
  var start = askWeekStart_('Copy last week into', mondayFrom_(0));
  if (!start) return;
  var ui = SpreadsheetApp.getUi();
  var schedule = readObjects_(TABS.SCHEDULE);
  var end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  var existing = schedule.filter(function (r) { return isDate_(r.Date) && r.Date >= start && r.Date < end; });
  if (existing.length) {
    ui.alert('That week already has ' + existing.length + ' Schedule rows. Nothing copied, so nothing is doubled up.');
    return;
  }
  var rows = copyWeekRows(schedule, start);
  if (!rows.length) {
    ui.alert('The week before has no Schedule rows to copy.');
    return;
  }
  appendObjects_(TABS.SCHEDULE, rows);
  ui.alert('Copied ' + rows.length + ' sessions as drafts. Edit them, then tick Published.');
}

/** Coach preview of the week: every session, piece and athlete target, drafts included. */
function previewWeekAhead() {
  var start = askWeekStart_('Preview week ahead', mondayFrom_(0));
  if (!start) return;
  var inp = planInputs_();
  var plan = buildWeekPlan(Object.assign(inp, { weekStart: start, publishedOnly: false }));
  var tz = ss_().getSpreadsheetTimeZone();
  var out = [['Date', 'Session', 'Squad', 'Workout', 'Published', 'Athlete', 'Piece', 'Target', 'Based on']];
  plan.sessions.forEach(function (sn) {
    var head = [Utilities.formatDate(sn.date, tz, 'EEE yyyy-MM-dd'), sn.session, sn.squad,
      sn.workoutId + (sn.name ? ' ' + sn.name : ''), sn.published ? 'Yes' : 'Draft'];
    sn.athletes.forEach(function (a) {
      a.targets.forEach(function (t) {
        var from = t.from ? t.from.test + ' ' + Utilities.formatDate(t.from.date, tz, 'yyyy-MM-dd') +
          (t.from.season === 'previous' ? ' (last season)' : '') : '';
        out.push(head.concat([a.athlete, t.label, t.text, from]));
      });
    });
  });
  var sheet = freshTab_(WEEK_AHEAD_TAB);
  var flagRows = plan.flags.map(function (f) { return ['FLAG', f.athlete || '(schedule)', f.message, '', '', '', '', '', '']; });
  var all = flagRows.length ? flagRows.concat([['', '', '', '', '', '', '', '', '']], out) : out;
  sheet.getRange(1, 1, all.length, out[0].length).setValues(all);
  sheet.getRange(flagRows.length ? flagRows.length + 2 : 1, 1, 1, out[0].length).setFontWeight('bold');
  sheet.autoResizeColumns(1, out[0].length);
  SpreadsheetApp.getUi().alert(plan.sessions.length + ' sessions in the week. ' +
    (plan.flags.length ? plan.flags.length + ' athletes are missing a benchmark (FLAG rows at the top).' : 'Every athlete has a benchmark.'));
}

/** Coach report: each logged session in a week checked against its planned workout. */
function checkWeekAgainstPlan() {
  var start = askWeekStart_('Check week against plan', mondayFrom_(-1));
  if (!start) return;
  var end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  var inp = planInputs_();
  var tz = ss_().getSpreadsheetTimeZone();
  var squads = {};
  readObjects_(TABS.ROSTER).forEach(function (r) { squads[r['Athlete ID']] = r.Squad; });
  var byEntry = {};
  readObjects_(TABS.INTERVALS).forEach(function (iv) { (byEntry[iv['Entry ID']] = byEntry[iv['Entry ID']] || []).push(iv); });

  var out = [['Date', 'Athlete', 'Session type', 'Planned workout', 'Did the plan', 'Hit target', 'Detail', 'Flag']];
  readObjects_(TABS.ENTRIES).forEach(function (e) {
    if (!(e.Date instanceof Date) || e.Date < start || e.Date >= end || e.Status === 'Out') return;
    var planned = plannedFor(e, squads[e['Athlete ID']], inp.schedule);
    if (!planned) return;
    var pieces = workoutPieces(inp.workouts, planned['Workout ID']);
    var bases = {};
    Object.keys(PLAN_BASES).forEach(function (b) {
      var best = seasonBestWatts(inp.benchmarks, e['Athlete ID'], b, planned.Date, inp.settings.school_year_start);
      if (best) bases[b] = best.watts;
    });
    var c = checkAgainstPlan(byEntry[e['Entry ID']] || [], pieces, bases, inp.settings);
    var detail = c.reason || c.intervals.map(function (iv) { return iv.n + ': ' + (iv.watts || '?') + ' W' + (iv.status ? ' ' + iv.status : ''); }).join(', ');
    out.push([Utilities.formatDate(e.Date, tz, 'EEE yyyy-MM-dd'), e.Athlete, e['Session type'], planned['Workout ID'],
      c.matches ? 'Yes' : 'No', c.hit === null ? '' : c.hit ? 'Yes' : 'No', detail, planFlag(e, c)]);
  });
  var sheet = freshTab_(PLAN_CHECK_TAB);
  sheet.getRange(1, 1, out.length, out[0].length).setValues(out);
  sheet.getRange(1, 1, 1, out[0].length).setFontWeight('bold');
  sheet.autoResizeColumns(1, out[0].length);
}

/**
 * What the athlete site will show: published sessions only, targets as text.
 * Plain JSON-safe object (dates as YYYY-MM-DD). Flags are for the coach view.
 */
function weekPlanForSite(inputs, weekStart) {
  var plan = buildWeekPlan(Object.assign({}, inputs, { weekStart: weekStart, publishedOnly: true }));
  return {
    weekStart: dayKey_(plan.weekStart),
    sessions: plan.sessions.map(function (sn) {
      return {
        day: sn.day, session: sn.session, squad: sn.squad, workout: sn.name || sn.workoutId, notes: sn.notes,
        pieces: sn.pieces,
        athletes: sn.athletes.map(function (a) {
          return { athlete: a.athlete, targets: a.targets.map(function (t) { return { piece: t.label, target: t.text }; }) };
        })
      };
    }),
    coachFlags: plan.flags
  };
}
