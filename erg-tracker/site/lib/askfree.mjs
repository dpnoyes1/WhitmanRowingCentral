// ErgBot questions, step 2 (David, 2026-11-07: "the bot should be able to look
// up any and all information in the sheet"). A coach's question that no fixed
// lookup in asklookups.mjs covers goes to a stronger model. It searches the
// tracker's tables with get_rows, works out sums and averages with calculate,
// and writes a short answer itself.
//
// Guards, all in code:
// - Coaches only. ask.mjs never sends an athlete's question here.
// - The feed the team site already reads, plus weights (David, 2026-11-07:
//   coaches can see weights). Weights are not in the feed: they come from the
//   Sheet action ergbot-weights, for this question only, and are never stored.
//   No birthdays or sign-in codes.
// - Number check: every time, split and meter count in the answer must appear
//   in the rows the model read or in a calculate result. Otherwise the reply
//   gets a "check this" note.
// - At most MAX_TURNS model calls and a cost ceiling per question.
import { TESTS, TEST_LABELS, resultValue, schoolYearLabel, schoolYearStart, gradeAt } from './stats.mjs';
import { costUsd } from './ask.mjs';

export const FREE_MODEL = 'claude-sonnet-5-5';
export const MAX_TURNS = 6;
export const MAX_ROWS = 300;
export const QUESTION_CEILING_USD = 0.5;   // one question stops looking things up past this

const TABLES = ['roster', 'tests', 'workouts', 'plans', 'practices', 'team_gms', 'weights'];
const nullable = (schema) => ({ ...schema, type: [schema.type, 'null'] });

export const FREE_TOOLS = [
  { name: 'get_rows', description: 'Rows from one table of the team\'s erg tracker. roster: every rower (name, squad, grade now, grad year, active, OYO minutes required). tests: benchmark tests (2000m, 20min, 500m, 100m, 30r20) with result, split per 500 m, rate, part splits, GMS % and stars. workouts: every logged session (practice, OYO, makeup) with activity, minutes, meters, zone, RPE, status. plans: the published weekly workouts with each rower\'s targets. practices: practice days and cancellations. team_gms: team GMS % averages by group. weights: body weights in lb by date, as entered by coaches. Filters are optional; dates are YYYY-MM-DD.',
    input_schema: { type: 'object', additionalProperties: false, required: ['table', 'athlete', 'from', 'to', 'test', 'limit'], properties: {
      table: { type: 'string', enum: TABLES },
      athlete: nullable({ type: 'string', description: 'One rower\'s full name, or null for everyone' }),
      from: nullable({ type: 'string', description: 'First date, or null' }),
      to: nullable({ type: 'string', description: 'Last date, or null' }),
      test: nullable({ type: 'string', enum: [...TESTS, null], description: 'tests table only: one test, or null' }),
      limit: nullable({ type: 'integer', description: `At most this many rows (newest first); null = ${MAX_ROWS}` }) } } },
  { name: 'calculate', description: 'Exact arithmetic over numbers taken from the rows: mean, sum, min, max, count, or difference (first minus second). Use it for every average, total or gap in the answer.',
    input_schema: { type: 'object', additionalProperties: false, required: ['op', 'values'], properties: {
      op: { type: 'string', enum: ['mean', 'sum', 'min', 'max', 'count', 'difference'] },
      values: { type: 'array', items: { type: 'number' } } } } }
].map((t) => ({ ...t, strict: true }));

const r1 = (x) => (x === null || x === undefined ? x : Math.round(x * 10) / 10);

