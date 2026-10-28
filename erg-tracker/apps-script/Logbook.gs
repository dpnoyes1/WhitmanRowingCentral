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
  var sheet = tab_(TABS.ENTRIES);
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var headers = HEADERS[TABS.ENTRIES];
  var col = headers.indexOf('Response ID') + 1;
  var found = sheet.getRange(2, col, last - 1, 1).createTextFinder(responseId).matchEntireCell(true).findNext();
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
