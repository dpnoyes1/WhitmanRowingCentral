/**
 * Plan flags in Slack (David, 2026-10-28). Every 15 minutes a sweep looks at
 * the last few days of entries; a session marked Full that doesn't match its
 * plan gets one message in the coach channel (through the alert webhook) with
 * three buttons: Set to Modified, Looks right, Open in Sheet. The Netlify
 * function behind the Slack app (site/functions/slack-background.mjs) sends a
 * press back here through the feed key. Only member IDs in Settings
 * slack.coach_ids may decide; the first press wins and the other coaches see
 * who pressed. Nothing changes without a press.
 */

var PLAN_FLAGS_POSTED_PROP = 'PLAN_FLAGS_POSTED';
var PLAN_FLAG_LOOKBACK_DAYS = 3;
var PLAN_FLAG_ACTION = 'plan-flag-action';
var PLAN_FLAG_REVIEWED = 'Reviewed, Full';
var PLAN_FLAG_MODIFIED = 'Reviewed, Modified';

// ---- Pure parts (tested in Node) ----

/**
 * Entries from the last few days that need a flag message: Full, doesn't
 * match the plan, no Review status yet, not posted before. `inp` has
 * schedule, workouts, benchmarks, settings. `squads` maps Athlete ID to squad.
 * `posted` lists Entry IDs already sent. Entries whose plan can't be read are
 * skipped (the Plan check report shows those).
 */
function pendingPlanFlags(entries, intervals, squads, inp, today, posted) {
  var from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - PLAN_FLAG_LOOKBACK_DAYS);
  var byEntry = {};
  intervals.forEach(function (iv) { (byEntry[iv['Entry ID']] = byEntry[iv['Entry ID']] || []).push(iv); });
  var out = [];
  entries.forEach(function (e) {
    var id = e['Entry ID'];
    if (!isDate_(e.Date) || e.Date < from || e.Date > today) return;
    if (String(e.Status) !== 'Full' || String(e['Review status'] || '').trim() !== '') return;
    if (posted.indexOf(id) >= 0) return;
    try {
      var planned = plannedFor(e, squads[e['Athlete ID']], inp.schedule);
      if (!planned) return;
      var pieces = workoutPieces(inp.workouts, planned['Workout ID']);
      var bases = {};
      Object.keys(PLAN_BASES).forEach(function (b) {
        var best = seasonBestWatts(inp.benchmarks, e['Athlete ID'], b, planned.Date, inp.settings.school_year_start);
        if (best) bases[b] = best.watts;
      });
      var c = checkAgainstPlan(rowEquivalentIntervals(byEntry[id] || [], e.Activity), pieces, bases, inp.settings);
      var flag = planFlag(e, c);
      if (flag) out.push({ entryId: id, athlete: e.Athlete, date: e.Date, sessionType: e['Session type'], flag: flag });
    } catch (err) {
      // A bad Workouts row must not stop the sweep.
    }
  });
  return out;
}

/** "Tue Oct 28" */
function planFlagDay_(d) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' +
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + ' ' + d.getDate();
}

/** The Slack message for one flagged entry: text plus Block Kit buttons. */
function planFlagMessage(item, sheetUrl) {
  var text = ':warning: Plan check: ' + item.athlete + ', ' + planFlagDay_(item.date) + ', ' + item.sessionType + '. ' + item.flag;
  return {
    text: text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: text } },
      { type: 'actions', elements: [
        { type: 'button', action_id: 'plan_modified', value: item.entryId, text: { type: 'plain_text', text: 'Set to Modified' } },
        { type: 'button', action_id: 'plan_reviewed', value: item.entryId, text: { type: 'plain_text', text: 'Looks right' } },
        { type: 'button', action_id: 'plan_open', url: sheetUrl, text: { type: 'plain_text', text: 'Open in Sheet' } }
      ] }
    ]
  };
}

/** Slack member IDs allowed to press the buttons, from Settings slack.coach_ids. */
function slackCoachIds_(settings) {
  return String(settings['slack.coach_ids'] || '').split(/[\s,;]+/).filter(function (x) { return x; });
}

/**
 * What a button press does. `row` is the entry's current Status and Review
 * status. Returns { status: 'forbidden' | 'missing' | 'already' | 'ok', set }
 * where `set` holds the cells to write on 'ok'.
 */
