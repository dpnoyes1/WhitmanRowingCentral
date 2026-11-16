/**
 * Saved lineups for a practice (on-water plan Step 1, David 2026-11-13). Coaches only.
 * The site's Lineups page saves the boats it built for one date and shift; the Water import (Step 2) reads them to credit each
 * rower with her boat's minutes and meters. One Lineups row per boat per practice. Seat 1 = bow, like the Races tab.
 * Saving a date and shift again replaces that practice's boats; a boat keeps its Lineup ID when the page sends it back, so
 * corrections re-credit the same boat. "From piece" is blank for now: it is there so mid-practice seat switches can be added
 * cheaply later (a second row for the same boat, from piece N on). The pure parts are tested in Node.
 */
var LINEUPS_LIST_ACTION = 'lineups-list';
var LINEUPS_SAVE_ACTION = 'lineups-save';
var LINEUP_SHIFTS = ['Early', 'Late', 'Other'];
var LINEUP_CLASSES = { '8+': { seats: 8, cox: true }, '4+': { seats: 4, cox: true }, '4x': { seats: 4, cox: false }, '4-': { seats: 4, cox: false },
  '2x': { seats: 2, cox: false }, '2-': { seats: 2, cox: false }, '1x': { seats: 1, cox: false } };
var LINEUP_MAX_BOATS = 12;
var LINEUP_SEAT_HEADERS = ['Seat 1', 'Seat 2', 'Seat 3', 'Seat 4', 'Seat 5', 'Seat 6', 'Seat 7', 'Seat 8'];

/** Active roster as { id: { name, cox } } (coxswains included; alumni and inactive left out). */
function lineupsRoster_(roster) {
  var out = {};
  roster.forEach(function (r) {
    var id = String(r['Athlete ID'] || '').trim();
    if (!id || !String(r.Name || '').trim() || !isActive_(r.Active) || isAlumSquad_(r.Squad)) return;
    out[id] = { name: String(r.Name).trim(), cox: /cox/i.test(String(r.Role)) };
  });
  return out;
}

/**
 * The page's save request -> { date, shift, boats } or { error } in plain words. Pure.
 * body: { date: 'YYYY-MM-DD', shift, boats: [{ lineupId?, boatName, boatClass, seats: [id or '' x seats], cox?, fromPiece? }] }
 */
function lineupsClean_(body, rosterById) {
  var date = String(body.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !feedParseDay_(date)) return { error: 'Pick the practice date.' };
  var shift = String(body.shift || '').trim();
  if (LINEUP_SHIFTS.indexOf(shift) < 0) return { error: 'Pick the shift: ' + LINEUP_SHIFTS.join(', ') + '.' };
  var boats = Array.isArray(body.boats) ? body.boats : [];
  if (boats.length > LINEUP_MAX_BOATS) return { error: 'At most ' + LINEUP_MAX_BOATS + ' boats in one practice.' };
  var names = {}, seatedAt = {}, out = [];
  for (var i = 0; i < boats.length; i++) {
    var b = boats[i] || {}, cls = LINEUP_CLASSES[String(b.boatClass || '').trim()];
    var name = String(b.boatName || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!name) return { error: 'Name every boat (the shell), so the water import can find it.' };
    if (!cls) return { error: name + ': pick the boat class.' };
    var from = b.fromPiece === undefined || b.fromPiece === null || b.fromPiece === '' ? '' : Number(b.fromPiece);
    if (from !== '' && !(from >= 2 && from <= 30 && Math.floor(from) === from)) return { error: name + ': "From piece" must be a piece number from 2 to 30.' };
    var key = name.toLowerCase() + '|' + from;
    if (names[key]) return { error: 'Two boats are both named ' + name + '.' };
    names[key] = true;
    var raw = Array.isArray(b.seats) ? b.seats : [];
    if (raw.length !== cls.seats) return { error: name + ': a ' + b.boatClass + ' has ' + cls.seats + ' seat' + (cls.seats === 1 ? '' : 's') + '.' };
    var seats = [], rowers = 0;
    for (var k = 0; k < raw.length; k++) {
      var id = String(raw[k] || '').trim();
      if (id) {
        if (!rosterById[id]) return { error: name + ': seat ' + (k + 1) + ' is not an active athlete.' };
        if (seatedAt[id + '|' + from]) return { error: rosterById[id].name + ' is in two boats (' + seatedAt[id + '|' + from] + ' and ' + name + ').' };
        seatedAt[id + '|' + from] = name; rowers++;
      }
      seats.push(id);
    }
    if (!rowers) return { error: name + ' has nobody in it.' };
    var cox = String(b.cox || '').trim();
    if (cox && !cls.cox) return { error: name + ': a ' + b.boatClass + ' has no coxswain.' };
    if (cox && !rosterById[cox]) return { error: name + ': the coxswain is not an active athlete.' };
    if (cox && seatedAt[cox + '|' + from]) return { error: rosterById[cox].name + ' is both rowing and coxing.' };
    if (cox) seatedAt[cox + '|' + from] = name;
    out.push({ lineupId: String(b.lineupId || '').trim().slice(0, 30), boatName: name, boatClass: String(b.boatClass).trim(), seats: seats, cox: cox, fromPiece: from });
  }
  return { date: date, shift: shift, boats: out };
}

