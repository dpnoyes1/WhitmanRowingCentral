/**
 * One-time setup, the Erg Tracker menu, triggers and the change log.
 * setup() is safe to re-run: it adds missing tabs, headers and settings and
 * never deletes data.
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Erg Tracker')
    .addItem('Set up Sheet and Form', 'setup')
    .addItem('Refresh form name lists from Roster', 'refreshFormDropdowns')
    .addItem('Team GMS report', 'teamGmsReport')
    .addItem('Save squads for this school year', 'snapshotSquads')
    .addItem('Regatta report', 'regattaReport')
    .addItem('Generate practice schedule', 'generatePracticeSchedule')
    .addItem('Process missed form responses', 'processMissedResponses')
    .addSeparator()
    .addItem('Copy last week (as drafts)', 'copyLastWeek')
    .addItem('Preview week ahead', 'previewWeekAhead')
    .addItem('Check week against plan', 'checkWeekAgainstPlan')
    .addSeparator()
    .addItem('Rebuild form (new link)', 'rebuildForm')
    .addSeparator()
    .addItem('Load dummy data', 'loadDummyData')
    .addItem('Clear dummy data', 'clearDummyData')
    .addToUi();
}

function setup() {
  var ss = ss_();
  var settingsBefore = ss.getSheetByName(TABS.SETTINGS) ? getSettings() : {};
  ss.setSpreadsheetTimeZone(settingsBefore.timezone || 'America/New_York');

  Object.keys(TABS).forEach(function (k) { ensureTab_(TABS[k]); });
  seedSettings_();
  removeDefaultSheet_();
  tab_(TABS.WEIGHTS).hideSheet();   // coach-only; hidden so it never shows up on a shared screen

  var settings = getSettings();
  var form = settings['form.id'] ? tryOpenForm_(settings['form.id']) : null;
  if (!form) form = createAndLinkForm_(settings);

  refreshFormDropdowns();
  installTriggers_(form);
  setSetting_('form.share_url', prefilledUrl_(form, getSettings()));

  SpreadsheetApp.getUi().alert('Setup done.\n\nShare this link with athletes (it prefills warmup and drag factor):\n' +
    getSettings()['form.share_url'] + '\n\nIt is also saved on the Settings tab.');
}

/** Creates a brand new form. Old responses stay in the Sheet; the old link stops being used. */
function rebuildForm() {
  var ui = SpreadsheetApp.getUi();
  var ok = ui.alert('Rebuild form?', 'This makes a new form with a new link. Data already in the Sheet is kept. ' +
    'Unlink and delete the old form by hand afterwards.', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  var form = createAndLinkForm_(getSettings());
  refreshFormDropdowns();
  installTriggers_(form);
  setSetting_('form.share_url', prefilledUrl_(form, getSettings()));
  ui.alert('New share link:\n' + getSettings()['form.share_url']);
}

function createAndLinkForm_(settings) {
  var form = buildForm_(settings);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss_().getId());
  setSetting_('form.id', form.getId());
  setSetting_('form.edit_url', form.getEditUrl());
  SpreadsheetApp.flush();
  // The linked raw responses tab is a backup; the app reads Entries/Benchmarks.
  ss_().getSheets().forEach(function (sh) {
    var url = sh.getFormUrl();
    if (!url) return;
    var linked = null;
    try { linked = FormApp.openByUrl(url).getId(); } catch (err) { return; }
    if (linked === form.getId()) sh.setName('Form responses (raw) ' + form.getId().slice(0, 6));
  });
  return form;
}

function tryOpenForm_(id) {
  try { return FormApp.openById(id); } catch (err) { return null; }
}

function ensureTab_(name) {
  var ss = ss_();
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  var headers = HEADERS[name];
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  var current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  headers.forEach(function (h, i) {
    if (current[i] && current[i] !== h) {
      throw new Error(name + ' column ' + (i + 1) + ' is "' + current[i] + '", expected "' + h + '"');
    }
  });
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  setComputedColumns_(sheet, name);
  (TEXT_COLUMNS[name] || []).forEach(function (h) {
    sheet.getRange(1, headers.indexOf(h) + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
  });
  headers.forEach(function (h, i) {
    if (/^(Date|Make-up for date|Birthday)$/.test(h)) {
      sheet.getRange(2, i + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd');
    } else if (/^(Submitted at|Timestamp)$/.test(h)) {
      sheet.getRange(2, i + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm');
    }
  });
  if (name === TABS.ROSTER) addRosterValidation_(sheet);
  if (name === TABS.RACES) addRaceValidation_(sheet);
  if (name === TABS.WORKOUTS || name === TABS.SCHEDULE) addPlanValidation_(sheet, name);
  return sheet;
}

/** Writes the header-cell array formulas for computed columns and warns on manual edits. */
function setComputedColumns_(sheet, name) {
  var computed = COMPUTED_COLUMNS[name];
  if (!computed) return;
  var headers = HEADERS[name];
  var letters = {};
  headers.forEach(function (h, i) { letters[h] = columnLetter_(i + 1); });
  Object.keys(computed).forEach(function (h) {
    var col = headers.indexOf(h) + 1;
    sheet.getRange(2, col, sheet.getMaxRows() - 1, 1).clearContent();
    sheet.getRange(1, col).setFormula(computed[h](letters));
    var desc = h + ' is calculated; edit Birthday or Grad year instead';
    sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) {
      if (p.getDescription() === desc) p.remove();
    });
    sheet.getRange(1, col, sheet.getMaxRows(), 1).protect().setDescription(desc).setWarningOnly(true);
  });
}

function columnLetter_(n) {
  var s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}

function addRosterValidation_(sheet) {
  var h = HEADERS[TABS.ROSTER];
  var rows = sheet.getMaxRows() - 1;
  var list = function (col, values) {
    sheet.getRange(2, h.indexOf(col) + 1, rows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build());
  };
  list('Squad', ['Varsity', 'Novice']);
  list('Role', ['Rower', 'Coxswain']);
  list('OYO group', ['Standard', 'Performance']);
  list('Active', ['Yes', 'No']);
  sheet.getRange(2, h.indexOf('Birthday') + 1, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false)
      .setHelpText('Date of birth, e.g. 2010-04-17').build());
  sheet.getRange(2, h.indexOf('Grad year') + 1, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireNumberBetween(2020, 2045).setAllowInvalid(false)
      .setHelpText('High school graduation year, e.g. 2029').build());
}

