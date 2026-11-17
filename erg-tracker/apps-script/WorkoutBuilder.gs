/**
 * Coach workout builder on the team site (Plan page). Coaches only. Replaces typing rows into the
 * Workouts and Schedule tabs by hand: a coach builds a workout (name + pieces), picks dates, squad and
 * session, and the Sheet gets the Workouts rows and Schedule rows in the same shape as before, so
 * targets, plan matches and the weekly plan keep working unchanged. Rows are validated with the same
 * parser the plan uses (workoutPieces), so a workout the builder saves can always be read back.
 * New sessions are drafts unless the coach ticks Publish (Published = false hides them from athletes).
 * Pure helpers are tested in Node.
 */
var WORKOUT_SAVE_ACTION = 'workout-save';
var WORKOUT_LIST_ACTION = 'workout-list';
var WORKOUT_DELETE_ACTION = 'workout-delete';
var WORKOUT_UPDATE_ACTION = 'workout-update';
var WORKOUT_MOVE_ACTION = 'workout-move';
var WORKOUT_MAX_PIECES = 12;
var WORKOUT_SQUADS = ['All', 'Varsity', 'Novice'];
var WORKOUT_SESSIONS = ['Practice', 'OYO'];
var WORKOUT_ZONES = ['', 'Aerobic', 'Threshold', 'Anaerobic'];

/** Next free Workout ID of the form W<number> (IDs that do not match are ignored). Pure. */
function workoutNextId_(existingIds) {
  var max = 0;
  existingIds.forEach(function (id) {
    var m = /^W(\d+)$/.exec(String(id).trim());
    if (m && Number(m[1]) > max) max = Number(m[1]);
  });
  return 'W' + (max + 1);
}

/** One piece typed on the page -> a Workouts row, or { error } in plain words. Pure. */
function workoutPieceRow_(workoutId, name, n, p) {
  var where = 'Piece ' + n + ': ';
  var type = String(p.workType || '').trim();
  if (type !== 'Time' && type !== 'Distance') return { error: where + 'choose Time or Distance.' };
  var reps = Number(p.reps === undefined || p.reps === '' ? 1 : p.reps);
  if (!(reps >= 1 && reps <= 30) || Math.floor(reps) !== reps) return { error: where + 'reps must be a whole number from 1 to 30.' };
  var work = String(p.work === undefined ? '' : p.work).trim();
  if (type === 'Time') {
    var wt;
    try { wt = parseTime(work); } catch (e) { wt = null; }
    if (!(wt > 0)) return { error: where + 'work time like 20:00 is needed.' };
  } else if (!/^\d{2,5}\s*m?$/i.test(work)) {
    return { error: where + 'work distance in meters, like 500, is needed.' };
  }
  var rest = String(p.rest === undefined ? '' : p.rest).trim();
  var every = String(p.startEvery === undefined ? '' : p.startEvery).trim();
  try {
    if (rest && !/^undef/i.test(rest)) parseTime(rest);
    if (every) parseTime(every);
  } catch (e) { return { error: where + 'rest and start every are times like 2:00.' }; }
  var zone = String(p.zone || '').trim();
  if (WORKOUT_ZONES.indexOf(zone) < 0) return { error: where + 'zone must be Aerobic, Threshold or Anaerobic.' };
  var low = p.lowPct === undefined || p.lowPct === '' || p.lowPct === null ? '' : Number(p.lowPct);
  var high = p.highPct === undefined || p.highPct === '' || p.highPct === null ? '' : Number(p.highPct);
  if ((low !== '' && !(low > 0 && low <= 200)) || (high !== '' && !(high > 0 && high <= 200))) return { error: where + 'target % must be a number from 1 to 200.' };
  var base = String(p.base || '').trim();
  if (base && !PLAN_BASES[base]) return { error: where + 'base must be 2k or 20\'.' };
  var activity = String(p.activity || 'Erg (RowErg)').trim();
  if (!ACTIVITIES.some(function (a) { return a[0] === activity; })) return { error: where + 'unknown activity.' };
  // A Run by distance is kept in metres, with the unit (mi or km) the coach thinks in.
  var unit = String(p.unit || '').trim();
  if (activity === 'Run' && type === 'Distance' && !unit) unit = 'mi';
  if (unit && !(activity === 'Run' && (unit === 'mi' || unit === 'km'))) return { error: where + 'unit is mi or km, for a run.' };
  var pace = String(p.pace === undefined || p.pace === null ? '' : p.pace).trim();
  if (pace) {
    var paceS;
    try { paceS = parseTime(pace); } catch (e) { paceS = null; }
    if (!(paceS >= 60 && paceS <= 1500)) return { error: where + 'pace target is a time like 1:45.0 (per 500m), or 8:00 (per mile or km for a run).' };
  }
  return {
    'Workout ID': workoutId, 'Name': name, 'Piece #': n, 'Reps': reps, 'Work type': type,
    'Work': type === 'Distance' ? work.replace(/\s*m$/i, '') : work,
    'Rest': rest, 'Start every': every, 'Activity': activity, 'Zone': zone, 'Base': base,
    'Target low %': low, 'Target high %': high, 'Rate': String(p.rate || '').trim().slice(0, 20),
    'Notes': String(p.notes || '').trim().slice(0, 200),
    'Unit': unit, 'Pace target': pace
  };
}

