/**
 * Erg-screen photos in Slack (David, 2026-10-28), for coaches (any athlete) and
 * athletes (herself only). The Slack function (site/lib/slackphoto.mjs) reads
 * the photo, a coach names the athlete (an athlete is herself) and presses an
 * RPE button, and these actions save it through the same parseSubmission as
 * the Form. Source = Slack. The shrunk photo copy comes with the save and goes
 * to Drive (Photos.gs); the Entries row keeps only the link.
 */

var SLACK_ACCESS_ACTION = 'slack-access';
var SLACK_PHOTO_ACTION = 'slack-photo';

/**
 * The saved read -> Form answers. photo: { date, machine, title, pieces:
 * [{ timeS, meters, rate, restS }], rpe, note }. session (from
 * slackPhotoSession_) says Practice (Full), OYO or Make-up; Practice when
 * left out. Warmup, zone and drag factor stay blank because the screen
 * doesn't show them. Times arrive as seconds.
 */
function slackPhotoAnswers(photo, athleteName, enteredBy, session) {
  var type = (session && session.type) || 'Practice';
  if (photo.benchmark) return slackPhotoTestAnswers_(photo, athleteName, enteredBy, type);
  var answers = {};
  answers[Q.ATHLETE] = athleteName;
  answers[Q.ENTERED_BY] = enteredBy || athleteName;
  answers[Q.DATE] = photo.date;
  if (type === 'OYO') {
    answers[Q.LOG_TYPE] = LOG_TYPES.OYO;
  } else if (type === 'Make-up') {
    answers[Q.LOG_TYPE] = LOG_TYPES.MAKEUP;
    answers[Q.MAKEUP_FOR] = session.makeupFor;
  } else {
    answers[Q.LOG_TYPE] = LOG_TYPES.PRACTICE;
    answers[Q.STATUS] = STATUSES.FULL;
  }
  answers[Q.ACTIVITY] = photo.machine === 'BikeErg' ? 'BikeErg' : 'Erg (RowErg)';
  answers[Q.MAIN_SET] = photo.title || 'Erg screen photo';
  answers[Q.RPE] = photo.rpe || '';
  answers[Q.NOTE] = photo.note || '';
  var pieces = photo.pieces || [];
  if (!pieces.length) throw new Error('No pieces in the photo read');
  if (pieces.length > MAX_INTERVALS) throw new Error('More than ' + MAX_INTERVALS + ' pieces on the screen');
  pieces.forEach(function (p, i) {
    var t = qInterval(i + 1);
    answers[t.WORK_TIME] = formatTime(p.timeS);
    answers[t.WORK_M] = p.meters;
    answers[t.RATE] = p.rate == null ? '' : p.rate;
    answers[t.REST_TIME] = p.restS ? formatTime(p.restS) : '';
  });
  return answers;
}

/**
 * The athlete said the photo is a 2k or 20' test (David, 2026-11-03). One RowErg
 * piece of exactly 2000 m ('2000m') or 20:00 ('20min'), saved like a Form test
 * at practice (on my own on a day with no practice), so it writes the
 * Benchmarks row and the session. Drag factor
 * isn't on the screen, so the usual "no drag factor" flag is raised.
 */
function slackPhotoTestAnswers_(photo, athleteName, enteredBy, type) {
  var pieces = photo.pieces || [];
  var p = pieces[0];
  if (pieces.length !== 1) throw new Error('A test is one piece');
  if (photo.machine === 'BikeErg') throw new Error('A BikeErg result is never a benchmark test');
  var timed = photo.benchmark === '2000m';
  if (photo.benchmark !== '2000m' && photo.benchmark !== '20min') throw new Error('Unknown test "' + photo.benchmark + '"');
  if (timed ? Number(p.meters) !== 2000 : Number(p.timeS) !== 1200) throw new Error('This piece is not a ' + photo.benchmark + ' test');
  var answers = {};
  answers[Q.ATHLETE] = athleteName;
  answers[Q.ENTERED_BY] = enteredBy || athleteName;
  answers[Q.DATE] = photo.date;
  answers[Q.LOG_TYPE] = LOG_TYPES.BENCHMARK;
  answers[Q.B_WHERE] = type === 'Practice' ? TEST_WHERE.PRACTICE : TEST_WHERE.OYO;
  answers[Q.TEST] = timed ? '2000m' : "20' (20 min)";
  answers[Q.B_RPE] = photo.rpe || '';
  if (timed) {
    answers[Q.T_TIME] = formatTime(p.timeS);
    answers[Q.T_RATE] = p.rate == null ? '' : p.rate;
    answers[Q.T_NOTE] = photo.note || '';
  } else {
    answers[Q.D_METERS] = p.meters;
    answers[Q.D_RATE] = p.rate == null ? '' : p.rate;
    answers[Q.D_NOTE] = photo.note || '';
  }
  return answers;
}

