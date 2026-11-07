// ErgBot questions (David, 2026-11-07): the fixed lookups a question can use,
// who may use each one, and the reply text. The model only picks a lookup and
// its settings (ask.mjs); everything here is plain code over the same feed and
// views as the team site, so every number matches the site. Nothing here ever
// shows a weight (the feed has none) or a birthday.
//
// Who may see what (David, 2026-11-07):
// - Coaches: everything.
// - Athletes: their own numbers in full, the boards they already see on the
//   site, and team totals (averages, totals, counts) that cover at least
//   MIN_GROUP rowers. Never another athlete's details.

import { TESTS, TEST_LABELS, resultValue, better, schoolYearStart, schoolYearLabel, boardGroup, addDays, weekStart } from './stats.mjs';
import { testBoard, athleteView, teamSplitsView, notLoggedView, starsView, dayPlan, activeRowers, isAlum } from './views.mjs';
import { formatClock } from './ergchecks.mjs';
import { resolveName } from './slackphoto.mjs';

export const MIN_GROUP = 4;   // the smallest group an athlete may see an average of (David, 2026-11-07)
export const SCHEDULE_URL = 'https://www.iswhitmanrowingtoday.com';
const ALL_TIME = '0000-00-00';

const TEST_ENUM = ['2000m', '20min', '500m', '100m', '30r20'];
const GROUP_ENUM = ['all', 'varsity', 'freshman'];
const nullable = (schema) => ({ ...schema, type: [schema.type, 'null'] });

/** Tool definitions the model chooses from. Strict, so the settings always match the schema. */
export const TOOLS = [
  { name: 'board', description: 'A leaderboard for one test: each rower\'s best result, ranked. period "season" = this school year (season PR / year PR), "all_time" = career PR, "school_year" = one past school year given by its starting year.',
    input_schema: { type: 'object', additionalProperties: false, required: ['test', 'period', 'school_year', 'group', 'limit'], properties: {
      test: { type: 'string', enum: TEST_ENUM }, period: { type: 'string', enum: ['season', 'all_time', 'school_year'] },
      school_year: nullable({ type: 'integer', description: 'Starting calendar year of the school year when period is school_year, e.g. 2025 for 2025-26; otherwise null' }),
      group: { type: 'string', enum: GROUP_ENUM, description: 'varsity = pieces done in 10th-12th grade, freshman = 7th-9th (Fr/Nov)' },
      limit: nullable({ type: 'integer', description: 'Only the top N (e.g. "top 8"); null for everyone. A top-N board also shows the average result and split of those N.' }) } } },
  { name: 'latest_test', description: 'Results of the most recent team test day for one test (the latest 2k, the latest 20\'), ranked, with each rower\'s change from her previous best.',
    input_schema: { type: 'object', additionalProperties: false, required: ['test', 'group'], properties: { test: { type: 'string', enum: TEST_ENUM }, group: { type: 'string', enum: GROUP_ENUM } } } },
  { name: 'athlete', description: 'One athlete\'s summary: season and career PRs, latest tests, stars, GMS %, this week\'s practices and OYO minutes. name null = the person asking.',
    input_schema: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: nullable({ type: 'string' }) } } },
  { name: 'top_average', description: 'Team comparison without names: the average of the best N rowers\' results for one test in each school year listed (e.g. best 8 20\' this year vs last year).',
    input_schema: { type: 'object', additionalProperties: false, required: ['test', 'n', 'school_years', 'group'], properties: {
      test: { type: 'string', enum: TEST_ENUM }, n: { type: 'integer', description: 'How many of the best results to average' },
      school_years: { type: 'array', items: { type: 'integer' }, description: 'Starting years of the school years to compare, e.g. [2026, 2025]' },
      group: { type: 'string', enum: GROUP_ENUM } } } },
  { name: 'group_averages', description: 'Average 2k and 20\' splits, average stars, by group: Top 8, Second 8, Top 16, Varsity, Freshman, All (this season).',
    input_schema: { type: 'object', additionalProperties: false, required: [], properties: {} } },
  { name: 'not_logged', description: 'Which rowers have not logged a session yet this week.',
    input_schema: { type: 'object', additionalProperties: false, required: [], properties: {} } },
  { name: 'stars_ranking', description: 'Every rower\'s season stars, ranked.',
    input_schema: { type: 'object', additionalProperties: false, required: [], properties: {} } },
  { name: 'todays_plan', description: 'The published workout for today or tomorrow, with the athlete\'s own target split for each piece (pacing: "what split should I hold for steady state today"). name null = the person asking; for a coach with no name, the workouts without targets.',
    input_schema: { type: 'object', additionalProperties: false, required: ['name', 'day'], properties: { name: nullable({ type: 'string' }), day: { type: 'string', enum: ['today', 'tomorrow'] } } } },
  { name: 'test_pacing', description: 'How an athlete paced her most recent 2k or 20\' test, part by part, and her best this season. name null = the person asking.',
    input_schema: { type: 'object', additionalProperties: false, required: ['name', 'test'], properties: { name: nullable({ type: 'string' }), test: { type: 'string', enum: ['2000m', '20min'] } } } },
  { name: 'question_log', description: 'The most recent questions people asked ErgBot (coaches only).',
    input_schema: { type: 'object', additionalProperties: false, required: [], properties: {} } },
  { name: 'schedule_link', description: 'Any question about whether there is practice, practice times, places or the calendar.',
    input_schema: { type: 'object', additionalProperties: false, required: [], properties: {} } },
  { name: 'cannot_answer', description: 'Use when no other lookup fits: a question about another athlete asked by an athlete, something the tracker does not hold, advice (training, health, injury), or a question you cannot follow.',
    input_schema: { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: { type: 'string', enum: ['other_athlete', 'not_in_data', 'advice', 'unclear'] } } } }
].map((t) => ({ ...t, strict: true }));

