/**
 * Concept2 Logbook results -> pending Entries + Intervals rows (phase 2).
 * The Netlify function fetches the athlete's result from Logbook and POSTs a
 * normalized copy here (same FEED_KEY check as the feed, see Feed.gs doPost):
 *
 *   {key, action: 'logbook-result', athleteId, result: {
 *     id, deleted, localDate 'YYYY-MM-DD', localTime 'H:MM', machine 'rower' | 'bikerg' | 'skierg',
 *     name, workoutType, timeS, distanceM, restTimeS, restDistanceM, dragFactor,
 *     intervals: [{timeS, distanceM, rate, restTimeS, restDistanceM}] }}
 *
 * Times are seconds, distances meters. The Logbook result id goes in Response ID
 * as "logbook:<id>", so a repeated webhook, a poll and a retry never write twice.
 * Rows are written with Review status "Pending..." and the feed leaves them out
 * until the athlete confirms (or the 20-hour rule accepts them; that step is
 * not built yet). Benchmark rows are NOT made here; the confirm step will.
 *
 * logbookRows() and classifyLogbook() are pure so they are tested in Node.
 */

var LOGBOOK_ACTION = 'logbook-result';
var LOGBOOK_PENDING = 'Pending';
var LOGBOOK_PENDING_MAKEUP = 'Pending: possible make-up';
var LOGBOOK_MACHINES = { rower: 'Erg (RowErg)', bikerg: 'BikeErg' };

/**
 * Practice / OYO / Possible make-up from the Practices rows (CLAUDE.md rules).
 * practices: [{date 'YYYY-MM-DD', squad, window start/end 'H:MM', canceled}]
 * entries: this athlete's [{date, type, makeupFor}] (any Review status except rejected).
 * Returns {type: 'Practice' | 'OYO' | 'Make-up', makeupFor: 'YYYY-MM-DD' | '', possible: bool}.
 */
function classifyLogbook(squad, date, time, practices, entries) {
  var minutes = function (hhmm) {
    var p = String(hhmm).split(':');
    return Number(p[0]) * 60 + Number(p[1]);
  };
  var sameSquad = function (p) {
    return !squad || !p.squad || String(p.squad).toLowerCase() === String(squad).toLowerCase();
  };
  var live = practices.filter(function (p) { return !p.canceled && sameSquad(p); });
  var today = live.filter(function (p) { return p.date === date; })[0];
  var t = minutes(time);
  if (today && t >= minutes(today.windowStart) && t <= minutes(today.windowEnd)) {
    return { type: 'Practice', makeupFor: '', possible: false };
  }
  var covered = {};
  entries.forEach(function (e) {
    if (e.type === 'Practice' && e.status !== 'Out') covered[e.date] = true;
    if (e.type === 'Make-up' && e.makeupFor) covered[e.makeupFor] = true;
  });
  var missed = live.filter(function (p) {
    var days = (dayNumber_(date) - dayNumber_(p.date));
    return days > 0 && days <= 7 && !covered[p.date];
  }).sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0];
  if (missed) return { type: 'Make-up', makeupFor: missed.date, possible: true };
  return { type: 'OYO', makeupFor: '', possible: false };
}

function dayNumber_(ymd) {
  var m = String(ymd).split('-');
  return Math.round(Date.UTC(Number(m[0]), Number(m[1]) - 1, Number(m[2])) / 86400000);
}

/**
 * Pure: normalized result -> {entry, intervals} or {skip: reason}.
 * ctx: {athlete: {id, name, squad}, practices, entries, now, newId(prefix), parseDate(str)}
 */
