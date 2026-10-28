// The slow half of Slack. slack.mjs (POST /api/slack) checks and answers Slack,
// then forwards the signed request here. A "-background" function answers 202 at
// once and keeps running, so the Sheet's few seconds don't hit Slack's 3-second
// limit. Handles the coach buttons on plan-flag messages (apps-script/PlanFlags.gs)
// the saved /log modal (apps-script/SlackLog.gs) and erg-screen photos sent to the
// bot (lib/slackphoto.mjs). Needs SLACK_SIGNING_SECRET, SLACK_BOT_TOKEN, FEED_URL,
// FEED_KEY and, for photos, ANTHROPIC_API_KEY.
import { signatureValid, callSheet, planOp, planFlagReply, sendReply, dmUser } from '../lib/slack.mjs';
import { readLogForm, logReply } from '../lib/slacklog.mjs';
import { handlePhotoEvent, handlePhotoButton } from '../lib/slackphoto.mjs';

async function handleLogSubmission(payload, envFn, fetchImpl) {
  let result;
  try {
    result = await callSheet(envFn, fetchImpl, {
      action: 'slack-log', slackUserId: payload.user.id, slackName: payload.user.name || payload.user.username || payload.user.id, viewId: payload.view.id, form: readLogForm(payload.view)
    });
  } catch (err) {
    result = { status: 'error', error: err.message };
  }
  const sent = await dmUser(envFn, fetchImpl, payload.user.id, logReply(result));
  console.log('slack: /log', result.status, sent ? 'dm sent' : 'dm failed');
  return { status: result.status, dm: sent };
}

const env = (k) => Netlify.env.get(k);

export async function handleSlackAction(req, envFn, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const raw = await req.text();
  if (!signatureValid(envFn('SLACK_SIGNING_SECRET'), req.headers, raw, deps.nowS)) {
    console.log('slack: bad signature, ignored');
    return { ignored: 'signature' };
  }
  let payload;
  try { payload = raw.trimStart().startsWith('{') ? JSON.parse(raw) : JSON.parse(new URLSearchParams(raw).get('payload')); } catch { return { ignored: 'payload' }; }
  if (payload && payload.type === 'event_callback') {
    if (payload.event && payload.event.type === 'message' && payload.event.channel_type === 'im') {
      const out = await handlePhotoEvent(payload.event, envFn, deps);
      console.log('slack: message', JSON.stringify(out));
      return out;
    }
    return { ignored: 'event' };
  }
  if (payload && payload.type === 'block_actions' && payload.actions && payload.actions[0] && /^photo_/.test(payload.actions[0].action_id)) {
    const out = await handlePhotoButton(payload, envFn, deps);
    console.log('slack: photo button', out.status || JSON.stringify(out));
    return out;
  }
  if (payload && payload.type === 'view_submission' && payload.view && payload.view.callback_id === 'log_modal') {
    return handleLogSubmission(payload, envFn, fetchImpl);
  }
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
