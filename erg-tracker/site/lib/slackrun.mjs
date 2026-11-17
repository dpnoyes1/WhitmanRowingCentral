// Run screenshots in ErgBot (David, 2026-11-17). NOT LIVE: used only when RUN_PHOTO_CHECK (lib/runscreen.mjs) is true.
// The erg reader runs first; when the photo is not a Concept2 monitor, the run reader gets a turn. An athlete sends it for
// herself only. The card has two Save buttons (on my own / at practice) and saves through the Sheet's existing `site-log`
// action with self = true, the same as the Log activity page, so no Apps Script change is needed. The date is today.
import { callSheet } from './slack.mjs';
import { getFeed } from './feed.mjs';
import { makeKeepCopy } from './photocopy.mjs';
import { readRunScreen, normalizeRunRead } from './runscreen.mjs';
import { randomBytes } from 'node:crypto';

const MILE = 1609.344;
const clock = (s) => `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${String(Math.floor(s % 3600 / 60)).padStart(Math.floor(s / 3600) ? 2 : 1, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const pace = (s, m, per, label) => { const p = Math.round(s / m * per); return `${Math.floor(p / 60)}:${String(p % 60).padStart(2, '0')} ${label}`; };

/** True when the erg reader found nothing at all: not a Concept2 screen, so it may be a run. */
export const looksLikeNoErg = (read) => !!read && read.totalTimeS == null && read.totalMeters == null && !(read.pieces || []).length;

export function runBlocks(text, token) {
  const btn = (id, label, style) => ({ type: 'button', action_id: id, value: token, text: { type: 'plain_text', text: label }, ...(style ? { style } : {}) });
  return [{ type: 'section', text: { type: 'mrkdwn', text } },
    { type: 'actions', elements: [btn('photo_run_oyo', 'Save: on my own', 'primary'), btn('photo_run_practice', 'Save: at practice'), btn('photo_cancel', 'Cancel')] }];
}

export function runSummary(r) {
  const mi = r.meters / MILE;
  return `${r.activity && /run|treadmill/i.test(r.activity) ? 'Run' : (r.activity || 'Run')}, ${(Math.round(mi * 100) / 100)} mi (${(Math.round(r.meters / 10) / 100)} km) in ${clock(r.timeS)}, ${pace(r.timeS, r.meters, MILE, 'per mile')}`;
}

/**
 * Called by handlePhotoEvent when the erg reader found no erg screen. Returns a status object, or null when this is not
 * a readable run either (the caller then gives its usual "can't read" answer).
 */
export async function startRunCard({ client, bytes, who, user, envFn, fetchImpl, store, say, today, deps = {} }) {
  if (who.role !== 'athlete') { await say(':running: That looks like a run screenshot. Runs are logged by athletes for themselves: ask the athlete to send it, or use Log for an athlete on the site.'); return { status: 'run_coach' }; }
  const out = await (deps.readRun || readRunScreen)({ client, bytes });
  if (!out.ok || !out.read) return null;
  const read = out.read;
  const meters = read.meters, timeS = read.movingS || read.elapsedS;
  if (!(meters > 0) || !(timeS > 0)) return null;
  if (/walk|ride|bike|cycl|swim|row|weight|lift/i.test(read.activity) && !/run/i.test(read.activity)) {
    await say(`:warning: That looks like ${read.activity.toLowerCase()}, not a run. Log it on the site under Log activity.`);
    return { status: 'run_other' };
  }
  let athleteId = '';
  try {
    if (deps.athleteIdOf) athleteId = await deps.athleteIdOf(who.athlete);
    else { const { data } = await getFeed(envFn, { fetchImpl }); athleteId = (data.athletes.find((a) => a.name === who.athlete && a.active) || {}).id || ''; }
  } catch { /* below */ }
  if (!athleteId) { await say(':warning: I could not find you on the roster just now. Please send the screenshot again in a minute.'); return { status: 'error' }; }
  let copy = '';
  try { copy = (await (deps.makeCopy || makeKeepCopy)(bytes)).bytes.toString('base64'); } catch { /* the run is still logged without it */ }
  const token = randomBytes(9).toString('hex');
  const card = { kind: 'run', user, athlete: who.athlete, athleteId, activity: 'Run', meters, timeS, date: today, image: copy, flags: read.flags || [], at: Date.now() };
  await store.set('card:' + token, card);
  const text = `*For ${who.athlete}:* ${runSummary({ ...read, meters, timeS })}, today. Check the numbers, then save.${read.flags.length ? '\n_Note: ' + read.flags.join('; ') + '_' : ''}`;
  await say(text, runBlocks(text, token));
  return { status: 'card', athlete: who.athlete, kind: 'run' };
}

/** A press on a run card's Save button. `sendReply` is passed in to avoid a circular import. */
export async function saveRunCard({ payload, card, token, envFn, fetchImpl, store, text, reply }) {
  const type = payload.actions[0].action_id === 'photo_run_practice' ? 'practice' : 'oyo';
  await store.delete('card:' + token);   // first press wins
  const base = text.replace(/\nCheck the numbers[\s\S]*$/, '');
  const line = (l) => reply({ replace_original: true, text: `${base}\n${l}`, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: base } }, { type: 'context', elements: [{ type: 'mrkdwn', text: l }] }] });
  await line(':hourglass_flowing_sand: Saving, this can take several seconds. Please wait...');
  let result;
  try {
    result = await callSheet(envFn, fetchImpl, { action: 'site-log', self: true, athleteId: card.athleteId, requestId: 'slackrun:' + token,
      form: { date: card.date, type, activity: 'Run', pieces: `${clock(card.timeS)}.0, ${card.meters}`, note: 'Logged from a run screenshot in Slack.' },
      ...(card.image ? { photo: card.image } : {}) });
  } catch (err) { result = { status: 'error', error: err.message }; }
  if (result.status === 'ok') { await line(`:white_check_mark: Saved ${type === 'practice' ? 'at practice' : 'on your own'} for ${card.date}.${result.photo === 'failed' ? ' The screenshot copy could not be kept.' : ''}`); return { status: 'ok', kind: 'run' }; }
  if (result.status === 'duplicate') { await line(':information_source: Already saved. Nothing changed.'); return { status: 'duplicate' }; }
  await store.set('card:' + token, card);   // let her press again
  await reply({ replace_original: true, text: `${base}\n:warning: Not saved: ${result.message || result.error || result.status}. Press a button to try again.`,
    blocks: runBlocks(`${base}\n:warning: Not saved: ${result.message || result.error || result.status}. Press a button to try again.`, token) });
  return { status: result.status };
}
