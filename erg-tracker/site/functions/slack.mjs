// Slack's front door: POST /api/slack. Slash command URL and Interactivity URL.
// A normal (synchronous) function because Slack needs an answer in 3 seconds and
// view_submission errors have to come back in the response body. It checks the
// signature, answers Slack's Event Subscriptions handshake (url_verification),
// opens the /log modal, validates a submitted modal, and hands anything
// slow (Sheet writes, button presses) to slack-background with the original
// signed request. Needs SLACK_SIGNING_SECRET and SLACK_BOT_TOKEN.
import { signatureValid } from '../lib/slack.mjs';
import { logModal, readLogForm, validateLogForm } from '../lib/slacklog.mjs';

const env = (k) => Netlify.env.get(k);
const empty = () => new Response('', { status: 200 });
const json = (obj) => Response.json(obj);

async function openModal(envFn, fetchImpl, triggerId, today) {
  const res = await fetchImpl('https://slack.com/api/views.open', {
    method: 'POST',
    headers: { authorization: `Bearer ${envFn('SLACK_BOT_TOKEN')}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ trigger_id: triggerId, view: logModal(today) })
  });
  const data = await res.json().catch(() => ({}));
  return data.ok ? '' : (data.error || 'unknown');
}

/** Hand the signed request to the background function (it answers 202 at once). */
async function forward(req, raw, fetchImpl, contentType = 'application/x-www-form-urlencoded') {
  const url = new URL('/.netlify/functions/slack-background', req.url).toString();
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'x-slack-request-timestamp': req.headers.get('x-slack-request-timestamp'),
      'x-slack-signature': req.headers.get('x-slack-signature')
    },
    body: raw
  });
  return res.ok || res.status === 202;
}

export async function handleSlack(req, envFn, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const raw = await req.text();
  if (!signatureValid(envFn('SLACK_SIGNING_SECRET'), req.headers, raw, deps.nowS)) {
    return new Response('bad signature', { status: 401 });
  }
  if (raw.trimStart().startsWith('{')) {   // Events API: JSON, not a form
    let body;
    try { body = JSON.parse(raw); } catch { return new Response('bad payload', { status: 400 }); }
    if (body.type === 'url_verification') return new Response(String(body.challenge || ''), { headers: { 'content-type': 'text/plain' } });
    // A photo or a text in the bot's DM: hand on (not Slack's retries, which would repeat the work).
    const ev = body.event || {};
    const mine = body.type === 'event_callback' && ev.type === 'message' && ev.channel_type === 'im' && !ev.bot_id && (!ev.subtype || ev.subtype === 'file_share');
    if (mine && !req.headers.get('x-slack-retry-num')) await forward(req, raw, fetchImpl, 'application/json').catch(() => false);
    return empty();
  }
  const form = new URLSearchParams(raw);

  if (form.get('command')) {   // the /log slash command
    const err = await openModal(envFn, fetchImpl, form.get('trigger_id'), deps.today);
    if (err) {
      console.log('slack: views.open failed', err);
      return json({ response_type: 'ephemeral', text: 'Could not open the log form (' + err + '). Try /log again, or use the Form.' });
    }
    return empty();
  }

  let payload;
  try { payload = JSON.parse(form.get('payload')); } catch { return new Response('bad payload', { status: 400 }); }

  if (payload.type === 'view_submission' && payload.view && payload.view.callback_id === 'log_modal') {
    const errors = validateLogForm(readLogForm(payload.view), deps.today);
    if (Object.keys(errors).length) return json({ response_action: 'errors', errors });
    const sent = await forward(req, raw, fetchImpl).catch(() => false);
    if (!sent) return json({ response_action: 'errors', errors: { pieces: 'Could not save right now. Press Save again in a moment.' } });
    return json({ response_action: 'clear' });
  }

  if (payload.type === 'block_actions') {
    await forward(req, raw, fetchImpl).catch(() => false);
  }
  return empty();
}

export default async (req) => handleSlack(req, env);

export const config = { path: '/api/slack', method: 'POST' };
