/**
 * Plan flags in Slack (David, 2026-10-28; changed 2026-11-17). A practice or make-up logged as Full that is not
 * exactly the planned workout (fewer pieces, a piece cut short, a different workout, or a skipped workout on
 * a day with several) is marked Modified automatically and gets one message in the coach channel
 * (#ergbot-coaches, through the alert webhook) with three buttons: Confirm Modified, Set back to Full, Open
 * in Sheet. It runs right after a Slack or site save, and an every-15-minutes sweep catches the rest (Logbook,
 * Form). The Netlify function behind the Slack app (site/functions/slack-background.mjs) sends a press back
 * here through the feed key. Only member IDs in Settings slack.coach_ids may decide; the first press wins and
 * the other coaches see who pressed.
 */

var PLAN_FLAGS_POSTED_PROP = 'PLAN_FLAGS_POSTED';
var PLAN_FLAG_LOOKBACK_DAYS = 3;
var PLAN_FLAG_ACTION = 'plan-flag-action';
var PLAN_FLAG_REVIEWED = 'Reviewed, Full';
var PLAN_FLAG_MODIFIED = 'Reviewed, Modified';
var PLAN_FLAG_AUTO = 'Auto Modified';   // marked Modified by the plan check, waiting for a coach

// ---- Pure parts (tested in Node) ----

/**
 * What needs a flag: one item per athlete and planned day, { entryIds, entryId, athlete, date, sessionType,
 * flag, detail }. An item covers that day's Full practice and make-up entries with no Review status that
 * were not posted before: the ones that don't match their plan, or all of them when a workout planned that
 * day was not logged (checked once the day is over; warm-ups and cool-downs and draft sessions don't count).
 * `inp` has schedule, workouts, benchmarks, settings. `squads` maps Athlete ID to squad. `posted` lists
 * Entry IDs already sent. Entries whose plan can't be read are skipped (the Plan check report shows those).
 */
function pendingPlanFlags(entries, intervals, squads, inp, today, posted) {
  var from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - PLAN_FLAG_LOOKBACK_DAYS);
  var todayKey = dayKey_(today);
  var byEntry = {};
  intervals.forEach(function (iv) { (byEntry[iv['Entry ID']] = byEntry[iv['Entry ID']] || []).push(iv); });
  var names = {};
  (inp.workouts || []).forEach(function (w) { var id = String(w['Workout ID']).trim(); if (id && !(id in names)) names[id] = String(w.Name || id); });
  var groups = {}, order = [];
  entries.forEach(function (e) {
    var type = String(e['Session type'] || '');
    if (type !== 'Practice' && type !== 'Make-up') return;
    if (!isDate_(e.Date) || e.Date < from || e.Date > today) return;
    var review = String(e['Review status'] || '').trim();
    if (/reject|^pending/i.test(review)) return;
    try {
      var best = plannedBest(e, squads[e['Athlete ID']], inp.schedule, inp.workouts, byEntry[e['Entry ID']] || []);
      if (!best || !best.pieces.length) return;
      var key = e['Athlete ID'] + '|' + dayKey_(best.row.Date);
      if (!groups[key]) { groups[key] = { day: dayKey_(best.row.Date), first: e, rows: [], done: {}, out: false }; order.push(key); }
      var g = groups[key];
      if (String(e.Status) === 'Out') { g.out = true; return; }
      g.done[String(best.row['Workout ID']).trim()] = true;
      var open = String(e.Status) === 'Full' && review === '' && posted.indexOf(e['Entry ID']) < 0;
      if (!open) return;
      var bases = {};
      Object.keys(PLAN_BASES).forEach(function (b) {
        var bw = seasonBestWatts(inp.benchmarks, e['Athlete ID'], b, best.row.Date, inp.settings.school_year_start);
        if (bw) bases[b] = bw.watts;
      });
      var c = checkAgainstPlan(rowEquivalentIntervals(byEntry[e['Entry ID']] || [], e.Activity), best.pieces, bases, inp.settings, e.Activity);
      g.rows.push({ e: e, pieces: best.pieces, flag: planFlag(e, c) });
    } catch (err) {
      // A bad Workouts row must not stop the sweep.
    }
  });
  var out = [];
  order.forEach(function (key) {
    var g = groups[key];
    if (!g.rows.length) return;
    var skipped = [];
    if (!g.out && g.day < todayKey) {
      planCandidates(g.first, squads[g.first['Athlete ID']], inp.schedule, inp.workouts).forEach(function (r) {
        var id = String(r['Workout ID']).trim();
        if (g.done[id] || !isActive_(r.Published) || isWarmCoolWorkout_(names[id])) return;
        if (skipped.indexOf(names[id] || id) < 0) skipped.push(names[id] || id);
      });
    }
    var hit = skipped.length ? g.rows : g.rows.filter(function (x) { return x.flag; });
    if (!hit.length) return;
    var reasons = hit.filter(function (x) { return x.flag; }).map(function (x) { return x.flag; });
    if (skipped.length) reasons.push('Not logged: ' + skipped.join(', '));
    out.push({
      entryIds: hit.map(function (x) { return x.e['Entry ID']; }), entryId: hit[0].e['Entry ID'],
      athlete: g.first.Athlete, date: hit[0].e.Date, sessionType: hit[0].e['Session type'], flag: reasons.join('. '),
      detail: hit.map(function (x) { return planFlagDetail(x.e, byEntry[x.e['Entry ID']] || [], x.pieces); }).join('\n\n').slice(0, 2400)
    });
  });
  return out;
}

