/**
 * Keeping the tracker healthy (David, 2026-10-23):
 * - Alerts: every hour the Sheet checks the team site's /api/health and DMs
 *   David in Slack (incoming webhook) when the feed or sign-in breaks, again
 *   once a day while it stays broken, and once when it recovers. A form
 *   submission that can't be saved alerts too. With no webhook set, alerts
 *   go by email to alerts.email (blank: the Sheet owner).
 * - Backups: every Sunday night a values-only copy of every tab goes into the
 *   Drive folder "Erg tracker backups"; the newest backup.keep (12) are kept.
 * - New school year: archives a copy, saves squads, and sets graduated
 *   athletes to Active = No. Nothing is deleted: results, stars and boards
 *   already start over each school year (school_year_start) and All Time
 *   boards need the old rows.
 *
 * The webhook URL is a secret: it lives in Script Properties (menu: Slack
 * alerts webhook), never in the repo or a Sheet cell.
 */

var SLACK_WEBHOOK_PROP = 'SLACK_ALERT_WEBHOOK';
var ALERT_STATE_PROP = 'ALERT_STATE';
var ALERT_REPEAT_MS = 24 * 60 * 60 * 1000;
var BACKUP_PREFIX = 'Erg tracker backup ';
var ARCHIVE_PREFIX = 'Erg tracker archive ';
var OPS_TRIGGERS = ['checkSiteHealth', 'backupSheet'];

// ---- Pure parts (tested in Node) ----

/**
 * What's wrong, as short sentences, from the site's answers.
 * page: HTTP status of the site's home page. health: { status, body } of
 * POST /api/health, or { error } when it couldn't be reached.
 */
function healthProblems(page, health) {
  var out = [];
  if (page !== 200) out.push('The team site is down (home page answered ' + page + ').');
  if (health.error) return out.concat('The health check could not reach the site: ' + health.error);
  var b = health.body || {};
  if (health.status === 401) return out.concat('The health check key doesn\'t match: FEED_KEY in Netlify differs from the Sheet\'s Site feed key.');
  if (health.status !== 200 && !b.checks) return out.concat('The health check answered ' + health.status + '.');
  var c = b.checks || {};
  if (c.env === false) out.push('Netlify is missing TEAM_PASSWORD, FEED_KEY or FEED_URL, so nobody can sign in.');
  if (c.feed === false) out.push('The site can\'t load the Sheet\'s data feed' + (b.feedError ? ' (' + b.feedError + ')' : '') + '.');
  if (c.fresh === false) out.push('The site is showing old data: the feed failed and the last good copy is from ' + (b.generatedAt || 'unknown') + '.');
  if (c.athleteLogins === false) out.push('Athletes can\'t sign in: the feed has ' + b.athletes + ' active athletes but no sign-in codes (check Roster Birthday or Settings site.test_password).');
  if (!out.length && health.status !== 200) out.push('The health check answered ' + health.status + '.');
  return out;
}

/**
 * Whether to send an alert now. state: { down, since, lastSent } from the
 * last check (or null). Returns { send: 'down' | 'still' | 'up' | null, state }.
 */
function alertTransition(state, problems, nowMs) {
  var was = state && state.down;
  if (!problems.length) {
    return { send: was ? 'up' : null, state: { down: false } };
  }
  if (!was) return { send: 'down', state: { down: true, since: nowMs, lastSent: nowMs } };
  if (nowMs - state.lastSent >= ALERT_REPEAT_MS) {
    return { send: 'still', state: { down: true, since: state.since, lastSent: nowMs } };
  }
  return { send: null, state: state };
}

function alertText(send, problems, since, siteUrl) {
  if (send === 'up') return ':white_check_mark: Erg tracker: the team site is working again.';
  var head = send === 'down' ? ':rotating_light: Erg tracker: something broke on the team site.'
    : ':rotating_light: Erg tracker: still broken since ' + since + '.';
  return head + '\n' + problems.map(function (p) { return '• ' + p; }).join('\n') + '\n' + siteUrl;
}

/** Backups to trash: all but the newest `keep`, by name (names end in a sortable date). Archives never match. */
function backupsToTrash(names, keep) {
  var mine = names.filter(function (n) { return n.indexOf(BACKUP_PREFIX) === 0; }).sort().reverse();
  return mine.slice(Math.max(keep, 1));
}

/**
 * The school year a rollover closes: the current one, except in the first
 * three months after school_year_start, when it is the one that just ended.
 * Returns { startYear, label, gradYear } (gradYear: that year's seniors).
 */
function rolloverYear(today, mmdd) {
  var start = teamGmsYearStart_(today, mmdd);
  var early = new Date(start.getFullYear(), start.getMonth() + 3, start.getDate());
  var y = today < early ? start.getFullYear() - 1 : start.getFullYear();
  return { startYear: y, label: schoolYearLabel(y), gradYear: y + 1 };
}

/** Roster rows (with _row) still Active whose Grad year is on or before gradYear. */
function graduatesToRetire(roster, gradYear) {
  return roster.filter(function (r) {
    var g = Number(r['Grad year']);
    return r.Name && isActive_(r.Active) && g && g <= gradYear;
  });
}