function logbookRows(result, ctx) {
  var activity = LOGBOOK_MACHINES[result.machine];
  if (!activity) return { skip: 'unsupported machine: ' + result.machine };
  var pieces = (result.intervals || []).filter(function (iv) { return Number(iv.timeS) > 0; });
  if (!pieces.length) {
    // Totals only (Just Row, or Logbook sent no piece table): one piece, so the rest of the app sees a session.
    pieces = [{ timeS: result.timeS, distanceM: result.distanceM, rate: result.rate, restTimeS: '', restDistanceM: '' }];
  }
  if (!(Number(pieces[0].timeS) > 0)) return { skip: 'no time on result ' + result.id };
  if (pieces.length > MAX_INTERVALS) {
    pieces = pieces.slice(0, MAX_INTERVALS - 1).concat([sumPieces_(pieces.slice(MAX_INTERVALS - 1))]);
  }
  var cls = classifyLogbook(ctx.athlete.squad, result.localDate, result.localTime, ctx.practices, ctx.entries);
  var entryId = ctx.newId('E');
  var intervals = pieces.map(function (iv, i) {
    return {
      'Entry ID': entryId,
      'Interval #': i + 1,
      'Work s': round1_(iv.timeS),
      'Work m': numOrBlank_(iv.distanceM),
      'Avg rate': numOrBlank_(iv.rate),
      'Rest s': numOrBlank_(iv.restTimeS),
      'Rest m': numOrBlank_(iv.restDistanceM)
    };
  });
  var sum = function (key) {
    return round1_(intervals.reduce(function (s, iv) { return s + (Number(iv[key]) || 0); }, 0));
  };
  var note = 'Logbook ' + (result.name || result.workoutType || '').trim();
  if (isBenchmarkShape_(result)) note += ' (possible benchmark test; confirm to log it)';
  var entry = {
    'Entry ID': entryId,
    'Submitted at': ctx.now,
    'Date': ctx.parseDate(result.localDate),
    'Athlete ID': ctx.athlete.id,
    'Athlete': ctx.athlete.name,
    'Entered by': ctx.athlete.name,
    'Session type': cls.type,
    'Make-up for date': cls.makeupFor ? ctx.parseDate(cls.makeupFor) : '',
    'Status': cls.type === 'OYO' ? '' : 'Full',
    'Activity': activity,
    'Work s': sum('Work s'),
    'Rest s': sum('Rest s'),
    'Work m': sum('Work m'),
    'Rest m': sum('Rest m'),
    'Main set': String(result.name || '').trim(),
    'Drag factor': numOrBlank_(result.dragFactor),
    'Intervals': intervals.length,
    'Coach note': note,
    'Source': 'Logbook',
    'Review status': cls.possible ? LOGBOOK_PENDING_MAKEUP : LOGBOOK_PENDING,
    'Response ID': 'logbook:' + result.id
  };
  return { entry: entry, intervals: intervals };
}

function sumPieces_(list) {
  var add = function (k) { return list.reduce(function (s, iv) { return s + (Number(iv[k]) || 0); }, 0); };
  return {
    timeS: add('timeS'), distanceM: add('distanceM'), rate: '',
    restTimeS: add('restTimeS'), restDistanceM: add('restDistanceM')
  };
}

/** One 2,000 m piece or one 20:00 piece: the shape of a 2k or 20' test. */
function isBenchmarkShape_(result) {
  var d = Number(result.distanceM);
  var t = Number(result.timeS);
  return result.machine === 'rower' && ((d >= 1990 && d <= 2010 && (result.intervals || []).length <= 1) ||
    (t >= 1195 && t <= 1205));
}

function round1_(x) {
  return Math.round(Number(x) * 10) / 10;
}

function numOrBlank_(x) {
  if (x === undefined || x === null || x === '') return '';
  var n = Number(x);
  return isNaN(n) ? '' : n;
}

/** Called from doPost after the key check. Returns a small JSON-able status. */
function processLogbookResult_(body) {
  var result = body.result || {};
  if (!result.id) return { status: 'error', error: 'missing result id' };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var rid = 'logbook:' + result.id;
    var existing = findEntryRow_(rid);
    if (existing && !/^pending/i.test(String(existing.reviewStatus))) {
      return { status: 'kept', reason: 'already confirmed' };
    }
    if (result.deleted) {
      if (!existing) return { status: 'none' };
      deleteEntry_(existing);
      SpreadsheetApp.flush();
      return { status: 'deleted' };
    }
    var roster = readObjects_(TABS.ROSTER).filter(function (r) {
      return String(r['Athlete ID']) === String(body.athleteId);
    })[0];
    if (!roster) return { status: 'error', error: 'athlete not on Roster' };
    var tz = ss_().getSpreadsheetTimeZone();
    var day = function (d) { return d instanceof Date ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : ''; };
    var practices = readObjects_(TABS.PRACTICES).filter(function (p) { return p.Date instanceof Date; }).map(function (p) {
      return {
        date: day(p.Date), squad: String(p.Squad || '').trim(), canceled: /cancel/i.test(String(p.Status)),
        windowStart: String(p['Window start']), windowEnd: String(p['Window end'])
      };
    });
    var entries = readObjects_(TABS.ENTRIES).filter(function (e) {
      return String(e['Athlete ID']) === String(body.athleteId) && e.Date instanceof Date &&
        !/reject/i.test(String(e['Review status'])) && String(e['Response ID']) !== rid;
    }).map(function (e) {
      return { date: day(e.Date), type: String(e['Session type']), status: String(e.Status), makeupFor: day(e['Make-up for date']) };
    });
    var rows = logbookRows(result, {
      athlete: { id: roster['Athlete ID'], name: String(roster.Name).trim(), squad: roster.Squad },
      practices: practices, entries: entries, now: new Date(), newId: newId_, parseDate: parseFormDate_
    });
    if (rows.skip) return { status: 'skipped', reason: rows.skip };
    if (existing) deleteEntry_(existing);
    appendObject_(TABS.ENTRIES, rows.entry);
    appendObjects_(TABS.INTERVALS, rows.intervals);
    SpreadsheetApp.flush();
    return { status: existing ? 'updated' : 'created', entryId: rows.entry['Entry ID'] };
  } catch (err) {
    logChange_({ Who: 'logbook', Tab: '(logbook)', 'Row ID': 'logbook:' + result.id, Note: 'LOGBOOK ERROR: ' + err.message });
    return { status: 'error', error: err.message };
  } finally {
    lock.releaseLock();
  }
}

