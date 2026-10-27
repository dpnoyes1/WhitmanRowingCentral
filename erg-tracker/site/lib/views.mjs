// Shapes the feed into what each page shows. Everything returned here goes to
// a browser behind the team password, so it must never carry weight or
// birthdays (the feed has neither) and GMS % only on an athlete's own page.

import {
  addDays, weekStart, schoolYearStart, rawMinutes, weightedMinutes, bucket, practiceRecord,
  practiceStreak, openMakeups, weekMinutes, oyoStatus, oyoWeekStreak, zoneMinutes, personalBests,
  resultValue, better, boardGroup, schoolYearLabel, TESTS, loadTrend, steadySplits, splitTrend, projected2k, monthConsistency, LOAD_JUMP_PCT, oyoGoals, isBreakWeek, meterTotal,
  balanceGap, ruleSplits, wattsFromSplit, BALANCE_WINDOW_DAYS, BALANCE_HALF_LIFE_DAYS, BALANCE_WEAK_WEIGHT
} from './stats.mjs';

const WEEKS_SHOWN = 8;
const ZONE_WEEKS = 4;
const round = (x, p = 0) => (x === null || x === undefined ? null : Math.round(x * 10 ** p) / 10 ** p);

/** Alum is an explicit squad; alumni show only on the All Time boards (David, 2026-10-27). */
export const isAlum = (a) => /^alum$/i.test(a.squad || '');

export function activeRowers(feed) {
  return feed.athletes.filter((a) => a.active && a.role === 'Rower' && !isAlum(a));
}

function pct(done, of) {
  return of ? round((100 * done) / of) : null;
}

function athleteSummary(a) {
  return { id: a.id, name: a.name, squad: a.squad, grade: a.grade };
}

/** Team dashboard, for All / Varsity / Novice. Averages and totals, no individual misses. */
export function teamView(feed, today) {
  const monday = weekStart(today);
  const yearStart = schoolYearStart(today, feed.settings.schoolYearStart);
  const rowers = activeRowers(feed);
  const starsOf = (id) => seasonStars(feed, id, yearStart, today).stars;
  const weeks = Array.from({ length: WEEKS_SHOWN }, (_, i) => addDays(monday, -7 * (WEEKS_SHOWN - 1 - i)));
  const byWeek = Object.fromEntries(weeks.map((w) => [w, weekMinutes(feed.entries, feed.settings, w)]));
  const zoneFrom = addDays(monday, -7 * (ZONE_WEEKS - 1));

  const group = (members) => {
    const ids = new Set(members.map((a) => a.id));
    let weekDone = 0, weekExpected = 0, seasonDone = 0, seasonExpected = 0;
    members.forEach((a) => {
      practiceRecord(a, feed, today).forEach((r) => {
        if (r.date >= yearStart) { seasonExpected++; if (r.done) seasonDone++; }
        if (r.date >= monday) { weekExpected++; if (r.done) weekDone++; }
      });
    });
    const thisWeek = byWeek[monday];
    let practiceMin = 0, oyoMin = 0, met = 0, elite = 0, anyOyo = 0;
    members.forEach((a) => {
      const w = thisWeek[a.id] || { practice: 0, oyo: 0 };
      practiceMin += w.practice;
      oyoMin += w.oyo;
      if (w.oyo > 0) anyOyo++;
      const s = oyoStatus(w.oyo, oyoGoals(a, monday, feed.settings));
      if (s !== 'short') met++;
      if (s === 'elite') elite++;
    });
    const n = members.length || 1;
    return {
      rowers: members.length,
      week: {
        completionPct: pct(weekDone, weekExpected), practicesDone: weekDone, practicesExpected: weekExpected,
        trainingMin: round(practiceMin + oyoMin), oyoMin: round(oyoMin), avgPerRower: round((practiceMin + oyoMin) / n),
        oyoLogged: anyOyo, oyoMetRequired: met, oyoElite: elite
      },
      season: { completionPct: pct(seasonDone, seasonExpected) },
      weekly: weeks.map((w) => {
        let p = 0, o = 0;
        Object.entries(byWeek[w]).forEach(([id, t]) => { if (ids.has(id)) { p += t.practice; o += t.oyo; } });
        return { weekStart: w, practiceAvg: round(p / n, 1), oyoAvg: round(o / n, 1) };
      }),
      zones: roundZones(zoneMinutes(feed.entries.filter((e) => ids.has(e.athleteId)), zoneFrom, today))
    };
  };

  const recent = feed.entries
    .filter((e) => e.status !== 'Out' && e.date <= today && rowers.some((a) => a.id === e.athleteId))
    .sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1))
    .slice(0, 12)
    .map((e) => ({ ...sessionRow(e, feed.settings), athleteId: e.athleteId }));

  return {
    today, weekStart: monday, zonesFrom: zoneFrom,
    athletes: rowers.map((a) => ({ ...athleteSummary(a), stars: starsOf(a.id) })).sort((a, b) => a.name.localeCompare(b.name)),
    groups: {
      all: group(rowers),
      varsity: group(rowers.filter((a) => /^varsity$/i.test(a.squad))),
      novice: group(rowers.filter((a) => /^novice$/i.test(a.squad)))
    },
    recent
  };
}