// ---- Alerts ----

/** Hourly trigger: checks the site and alerts on a change. */
function checkSiteHealth() {
  var s = getSettings();
  var site = String(s['site.url'] || '').replace(/\/+$/, '');
  if (!site) return;
  var key = PropertiesService.getScriptProperties().getProperty(FEED_KEY_PROP);
  var problems = healthProblems(fetchStatus_(site + '/'), fetchHealth_(site + '/api/health', key));
  var props = PropertiesService.getScriptProperties();
  var state = null;
  try { state = JSON.parse(props.getProperty(ALERT_STATE_PROP) || 'null'); } catch (err) { state = null; }
  var now = Date.now();
  var t = alertTransition(state, problems, now);
  props.setProperty(ALERT_STATE_PROP, JSON.stringify(t.state));
  if (t.send) {
    var since = Utilities.formatDate(new Date(t.state.since || now), ss_().getSpreadsheetTimeZone(), 'EEE MMM d, h:mm a');
    sendAlert_(alertText(t.send, problems, since, site));
  }
  return problems;
}

/**
 * Run once from the editor to grant (or diagnose) the web-request permission.
 * Unlike the site check it does not catch errors, so a missing scope shows up
 * as a consent screen or a real error in Executions.
 */
function authorizeFetch() {
  var site = String(getSettings()['site.url'] || 'https://whitmanrowingcentral.netlify.app').replace(/\/+$/, '');
  var code = UrlFetchApp.fetch(site + '/', { muteHttpExceptions: true }).getResponseCode();
  Logger.log('Site answered ' + code);
}

function fetchStatus_(url) {
  try { return UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true }).getResponseCode(); }
  catch (err) { return 'no answer'; }
}

function fetchHealth_(url, key) {
  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'text/plain', payload: JSON.stringify({ key: key || '' }), muteHttpExceptions: true
    });
    var body = null;
    try { body = JSON.parse(res.getContentText()); } catch (err) { body = null; }
    return { status: res.getResponseCode(), body: body };
  } catch (err) {
    return { error: err.message };
  }
}

/** Slack DM through the incoming webhook; email when there is none or Slack fails. */
function sendAlert_(text) {
  var hook = PropertiesService.getScriptProperties().getProperty(SLACK_WEBHOOK_PROP);
  if (hook) {
    try {
      var res = UrlFetchApp.fetch(hook, {
        method: 'post', contentType: 'application/json', payload: JSON.stringify({ text: text }), muteHttpExceptions: true
      });
      if (res.getResponseCode() === 200) return 'slack';
      text += '\n\n(Slack alert failed: ' + res.getResponseCode() + ' ' + res.getContentText() + ')';
    } catch (err) {
      text += '\n\n(Slack alert failed: ' + err.message + ')';
    }
  }
  var to = getSettings()['alerts.email'] || Session.getEffectiveUser().getEmail();
  MailApp.sendEmail(to, 'Erg tracker alert', text.replace(/:[a-z_]+: /g, ''));
  return 'email';
}

/** Called when a form response can't be saved. No athlete details go out; they're in the Change log. */
function alertSubmitError_() {
  try {
    sendAlert_(':warning: Erg tracker: a form submission couldn\'t be saved. See the SUBMIT ERROR row in the Change log, fix it, then Erg Tracker > Process missed form responses.');
  } catch (err) {
    // An alert failing must never stop the submit handler.
  }
}

/** Menu: set or replace the Slack incoming webhook, then send a test message. */
function slackAlertsWebhook() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Slack alerts webhook',
    'Paste the incoming webhook URL from your Slack app (starts with https://hooks.slack.com/). ' +
    'Leave it empty and click OK to turn Slack alerts off (email is used instead).', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var url = r.getResponseText().trim();
  var props = PropertiesService.getScriptProperties();
  if (!url) {
    props.deleteProperty(SLACK_WEBHOOK_PROP);
    ui.alert('Slack alerts are off. Alerts go by email.');
    return;
  }
  if (!/^https:\/\/hooks\.slack\.com\//.test(url)) {
    ui.alert('That doesn\'t look like a Slack webhook URL. Nothing changed.');
    return;
  }
  props.setProperty(SLACK_WEBHOOK_PROP, url);
  var how = sendAlert_(':wave: Erg tracker alerts will arrive here.');
  ui.alert(how === 'slack' ? 'Saved. A test message is in Slack.' : 'Saved, but Slack refused the test message, so it went by email. Check the URL.');
}

// ---- Backups ----