/** body.name + body.pieces -> { rows } for the Workouts tab, or { error }. Checked with the plan's own parser. Pure. */
function workoutBuildRows_(workoutId, body) {
  var name = String(body.name || '').trim().slice(0, 60);
  if (!name) return { error: 'Give the workout a name.' };
  var pieces = body.pieces;
  if (!Array.isArray(pieces) || !pieces.length) return { error: 'Add at least one piece.' };
  if (pieces.length > WORKOUT_MAX_PIECES) return { error: 'A workout can have up to ' + WORKOUT_MAX_PIECES + ' pieces.' };
  var rows = [];
  for (var i = 0; i < pieces.length; i++) {
    var r = workoutPieceRow_(workoutId, name, i + 1, pieces[i] || {});
    if (r.error) return r;
    rows.push(r);
  }
  try { workoutPieces(rows, workoutId); } catch (e) { return { error: String(e.message || e) }; }
  return { rows: rows };
}

/** body.dates (YYYY-MM-DD list), squad, session, publish, notes -> Schedule rows, or { error }. Pure. */
function scheduleBuildRows_(workoutId, body, nextOrder) {
  var dates = Array.isArray(body.dates) ? body.dates : [];
  if (!dates.length) return { rows: [] };   // saving to the library only
  if (dates.length > 31) return { error: 'Pick up to 31 dates at a time.' };
  var squad = String(body.squad || 'All').trim();
  var session = String(body.session || 'Practice').trim();
  if (WORKOUT_SQUADS.indexOf(squad) < 0) return { error: 'Squad must be All, Varsity or Novice.' };
  if (WORKOUT_SESSIONS.indexOf(session) < 0) return { error: 'Session must be Practice or OYO.' };
  var seen = {}, rows = [];
  for (var i = 0; i < dates.length; i++) {
    var d = String(dates[i]);
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    var dt = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
    if (!dt || dt.getMonth() !== Number(m[2]) - 1) return { error: 'Dates must look like 2026-11-16.' };
    if (seen[d]) continue;
    seen[d] = true;
    rows.push({ 'Date': dt, 'Squad': squad, 'Session': session, 'Workout ID': workoutId, 'Published': body.publish === true, 'Notes': String(body.notes || '').trim().slice(0, 200), 'Order': (nextOrder && nextOrder[d]) || 1 });
  }
  return { rows: rows };
}

