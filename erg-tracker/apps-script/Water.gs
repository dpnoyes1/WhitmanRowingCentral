/**
 * On-water import (plan Step 2, David 2026-11-13). Coaches only.
 * The site reads each SpeedCoach / CoxBox FIT file (site/lib/fit.mjs, water.mjs) and sends one save per file here. This file:
 * - keeps the original file in a private Drive folder (coaching account, never shared), like the erg photos;
 * - writes one Water sessions row per file and one Water pieces row per piece (both coach-only);
 * - credits every rower in that boat's saved lineup with the boat's moving time and meters as one Entries row each
 *   (Session type Practice, Activity Water, Source SpeedCoach), and the coxswain with a row of no time or meters, so the
 *   practice counts as attended for everyone in the boat.
 * Each credited row has a fixed ID per session and athlete ("WTR-<session>-<athlete>", Response ID "water:<session>:<athlete>"),
 * so importing the same file again, or correcting the lineup (Lineups.gs calls waterRecredit_), updates rows and never doubles them.
 * Water minutes count in weekly training minutes (Settings multiplier.Water, 1.0). Water never feeds benchmarks, stars, GMS %, erg
 * targets, the plan check or the steady-state split trend. The pure parts are tested in Node.
 */
var WATER_CONTEXT_ACTION = 'water-context';
var WATER_SAVE_ACTION = 'water-save';
var WATER_REPORT_ACTION = 'water-report';
var WATER_ACTIVITY = 'Water';
var WATER_SOURCE = 'SpeedCoach';
var WATER_FOLDER_PROP = 'WATER_FOLDER_ID';
var WATER_KINDS = ['Practice', 'Pieces', 'Race'];

/** True for an Entries row (Sheet object or feed entry) made by the water import. */
function isWaterEntry_(e) {
  return String(e.Activity || e.activity || '') === WATER_ACTIVITY || String(e.Source || e.source || '') === WATER_SOURCE;
}

/** Settings water.units ("3121111=Hudson; 011009863=Potomac") -> { unit: boat name }. Pure. */
function waterUnits_(text) {
  var out = {};
  String(text || '').split(/[;\n]/).forEach(function (part) {
    var m = part.match(/^\s*(\d{3,})\s*=\s*(.+?)\s*$/);
    if (m) out[m[1]] = m[2];
  });
  return out;
}

/** Session ID for a file: the unit and its start time, so the same file always gets the same ID. Pure. */
function waterSessionId_(unit, startUnix) {
  return 'WS-' + (String(unit || '').replace(/[^0-9A-Za-z]/g, '') || 'nounit') + '-' + Math.round(Number(startUnix) || 0);
}

/** The boat to suggest for a unit: the Settings list first, else the boat it was last saved with. sessions: page objects. Pure. */
function waterSuggestBoat_(unit, units, sessions) {
  if (units[unit]) return units[unit];
  var last = sessions.filter(function (s) { return s.unit === String(unit) && s.boatName; })
    .sort(function (a, b) { return a.start < b.start ? 1 : -1; })[0];
  return last ? last.boatName : '';
}

/** Water sessions rows -> page objects. Pure. */
function waterSessionsFromRows_(rows) {
  return rows.filter(function (r) { return String(r['Session ID'] || '').trim(); }).map(function (r) {
    return { sessionId: String(r['Session ID']).trim(), date: feedDay_(r.Date), shift: String(r.Shift || '').trim(), unit: String(r.Unit || '').trim(),
      boatName: String(r['Boat name'] || '').trim(), boatClass: String(r['Boat class'] || '').trim(), lineupId: String(r['Lineup ID'] || '').trim(),
      start: String(r['Start time'] || ''), movingS: feedNum_(r['Moving s']), elapsedS: feedNum_(r['Elapsed s']), meters: feedNum_(r.Meters),
      avgSplitS: feedNum_(r['Avg split s']), avgRate: feedNum_(r['Avg rate']), strokes: feedNum_(r.Strokes), pieces: feedNum_(r.Pieces),
      kind: String(r.Kind || ''), fileName: String(r['File name'] || ''), curve: waterCurve_(waterJson_(r['Curve JSON'])), importedBy: String(r['Imported by'] || '') };
  });
}

function waterJson_(v) { try { return v ? JSON.parse(String(v)) : null; } catch (e) { return null; } }