/** The rows of one table, names in place of ids, newest first. Never weights, birthdays or sign-in codes. */
export function getRows(feed, input, today) {
  const st = feed.settings.schoolYearStart;
  const byId = Object.fromEntries(feed.athletes.map((a) => [a.id, a]));
  const name = (id) => (byId[id] ? byId[id].name : id);
  const who = input.athlete ? feed.athletes.find((a) => a.name.toLowerCase() === String(input.athlete).trim().toLowerCase()) : null;
  if (input.athlete && !who) return { error: `No rower called "${input.athlete}". Roster names: ${feed.athletes.map((a) => a.name).join(', ')}` };
  const inDates = (d) => (!input.from || d >= input.from) && (!input.to || d <= input.to) && d <= today;
  let rows;
  switch (input.table) {
    case 'roster':
      rows = feed.athletes.filter((a) => !who || a.id === who.id).map((a) => ({ name: a.name, role: a.role, squad: a.squad, grade: a.grade, gradYear: a.gradYear, active: a.active, oyoRequired: a.oyoRequired, oyoElite: a.oyoElite }));
      break;
    case 'tests':
      rows = feed.benchmarks.filter((b) => (!who || b.athleteId === who.id) && (!input.test || b.test === input.test) && inDates(b.date)).map((b) => {
        const a = byId[b.athleteId] || {};
        const v = resultValue(b);
        const split = !v ? null : b.test === '2000m' ? v / 4 : b.test === '500m' ? v : b.test === '100m' ? v * 5 : (1200 * 500) / v;
        return { athlete: name(b.athleteId), date: b.date, schoolYear: schoolYearLabel(b.date, st), gradeThen: gradeAt(a.gradYear, b.date, st), test: TEST_LABELS[b.test] || b.test,
          timeS: b.timeS, meters: b.meters, split500S: r1(split), avgRate: b.avgRate, partSplitsS: b.splits, valid: b.valid, gmsPct: b.gmsPct, stars: b.stars, dateApprox: b.dateApprox || undefined };
      });
      break;
    case 'workouts':
      rows = feed.entries.filter((e) => (!who || e.athleteId === who.id) && inDates(e.date)).map((e) => ({
        athlete: name(e.athleteId), date: e.date, type: e.type, makeupFor: e.makeupFor || undefined, status: e.status, activity: e.activity, mainSet: e.mainSet, zone: e.zone, rpe: e.rpe,
        workMin: e.workS ? r1(e.workS / 60) : e.workS, workM: e.workM, restM: e.restM || undefined, warmupMin: e.warmupS ? r1(e.warmupS / 60) : undefined, cooldownMin: e.cooldownS ? r1(e.cooldownS / 60) : undefined,
        warmupM: e.warmupM || undefined, cooldownM: e.cooldownM || undefined, intervals: e.intervals, dragFactor: e.dragFactor, source: e.source }));
      break;
    case 'plans':
      rows = [];
      (feed.weeks || []).forEach((w) => w.sessions.forEach((s) => {
        if (!inDates(s.day) && !(s.day > today && (!input.to || s.day <= input.to))) return;
        const targets = (s.athletes || []).filter((x) => !who || x.athlete === who.name);
        rows.push({ day: s.day, session: s.session, squad: s.squad, workout: s.workout, notes: s.notes || undefined, pieces: s.pieces.map((p) => p.label), targets: targets.map((x) => ({ athlete: x.athlete, targets: x.targets.map((t) => `${t.piece}: ${t.target}`) })) });
      }));
      break;
    case 'practices':
      rows = (feed.practices || []).filter((p) => inDates(p.date)).map((p) => ({ ...p }));
      break;
    case 'team_gms':
      rows = feed.teamGms || [];
      break;
    default:
      return { error: `Unknown table ${input.table}` };
  }
  const total = rows.length;
  rows = rows.slice().sort((x, y) => String(y.date || y.day || '').localeCompare(String(x.date || x.day || '')));
  const limit = Math.max(1, Math.min(MAX_ROWS, input.limit || MAX_ROWS));
  return { table: input.table, total, shown: Math.min(total, limit), rows: rows.slice(0, limit) };
}

/** Weights rows (from the Sheet action) filtered like get_rows. null = they could not be loaded. */
export function weightRows(weights, feed, input, today) {
  if (!weights) return { error: 'Weights could not be loaded from the Sheet just now.' };
  const who = input.athlete ? feed.athletes.find((a) => a.name.toLowerCase() === String(input.athlete).trim().toLowerCase()) : null;
  if (input.athlete && !who) return { error: `No rower called "${input.athlete}".` };
  const rows = weights.filter((w) => (!who || w.athlete === who.name) && (!input.from || w.date >= input.from) && (!input.to || w.date <= input.to) && w.date <= today)
    .sort((x, y) => y.date.localeCompare(x.date));
  const limit = Math.max(1, Math.min(MAX_ROWS, input.limit || MAX_ROWS));
  return { table: 'weights', total: rows.length, shown: Math.min(rows.length, limit), rows: rows.slice(0, limit) };
}