function roundZones(z) {
  return Object.fromEntries(Object.entries(z).map(([k, v]) => [k, round(v)]));
}

function sessionRow(e, settings) {
  return {
    id: e.id, date: e.date, type: e.type, status: e.status, activity: e.activity, mainSet: e.mainSet, zone: e.zone,
    makeupFor: e.makeupFor || '', minutes: round(rawMinutes(e)), weighted: round(weightedMinutes(e, settings)),
    meters: meterTotal(e) ? round(meterTotal(e)) : null, rpe: e.rpe, test: !!e.benchmarkId
  };
}

/** One athlete's page. Returns null for an unknown ID. */
export function athleteView(feed, id, today) {
  const a = feed.athletes.find((x) => x.id === id);
  if (!a) return null;
  const monday = weekStart(today);
  const yearStart = schoolYearStart(today, feed.settings.schoolYearStart);
  const mine = feed.entries.filter((e) => e.athleteId === id);
  const record = practiceRecord(a, feed, today);
  const season = record.filter((r) => r.date >= yearStart);
  const week = record.filter((r) => r.date >= monday);
  const thisWeek = weekMinutes(mine, feed.settings, monday)[id] || { practice: 0, oyo: 0, total: 0 };
  const goals = oyoGoals(a, monday, feed.settings);

  let seasonMin = 0, seasonMeters = 0;
  mine.forEach((e) => {
    if (e.date < yearStart || e.date > today) return;
    seasonMin += weightedMinutes(e, feed.settings);
    seasonMeters += meterTotal(e);
  });

  const weeks = Array.from({ length: WEEKS_SHOWN }, (_, i) => addDays(monday, -7 * (WEEKS_SHOWN - 1 - i)));
  const pbs = personalBests(id, feed.benchmarks, yearStart);
  const tests = feed.benchmarks.filter((b) => b.athleteId === id)
    .sort((x, y) => (x.date < y.date ? 1 : -1))
    .map(testRow);

  return {
    today, weekStart: monday, yearStart,
    athlete: { ...athleteSummary(a), active: a.active, oyoRequired: goals.oyoRequired, oyoElite: goals.oyoElite, breakWeek: goals.breakWeek },
    week: {
      practicesDone: week.filter((r) => r.done).length, practicesExpected: week.length,
      practiceMin: round(thisWeek.practice), oyoMin: round(thisWeek.oyo), oyoStatus: oyoStatus(thisWeek.oyo, goals)
    },
    season: {
      practicesDone: season.filter((r) => r.done).length, practicesExpected: season.length,
      completionPct: pct(season.filter((r) => r.done).length, season.length),
      trainingMin: round(seasonMin), meters: round(seasonMeters),
      makeupsDone: season.filter((r) => r.how === 'Make-up').length
    },
    streaks: { practices: practiceStreak(record), oyoWeeks: oyoWeekStreak(a, feed, today) },
    openMakeups: openMakeups(record, today, feed.settings.makeupWindowDays).map((m) => ({ ...m, sessions: dayPlan(feed, m.date, a) })),
    recentPractices: record.slice(-10).reverse(),
    weekly: weeks.map((w) => {
      const t = weekMinutes(mine, feed.settings, w)[id] || { practice: 0, oyo: 0 };
      return { weekStart: w, practice: round(t.practice, 1), oyo: round(t.oyo, 1) };
    }),
    zones: roundZones(zoneMinutes(mine, addDays(monday, -7 * (ZONE_WEEKS - 1)), today)),
    bests: TESTS.filter((t) => pbs[t]).map((t) => ({
      test: t, count: pbs[t].count,
      season: pbs[t].season && testRow(pbs[t].season), allTime: testRow(pbs[t].allTime)
    })),
    tests,
    gms: athleteGms(feed, id, today),
    insights: athleteInsights(feed, a, mine, record, weeks, yearStart, today),   // her own page and coaches only (api.mjs)
    todayPlan: (weekView(feed, today, id, { results: 'own' }).days.find((d) => d.day === today) || { sessions: [] }).sessions,   // her own page and coaches only (api.mjs strips it for anyone else)
    sessions: mine.filter((e) => e.date <= today)
      .sort((x, y) => (x.date === y.date ? (x.id < y.id ? 1 : -1) : x.date < y.date ? 1 : -1))
      .slice(0, 30)
      .map((e) => sessionRow(e, feed.settings)),
    // Every workout she has logged, for "My workouts" (api.mjs sends it to her and coaches only).
    workouts: mine.filter((e) => e.date <= today && e.status !== 'Out')
      .sort((x, y) => (x.date === y.date ? (x.id < y.id ? 1 : -1) : x.date < y.date ? 1 : -1))
      .map((e) => sessionRow(e, feed.settings))
  };
}

