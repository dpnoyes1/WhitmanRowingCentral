// "Found on Logbook" in Slack (David, 2026-10-28): when a Logbook session is
// written as pending, the athlete gets a DM from ErgBot with Confirm and Change
// buttons and an optional effort pick, so she needn't open the site. The site's
// card stays and does the same job; whichever comes first wins (the Sheet only
// confirms a session that is still pending). Pure builders here; the sending is
// in logbook-sync.mjs and the button handling in functions/slack*.mjs.
import { dmBlocks } from './slack.mjs';

export const TYPES = ['Practice', 'OYO', 'Make-up'];
const BENCH = { '2000m': '2k', '20min': "20'" };
const label = (text) => ({ type: 'plain_text', text });
const opt = (value, text) => ({ text: label(text), value });

const fmtTime = (s) => {
  const t = Math.round(Number(s) * 10) / 10;
  const m = Math.floor(t / 60);
  const sec = (t - m * 60).toFixed(1);
  return `${m}:${sec.padStart(4, '0')}`.replace(/\.0$/, '');
};
const fmtDay = (ymd) => new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(ymd + 'T00:00:00Z'));
const fmtNum = (n) => Number(n).toLocaleString('en-US');

/** The one-line summary that stays on the message after it is answered. */
export function summaryLine(card) {
  const bits = [fmtDay(card.date), card.activity, card.mainSet].filter(Boolean).join(' · ');
  const work = [`${fmtTime(card.workS)} work`, card.workM ? `${fmtNum(card.workM)} m` : '', card.dragFactor ? `drag ${card.dragFactor}` : ''].filter(Boolean).join(' · ');
  return `Found on Logbook: ${bits} (${work})`;
}

/** What the Change button carries (the modal opens from this alone): entry, date, how it counts now, summary. */
const changeValue = (card, text) => JSON.stringify({ e: card.id, d: card.date, s: card.sessionType, m: card.makeupFor || '', b: card.benchmark || '', x: text.slice(0, 400) });

/** Reads that value back; null when it isn't ours. */
export function readChangeValue(value) {
  try {
    const v = JSON.parse(value);
    return v && typeof v.e === 'string' && /^[A-Za-z0-9-]+$/.test(v.e) ? v : null;
  } catch { return null; }
}

/** The DM: summary, how it will count, then effort + buttons. `card` is the Sheet's pending card. */
export function logbookMessage(card) {
  const pieces = card.pieces && card.pieces.length > 1
    ? card.pieces.map((p) => `${p.n}. ${fmtTime(p.workS)}${p.workM ? ' · ' + fmtNum(p.workM) + ' m' : ''}${p.rate ? ' · ' + p.rate + ' spm' : ''}`).join('\n') : '';
  const counts = card.possibleMakeup
    ? `This looks like a make-up for *${card.makeupFor ? fmtDay(card.makeupFor) : 'a missed practice'}*. It won't count until you tap Confirm or Change.`
    : `It will count as *${card.sessionType}*. If you do nothing, it counts that way after about 20 hours.`;
  const text = summaryLine(card);
  const buttons = [
    { type: 'button', action_id: 'lb_confirm', style: 'primary', text: label(card.possibleMakeup ? 'Confirm make-up' : 'Confirm'), value: card.id },
    ...(card.benchmark ? [{ type: 'button', action_id: 'lb_confirm_test', text: label(`Confirm as ${BENCH[card.benchmark]} test`), value: card.id + '|' + card.benchmark }] : []),
    { type: 'button', action_id: 'lb_change', text: label('Change'), value: changeValue(card, text) }
  ];
  return {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: ':rowboat: ' + text.replace('Found on Logbook:', '*Found on Logbook:*') } },
      ...(pieces ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: pieces }] }] : []),
      { type: 'section', text: { type: 'mrkdwn', text: counts } },
      { type: 'actions', block_id: 'lb_actions', elements: [
        { type: 'static_select', action_id: 'lb_rpe', placeholder: label('Effort 1-10 (optional)'),
          options: Array.from({ length: 10 }, (_, i) => opt(String(i + 1), String(i + 1))) },
        ...buttons
      ] }
    ]
  };
}

/** The effort picked on the message (optional), found in a button press's state. */
export function rpeFromState(payload) {
  const values = (payload && payload.state && payload.state.values) || {};
  for (const block of Object.values(values)) {
    const pick = block && block.lb_rpe && block.lb_rpe.selected_option;
    if (pick) return Number(pick.value);
  }
  return null;
}