function decidePlanFlagAction(row, op, slackUserId, coachIds) {
  if (!slackUserId || coachIds.indexOf(String(slackUserId)) < 0) return { status: 'forbidden' };
  if (!row) return { status: 'missing' };
  if (String(row['Review status'] || '').trim() !== '') return { status: 'already', reviewStatus: String(row['Review status']).trim() };
  if (op === 'modified') return { status: 'ok', set: { 'Status': 'Modified', 'Review status': PLAN_FLAG_MODIFIED } };
  if (op === 'reviewed') return { status: 'ok', set: { 'Review status': PLAN_FLAG_REVIEWED } };
  return { status: 'error', error: 'unknown action' };
}

// ---- Sheet side ----

/** Every-15-minutes trigger: posts one message per newly flagged entry. */
function sweepPlanFlags() {
  var props = PropertiesService.getScriptProperties();
  var hook = props.getProperty(SLACK_WEBHOOK_PROP);
  if (!hook) return [];                        // the buttons need Slack
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return [];
  try {
    var posted = [];
    try { posted = JSON.parse(props.getProperty(PLAN_FLAGS_POSTED_PROP) || '[]'); } catch (err) { posted = []; }
    var squads = {};
    readObjects_(TABS.ROSTER).forEach(function (r) { squads[r['Athlete ID']] = r.Squad; });
    var items = pendingPlanFlags(readObjects_(TABS.ENTRIES), readObjects_(TABS.INTERVALS), squads, planInputs_(), new Date(), posted);
    var sheetUrl = ss_().getUrl() + '#gid=' + tab_(TABS.ENTRIES).getSheetId();
    var sent = [];
    for (var i = 0; i < items.length; i++) {
      var res = UrlFetchApp.fetch(hook, {
        method: 'post', contentType: 'application/json',
        payload: JSON.stringify(planFlagMessage(items[i], sheetUrl)), muteHttpExceptions: true
      });
      if (res.getResponseCode() !== 200) break;   // retried at the next sweep
      posted.push(items[i].entryId);
      sent.push(items[i].entryId);
    }
    props.setProperty(PLAN_FLAGS_POSTED_PROP, JSON.stringify(posted.slice(-300)));
    return sent;
  } finally {
    lock.releaseLock();
  }
}

/** Entries row for an Entry ID: {row, status, review} or null. */
function entryRowById_(entryId) {
  var sheet = tab_(TABS.ENTRIES);
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var found = sheet.getRange(2, 1, last - 1, 1).createTextFinder(String(entryId)).matchEntireCell(true).findNext();
  if (!found) return null;
  var headers = HEADERS[TABS.ENTRIES];
  var values = sheet.getRange(found.getRow(), 1, 1, headers.length).getValues()[0];
  var out = { row: found.getRow() };
  headers.forEach(function (h, i) { out[h] = values[i]; });
  return out;
}

/**
 * doPost action from the Slack function: body { entryId, op, slackUserId,
 * slackName }. Decides and writes under the script lock so two coaches
 * pressing together can't both win.
 */
function applyPlanFlagAction_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var entry = body.entryId ? entryRowById_(body.entryId) : null;
    var d = decidePlanFlagAction(entry, body.op, body.slackUserId, slackCoachIds_(getSettings()));
    if (d.status !== 'ok') return d;
    var sheet = tab_(TABS.ENTRIES);
    var headers = HEADERS[TABS.ENTRIES];
    var who = 'Slack, ' + String(body.slackName || body.slackUserId).slice(0, 40);
    Object.keys(d.set).forEach(function (field) {
      var col = headers.indexOf(field) + 1;
      var cell = sheet.getRange(entry.row, col);
      logChange_({
        Who: who, Tab: TABS.ENTRIES, Cell: cell.getA1Notation(), 'Row ID': entry['Entry ID'],
        Field: field, 'Old value': entry[field], 'New value': d.set[field], Note: 'plan flag button'
      });
      cell.setValue(d.set[field]);
    });
    SpreadsheetApp.flush();
    return { status: 'ok', op: body.op, by: String(body.slackName || '') };
  } catch (err) {
    return { status: 'error', error: err.message };
  } finally {
    lock.releaseLock();
  }
}
