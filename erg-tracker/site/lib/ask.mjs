// ErgBot questions (David, 2026-11-07; plan: project files plans/ergbot-coach-questions-plan.md).
// Someone asks ErgBot a question in plain English, by DM or with @ErgBot in the
// coaches' channel. A small Claude model only picks one of the fixed lookups in
// asklookups.mjs and its settings; the lookup's own code writes the reply, so a
// number in a reply always matches the team site.
//
// Guards, all in code (never left to the model):
// - Who: the Slack ID decides coach or athlete (Sheet action slack-access). An
//   athlete's lookups only reach her own numbers, the boards she already sees on
//   the site, and team totals of 4 or more rowers. Athletes are off until
//   ERGBOT_ATHLETE_QUESTIONS = on (coaches first, David 2026-11-07).
// - Where: a DM, or @ErgBot in SLACK_COACH_CHANNEL (answered as a normal message there).
//   Anywhere else the bot says "Ask me in a DM", because athletes are in those channels.
// - Cost: at most ERGBOT_MONTHLY_CAP_USD (default $10) a month and 20 questions
//   a person a day. At 80% of the cap one note goes to the coaches' channel.
// - Log: every question is kept for the month; coaches can ask for it, and an
//   athlete is told so the first time she asks.
import { callSheet, dmUser } from './slack.mjs';
import { getFeed } from './feed.mjs';
import { todayIn, schoolYearStart, schoolYearLabel } from './stats.mjs';
import { TOOLS, TOOL_NAMES, runLookup, shortDate } from './asklookups.mjs';
import { anthropicClient } from './slackphoto.mjs';
import { NOT_ON_ROSTER } from './slacklog.mjs';

export const ASK_MODEL = 'claude-haiku-5-5';
export const DAILY_LIMIT = 20;
export const DEFAULT_CAP_USD = 10;
export const WARN_AT = 0.8;
const WHO_TTL_MS = 60 * 60 * 1000;        // the coach list is checked again after an hour
const FOLLOW_UP_MS = 30 * 60 * 1000;      // a follow-up can lean on the last question for 30 minutes
const LOG_KEEP = 500;

/** Dollars per million tokens (Anthropic price list, checked 2026-11-07). Input, output. */
export const PRICES = {
  'claude-haiku-5-5': [0.10, 0.50],
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20]
};

/** What one model call cost, from the usage Anthropic returns. Cache writes count 1.25x, reads 0.1x. */
export function costUsd(model, usage = {}) {
  const [pin, pout] = PRICES[model] || PRICES['claude-sonnet-5-5'];   // an unknown model is charged at the higher Sonnet price
  const input = (usage.input_tokens || 0) + 1.25 * (usage.cache_creation_input_tokens || 0) + 0.1 * (usage.cache_read_input_tokens || 0);
  return (input * pin + (usage.output_tokens || 0) * pout) / 1e6;
}

async function defaultStore() {
  const { getStore } = await import('@netlify/blobs');
  const store = getStore('ergbot-ask');
  return { get: (k) => store.get(k, { type: 'json' }), set: (k, v) => store.setJSON(k, v), delete: (k) => store.delete(k) };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The model's instructions. Plain rules for the team's own words; it picks a lookup and never answers itself. */
export function systemPrompt(feed, asker, today) {
  const st = feed.settings.schoolYearStart || '07-01';
  const y = Number(schoolYearStart(today, st).slice(0, 4));
  const who = asker.role === 'coach' ? 'a coach' : `an athlete, ${asker.name}`;
  return [
    'You route questions from the Whitman girls rowing team to one lookup in the team\'s erg tracker. Always call exactly one tool, and never answer in text: the tool writes the reply.',
    `Today is ${WEEKDAYS[new Date(today + 'T12:00:00Z').getUTCDay()]} ${today}. This school year is ${schoolYearLabel(today, st)} (school_year ${y}); last year was ${y - 1}-${String(y).slice(2)} (school_year ${y - 1}). School years start on ${st.replace('-', '/')}.`,
    `The person asking is ${who}.`,
    'The team\'s words:',
    '- Tests: 2k = 2000m. 20\', 20 min, 20 minute = 20min. 500 = 500m. 100 = 100m. 30r20 = 30r20.',
    '- "latest" or "most recent" test = latest_test (the team\'s most recent test day). "my latest 2k" = athlete with name null.',
    '- "season PR", "year PR", "this season", "this year" = period season. "career PR", "all-time", "ever" = all_time. "last year" = school_year with last year\'s number.',
    '- Varsity = group varsity. Freshman, Fr/Nov, novice = group freshman. Otherwise group all.',
    '- "top 8", "first 8", "best 8" on a board = limit 8. Comparing years or the best N without names = top_average. Second 8, top 16 or group averages = group_averages.',
    '- Pacing, targets, "what split should I hold today", "what should I pull" = todays_plan. How a test was paced, splits from a test = test_pacing.',
    '- Whether there is practice, practice times, places, the calendar = schedule_link.',
    asker.role === 'coach'
      ? '- A coach may ask about any athlete by name.'
      : '- This athlete may ask about her own numbers (name null), the leaderboards and team averages. A question about a named teammate\'s results, plan or pacing = cannot_answer with other_athlete.',
    '- Anything that is not about the tracker\'s data (results, boards, stars, GMS, targets, logging) = cannot_answer with not_in_data. Training, health or injury advice = cannot_answer with advice.',
    '- If an earlier question is shown, use it to fill in what a short follow-up leaves out ("and last year?").'
  ].join('\n');
}

/** One model call: the question in, { tool, input, usd } out (tool null when the model picked nothing). */
export async function routeQuestion({ client, model, feed, asker, today, question, previous }) {
  const text = previous
    ? `Earlier question (${Math.max(1, Math.round((Date.now() - previous.at) / 60000))} min ago): "${previous.question}" - answered with ${previous.tool} ${JSON.stringify(previous.input)}.\n\nNew question: ${question}`
    : question;
  const res = await client.messages.create({
    model, max_tokens: 1024,
    system: systemPrompt(feed, asker, today),
    tools: TOOLS,
    tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: text }]
  });
  const usd = costUsd(model, res.usage);
  if (res.stop_reason === 'refusal') return { tool: null, input: null, usd };
  const use = (res.content || []).find((b) => b.type === 'tool_use' && TOOL_NAMES.includes(b.name));
  return { tool: use ? use.name : null, input: use ? use.input || {} : null, usd };
}