/** "Tue Oct 28" */
function planFlagDay_(d) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' +
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + ' ' + d.getDate();
}

/** pieceLabel in plain words for a message: "4 x 6:00, rest 2:00, Aerobic, rate 22". */
function planFlagPieceLabel_(p) {
  return pieceLabel(p)
    .replace(/ r undefined/, ', undefined rest')
    .replace(/ start every (\d+:\d\d)/, ', start every $1')
    .replace(/ r(\d+:\d\d)/, ', rest $1')
    .replace(new RegExp(' (' + ZONES.join('|') + ')\\b'), ', $1')
    .replace(/ @ r(\S+)/, ', rate $1');
}

var PLAN_FLAG_SOURCES = { Form: 'Google Form', Logbook: 'Concept2 Logbook', Slack: 'Slack' };

/**
 * What the coach needs to decide: the planned workout and what was logged
 * (pieces, totals, source). Athlete and coach notes, Out notes and weights are
 * left out, as everywhere in Slack. `pieces` are the planned workout pieces.
 */
function planFlagDetail(entry, intervals, pieces) {
  var time = function (s) { return formatTime(Number(s)); };
  var round = function (s) { return time(s).replace(/\.0$/, ''); };
  var lines = [];
  lines.push('*Planned:* ' + (pieces.map(planFlagPieceLabel_).join('; ') || 'not found'));
  var source = PLAN_FLAG_SOURCES[String(entry.Source)] || String(entry.Source || 'unknown');
  var by = String(entry['Entered by'] || '').trim();
  var head = '*Logged* (' + source + (by && by !== String(entry.Athlete) ? ', entered by ' + by : '') + '): ' + (entry.Activity || 'activity not given');
  if (entry['Main set']) head += ', "' + entry['Main set'] + '"';
  if (entry.Zone) head += ', ' + entry.Zone;
  lines.push(head);
  intervals.slice().sort(function (a, b) { return Number(a['Interval #']) - Number(b['Interval #']); }).forEach(function (iv) {
    var bits = [time(iv['Work s']), (Number(iv['Work m']) || 0) + ' m'];
    if (Number(iv['Avg rate']) > 0) bits.push(iv['Avg rate'] + ' spm');
    if (Number(iv['Rest s']) > 0) bits.push('rest ' + round(iv['Rest s']));
    lines.push(iv['Interval #'] + '. ' + bits.join(', '));
  });
  lines.push('Total: ' + intervals.length + ' piece' + (intervals.length === 1 ? '' : 's') + ', ' + (Number(entry['Work m']) || 0) + ' m in ' + time(entry['Work s']));
  var extra = [];
  if (Number(entry.RPE) > 0) extra.push('RPE ' + entry.RPE);
  if (Number(entry['Warmup s']) > 0) extra.push('warmup ' + round(entry['Warmup s']));
  if (Number(entry['Cooldown s']) > 0) extra.push('cooldown ' + round(entry['Cooldown s']));
  if (extra.length) lines.push(extra.join(', '));
  return lines.join('\n').slice(0, 2400);
}