/** A stored curve as { all, r20, r24, r28 } (each a list of { durS, splitS, meters, rate }); a bare list is the any-rate curve. Pure. */
function waterCurve_(c) {
  if (Array.isArray(c)) return { all: c };
  var out = {};
  if (c && typeof c === 'object') Object.keys(c).forEach(function (k) { if (/^(all|r\d{2})$/.test(k) && Array.isArray(c[k])) out[k] = c[k].slice(0, 20); });
  return out;
}

/**
 * The saved lineup a session credits: the one with its Lineup ID if that still exists on the same date, else the boat of the
 * same name on that date and shift (first lineup only; mid-practice switches are not built). lineups: Lineups.gs page objects. Pure.
 */
function waterLineupFor_(session, lineups) {
  var day = lineups.filter(function (l) { return l.date === session.date && l.fromPiece === ''; });
  var byId = session.lineupId ? day.filter(function (l) { return l.lineupId === session.lineupId; })[0] : null;
  if (byId) return byId;
  var name = String(session.boatName || '').toLowerCase();
  return day.filter(function (l) { return l.shift === session.shift && l.boatName.toLowerCase() === name; })[0] || null;
}

/**
 * The Entries rows a session should have: one per rower (moving time, full meters) and one for the cox (no time, no meters).
 * session: { sessionId, date, movingS, meters, boatName, boatClass, kind }. Dates stay YYYY-MM-DD here; the writer turns them into
 * Sheet dates. Pure.
 */
function waterCredits_(session, lineup, rosterById, coachName, submittedAt) {
  if (!lineup) return [];
  var rows = [];
  var main = 'Water: ' + session.boatName + ' (' + session.boatClass + ')' + (session.kind && session.kind !== 'Practice' ? ', ' + session.kind.toLowerCase() : '');
  var base = function (id, cox) {
    return { 'Entry ID': 'WTR-' + session.sessionId + '-' + id, 'Submitted at': submittedAt, Date: session.date, 'Athlete ID': id,
      Athlete: rosterById[id] ? rosterById[id].name : id, 'Entered by': 'Coach ' + (coachName || ''), 'Session type': 'Practice',
      Status: 'Full', Activity: WATER_ACTIVITY, 'Work s': cox ? '' : Math.round(session.movingS * 10) / 10, 'Work m': cox ? '' : Math.round(session.meters),
      'Main set': cox ? main + ', coxing' : main, Source: WATER_SOURCE, 'Response ID': 'water:' + session.sessionId + ':' + id,
      'Coach note': cox ? 'Coxswain: attendance only' : '' };
  };
  lineup.seats.forEach(function (id) { if (id) rows.push(base(id, false)); });
  if (lineup.cox) rows.push(base(lineup.cox, true));
  return rows;
}

/**
 * How to bring Entries in line for one session: existing rows of that session (by Response ID) are updated or removed, missing ones
 * added. existing: [{ row (sheet row number), 'Response ID', ... }]. Pure.
 */
function waterReconcile_(sessionId, existing, wanted) {
  var prefix = 'water:' + sessionId + ':', have = {};
  existing.forEach(function (e) { var rid = String(e['Response ID'] || ''); if (rid.indexOf(prefix) === 0) have[rid] = e; });
  var update = [], add = [], keep = {};
  wanted.forEach(function (w) {
    var old = have[w['Response ID']];
    keep[w['Response ID']] = true;
    if (old) update.push({ row: old.row, obj: w }); else add.push(w);
  });
  var remove = Object.keys(have).filter(function (rid) { return !keep[rid]; }).map(function (rid) { return have[rid].row; }).sort(function (a, b) { return b - a; });
  return { update: update, add: add, remove: remove };
}

/**
 * Entry IDs the feed leaves out because a SpeedCoach entry stands for the same practice (plan section 3: "the SpeedCoach entry
 * stands and hers is dropped"). Dropped: her own Practice log that day (Form, Slack, Site; not Logbook, not a test) that is not erg
 * work, since an erg piece the same day can be real extra work. Rows are Sheet objects. Pure.
 */
function waterDuplicateIds_(entries) {
  var water = {};
  entries.forEach(function (e) { if (isWaterEntry_(e) && isDate_(e.Date)) water[e['Athlete ID'] + '|' + dayKey_(e.Date)] = true; });
  var out = {};
  entries.forEach(function (e) {
    if (isWaterEntry_(e) || !isDate_(e.Date) || !water[e['Athlete ID'] + '|' + dayKey_(e.Date)]) return;
    if (String(e['Session type']) !== 'Practice' || String(e['Benchmark ID'] || '') !== '') return;
    if (/^(logbook|dummy)$/i.test(String(e.Source || '')) || /rowerg|bikeerg/i.test(String(e.Activity || ''))) return;
    out[String(e['Entry ID'])] = true;
  });
  return out;
}

