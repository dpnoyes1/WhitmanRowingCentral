// Shapes the feed into what each page shows. Everything returned here goes to
// a browser behind the team password, so it must never carry weight or
// birthdays (the feed has neither) and GMS % only on an athlete's own page.

import {
  addDays, weekStart, schoolYearStart, rawMinutes, weightedMinutes, bucket, practiceRecord,
  practiceStreak, openMakeups, weekMinutes, oyoStatus, oyoWeekStreak, zoneMinutes, personalBests,
  resultValue, TESTS
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
    athletes: rowers.map(athleteSummary).sort((a, b) => a.name.localeCompare(b.name)),
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
    sessions: mine.filter((e) => e.date <= today)
      .sort((x, y) => (x.date === y.date ? (x.id < y.id ? 1 : -1) : x.date < y.date ? 1 : -1))
      .slice(0, 30)
      .map((e) => sessionRow(e, feed.settings))
  };
}

function testRow(b) {
  return { date: b.date, test: b.test, timeS: b.timeS, meters: b.meters, avgRate: b.avgRate, valid: b.valid, result: resultValue(b) };
}