/**
 * One logged workout for "My workouts" click-in. Totals always; splits against
 * targets only for the current school year (feed.logged). null for an unknown ID.
 */
export function workoutView(feed, id, today) {
  const e = feed.entries.find((x) => x.id === id);
  if (!e) return null;
  const a = feed.athletes.find((x) => x.id === e.athleteId);
  return {
    today,
    athlete: a ? athleteSummary(a) : null,
    workout: sessionRow(e, feed.settings),
    detail: (feed.logged || []).find((x) => x.id === id) || null
  };
}

// ---- load, effort, progress and consistency (David, 2026-10-23) ---------------

function loadRow(w) {
  return { weekStart: w.weekStart, total: round(w.total, 1), rpe: round(w.rpe, 1), sessions: w.sessions,
    trailing: round(w.trailing, 1), trailingWeeks: w.trailingWeeks, changePct: round(w.changePct), flag: w.flag };
}

function trendRow(t) {
  return t && { changeS: round(t.changeS, 1), recentS: round(t.recentS, 1), earlierS: round(t.earlierS, 1), weeksEach: t.weeksEach };
}

/**
 * Private insights for her own page and coaches: weekly load with RPE and the
 * jump flag (api.mjs keeps the flag for coaches), steady-state split by week,
 * 2k and 20' this school year with the change from the one before, a projected
 * 2k from a newer 20', and this month's consistency.
 */
