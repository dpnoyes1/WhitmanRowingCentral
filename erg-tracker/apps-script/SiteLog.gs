/**
 * Coach "Log for an athlete" on the team site (David, 2026-11-11). A signed-in coach picks an athlete, a
 * date, the workout type and types the numbers; the site function sends them here and they go through the
 * same parseSubmission as the Form and /log, so the rows are identical. Source = Site, Entered by = the coach.
 * Nothing about the athlete's weight is touched. The test question (asked only for ONE piece of exactly
 * 2000 m, 500 m, 100 m or 20:00.0, never inside intervals, never a near miss) is answered on the page; Yes
 * goes the Form's Benchmark test path (linked Benchmarks and Entries rows), No saves a normal workout.
 * 500 m and 100 m are power checks: they are on the boards but carry no stars (a test with no GMS stars).
 */
var SITE_LOG_ACTION = 'site-log';
var SITE_TEST_METERS = { 2000: '2000m', 500: '500m', 100: '100m' };

/**
 * The one test a piece could be, or null. pieces = parsePiecesText output. One piece only: exactly 2000 m,
 * 500 m or 100 m (any time) is a timed test; exactly 20:00.0 (any meters) is the 20'. Anything else, or
 * more than one piece, is not a test and never asks.
 */
function siteTestKind_(pieces) {
  if (!pieces || pieces.length !== 1) return null;
  var p = pieces[0];
  if (parseTime(p.WORK_TIME) === 1200) return '20min';
  var m = Number(p.WORK_M);
  return SITE_TEST_METERS[m] ? SITE_TEST_METERS[m] : null;
}

/**
 * Site form -> Form answers. form: { date, type: practice|oyo|makeup, status, makeup_for, activity, pieces,
 * warmup, cooldown, rpe, drag, main_set, zone, note, test: 'yes'|'no' }. Only fields a coach types are
 * needed; the rest fall back to blank (RowErg, Aerobic). A 'yes' with a piece that is not a test throws.
 */
function siteLogAnswers_(form, athleteName, enteredBy) {
  var f = {};
  Object.keys(form || {}).forEach(function (k) { f[k] = form[k] === undefined || form[k] === null ? '' : String(form[k]).trim(); });
  f.activity = f.activity || 'Erg (RowErg)';
  f.zone = f.zone || 'Aerobic';
  var kind = f.type === 'out' || f.status === 'out' ? null : siteTestKind_(parsePiecesText(f.pieces));
  if (f.test === 'yes') {
    if (!kind) throw new Error('That piece is not exactly 2000 m, 500 m, 100 m or 20:00, so it cannot be saved as a test');
    if (f.activity !== 'Erg (RowErg)') throw new Error('A test is on the RowErg');
    if (kind === '20min' || kind === '2000m') {
      f.type = 'test';
      return slackLogAnswers(f, athleteName, enteredBy);
    }
    var p = parsePiecesText(f.pieces)[0], a = {};
    a[Q.ATHLETE] = athleteName;
    a[Q.ENTERED_BY] = enteredBy || athleteName;
    a[Q.DATE] = f.date;
    a[Q.LOG_TYPE] = LOG_TYPES.BENCHMARK;
    a[Q.B_WHERE] = f.test_where === 'oyo' ? TEST_WHERE.OYO : TEST_WHERE.PRACTICE;
    a[Q.TEST] = kind;
    a[Q.B_WARMUP] = f.warmup;
    a[Q.B_COOLDOWN] = f.cooldown;
    a[Q.B_RPE] = f.rpe;
    a[Q.T_TIME] = p.WORK_TIME;
    a[Q.T_RATE] = p.RATE;
    a[Q.T_DRAG] = f.drag;
    a[Q.T_NOTE] = f.note;
    return a;
  }
  if (f.type === 'test') throw new Error('Pick Practice, OYO or Make-up');
  if (!f.main_set && !(f.type === 'practice' && f.status === 'out')) {
    var ps = parsePiecesText(f.pieces);
    f.main_set = ps.length === 1 ? ps[0].WORK_M + ' m' : ps.length + ' x ' + ps[0].WORK_M + ' m';
  }
  return slackLogAnswers(f, athleteName, enteredBy);
}

/**
 * doPost action 'site-log': body { athleteId, coachName, requestId, form }. Answers
 * { status: 'ok' | 'invalid' | 'duplicate' | 'error', message, entryId, athlete, test }. One write under the script lock;
 * requestId stops a double tap from saving twice.
 */
function processSiteLog_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var roster = readObjects_(TABS.ROSTER), id = String(body.athleteId || '').trim();
    var a = roster.filter(function (r) { return String(r['Athlete ID']).trim() === id && isActive_(r.Active) && String(r.Name || '').trim(); })[0];
    if (!a) return { status: 'invalid', message: 'That athlete is not on the roster.' };
    var rid = 'site:' + String(body.requestId || '');
    if (body.requestId && alreadyProcessed_(rid)) return { status: 'duplicate' };
    var by = 'Coach ' + (String(body.coachName || 'via site').trim().slice(0, 60) || 'via site');
    var name = String(a.Name).trim(), result;
    try {
      result = parseSubmission(siteLogAnswers_(body.form || {}, name, by), { submittedAt: new Date(), responseId: rid, athleteIds: athleteIdByName_(), newId: newId_, parseDate: parseFormDate_ });
    } catch (err) {
      return { status: 'invalid', message: err.message };
    }
    result.entry.Source = 'Site';
    if (result.benchmark) result.benchmark.Source = 'Site';
    // Optional proof photo (David, 2026-11-12): a failed photo never blocks the workout.
    var photoState = '';
    if (body.photo) {
      try { result.entry['Photo link'] = savePhotoCopy_(body.photo, result.entry['Entry ID']); photoState = 'saved'; } catch (err) { photoState = 'failed'; }
    }
    writeResult_(result);
    if (result.benchmark && result.benchmark['Drag check']) {
      logChange_({ Who: by, Tab: TABS.BENCHMARKS, 'Row ID': result.benchmark['Benchmark ID'], Note: result.benchmark['Drag check'] + ' (' + result.benchmark.Test + ', ' + result.benchmark.Athlete + ')' });
    }
    SpreadsheetApp.flush();
    return { status: 'ok', entryId: result.entry['Entry ID'], athlete: name, test: result.benchmark ? result.benchmark.Test : '', sessionType: result.entry['Session type'], photo: photoState };
  } catch (err) {
    logChange_({ Who: 'site', Tab: '(site log)', 'Row ID': String(body.requestId || ''), Note: 'SITE LOG ERROR: ' + err.message });
    return { status: 'error', error: err.message };
  } finally {
    lock.releaseLock();
  }
}