/** Entries row for a Response ID: {row, entryId, reviewStatus} or null. */
function findEntryRow_(responseId) {
  return findEntryBy_('Response ID', responseId);
}

function findEntryBy_(header, value) {
  var sheet = tab_(TABS.ENTRIES);
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var headers = HEADERS[TABS.ENTRIES];
  var col = headers.indexOf(header) + 1;
  var found = sheet.getRange(2, col, last - 1, 1).createTextFinder(String(value)).matchEntireCell(true).findNext();
  if (!found) return null;
  var row = found.getRow();
  return {
    row: row,
    entryId: sheet.getRange(row, 1).getValue(),
    reviewStatus: sheet.getRange(row, headers.indexOf('Review status') + 1).getValue()
  };
}

function deleteEntry_(found) {
  var sheet = tab_(TABS.INTERVALS);
  var last = sheet.getLastRow();
  if (last >= 2) {
    var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (var i = ids.length - 1; i >= 0; i--) {
      if (ids[i][0] === found.entryId) sheet.deleteRow(i + 2);
    }
  }
  tab_(TABS.ENTRIES).deleteRow(found.row);
}

// ---- confirm and auto-accept -------------------------------------------------

var LOGBOOK_AUTO_ACCEPT_HOURS = 20;   // David, 2026-10-25: unchanged labels auto-accept after 20 h

/**
 * Pure: what a confirm tap changes. entry/interval are Entries/Intervals objects.
 * opts: {sessionType, makeupFor 'YYYY-MM-DD', rpe, benchmark '2000m' | '20min'}.
 * Returns {updates: {column: value}, benchmark: row or null} or {error}.
 */
function logbookConfirmPlan(entry, intervals, athleteId, opts, ctx) {
  if (String(entry['Athlete ID']) !== String(athleteId)) return { error: 'not your session' };
  if (String(entry['Source']) !== 'Logbook' || !/^pending/i.test(String(entry['Review status']))) return { error: 'not waiting for confirmation' };
  var type = ['Practice', 'OYO', 'Make-up'].indexOf(opts.sessionType) >= 0 ? opts.sessionType : String(entry['Session type']);
  var updates = {
    'Session type': type,
    'Status': type === 'OYO' ? '' : 'Full',
    'Make-up for date': '',
    'Review status': ''
  };
  if (type === 'Make-up') {
    var missed = opts.makeupFor || (isDate_(entry['Make-up for date']) ? ctx.formatDay(entry['Make-up for date']) : '');
    if (!missed) return { error: 'say which missed practice this makes up' };
    updates['Make-up for date'] = ctx.parseDate(missed);
  }
  if (opts.rpe !== undefined && opts.rpe !== null && opts.rpe !== '') {
    var rpe = Number(opts.rpe);
    if (!(rpe >= 1 && rpe <= 10)) return { error: 'RPE is 1 to 10' };
    updates['RPE'] = rpe;
  }
  var bench = null;
  if (opts.benchmark) {
    var shape = logbookBenchmarkShape(entry, intervals);
    if (shape !== opts.benchmark) return { error: 'this session does not look like a ' + opts.benchmark + ' test' };
    var piece = intervals[0];
    var timed = shape === '2000m';
    bench = {
      'Benchmark ID': ctx.newId('B'),
      'Submitted at': ctx.now,
      'Date': entry['Date'],
      'Athlete ID': entry['Athlete ID'],
      'Athlete': entry['Athlete'],
      'Entered by': entry['Entered by'],
      'Test': shape,
      'Time s': timed ? Number(piece['Work s']) : '',
      'Meters': timed ? '' : Number(piece['Work m']),
      'Avg rate': piece['Avg rate'],
      'Drag factor': entry['Drag factor'],
      'Splits s': '',
      'Coach note': 'From Logbook',
      'Source': 'Logbook',
      'Review status': '',
      'Response ID': entry['Response ID'],
      'Entry ID': entry['Entry ID'],
      'Drag check': entry['Drag factor'] === '' ? DRAG_FLAG : ''
    };
    updates['Benchmark ID'] = bench['Benchmark ID'];
    updates['Zone'] = timed ? 'Anaerobic' : 'Threshold';
    updates['Main set'] = shape + ' test';
  }
  return { updates: updates, benchmark: bench };
}