function athleteInsights(feed, a, mine, record, weeks, yearStart, today) {
  const steady = steadySplits(mine, weeks);
  const progress = {};
  ['2000m', '20min'].forEach((t) => {
    let prev = null;
    progress[t] = feed.benchmarks
      .filter((b) => b.athleteId === a.id && b.test === t && b.valid && b.date >= yearStart && resultValue(b))
      .sort((x, y) => (x.date < y.date ? -1 : 1))
      .map((b) => {
        const row = { ...testRow(b), change: prev === null ? null : round(resultValue(b) - prev, 1) };
        prev = resultValue(b);
        return row;
      });
  });
  const proj = projected2k(a.id, feed.benchmarks, yearStart);
  return {
    jumpPct: feed.settings.loadJumpPct ?? LOAD_JUMP_PCT,
    load: loadTrend(mine, feed.settings, weeks).map(loadRow),
    steady: steady.map((w) => ({ weekStart: w.weekStart, splitS: round(w.splitS, 1), meters: round(w.meters) })),
    splitTrend: trendRow(splitTrend(steady)),
    progress,
    projected2k: proj && { ...proj, timeS: round(proj.timeS, 1) },
    month: { ...monthConsistency(record, today), streak: practiceStreak(record) }
  };
}

/**
 * Coaches' table, one row per active rower: load this week so far and last
 * week against the trailing average, RPE, steady-split trend, projected 2k and
 * this month's consistency. Flagged rowers first.
 */
export function insightsView(feed, today) {
  const monday = weekStart(today);
  const last = addDays(monday, -7);
  const yearStart = schoolYearStart(today, feed.settings.schoolYearStart);
  const splitWeeks = Array.from({ length: WEEKS_SHOWN }, (_, i) => addDays(monday, -7 * (WEEKS_SHOWN - 1 - i)));
  const rows = activeRowers(feed).map((a) => {
    const mine = feed.entries.filter((e) => e.athleteId === a.id);
    const [prev, cur] = loadTrend(mine, feed.settings, [last, monday]).map(loadRow);
    const record = practiceRecord(a, feed, today);
    const proj = projected2k(a.id, feed.benchmarks, yearStart);
    return {
      ...athleteSummary(a), lastWeek: prev, thisWeek: cur,
      splitTrend: trendRow(splitTrend(steadySplits(mine, splitWeeks))),
      projected2k: proj && round(proj.timeS, 1),
      month: { ...monthConsistency(record, today), streak: practiceStreak(record) }
    };
  });
  rows.sort((x, y) => (Number(y.thisWeek.flag || y.lastWeek.flag) - Number(x.thisWeek.flag || x.lastWeek.flag)) || x.name.localeCompare(y.name));
  return { today, weekStart: monday, lastWeekStart: last, jumpPct: feed.settings.loadJumpPct ?? LOAD_JUMP_PCT, rowers: rows };
}

function testRow(b) {
  return { date: b.date, test: b.test, timeS: b.timeS, meters: b.meters, avgRate: b.avgRate, valid: b.valid, result: resultValue(b) };
}

// ---- layer 2: leaderboards, stars, OYO board, GMS ---------------------------

const STAR_TESTS = ['2000m', '20min'];

/**
 * One board per test: best valid raw result per athlete, ranked, for this
 * school year and all time, for All pieces and for Freshman (7th-9th grade when
 * the piece was done) and Varsity (10th-12th) separately, so a freshman record
 * stays frozen after she moves up (David, 2026-10-25). Grade comes from Grad
 * year and the piece's date. All time keeps inactive and graduated athletes.
 * Raw erg scores only; no GMS on boards.
 */
