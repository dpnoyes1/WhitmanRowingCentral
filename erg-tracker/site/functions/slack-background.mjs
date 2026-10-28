// Slack's Interactivity Request URL: POST /.netlify/functions/slack-background.
// A "-background" function answers 202 at once and keeps running (Slack accepts
// that for button presses, tested 2026-10-28), so the Sheet's few seconds don't
// hit Slack's 3-second limit. Handles the coach buttons on plan-flag messages
// (apps-script/PlanFlags.gs). Needs SLACK_SIGNING_SECRET, FEED_URL and FEED_KEY.
import { signatureValid, callSheet, planOp, planFlagReply, sendReply } from '../lib/slack.mjs';

const env = (k) => Netlify.env.get(k);

export async function handleSlackAction(req, envFn, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const raw = await req.text();
  if (!signatureValid(envFn('SLACK_SIGNING_SECRET'), req.headers, raw, deps.nowS)) {
    console.log('slack: bad signature, ignored');
    return { ignored: 'signature' };
  }
  let payload;
  try { payload = JSON.parse(new URLSearchParams(raw).get('payload')); } catch { return { ignored: 'payload' }; }
  const action = payload && payload.type === 'block_actions' && payload.actions && payload.actions[0];
  const op = action && planOp(action.action_id);
  if (!op) return { ignored: 'not a plan button' };   // e.g. the Open in Sheet link
  const name = payload.user.name || payload.user.username || payload.user.id;
  const text = (payload.message && payload.message.text) || 'Plan check';
  let result;
  try {
    result = await callSheet(envFn, fetchImpl, {
      action: 'plan-flag-action', entryId: action.value, op, slackUserId: payload.user.id, slackName: name
    });
  } catch (err) {
    result = { status: 'error', error: err.message };
  }
  const via = await sendReply(envFn, fetchImpl, payload, planFlagReply(result, op, name, text));
  console.log('slack: plan button', op, result.status, via);
  return { status: result.status, via };
}

export default async (req) => {
  await handleSlackAction(req, env);
};
