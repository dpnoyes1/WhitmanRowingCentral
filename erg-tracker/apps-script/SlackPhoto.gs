/**
 * Erg-screen photos in Slack (David, 2026-10-28), for coaches (any athlete) and
 * athletes (herself only). The Slack function (site/lib/slackphoto.mjs) reads
 * the photo, a coach names the athlete (an athlete is herself) and presses an
 * RPE button, and these actions save it through the same parseSubmission as
 * the Form. Source = Slack. The photo itself is not
 * stored yet (photo plan step 6).
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

/** doPost action 'slack-photo': body { slackUserId, slackName, token, athlete, photo }. */
function processSlackPhoto_(body) {
  return slackSave_(body, 'slack-photo:' + (body.token || ''), !!body.token, body.athlete, function (name, by) {
    return slackPhotoAnswers(body.photo || {}, name, by);
  });
}
