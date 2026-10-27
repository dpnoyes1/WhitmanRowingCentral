/**
 * Form submit handling: turns a response into Entries + Intervals rows. A
 * benchmark test also writes a Benchmarks row, linked both ways by ID, so it
 * counts as a session. All times are converted to seconds here.
 *
 * parseSubmission() is pure (no Sheet or Form calls) so it can be tested in
 * Node and reused for Slack entries in phase 2.
 */

var DRAG_FLAG = 'FLAG: no drag factor';

/** Installable trigger target (form submit). */
function onFormSubmit(e) {
  if (processResponse_(e.response) === 'error') alertSubmitError_();
}

function processResponse_(response) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var responseId = response.getId();
    if (alreadyProcessed_(responseId)) return 'skipped';
    var answers = {};
    response.getItemResponses().forEach(function (ir) {
      answers[ir.getItem().getTitle()] = ir.getResponse();
    });
    try {
      var result = parseSubmission(answers, {
        submittedAt: response.getTimestamp(),
        responseId: responseId,
        athleteIds: athleteIdByName_(),
        newId: newId_,
        parseDate: parseFormDate_
      });
      writeResult_(result);
      if (result.benchmark && result.benchmark['Drag check']) {
        logChange_({
          Who: 'form', Tab: TABS.BENCHMARKS, 'Row ID': result.benchmark['Benchmark ID'],
          Note: result.benchmark['Drag check'] + ' (' + result.benchmark.Test + ', ' + result.benchmark.Athlete + ')'
        });
      }
      SpreadsheetApp.flush();
      return 'ok';
    } catch (err) {
      logChange_({
        Who: 'form', Tab: '(form)', 'Row ID': responseId,
        Note: 'SUBMIT ERROR: ' + err.message + '. Fix the data, then Erg Tracker > Process missed form responses.'
      });
      return 'error';
    }
  } finally {
    lock.releaseLock();
  }
}

function writeResult_(result) {
  if (result.benchmark) appendObject_(TABS.BENCHMARKS, result.benchmark);
  if (result.entry) {
    appendObject_(TABS.ENTRIES, result.entry);
    appendObjects_(TABS.INTERVALS, result.intervals);
  }
}

function alreadyProcessed_(responseId) {
  var tabs = [TABS.ENTRIES, TABS.BENCHMARKS];
  for (var i = 0; i < tabs.length; i++) {
    var sheet = tab_(tabs[i]);
    var col = HEADERS[tabs[i]].indexOf('Response ID') + 1;
    var last = sheet.getLastRow();
    if (last < 2) continue;
    var found = sheet.getRange(2, col, last - 1, 1).createTextFinder(responseId)
      .matchEntireCell(true).findNext();
    if (found) return true;
  }
  return false;
}

/** Menu item: re-runs every form response not yet in Entries/Benchmarks. */
function processMissedResponses() {
  var form = FormApp.openById(getSettings()['form.id']);
  var counts = { ok: 0, skipped: 0, error: 0 };
  form.getResponses().forEach(function (r) { counts[processResponse_(r)] += 1; });
  SpreadsheetApp.getUi().alert('Processed ' + counts.ok + ', already in the Sheet ' +
    counts.skipped + ', errors ' + counts.error + ' (see Change log).');
}

/**
 * answers: {question title: answer string}
 * ctx: { submittedAt, responseId, athleteIds: {name: id}, newId(prefix), parseDate(str) }
 * Returns { entry, intervals } plus { benchmark } for a test.
 */
