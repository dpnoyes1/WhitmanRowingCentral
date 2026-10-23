/** Small helpers for reading and writing tabs by header name. */

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function tab_(name) {
  var sheet = ss_().getSheetByName(name);
  if (!sheet) throw new Error('Missing tab "' + name + '". Run Erg Tracker > Set up Sheet and Form.');
  return sheet;
}

/** Appends one row given as {header: value}. Unknown headers throw. */
function appendObject_(tabName, obj) {
  appendObjects_(tabName, [obj]);
}

function appendObjects_(tabName, objs) {
  if (!objs.length) return;
  var headers = HEADERS[tabName];
  Object.keys(objs[0]).forEach(function (k) {
    if (headers.indexOf(k) < 0) throw new Error('No column "' + k + '" on ' + tabName);
  });
  var rows = objs.map(function (obj) {
    return headers.map(function (h) {
      var v = obj[h];
      return v === undefined || v === null ? '' : v;
    });
  });
  var sheet = tab_(tabName);
  sheet.getRange(lastDataRow_(sheet, headers.length) + 1, 1, rows.length, headers.length).setValues(rows);
}

/**
 * Last row with data in the first `width` columns. getLastRow() is not enough:
 * unticked checkboxes (Schedule) and header array formulas (Roster) fill every
 * row with FALSE or "". A row of only blanks and FALSE counts as empty.
 */
function lastDataRow_(sheet, width) {
  var last = sheet.getLastRow();
  if (last < 2) return 1;
  var values = sheet.getRange(2, 1, last - 1, width).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    if (values[i].some(function (v) { return v !== '' && v !== null && v !== false; })) return i + 2;
  }
  return 1;
}

/** Reads a tab as an array of {header: value}. */
function readObjects_(tabName) {
  var sheet = tab_(tabName);
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var values = sheet.getRange(1, 1, last, sheet.getLastColumn()).getValues();
  var headers = values.shift();
  return values.map(function (row) {
    var o = {};
    headers.forEach(function (h, i) { o[h] = row[i]; });
    return o;
  });
}

/** Settings as {key: string value}. */
function getSettings() {
  var out = {};
  readObjects_(TABS.SETTINGS).forEach(function (r) {
    if (r.Key) out[String(r.Key).trim()] = String(r.Value).trim();
  });
  return out;
}

function setSetting_(key, value) {
  var sheet = tab_(TABS.SETTINGS);
  var keys = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
  for (var i = 0; i < keys.length; i++) {
    if (keys[i][0] === key) {
      sheet.getRange(i + 2, 2).setValue(String(value));
      return;
    }
  }
  sheet.appendRow([key, String(value), '']);
}

function isActive_(v) {
  return v === true || /^(y|yes|true|active)$/i.test(String(v).trim());
}

/** Active roster rows. Rowers only unless includeCoxswains. */
function activeRoster_(includeCoxswains) {
  return readObjects_(TABS.ROSTER).filter(function (r) {
    if (!r.Name || !isActive_(r.Active)) return false;
    return includeCoxswains || !/cox/i.test(String(r.Role));
  });
}

/** Name -> Athlete ID across the whole roster (inactive too, so history resolves). */
function athleteIdByName_() {
  var map = {};
  readObjects_(TABS.ROSTER).forEach(function (r) {
    if (r.Name) map[String(r.Name).trim()] = r['Athlete ID'];
  });
  return map;
}

function newId_(prefix) {
  return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
}

/** "YYYY-MM-DD" from a Form date answer -> Date at local midnight. */
function parseFormDate_(s) {
  if (!s) return '';
  var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('Bad date "' + s + '"');
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
