/**
 * Builds the single branching log form.
 *
 * Section flow:
 *   Start (athlete, entered by, date, what are you logging?)
 *     Practice  -> Practice status -> Full/Modified -> Session
 *                                  -> Out -> Out note -> submit
 *     OYO       -> Session
 *     Make-up   -> Missed date -> Session
 *     Benchmark -> Where/warmup/RPE + test -> Time test | Distance test -> submit
 *   Session -> Interval 1 -> "Another?" Yes -> Interval 2 ... Interval 10
 *                                       No  -> Finish -> submit
 *
 * Google Forms can't prefill defaults, so drag 105 lives in the prefilled
 * share link written to Settings > form.share_url. Warmup is not prefilled:
 * it changes from day to day (David, 2026-10-23).
 */

function buildForm_(settings) {
  var form = FormApp.create('Whitman Girls Erg Log');
  form.setDescription('Log a practice, OYO session, make-up or benchmark test. ' +
    'Type times as m:ss.0, for example 7:42.8 or 0:17.5.')
    .setConfirmationMessage('Logged. Thanks!')
    .setAllowResponseEdits(false)
    .setLimitOneResponsePerUser(false)
    .setProgressBar(false);

  var timeCheck = function () {
    return FormApp.createTextValidation()
      .setHelpText('Use m:ss.0, for example 7:42.8 or 0:17.5')
      .requireTextMatchesPattern(TIME_PATTERN)
      .build();
  };
  var wholeBetween = function (lo, hi, help) {
    return FormApp.createTextValidation().setHelpText(help)
      .requireNumberBetween(lo, hi).build();
  };
  var addTime = function (title, required, help) {
    return form.addTextItem().setTitle(title).setRequired(required)
      .setHelpText(help || 'm:ss.0').setValidation(timeCheck());
  };
  var addNumber = function (title, required, lo, hi, help) {
    return form.addTextItem().setTitle(title).setRequired(required)
      .setValidation(wholeBetween(lo, hi, help || ('A number from ' + lo + ' to ' + hi)));
  };

  // Start
  var athlete = form.addListItem().setTitle(Q.ATHLETE).setRequired(true)
    .setHelpText('Who did the workout?');
  var enteredBy = form.addListItem().setTitle(Q.ENTERED_BY).setRequired(true)
    .setHelpText('Who is filling out this form? Pick your own name if it was you.');
  form.addDateItem().setTitle(Q.DATE).setRequired(true);
  var logType = form.addMultipleChoiceItem().setTitle(Q.LOG_TYPE).setRequired(true);

  // Practice status
  var pbPractice = form.addPageBreakItem().setTitle('Practice');
  var status = form.addMultipleChoiceItem().setTitle(Q.STATUS).setRequired(true);

  // Out
  var pbOut = form.addPageBreakItem().setTitle('Out today');
  form.addParagraphTextItem().setTitle(Q.OUT_NOTE)
    .setHelpText('Only coaches see this.');

  // Make-up
  var pbMakeup = form.addPageBreakItem().setTitle('Make-up')
    .setHelpText('Make-ups count fully when done within ' + settings.makeup_window_days +
      ' days of the missed practice.');
  pbMakeup.setGoToPage(FormApp.PageNavigationType.SUBMIT);   // end of "Out" submits
  form.addDateItem().setTitle(Q.MAKEUP_FOR).setRequired(true);

  // Session
  var pbSession = form.addPageBreakItem().setTitle('Session');
  form.addListItem().setTitle(Q.ACTIVITY).setRequired(true)
    .setChoiceValues(ACTIVITIES.map(function (a) { return a[0]; }));
  addTime(Q.WARMUP, true, WARMUP_HELP);
  form.addTextItem().setTitle(Q.MAIN_SET).setRequired(true)
    .setHelpText('Describe the workout. Then enter each piece below.');
  form.addMultipleChoiceItem().setTitle(Q.ZONE).setRequired(true)
    .setHelpText('Pick the zone of the main set.')
    .setChoiceValues(ZONES);

  // Intervals
  var pbIntervals = [];
  var anotherItems = [];
  for (var n = 1; n <= MAX_INTERVALS; n++) {
    var t = qInterval(n);
    var pb = form.addPageBreakItem().setTitle('Interval ' + n)
      .setHelpText(n === 1 ? 'A single steady piece counts as one interval.' : '');
    pbIntervals.push(pb);
    addTime(t.WORK_TIME, true);
    addNumber(t.WORK_M, true, 0, 100000, WORK_M_HELP);
    addNumber(t.RATE, false, 10, 60);
    addTime(t.REST_TIME, false, 'Rest after this piece, m:ss.0');
    addNumber(t.REST_M, false, 0, 10000, 'Meters you rowed during the rest');
    if (n < MAX_INTERVALS) {
      anotherItems.push(form.addMultipleChoiceItem().setTitle(t.ANOTHER).setRequired(true));
    }
  }

  // Finish
  var pbFinish = form.addPageBreakItem().setTitle('Finish');
  addTime(Q.COOLDOWN, false);
  form.addScaleItem().setTitle(Q.RPE).setRequired(true).setBounds(1, 10)
    .setLabels('Very easy', 'Max effort');
  addNumber(Q.HR, false, 40, 230);
  addNumber(Q.DRAG, false, 50, 250, 'Prefilled at ' + settings.default_drag_factor);
  form.addParagraphTextItem().setTitle(Q.NOTE).setHelpText('Only coaches see this.');

  // Benchmark
  var pbBench = form.addPageBreakItem().setTitle('Benchmark test');
  pbBench.setGoToPage(FormApp.PageNavigationType.SUBMIT);    // end of "Finish" submits
  form.addMultipleChoiceItem().setTitle(Q.B_WHERE).setRequired(true)
    .setHelpText('Tests also count as a training session.')
    .setChoiceValues([TEST_WHERE.PRACTICE, TEST_WHERE.OYO]);
  addTime(Q.B_WARMUP, true, WARMUP_HELP);
  addTime(Q.B_COOLDOWN, false);
  form.addScaleItem().setTitle(Q.B_RPE).setRequired(true).setBounds(1, 10)
    .setLabels('Very easy', 'Max effort');
  var test = form.addMultipleChoiceItem().setTitle(Q.TEST).setRequired(true);

  var pbTime = form.addPageBreakItem().setTitle('Timed test (100m, 500m, 2000m)');
  addTime(Q.T_TIME, true);
  addNumber(Q.T_RATE, false, 10, 60);
  addNumber(Q.T_DRAG, false, 50, 250);
  form.addTextItem().setTitle(Q.T_SPLITS).setHelpText('2000m only, e.g. 1:55.2, 1:56.0, 1:56.1, 1:54.8');
  form.addParagraphTextItem().setTitle(Q.T_NOTE);

  var pbDist = form.addPageBreakItem().setTitle("Distance test (20', 30r20)");
  pbDist.setGoToPage(FormApp.PageNavigationType.SUBMIT);     // end of "Timed test" submits
  addNumber(Q.D_METERS, true, 100, 20000, 'Total meters');
  addNumber(Q.D_RATE, true, 10, 60, 'Required. 30r20 counts when the average is 20 or lower.');
  addNumber(Q.D_DRAG, false, 50, 250);
  form.addTextItem().setTitle(Q.D_SPLITS).setHelpText('e.g. 1:58.0, 1:58.4, ...');
  form.addParagraphTextItem().setTitle(Q.D_NOTE);

  // Navigation (needs the page breaks above to exist first)
  logType.setChoices([
    logType.createChoice(LOG_TYPES.PRACTICE, pbPractice),
    logType.createChoice(LOG_TYPES.OYO, pbSession),
    logType.createChoice(LOG_TYPES.MAKEUP, pbMakeup),
    logType.createChoice(LOG_TYPES.BENCHMARK, pbBench)
  ]);
  status.setChoices([
    status.createChoice(STATUSES.FULL, pbSession),
    status.createChoice(STATUSES.MODIFIED, pbSession),
    status.createChoice(STATUSES.OUT, pbOut)
  ]);
  anotherItems.forEach(function (item, i) {
    item.setChoices([
      item.createChoice('Yes', pbIntervals[i + 1]),
      item.createChoice('No, that was the last one', pbFinish)
    ]);
  });
  test.setChoices(Object.keys(BENCHMARK_TESTS).map(function (name) {
    return test.createChoice(name, BENCHMARK_TESTS[name].score === 'time' ? pbTime : pbDist);
  }));

  return form;
}

