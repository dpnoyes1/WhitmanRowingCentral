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
  return {
    'Workout ID': workoutId, 'Name': name, 'Piece #': n, 'Reps': reps, 'Work type': type,
    'Work': type === 'Distance' ? work.replace(/\s*m$/i, '') : work,
    'Rest': rest, 'Start every': every, 'Activity': activity, 'Zone': zone, 'Base': base,
    'Target low %': low, 'Target high %': high, 'Rate': String(p.rate || '').trim().slice(0, 20),
    'Notes': String(p.notes || '').trim().slice(0, 200)
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
function scheduleBuildRows_(workoutId, body) {
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
    rows.push({ 'Date': dt, 'Squad': squad, 'Session': session, 'Workout ID': workoutId, 'Published': body.publish === true, 'Notes': String(body.notes || '').trim().slice(0, 200) });
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
    return { id: id, name: names[id], summary: label };
  }).reverse();
  var until = dayKey_(new Date(Number(fromDay.slice(0, 4)), Number(fromDay.slice(5, 7)) - 1, Number(fromDay.slice(8, 10)) + 28));
  var upcoming = schedule.filter(function (r) {
    var d = feedDay_(r.Date);
    return d && d >= fromDay && d < until && String(r['Workout ID'] || '').trim() !== '';
  }).map(function (r) {
    var id = String(r['Workout ID']).trim();
    return { day: feedDay_(r.Date), squad: String(r.Squad || 'All').trim() || 'All', session: String(r.Session || 'Practice').trim() || 'Practice',
      workoutId: id, name: names[id] || '', published: isActive_(r.Published), notes: String(r.Notes || '') };
  }).sort(function (a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : 0; });
  return { library: library, upcoming: upcoming };
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
      wrows = b.rows;
    }
    var s = scheduleBuildRows_(id, body);
    if (s.error) return { status: 'invalid', message: s.error };
    if (wrows.length) {
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
