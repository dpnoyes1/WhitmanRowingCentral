/**
 * Coach Weights page on the team site (David, 2026-11-11). Coaches only. Weight stays out of the
 * feed (rule 3); this page reads the Weights tab live through the feed key, like the Settings
 * page, and a coach types a current weight here instead of in the hidden tab. Only the current
 * weight shows. Every entry is a new dated row, so past tests keep the weight they were scored
 * with (a result uses the most recent weight on or before its test date, or her latest weight when there
 * is none before). No history, trend or graph.
 * Status: Missing = none on file (tests score unadjusted); Due = last entered before this school
 * year began; Current = entered this school year. The pure parts are tested in Node.
 */
var WEIGHTS_GET_ACTION = 'weights-get';
var WEIGHTS_SAVE_ACTION = 'weights-save';
var WEIGHT_MIN_LB = 60;
var WEIGHT_MAX_LB = 300;

/** Weight typed on the page -> { lb } or { error } in plain words. */
function weightsParse_(raw) {
  var t = String(raw === undefined || raw === null ? '' : raw).trim().replace(/\s*lbs?\.?$/i, '');
  if (t === '') return { error: 'Needed.' };
  if (!/^\d{2,3}(\.\d)?$/.test(t)) return { error: 'Use a number of pounds, like 128 or 128.5.' };
  var n = Number(t);
  if (n < WEIGHT_MIN_LB || n > WEIGHT_MAX_LB) return { error: 'Use a weight from ' + WEIGHT_MIN_LB + ' to ' + WEIGHT_MAX_LB + ' lb.' };
  return { lb: n };
}

/** Status for a latest-entry day (YYYY-MM-DD or ''), against the school year's first day. */
function weightsStatus_(latestDay, yearStartDay) {
  if (!latestDay) return 'Missing';
  return latestDay < yearStartDay ? 'Due' : 'Current';
}

/**
 * One row per active rower: her most recent weight and who entered it, with its status. Weights rows may
 * carry a Date cell or YYYY-MM-DD text (feedDay_ reads both). Pure.
 */
function weightsPageRows_(roster, weights, yearStartDay) {
  var latest = {};
  weights.forEach(function (w) {
    var id = String(w['Athlete ID'] || '').trim(), day = feedDay_(w.Date), lb = Number(w['Weight lb']);
    if (!id || !day || !lb) return;
    if (!latest[id] || day >= latest[id].day) latest[id] = { day: day, lb: lb, by: String(w['Entered by'] || '').trim() };
  });
  return roster.filter(function (r) {
    return String(r.Name || '').trim() !== '' && String(r['Athlete ID'] || '').trim() !== '' && isActive_(r.Active) && !/cox/i.test(String(r.Role)) && !isAlumSquad_(r.Squad);
  }).map(function (r) {
    var id = String(r['Athlete ID']).trim(), l = latest[id] || null;
    return { id: id, name: String(r.Name).trim(), squad: String(r.Squad || '').trim(),
      lb: l ? l.lb : null, day: l ? l.day : '', by: l ? l.by : '', status: weightsStatus_(l ? l.day : '', yearStartDay) };
  }).sort(function (a, b) {
    var rank = { Missing: 0, Due: 1, Current: 2 };
    return rank[a.status] - rank[b.status] || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  });
}

function weightsTodayAndYear_() {
  var s = getSettings(), tz = s.timezone || 'America/New_York', now = new Date();
  var today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var parts = today.split('-').map(Number);
  return { today: today, yearStart: dayKey_(schoolYearStart(new Date(parts[0], parts[1] - 1, parts[2]), s.school_year_start)) };
}

function processWeightsGet_() {
  var t = weightsTodayAndYear_();
  return { status: 'ok', today: t.today, yearStart: t.yearStart, rows: weightsPageRows_(readObjects_(TABS.ROSTER), readObjects_(TABS.WEIGHTS), t.yearStart) };
}

/** body: { athleteId, lb, coachName }. Adds one dated Weights row and logs it. */
function processWeightsSave_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var p = weightsParse_(body.lb);
    if (p.error) return { status: 'invalid', message: p.error };
    var id = String(body.athleteId || '').trim();
    var rows = weightsPageRows_(readObjects_(TABS.ROSTER), readObjects_(TABS.WEIGHTS), '0000-00-00');
    var a = rows.filter(function (r) { return r.id === id; })[0];
    if (!a) return { status: 'invalid', message: 'That athlete is not on the roster.' };
    var t = weightsTodayAndYear_(), d = t.today.split('-').map(Number);
    var by = String(body.coachName || 'Coach').trim().slice(0, 60) || 'Coach';
    appendObject_(TABS.WEIGHTS, { Date: new Date(d[0], d[1] - 1, d[2]), 'Athlete ID': id, Athlete: a.name, 'Weight lb': p.lb, 'Entered by': by, Note: 'site Weights page' });
    logChange_({ Who: by, Tab: TABS.WEIGHTS, 'Row ID': id, Field: 'Weight lb', 'Old value': a.lb === null ? '' : a.lb, 'New value': p.lb, Note: 'site Weights page' });
    SpreadsheetApp.flush();
    return { status: 'ok', rows: weightsPageRows_(readObjects_(TABS.ROSTER), readObjects_(TABS.WEIGHTS), t.yearStart), today: t.today, yearStart: t.yearStart };
  } catch (err) {
    return { status: 'error', error: err.message };
  } finally {
    lock.releaseLock();
  }
}
