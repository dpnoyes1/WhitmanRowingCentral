// Erg-screen photos in Slack, coaches only (David, 2026-10-28). A coach sends a
// photo to the bot; the bot reads it (ergscreen.mjs), runs the checks
// (ergchecks.mjs), asks which athlete, and shows a card whose RPE buttons save it
// through the Sheet (apps-script/SlackPhoto.gs). Pending photos and cards are kept
// in a small Netlify Blobs store; tests pass a fake `deps.store`.
import { callSheet, dmBlocks, sendReply } from './slack.mjs';
import { readErgScreen, MODELS, MAX_IMAGE_BYTES } from './ergscreen.mjs';
import { runChecks, parseScreenDate, parseTitle, formatClock } from './ergchecks.mjs';
import { todayEastern } from './slacklog.mjs';
import { randomBytes } from 'node:crypto';

const MAX_PIECES = 10;
const TOO_OLD_MS = 24 * 3600 * 1000;   // a pending photo is forgotten after a day

/** A client with the one call readErgScreen needs, over plain fetch (no SDK dependency). */
export function anthropicClient(apiKey, fetchImpl = fetch) {
  return { messages: { create: async (body) => {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || 'Anthropic API ' + res.status);
    return data;
  } } };
}

async function defaultStore() {
  const { getStore } = await import('@netlify/blobs');
  const store = getStore('slack-photo');
  return {
    get: (k) => store.get(k, { type: 'json' }),
    set: (k, v) => store.setJSON(k, v),
    delete: (k) => store.delete(k)
  };
}

const meters = (n) => `${n} m`;

/** What goes in the entry: one piece of totals for a single piece, the pieces for an interval workout. */
export function entryPieces(read) {
  const title = parseTitle(read.title);
  if (title && title.kind === 'intervals' && read.pieces.length) {
    return read.pieces.map((p, i) => ({
      timeS: p.timeS,
      meters: p.meters != null ? p.meters : (title.by === 'distance' ? title.value : null),
      rate: p.rate,
      restS: i < read.pieces.length - 1 ? title.restS : 0
    }));
  }
  return [{ timeS: read.totalTimeS, meters: read.totalMeters, rate: read.avgRate, restS: 0 }];
}

/** One line describing the read, for the coach. */
export function summaryLine(read, pieces) {
  const total = pieces.reduce((a, p) => ({ t: a.t + (p.timeS || 0), m: a.m + (p.meters || 0) }), { t: 0, m: 0 });
  const what = pieces.length > 1 ? `${pieces.length} pieces` : 'one piece';
  return `${read.title ? read.title + ', ' : ''}${read.machine || 'erg'}, ${what}, ${meters(total.m)} in ${formatClock(total.t)}`;
}

/** Read and check, retrying once on the stronger model when a check fails. */
export async function readAndCheck({ client, bytes, today }) {
  const attempt = async (model) => {
    const r = await readErgScreen({ client, bytes, model });
    if (!r.ok) return { fail: r };
    return { checked: runChecks(r.read, { today, priorTotals: [] }) };
  };
  let a = await attempt(MODELS.primary);
  if (!a.checked || a.checked.status !== 'clean') {
    const b = await attempt(MODELS.retry);
    if (b.checked && (!a.checked || b.checked.status === 'clean')) a = b;
    else if (!a.checked) a = b;
  }
  return a;
}

const problemText = (issues) => issues.filter((i) => i.level === 'hold' || i.level === 'ask')
  .map((i) => (i.athlete || i.coach).replace(/ A coach has been told\.?/, '').replace(/ or type it in with \/log\./, ' or use /log.')).join('\n');

export function cardBlocks(text, token) {
  const btn = (id, label, style) => ({ type: 'button', action_id: id, value: token, text: { type: 'plain_text', text: label }, ...(style ? { style } : {}) });
  return [
    { type: 'section', text: { type: 'mrkdwn', text } },
    { type: 'actions', elements: Array.from({ length: 10 }, (_, i) => btn(`photo_rpe_${i + 1}`, String(i + 1))) },
    { type: 'actions', elements: [btn('photo_norpe', 'Save without RPE', 'primary'), btn('photo_cancel', 'Cancel')] }
  ];
}