/** Cleans the site's save request. Numbers were computed on the site from the file; this checks they are sane. Pure. */
function waterCleanSave_(body) {
  var s = body.session || {};
  var date = String(s.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !feedParseDay_(date)) return { error: 'The file has no usable date.' };
  if (LINEUP_SHIFTS.indexOf(String(s.shift || '')) < 0) return { error: 'Pick the shift.' };
  if (WATER_KINDS.indexOf(String(s.kind || '')) < 0) return { error: 'Pick Practice, Pieces or Race.' };
  var boatName = String(s.boatName || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!boatName) return { error: 'Pick the boat.' };
  if (!LINEUP_CLASSES[String(s.boatClass || '')]) return { error: 'Pick the boat class.' };
  var moving = Number(s.movingS), meters = Number(s.meters);
  if (!(moving >= 0 && moving <= 6 * 3600) || !(meters >= 0 && meters <= 60000)) return { error: 'The time or distance in the file looks wrong.' };
  var pieces = (Array.isArray(body.pieces) ? body.pieces : []).slice(0, 40).map(function (p, i) {
    return { n: i + 1, start: String(p.start || ''), workS: Number(p.workS) || 0, meters: Math.round(Number(p.meters) || 0),
      splitS: Number(p.splitS) || '', rate: Number(p.rate) || '', strokes: Number(p.strokes) || '' };
  });
  return {
    sessionId: String(s.sessionId || '').slice(0, 60), date: date, shift: String(s.shift), unit: String(s.unit || '').slice(0, 20),
    boatName: boatName, boatClass: String(s.boatClass), lineupId: String(s.lineupId || '').slice(0, 30), start: String(s.start || ''),
    elapsedS: Number(s.elapsedS) || 0, movingS: moving, meters: meters, avgSplitS: Number(s.avgSplitS) || '', avgRate: Number(s.avgRate) || '',
    strokes: Number(s.strokes) || 0, kind: String(s.kind), fileName: String(s.fileName || '').slice(0, 120),
    curve: waterCurve_(s.curve), pieces: pieces
  };
}

/** Water sessions and pieces rows for a cleaned save. Pure (Date stays YYYY-MM-DD). */
function waterSessionRow_(c, fileLink, by, at) {
  return { 'Session ID': c.sessionId, Date: c.date, Shift: c.shift, Unit: c.unit, 'Boat name': c.boatName, 'Boat class': c.boatClass,
    'Lineup ID': c.lineupId, 'Start time': c.start, 'Elapsed s': c.elapsedS, 'Moving s': c.movingS, Meters: c.meters,
    'Avg split s': c.avgSplitS, 'Avg rate': c.avgRate, Strokes: c.strokes, Pieces: c.pieces.length, Kind: c.kind,
    'File name': c.fileName, 'File link': fileLink || '', 'Curve JSON': JSON.stringify(c.curve), 'Imported by': by, 'Imported at': at };
}
function waterPieceRows_(c) {
  return c.pieces.map(function (p) {
    return { 'Piece ID': c.sessionId + '-P' + p.n, 'Session ID': c.sessionId, 'Piece #': p.n, 'Start time': p.start, 'Work s': p.workS,
      Meters: p.meters, 'Avg split s': p.splitS, 'Avg rate': p.rate, Strokes: p.strokes, 'Match group': '', 'Lineup ID': c.lineupId };
  });
}

// ---- Sheet and Drive ---------------------------------------------------------------------------------------------

function waterFolder_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty(WATER_FOLDER_PROP);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* made again below */ } }
  var f = DriveApp.createFolder('Erg tracker water files (private)');
  props.setProperty(WATER_FOLDER_PROP, f.getId());
  return f;
}

/** Keeps the original file once per session; returns its link. A re-import reuses the link already stored. */
function waterKeepFile_(sessionId, fileName, base64, existingLink) {
  if (existingLink) return existingLink;
  if (!base64) return '';
  var blob = Utilities.newBlob(Utilities.base64Decode(base64), 'application/octet-stream', sessionId + ' ' + (fileName || 'session.fit'));
  return waterFolder_().createFile(blob).getUrl();
}