/** Upcoming sessions (from fromDay for 28 days) and the workout library (id, name, summary), newest ID first. Pure. */
function workoutListView_(workouts, schedule, fromDay) {
  var names = {}, pieces = {}, order = [];
  workouts.forEach(function (w) {
    var id = String(w['Workout ID'] || '').trim();
    if (!id) return;
    if (!(id in names)) { names[id] = String(w.Name || '').trim(); pieces[id] = []; order.push(id); }
    pieces[id].push(w);
  });
  var library = order.map(function (id) {
    var label = '';
    try { label = workoutPieces(pieces[id], id).map(pieceLabel).join(' + '); } catch (e) { label = ''; }
    return { id: id, name: names[id], summary: label, pieces: pieces[id].map(workoutPieceCompact_) };
  }).reverse();
  var until = dayKey_(new Date(Number(fromDay.slice(0, 4)), Number(fromDay.slice(5, 7)) - 1, Number(fromDay.slice(8, 10)) + 28));
  var nameOf = function (id) { return names[String(id).trim()] || ''; };
  var upcoming = scheduleSorted_(schedule, nameOf).filter(function (r) {
    var d = feedDay_(r.Date);
    return d && d >= fromDay && d < until && String(r['Workout ID'] || '').trim() !== '';
  }).map(function (r) {
    var id = String(r['Workout ID']).trim();
    return { day: feedDay_(r.Date), squad: String(r.Squad || 'All').trim() || 'All', session: String(r.Session || 'Practice').trim() || 'Practice',
      workoutId: id, name: names[id] || '', published: isActive_(r.Published), notes: String(r.Notes || '') };
  });
  return { library: library, upcoming: upcoming };
}

/** One Workouts row for the site's editor: only the filled-in fields, as text. Pure. */
function workoutPieceCompact_(w) {
  var map = { workType: 'Work type', reps: 'Reps', work: 'Work', rest: 'Rest', startEvery: 'Start every', activity: 'Activity', zone: 'Zone',
    base: 'Base', lowPct: 'Target low %', highPct: 'Target high %', rate: 'Rate', notes: 'Notes', unit: 'Unit', pace: 'Pace target' };
  var o = {};
  Object.keys(map).forEach(function (k) {
    var v = w[map[k]];
    if (v !== '' && v !== null && v !== undefined) o[k] = String(v).trim();
  });
  return o;
}

/**
 * Where a session sits within its day. An explicit Order wins; rows with no Order (older rows) count as warm up,
 * then the work, then cool down by workout name, so a day nobody has reordered looks the same as before.
 * Returns one number per row. Pure.
 */
function scheduleOrderKeys_(rows, nameOf) {
  var byDay = {}, keys = new Array(rows.length);
  rows.forEach(function (r, i) { var d = feedDay_(r.Date); (byDay[d] = byDay[d] || []).push(i); });
  Object.keys(byDay).forEach(function (d) {
    var blanks = [];
    byDay[d].forEach(function (i) {
      var raw = rows[i].Order, n = Number(raw);
      if (raw !== '' && raw !== null && raw !== undefined && isFinite(n)) keys[i] = n; else blanks.push(i);
    });
    var rank = function (i) { var nm = nameOf(rows[i]['Workout ID']); return /warm/i.test(nm) ? 0 : /cool/i.test(nm) ? 2 : 1; };
    blanks.sort(function (a, b) { return rank(a) - rank(b) || a - b; });
    blanks.forEach(function (i, k) { keys[i] = k + 1; });
  });
  return keys;
}

/** Indexes into rows in display order: by day, then by position in the day. Pure. */
function scheduleSortedIdx_(rows, nameOf) {
  var keys = scheduleOrderKeys_(rows, nameOf), day = rows.map(function (r) { return feedDay_(r.Date); });
  return rows.map(function (r, i) { return i; }).sort(function (a, b) {
    return day[a] < day[b] ? -1 : day[a] > day[b] ? 1 : (keys[a] - keys[b]) || (a - b);
  });
}

function scheduleSorted_(rows, nameOf) {
  return scheduleSortedIdx_(rows, nameOf).map(function (i) { return rows[i]; });
}