export function leaderboardsView(feed, today) {
  const st = feed.settings.schoolYearStart;
  const yearStart = schoolYearStart(today, st);
  const byId = Object.fromEntries(feed.athletes.filter((a) => a.role === 'Rower').map((a) => [a.id, a]));
  const starCache = {};
  const stars = (id) => (id in starCache ? starCache[id] : (starCache[id] = seasonStars(feed, id, yearStart, today).stars));
  // group: null = all pieces; 'freshman' / 'varsity' = pieces done in those grades.
  const all = '0000-00-00';
  const board = (test, from, group) => {
    const best = {};
    feed.benchmarks.forEach((b) => {
      const a = byId[b.athleteId];
      if (!a || b.test !== test || !b.valid || !resultValue(b) || b.date < from || b.date > today) return;
      if (isAlum(a) && from !== all) return;   // Alum: All Time boards only (All, Varsity, Fr/Nov)
      if (group && boardGroup(a.gradYear, b.date, st) !== group) return;
      if (!best[a.id] || better(test, b, best[a.id])) best[a.id] = b;
    });
    return Object.values(best)
      .sort((x, y) => (better(test, x, y) ? -1 : better(test, y, x) ? 1 : x.date < y.date ? -1 : 1))
      .map((b, i) => {
        const a = byId[b.athleteId];
        return {
          rank: i + 1, ...athleteSummary(a), active: a.active, alum: isAlum(a) || a.grade === 'Graduated', stars: stars(a.id), ...testRow(b),
          dateApprox: !!b.dateApprox, schoolYear: schoolYearLabel(b.date, st), group: boardGroup(a.gradYear, b.date, st)
        };
      });
  };
  return {
    today, yearStart,
    tests: TESTS.map((t) => ({
      test: t, season: board(t, yearStart, null), allTime: board(t, all, null),
      freshman: { season: board(t, yearStart, 'freshman'), allTime: board(t, all, 'freshman') },
      varsity: { season: board(t, yearStart, 'varsity'), allTime: board(t, all, 'varsity') }
    }))
  };
}

// ---- coach split averages (David, 2026-10-25) --------------------------------

const SPLIT_GROUPS = [
  { key: 'top8', label: 'Top 8' },
  { key: 'second8', label: 'Second 8' },
  { key: 'top16', label: 'Top 16' },
  { key: 'varsity', label: 'Varsity' },
  { key: 'freshman', label: 'Freshman' },
  { key: 'all', label: 'All' }
];

/**
 * A result as seconds per 500m. 2k: time / 4. 20': its 2k-equivalent split
 * (20' split minus 8.5 s, as in GMS and twoKFrom20), so both tests compare.
 */
function splitOf(b) {
  const v = resultValue(b);
  if (!v) return null;
  if (b.test === '2000m') return v / 4;
  if (b.test === '20min') return (1200 * 500) / v - 8.5;
  return null;
}

/**
 * Coaches only. Each rower's season-best split (2k or 20'), ranked fastest
 * first (team-wide, all rowers), then the average split of each group. Every
 * average is shown, however few rowers it has. Freshman = the 9th-grade
 * class, as the feed works it out from Grad year.
 */
export function teamSplitsView(feed, today) {
  const yearStart = schoolYearStart(today, feed.settings.schoolYearStart);
  const rowers = activeRowers(feed);
  const best = {};
  feed.benchmarks.forEach((b) => {
    if (!STAR_TESTS.includes(b.test) || !b.valid || b.date < yearStart || b.date > today) return;
    const s = splitOf(b);
    if (s === null || !(s > 0)) return;
    if (!(b.athleteId in best) || s < best[b.athleteId]) best[b.athleteId] = s;
  });
  const rank = {};
  rowers.filter((a) => a.id in best)
    .sort((x, y) => best[x.id] - best[y.id])
    .forEach((a, i) => { rank[a.id] = i + 1; });

  const inGroup = {
    top8: (a) => rank[a.id] <= 8,
    second8: (a) => rank[a.id] >= 9 && rank[a.id] <= 16,
    top16: (a) => rank[a.id] <= 16,
    varsity: (a) => /^varsity$/i.test(a.squad),
    freshman: (a) => a.grade === '9th',
    all: () => true
  };
  const groups = SPLIT_GROUPS.map(({ key, label }) => {
    const members = rowers.filter(inGroup[key]);
    const splits = members.filter((a) => a.id in best).map((a) => best[a.id]);
    const avg = splits.length ? splits.reduce((x, y) => x + y, 0) / splits.length : null;
    return { key, label, avgSplit: round(avg, 1), n: splits.length, rowers: members.length };
  });
  return { today, yearStart, groups };
}

