/**
 * Coach override of one athlete's practice mark for one day (David, 2026-11-18). A coach on the site's
 * Attendance page picks an athlete, a practice day and a mark: Completed, Modified or Missed. Example: novices
 * who showed up on a day with no assigned workout to log. It changes that day's Practice entries, or adds one
 * with no work (so no minutes) when there are none, and sets Review status "Reviewed, Coach" so the plan check
 * never flips it back. Missed keeps the entry and its minutes but the practice is absent with the make-up open.
 * Every change is in the Change log (Who = Coach <name>). Make-up entries are not touched.
 */
var ATTENDANCE_MARK_ACTION = 'attendance-mark';
var ATTENDANCE_MARK_REVIEW = 'Reviewed, Coach';
var ATTENDANCE_MARKS = { Full: 'Full', Modified: 'Modified', Missed: 'Missed' };

/**
 * Pure: what to write. entries = Entries rows (objects with 'Entry ID', 'Athlete ID', 'Session type', Status,
 * 'Review status', Date as 'YYYY-MM-DD' in `day`). Returns { update: [Entry IDs], create: bool, nothing: bool }.
 * A Missed mark with no Practice entry changes nothing: no entry already shows as missed.
 */
function attendanceMarkPlan_(entries, athleteId, date, mark, day) {
  var same = entries.filter(function (e) {
    return String(e['Athlete ID']) === String(athleteId) && String(e['Session type']) === 'Practice' &&
      day(e.Date) === date && !/reject/i.test(String(e['Review status'] || ''));
  });
  if (same.length) return { update: same.map(function (e) { return e['Entry ID']; }), create: false, nothing: false };
  if (mark === 'Missed') return { update: [], create: false, nothing: true };
  return { update: [], create: true, nothing: false };
}

/**
 * doPost action 'attendance-mark': body { athleteId, date, mark, note, coachName, requestId }. Answers
 * { status: 'ok' | 'invalid' | 'duplicate' | 'error', message, changed, created }.
 */
function processAttendanceMark_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var id = String(body.athleteId || '').trim(), date = String(body.date || '').trim();
    var mark = ATTENDANCE_MARKS[String(body.mark || '')];
    if (!mark) return { status: 'invalid', message: 'Pick Completed, Modified or Missed.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { status: 'invalid', message: 'Pick a practice day.' };
    var a = readObjects_(TABS.ROSTER).filter(function (r) { return String(r['Athlete ID']).trim() === id && isActive_(r.Active) && String(r.Name || '').trim(); })[0];
    if (!a) return { status: 'invalid', message: 'That athlete is not on the roster.' };
    var tz = ss_().getSpreadsheetTimeZone();
    var day = function (d) { return d instanceof Date ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : ''; };
    var practice = classifierPractices_(day).filter(function (p) { return p.date === date && !p.canceled && practiceForSquad_(p.squad, a.Squad); })[0];
    if (!practice) return { status: 'invalid', message: 'There is no practice for ' + String(a.Name).trim() + ' on that day.' };
    var rid = 'site-mark:' + String(body.requestId || '');
    if (body.requestId && alreadyProcessed_(rid)) return { status: 'duplicate' };
    var by = 'Coach ' + (String(body.coachName || 'via site').trim().slice(0, 60) || 'via site');
    var note = String(body.note || '').trim().slice(0, 200);
    var plan = attendanceMarkPlan_(readObjects_(TABS.ENTRIES), id, date, mark, day);
    if (plan.nothing) return { status: 'ok', changed: 0, created: false, message: 'Nothing to change: with no practice entry, she already shows as missed.' };
    if (plan.create) {
      var entryId = newId_('E');
      appendObject_(TABS.ENTRIES, {
        'Entry ID': entryId, 'Submitted at': new Date(), 'Date': parseFormDate_(date), 'Athlete ID': id, 'Athlete': String(a.Name).trim(),
        'Entered by': by, 'Session type': 'Practice', 'Status': mark, 'Source': 'Site', 'Review status': ATTENDANCE_MARK_REVIEW,
        'Response ID': rid, 'Coach note': note
      });
      logChange_({ Who: by, Tab: TABS.ENTRIES, 'Row ID': entryId, Field: 'Status', 'Old value': '(no entry)', 'New value': mark, Note: ('attendance mark ' + date + ' ' + a.Name + (note ? ': ' + note : '')).slice(0, 200) });
    } else {
      plan.update.forEach(function (eid) {
        var entry = entryRowById_(eid);
        if (!entry) return;
        var set = { 'Status': mark, 'Review status': ATTENDANCE_MARK_REVIEW };
        if (note) set['Coach note'] = String(entry['Coach note'] || '') ? String(entry['Coach note']) + ' | ' + note : note;
        writeEntryCells_(entry, set, by, 'attendance mark ' + date);
      });
    }
    SpreadsheetApp.flush();
    return { status: 'ok', changed: plan.update.length, created: plan.create };
  } catch (err) {
    logChange_({ Who: 'site', Tab: '(attendance mark)', 'Row ID': String(body.requestId || ''), Note: 'ATTENDANCE MARK ERROR: ' + err.message });
    return { status: 'error', error: err.message };
  } finally {
    lock.releaseLock();
  }
}
