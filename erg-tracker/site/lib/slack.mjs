// Slack side of the plan-flag buttons: signature check, the Sheet call, and the
// message updates. Pure and injectable so tests run with fake Slack and a fake Sheet.
import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCE_S = 300;

/** Slack's v0 signature: HMAC SHA-256 of "v0:<timestamp>:<raw body>", five-minute window. */
export function signatureValid(secret, headers, raw, nowS = Date.now() / 1000) {
  const ts = headers.get('x-slack-request-timestamp');
  const sig = headers.get('x-slack-signature');
  if (!secret || !ts || !sig || !(Math.abs(nowS - Number(ts)) <= TOLERANCE_S)) return false;
  const want = Buffer.from('v0=' + createHmac('sha256', secret).update(`v0:${ts}:${raw}`).digest('hex'));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The Sheet's feed endpoint (an Apps Script web app) with the feed key. Throws on any problem. */
export async function callSheet(env, fetchImpl, body) {
  const url = env('FEED_URL'), key = env('FEED_KEY');
  if (!url || !key) throw new Error('FEED_URL and FEED_KEY must be set in Netlify');
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, key }),
    redirect: 'follow'
  });
  if (!res.ok) throw new Error('sheet HTTP ' + res.status);
  const data = await res.json();
  if (data.error) throw new Error('sheet said: ' + data.error);
  return data;
}

const OPS = { plan_modified: 'modified', plan_reviewed: 'reviewed' };
export const planOp = (actionId) => OPS[actionId] || null;

/** What Slack shows after a press, from the Sheet's answer. `text` is the original message text. */
export function planFlagReply(result, op, name, text) {
  const done = (line) => ({ replace_original: true, text: `${text}\n${line}`, blocks: [
    { type: 'section', text: { type: 'mrkdwn', text } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: line }] }
  ] });
  const note = (line) => ({ response_type: 'ephemeral', replace_original: false, text: line });
  if (result.status === 'ok') {
    return done(op === 'modified' ? `:white_check_mark: Set to Modified by ${name}` : `:white_check_mark: Looks right, marked by ${name}`);
  }
  if (result.status === 'already') return done(`:information_source: Already decided (${result.reviewStatus}).`);
  if (result.status === 'forbidden') return note('Only the coaches listed in the Sheet can use these buttons.');
  if (result.status === 'missing') return note('That entry is no longer on the Entries tab.');
  return note('Could not save that: ' + (result.error || 'unknown problem') + '. Try again, or change it in the Sheet.');
}

/** Updates the message: the press's response_url first, chat.update when that has expired. */
export async function sendReply(env, fetchImpl, payload, reply) {
  const res = await fetchImpl(payload.response_url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(reply)
  });
  if (res.ok) return 'response_url';
  const token = env('SLACK_BOT_TOKEN');
  if (!token || !reply.replace_original || !payload.channel || !payload.message) return 'failed';
  const up = await fetchImpl('https://slack.com/api/chat.update', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel: payload.channel.id, ts: payload.message.ts, text: reply.text, blocks: reply.blocks })
  });
  const data = await up.json().catch(() => ({}));
  return data.ok ? 'chat.update' : 'failed';
}

/** A direct message from the bot (chat.postMessage to a user ID opens the DM). True when Slack said ok. */
export async function dmUser(env, fetchImpl, userId, text, blocks) {
  const token = env('SLACK_BOT_TOKEN');
  if (!token) return false;
  const res = await fetchImpl('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel: userId, text, ...(blocks ? { blocks } : {}) })
  });
  const data = await res.json().catch(() => ({}));
  return !!data.ok;
}