/** Best result by GMS % this season for one athlete and test, or null. */
function bestGms(feed, id, test, yearStart, today) {
  let best = null;
  feed.benchmarks.forEach((b) => {
    if (b.athleteId !== id || b.test !== test || b.gmsPct === null || b.date < yearStart || b.date > today) return;
    if (!best || b.gmsPct > best.gmsPct) best = b;
  });
  return best;
}

/**
 * Stars this season: the average of her 2k and 20' stars, so halves are
 * possible (David, 2026-10-23). One test only: that test's stars. None: null.
 */
export function seasonStars(feed, id, yearStart, today) {
  const byTest = {};
  STAR_TESTS.forEach((t) => {
    const b = bestGms(feed, id, t, yearStart, today);
    byTest[t] = b ? b.stars : null;
  });
  const have = Object.values(byTest).filter((s) => s !== null);
  const stars = have.length ? Math.round((2 * have.reduce((x, y) => x + y, 0)) / have.length) / 2 : null;
  return { stars, byTest };
}

/** Public stars board (stars only, never GMS %) plus team GMS averages. */
export function starsView(feed, today) {
  const yearStart = schoolYearStart(today, feed.settings.schoolYearStart);
  const rowers = activeRowers(feed).map((a) => ({ ...athleteSummary(a), ...seasonStars(feed, a.id, yearStart, today) })).sort((x, y) => (y.stars ?? -1) - (x.stars ?? -1) || x.name.localeCompare(y.name));
  return { today, yearStart, rowers, teamGms: feed.teamGms };
}

/** Public OYO board: this week's and last week's weighted OYO minutes vs each goal. */
export function oyoView(feed, today) {
  const monday = weekStart(today);
  const lastMonday = addDays(monday, -7);
  const thisWeek = weekMinutes(feed.entries, feed.settings, monday);
  const lastWeek = weekMinutes(feed.entries, feed.settings, lastMonday);
  const rowers = activeRowers(feed).map((a) => {
    const now = (thisWeek[a.id] || { oyo: 0 }).oyo, before = (lastWeek[a.id] || { oyo: 0 }).oyo;
    const g = oyoGoals(a, monday, feed.settings), lg = oyoGoals(a, lastMonday, feed.settings);
    return {
      ...athleteSummary(a), required: g.oyoRequired, elite: g.oyoElite,
      minutes: round(now), status: oyoStatus(now, g),
      lastWeek: { minutes: round(before), status: oyoStatus(before, lg), required: lg.oyoRequired, elite: lg.oyoElite },
      streak: oyoWeekStreak(a, feed, today)
    };
  }).sort((x, y) => y.minutes / y.required - x.minutes / x.required || x.name.localeCompare(y.name));
  return { today, weekStart: monday, lastWeekStart: lastMonday, breakWeek: isBreakWeek(monday, feed.settings), lastBreakWeek: isBreakWeek(lastMonday, feed.settings), rowers };
}

/**
 * GMS for one athlete's own page: best GMS % this season per test, stars,
 * and the next star as time or meters only (never weight).
 */
export function athleteGms(feed, id, today) {
  const yearStart = schoolYearStart(today, feed.settings.schoolYearStart);
  return ['2000m', '20min', '500m', '100m'].map((t) => {
    const b = bestGms(feed, id, t, yearStart, today);
    if (!b) return null;
    return { test: t, date: b.date, result: resultValue(b), timeS: b.timeS, meters: b.meters,
      gmsPct: b.gmsPct, stars: STAR_TESTS.includes(t) ? b.stars : null, nextStar: b.nextStar };
  }).filter(Boolean);
}