/** The Slack message for one flagged item: text plus Block Kit buttons. The buttons carry every Entry ID it covers. */
function planFlagMessage(item, sheetUrl) {
  var text = ':warning: Plan check: ' + item.athlete + ', ' + planFlagDay_(item.date) + ', ' + item.sessionType +
    '. Marked Modified: ' + item.flag + '.' + (item.detail ? '\n' + item.detail : '');
  var ids = (item.entryIds || [item.entryId]).join(',');
  return {
    text: text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: text } },
      { type: 'actions', elements: [
        { type: 'button', action_id: 'plan_confirm', value: ids, text: { type: 'plain_text', text: 'Confirm Modified' } },
        { type: 'button', action_id: 'plan_full', value: ids, text: { type: 'plain_text', text: 'Set back to Completed' } },
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
 * What a button press does. `row` is the entry's current Status and Review status. Ops: 'confirm' and
 * 'full' (since 2026-11-17), and 'modified' and 'reviewed' from older messages. Returns
 * { status: 'forbidden' | 'missing' | 'already' | 'ok', set } where `set` holds the cells to write on 'ok'.
 */
function decidePlanFlagAction(row, op, slackUserId, coachIds) {
  if (!slackUserId || coachIds.indexOf(String(slackUserId)) < 0) return { status: 'forbidden' };
  if (!row) return { status: 'missing' };
  var review = String(row['Review status'] || '').trim();
  if (['confirm', 'full', 'modified', 'reviewed'].indexOf(op) < 0) return { status: 'error', error: 'unknown action' };
  if (review === PLAN_FLAG_AUTO) {
    if (op === 'confirm' || op === 'modified') return { status: 'ok', set: { 'Review status': PLAN_FLAG_MODIFIED } };
    return { status: 'ok', set: { 'Status': 'Full', 'Review status': PLAN_FLAG_REVIEWED } };
  }
  if (review !== '') return { status: 'already', reviewStatus: review };
  if (op === 'modified' || op === 'confirm') return { status: 'ok', set: { 'Status': 'Modified', 'Review status': PLAN_FLAG_MODIFIED } };
  return { status: 'ok', set: { 'Review status': PLAN_FLAG_REVIEWED } };
}

/** The cells the plan check writes on an entry it marks: '' when the entry is no longer a Full entry with no Review status. Pure. */
function planFlagAutoSet_(row) {
  if (!row || String(row.Status) !== 'Full' || String(row['Review status'] || '').trim() !== '') return null;
  return { 'Status': 'Modified', 'Review status': PLAN_FLAG_AUTO };
}

// ---- Sheet side ----

/** Every-15-minutes trigger: marks and posts every newly flagged item. */
function sweepPlanFlags() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return [];
  try {
    var squads = {};
    readObjects_(TABS.ROSTER).forEach(function (r) { squads[r['Athlete ID']] = r.Squad; });
    return runPlanFlags_(function (posted) {
      return pendingPlanFlags(readObjects_(TABS.ENTRIES), readObjects_(TABS.INTERVALS), squads, planInputs_(), new Date(), posted);
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Right after a Slack or site save (the caller holds the script lock): runs the plan check for that
 * athlete's recent entries, so a workout that isn't the plan is marked Modified and posted at once.
 * True when the saved entry was flagged. Never throws: the save has already happened.
 */
function planFlagsAfterSave_(entry, squads) {
  try {
    var id = String(entry['Athlete ID']), ids = {};
    var mine = readObjects_(TABS.ENTRIES).filter(function (e) { return String(e['Athlete ID']) === id; });
    mine.forEach(function (e) { ids[e['Entry ID']] = true; });
    var ivs = readObjects_(TABS.INTERVALS).filter(function (iv) { return ids[iv['Entry ID']]; });
    var hit = false;
    runPlanFlags_(function (posted) {
      var items = pendingPlanFlags(mine, ivs, squads, planInputs_(), new Date(), posted);
      hit = items.some(function (it) { return it.entryIds.indexOf(entry['Entry ID']) >= 0; });
      return items;
    });
    return hit;
  } catch (err) {
    logChange_({ Who: 'plan check', Tab: TABS.ENTRIES, 'Row ID': entry['Entry ID'], Note: 'PLAN CHECK ERROR: ' + err.message });
    return false;
  }
}

/**
 * Posts each item to the coach channel and marks its entries Modified (Review status "Auto Modified").
 * The caller holds the script lock. With no webhook the entries are still marked (the site shows why).
 * A failed post stops here and is retried at the next sweep. Returns the Entry IDs marked.
 */
function runPlanFlags_(findItems) {
  var props = PropertiesService.getScriptProperties();
  var hook = props.getProperty(SLACK_WEBHOOK_PROP);
  var posted = [];
  try { posted = JSON.parse(props.getProperty(PLAN_FLAGS_POSTED_PROP) || '[]'); } catch (err) { posted = []; }
  var items = findItems(posted);
  if (!items.length) return [];
  var sheetUrl = ss_().getUrl() + '#gid=' + tab_(TABS.ENTRIES).getSheetId();
  var marked = [];
  for (var i = 0; i < items.length; i++) {
    if (hook) {
      var res = UrlFetchApp.fetch(hook, {
        method: 'post', contentType: 'application/json',
        payload: JSON.stringify(planFlagMessage(items[i], sheetUrl)), muteHttpExceptions: true
      });
      if (res.getResponseCode() !== 200) break;   // retried at the next sweep
    }
    items[i].entryIds.forEach(function (id) {
      posted.push(id);
      var entry = entryRowById_(id);
      var set = planFlagAutoSet_(entry);
      if (!set) return;
      writeEntryCells_(entry, set, 'Plan check', 'not the planned workout: ' + items[i].flag);
      marked.push(id);
    });
  }
  props.setProperty(PLAN_FLAGS_POSTED_PROP, JSON.stringify(posted.slice(-300)));
  SpreadsheetApp.flush();
  return marked;
}

/** Writes cells on one Entries row (from entryRowById_), each change logged to the Change log. */
function writeEntryCells_(entry, set, who, note) {
  var sheet = tab_(TABS.ENTRIES);
  var headers = HEADERS[TABS.ENTRIES];
  Object.keys(set).forEach(function (field) {
    var cell = sheet.getRange(entry.row, headers.indexOf(field) + 1);
    logChange_({
      Who: who, Tab: TABS.ENTRIES, Cell: cell.getA1Notation(), 'Row ID': entry['Entry ID'],
      Field: field, 'Old value': entry[field], 'New value': set[field], Note: String(note || '').slice(0, 200)
    });
    cell.setValue(set[field]);
  });
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
 * doPost action from the Slack function: body { entryId (one ID, or several joined by commas), op,
 * slackUserId, slackName }. Decides and writes under the script lock so two coaches pressing together
 * can't both win.
 */
function applyPlanFlagAction_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ids = String(body.entryId || '').split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x; });
    if (!ids.length) return { status: 'missing' };
    var coachIds = slackCoachIds_(getSettings());
    var who = 'Slack, ' + String(body.slackName || body.slackUserId).slice(0, 40);
    var first = null, changed = 0;
    ids.forEach(function (id) {
      var entry = entryRowById_(id);
      var d = decidePlanFlagAction(entry, body.op, body.slackUserId, coachIds);
      if (!first) first = d;
      if (d.status !== 'ok') return;
      writeEntryCells_(entry, d.set, who, 'plan flag button');
      changed++;
    });
    SpreadsheetApp.flush();
    if (!changed) return first;
    return { status: 'ok', op: body.op, by: String(body.slackName || '') };
  } catch (err) {
    return { status: 'error', error: err.message };
  } finally {
    lock.releaseLock();
  }
}