/** Lineups rows as page objects, newest date first then shift and boat. Pure. */
function lineupsFromRows_(rows, rosterById) {
  var nameOf = function (id) { return id && rosterById[id] ? rosterById[id].name : (id || ''); };
  return rows.filter(function (r) { return String(r['Lineup ID'] || '').trim(); }).map(function (r) {
    var cls = LINEUP_CLASSES[String(r['Boat class']).trim()] || { seats: 8 };
    var seats = LINEUP_SEAT_HEADERS.slice(0, cls.seats).map(function (h) { return String(r[h] || '').trim(); });
    var cox = String(r.Cox || '').trim();
    return { lineupId: String(r['Lineup ID']).trim(), date: feedDay_(r.Date), shift: String(r.Shift || '').trim(),
      boatName: String(r['Boat name'] || '').trim(), boatClass: String(r['Boat class'] || '').trim(),
      seats: seats, seatNames: seats.map(nameOf), cox: cox, coxName: nameOf(cox),
      fromPiece: r['From piece'] === '' || r['From piece'] === null || r['From piece'] === undefined ? '' : Number(r['From piece']),
      savedBy: String(r['Saved by'] || '').trim() };
  }).sort(function (a, b) {
    return a.date < b.date ? 1 : a.date > b.date ? -1 : a.shift < b.shift ? -1 : a.shift > b.shift ? 1 : a.boatName < b.boatName ? -1 : a.boatName > b.boatName ? 1 : 0;
  });
}

/**
 * New Lineups rows for a cleaned save, keeping each boat's Lineup ID when it was sent and belongs to this practice,
 * else the next free "L<yyyymmdd>-<n>". existing: all current rows of the tab. Pure (dates stay YYYY-MM-DD text here).
 */
function lineupsBuildRows_(clean, existing, by, savedAt) {
  var day = clean.date.replace(/-/g, ''), prefix = 'L' + day + '-';
  var mine = {}, used = {};
  existing.forEach(function (r) {
    var id = String(r['Lineup ID'] || '').trim();
    if (!id) return;
    used[id] = true;
    if (feedDay_(r.Date) === clean.date && String(r.Shift || '').trim() === clean.shift) mine[id] = true;
  });
  var taken = {}, n = 1;
  var nextId = function () { while (used[prefix + n] || taken[prefix + n]) n++; return prefix + n; };
  return clean.boats.map(function (b) {
    var id = b.lineupId && mine[b.lineupId] && !taken[b.lineupId] ? b.lineupId : nextId();
    taken[id] = true;
    var row = { 'Lineup ID': id, Date: clean.date, Shift: clean.shift, 'Boat name': b.boatName, 'Boat class': b.boatClass,
      Cox: b.cox, 'From piece': b.fromPiece, 'Saved by': by, 'Saved at': savedAt };
    LINEUP_SEAT_HEADERS.forEach(function (h, k) { row[h] = b.seats[k] || ''; });
    return row;
  });
}