// ---- layer 3: the week ahead ----------------------------------------------

/**
 * Monday of the week athletes see: this week Monday to Saturday, and next
 * week from Sunday on (David, 2026-10-23: show only the coming week).
 */
export function comingMonday(today) {
  const dow = new Date(today + 'T00:00:00Z').getUTCDay();
  return dow === 0 ? addDays(today, 1) : weekStart(today);
}

/**
 * One logged result shaped for the page: her splits grouped under each planned
 * piece (a piece with reps gets that many splits), each marked in / below /
 * above her target range. Splits are RowErg /500m; other machines have none.
 */
function resultView(r, pieces) {
  let at = 0;
  return {
    date: r.date, type: r.type, status: r.status, activity: r.activity, test: !!r.test, matches: r.matches, reason: r.reason, hit: r.hit,
    pieces: pieces.map((p) => {
      const ivs = r.intervals.slice(at, at + (p.reps || 1));
      at += p.reps || 1;
      return ivs.map((iv) => ({ splitS: iv.splitS, status: iv.status }));
    }),
    extra: r.intervals.slice(at).map((iv) => ({ splitS: iv.splitS, status: iv.status }))
  };
}

/**
 * A week's published plan, Monday to Saturday: the coming week, or with
 * opts.offset = -1 the one before (coaches look back). With an athlete id,
 * only her squad's sessions and only her own targets (David, 2026-10-23);
 * without one, every session and no targets.
 * opts.results: 'own' adds her result to each session (or missed: true once
 * the day has passed); 'all' adds every rower in the session's squad with
 * her result or null (coaches only); 'none' adds nothing.
 */
export function weekView(feed, today, id = null, opts = {}) {
  const a = id ? feed.athletes.find((x) => x.id === id) : null;
  if (id && !a) return null;
  const results = opts.results || 'none';
  const monday = addDays(comingMonday(today), 7 * (opts.offset || 0));
  const plan = (feed.weeks || []).find((w) => w.weekStart === monday) || { sessions: [] };
  const rowers = activeRowers(feed).sort((x, y) => x.name.localeCompare(y.name));
  let pieces = 0, targeted = 0;
  const days = Array.from({ length: 6 }, (_, i) => addDays(monday, i)).map((day) => ({
    day,
    sessions: plan.sessions.filter((s) => s.day === day && (!a || inSquad(s, a.squad))).map((s) => {
      const out = planSession(s, a);
      if (a) { pieces += out.pieces.length; targeted += out.pieces.filter((p) => p.target).length; }
      const of = (athleteId) => {
        const r = (s.results || []).filter((x) => x.athleteId === athleteId).pop();
        return r ? resultView(r, s.pieces) : null;
      };
      // An older feed has no results yet: say nothing rather than "Not logged".
      if (!Array.isArray(s.results)) return out;
      if (results === 'own' && a) {
        out.result = of(a.id);
        out.missed = !out.result && day < today;
      }
      if (results === 'all') {
        out.results = rowers.filter((r) => inSquad(s, r.squad)).map((r) => {
          const t = (s.athletes || []).find((x) => x.athlete === r.name);
          return { ...athleteSummary(r), result: of(r.id), targets: t ? t.targets.map((x) => x.target || null) : [] };
        });
      }
      return out;
    })
  }));
  return {
    today, weekStart: monday, weekEnd: addDays(monday, 5), offset: opts.offset || 0,
    athlete: a ? athleteSummary(a) : null,
    days,
    // No 2k or 20' to base targets on: she sees a note; coaches see it as a FLAG row in the Sheet's plan report.
    noTargets: !!a && pieces > 0 && targeted === 0
  };
}

const inSquad = (s, squad) => !/^(varsity|novice)$/i.test(s.squad) || s.squad.toLowerCase() === squad.toLowerCase();