/** True when two workouts (arrays of Workouts-row objects) are the same name and pieces, whatever their IDs. Pure. */
function workoutRowsSame_(a, b) {
  if (a.length !== b.length) return false;
  var keys = HEADERS[TABS.WORKOUTS].filter(function (k) { return k !== 'Workout ID'; });
  for (var i = 0; i < a.length; i++) {
    for (var j = 0; j < keys.length; j++) {
      var x = a[i][keys[j]], y = b[i][keys[j]];
      if (String(x === undefined || x === null ? '' : x).trim() !== String(y === undefined || y === null ? '' : y).trim()) return false;
    }
  }
  return true;
}

/** The library ID of a workout identical to these new rows, or ''. Saves reuse it instead of filling the library with copies. Pure. */
function workoutFindSame_(existing, newRows) {
  var groups = {}, ids = [];
  existing.forEach(function (w) {
    var id = String(w['Workout ID'] || '').trim();
    if (!id) return;
    if (!(id in groups)) { groups[id] = []; ids.push(id); }
    groups[id].push(w);
  });
  for (var i = 0; i < ids.length; i++) if (workoutRowsSame_(groups[ids[i]], newRows)) return ids[i];
  return '';
}

/** Makes sure the Workouts tab has its Unit and Pace target headers (older Sheets get them on first save). */
function workoutsEnsureColumns_() {
  var sheet = tab_(TABS.WORKOUTS), heads = HEADERS[TABS.WORKOUTS];
  ['Unit', 'Pace target'].forEach(function (h) {
    var col = heads.indexOf(h) + 1;
    if (sheet.getMaxColumns() < col) sheet.insertColumnsAfter(sheet.getMaxColumns(), col - sheet.getMaxColumns());
    var cell = sheet.getRange(1, col);
    if (!String(cell.getValue() || '').trim()) {
      cell.setValue(h).setFontWeight('bold');
      if (h === 'Pace target') sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('@');
    }
  });
}

/** Makes sure the Schedule tab has its Order header (older Sheets get it on first use, no setup run needed). */
function scheduleEnsureOrderHeader_() {
  var sheet = tab_(TABS.SCHEDULE), col = HEADERS[TABS.SCHEDULE].indexOf('Order') + 1;
  var cell = sheet.getRange(1, col);
  if (!String(cell.getValue() || '').trim()) cell.setValue('Order').setFontWeight('bold');
}

/** The next free position on each of these days (existing rows count). Pure. */
function scheduleNextOrder_(schedule, nameOf, days) {
  var keys = scheduleOrderKeys_(schedule, nameOf), out = {};
  days.forEach(function (d) { out[d] = 0; });
  schedule.forEach(function (r, i) { var d = feedDay_(r.Date); if (d in out && keys[i] > out[d]) out[d] = keys[i]; });
  days.forEach(function (d) { out[d] += 1; });
  return out;
}

function processWorkoutList_() {
  var t = weightsTodayAndYear_();
  var v = workoutListView_(readObjects_(TABS.WORKOUTS), readObjects_(TABS.SCHEDULE), t.today);
  return { status: 'ok', today: t.today, library: v.library, upcoming: v.upcoming };
}

/**
 * body: { name, pieces[], dates[], squad, session, publish, notes, workoutId?, coachName, requestId }.
 * With workoutId, an existing workout is scheduled as is; otherwise a new one is saved with the next ID.
 */