const isImage = (f) => f && /^image\/(jpeg|png)$/.test(f.mimetype || '');

async function download(envFn, fetchImpl, file) {
  const res = await fetchImpl(file.url_private_download || file.url_private, { headers: { authorization: `Bearer ${envFn('SLACK_BOT_TOKEN')}` } });
  if (!res.ok) throw new Error('Slack file download ' + res.status);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Photo is over 5 MB');
  return bytes;
}

/** A message in the bot's DM: a photo (starts the flow) or text (the athlete's name). */
export async function handlePhotoEvent(event, envFn, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const store = deps.store || await defaultStore();
  const today = deps.today || todayEastern();
  const user = event.user;
  if (!user || event.bot_id || (event.subtype && event.subtype !== 'file_share')) return { ignored: 'not a person message' };
  const say = (text, blocks) => dmBlocks(envFn, fetchImpl, user, text, blocks);

  const image = (event.files || []).find(isImage);
  if ((event.files || []).length && !image) { await say('I can only read JPEG or PNG photos of the erg screen.'); return { status: 'bad_file' }; }

  if (image) {
    const who = await callSheet(envFn, fetchImpl, { action: 'slack-access', slackUserId: user }).catch((e) => ({ status: 'error', error: e.message }));
    if (who.status === 'not_allowed') { await say(':lock: Photo logging is for coaches for now. Please use the Form: whitmanrowingcentral.netlify.app/logworkout'); return { status: 'not_allowed' }; }
    if (who.status !== 'ok') { await say(':warning: I could not check the roster just now. Please send the photo again in a minute.'); return { status: 'error' }; }
    const key = envFn('ANTHROPIC_API_KEY');
    if (!key) { await say(':warning: Photo reading is not set up yet (no API key). Use /log for now.'); return { status: 'no_key' }; }
    let bytes;
    try { bytes = await download(envFn, fetchImpl, image); } catch (err) { await say(`:warning: I couldn't get that photo (${err.message}). Please send it again.`); return { status: 'download_failed' }; }
    const out = await readAndCheck({ client: anthropicClient(key, fetchImpl), bytes, today });
    if (out.fail) { await say(`:warning: I couldn't read that photo (${out.fail.message}). Please send a clearer one, or use /log.`); return { status: out.fail.reason }; }
    const { read, issues, status } = out.checked;
    if (status !== 'clean') { await say(`:warning: I can't save this one yet.\n${problemText(issues)}`); return { status }; }
    const pieces = entryPieces(read);
    if (pieces.length > MAX_PIECES) { await say(`:warning: That screen has more than ${MAX_PIECES} pieces. Please use /log.`); return { status: 'too_many' }; }
    const shown = parseScreenDate(read.date, today);
    const useShown = shown && Math.abs(Math.round((Date.parse(today) - Date.parse(shown)) / 86400000)) <= 3;   // a clock-reset date is flagged, not used
    const notes = [`Logged from an erg photo by a coach.`, ...issues.filter((i) => i.coach).map((i) => i.coach), ...read.flags];
    if (pieces.length === 1 && read.pieces.length > 1) notes.push('Splits: ' + read.pieces.map((p) => (p.splitS != null ? formatClock(p.splitS) : '?')).join(', '));
    await store.set('pending:' + user, { at: Date.now(), summary: summaryLine(read, pieces), machine: read.machine, title: read.title, date: useShown ? shown : today, pieces, note: notes.join(' | ').slice(0, 400) });
    const caption = String(event.text || '').trim();
    if (!caption) { await say(`:eyes: Read: ${summaryLine(read, pieces)}.\nWhich athlete is this for? Reply with her full name.`); return { status: 'asked' }; }
    return nameStep(caption, user, event, envFn, fetchImpl, store, say);
  }

  const name = String(event.text || '').trim();
  if (!name) return { ignored: 'empty' };
  const pending = await store.get('pending:' + user);
  if (!pending || Date.now() - pending.at > TOO_OLD_MS) return { ignored: 'nothing pending' };
  return nameStep(name, user, event, envFn, fetchImpl, store, say);
}