/**
 * Practice, OYO or Make-up for a photo (David, 2026-11-18: "Weekend should
 * assume OYO unless it's a make up"). Pure, tested in Node.
 * A day with a practice for the athlete's squad (not canceled) is a Practice.
 * Any other day, weekends included, is OYO, unless the athlete has an open
 * make-up (openMakeups_, the Logbook's rule): then ErgBot asks "Make-up or
 * OYO?" and nothing is saved until the answer comes back as chosen
 * { sessionType: 'oyo' | 'makeup', makeupFor: 'YYYY-MM-DD' }.
 * A test is never asked: on a day with no practice it is "On my own".
 * Returns { type: 'Practice' | 'OYO' | 'Make-up', makeupFor } or { ask: true, missed: [dates, newest first] }.
 */
function slackPhotoSession_(squad, date, practices, entries, chosen, isTest) {
  var practiceDay = practices.some(function (p) {
    return p.date === date && !p.canceled && practiceForSquad_(p.squad, squad);
  });
  var pick = String((chosen && chosen.sessionType) || '').toLowerCase();
  if (pick === 'oyo') return { type: 'OYO', makeupFor: '' };
  if (pick === 'makeup') {
    var mf = String(chosen.makeupFor || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(mf) || mf >= date) throw new Error('Pick the missed practice day');
    return { type: 'Make-up', makeupFor: mf };
  }
  if (practiceDay) return { type: 'Practice', makeupFor: '' };
  if (isTest) return { type: 'OYO', makeupFor: '' };
  var missed = openMakeups_(squad, date, practices, entries);
  if (missed.length) return { ask: true, missed: missed };
  return { type: 'OYO', makeupFor: '' };
}

/** doPost action 'slack-photo': body { slackUserId, slackName, token, athlete, photo }. photo.sessionType / photo.makeupFor answer "Make-up or OYO?". */
function processSlackPhoto_(body) {
  var photo = body.photo || {};
  var image = photo.image || '';
  var saved = { photo: 'none' };
  var session = null;
  var out = slackSave_(body, 'slack-photo:' + (body.token || ''), !!body.token, body.athlete, function (name, by) {
    return slackPhotoAnswers(photo, name, by, session);
  }, {
    beforeParse: function (athlete) {
      var tz = ss_().getSpreadsheetTimeZone();
      var day = function (d) { return d instanceof Date ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : ''; };
      session = slackPhotoSession_(athlete.Squad, String(photo.date || ''), classifierPractices_(day),
        classifierEntries_(athlete['Athlete ID'], day, ''), { sessionType: photo.sessionType, makeupFor: photo.makeupFor }, !!photo.benchmark);
      return session.ask ? { status: 'ask_makeup', missed: session.missed, athlete: String(athlete.Name).trim() } : null;
    },
    beforeWrite: function (result, athlete) {
      var early = photoBeforeWrite_(image)(result, athlete);   // Logbook already has this workout: it wins
      if (early) return early;
      if (image) {
        try {
          result.entry['Photo link'] = savePhotoCopy_(image, result.entry['Entry ID']);
          saved.photo = 'saved';
        } catch (err) {
          saved.photo = 'failed';   // the workout still saves; the coach can ask for the photo again
          logChange_({ Who: 'slack', Tab: '(photo)', 'Row ID': result.entry['Entry ID'], Note: 'PHOTO SAVE ERROR: ' + err.message });
        }
      }
      return null;
    }
  });
  if (out.status === 'ok') { out.photo = saved.photo; out.benchmark = !!photo.benchmark; out.makeupFor = session ? session.makeupFor : ''; }
  return out;
}