/** Replaces the rows of `tab` whose `keyCol` is in `keys` with `rows`. Small coach-only tabs; caller holds the lock. */
function waterReplaceRows_(tab, keyCol, keys, rows) {
  var sheet = tab_(tab), headers = HEADERS[tab], last = lastDataRow_(sheet, headers.length), col = headers.indexOf(keyCol);
  var drop = {}; keys.forEach(function (k) { drop[k] = true; });
  if (last >= 2) {
    var values = sheet.getRange(2, 1, last - 1, headers.length).getValues();
    var keep = values.filter(function (v) { return !drop[String(v[col])]; });
    if (keep.length !== values.length) {
      sheet.getRange(2, 1, last - 1, headers.length).clearContent();
      if (keep.length) sheet.getRange(2, 1, keep.length, headers.length).setValues(keep);
    }
  }
  appendObjects_(tab, rows.map(waterSheetDates_));
}

function waterSheetDates_(r) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.Date || ''))) return r;
  var p = r.Date.split('-').map(Number);
  return Object.assign({}, r, { Date: new Date(p[0], p[1] - 1, p[2]) });
}

/** Brings the Entries rows of one session in line with what it should credit. Caller holds the lock. */
function waterWriteCredits_(sessionId, wanted) {
  var sheet = tab_(TABS.ENTRIES), headers = HEADERS[TABS.ENTRIES], last = lastDataRow_(sheet, headers.length);
  var ridCol = headers.indexOf('Response ID'), existing = [];
  if (last >= 2) {
    sheet.getRange(2, ridCol + 1, last - 1, 1).getValues().forEach(function (v, i) {
      if (String(v[0]).indexOf('water:' + sessionId + ':') === 0) existing.push({ row: i + 2, 'Response ID': String(v[0]) });
    });
  }
  var plan = waterReconcile_(sessionId, existing, wanted);
  plan.update.forEach(function (u) {
    var o = waterSheetDates_(u.obj);
    sheet.getRange(u.row, 1, 1, headers.length).setValues([headers.map(function (h) { return o[h] === undefined || o[h] === null ? '' : o[h]; })]);
  });
  plan.remove.forEach(function (row) { sheet.deleteRow(row); });
  appendObjects_(TABS.ENTRIES, plan.add.map(waterSheetDates_));
  return plan;
}

/** Re-credits every water session of one practice after its lineup is saved (called by Lineups.gs under its lock). */
function waterRecredit_(date, shift, coachName) {
  if (!ss_().getSheetByName(TABS.WATER_SESSIONS)) return 0;
  var roster = lineupsRoster_(readObjects_(TABS.ROSTER));
  var lineups = lineupsFromRows_(readObjects_(TABS.LINEUPS), roster);
  var sessions = waterSessionsFromRows_(readObjects_(TABS.WATER_SESSIONS)).filter(function (s) { return s.date === date && s.shift === shift; });
  sessions.forEach(function (s) {
    var lineup = waterLineupFor_(s, lineups), id = lineup ? lineup.lineupId : '';
    waterWriteCredits_(s.sessionId, waterCredits_(s, lineup, roster, coachName, new Date()));
    if (id !== s.lineupId) waterSetLineupId_(s.sessionId, id);
  });
  return sessions.length;
}

/** Points a session and its pieces at the lineup that now credits it (Step 3 groups piece results by lineup). */
function waterSetLineupId_(sessionId, lineupId) {
  [TABS.WATER_SESSIONS, TABS.WATER_PIECES].forEach(function (tab) {
    var sheet = tab_(tab), headers = HEADERS[tab], last = lastDataRow_(sheet, headers.length);
    if (last < 2) return;
    var sCol = headers.indexOf('Session ID'), lCol = headers.indexOf('Lineup ID');
    sheet.getRange(2, sCol + 1, last - 1, 1).getValues().forEach(function (v, i) {
      if (String(v[0]).trim() === sessionId) sheet.getRange(i + 2, lCol + 1).setValue(lineupId);
    });
  });
}

/** Water pieces rows -> page objects. Pure. */
function waterPiecesFromRows_(rows) {
  return rows.filter(function (r) { return String(r['Piece ID'] || '').trim(); }).map(function (r) {
    return { pieceId: String(r['Piece ID']).trim(), sessionId: String(r['Session ID'] || '').trim(), n: feedNum_(r['Piece #']), start: String(r['Start time'] || ''),
      workS: feedNum_(r['Work s']), meters: feedNum_(r.Meters), splitS: feedNum_(r['Avg split s']), rate: feedNum_(r['Avg rate']), strokes: feedNum_(r.Strokes),
      lineupId: String(r['Lineup ID'] || '').trim() };
  });
}

