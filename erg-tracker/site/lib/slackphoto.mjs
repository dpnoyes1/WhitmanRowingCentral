// Erg-screen photos in Slack (David, 2026-10-28). A coach or an athlete sends a
// photo to the bot; the bot reads it (ergscreen.mjs), runs the checks
// (ergchecks.mjs), asks a coach which athlete (an athlete is found by the Slack
// member ID on her Roster row and can log only herself), and shows a card whose Save button saves it
// through the Sheet (no RPE question since 2026-11-07) (apps-script/SlackPhoto.gs). Pending photos and cards are kept
// in a small Netlify Blobs store; tests pass a fake `deps.store`.
import { callSheet, dmBlocks, sendReply } from './slack.mjs';
import { readErgScreen, MODELS, MAX_IMAGE_BYTES, MAX_DOWNLOAD_BYTES } from './ergscreen.mjs';
import { runChecks, parseScreenDate, parseTitle, formatClock } from './ergchecks.mjs';
import { todayEastern, NOT_ON_ROSTER, fyiText } from './slacklog.mjs';
import { makeKeepCopy, shrinkForReading } from './photocopy.mjs';
import { getFeed } from './feed.mjs';
import { randomBytes } from 'node:crypto';

const MAX_PIECES = 10;
export const READING = ':eyes: Got your photo, reading it now. This takes a few seconds.';
export const SAVING = ':hourglass_flowing_sand: Saving, this can take several seconds. Please wait...';
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

/**
 * A single RowErg piece of exactly 2000 m or exactly 20:00 might be a benchmark
 * test (David, 2026-11-03). Returns '2000m', '20min' or '' (BikeErg never counts).
 */
export function benchmarkShape(machine, pieces) {
  if (machine !== 'RowErg' || !pieces || pieces.length !== 1) return '';
  const p = pieces[0];
  if (Number(p.meters) === 2000) return '2000m';
  if (Number(p.timeS) === 1200) return '20min';
  return '';
}
const TEST_NAME = { '2000m': '2k', '20min': "20'" };

/** The question card: is this one a test? */
export function askBlocks(text, token) {
  const btn = (id, label, style) => ({ type: 'button', action_id: id, value: token, text: { type: 'plain_text', text: label }, ...(style ? { style } : {}) });
  return [
    { type: 'section', text: { type: 'mrkdwn', text } },
    { type: 'actions', elements: [btn('photo_test_yes', 'Yes, it was a test', 'primary'), btn('photo_test_no', 'No, a normal workout'), btn('photo_cancel', 'Cancel')] }
  ];
}

export function cardBlocks(text, token) {
  const btn = (id, label, style) => ({ type: 'button', action_id: id, value: token, text: { type: 'plain_text', text: label }, ...(style ? { style } : {}) });
  return [
    { type: 'section', text: { type: 'mrkdwn', text } },
    { type: 'actions', elements: [btn('photo_save', 'Save', 'primary'), btn('photo_cancel', 'Cancel')] }
  ];
}