export const TOOL_NAMES = TOOLS.map((t) => t.name);

// ---- formatting ----------------------------------------------------------------

const label = (test) => TEST_LABELS[test] || test;
const meters = (m) => `${Math.round(m).toLocaleString('en-US')} m`;
const isMeters = (test) => test === '20min' || test === '30r20';
/** Split per 500 m for a result: time tests from the time, 20' and 30r20 from meters in 20 minutes. */
export function splitOf(test, v) {
  if (!v) return null;
  if (test === '2000m') return v / 4;
  if (test === '500m') return v;
  if (test === '100m') return v * 5;
  if (isMeters(test)) return (1200 * 500) / v;
  return null;
}
const resultText = (test, v) => (isMeters(test) ? meters(v) : formatClock(v));
const withSplit = (test, v) => {
  const s = splitOf(test, v);
  return test === '500m' || s === null ? resultText(test, v) : `${resultText(test, v)} (${formatClock(s)})`;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDate = (d) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
const starText = (s) => (s === null || s === undefined ? '' : ` ${s}★`);
const groupText = (g) => (g === 'varsity' ? 'Varsity' : g === 'freshman' ? 'Fr/Nov' : 'all rowers');
/** Change between two results of one test, signed so that + is always better (more meters, less time). */
function changeText(test, now, before, her = 'her') {
  if (!before) return 'first test';
  const d = isMeters(test) ? now - before : before - now;
  if (Math.abs(d) < (isMeters(test) ? 0.5 : 0.05)) return `same as ${her} best`;
  const sign = d > 0 ? '+' : '−';
  return isMeters(test) ? `${sign}${Math.round(Math.abs(d))} m on ${her} best` : `${sign}${Math.abs(d).toFixed(1)} s on ${her} best`;
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// ---- who is who ----------------------------------------------------------------

const rowers = (feed) => feed.athletes.filter((a) => a.role === 'Rower');

/**
 * The athlete a lookup is about. asker = { role: 'coach' | 'athlete', athleteId }.
 * Returns { a } or { reply } (a refusal or a "which one?" text).
 */
export function whoFor(feed, asker, name) {
  const me = asker.athleteId ? feed.athletes.find((x) => x.id === asker.athleteId) : null;
  if (!name) {
    if (me) return { a: me };
    return { reply: 'Which athlete? Ask again with her name.' };
  }
  const pool = asker.role === 'coach' ? rowers(feed) : activeRowers(feed);
  const r = resolveName(name, pool.map((a) => a.name));
  if (r.kind === 'none') return { reply: asker.role === 'coach' ? `I can't find "${name}" on the roster.` : `I can only show you your own numbers and team totals.` };
  if (r.kind !== 'exact') return { reply: (r.kind === 'choose' ? `More than one athlete is called "${name}": ` : `I can't find "${name}". Did you mean `) + r.names.join(', ') + '? Ask again with the full name.' };
  const a = pool.find((x) => x.name === r.names[0]);
  if (asker.role !== 'coach' && (!me || a.id !== me.id)) return { reply: 'I can only show you your own numbers and team totals.' };
  return { a };
}

// ---- the lookups ---------------------------------------------------------------

const yearStartOf = (feed, startYear) => `${startYear}-${feed.settings.schoolYearStart || '07-01'}`;
const yearEndOf = (feed, startYear) => addDays(yearStartOf(feed, startYear + 1), -1);
const thisSchoolYear = (feed, today) => Number(schoolYearStart(today, feed.settings.schoolYearStart).slice(0, 4));

function board(feed, asker, input, today) {
  const { test, period, group } = input;
  const st = feed.settings.schoolYearStart;
  let from, to = today, title, pastYear = false;
  if (period === 'all_time') { from = ALL_TIME; title = 'all time'; }
  else if (period === 'school_year' && input.school_year && input.school_year !== thisSchoolYear(feed, today)) {
    from = yearStartOf(feed, input.school_year); to = yearEndOf(feed, input.school_year); pastYear = true;
    title = schoolYearLabel(from, st);
    if (from > today) return { text: `The ${title} school year hasn't started yet.` };
  } else { from = schoolYearStart(today, st); title = `${schoolYearLabel(today, st)} season`; }
  const rows = testBoard(feed, test, { from, to, group: group === 'all' ? null : group, today, pastYear });
  const shown = input.limit && input.limit > 0 ? rows.slice(0, input.limit) : rows;
  const head = `*${label(test)} board, ${title}, ${groupText(group)}*${input.limit ? `, top ${input.limit}` : ''}`;
  if (!rows.length) return { text: `${head}\nNo results yet.` };
  const mine = asker.athleteId && rows.find((r) => r.id === asker.athleteId);
  const lines = shown.map((r) => `${r.rank}. ${r.name}${starText(r.stars)}: ${withSplit(test, r.result)}, ${r.dateApprox ? r.schoolYear : shortDate(r.date)}${r.alum ? ' (alum)' : ''}`);
  if (mine && !shown.includes(mine)) lines.push(`You: ${mine.rank} of ${rows.length}, ${withSplit(test, mine.result)}`);
  // "Top 4 and their average split" (David, 2026-11-07): a top-N board also gives the average of those N.
  if (input.limit && shown.length > 1) {
    const avg = mean(shown.map((r) => r.result));
    lines.push(`Average of these ${shown.length}: ${resultText(test, avg)}${splitOf(test, avg) !== null && test !== '500m' ? `, split ${formatClock(isMeters(test) ? mean(shown.map((r) => splitOf(test, r.result))) : splitOf(test, avg))}` : ''}`);
  }
  return { text: `${head}\n${lines.join('\n')}` };
}

/** The most recent day with at least 3 results for the test (a single re-test is not a test day), else the latest day with any. */
export function latestTestDay(feed, test, today) {
  const byDay = {};
  const ids = new Set(rowers(feed).filter((a) => !isAlum(a)).map((a) => a.id));
  feed.benchmarks.forEach((b) => {
    if (b.test !== test || !b.valid || !resultValue(b) || b.date > today || !ids.has(b.athleteId)) return;
    byDay[b.date] = (byDay[b.date] || 0) + 1;
  });
  const days = Object.keys(byDay).sort().reverse();
  return days.find((d) => byDay[d] >= 3) || days[0] || null;
}

function latestTest(feed, asker, input, today) {
  const { test, group } = input;
  const st = feed.settings.schoolYearStart;
  const day = latestTestDay(feed, test, today);
  if (!day) return { text: `No ${label(test)} results yet.` };
  const byId = Object.fromEntries(rowers(feed).filter((a) => !isAlum(a)).map((a) => [a.id, a]));
  const best = {};   // one result per rower that day: her best of the day
  feed.benchmarks.forEach((b) => {
    const a = byId[b.athleteId];
    if (!a || b.test !== test || b.date !== day || !b.valid || !resultValue(b)) return;
    if (group !== 'all' && boardGroup(a.gradYear, b.date, st) !== group) return;
    if (!best[a.id] || better(test, b, best[a.id])) best[a.id] = b;
  });
  const rows = Object.values(best).sort((x, y) => (better(test, x, y) ? -1 : better(test, y, x) ? 1 : 0)).map((b, i) => {
    const before = feed.benchmarks.filter((x) => x.athleteId === b.athleteId && x.test === test && x.valid && resultValue(x) && x.date < day)
      .reduce((acc, x) => (!acc || better(test, x, acc) ? x : acc), null);
    return { rank: i + 1, a: byId[b.athleteId], v: resultValue(b), change: changeText(test, resultValue(b), before && resultValue(before), b.athleteId === asker.athleteId ? 'your' : 'her') };
  });
  const head = `*Latest ${label(test)} test, ${shortDate(day)}, ${groupText(group)}* (${rows.length} rower${rows.length === 1 ? '' : 's'})`;
  if (!rows.length) return { text: `${head}\nNo results in that group.` };
  const avg = mean(rows.map((r) => r.v));
  if (asker.role === 'coach') {
    return { text: `${head}\n${rows.map((r) => `${r.rank}. ${r.a.name}: ${withSplit(test, r.v)}, ${r.change}`).join('\n')}\nAverage: ${withSplit(test, avg)}` };
  }
  // Athletes: her own result and place, and the team average when it covers enough rowers.
  const me = rows.find((r) => r.a.id === asker.athleteId);
  const lines = [me ? `You: ${withSplit(test, me.v)}, ${me.change}, ${me.rank} of ${rows.length}.` : 'You have no result from that day.'];
  lines.push(rows.length >= MIN_GROUP ? `Team average: ${withSplit(test, avg)}.` : 'Too few results that day for a team average.');
  return { text: `${head}\n${lines.join('\n')}` };
}

function athlete(feed, asker, input, today) {
  const w = whoFor(feed, asker, input.name);
  if (w.reply) return { text: w.reply };
  const v = athleteView(feed, w.a.id, today);
  const st = feed.settings.schoolYearStart;
  const lines = [`*${v.athlete.name}*, ${v.athlete.squad || 'no squad'}${v.athlete.grade ? `, ${v.athlete.grade}` : ''}`];
  const stars = v.gms.filter((g) => g.stars !== null).map((g) => g.stars);
  v.bests.filter((b) => b.test === '2000m' || b.test === '20min' || b.season).forEach((b) => {
    const season = b.season ? `season PR ${withSplit(b.test, b.season.result)} (${shortDate(b.season.date)})` : `no ${schoolYearLabel(today, st)} result`;
    lines.push(`${label(b.test)}: ${season}; career PR ${withSplit(b.test, b.allTime.result)} (${b.allTime.date.slice(0, 4)})`);
  });
  if (!v.bests.length) lines.push('No test results yet.');
  if (v.gms.length) lines.push('GMS this season: ' + v.gms.map((g) => `${label(g.test)} ${g.gmsPct}%${g.stars ? ` (${g.stars}★)` : ''}`).join(', '));
  if (stars.length) lines.push(`Season stars: ${Math.round((2 * mean(stars))) / 2}★`);
  lines.push(`This week: ${v.week.practicesDone} of ${v.week.practicesExpected} practices, ${v.week.oyoMin} OYO min (goal ${v.athlete.oyoRequired}).`);
  lines.push(`Season: ${v.season.completionPct === null ? 'no practices yet' : `${v.season.completionPct}% of practices`}, ${meters(v.season.meters || 0)}.`);
  const recent = v.tests.filter((t) => t.valid).slice(0, 3);
  if (recent.length) lines.push('Latest tests: ' + recent.map((t) => `${label(t.test)} ${resultText(t.test, t.result)} (${shortDate(t.date)})`).join(', '));
  return { text: lines.join('\n') };
}

function topAverage(feed, asker, input, today) {
  const { test, group } = input;
  const n = Math.max(1, Math.min(50, input.n || 8));
  const st = feed.settings.schoolYearStart;
  const years = (input.school_years && input.school_years.length ? input.school_years : [thisSchoolYear(feed, today), thisSchoolYear(feed, today) - 1]).slice(0, 6);
  const minN = asker.role === 'coach' ? 1 : MIN_GROUP;
  if (n < minN) return { text: `I can only average groups of ${MIN_GROUP} or more.` };
  const out = years.map((y) => {
    const from = yearStartOf(feed, y), to = yearEndOf(feed, y);
    const rows = testBoard(feed, test, { from, to, group: group === 'all' ? null : group, today, pastYear: y !== thisSchoolYear(feed, today) }).slice(0, n);
    return { y, name: schoolYearLabel(from, st) + (y === thisSchoolYear(feed, today) ? ' so far' : ''), count: rows.length, avg: mean(rows.map((r) => r.result)) };
  });
  const lines = out.map((o) => (!o.count ? `${o.name}: no results` : o.count < minN ? `${o.name}: too few results` :
    `${o.name}: ${withSplit(test, o.avg)}${o.count < n ? ` (only ${o.count} rowers)` : ''}`));
  const ok = out.filter((o) => o.count >= minN && o.count);
  if (ok.length >= 2) {
    const [a, b] = ok;
    const d = isMeters(test) ? a.avg - b.avg : b.avg - a.avg;
    const ahead = d >= 0 ? a.name : b.name, behind = d >= 0 ? b.name : a.name;
    lines.push(`${ahead.replace(' so far', '')} is ${isMeters(test) ? meters(Math.abs(d)) : Math.abs(d).toFixed(1) + ' s'} ahead of ${behind.replace(' so far', '')}.`);
  }
  return { text: `*Average of the best ${n} ${label(test)} results, ${groupText(group)}*\n${lines.join('\n')}` };
}

function groupAverages(feed, asker, input, today) {
  const v = teamSplitsView(feed, today);
  const minN = asker.role === 'coach' ? 1 : MIN_GROUP;
  const lines = v.groups.map((g) => {
    const bits = [];
    if (g.twoK.n >= minN && g.twoK.avgSplit) bits.push(`2k ${formatClock(g.twoK.avgSplit)} (${g.twoK.n})`);
    if (g.twenty.n >= minN && g.twenty.avgMeters) bits.push(`20' ${meters(g.twenty.avgMeters)} at ${formatClock(g.twenty.avgSplit)} (${g.twenty.n})`);
    if (g.n >= minN && g.avgStars !== null) bits.push(`${g.avgStars}★ average`);
    return `${g.label}: ${bits.length ? bits.join(', ') : 'too few results'}`;
  });
  return { text: `*Group averages, ${schoolYearLabel(today, feed.settings.schoolYearStart)} season* (rowers counted in brackets)\n${lines.join('\n')}` };
}

function notLogged(feed, asker, input, today) {
  const v = notLoggedView(feed, today);
  if (!v.rowers.length) return { text: `Everyone has logged a session this week (since ${shortDate(v.weekStart)}).` };
  return { text: `*Not logged yet this week* (since ${shortDate(v.weekStart)}, ${v.rowers.length})\n${v.rowers.map((r) => `${r.name}${r.squad ? ` (${r.squad})` : ''}`).join('\n')}` };
}

function starsRanking(feed, asker, input, today) {
  const v = starsView(feed, today);
  const rated = v.rowers.filter((r) => r.stars !== null);
  const none = v.rowers.length - rated.length;
  return { text: `*Season stars*\n${rated.map((r, i) => `${i + 1}. ${r.name} ${r.stars}★`).join('\n')}${none ? `\nNo stars yet: ${none} rower${none === 1 ? '' : 's'}` : ''}` };
}

function todaysPlan(feed, asker, input, today) {
  const day = input.day === 'tomorrow' ? addDays(today, 1) : today;
  const when = input.day === 'tomorrow' ? 'tomorrow' : 'today';
  if (!input.name && asker.role === 'coach') {   // a coach asking about the day: every session, no targets
    const plan = (feed.weeks || []).find((w) => w.weekStart === weekStart(day)) || { sessions: [] };
    const sessions = plan.sessions.filter((s) => s.day === day);
    if (!sessions.length) return { text: `No workout is posted for ${when} yet.` };
    return { text: sessions.map((s) => `*${s.squad} ${s.session}: ${s.workout}*\n${s.pieces.map((p) => `• ${p.label}`).join('\n')}`).join('\n') };
  }
  const w = whoFor(feed, asker, input.name);
  if (w.reply) return { text: w.reply };
  const sessions = dayPlan(feed, day, w.a);
  if (!sessions.length) return { text: `No workout is posted for ${when} yet.` };
  const own = asker.athleteId === w.a.id;
  const lines = sessions.map((s) => `*${s.session}: ${s.workout}*\n${s.pieces.map((p) => `• ${p.label}: ${p.target ? `hold ${p.target}` : 'no target'}`).join('\n')}`);
  const anyTarget = sessions.some((s) => s.pieces.some((p) => p.target));
  if (!anyTarget) lines.push(own ? 'You don\'t have a target yet: you need a 2k or 20\' from this season or last. Ask your coach.' : `${w.a.name} has no target yet (no 2k or 20' this season or last).`);
  return { text: `${own ? '' : `*For ${w.a.name}, ${when}*\n`}${lines.join('\n')}` };
}

function testPacing(feed, asker, input, today) {
  const w = whoFor(feed, asker, input.name);
  if (w.reply) return { text: w.reply };
  const v = athleteView(feed, w.a.id, today);
  const own = asker.athleteId === w.a.id;
  const who = own ? 'your' : `${w.a.name}'s`;
  const p = v.pacing.find((x) => x.test === input.test);
  const best = v.bests.find((b) => b.test === input.test);
  const lines = [];
  if (best && best.season) lines.push(`Season PR: ${withSplit(input.test, best.season.result)} (${shortDate(best.season.date)}).`);
  if (!p) lines.push(`No part-by-part splits for ${who} ${label(input.test)} yet.`);
  else {
    lines.push(`${own ? 'Your' : `${w.a.name}'s`} latest ${label(input.test)} (${shortDate(p.date)}), average ${formatClock(p.avgS)}:`);
    p.segments.forEach((s) => lines.push(`• ${s.label}: ${formatClock(s.splitS)} (${s.deltaS > 0 ? '+' : s.deltaS < 0 ? '−' : '±'}${Math.abs(s.deltaS).toFixed(1)})`));
    if (p.read) lines.push(String(p.read));
  }
  return { text: lines.join('\n') };
}

const REFUSE = {
  other_athlete: 'I can only show you your own numbers and team totals.',
  not_in_data: 'I can only answer questions about the tracker\'s data: results, boards, targets and logging.',
  advice: 'I can only answer questions about the tracker\'s data. For training, health or injury questions, ask your coach.',
  unclear: 'I didn\'t follow that. Try something like "rankings of the latest 20\' test", "my season PRs", or "what split should I hold today?".'
};

/** What each lookup does, and who may use it. */
export const LOOKUPS = {
  board: { run: board, athletes: true },
  latest_test: { run: latestTest, athletes: true },
  athlete: { run: athlete, athletes: true },
  top_average: { run: topAverage, athletes: true },
  group_averages: { run: groupAverages, athletes: true },
  not_logged: { run: notLogged, athletes: false },
  stars_ranking: { run: starsRanking, athletes: false },
  todays_plan: { run: todaysPlan, athletes: true },
  test_pacing: { run: testPacing, athletes: true },
  question_log: { run: null, athletes: false },   // ask.mjs answers it from the log store
  schedule_link: { run: () => ({ text: `For practice times and whether there's practice, see ${SCHEDULE_URL}` }), athletes: true },
  cannot_answer: { run: (feed, asker, input) => ({ text: input.reason === 'other_athlete' && asker.role === 'coach' ? REFUSE.not_in_data : REFUSE[input.reason] || REFUSE.unclear }), athletes: true }
};

/** Runs one lookup for the asker. Returns { text, refused? }. */
export function runLookup(feed, asker, name, input, today) {
  const l = LOOKUPS[name];
  if (!l) return { text: REFUSE.unclear, refused: true };
  if (asker.role !== 'coach' && !l.athletes) return { text: REFUSE.other_athlete, refused: true };
  if (!l.run) return { text: REFUSE.unclear, refused: true };
  if (name !== 'cannot_answer' && name !== 'schedule_link' && input && input.test && !TESTS.includes(input.test)) return { text: REFUSE.unclear, refused: true };
  return l.run(feed, asker, input || {}, today);
}