export function calculate({ op, values }) {
  const xs = (values || []).filter((x) => typeof x === 'number' && isFinite(x));
  if (op === 'count') return { result: xs.length };
  if (!xs.length) return { error: 'No numbers given' };
  const sum = xs.reduce((a, b) => a + b, 0);
  const result = op === 'mean' ? sum / xs.length : op === 'sum' ? sum : op === 'min' ? Math.min(...xs) : op === 'max' ? Math.max(...xs) : op === 'difference' ? xs[0] - (xs[1] || 0) : null;
  if (result === null) return { error: `Unknown op ${op}` };
  return { result: Math.round(result * 1000) / 1000 };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function freeSystemPrompt(feed, today) {
  const st = feed.settings.schoolYearStart || '07-01';
  const y = Number(schoolYearStart(today, st).slice(0, 4));
  const roster = feed.athletes.filter((a) => a.role === 'Rower').map((a) => `${a.name} (${a.grade || 'no grade'}${a.squad ? ', ' + a.squad : ''}${a.active ? '' : ', inactive'})`).join('; ');
  return [
    'You answer a coach\'s question about the Whitman girls rowing team, using only the team\'s erg tracker. Look things up with get_rows, do every average, total and gap with calculate, then reply.',
    `Today is ${WEEKDAYS[new Date(today + 'T12:00:00Z').getUTCDay()]} ${today}. This school year is ${schoolYearLabel(today, st)} (from ${y}-${st}). Grades: 12th = seniors, 11th = juniors, 10th = sophomores, 9th = freshmen.`,
    `Roster: ${roster}.`,
    'The team\'s words: "latest" = most recent. "Season PR" / "year PR" = best this school year. "Career PR" / "all-time" = best ever. A 2k is better when faster; a 20\' and a 30r20 are better with more meters. Only rows with valid true count as results.',
    'Reply for Slack: short, plain sentences or a short list, *bold* for headings. Write times and splits as m:ss.s (split per 500 m), meters as 4,966 m. Put no number in the reply that is not in the rows or a calculate result.',
    'Birthdays and sign-in details are not available; say so if asked. If the question is not about the tracker\'s data, reply only: "I can only answer questions about the tracker\'s data." If the data does not hold the answer, say what is missing. Never give training, health or injury advice.'
  ].join('\n');
}

// ---- number check -------------------------------------------------------------

/** Every number in the rows and results the model saw. */
function seenNumbers(values) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'number') out.push(v);
    else if (typeof v === 'string') (v.match(/\d+:\d\d(?:\.\d)?|\d[\d,]*(?:\.\d+)?/g) || []).forEach((t) => out.push(parseNum(t)));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  values.forEach(walk);
  return out;
}
function parseNum(t) {
  if (t.includes(':')) { const [m, s] = t.split(':'); return Number(m) * 60 + Number(s); }
  return Number(t.replace(/,/g, ''));
}

/** Times (m:ss.s) and meter counts in the reply that match nothing the model read. */
export function uncheckedNumbers(reply, seen) {
  const bad = [];
  const near = (x, tol) => seen.some((v) => Math.abs(v - x) <= tol || Math.abs(v / 60 - x) <= tol / 60);
  (reply.match(/\b\d{1,2}:\d\d(?:\.\d)?\b/g) || []).forEach((t) => { if (!near(parseNum(t), 0.15)) bad.push(t); });
  (reply.match(/\b\d[\d,]*\s?m\b/g) || []).forEach((t) => { const x = parseNum(t.replace(/\s?m$/, '')); if (x >= 100 && !near(x, 1.01)) bad.push(t); });
  return [...new Set(bad)];
}

/**
 * Answer one coach question. Returns { text, usd, turns, unchecked }.
 * client: anthropicClient; budgetUsd: what this question may still spend.
 */
export async function answerFreely({ client, model = FREE_MODEL, feed, today, question, previous, budgetUsd = QUESTION_CEILING_USD, loadWeights = null }) {
  const ceiling = Math.min(QUESTION_CEILING_USD, budgetUsd);
  const first = previous ? `Earlier question (${Math.max(1, Math.round((Date.now() - previous.at) / 60000))} min ago): "${previous.question}"\n\nNew question: ${question}` : question;
  const messages = [{ role: 'user', content: first }];
  const seen = [];
  let usd = 0;
  let weights;   // fetched once, the first time the model asks for them
  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const res = await client.messages.create({
      model, max_tokens: 4000,
      system: freeSystemPrompt(feed, today),
      tools: FREE_TOOLS,
      tool_choice: { type: 'auto' },
      output_config: { effort: 'medium' },
      messages
    });
    usd += costUsd(model, res.usage);
    const content = res.content || [];
    const uses = content.filter((b) => b.type === 'tool_use');
    const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (res.stop_reason === 'refusal') return { text: 'I can\'t answer that one.', usd, turns: turn, unchecked: [] };
    if (!uses.length || res.stop_reason !== 'tool_use') {
      if (!text) return { text: 'I couldn\'t work that out. Try asking it another way.', usd, turns: turn, unchecked: [] };
      const unchecked = uncheckedNumbers(text, seenNumbers(seen));
      const note = unchecked.length ? `\n_Check this: I couldn't match ${unchecked.slice(0, 4).join(', ')} to the data._` : '';
      return { text: text + note, usd, turns: turn, unchecked };
    }
    if (usd >= ceiling || turn === MAX_TURNS) break;
    messages.push({ role: 'assistant', content });
    if (uses.some((u) => u.input && u.input.table === 'weights') && weights === undefined) {
      weights = loadWeights ? await loadWeights().catch(() => null) : null;
    }
    messages.push({ role: 'user', content: uses.map((u) => {
      const out = u.name === 'calculate' ? calculate(u.input || {}) : u.name !== 'get_rows' ? { error: 'Unknown tool' }
        : u.input && u.input.table === 'weights' ? weightRows(weights, feed, u.input, today) : getRows(feed, u.input || {}, today);
      seen.push(out);
      return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) };
    }) });
  }
  return { text: 'That question needs more looking up than I can do in one go. Try asking about a shorter time span or one test.', usd, turns: MAX_TURNS, unchecked: [] };
}