function processWorkoutSave_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    scheduleEnsureOrderHeader_();
    var by = String(body.coachName || 'Coach').trim().slice(0, 60) || 'Coach';
    var existing = readObjects_(TABS.WORKOUTS);
    var id = String(body.workoutId || '').trim();
    var wrows = [];
    if (id) {
      if (!existing.some(function (w) { return String(w['Workout ID']).trim() === id; })) return { status: 'invalid', message: 'That workout is not in the library.' };
      if (!Array.isArray(body.dates) || !body.dates.length) return { status: 'invalid', message: 'Pick at least one date.' };
    } else {
      id = workoutNextId_(existing.map(function (w) { return w['Workout ID']; }));
      var b = workoutBuildRows_(id, body);
      if (b.error) return { status: 'invalid', message: b.error };
      var same = workoutFindSame_(existing, b.rows);   // already saved: reuse it, no copy
      if (same) id = same; else wrows = b.rows;
    }
    var schedule = readObjects_(TABS.SCHEDULE);
    var names = workoutNameMap_(existing.concat(wrows));
    var nameOf = function (wid) { return names[String(wid).trim()] || ''; };
    var s = scheduleBuildRows_(id, body, scheduleNextOrder_(schedule, nameOf, Array.isArray(body.dates) ? body.dates.map(String) : []));
    if (s.error) return { status: 'invalid', message: s.error };
    var dupes = s.rows.filter(function (r) { return scheduleRowsToDelete_(schedule, { day: dayKey_(r.Date), workoutId: id, squad: r.Squad, session: r.Session }).length; });
    if (dupes.length) {
      return { status: 'invalid', message: 'Already planned: ' + (names[id] || id) + ' for ' + dupes[0].Squad + ' ' + dupes[0].Session + ' on ' + dupes.map(function (r) { return dayKey_(r.Date); }).join(', ') + '. Nothing was saved.' };
    }
    if (wrows.length) {
      workoutsEnsureColumns_();
      appendObjects_(TABS.WORKOUTS, wrows);
      logChange_({ Who: by, Tab: TABS.WORKOUTS, 'Row ID': id, Field: 'Workout', 'Old value': '', 'New value': wrows[0].Name + ' (' + wrows.length + ' pieces)', Note: 'site Plan page' });
    }
    if (s.rows.length) {
      appendObjects_(TABS.SCHEDULE, s.rows);
      logChange_({ Who: by, Tab: TABS.SCHEDULE, 'Row ID': id, Field: 'Sessions', 'Old value': '', 'New value': s.rows.length + ' on ' + s.rows.map(function (r) { return dayKey_(r.Date); }).join(', '), Note: 'site Plan page' + (body.publish === true ? ' (published)' : ' (draft)') });
    }
    var out = processWorkoutList_();
    out.savedId = id;
    return out;
  } finally {
    lock.releaseLock();
  }
}

/** {Workout ID: Name} from Workouts rows. Pure. */
function workoutNameMap_(rows) {
  var names = {};
  rows.forEach(function (w) { var id = String(w['Workout ID'] || '').trim(); if (id && !(id in names)) names[id] = String(w.Name || '').trim(); });
  return names;
}

/**
 * Schedule row numbers (sheet rows, header = 1) that are exactly this one session: same day, workout, squad and
 * session. One delete takes out one session, never the whole day, and the Varsity and Novice rows of the same
 * workout are separate sessions. Identical duplicate rows go together. Pure.
 */
function scheduleRowMatches_(r, key) {
  var squad = String(key.squad || 'All').trim() || 'All', session = String(key.session || 'Practice').trim() || 'Practice';
  return feedDay_(r.Date) === key.day && String(r['Workout ID'] || '').trim() === key.workoutId &&
    (String(r.Squad || 'All').trim() || 'All') === squad && (String(r.Session || 'Practice').trim() || 'Practice') === session;
}

function scheduleRowsToDelete_(schedule, key) {
  var rows = [];
  schedule.forEach(function (r, i) { if (scheduleRowMatches_(r, key)) rows.push(i + 2); });
  return rows;
}

/**
 * body: { day, workoutId, squad, session, coachName }. Removes that one session from the Schedule tab and nothing
 * else: the workout stays in the Workouts library so it can be scheduled again, and days before today are left alone
 * so old results keep the plan they were checked against. The Change log keeps who removed what.
 */