// ---- Names a coach types (David, 2026-11-07): a first name alone is enough, a
// near miss gets a "Did you mean ...?" button, a shared first name asks which.
const norm = (n) => String(n || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

/**
 * Matches a typed name against the active athletes' full names.
 * { kind: 'exact' | 'choose' | 'suggest' | 'none', names }
 */
export function resolveName(typed, names) {
  const t = norm(typed);
  if (!t) return { kind: 'none', names: [] };
  const full = names.map((n) => ({ n, k: norm(n) }));
  const exact = full.filter((x) => x.k === t || x.k.replace(/ /g, '') === t.replace(/ /g, ''));
  if (exact.length === 1) return { kind: 'exact', names: [exact[0].n] };
  if (exact.length > 1) return { kind: 'choose', names: exact.map((x) => x.n) };
  if (!t.includes(' ')) {   // first name alone
    const first = full.filter((x) => x.k.split(' ')[0] === t);
    if (first.length === 1) return { kind: 'exact', names: [first[0].n] };
    if (first.length > 1) return { kind: 'choose', names: first.map((x) => x.n) };
  }
  const limit = (len) => (len <= 4 ? 1 : 2);
  const scored = full.map((x) => {
    const dFull = editDistance(t, x.k);
    const dFirst = t.includes(' ') ? Infinity : editDistance(t, x.k.split(' ')[0]);
    return { n: x.n, d: Math.min(dFull, dFirst), max: limit(t.length) };
  }).filter((x) => x.d <= x.max).sort((a, b) => a.d - b.d);
  if (scored.length) return { kind: 'suggest', names: scored.slice(0, 3).map((x) => x.n) };
  return { kind: 'none', names: [] };
}

async function activeNames(envFn, fetchImpl, deps) {
  if (deps.athleteNames) return deps.athleteNames();
  try {
    const { data } = await getFeed(envFn, { fetchImpl });
    return data.athletes.filter((a) => a.active && a.role === 'Rower' && !/^alum$/i.test(a.squad || '')).map((a) => a.name);
  } catch { return null; }   // the Sheet's own exact check still works without the list
}

function pickBlocks(text, token, names, suggest) {
  const btn = (id, label, style) => ({ type: 'button', action_id: id, value: token, text: { type: 'plain_text', text: label }, ...(style ? { style } : {}) });
  const els = names.map((n, i) => btn(`photo_pick_${i}`, suggest && names.length === 1 ? `Yes, ${n}` : n, suggest && names.length === 1 ? 'primary' : undefined));
  els.push(btn('photo_pickno', suggest && names.length === 1 ? 'No' : 'None of these'));
  return [{ type: 'section', text: { type: 'mrkdwn', text } }, { type: 'actions', elements: els }];
}

const isImage = (f) => f && /^image\/(jpeg|png)$/.test(f.mimetype || '');

async function download(envFn, fetchImpl, file) {
  const res = await fetchImpl(file.url_private_download || file.url_private, { headers: { authorization: `Bearer ${envFn('SLACK_BOT_TOKEN')}` } });
  if (!res.ok) throw new Error('Slack file download ' + res.status);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error('Photo is over 25 MB');
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
    if (who.status === 'not_allowed') { await say(NOT_ON_ROSTER); return { status: 'not_allowed' }; }
    if (who.status !== 'ok') { await say(':warning: I could not check the roster just now. Please send the photo again in a minute.'); return { status: 'error' }; }
    const key = envFn('ANTHROPIC_API_KEY');
    if (!key) { await say(':warning: Photo reading is not set up yet (no API key). Use /log for now.'); return { status: 'no_key' }; }
    await say(READING);   // she sees at once that the photo arrived
    console.log('slack: photo step download', image.size || '', image.mimetype || '');
    let bytes;
    try { bytes = await download(envFn, fetchImpl, image); } catch (err) { await say(`:warning: I couldn't get that photo (${err.message}). Please send it again.`); return { status: 'download_failed' }; }
    console.log('slack: photo step downloaded', bytes.length);
    if (bytes.length > MAX_IMAGE_BYTES * 0.8) {   // too big for the reader: shrink it, she does nothing
      try { bytes = await (deps.shrink || shrinkForReading)(bytes); } catch (err) { await say(`:warning: I couldn't shrink that photo (${err.message}). Please send it again, or use /log.`); return { status: 'shrink_failed' }; }
    }
    console.log('slack: photo step reading', bytes.length);
    const out = await readAndCheck({ client: anthropicClient(key, fetchImpl), bytes, today });
    if (out.fail) { await say(`:warning: I couldn't read that photo (${out.fail.message}). Please send a clearer one, or use /log.`); return { status: out.fail.reason }; }
    const { read, issues, status } = out.checked;
    if (status !== 'clean') { await say(`:warning: I can't save this one yet.\n${problemText(issues)}`); return { status }; }
    // Split rows that don't add up (a scrolled list, say): the total row is what counts, so save that and tell the coach.
    const unsure = issues.some((i) => i.code === 'splits_sum' || i.code === 'meters_sum');
    const pieces = unsure ? [{ timeS: read.totalTimeS, meters: read.totalMeters, rate: read.avgRate, restS: 0 }] : entryPieces(read);
    if (pieces.length > MAX_PIECES) { await say(`:warning: That screen has more than ${MAX_PIECES} pieces. Please use /log.`); return { status: 'too_many' }; }
    const shown = parseScreenDate(read.date, today);
    const useShown = shown && Math.abs(Math.round((Date.parse(today) - Date.parse(shown)) / 86400000)) <= 3;   // a clock-reset date is flagged, not used
    const notes = [`Logged from an erg photo${who.role === 'athlete' ? '' : ' by a coach'}.`, ...issues.filter((i) => i.coach).map((i) => i.coach), ...read.flags];
    if (pieces.length === 1 && read.pieces.length > 1 && !unsure) notes.push('Splits: ' + read.pieces.map((p) => (p.splitS != null ? formatClock(p.splitS) : '?')).join(', '));
    // The small copy kept in Drive (step 6). A failure here never blocks logging the workout.
    let copy = '';
    try { copy = (await (deps.makeCopy || makeKeepCopy)(bytes)).bytes.toString('base64'); } catch (err) { notes.push('No photo copy kept (' + err.message + ').'); }
    await store.set('pending:' + user, { at: Date.now(), image: copy, summary: summaryLine(read, pieces), machine: read.machine, title: read.title, date: useShown ? shown : today, pieces, check: unsure, note: notes.join(' | ').slice(0, 400) });
    if (who.role === 'athlete') return nameStep(who.athlete, user, event, envFn, fetchImpl, store, say, deps, true);   // only ever herself
    const caption = String(event.text || '').trim();
    if (!caption) { await say(`:eyes: Read: ${summaryLine(read, pieces)}.\nWhich athlete is this for? Reply with her name (first name is enough).`); return { status: 'asked' }; }
    return nameStep(caption, user, event, envFn, fetchImpl, store, say, deps);
  }

  const name = String(event.text || '').trim();
  if (!name) return { ignored: 'empty' };
  const pending = await store.get('pending:' + user);
  if (!pending || Date.now() - pending.at > TOO_OLD_MS) return { ignored: 'nothing pending' };
  return nameStep(name, user, event, envFn, fetchImpl, store, say, deps);
}