/** Weekly trigger (and menu): a values-only copy of every tab into the backup folder. */
function backupSheet() {
  var s = getSettings();
  var tz = ss_().getSpreadsheetTimeZone();
  var copy = copySpreadsheet_(BACKUP_PREFIX + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HHmm'));
  var folder = copy.folder;
  var keep = parseInt(s['backup.keep'], 10) || 12;
  var files = [];
  for (var it = folder.getFiles(); it.hasNext();) files.push(it.next());
  var trash = backupsToTrash(files.map(function (f) { return f.getName(); }), keep);
  files.forEach(function (f) { if (trash.indexOf(f.getName()) >= 0) f.setTrashed(true); });
  return copy.url;
}

function backupNow() {
  var url = backupSheet();
  SpreadsheetApp.getUi().alert('Backup saved:\n' + url);
}

/**
 * New spreadsheet in the backup folder with every tab copied as values.
 * Not DriveApp.makeCopy: that would also copy the linked Form each time.
 */
function copySpreadsheet_(name) {
  var src = ss_();
  var folder = backupFolder_();
  var dest = SpreadsheetApp.create(name);
  src.getSheets().forEach(function (sh) {
    var c = sh.copyTo(dest).setName(sh.getName());
    var rows = sh.getLastRow(), cols = sh.getLastColumn();
    if (rows && cols) c.getRange(1, 1, rows, cols).setValues(sh.getRange(1, 1, rows, cols).getValues());
    if (sh.isSheetHidden()) c.hideSheet();
  });
  dest.deleteSheet(dest.getSheets()[0]);   // the blank Sheet1
  var file = DriveApp.getFileById(dest.getId());
  file.moveTo(folder);
  return { url: dest.getUrl(), folder: folder };
}

function backupFolder_() {
  var id = getSettings()['backup.folder_id'];
  if (id) {
    try {
      var f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (err) { /* deleted or moved out of reach: make a new one */ }
  }
  var folder = DriveApp.createFolder('Erg tracker backups');
  setSetting_('backup.folder_id', folder.getId());
  return folder;
}

// ---- Triggers ----

/** Hourly health check and Sunday-night backup. Safe to re-run. */
function installOpsTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (OPS_TRIGGERS.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkSiteHealth').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('backupSheet').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(23).create();
}

/** Menu: turn on (or repair) alerts and backups, and show what the site check sees now. */
function turnOnAlertsAndBackups() {
  installOpsTriggers_();
  var problems = checkSiteHealth() || [];
  var hook = PropertiesService.getScriptProperties().getProperty(SLACK_WEBHOOK_PROP);
  SpreadsheetApp.getUi().alert('Alerts and backups are on.\n\n' +
    'Site check every hour, alerts to ' + (hook ? 'Slack' : 'email (set a Slack webhook from the menu to use Slack)') + '.\n' +
    'Backup every Sunday night to Drive > Erg tracker backups, keeping ' + (parseInt(getSettings()['backup.keep'], 10) || 12) + '.\n\n' +
    (problems.length ? 'The site check found problems right now:\n' + problems.join('\n') : 'The site check passed.'));
}

// ---- New school year ----

/** Menu: close out a school year. Archives and marks; never deletes. */
function startNewSchoolYear() {
  var ui = SpreadsheetApp.getUi();
  var s = getSettings();
  var y = rolloverYear(new Date(), s.school_year_start);
  var sheet = tab_(TABS.ROSTER);
  var headers = HEADERS[TABS.ROSTER];
  var roster = readObjects_(TABS.ROSTER).map(function (r, i) { r._row = i + 2; return r; });
  var grads = graduatesToRetire(roster, y.gradYear);
  var ok = ui.alert('Close out ' + y.label + '?',
    'This will:\n' +
    '1. Save an archive copy of the whole Sheet to Drive > Erg tracker backups (kept for good).\n' +
    '2. Save each rower\'s squad for ' + y.label + ' (Squad history).\n' +
    '3. Set ' + grads.length + ' athletes with Grad year ' + y.gradYear + ' or earlier to Active = No.\n\n' +
    'Nothing is deleted. Results, stars and leaderboards start over on their own on ' +
    (s.school_year_start || '08-01') + '; All Time boards keep everything.', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;

  var archive = copySpreadsheet_(ARCHIVE_PREFIX + y.label);
  saveSquads_(y.label);
  var col = headers.indexOf('Active') + 1;
  grads.forEach(function (r) {
    sheet.getRange(r._row, col).setValue('No');
    logChange_({ Who: 'New school year', Tab: TABS.ROSTER, Cell: sheet.getRange(r._row, col).getA1Notation(),
      'Row ID': r['Athlete ID'], Field: 'Active', 'Old value': r.Active, 'New value': 'No', Note: 'Graduated (class of ' + r['Grad year'] + ')' });
  });
  logChange_({ Who: 'New school year', Tab: '(all)', Note: 'Closed out ' + y.label + '. Archive: ' + archive.url });
  refreshFormDropdowns();

  ui.alert(y.label + ' is closed out.\n\nArchive: ' + archive.url + '\n\nStill to do by hand:\n' +
    '• Move novices to Varsity on the Roster where it fits, and add new athletes.\n' +
    '• Set season.winter_start and season.winter_end, then Generate practice schedule.\n' +
    '• Clear site.test_password once athletes use their birthdays.\n' +
    '• Change TEAM_PASSWORD in Netlify (then redeploy).');
}