function parseSubmission(answers, ctx) {
  var a = function (title) {
    var v = answers[title];
    return v === undefined || v === null ? '' : String(v).trim();
  };
  var num = function (title) {
    var v = a(title);
    if (v === '') return '';
    var n = Number(v);
    if (isNaN(n)) throw new Error('"' + title + '" is not a number: ' + v);
    return n;
  };

  var athlete = a(Q.ATHLETE);
  var athleteId = ctx.athleteIds[athlete];
  if (!athleteId) throw new Error('Athlete "' + athlete + '" is not on the Roster');
  var base = {
    'Submitted at': ctx.submittedAt,
    'Date': ctx.parseDate(a(Q.DATE)),
    'Athlete ID': athleteId,
    'Athlete': athlete,
    'Entered by': a(Q.ENTERED_BY),
    'Source': 'Form',
    'Review status': '',
    'Response ID': ctx.responseId
  };

  var logType = a(Q.LOG_TYPE);
  var entry = Object.assign({}, base, { 'Entry ID': ctx.newId('E') });
  if (logType === LOG_TYPES.BENCHMARK) return benchmarkSession_(a, num, base, entry, ctx);

  if (logType === LOG_TYPES.PRACTICE) {
    entry['Session type'] = 'Practice';
    var status = a(Q.STATUS);
    entry['Status'] = status === STATUSES.OUT ? 'Out' : status === STATUSES.MODIFIED ? 'Modified' : 'Full';
    if (entry['Status'] === 'Out') {
      entry['Coach note'] = a(Q.OUT_NOTE);
      return { entry: entry, intervals: [] };
    }
  } else if (logType === LOG_TYPES.OYO) {
    entry['Session type'] = 'OYO';
  } else if (logType === LOG_TYPES.MAKEUP) {
    entry['Session type'] = 'Make-up';
    entry['Status'] = 'Full';
    entry['Make-up for date'] = ctx.parseDate(a(Q.MAKEUP_FOR));
  } else {
    throw new Error('Unknown log type "' + logType + '"');
  }

  var intervals = [];
  for (var n = 1; n <= MAX_INTERVALS; n++) {
    var t = qInterval(n);
    if (a(t.WORK_TIME) === '') break;
    intervals.push({
      'Entry ID': entry['Entry ID'],
      'Interval #': n,
      'Work s': parseTime(a(t.WORK_TIME)),
      'Work m': num(t.WORK_M),
      'Avg rate': num(t.RATE),
      'Rest s': a(t.REST_TIME) === '' ? '' : parseTime(a(t.REST_TIME)),
      'Rest m': num(t.REST_M)
    });
  }
  if (!intervals.length) throw new Error('No intervals entered');
  var sum = function (key) {
    return Math.round(intervals.reduce(function (s, iv) { return s + (Number(iv[key]) || 0); }, 0) * 10) / 10;
  };

  Object.assign(entry, {
    'Activity': a(Q.ACTIVITY),
    'Warmup s': parseTime(a(Q.WARMUP)),
    'Work s': sum('Work s'),
    'Rest s': sum('Rest s'),
    'Cooldown s': a(Q.COOLDOWN) === '' ? 0 : parseTime(a(Q.COOLDOWN)),
    'Work m': sum('Work m'),
    'Rest m': sum('Rest m'),
    'Main set': a(Q.MAIN_SET),
    'Zone': a(Q.ZONE),
    'RPE': num(Q.RPE),
    'Avg HR': num(Q.HR),
    'Drag factor': num(Q.DRAG),
    'Intervals': intervals.length,
    'Coach note': a(Q.NOTE),
    'Warmup m': num(Q.WARMUP_M),
    'Cooldown m': num(Q.COOLDOWN_M)
  });
  return { entry: entry, intervals: intervals };
}

/** A test is saved twice: the result in Benchmarks, the session in Entries. */
function benchmarkSession_(a, num, base, entry, ctx) {
  var bench = parseBenchmark_(a, num, base, ctx);
  var spec = BENCHMARK_TESTS[a(Q.TEST)];
  var atPractice = a(Q.B_WHERE) === TEST_WHERE.PRACTICE;
  var workS = spec.score === 'time' ? bench['Time s'] : spec.seconds;
  var workM = spec.score === 'time' ? spec.meters : bench['Meters'];
  bench['Entry ID'] = entry['Entry ID'];
  Object.assign(entry, {
    'Session type': atPractice ? 'Practice' : 'OYO',
    'Status': atPractice ? 'Full' : '',
    'Activity': 'Erg (RowErg)',
    'Warmup s': parseTime(a(Q.B_WARMUP)),
    'Work s': workS,
    'Rest s': 0,
    'Cooldown s': a(Q.B_COOLDOWN) === '' ? 0 : parseTime(a(Q.B_COOLDOWN)),
    'Work m': workM,
    'Rest m': 0,
    'Main set': bench.Test + ' test',
    'Zone': spec.zone,
    'RPE': num(Q.B_RPE),
    'Drag factor': bench['Drag factor'],
    'Intervals': 1,
    'Benchmark ID': bench['Benchmark ID']
  });
  var interval = {
    'Entry ID': entry['Entry ID'], 'Interval #': 1, 'Work s': workS, 'Work m': workM,
    'Avg rate': bench['Avg rate'], 'Rest s': '', 'Rest m': ''
  };
  return { benchmark: bench, entry: entry, intervals: [interval] };
}

function parseBenchmark_(a, num, base, ctx) {
  var label = a(Q.TEST);
  var spec = BENCHMARK_TESTS[label];
  if (!spec) throw new Error('Unknown test "' + label + '"');
  var timed = spec.score === 'time';
  var splitsText = a(timed ? Q.T_SPLITS : Q.D_SPLITS);
  var splits = splitsText === '' ? '' : splitsText.split(/[,\s]+/).filter(String)
    .map(parseTime).join(',');
  var drag = num(timed ? Q.T_DRAG : Q.D_DRAG);
  return Object.assign({}, base, {
    'Benchmark ID': ctx.newId('B'),
    'Test': spec.key || label,
    'Time s': timed ? parseTime(a(Q.T_TIME)) : '',
    'Meters': timed ? '' : num(Q.D_METERS),
    'Avg rate': num(timed ? Q.T_RATE : Q.D_RATE),
    'Drag factor': drag,
    'Splits s': splits,
    'Coach note': a(timed ? Q.T_NOTE : Q.D_NOTE),
    // Coach-only flag. The form requires drag on tests, so this catches anything that gets past it.
    'Drag check': drag === '' ? DRAG_FLAG : ''
  });
}