async function nameStep(name, user, event, envFn, fetchImpl, store, say, deps = {}, resolved = false) {
  const pending = await store.get('pending:' + user);
  if (!pending) return { ignored: 'nothing pending' };
  if (!resolved) {   // a coach typed this: first name, near miss or full name
    const names = await activeNames(envFn, fetchImpl, deps);
    if (names) {
      const r = resolveName(name, names);
      if (r.kind === 'choose' || r.kind === 'suggest') {
        const token = randomBytes(9).toString('hex');
        await store.set('choice:' + token, { user, names: r.names });
        const text = r.kind === 'choose' ? `More than one athlete is called "${name}". Which one is it?`
          : r.names.length === 1 ? `I can't find "${name}". Did you mean *${r.names[0]}*?` : `I can't find "${name}". Did you mean one of these?`;
        await say(text, pickBlocks(text, token, r.names, r.kind === 'suggest'));
        return { status: r.kind === 'choose' ? 'choose' : 'suggest', names: r.names };
      }
      if (r.kind === 'exact') name = r.names[0];
    }
  }
  const who = await callSheet(envFn, fetchImpl, { action: 'slack-access', slackUserId: user, athleteName: name }).catch((e) => ({ status: 'error', error: e.message }));
  if (who.status === 'not_allowed') { await say(NOT_ON_ROSTER); return { status: 'not_allowed' }; }
  if (who.status === 'not_yourself') { await say(':lock: You can only log your own sessions. Send the photo again without a name.'); return { status: 'not_yourself' }; }
  if (who.status === 'unknown_name') { await say(`I can't find "${name}" as an active athlete on the roster. Reply with her name as it is on the roster.`); return { status: 'unknown_name' }; }
  if (who.status !== 'ok') { await say(':warning: I could not check the roster just now. Please send the name again in a minute.'); return { status: 'error' }; }
  const token = randomBytes(9).toString('hex');
  const shape = benchmarkShape(pending.machine, pending.pieces);
  await store.set('card:' + token, { user, athlete: who.athlete, ...pending, ask: shape });   // keeps the photo copy until she saves
  await store.delete('pending:' + user);
  if (shape) {
    const text = `*For ${who.athlete}:* ${pending.summary}.\nThis is exactly ${shape === '2000m' ? '2000 m' : '20:00'}. Was it a ${TEST_NAME[shape]} test? A test counts toward the best ${TEST_NAME[shape]}, stars and the boards. Tapping Yes or No saves it.`;
    await say(text, askBlocks(text, token));
    return { status: 'card', athlete: who.athlete, asked: shape };
  }
  const text = `*For ${who.athlete}:* ${pending.summary}.\nTap Save to log it.`;
  await say(text, cardBlocks(text, token));
  return { status: 'card', athlete: who.athlete };
}

