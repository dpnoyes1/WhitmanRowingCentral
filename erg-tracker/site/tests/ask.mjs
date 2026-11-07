// Tests for ErgBot questions (lib/ask.mjs, lib/asklookups.mjs). All data is the
// made-up dummy feed plus a few made-up rows. No network: the model and Slack are fakes.
import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { runLookup, latestTestDay, TOOLS, MIN_GROUP, SCHEDULE_URL } from '../lib/asklookups.mjs';
import { handleQuestion, costUsd, systemPrompt, cleanText, DAILY_LIMIT } from '../lib/ask.mjs';
import { leaderboardsView, teamSplitsView } from '../lib/views.mjs';
import { handleSlackAction } from '../functions/slack-background.mjs';
import { handleSlack } from '../functions/slack.mjs';

const require = createRequire(import.meta.url);
const { dummyFeed } = require('../scripts/dummy-feed.js');
const TODAY = '2026-10-23';
const COACH = { role: 'coach' };

export default function askTests(test) {
  const feed = dummyFeed();
  const me = feed.athletes.find((a) => a.name === 'Avery Callahan');
  const ATHLETE = { role: 'athlete', athleteId: me.id, name: me.name };
  const run = (asker, tool, input) => runLookup(feed, asker, tool, input, TODAY).text;

  test('ask lookups: best in each grade ("top athlete in each class and their 20\' average", David 2026-11-07)', () => {
    const site = leaderboardsView(feed, TODAY).tests.find((t) => t.test === '20min').season;
    const byName = Object.fromEntries(feed.athletes.map((a) => [a.name, a]));
    const text = run(COACH, 'by_grade', { test: '20min', period: 'season', school_year: null, grades: null, per_grade: null });
    const lines = text.split('\n').slice(1);
    assert.ok(/^\*Seniors \(12th\)\*: /.test(lines[0]) && lines.some((l) => l.startsWith('*Freshmen (9th)*: ')), text);
    lines.forEach((l) => {
      const name = l.split('*: ')[1].split(/ \d★|:/)[0];
      const grade = byName[name].grade;
      const best = site.filter((r) => byName[r.name].grade === grade)[0];
      assert.strictEqual(best.name, name, `fastest ${grade}`);
      assert.ok(/\(\d:\d\d\.\d\)/.test(l), 'each line has her split');
    });
    const seniors = run(ATHLETE, 'by_grade', { test: '20min', period: 'season', school_year: null, grades: [12], per_grade: 3 });
    assert.ok(seniors.includes('1. ') && seniors.includes('Average of these 3') && !seniors.includes('Juniors'), seniors);
    assert.ok(TOOLS.find((t) => t.name === 'by_grade').strict);
    assert.ok(systemPrompt(feed, COACH, TODAY).includes('by_grade'));
  });

  test('ask lookups: boards match the site, athletes see the same boards plus their own place', () => {
    const site = leaderboardsView(feed, TODAY).tests.find((t) => t.test === '20min').season;
    const text = run(COACH, 'board', { test: '20min', period: 'season', school_year: null, group: 'all', limit: 3 });
    assert.ok(/20' board, 2026-27 season, all rowers\*, top 3/.test(text), text);
    site.slice(0, 3).forEach((r) => assert.ok(text.includes(`${r.rank}. ${r.name}`) && text.includes(r.meters.toLocaleString('en-US') + ' m'), r.name));
    assert.ok(!text.includes(site[3].name), 'top 3 only');
    // "top 4 20' tests this year, and the average split of the 4" (David, 2026-11-07).
    const top4 = run(COACH, 'board', { test: '20min', period: 'season', school_year: null, group: 'all', limit: 4 });
    const avgSplit = site.slice(0, 4).reduce((a, r) => a + 600000 / r.meters, 0) / 4;
    const m = top4.match(/Average of these 4: ([\d,]+) m, split (\d):(\d\d\.\d)/);
    assert.ok(m, top4);
    assert.strictEqual(Number(m[1].replace(',', '')), Math.round(site.slice(0, 4).reduce((a, r) => a + r.meters, 0) / 4));
    assert.ok(Math.abs(Number(m[2]) * 60 + Number(m[3]) - avgSplit) <= 0.05);
    const mine = run(ATHLETE, 'board', { test: '20min', period: 'season', school_year: null, group: 'all', limit: 3 });
    const myRank = site.find((r) => r.id === me.id).rank;
    assert.ok(mine.includes(`You: ${myRank} of ${site.length}`), mine);
    assert.ok(mine.includes(site[0].name), 'athletes see the named board, as on the site (David, 2026-11-07)');
  });

  test('ask lookups: an athlete never gets another athlete\'s details', () => {
    const refuse = /only show you your own numbers and team totals/;
    assert.ok(refuse.test(run(ATHLETE, 'athlete', { name: 'Harper Delgado' })));
    assert.ok(refuse.test(run(ATHLETE, 'athlete', { name: 'harper' })), 'first name too');
    assert.ok(refuse.test(run(ATHLETE, 'todays_plan', { name: 'Quinn Ashby', day: 'today' })));
    assert.ok(refuse.test(run(ATHLETE, 'test_pacing', { name: 'Quinn Ashby', test: '2000m' })));
    assert.ok(refuse.test(run(ATHLETE, 'not_logged', {})));
    assert.ok(refuse.test(run(ATHLETE, 'stars_ranking', {})));
    assert.ok(refuse.test(run(ATHLETE, 'question_log', {})));
    assert.ok(refuse.test(run(ATHLETE, 'athlete', { name: 'Nobody Atall' })), 'an unknown name says nothing about who exists');
    // Latest test day: her own result and place, the team average, no one else's name.
    const latest = run(ATHLETE, 'latest_test', { test: '20min', group: 'all' });
    const others = feed.athletes.filter((a) => a.id !== me.id).map((a) => a.name);
    assert.ok(others.every((n) => !latest.includes(n)), latest);
    assert.ok(/You: .* on your best, \d+ of \d+\./.test(latest) && /Team average/.test(latest), latest);
    // Her own summary is open to her, GMS included; never a weight.
    const own = run(ATHLETE, 'athlete', { name: null });
    assert.ok(own.startsWith('*Avery Callahan*') && /GMS this season/.test(own) && /Season stars/.test(own), own);
    assert.ok(!/weight|lb\b|kg\b|birthday/i.test(own));
  });

  test('ask lookups: coaches see everyone, latest test day ranked with change from her previous best', () => {
    const day = latestTestDay(feed, '20min', TODAY);
    assert.strictEqual(day, '2026-10-19');
    const text = run(COACH, 'latest_test', { test: '20min', group: 'all' });
    assert.ok(/Latest 20' test, Oct 19, all rowers\* \(26 rowers\)/.test(text), text.slice(0, 80));
    assert.ok(/\n1\. .*: [\d,]+ m \(\d:\d\d\.\d\), ([+−]\d+ m on her best|first test)/.test(text), text.slice(0, 200));
    assert.ok(/Average: /.test(text));
    // A single re-test after the test day doesn't become "the latest test".
    const f2 = { ...feed, benchmarks: [...feed.benchmarks, { ...feed.benchmarks.find((b) => b.test === '20min' && b.athleteId === me.id), id: 'B-FAKE-RETEST', date: '2026-10-21' }] };
    assert.strictEqual(latestTestDay(f2, '20min', TODAY), '2026-10-19');
    assert.ok(/^\*Harper Delgado\*/.test(run(COACH, 'athlete', { name: 'harper' })), 'first name is enough for a coach');
    assert.ok(/I can't find "Harpr Delgad"\. Did you mean Harper Delgado\?/.test(run(COACH, 'athlete', { name: 'Harpr Delgad' })));
    assert.ok(/Not logged yet this week|Everyone has logged/.test(run(COACH, 'not_logged', {})));
    assert.ok(/^\*Season stars\*\n1\. /.test(run(COACH, 'stars_ranking', {})));
  });

  test('ask lookups: best N this year vs last year, averages only, at least 4 rowers for athletes', () => {
    // Made-up 2025-26 results for 5 current rowers, one of them an alum now.
    const ids = feed.athletes.slice(12, 17).map((a) => a.id);
    const old = ids.map((id, i) => ({ id: 'B-FAKE-OLD-' + i, date: '2025-10-15', athleteId: id, test: '20min', timeS: null, meters: 4500 + 10 * i, avgRate: 24, valid: true, splits: [], gmsPct: null, stars: null }));
    const f2 = { ...feed, benchmarks: [...feed.benchmarks, ...old], athletes: feed.athletes.map((a) => (a.id === ids[0] ? { ...a, squad: 'Alum' } : a)) };
    const q = (asker, n) => runLookup(f2, asker, 'top_average', { test: '20min', n, school_years: [2026, 2025], group: 'all' }, TODAY).text;
    const text = q(ATHLETE, 4);
    assert.ok(/Average of the best 4 20' results, all rowers/.test(text));
    assert.ok(/2025-26: 4,525 m/.test(text), 'the best 4 of last year: 4540, 4530, 4520, 4510, the alum counted for her year: ' + text);
    assert.ok(/ahead of/.test(text));
    assert.ok(feed.athletes.every((a) => !text.includes(a.name)), 'no names');
    assert.ok(/groups of 4 or more/.test(q(ATHLETE, 3)), 'an athlete cannot average fewer than 4');
    assert.ok(/2025-26: [\d,]+ m/.test(q(COACH, 3)), 'coaches can');
    assert.ok(/2025-26: too few results|only 5 rowers/.test(q(ATHLETE, 8)), q(ATHLETE, 8));
    // A past school year's board keeps alumni, as they were on the team then.
    const past = runLookup(f2, COACH, 'board', { test: '20min', period: 'school_year', school_year: 2025, group: 'all', limit: null }, TODAY).text;
    const alum = f2.athletes.find((a) => a.id === ids[0]).name;
    assert.ok(/20' board, 2025-26/.test(past) && new RegExp(alum + '.*\\(alum\\)').test(past), past);
  });

  test('ask lookups: group averages hide groups under 4 rowers from athletes', () => {
    const groups = teamSplitsView(feed, TODAY).groups;
    const small = groups.find((g) => g.twoK.n > 0 && g.twoK.n < MIN_GROUP);
    const forAthlete = run(ATHLETE, 'group_averages', {});
    const forCoach = run(COACH, 'group_averages', {});
    assert.ok(/Top 8: 2k \d:\d\d\.\d \(8\)/.test(forAthlete), forAthlete);
    if (small) {
      assert.ok(new RegExp(`${small.label}: too few results`).test(forAthlete), forAthlete);
      assert.ok(!new RegExp(`${small.label}: too few results`).test(forCoach));
    }
  });

  test('ask lookups: pacing for today from her own targets; schedule questions get the link', () => {
    const today = run(ATHLETE, 'todays_plan', { name: null, day: 'today' });
    const target = feed.weeks.flatMap((w) => w.sessions).find((s) => s.day === TODAY && s.squad === me.squad).athletes.find((x) => x.athlete === me.name).targets[0].target;
    assert.ok(today.includes(`hold ${target}`), today);
    assert.ok(/No workout is posted for tomorrow yet/.test(run(ATHLETE, 'todays_plan', { name: null, day: 'tomorrow' })) || /hold/.test(run(ATHLETE, 'todays_plan', { name: null, day: 'tomorrow' })));
    const coachDay = run(COACH, 'todays_plan', { name: null, day: 'today' });
    assert.ok(/Varsity Practice/.test(coachDay) && !/hold/.test(coachDay), 'a coach without a name sees the workouts, no targets');
    // No 2k or 20' to base a target on: told to ask the coach.
    const fresh = { ...feed, weeks: feed.weeks.map((w) => ({ ...w, sessions: w.sessions.map((s) => ({ ...s, athletes: (s.athletes || []).filter((x) => x.athlete !== me.name) })) })) };
    assert.ok(/don't have a target yet.*Ask your coach/.test(runLookup(fresh, ATHLETE, 'todays_plan', { name: null, day: 'today' }, TODAY).text));
    assert.ok(/Your latest 2k \(Oct 22\)/.test(run(ATHLETE, 'test_pacing', { name: null, test: '2000m' })));
    assert.ok(run(ATHLETE, 'schedule_link', {}).includes(SCHEDULE_URL));
    assert.ok(/ask your coach/i.test(run(ATHLETE, 'cannot_answer', { reason: 'advice' })));
  });

  test('ask tools: strict schemas the model must fill in completely', () => {
    TOOLS.forEach((t) => {
      assert.strictEqual(t.strict, true, t.name);
      assert.strictEqual(t.input_schema.additionalProperties, false, t.name);
      assert.deepStrictEqual([...t.input_schema.required].sort(), Object.keys(t.input_schema.properties).sort(), t.name);
    });
    assert.strictEqual(cleanText('<@U0BOT> rankings  20\''), 'rankings 20\'');
    // Haiku 5.5: $0.10 in, $0.50 out per million. The plan's B1 estimate: 2,500 in, 300 out = $0.0004.
    assert.strictEqual(Math.round(costUsd('claude-haiku-5-5', { input_tokens: 2500, output_tokens: 300 }) * 1e6), 400);
    assert.ok(costUsd('mystery-model', { input_tokens: 1e6 }) >= 2, 'an unknown model is charged at the higher price');
    const sys = systemPrompt(feed, ATHLETE, TODAY);
    assert.ok(/school_year 2026/.test(sys) && /school_year 2025/.test(sys) && /other_athlete/.test(sys));
    assert.ok(/any athlete by name/.test(systemPrompt(feed, COACH, TODAY)));
  });

  // ---- the whole question, with a fake model, Sheet and Slack ----------------

  const env = (over = {}) => (k) => ({ SLACK_SIGNING_SECRET: 'fake-secret', SLACK_BOT_TOKEN: 'xoxb-FAKE', FEED_URL: 'https://script.example/exec', FEED_KEY: 'fake-key',
    ERGBOT_ANTHROPIC_API_KEY: 'fake-ask-key', SLACK_COACH_CHANNEL: 'CCOACH', ...over })[k];
  const world = ({ picks = [['board', { test: '20min', period: 'season', school_year: null, group: 'all', limit: 3 }]], usage = { input_tokens: 2500, output_tokens: 300 } } = {}) => {
    const calls = [], model = [], store = new Map(); let i = 0;
    const deps = { today: TODAY, feed,
      store: { get: async (k) => (store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null), set: async (k, v) => { store.set(k, JSON.parse(JSON.stringify(v))); }, delete: async (k) => { store.delete(k); } },
      client: { messages: { create: async (body) => {
        model.push(body);
        const p = picks[Math.min(i++, picks.length - 1)];
        return p ? { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: p[0], input: p[1] }], usage } : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'hmm' }], usage };
      } } },
      fetchImpl: async (url, init) => {
        const body = init && init.body ? JSON.parse(init.body) : null;
        calls.push({ url, body });
        if (url === 'https://script.example/exec') {
          if (body.slackUserId === 'UC1') return Response.json({ status: 'ok', role: 'coach' });
          if (body.slackUserId === 'UA1') return Response.json({ status: 'ok', role: 'athlete', athlete: 'Avery Callahan' });
          return Response.json({ status: 'not_allowed' });
        }
        return Response.json({ ok: true });
      } };
    const posts = () => calls.filter((c) => c.url === 'https://slack.com/api/chat.postMessage').map((c) => c.body);
    const sheetCalls = () => calls.filter((c) => c.url === 'https://script.example/exec').length;
    return { calls, model, store, deps, posts, sheetCalls };
  };
  const dm = (text, user = 'UC1') => ({ type: 'message', channel_type: 'im', user, text, ts: '100.1' });
  const mention = (text, channel = 'CCOACH', user = 'UC1') => ({ type: 'app_mention', channel, user, text: '<@U0BOT> ' + text, ts: '200.1' });

  test('ask: a coach DM is routed by the model, answered by the lookup, costed and logged', async () => {
    const w = world();
    const out = await handleQuestion(dm('give me the rankings of the latest 20\' test'), env(), w.deps);
    assert.strictEqual(out.status, 'answered');
    const [body] = w.model;
    assert.strictEqual(body.model, 'claude-haiku-5-5');
    assert.deepStrictEqual(body.output_config, { effort: 'low' });
    assert.strictEqual(body.tool_choice.type, 'auto');
    assert.ok(body.tools.every((t) => t.strict) && body.messages[0].content.includes('latest 20'));
    assert.ok(!('temperature' in body) && !('thinking' in body));
    const [reply] = w.posts();
    assert.strictEqual(reply.channel, 'UC1');
    assert.ok(/20' board, 2026-27 season/.test(reply.text) && /_Data as of \d+:\d\d [AP]M Oct 23\._$/.test(reply.text), reply.text);
    assert.ok(!/Coaches can read/.test(reply.text), 'the log note is for athletes');
    const spend = w.store.get('spend:2026-10');
    assert.strictEqual(spend.questions, 1);
    assert.ok(Math.abs(spend.usd - 0.0004) < 1e-9);
    assert.strictEqual(w.store.get('count:2026-10-23:UC1').n, 1);
    assert.strictEqual(w.store.get('log:2026-10')[0].tool, 'board');
    // The coach list is not asked again within the hour.
    const before = w.sheetCalls();
    await handleQuestion(dm('again'), env(), w.deps);
    assert.strictEqual(w.sheetCalls(), before);
  });

  test('ask: follow-ups within 30 minutes carry the last question; no tool picked = a fixed "didn\'t follow"', async () => {
    const w = world({ picks: [['board', { test: '20min', period: 'season', school_year: null, group: 'all', limit: null }], null] });
    await handleQuestion(dm('20 min rankings'), env(), w.deps);
    await handleQuestion(dm('and last year?'), env(), w.deps);
    assert.ok(/Earlier question .*"20 min rankings" - answered with board/.test(w.model[1].messages[0].content) && /New question: and last year\?/.test(w.model[1].messages[0].content));
    assert.ok(/I didn't follow that/.test(w.posts()[1].text) && !/Data as of/.test(w.posts()[1].text));
    w.store.set('last:UC1', { ...w.store.get('last:UC1'), at: Date.now() - 31 * 60000 });
    await handleQuestion(dm('something else'), env(), w.deps);
    assert.ok(!/Earlier question/.test(w.model[2].messages[0].content), 'older than 30 minutes is forgotten');
  });

  test('ask: athletes are off until switched on; then scoped by Slack ID, told about the log once', async () => {
    let w = world();
    let out = await handleQuestion(dm('my 2k', 'UA1'), env(), w.deps);
    assert.strictEqual(out.status, 'athletes_off');
    assert.strictEqual(w.model.length, 0, 'no model call');
    assert.ok(/open to coaches for now/.test(w.posts()[0].text));
    w = world({ picks: [['athlete', { name: 'Harper Delgado' }], ['athlete', { name: null }]] });
    const on = env({ ERGBOT_ATHLETE_QUESTIONS: 'on' });
    await handleQuestion(dm('how did Harper do?', 'UA1'), on, w.deps);
    assert.ok(/only show you your own numbers/.test(w.posts()[0].text) && /Coaches can read the questions/.test(w.posts()[0].text));
    assert.ok(/an athlete, Avery Callahan/.test(w.model[0].system));
    await handleQuestion(dm('my numbers', 'UA1'), on, w.deps);
    assert.ok(/^\*Avery Callahan\*/.test(w.posts()[1].text) && !/Coaches can read/.test(w.posts()[1].text), 'told once');
    out = await handleQuestion(dm('hi', 'UX9'), on, w.deps);
    assert.strictEqual(out.status, 'not_allowed');
  });

  test('ask: @ErgBot works in the coaches\' channel (a normal message, or in the thread it was asked in), anywhere else says ask in a DM', async () => {
    const w = world();
    await handleQuestion(mention('rankings 20\''), env(), w.deps, { channel: 'CCOACH' });
    const [reply] = w.posts();
    assert.strictEqual(reply.channel, 'CCOACH');
    assert.ok(!('thread_ts' in reply), 'a normal channel message, like a DM (David, 2026-11-07)');
    assert.ok(/20' board/.test(reply.text));
    assert.strictEqual(w.model[0].messages[0].content, 'rankings 20\'', 'the mention markup is gone');
    await handleQuestion({ ...mention('and varsity?'), thread_ts: '150.1' }, env(), w.deps, { channel: 'CCOACH' });
    assert.strictEqual(w.posts()[1].thread_ts, '150.1', 'asked inside a thread: answered there');
    const before = w.posts().length;
    const out = await handleQuestion(mention('rankings 20\'', 'CTEAM'), env(), w.deps, { channel: 'CTEAM' });
    assert.strictEqual(out.status, 'wrong_channel');
    assert.deepStrictEqual([w.posts()[before].channel, w.posts()[before].thread_ts, w.posts()[before].text], ['CTEAM', '200.1', 'Ask me in a DM.']);
    assert.strictEqual(w.model.length, 2, 'no model call for the wrong channel');
    // Athletes never get answers in a channel, even the coaches' one.
    assert.strictEqual((await handleQuestion(mention('x', 'CCOACH', 'UA1'), env({ ERGBOT_ATHLETE_QUESTIONS: 'on' }), w.deps, { channel: 'CCOACH' })).status, 'wrong_channel');
  });

  test('ask: 20 questions a person a day; the monthly cap pauses questions and warns coaches once at 80%', async () => {
    let w = world();
    w.store.set('count:2026-10-23:UC1', { n: DAILY_LIMIT });
    assert.strictEqual((await handleQuestion(dm('x'), env(), w.deps)).status, 'daily_limit');
    assert.strictEqual(w.model.length, 0);
    w = world();
    w.store.set('spend:2026-10', { usd: 10, questions: 999, warned: true });
    assert.strictEqual((await handleQuestion(dm('x'), env(), w.deps)).status, 'capped');
    assert.ok(/paused for this month/.test(w.posts()[0].text) && w.model.length === 0);
    // A cap set in Netlify wins over the $10 default.
    assert.strictEqual((await handleQuestion(dm('x'), env({ ERGBOT_MONTHLY_CAP_USD: '20' }), w.deps)).status, 'answered');
    w = world();
    w.store.set('spend:2026-10', { usd: 7.9998, questions: 10, warned: false });
    await handleQuestion(dm('x'), env(), w.deps);
    await handleQuestion(dm('y'), env(), w.deps);
    const warns = w.posts().filter((p) => p.channel === 'CCOACH');
    assert.strictEqual(warns.length, 1, 'one note');
    assert.ok(/\$8\.00 of the \$10 budget/.test(warns[0].text), warns[0].text);
    assert.strictEqual(w.store.get('spend:2026-10').warned, true);
  });

  test('ask: coaches can read the question log', async () => {
    const w = world({ picks: [['board', { test: '2000m', period: 'all_time', school_year: null, group: 'all', limit: 1 }], ['question_log', {}]] });
    await handleQuestion(dm('fastest 2k ever'), env(), w.deps);
    await handleQuestion(dm('what have people asked?'), env(), w.deps);
    assert.ok(/Latest questions/.test(w.posts()[1].text) && /"fastest 2k ever" \(board\)/.test(w.posts()[1].text), w.posts()[1].text);
  });

  test('ask: Slack routing, DM text with no photo waiting is a question, @mentions reach the background', async () => {
    const NOW = 1_800_000_000;
    const sign = (raw) => ({ 'x-slack-request-timestamp': String(NOW), 'x-slack-signature': 'v0=' + createHmac('sha256', 'fake-secret').update(`v0:${NOW}:${raw}`).digest('hex') });
    const bg = (obj) => { const raw = JSON.stringify(obj); return new Request('https://x/.netlify/functions/slack-background', { method: 'POST', body: raw, headers: sign(raw) }); };
    const w = world();
    const deps = { ...w.deps, nowS: NOW, ask: w.deps };
    let out = await handleSlackAction(bg({ type: 'event_callback', event: dm('rankings 20\'') }), env(), deps);
    assert.strictEqual(out.status, 'answered');
    // A photo waiting for "which athlete?" takes the text first (David, 2026-11-07).
    w.store.set('pending:UC1', { at: Date.now(), summary: '2000m', pieces: [{ timeS: 480, meters: 2000 }], machine: 'RowErg' });
    out = await handleSlackAction(bg({ type: 'event_callback', event: dm('Olivia Fake') }), env(), { ...deps, athleteNames: async () => ['Avery Callahan'] });
    assert.notStrictEqual(out.status, 'answered');
    assert.strictEqual(w.model.length, 1, 'the name went to the photo flow, not the model');
    out = await handleSlackAction(bg({ type: 'event_callback', event: mention('rankings 20\'') }), env(), deps);
    assert.strictEqual(out.status, 'answered');
    // The front door forwards an @mention once.
    const front = (obj) => { const raw = JSON.stringify(obj); return new Request('https://site.example/api/slack', { method: 'POST', body: raw, headers: { 'content-type': 'application/json', ...sign(raw) } }); };
    const fwd = [];
    const res = await handleSlack(front({ type: 'event_callback', event: mention('hi') }), env(), { nowS: NOW, fetchImpl: async (url) => { fwd.push(url); return new Response('', { status: 202 }); } });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(fwd, ['https://site.example/.netlify/functions/slack-background']);
  });
}