function processWorkoutDelete_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    scheduleEnsureOrderHeader_();
    var by = String(body.coachName || 'Coach').trim().slice(0, 60) || 'Coach';
    var key = { day: String(body.day || '').trim(), workoutId: String(body.workoutId || '').trim(), squad: body.squad, session: body.session };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key.day) || !key.workoutId) return { status: 'invalid', message: 'Pick a session to remove.' };
    if (key.day < weightsTodayAndYear_().today) return { status: 'invalid', message: 'Past days stay as they were, so old results keep their plan.' };
    var hits = scheduleRowsToDelete_(readObjects_(TABS.SCHEDULE), key);
    if (!hits.length) { var again = processWorkoutList_(); again.removed = 0; return again; }   // already gone (another coach got there first)
    var sheet = tab_(TABS.SCHEDULE);
    var what = key.day + ' ' + (String(key.squad || 'All')) + ' ' + (String(key.session || 'Practice'));
    hits.slice().reverse().forEach(function (row) { sheet.deleteRow(row); });   // bottom first so the numbers stay right
    logChange_({ Who: by, Tab: TABS.SCHEDULE, 'Row ID': key.workoutId, Field: 'Sessions', 'Old value': what, 'New value': '(removed)', Note: 'site Plan page' });
    var out = processWorkoutList_();
    out.removed = hits.length;
    return out;
  } finally {
    lock.releaseLock();
  }
}

/** Reads and checks the one-session key every change needs. Returns { key } or { error }. Past days are never changed. */
function scheduleKeyFromBody_(body) {
  var key = { day: String(body.day || '').trim(), workoutId: String(body.workoutId || '').trim(), squad: body.squad, session: body.session };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key.day) || !key.workoutId) return { error: 'Pick a session first.' };
  if (key.day < weightsTodayAndYear_().today) return { error: 'Past days stay as they were, so old results keep their plan.' };
  return { key: key };
}

/**
 * body: { day, workoutId, squad, session, to: { name, pieces, workoutId, squad, session, notes, publish }, coachName }.
 * Changes that one session (Schedule row) in place. New pieces become a new library workout (or reuse an identical
 * one), so other days that use the old workout do not change. Fields left out of "to" stay as they are.
 */
function processWorkoutUpdate_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    scheduleEnsureOrderHeader_();
    var by = String(body.coachName || 'Coach').trim().slice(0, 60) || 'Coach';
    var k = scheduleKeyFromBody_(body);
    if (k.error) return { status: 'invalid', message: k.error };
    var key = k.key, to = body.to || {};
    var schedule = readObjects_(TABS.SCHEDULE);
    var hits = scheduleRowsToDelete_(schedule, key);
    if (!hits.length) return { status: 'invalid', message: 'That workout is no longer on this day. Check the week and try again.' };
    var squad = to.squad === undefined || to.squad === '' ? (String(key.squad || 'All').trim() || 'All') : String(to.squad).trim();
    var session = to.session === undefined || to.session === '' ? (String(key.session || 'Practice').trim() || 'Practice') : String(to.session).trim();
    if (WORKOUT_SQUADS.indexOf(squad) < 0) return { status: 'invalid', message: 'Squad must be All, Varsity or Novice.' };
    if (WORKOUT_SESSIONS.indexOf(session) < 0) return { status: 'invalid', message: 'Session must be Practice or OYO.' };
    var existing = readObjects_(TABS.WORKOUTS), id = key.workoutId, wrows = [];
    if (to.pieces !== undefined) {
      id = workoutNextId_(existing.map(function (w) { return w['Workout ID']; }));
      var b = workoutBuildRows_(id, to);
      if (b.error) return { status: 'invalid', message: b.error };
      var same = workoutFindSame_(existing, b.rows);
      if (same) id = same; else wrows = b.rows;
    } else if (to.workoutId) {
      id = String(to.workoutId).trim();
      if (!existing.some(function (w) { return String(w['Workout ID']).trim() === id; })) return { status: 'invalid', message: 'That workout is not in the library.' };
    }
    var next = { day: key.day, workoutId: id, squad: squad, session: session };
    var moved = id !== key.workoutId || squad !== (String(key.squad || 'All').trim() || 'All') || session !== (String(key.session || 'Practice').trim() || 'Practice');
    if (moved && scheduleRowsToDelete_(schedule, next).length) {
      return { status: 'invalid', message: 'That workout is already planned for ' + squad + ' ' + session + ' on ' + key.day + '. Nothing was changed.' };
    }
    if (wrows.length) {
      workoutsEnsureColumns_();
      appendObjects_(TABS.WORKOUTS, wrows);
      logChange_({ Who: by, Tab: TABS.WORKOUTS, 'Row ID': id, Field: 'Workout', 'Old value': '', 'New value': wrows[0].Name + ' (' + wrows.length + ' pieces)', Note: 'site Plan page (edit)' });
    }
    var sheet = tab_(TABS.SCHEDULE), heads = HEADERS[TABS.SCHEDULE];
    var put = function (row, header, v) { sheet.getRange(row, heads.indexOf(header) + 1).setValue(v); };
    hits.forEach(function (row) {
      put(row, 'Workout ID', id);
      put(row, 'Squad', squad);
      put(row, 'Session', session);
      if (to.notes !== undefined) put(row, 'Notes', String(to.notes || '').trim().slice(0, 200));
      if (typeof to.publish === 'boolean') put(row, 'Published', to.publish);
    });
    var was = key.workoutId + ' ' + (String(key.squad || 'All')) + ' ' + (String(key.session || 'Practice'));
    logChange_({ Who: by, Tab: TABS.SCHEDULE, 'Row ID': id, Field: 'Sessions', 'Old value': key.day + ' ' + was, 'New value': key.day + ' ' + id + ' ' + squad + ' ' + session +
      (typeof to.publish === 'boolean' ? (to.publish ? ' (published)' : ' (draft)') : ''), Note: 'site Plan page (edit)' });
    var out = processWorkoutList_();
    out.savedId = id;
    return out;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Where the session at position `pos` of a day's list ends up when moved by dir (-1 earlier, +1 later). Returns the
 * list of indexes in the new order, or null when it cannot move that way. Pure.
 */
