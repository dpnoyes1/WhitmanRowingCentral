// THROWAWAY: POST /api/slack-test, the endpoint of the "Erg Tracker Test" Slack app. It answers the
// open facts in plans/slack-alerts-and-log-plan.md (does Slack accept 202, does /log work in a DM,
// can a bot download a photo sent in a DM, which headers Slack sends). It reads nothing from the
// Sheet or feed and stores nothing; every answer comes back as a Slack message. Remove after the test.
// Needs SLACK_TEST_SIGNING_SECRET (and SLACK_TEST_BOT_TOKEN for DMs and photo downloads).
import { createHmac, timingSafeEqual } from 'node:crypto';

const env = (k) => Netlify.env.get(k);
const TOLERANCE_S = 300;
const reply = (body, status = 200) => Response.json(body, { status });

/** Slack's v0 signature: HMAC SHA-256 of "v0:<timestamp>:<raw body>". */
export function signatureValid(secret, headers, raw, nowS = Date.now() / 1000) {
  const ts = headers.get('x-slack-request-timestamp');
  const sig = headers.get('x-slack-signature');
  if (!secret || !ts || !sig || !(Math.abs(nowS - Number(ts)) <= TOLERANCE_S)) return false;
  const want = Buffer.from('v0=' + createHmac('sha256', secret).update(`v0:${ts}:${raw}`).digest('hex'));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

const actions = (text) => ({
  response_type: 'ephemeral',
  text,
  blocks: [
    { type: 'section', text: { type: 'mrkdwn', text } },
    { type: 'actions', elements: [
      { type: 'button', action_id: 'ack_200', text: { type: 'plain_text', text: 'Reply 200' } },
      { type: 'button', action_id: 'ack_202', text: { type: 'plain_text', text: 'Reply 202' } },
    ] },
  ],
});

async function post(token, fetchImpl, channel, text) {
  const res = await fetchImpl('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel, text }),
  });
  return res.json();
}

async function fileReport(token, fetchImpl, f) {
  const res = await fetchImpl(f.url_private, { headers: { authorization: `Bearer ${token}` } });
  const bytes = (await res.arrayBuffer()).byteLength;
  return `file ${f.id}: ${f.mimetype}, Slack says ${f.size} bytes, download ${res.status} ${res.headers.get('content-type')}, got ${bytes} bytes`;
}

export async function handleSlackTest(req, envFn, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const secret = envFn('SLACK_TEST_SIGNING_SECRET');
  const token = envFn('SLACK_TEST_BOT_TOKEN');
  if (!secret || !token) return reply({ error: 'not configured' }, 503);
  const raw = await req.text();
  if (!signatureValid(secret, req.headers, raw, deps.nowS)) return reply({ error: 'unauthorized' }, 401);
  const retry = req.headers.get('x-slack-retry-num');
  const retryNote = retry ? ` (Slack retry ${retry}, reason ${req.headers.get('x-slack-retry-reason')})` : '';

  if ((req.headers.get('content-type') || '').includes('application/json')) {
    const body = JSON.parse(raw);
    if (body.type === 'url_verification') return reply({ challenge: body.challenge });
    const ev = body.event || {};
    if (body.type === 'event_callback' && ev.type === 'message' && ev.subtype === 'file_share' && !ev.bot_id) {
      const lines = [];
      for (const f of ev.files || []) lines.push(await fileReport(token, fetchImpl, f));
      await post(token, fetchImpl, ev.channel, `Photo test${retryNote}\n${lines.join('\n')}`);
    }
    return reply({ ok: true });
  }

  const form = new URLSearchParams(raw);
  if (form.get('command')) {
    // Where it ran: channel_name is "directmessage" in a DM; the id starts with D.
    const text = `/logtest worked${retryNote}. channel_name=${form.get('channel_name')}, channel_id=${form.get('channel_id')}, ` +
      `trigger_id ${form.get('trigger_id') ? 'present' : 'missing'}, response_url ${form.get('response_url') ? 'present' : 'missing'}. ` +
      'Press each button; Slack shows a warning on one if it rejects that reply.';
    return reply(actions(text));
  }
  if (form.get('payload')) {
    const p = JSON.parse(form.get('payload'));
    const id = p.actions && p.actions[0] && p.actions[0].action_id;
    await post(token, fetchImpl, p.user.id, `Slack sent the ${id} press; the endpoint answered ${id === 'ack_202' ? 202 : 200}${retryNote}.`);
    return id === 'ack_202' ? new Response(null, { status: 202 }) : new Response(null, { status: 200 });
  }
  return reply({ error: 'unknown request' }, 400);
}

export default (req) => handleSlackTest(req, env);

export const config = { path: '/api/slack-test', method: 'POST' };