function seedSettings_() {
  var existing = getSettings();
  var missing = SETTINGS_DEFAULTS.filter(function (row) { return !(row[0] in existing); });
  if (!missing.length) return;
  var sheet = tab_(TABS.SETTINGS);
  sheet.getRange(sheet.getLastRow() + 1, 1, missing.length, 3).setValues(missing);
}

function removeDefaultSheet_() {
  var s = ss_().getSheetByName('Sheet1');
  if (s && s.getLastRow() === 0 && ss_().getSheets().length > 1) ss_().deleteSheet(s);
}

function installTriggers_(form) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['onFormSubmit', 'onEditLogged'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onFormSubmit').forForm(form).onFormSubmit().create();
  ScriptApp.newTrigger('onEditLogged').forSpreadsheet(ss_()).onEdit().create();
}

/** Installable edit trigger: logs manual edits and keeps the form's name lists current. */
function onEditLogged(e) {
  var sheet = e.range.getSheet();
  var name = sheet.getName();
  if (e.range.getRow() === 1) return;
  if (LOGGED_TABS.indexOf(name) >= 0) {
    var single = e.range.getNumRows() === 1 && e.range.getNumColumns() === 1;
    var header = sheet.getRange(1, e.range.getColumn()).getValue();
    logChange_({
      Who: (e.user && e.user.getEmail && e.user.getEmail()) || Session.getActiveUser().getEmail() || 'unknown',
      Tab: name,
      Cell: e.range.getA1Notation(),
      'Row ID': sheet.getRange(e.range.getRow(), 1).getValue(),
      Field: single ? header : '(multiple cells)',
      'Old value': single && e.oldValue !== undefined ? e.oldValue : '',
      'New value': single && e.value !== undefined ? e.value : '',
      Note: single ? '' : 'Paste or fill across ' + e.range.getA1Notation()
    });
  }
  if (name === TABS.ROSTER) refreshFormDropdowns();
}

function logChange_(obj) {
  appendObject_(TABS.CHANGE_LOG, Object.assign({ Timestamp: new Date() }, obj));
}

/** Fills Practices from Settings season.winter_start..winter_end using the shift rules. */
function generatePracticeSchedule() {
  var s = getSettings();
  if (!s['season.winter_start'] || !s['season.winter_end']) {
    SpreadsheetApp.getUi().alert('Set season.winter_start and season.winter_end (YYYY-MM-DD) on the Settings tab first.');
    return;
  }
  var start = parseFormDate_(s['season.winter_start']);
  var end = parseFormDate_(s['season.winter_end']);
  var tz = ss_().getSpreadsheetTimeZone();
  var have = {};
  readObjects_(TABS.PRACTICES).forEach(function (r) {
    if (r.Date instanceof Date) have[Utilities.formatDate(r.Date, tz, 'yyyy-MM-dd')] = true;
  });
  var rows = practiceDays(start, end, s).filter(function (p) {
    return !have[Utilities.formatDate(p.Date, tz, 'yyyy-MM-dd')];
  });
  appendObjects_(TABS.PRACTICES, rows);
  SpreadsheetApp.getUi().alert('Added ' + rows.length + ' practices. Mark holidays and snow days as Canceled in the Status column.');
}

/** Pure: practice rows for each weekday between start and end (inclusive). */
function practiceDays(start, end, s) {
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var pad = Number(s['shift.window_pad_min'] || 30);
  var shiftFor = function (d) {
    var day = DAYS[d.getDay()];
    var parity = d.getDate() % 2 === 0 ? '-even' : '-odd';
    var names = ['early', 'late'];
    for (var i = 0; i < names.length; i++) {
      var days = String(s['shift.' + names[i] + '.days']).split(',').map(function (x) { return x.trim(); });
      if (days.indexOf(day) >= 0 || days.indexOf(day + parity) >= 0) return names[i];
    }
    return null;
  };
  var rows = [];
  for (var d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); d <= end; d.setDate(d.getDate() + 1)) {
    var shift = shiftFor(d);
    if (!shift) continue;
    var st = s['shift.' + shift + '.start'];
    var en = s['shift.' + shift + '.end'];
    rows.push({
      'Date': new Date(d.getTime()),
      'Squad': 'Girls',
      'Shift': shift === 'early' ? 'Early' : 'Late',
      'Start': st,
      'End': en,
      'Window start': addMinutes_(st, -pad),
      'Window end': addMinutes_(en, pad),
      'Status': 'Scheduled'
    });
  }
  return rows;
}

function addMinutes_(hhmm, delta) {
  var p = String(hhmm).split(':');
  var total = Number(p[0]) * 60 + Number(p[1]) + delta;
  var h = Math.floor(total / 60);
  var m = total % 60;
  return h + ':' + (m < 10 ? '0' : '') + m;
}