async function nameStep(name, user, event, envFn, fetchImpl, store, say) {
  const pending = await store.get('pending:' + user);
  const who = await callSheet(envFn, fetchImpl, { action: 'slack-access', slackUserId: user, athleteName: name }).catch((e) => ({ status: 'error', error: e.message }));
  if (who.status === 'not_allowed') { await say(':lock: Photo logging is for coaches for now.'); return { status: 'not_allowed' }; }
  if (who.status === 'unknown_name') { await say(`I can't find "${name}" as an active athlete on the roster. Reply with her full name as it is on the roster.`); return { status: 'unknown_name' }; }
  if (who.status !== 'ok') { await say(':warning: I could not check the roster just now. Please send the name again in a minute.'); return { status: 'error' }; }
  const token = randomBytes(9).toString('hex');
  await store.set('card:' + token, { user, athlete: who.athlete, ...pending });
  await store.delete('pending:' + user);
  const text = `*For ${who.athlete}:* ${pending.summary}.\nTap the session RPE to save it, or save without one.`;
  await say(text, cardBlocks(text, token));
  return { status: 'card', athlete: who.athlete };
}

/** A press on the card: an RPE number saves, "without RPE" saves, Cancel drops it. */
export async function handlePhotoButton(payload, envFn, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const store = deps.store || await defaultStore();
  const action = payload.actions[0];
  const id = action.action_id;
  const token = action.value;
  const text = (payload.message && payload.message.text) || 'Erg photo';
  const replace = (line) => ({ replace_original: true, text: `${text}\n${line}`, blocks: [
    { type: 'section', text: { type: 'mrkdwn', text } }, { type: 'context', elements: [{ type: 'mrkdwn', text: line }] }] });
  const note = (line) => ({ response_type: 'ephemeral', replace_original: false, text: line });
  const card = await store.get('card:' + token);
  if (!card) { await sendReply(envFn, fetchImpl, payload, note('That card was already used or has expired. Send the photo again.')); return { status: 'gone' }; }
  if (card.user !== payload.user.id) { await sendReply(envFn, fetchImpl, payload, note('Only the coach who sent the photo can save it.')); return { status: 'not_owner' }; }
  if (id === 'photo_cancel') {
    await store.delete('card:' + token);
    await sendReply(envFn, fetchImpl, payload, replace(':x: Cancelled, nothing was saved.'));
    return { status: 'cancelled' };
  }
  const m = id.match(/^photo_rpe_(\d+)$/);
  const rpe = m ? m[1] : id === 'photo_norpe' ? '' : null;
  if (rpe === null) return { ignored: 'unknown button' };
  await store.delete('card:' + token);   // first press wins
  const name = payload.user.name || payload.user.username || payload.user.id;
  let result;
  try {
    result = await callSheet(envFn, fetchImpl, { action: 'slack-photo', slackUserId: payload.user.id, slackName: name, token, athlete: card.athlete,
      photo: { date: card.date, machine: card.machine, title: card.title, pieces: card.pieces, rpe, note: card.note } });
  } catch (err) {
    result = { status: 'error', error: err.message };
  }
  if (result.status === 'ok') {
    await sendReply(envFn, fetchImpl, payload, replace(`:white_check_mark: Saved for ${result.athlete}${rpe ? ` with RPE ${rpe}` : ''}.` + (result.flagged ? ' It doesn\'t match the plan, so a plan check was posted.' : '')));
  } else if (result.status === 'duplicate') {
    await sendReply(envFn, fetchImpl, payload, replace(':information_source: Already saved. Nothing changed.'));
  } else {
    await store.set('card:' + token, card);   // let her press again
    await sendReply(envFn, fetchImpl, payload, note(`Not saved: ${result.error || result.status}. Press a button to try again.`));
  }
  return { status: result.status };
}
