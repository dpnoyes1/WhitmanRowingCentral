/**
 * /log in Slack (David, 2026-10-28): the athlete fills a modal, the Slack
 * function (site/functions/slack-background.mjs) sends the values here, and
 * they go through the same parseSubmission as the Form. Source = Slack. She is
 * found by her Slack member ID on the Roster (Slack member ID column), never
 * by anything she types. Tests and Benchmarks stay on the Form.
 */

var SLACK_LOG_ACTION = 'slack-log';
var SLACK_LOG_TYPES = { practice: LOG_TYPES.PRACTICE, oyo: LOG_TYPES.OYO, makeup: LOG_TYPES.MAKEUP };
var SLACK_LOG_STATUSES = { full: STATUSES.FULL, modified: STATUSES.MODIFIED, out: STATUSES.OUT };

// ---- Pure parts (tested in Node) ----

/** Active Roster row with this Slack member ID, or null. */
function athleteBySlackId_(roster, slackUserId) {
  var id = String(slackUserId || '').trim();
  if (!id) return null;
  for (var i = 0; i < roster.length; i++) {
    var r = roster[i];
    if (r.Name && isActive_(r.Active) && String(r['Slack member ID'] || '').trim() === id) return r;
  }
  return null;
}

/**
 * The pieces box: one line per interval, "work time, work meters, rate, rest
 * time, rest meters". Rate, rest time and rest meters can be left off or
 * blank. Returns [{WORK_TIME, WORK_M, RATE, REST_TIME, REST_M}] as text, or
 * throws "Piece N: ..." naming the line to fix.
 */
function parsePiecesText(text) {
  var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l !== ''; });
  if (!lines.length) throw new Error('Enter at least one piece');
  if (lines.length > MAX_INTERVALS) throw new Error('At most ' + MAX_INTERVALS + ' pieces (you have ' + lines.length + ')');
  return lines.map(function (line, i) {
    var f = line.split(',').map(function (x) { return x.trim(); });
    var where = 'Piece ' + (i + 1) + ': ';
    if (f.length > 5) throw new Error(where + 'too many commas (work time, meters, rate, rest time, rest meters)');
    var time = function (v, what) {
      if (v === '') return;
      if (!new RegExp(TIME_PATTERN).test(v)) throw new Error(where + what + ' "' + v + '" should look like 2:00.0');
    };
    var number = function (v, what, max) {
      if (v === '') return;
      if (!/^\d+(\.\d+)?$/.test(v) || Number(v) > max) throw new Error(where + what + ' "' + v + '" is not a number I can use');
    };
    if (f[0] === undefined || f[0] === '') throw new Error(where + 'work time is missing');
    time(f[0], 'work time');
    if (f[1] === undefined || f[1] === '') throw new Error(where + 'work meters are missing');
    number(f[1], 'work meters', 100000);
    number(f[2] || '', 'stroke rate', 80);
    time(f[3] || '', 'rest time');
    number(f[4] || '', 'rest meters', 100000);
    return { WORK_TIME: f[0], WORK_M: f[1], RATE: f[2] || '', REST_TIME: f[3] || '', REST_M: f[4] || '' };
  });
}

/**
 * Modal values -> the Form answers parseSubmission reads, keyed by question
 * title. form: { date, type, status, makeup_for, activity, warmup, warmup_m,
 * cooldown, cooldown_m, main_set, zone, rpe, drag, hr, note, pieces }.
 */
function slackLogAnswers(form, athleteName) {
  var logType = SLACK_LOG_TYPES[form.type];
  if (!logType) throw new Error('Pick Practice, OYO or Make-up');
  var answers = {};
  answers[Q.ATHLETE] = athleteName;
  answers[Q.ENTERED_BY] = athleteName;
  answers[Q.DATE] = form.date;
  answers[Q.LOG_TYPE] = logType;
  if (form.type === 'practice') {
    var status = SLACK_LOG_STATUSES[form.status || 'full'];
    if (!status) throw new Error('Unknown status');
    answers[Q.STATUS] = status;
    if (form.status === 'out') {
      answers[Q.OUT_NOTE] = form.note || '';
      return answers;
    }
  }
  if (form.type === 'makeup') answers[Q.MAKEUP_FOR] = form.makeup_for;
  answers[Q.ACTIVITY] = form.activity;
  answers[Q.WARMUP] = form.warmup;
  answers[Q.WARMUP_M] = form.warmup_m;
  answers[Q.MAIN_SET] = form.main_set;
  answers[Q.ZONE] = form.zone;
  answers[Q.COOLDOWN] = form.cooldown;
  answers[Q.COOLDOWN_M] = form.cooldown_m;
  answers[Q.RPE] = form.rpe;
  answers[Q.HR] = form.hr;
  answers[Q.DRAG] = form.drag;
  answers[Q.NOTE] = form.note;
  parsePiecesText(form.pieces).forEach(function (p, i) {
    var t = qInterval(i + 1);
    answers[t.WORK_TIME] = p.WORK_TIME;
    answers[t.WORK_M] = p.WORK_M;
    answers[t.RATE] = p.RATE;
    answers[t.REST_TIME] = p.REST_TIME;
    answers[t.REST_M] = p.REST_M;
  });
  return answers;
}

// ---- Sheet side ----

/**
 * doPost action from the Slack function: body { slackUserId, viewId, form }.
 * Answers { status: 'ok' | 'unknown_athlete' | 'duplicate' | 'error', ... }.
 */
function processSlackLog_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var rid = 'slack:' + (body.viewId || '');
  try {
    var roster = readObjects_(TABS.ROSTER);
    var athlete = athleteBySlackId_(roster, body.slackUserId);
    if (!athlete) return { status: 'unknown_athlete' };
    if (body.viewId && alreadyProcessed_(rid)) return { status: 'duplicate' };
    var result = parseSubmission(slackLogAnswers(body.form || {}, String(athlete.Name).trim()), {
      submittedAt: new Date(), responseId: rid, athleteIds: athleteIdByName_(), newId: newId_, parseDate: parseFormDate_
    });
    result.entry.Source = 'Slack';
    writeResult_(result);
    SpreadsheetApp.flush();
    var squads = {};
    roster.forEach(function (r) { squads[r['Athlete ID']] = r.Squad; });
    var flagged = pendingPlanFlags([result.entry], result.intervals, squads, planInputs_(), new Date(), []).length > 0;
    var e = result.entry;
    return { status: 'ok', entryId: e['Entry ID'], sessionType: e['Session type'], entryStatus: e.Status,
      activity: e.Activity || '', pieces: result.intervals.length, flagged: flagged };
  } catch (err) {
    logChange_({ Who: 'slack', Tab: '(slack)', 'Row ID': rid, Note: 'SLACK LOG ERROR: ' + err.message });
    return { status: 'error', error: err.message };
  } finally {
    lock.releaseLock();
  }
}
