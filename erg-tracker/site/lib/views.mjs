// Shapes the feed into what each page shows. Everything returned here goes to
// a browser behind the team password, so it must never carry weight or
// birthdays (the feed has neither) and GMS % only on an athlete's own page.

import {
  addDays, weekStart, schoolYearStart, rawMinutes, weightedMinutes, bucket, practiceRecord,
  practiceStreak, openMakeups, weekMinutes, oyoStatus, oyoWeekStreak, zoneMinutes, personalBests,
  resultValue, better, TESTS
} from './stats.mjs';

const WEEKS_SHOWN = 8;
const ZONE_WEEKS = 4;
const round = (x, p = 0) => (x === null || x === undefined ? null : Math.round(x * 10 ** p) / 10 ** p);

export function activeRowers(feed) {
  return feed.athletes.filter((a) => a.active && a.role === 'Rower');
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
      const s = oyoStatus(w.oyo, a);
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
    date: e.date, type: e.type, status: e.status, activity: e.activity, mainSet: e.mainSet, zone: e.zone,
    makeupFor: e.makeupFor || '', minutes: round(rawMinutes(e)), weighted: round(weightedMinutes(e, settings)),
    meters: e.workM || e.restM ? round((e.workM || 0) + (e.restM || 0)) : null, rpe: e.rpe, test: !!e.benchmarkId
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

  let seasonMin = 0, seasonMeters = 0;
  mine.forEach((e) => {
    if (e.date < yearStart || e.date > today) return;
    seasonMin += weightedMinutes(e, feed.settings);
    seasonMeters += (e.workM || 0) + (e.restM || 0);
  });

  const weeks = Array.from({ length: WEEKS_SHOWN }, (_, i) => addDays(monday, -7 * (WEEKS_SHOWN - 1 - i)));
  const pbs = personalBests(id, feed.benchmarks, yearStart);
  const tests = feed.benchmarks.filter((b) => b.athleteId === id)
    .sort((x, y) => (x.date < y.date ? 1 : -1))
    .map(testRow);

  return {
    today, weekStart: monday, yearStart,
    athlete: { ...athleteSummary(a), active: a.active, oyoGroup: a.oyoGroup, oyoRequired: a.oyoRequired, oyoElite: a.oyoElite },
    week: {
      practicesDone: week.filter((r) => r.done).length, practicesExpected: week.length,
      practiceMin: round(thisWeek.practice), oyoMin: round(thisWeek.oyo), oyoStatus: oyoStatus(thisWeek.oyo, a)
    },
    season: {
      practicesDone: season.filter((r) => r.done).length, practicesExpected: season.length,
      completionPct: pct(season.filter((r) => r.done).length, season.length),
      trainingMin: round(seasonMin), meters: round(seasonMeters),
      makeupsDone: season.filter((r) => r.how === 'Make-up').length
    },
    streaks: { practices: practiceStreak(record), oyoWeeks: oyoWeekStreak(a, feed, today) },
    openMakeups: openMakeups(record, today, feed.settings.makeupWindowDays),
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
    todayPlan: (weekView(feed, today, id, { results: 'own' }).days.find((d) => d.day === today) || { sessions: [] }).sessions,   // her own page and coaches only (api.mjs strips it for anyone else)
    sessions: mine.filter((e) => e.date <= today)
      .sort((x, y) => (x.date === y.date ? (x.id < y.id ? 1 : -1) : x.date < y.date ? 1 : -1))
      .slice(0, 30)
      .map((e) => sessionRow(e, feed.settings))
  };
}

function testRow(b) {
  return { date: b.date, test: b.test, timeS: b.timeS, meters: b.meters, avgRate: b.avgRate, valid: b.valid, result: resultValue(b) };
}

// ---- layer 2: leaderboards, stars, OYO board, GMS ---------------------------

const STAR_TESTS = ['2000m', '20min'];

/**
 * One board per test: best valid raw result per athlete, ranked, for this
 * school year and all time. All time keeps inactive and graduated athletes.
 * Raw erg scores only; no GMS on boards. The page filters by squad and shows
 * both ranks ("#1 Jane Smith (#4 overall)").
 */
export function leaderboardsView(feed, today) {
  const yearStart = schoolYearStart(today, feed.settings.schoolYearStart);
  const byId = Object.fromEntries(feed.athletes.filter((a) => a.role === 'Rower').map((a) => [a.id, a]));
  const starCache = {};
  const stars = (id) => (id in starCache ? starCache[id] : (starCache[id] = seasonStars(feed, id, yearStart, today).stars));
  const board = (test, from) => {
    const best = {};
    feed.benchmarks.forEach((b) => {
      const a = byId[b.athleteId];
      if (!a || b.test !== test || !b.valid || !resultValue(b) || b.date < from || b.date > today) return;
      if (!best[a.id] || better(test, b, best[a.id])) best[a.id] = b;
    });
    return Object.values(best)
      .sort((x, y) => (better(test, x, y) ? -1 : better(test, y, x) ? 1 : x.date < y.date ? -1 : 1))
      .map((b, i) => {
        const a = byId[b.athleteId];
        return { rank: i + 1, ...athleteSummary(a), active: a.active, stars: stars(a.id), ...testRow(b) };
      });
  };
  return {
    today, yearStart,
    tests: TESTS.map((t) => ({ test: t, season: board(t, yearStart), allTime: board(t, '0000-00-00') }))
  };
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
    return {
      ...athleteSummary(a), oyoGroup: a.oyoGroup, required: a.oyoRequired, elite: a.oyoElite,
      minutes: round(now), status: oyoStatus(now, a),
      lastWeek: { minutes: round(before), status: oyoStatus(before, a) },
      streak: oyoWeekStreak(a, feed, today)
    };
  }).sort((x, y) => y.minutes / y.required - x.minutes / x.required || x.name.localeCompare(y.name));
  return { today, weekStart: monday, lastWeekStart: lastMonday, rowers };
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
  const inSquad = (s, squad) => !/^(varsity|novice)$/i.test(s.squad) || s.squad.toLowerCase() === squad.toLowerCase();
  const rowers = activeRowers(feed).sort((x, y) => x.name.localeCompare(y.name));
  let pieces = 0, targeted = 0;
  const days = Array.from({ length: 6 }, (_, i) => addDays(monday, i)).map((day) => ({
    day,
    sessions: plan.sessions.filter((s) => s.day === day && (!a || inSquad(s, a.squad))).map((s) => {
      const mine = a && (s.athletes || []).find((x) => x.athlete === a.name);
      const out = {
        session: s.session, squad: s.squad, workout: s.workout, notes: s.notes || '',
        pieces: s.pieces.map((p, i) => {
          const t = mine && (mine.targets[i] && mine.targets[i].piece === p.label ? mine.targets[i] : mine.targets.find((x) => x.piece === p.label));
          if (a) { pieces++; if (t && t.target) targeted++; }
          return { label: p.label, notes: p.notes || '', target: a ? (t && t.target) || null : undefined };
        })
      };
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