/** Refills the Athlete and Entered by dropdowns from the Roster. */
function refreshFormDropdowns() {
  var settings = getSettings();
  if (!settings['form.id']) return;
  fillMissingAthleteIds_();
  var form = FormApp.openById(settings['form.id']);
  var athletes = activeRoster_(false).map(function (r) { return String(r.Name).trim(); }).sort();
  var everyone = activeRoster_(true).map(function (r) { return String(r.Name).trim(); }).sort();
  var coaches = String(settings.coaches || '').split(',')
    .map(function (s) { return s.trim(); }).filter(String);
  var placeholder = ['(add active athletes to the Roster tab)'];

  form.getItems(FormApp.ItemType.LIST).forEach(function (item) {
    var title = item.getTitle();
    if (title === Q.ATHLETE) {
      item.asListItem().setChoiceValues(athletes.length ? athletes : placeholder);
    } else if (title === Q.ENTERED_BY) {
      var list = coaches.concat(everyone);
      item.asListItem().setChoiceValues(list.length ? list : placeholder);
    }
  });
}

/** Gives every Roster row an Athlete ID (A001, A002...) so renames keep history. */
function fillMissingAthleteIds_() {
  var sheet = tab_(TABS.ROSTER);
  var last = sheet.getLastRow();
  if (last < 2) return;
  var range = sheet.getRange(2, 1, last - 1, 2);
  var values = range.getValues();
  var max = 0;
  values.forEach(function (r) {
    var m = String(r[0]).match(/^A(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  var changed = false;
  values.forEach(function (r) {
    if (!r[0] && r[1]) {
      max += 1;
      r[0] = 'A' + ('00' + max).slice(-3);
      changed = true;
    }
  });
  if (changed) range.setValues(values);
}

var WARMUP_HELP = 'Time spent warming up before the main set, m:ss. It is different from day to day.';
var WORK_M_HELP = 'Meters for this piece. Enter 0 for lifting.';

/**
 * Brings the questions of the live form up to date in place (the link stays the
 * same): warmup help text and Work meters allowing 0 for lifting.
 */
function refreshFormQuestions_(form) {
  var zeroOk = FormApp.createTextValidation().setHelpText(WORK_M_HELP)
    .requireNumberBetween(0, 100000).build();
  var workTitles = {};
  for (var n = 1; n <= MAX_INTERVALS; n++) workTitles[qInterval(n).WORK_M] = true;
  form.getItems(FormApp.ItemType.TEXT).forEach(function (item) {
    var title = item.getTitle();
    if (title === Q.WARMUP || title === Q.B_WARMUP) {
      item.asTextItem().setHelpText(WARMUP_HELP);
    } else if (workTitles[title]) {
      item.asTextItem().setHelpText(WORK_M_HELP).setValidation(zeroOk);
    }
  });
}

/** Share link with the drag factor prefilled (warmup is different every day). */
function prefilledUrl_(form, settings) {
  var response = form.createResponse();
  form.getItems(FormApp.ItemType.TEXT).forEach(function (item) {
    var title = item.getTitle();
    if (title === Q.DRAG) {
      response.withItemResponse(item.asTextItem().createResponse(settings.default_drag_factor));
    }
  });
  return response.toPrefilledUrl();
}