/** One published session as the athlete sees it: her target per piece (null without an athlete). */
function planSession(s, a) {
  const mine = a && (s.athletes || []).find((x) => x.athlete === a.name);
  return {
    session: s.session, squad: s.squad, workout: s.workout, notes: s.notes || '',
    pieces: s.pieces.map((p, i) => {
      const t = mine && (mine.targets[i] && mine.targets[i].piece === p.label ? mine.targets[i] : mine.targets.find((x) => x.piece === p.label));
      return { label: p.label, notes: p.notes || '', target: a ? (t && t.target) || null : undefined };
    })
  };
}

/** The workouts published for one past day, in her squad, with her targets. Make-ups use the missed day's plan. */
export function dayPlan(feed, day, a) {
  const plan = (feed.weeks || []).find((w) => w.weekStart === weekStart(day)) || { sessions: [] };
  return plan.sessions.filter((s) => s.day === day && inSquad(s, a.squad)).map((s) => planSession(s, a));
}

// ---- balance: 100m vs 2k vs 20' in watts, coaches only (David, 2026-10-27) --------

/**
 * Per rower, the 100m vs 2k and 2k vs 20' watts ratios from her last 12 months:
 * the best-weighted pair (results close in time count more) and the weighted
 * average of all her pairs, beside what Paul's Law and the tracker's own rules
 * (8.5 s, 0.786) would have predicted from that pair's 2k. No labels or ranges:
 * the point is to compare the rules with Whitman's results and fit our own model.
 * Never sent to athletes.
 */
export function balanceView(feed, today) {
  const ratioPct = (x) => round(100 * x, 1);
  const wattsOfSplit = (s) => wattsFromSplit(s);
  const gapRow = (g, predicted) => {
    if (!g) return null;
    const { best } = g;
    const twoK = best.hi.test === '2000m' ? best.hi : best.lo;
    const split2k = twoK.timeS / 4;
    const rules = Object.fromEntries(Object.entries(predicted(ruleSplits(split2k))).map(([k, s]) => [k, {
      splitS: round(s, 1), ratioPct: ratioPct(best.hi.test === '2000m' ? wattsOfSplit(split2k) / wattsOfSplit(s) : wattsOfSplit(s) / wattsOfSplit(split2k))
    }]));
    return {
      ratioPct: ratioPct(best.ratio), wattsHi: round(best.wattsHi, 0), wattsLo: round(best.wattsLo, 0),
      hiDate: best.hi.date, loDate: best.lo.date, daysApart: best.days, recency: round(best.weight, 2), weak: g.weak,
      avgRatioPct: ratioPct(g.avgRatio), pairs: g.pairs, rules
    };
  };
  const rows = activeRowers(feed).map((a) => ({
    ...athleteSummary(a),
    sprint: gapRow(balanceGap(a.id, feed.benchmarks, today, '100m', '2000m'), (r) => ({ paul: r.paul100, tracker: r.rule100 })),
    endurance: gapRow(balanceGap(a.id, feed.benchmarks, today, '2000m', '20min'), (r) => ({ paul: r.paul20, tracker: r.rule20 }))
  })).sort((x, y) => x.name.localeCompare(y.name));
  const mean = (list) => (list.length ? round(list.reduce((s, v) => s + v, 0) / list.length, 1) : null);
  const summary = (key) => {
    const g = rows.map((r) => r[key]).filter(Boolean);
    return { rowers: g.length, ratioPct: mean(g.map((x) => x.ratioPct)), paulPct: mean(g.map((x) => x.rules.paul.ratioPct)), trackerPct: mean(g.map((x) => x.rules.tracker.ratioPct)) };
  };
  return { today, windowDays: BALANCE_WINDOW_DAYS, halfLifeDays: BALANCE_HALF_LIFE_DAYS, weakBelow: BALANCE_WEAK_WEIGHT, rowers: rows, sprint: summary('sprint'), endurance: summary('endurance') };
}