/** One line for the Change log: "2nd 8+ (8+): A901, A902, ..." per boat. Pure. */
function lineupsSummary_(rows) {
  return rows.map(function (r) {
    var seats = LINEUP_SEAT_HEADERS.map(function (h) { return r[h]; }).filter(function (x) { return x; });
    return r['Boat name'] + ' (' + r['Boat class'] + '): ' + seats.join(', ') + (r.Cox ? '; cox ' + r.Cox : '');
  }).join(' | ').slice(0, 2000);
}

function lineupsCoxes_(rosterById) {
  return Object.keys(rosterById).filter(function (id) { return rosterById[id].cox; })
    .map(function (id) { return { id: id, name: rosterById[id].name }; })
    .sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
}

/** body: { date }. That day's saved boats (every shift), the 14 most recent days with lineups, and the coxswain list. */
function processLineupsList_(body) {
  var roster = lineupsRoster_(readObjects_(TABS.ROSTER));
  var all = lineupsFromRows_(readObjects_(TABS.LINEUPS), roster);
  var date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? String(body.date) : '';
  var days = [];
  all.forEach(function (l) { if (l.date && days.indexOf(l.date) < 0) days.push(l.date); });
  return { status: 'ok', date: date, lineups: all.filter(function (l) { return l.date === date; }), days: days.slice(0, 14), coxes: lineupsCoxes_(roster) };
}

/** Rewrites the Lineups tab without the rows for one practice, then adds that practice's new rows. Caller holds the lock. */
function lineupsReplace_(date, shift, rows) {
  var sheet = tab_(TABS.LINEUPS), headers = HEADERS[TABS.LINEUPS], last = lastDataRow_(sheet, headers.length);
  var keep = [];
  if (last >= 2) {
    var values = sheet.getRange(2, 1, last - 1, headers.length).getValues();
    var dCol = headers.indexOf('Date'), sCol = headers.indexOf('Shift');
    keep = values.filter(function (v) { return !(feedDay_(v[dCol]) === date && String(v[sCol]).trim() === shift); });
    sheet.getRange(2, 1, last - 1, headers.length).clearContent();
  }
  if (keep.length) sheet.getRange(2, 1, keep.length, headers.length).setValues(keep);
  var parts = date.split('-').map(Number), day = new Date(parts[0], parts[1] - 1, parts[2]);
  appendObjects_(TABS.LINEUPS, rows.map(function (r) { return Object.assign({}, r, { Date: day }); }));
}

/** body: { date, shift, boats, coachName }. Replaces that practice's boats; an empty boats list deletes them. */
function processLineupsSave_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var roster = lineupsRoster_(readObjects_(TABS.ROSTER));
    var clean = lineupsClean_(body, roster);
    if (clean.error) return { status: 'invalid', message: clean.error };
    var existing = readObjects_(TABS.LINEUPS);
    var before = existing.filter(function (r) { return feedDay_(r.Date) === clean.date && String(r.Shift || '').trim() === clean.shift; });
    var by = String(body.coachName || 'Coach').trim().slice(0, 60) || 'Coach';
    var rows = lineupsBuildRows_(clean, existing, by, new Date());
    lineupsReplace_(clean.date, clean.shift, rows);
    logChange_({ Who: by, Tab: TABS.LINEUPS, 'Row ID': clean.date + ' ' + clean.shift, Field: 'Lineup',
      'Old value': lineupsSummary_(before), 'New value': lineupsSummary_(rows), Note: 'site Lineups page' });
    var out = processLineupsList_({ date: clean.date });
    out.saved = rows.map(function (r) { return r['Lineup ID']; });
    out.recredited = waterRecredit_(clean.date, clean.shift, by);   // water already imported for this practice follows the new lineup
    return out;
  } catch (err) {
    return { status: 'error', error: err.message };
  } finally {
    lock.releaseLock();
  }
}