/** body: { from, to } (YYYY-MM-DD). Every water session, piece and lineup in that range, for the coaches' results page (Steps 3 and 4). */
function processWaterReport_(body) {
  var from = String(body.from || ''), to = String(body.to || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return { status: 'invalid', message: 'Bad dates.' };
  var inRange = function (d) { return d >= from && d <= to; };
  var roster = lineupsRoster_(readObjects_(TABS.ROSTER));
  var sessions = waterSessionsFromRows_(readObjects_(TABS.WATER_SESSIONS)).filter(function (s) { return inRange(s.date); });
  var ids = {}; sessions.forEach(function (s) { ids[s.sessionId] = true; });
  return { status: 'ok', from: from, to: to, sessions: sessions,
    pieces: waterPiecesFromRows_(readObjects_(TABS.WATER_PIECES)).filter(function (p) { return ids[p.sessionId]; }),
    lineups: lineupsFromRows_(readObjects_(TABS.LINEUPS), roster).filter(function (l) { return inRange(l.date); }) };
}

/** body: { dates: [YYYY-MM-DD] }. What the import page needs to suggest boats and lineups for those days. */
function processWaterContext_(body) {
  var dates = (Array.isArray(body.dates) ? body.dates : []).filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d)); }).slice(0, 14);
  var roster = lineupsRoster_(readObjects_(TABS.ROSTER));
  var lineups = lineupsFromRows_(readObjects_(TABS.LINEUPS), roster);
  var sessions = waterSessionsFromRows_(readObjects_(TABS.WATER_SESSIONS));
  var units = waterUnits_(getSettings()['water.units']);
  var unitBoats = {};
  sessions.forEach(function (s) { if (s.unit && !(s.unit in unitBoats)) unitBoats[s.unit] = waterSuggestBoat_(s.unit, units, sessions); });
  Object.keys(units).forEach(function (u) { unitBoats[u] = units[u]; });
  return { status: 'ok', units: unitBoats,
    lineups: lineups.filter(function (l) { return dates.indexOf(l.date) >= 0; }),
    sessions: sessions.filter(function (s) { return dates.indexOf(s.date) >= 0; }).map(function (s) { var o = Object.assign({}, s); delete o.curve; return o; }) };
}

/** body: { session, pieces, file: { name, base64 }, coachName }. Writes the session, its pieces and its credits. */
function processWaterSave_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var c = waterCleanSave_(body);
    if (c.error) return { status: 'invalid', message: c.error };
    if (!c.sessionId) return { status: 'invalid', message: 'The file has no session ID.' };
    var by = 'Coach ' + (String(body.coachName || '').trim().slice(0, 60) || '');
    var roster = lineupsRoster_(readObjects_(TABS.ROSTER));
    var lineups = lineupsFromRows_(readObjects_(TABS.LINEUPS), roster);
    var lineup = waterLineupFor_(c, lineups);
    if (lineup) c.lineupId = lineup.lineupId;
    var beforeRow = readObjects_(TABS.WATER_SESSIONS).filter(function (r) { return String(r['Session ID']).trim() === c.sessionId; })[0];
    var before = beforeRow ? waterSessionsFromRows_([beforeRow])[0] : null;
    var link = waterKeepFile_(c.sessionId, c.fileName, body.file && body.file.base64, beforeRow ? String(beforeRow['File link'] || '') : '');
    var now = new Date();
    waterReplaceRows_(TABS.WATER_SESSIONS, 'Session ID', [c.sessionId], [waterSessionRow_(c, link, by, now)]);
    waterReplaceRows_(TABS.WATER_PIECES, 'Session ID', [c.sessionId], waterPieceRows_(c));
    var credits = waterCredits_(c, lineup, roster, String(body.coachName || '').trim(), now);
    var plan = waterWriteCredits_(c.sessionId, credits);
    logChange_({ Who: by, Tab: TABS.WATER_SESSIONS, 'Row ID': c.sessionId, Field: before ? 'Re-import' : 'Import',
      'Old value': before ? before.boatName + ' ' + before.meters + ' m' : '', 'New value': c.boatName + ' ' + c.meters + ' m, ' + credits.length + ' credited', Note: 'site Water import' });
    return { status: 'ok', sessionId: c.sessionId, lineupId: lineup ? lineup.lineupId : '', reimport: !!before,
      credited: credits.map(function (r) { return { id: r['Athlete ID'], name: r.Athlete, cox: r['Work s'] === '' }; }),
      changes: { updated: plan.update.length, added: plan.add.length, removed: plan.remove.length } };
  } catch (err) {
    return { status: 'error', error: err.message };
  } finally {
    lock.releaseLock();
  }
}