/** Sheet request for a button press. Value is "entryId" or "entryId|2000m". */
export function confirmRequest(payload, action) {
  const [entryId, benchmark] = String(action.value || '').split('|');
  const req = { action: 'slack-logbook-confirm', slackUserId: payload.user.id, entryId };
  const rpe = rpeFromState(payload);
  if (rpe) req.rpe = rpe;
  if (action.action_id === 'lb_confirm_test' && ['2000m', '20min'].includes(benchmark)) req.benchmark = benchmark;
  return req;
}

/** The "Change" modal, from the button's value. The entry, the message to update and the session date ride in private_metadata. */
export function changeModal(info, message) {
  const meta = { e: info.e, c: message.channel, t: message.ts, d: info.d, x: info.x, b: info.b };
  const input = (id, text, element, optional = true) => ({ type: 'input', block_id: id, optional, label: label(text), element: { action_id: 'v', ...element } });
  const rpe = Array.from({ length: 10 }, (_, i) => opt(String(i + 1), String(i + 1)));
  const now = TYPES.includes(info.s) ? info.s : 'OYO';
  return {
    type: 'modal', callback_id: 'lb_change_modal', private_metadata: JSON.stringify(meta),
    title: label('Change this session'), submit: label('Confirm'), close: label('Back'),
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: info.x } },
      input('type', 'Counts as', { type: 'static_select', options: TYPES.map((t) => opt(t, t)), initial_option: opt(now, now) }, false),
      input('makeup_for', 'Make-up only: date of the practice you missed', { type: 'datepicker', ...(info.m ? { initial_date: info.m } : {}) }),
      input('rpe', 'Effort (1 easy, 10 max)', { type: 'static_select', options: rpe }),
      ...(info.b && BENCH[info.b] ? [input('bench', 'Was this a test?', { type: 'checkboxes', options: [opt(info.b, `Yes, this was my ${BENCH[info.b]} test`)] })] : [])
    ]
  };
}

export function readChange(view) {
  let meta = {};
  try { meta = JSON.parse(view.private_metadata || '{}'); } catch { meta = {}; }
  const v = (id) => ((view.state && view.state.values && view.state.values[id]) || {}).v || {};
  return {
    meta,
    type: (v('type').selected_option || {}).value || '',
    makeupFor: v('makeup_for').selected_date || '',
    rpe: (v('rpe').selected_option || {}).value || '',
    benchmark: ((v('bench').selected_options || [])[0] || {}).value || ''
  };
}

/** { block_id: message } for the Change modal, or {}. */
export function validateChange(c) {
  const errors = {};
  if (c.type === 'Make-up') {
    if (!c.makeupFor) errors.makeup_for = 'Pick the date of the practice you missed';
    else if (c.meta.d && c.makeupFor >= c.meta.d) errors.makeup_for = 'The missed practice is before this session';
  }
  return errors;
}

export function changeRequest(userId, c) {
  const req = { action: 'slack-logbook-confirm', slackUserId: userId, entryId: c.meta.e, sessionType: c.type };
  if (c.type === 'Make-up') req.makeupFor = c.makeupFor;
  if (c.rpe) req.rpe = Number(c.rpe);
  if (c.benchmark) req.benchmark = c.benchmark;
  return req;
}

/** The message after the Sheet answers a press. `text` is the summary line. */
export function confirmReply(result, text, name) {
  const done = (line) => ({ replace_original: true, text: `${text}\n${line}`, blocks: [
    { type: 'section', text: { type: 'mrkdwn', text } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: line }] }
  ] });
  const note = (line) => ({ response_type: 'ephemeral', replace_original: false, text: line });
  if (result.status === 'confirmed') return done(result.benchmark ? ':white_check_mark: Counted, and saved as a test result.' : ':white_check_mark: Counted. Thanks!');
  const err = String(result.error || '');
  if (/not waiting/i.test(err)) return done(':information_source: Already counted. Nothing more to do.');
  if (/not found/i.test(err)) return done(':information_source: This session changed on Logbook. Open the team site to confirm the new one.');
  if (/make-up|missed practice/i.test(err)) return note('Pick which missed practice this makes up: press Change.');
  return note('Could not save that: ' + (err || 'unknown problem') + '. Try again, or confirm on the team site.');
}

/** DM a pending Logbook card. Never throws: the site card works either way. True when Slack said ok. */
export async function notifyLogbook(env, fetchImpl, slack) {
  try {
    const m = logbookMessage(slack.card);
    return await dmBlocks(env, fetchImpl, slack.slackUserId, m.text, m.blocks);
  } catch (err) {
    console.error('logbook slack dm failed:', err.message);
    return false;
  }
}