/** "Data as of 10:05 Nov 7", in the team's time zone. */
export function asOfText(feed, stale) {
  const at = new Date(feed.generatedAt);
  if (isNaN(at)) return '';
  const tz = feed.settings.timezone || 'America/New_York';
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(at);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(at);
  return `_Data as of ${time} ${shortDate(day)}${stale ? ' (the Sheet is slow, so this may be out of date)' : ''}._`;
}

/** Slack's mention markup out of the text: "<@U123> rankings" -> "rankings". */
export const cleanText = (t) => String(t || '').replace(/<@[A-Z0-9]+(\|[^>]*)?>/g, ' ').replace(/\s+/g, ' ').trim();

const HELP = 'Ask me about the tracker\'s data in plain English, for example "rankings of the latest 20\' test", "how is Jane doing?", "who hasn\'t logged this week?" or "compare the best 8 20\' tests this year to last year".';

/**
 * A question for ErgBot. event: the Slack event (DM message or app_mention).
 * ctx.channel: the channel of an @mention (null for a DM). Returns a status for the log.
 */
export async function handleQuestion(event, envFn, deps = {}, ctx = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const store = deps.store || await defaultStore();
  const user = event.user;
  const channel = ctx.channel || null;
  // In the coaches' channel the answer is a normal message, like a DM (David, 2026-11-07); a question asked inside a thread is answered in that thread.
  const say = (text) => (channel
    ? postInThread(envFn, fetchImpl, channel, event.thread_ts || null, text)
    : dmUser(envFn, fetchImpl, user, text));
  if (!user || event.bot_id) return { ignored: 'not a person' };
  const coachChannel = envFn('SLACK_COACH_CHANNEL');
  // Other channels have athletes in them: a short pointer under the question, so the channel stays quiet.
  if (channel && channel !== coachChannel) { await postInThread(envFn, fetchImpl, channel, event.thread_ts || event.ts, 'Ask me in a DM.'); return { status: 'wrong_channel' }; }
  const question = cleanText(event.text);
  if (!question) { await say(HELP); return { status: 'help' }; }

  const who = await whoIs(envFn, fetchImpl, store, user);
  if (who.status === 'not_allowed') { await say(NOT_ON_ROSTER); return { status: 'not_allowed' }; }
  if (who.status !== 'ok') { await say(':warning: I could not check the roster just now. Please ask again in a minute.'); return { status: 'error' }; }
  if (who.role !== 'coach') {
    if (channel) { await say('Ask me in a DM.'); return { status: 'wrong_channel' }; }
    if (envFn('ERGBOT_ATHLETE_QUESTIONS') !== 'on') { await say('Questions are open to coaches for now. Your numbers are on the team site.'); return { status: 'athletes_off' }; }
  }

  let feed, stale;
  try { ({ data: feed, stale } = deps.feed ? { data: deps.feed, stale: false } : await getFeed(envFn, { fetchImpl })); } catch (err) {
    await say(':warning: The team data could not be loaded. Try again in a minute.');
    return { status: 'no_feed', error: err.message };
  }
  const today = deps.today || todayIn(feed.settings.timezone || 'America/New_York');
  const asker = { role: who.role === 'coach' ? 'coach' : 'athlete', name: who.athlete || '' };
  if (asker.role === 'athlete') {
    const me = feed.athletes.find((a) => a.name === who.athlete && a.active);
    if (!me) { await say(NOT_ON_ROSTER); return { status: 'not_allowed' }; }
    asker.athleteId = me.id;
  }

  // Limits: 20 a person a day, and the monthly cap.
  const month = today.slice(0, 7);
  const countKey = `count:${today}:${user}`;
  const count = (await store.get(countKey)) || { n: 0 };
  if (count.n >= DAILY_LIMIT) { await say(`You've asked ${DAILY_LIMIT} questions today, the daily limit. Ask again tomorrow, or look on the team site.`); return { status: 'daily_limit' }; }
  const cap = Number(envFn('ERGBOT_MONTHLY_CAP_USD')) > 0 ? Number(envFn('ERGBOT_MONTHLY_CAP_USD')) : DEFAULT_CAP_USD;
  const spendKey = `spend:${month}`;
  const spend = (await store.get(spendKey)) || { usd: 0, questions: 0, warned: false };
  if (spend.usd >= cap) { await say('ErgBot\'s questions are paused for this month (the monthly budget is used up). Your numbers are on the team site.'); return { status: 'capped' }; }

  const key = envFn('ERGBOT_ANTHROPIC_API_KEY') || envFn('ANTHROPIC_API_KEY');
  if (!key) { await say(':warning: Questions are not set up yet (no API key).'); return { status: 'no_key' }; }
  const model = envFn('ERGBOT_ASK_MODEL') || ASK_MODEL;
  const lastKey = `last:${user}`;
  const last = await store.get(lastKey);
  const previous = last && Date.now() - last.at <= FOLLOW_UP_MS ? last : null;

  let routed;
  try {
    routed = await routeQuestion({ client: deps.client || anthropicClient(key, fetchImpl), model, feed, asker, today, question, previous });
  } catch (err) {
    console.log('ask: model call failed', err.message);
    await say(':warning: Something went wrong with that question. Please ask again in a minute.');
    return { status: 'model_error', error: err.message };
  }

  // Count the cost before anything else can fail.
  await store.set(countKey, { n: count.n + 1 });
  const nextSpend = { ...spend, usd: spend.usd + routed.usd, questions: spend.questions + 1 };
  if (!spend.warned && nextSpend.usd >= WARN_AT * cap) {
    nextSpend.warned = true;
    if (coachChannel) await postInThread(envFn, fetchImpl, coachChannel, null, `:money_with_wings: ErgBot questions have used $${nextSpend.usd.toFixed(2)} of the $${cap} budget for ${month}. At $${cap} they pause until the 1st.`).catch(() => false);
  }
  await store.set(spendKey, nextSpend);

  let reply;
  const tool = routed.tool || 'cannot_answer';
  const input = routed.tool ? routed.input : { reason: 'unclear' };
  if (tool === 'question_log' && asker.role === 'coach') reply = await logText(store, month);
  else reply = runLookup(feed, asker, tool, input, today).text;

  const dataTools = !['cannot_answer', 'schedule_link', 'question_log'].includes(tool);
  let text = dataTools ? `${reply}\n${asOfText(feed, stale)}` : reply;
  if (asker.role === 'athlete' && !(await store.get(`seen:${user}`))) {
    text = `${text}\n_Coaches can read the questions asked here._`;
    await store.set(`seen:${user}`, { at: Date.now() });
  }
  const sent = await say(text);
  await store.set(lastKey, { at: Date.now(), question, tool, input });
  await addToLog(store, month, { at: new Date().toISOString(), user, role: asker.role, name: asker.name, where: channel ? 'channel' : 'dm', question, tool, input, usd: Math.round(routed.usd * 1e6) / 1e6 });
  console.log('ask:', asker.role, tool, JSON.stringify(input), '$' + routed.usd.toFixed(5), sent ? 'sent' : 'send failed');
  return { status: 'answered', tool, input, usd: routed.usd };
}

