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
 * [{ timeS, meters, rate, restS }], rpe, note }. A photo is a Practice, Full
 * (default, David can change); warmup, zone and drag factor stay blank
 * because the screen doesn't show them. Times arrive as seconds.
 */
function slackPhotoAnswers(photo, athleteName, enteredBy) {
  if (photo.benchmark) return slackPhotoTestAnswers_(photo, athleteName, enteredBy);
  var answers = {};
  answers[Q.ATHLETE] = athleteName;
  answers[Q.ENTERED_BY] = enteredBy || athleteName;
  answers[Q.DATE] = photo.date;
  answers[Q.LOG_TYPE] = LOG_TYPES.PRACTICE;
  answers[Q.STATUS] = STATUSES.FULL;
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
 * at practice, so it writes the Benchmarks row and the session. Drag factor
 * isn't on the screen, so the usual "no drag factor" flag is raised.
 */
function slackPhotoTestAnswers_(photo, athleteName, enteredBy) {
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
  answers[Q.B_WHERE] = TEST_WHERE.PRACTICE;
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

/** doPost action 'slack-photo': body { slackUserId, slackName, token, athlete, photo }. */
function processSlackPhoto_(body) {
  var image = (body.photo || {}).image || '';
  var saved = { photo: 'none' };
  var out = slackSave_(body, 'slack-photo:' + (body.token || ''), !!body.token, body.athlete, function (name, by) {
    return slackPhotoAnswers(body.photo || {}, name, by);
  }, {
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
  if (out.status === 'ok') { out.photo = saved.photo; out.benchmark = !!(body.photo || {}).benchmark; }
  return out;
}