function scheduleMoveList_(dayIdx, pos, dir) {
  var to = pos + dir;
  if (pos < 0 || to < 0 || to >= dayIdx.length) return null;
  var out = dayIdx.slice(), t = out[pos];
  out[pos] = out[to]; out[to] = t;
  return out;
}

/** body: { day, workoutId, squad, session, dir: -1 | 1, coachName }. Moves one session earlier or later within its day and renumbers the day. */
function processWorkoutMove_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    scheduleEnsureOrderHeader_();
    var by = String(body.coachName || 'Coach').trim().slice(0, 60) || 'Coach';
    var k = scheduleKeyFromBody_(body);
    if (k.error) return { status: 'invalid', message: k.error };
    var dir = Number(body.dir);
    if (dir !== -1 && dir !== 1) return { status: 'invalid', message: 'Move it up or down.' };
    var schedule = readObjects_(TABS.SCHEDULE), names = workoutNameMap_(readObjects_(TABS.WORKOUTS));
    var order = scheduleSortedIdx_(schedule, function (id) { return names[String(id).trim()] || ''; });
    var dayIdx = order.filter(function (i) { return feedDay_(schedule[i].Date) === k.key.day && String(schedule[i]['Workout ID'] || '').trim() !== ''; });
    var pos = -1;
    dayIdx.forEach(function (i, p) { if (pos < 0 && scheduleRowMatches_(schedule[i], k.key)) pos = p; });
    if (pos < 0) return { status: 'invalid', message: 'That workout is no longer on this day. Check the week and try again.' };
    var moved = scheduleMoveList_(dayIdx, pos, dir);
    if (moved) {
      var sheet = tab_(TABS.SCHEDULE), col = HEADERS[TABS.SCHEDULE].indexOf('Order') + 1;
      moved.forEach(function (i, p) { sheet.getRange(i + 2, col).setValue(p + 1); });
      logChange_({ Who: by, Tab: TABS.SCHEDULE, 'Row ID': k.key.workoutId, Field: 'Order', 'Old value': k.key.day + ' position ' + (pos + 1), 'New value': 'position ' + (pos + dir + 1), Note: 'site Plan page' });
    }
    return processWorkoutList_();
  } finally {
    lock.releaseLock();
  }
}