/** A press on a card: Save (or a test Yes/No) saves, Cancel drops it, a name button picks the athlete. */
export async function handlePhotoButton(payload, envFn, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const store = deps.store || await defaultStore();
  const action = payload.actions[0];
  const id = action.action_id;
  const token = action.value;
  const text = (payload.message && payload.message.text) || 'Erg photo';
  const replace = (line, blocks) => ({ replace_original: true, text: `${text}\n${line}`, blocks: blocks || [
    { type: 'section', text: { type: 'mrkdwn', text } }, { type: 'context', elements: [{ type: 'mrkdwn', text: line }] }] });
  const note = (line) => ({ response_type: 'ephemeral', replace_original: false, text: line });

  if (/^photo_pick/.test(id)) {   // "Did you mean" and "which one" buttons
    const choice = await store.get('choice:' + token);
    if (!choice) { await sendReply(envFn, fetchImpl, payload, note('That question was already answered. Send the name again.')); return { status: 'gone' }; }
    if (choice.user !== payload.user.id) { await sendReply(envFn, fetchImpl, payload, note('Only the person who sent the photo can answer.')); return { status: 'not_owner' }; }
    await store.delete('choice:' + token);
    if (id === 'photo_pickno') {
      await sendReply(envFn, fetchImpl, payload, replace(':x: OK. Reply with the athlete\'s name as it is on the roster.'));
      return { status: 'pick_no' };
    }
    const picked = choice.names[Number(id.replace('photo_pick_', ''))];
    if (!picked) return { ignored: 'unknown button' };
    await sendReply(envFn, fetchImpl, payload, replace(`:white_check_mark: ${picked}`));
    const say = (t, b) => dmBlocks(envFn, fetchImpl, payload.user.id, t, b);
    const out = await nameStep(picked, payload.user.id, null, envFn, fetchImpl, store, say, deps, true);
    return { ...out, picked };
  }

  const card = await store.get('card:' + token);
  if (!card) { await sendReply(envFn, fetchImpl, payload, note('That card was already used or has expired. Send the photo again.')); return { status: 'gone' }; }
  if (card.user !== payload.user.id) { await sendReply(envFn, fetchImpl, payload, note('Only the person who sent the photo can save it.')); return { status: 'not_owner' }; }
  if (id === 'photo_cancel') {
    await store.delete('card:' + token);
    await sendReply(envFn, fetchImpl, payload, replace(':x: Cancelled, nothing was saved.'));
    return { status: 'cancelled' };
  }
  let benchmark = card.benchmark || '';
  let yesNo = null;
  if (id === 'photo_test_yes' || id === 'photo_test_no') {
    if (!card.ask) return { ignored: 'not asking' };
    yesNo = id === 'photo_test_yes';
    benchmark = yesNo ? card.ask : '';
  } else {
    // photo_save; the old RPE buttons on cards sent before 2026-11-07 save too (RPE is no longer asked)
    if (id !== 'photo_save' && id !== 'photo_norpe' && !/^photo_rpe_\d+$/.test(id)) return { ignored: 'unknown button' };
    if (card.ask) { await sendReply(envFn, fetchImpl, payload, note('First tell me whether this was a test.')); return { status: 'asking' }; }
  }
  await store.delete('card:' + token);   // first press wins
  const base = text.replace(/\nThis is exactly[\s\S]*$/, '').replace(/\nTap Save to log it\.$/, '');
  // Show at once that it is working: the Sheet can take several seconds.
  await sendReply(envFn, fetchImpl, payload, { replace_original: true, text: `${base}\n${SAVING}`,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: base } }, { type: 'context', elements: [{ type: 'mrkdwn', text: SAVING }] }] });
  const name = payload.user.name || payload.user.username || payload.user.id;
  let result;
  try {
    result = await callSheet(envFn, fetchImpl, { action: 'slack-photo', slackUserId: payload.user.id, slackName: name, token, athlete: card.athlete,
      photo: { benchmark, date: card.date, machine: card.machine, title: card.title, pieces: card.pieces, rpe: '', note: card.note, image: card.image || '' } });
  } catch (err) {
    result = { status: 'error', error: err.message };
  }
  const done = (line) => sendReply(envFn, fetchImpl, payload, { replace_original: true, text: `${base}\n${line}`,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: base } }, { type: 'context', elements: [{ type: 'mrkdwn', text: line }] }] });
  if (result.status === 'ok') {
    const fyi = fyiText(result);
    if (fyi) await dmBlocks(envFn, fetchImpl, result.notifySlackId, fyi);
    await done(`:white_check_mark: Saved for ${result.athlete}.` + (result.benchmark ? ` It is on the ${TEST_NAME[benchmark] || ''} board as a test.` : '') + (result.flagged ? ' It doesn\'t match the plan, so a plan check was posted.' : '') +
      (card.check ? ' The split rows on the photo didn\'t add up to the total, so a coach will check it.' : '') +
      (result.photo === 'failed' ? ' The workout is saved, but the photo copy could not be kept.' : ''));
  } else if (result.status === 'merged') {
    await done(':white_check_mark: Concept2 Logbook already has this workout for ' + result.athlete + ', so its entry stands' +
      (result.photo === 'added' ? ' and your photo is kept with it.' : result.photo === 'failed' ? ' (the photo copy could not be kept).' : '.') +
      (benchmark ? ' To count it as a test, mark it on the Logbook card.' : ''));
  } else if (result.status === 'duplicate') {
    await done(':information_source: Already saved. Nothing changed.');
  } else {
    await store.set('card:' + token, card);   // let her press again
    const line = `:warning: Not saved: ${result.error || result.status}. Press a button to try again.`;
    await sendReply(envFn, fetchImpl, payload, { replace_original: true, text: `${base}\n${line}`, blocks: (card.ask ? askBlocks : cardBlocks)(`${base}\n${line}`, token) });
  }
  return { status: result.status, ...(yesNo === null ? {} : { test: yesNo }) };
}