/** Coach or athlete for a Slack ID, kept for an hour so a question doesn't wait on the Sheet every time. */
async function whoIs(envFn, fetchImpl, store, user) {
  const hit = await store.get(`who:${user}`);
  if (hit && Date.now() - hit.at < WHO_TTL_MS) return hit.who;
  const who = await callSheet(envFn, fetchImpl, { action: 'slack-access', slackUserId: user }).catch((e) => ({ status: 'error', error: e.message }));
  if (who.status === 'ok') await store.set(`who:${user}`, { at: Date.now(), who });
  return who;
}

async function addToLog(store, month, row) {
  const key = `log:${month}`;
  const log = (await store.get(key)) || [];
  log.push(row);
  await store.set(key, log.slice(-LOG_KEEP));
}

async function logText(store, month) {
  const log = ((await store.get(`log:${month}`)) || []).slice(-20).reverse();
  if (!log.length) return 'No questions yet this month.';
  return `*Latest questions* (${month})\n` + log.map((r) => `${r.at.slice(5, 16).replace('T', ' ')} ${r.role === 'coach' ? 'coach' : r.name}: "${r.question}" (${r.tool})`).join('\n');
}

/** A message in a channel, in the thread under the question when thread is given. True when Slack said ok. */
export async function postInThread(envFn, fetchImpl, channel, thread, text) {
  const token = envFn('SLACK_BOT_TOKEN');
  if (!token) return false;
  const res = await fetchImpl('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel, text, ...(thread ? { thread_ts: thread } : {}) })
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) console.log('ask: chat.postMessage failed', data.error || res.status);
  return !!data.ok;
}