/** '2000m' or '20min' when a Logbook session is one piece of that size on the RowErg, else ''. */
function logbookBenchmarkShape(entry, intervals) {
  if (String(entry['Activity']) !== 'Erg (RowErg)' || intervals.length !== 1) return '';
  var m = Number(intervals[0]['Work m']);
  var t = Number(intervals[0]['Work s']);
  if (m >= 1990 && m <= 2010) return '2000m';
  if (t >= 1195 && t <= 1205) return '20min';
  return '';
}

/** Pure: Entry IDs of plain Pending Logbook sessions older than the auto-accept window. */
function logbookDueIds(entries, now) {
  var cutoff = now.getTime() - LOGBOOK_AUTO_ACCEPT_HOURS * 3600000;
  return entries.filter(function (e) {
    return String(e['Source']) === 'Logbook' && String(e['Review status']) === LOGBOOK_PENDING &&
      isDate_(e['Submitted at']) && e['Submitted at'].getTime() <= cutoff;
  }).map(function (e) { return e['Entry ID']; });
}

function setEntryCells_(row, updates) {
  var sheet = tab_(TABS.ENTRIES);
  var headers = HEADERS[TABS.ENTRIES];
  Object.keys(updates).forEach(function (k) {
    var col = headers.indexOf(k);
    if (col < 0) throw new Error('No column "' + k + '" on Entries');
    sheet.getRange(row, col + 1).setValue(updates[k]);
  });
}

/** doPost action logbook-confirm: {athleteId, entryId, sessionType, makeupFor, rpe, benchmark}. */
function processLogbookConfirm_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var found = findEntryBy_('Entry ID', body.entryId);
    if (!found) return { status: 'error', error: 'session not found' };
    var entry = readObjects_(TABS.ENTRIES)[found.row - 2];
    var intervals = readObjects_(TABS.INTERVALS).filter(function (iv) { return iv['Entry ID'] === entry['Entry ID']; });
    var tz = ss_().getSpreadsheetTimeZone();
    var plan = logbookConfirmPlan(entry, intervals, body.athleteId, body, {
      newId: newId_, now: new Date(), parseDate: parseFormDate_,
      formatDay: function (d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); }
    });
    if (plan.error) return { status: 'error', error: plan.error };
    if (plan.benchmark) appendObject_(TABS.BENCHMARKS, plan.benchmark);
    setEntryCells_(found.row, plan.updates);
    SpreadsheetApp.flush();
    return { status: 'confirmed', benchmark: !!plan.benchmark };
  } catch (err) {
    logChange_({ Who: 'logbook', Tab: '(logbook)', 'Row ID': String(body.entryId), Note: 'LOGBOOK CONFIRM ERROR: ' + err.message });
    return { status: 'error', error: err.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * doPost action logbook-pending: {athleteId}. Her "Found on Logbook" cards straight from the
 * Sheet, so a new session shows without waiting for the site's 5-minute feed copy.
 */
function processLogbookPending_(body) {
  var id = String(body.athleteId || '');
  var entries = readObjects_(TABS.ENTRIES).filter(function (e) { return String(e['Athlete ID']) === id; });
  var ids = {};
  entries.forEach(function (e) { ids[e['Entry ID']] = true; });
  var intervals = readObjects_(TABS.INTERVALS).filter(function (iv) { return ids[iv['Entry ID']]; });
  var known = {};
  known[id] = true;
  return { status: 'ok', pending: feedLogbookPending_({ entries: entries, intervals: intervals }, known) };
}

/** doPost action logbook-accept-due (the site's poll calls it every 15 minutes). */
function processLogbookAcceptDue_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var entries = readObjects_(TABS.ENTRIES);
    var due = logbookDueIds(entries, new Date());
    entries.forEach(function (e, i) {
      if (due.indexOf(e['Entry ID']) >= 0) setEntryCells_(i + 2, { 'Review status': '' });
    });
    if (due.length) SpreadsheetApp.flush();
    return { status: 'ok', accepted: due.length };
  } finally {
    lock.releaseLock();
  }
}
