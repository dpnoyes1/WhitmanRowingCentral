// Training stats for the team site, worked out from the Sheet feed when read
// (CLAUDE.md rule 2: raw data is stored, multipliers and goals apply here).
// Pure functions: dates are 'YYYY-MM-DD' strings, times seconds.

export const ZONES = ['Aerobic', 'Threshold', 'Anaerobic'];
export const TESTS = ['2000m', '20min', '500m', '100m', '30r20'];
export const TEST_LABELS = { '2000m': '2k', '20min': "20'", '500m': '500m', '100m': '100m', '30r20': '30r20' };

// ---- dates ----------------------------------------------------------------

const toUTC = (day) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);

export function addDays(day, n) {
  return fromUTC(toUTC(day) + n * 86400000);
}

export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

/** Monday on or before `day`. */
export function weekStart(day) {
  const dow = new Date(toUTC(day)).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

/** Today in the team's time zone, as YYYY-MM-DD. */
export function todayIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** First day of the school year containing `day`. mmdd like "07-01". */
export function schoolYearStart(day, mmdd = '07-01') {
  const y = Number(day.slice(0, 4));
  const start = `${y}-${mmdd}`;
  return start > day ? `${y - 1}-${mmdd}` : start;
}

/** School year containing `day` as "2025-26". */
export function schoolYearLabel(day, mmdd = '08-01') {
  const y = Number(schoolYearStart(day, mmdd).slice(0, 4));
  return `${y}-${String(y + 1).slice(2)}`;
}

/** Grade (7-12) the class of `gradYear` was in on `day`; null when blank or outside 7th-12th. */
export function gradeAt(gradYear, day, mmdd = '08-01') {
  if (!gradYear) return null;
  const endYear = Number(schoolYearStart(day, mmdd).slice(0, 4)) + 1;
  const grade = 12 - (Number(gradYear) - endYear);
  return grade >= 7 && grade <= 12 ? grade : null;
}

/** Board group for a piece done on `day` (David, 2026-10-25): Freshman 7th-9th, Varsity 10th-12th. */
export function boardGroup(gradYear, day, mmdd = '08-01') {
  const g = gradeAt(gradYear, day, mmdd);
  return g === null ? null : g <= 9 ? 'freshman' : 'varsity';
}

// ---- minutes ----------------------------------------------------------------

/** Warm-up and cool-down count only if the erg's average split is faster than this (s per 500m). */
export const WARMCOOL_MAX_SPLIT_S = 180; // 3:00/500m (David, 2026-10-25)

/** Average split of the work on the erg, s per 500m. Null for non-erg sessions or no meters. */
export function ergSplitS(e) {
  const m = rowMeters(e);
  return e.workS > 0 && m > 0 ? (e.workS * 500) / m : null;
}

/**
 * Warm-up and cool-down seconds that count as Aerobic minutes. Erg only, and
 * only when the average split is faster than WARMCOOL_MAX_SPLIT_S (David, 2026-10-25).
 */
export function warmCoolS(e) {
  if (e.status === 'Out') return 0;
  const split = ergSplitS(e);
  return split !== null && split < WARMCOOL_MAX_SPLIT_S ? (e.warmupS || 0) + (e.cooldownS || 0) : 0;
}

/** Training minutes: work + counted warm-up and cool-down. Rest is never training minutes (David, 2026-10-25). */
export function rawMinutes(e) {
  if (e.status === 'Out') return 0;
  return ((e.workS || 0) + warmCoolS(e)) / 60;
}

/**
 * Shortest OYO piece that counts, in raw minutes (David, 2026-10-25): a run
 * 10, a bike (road or stationary) 20, any other cardio 15. Shorter pieces
 * still show in the log but weigh 0. Practices are not affected.
 */
export const OYO_MIN_MINUTES = { Run: 10, Bike: 20 };
export const OYO_MIN_DEFAULT = 15;

export function oyoMinimum(activity) {
  return OYO_MIN_MINUTES[activity] ?? OYO_MIN_DEFAULT;
}

/**
 * Weighted minutes: training minutes x activity multiplier. A Modified
 * practice gets no extra discount (David, 2026-10-23): doing less work
 * already shows as fewer minutes.
 */
export function weightedMinutes(e, settings) {
  const raw = rawMinutes(e);
  if (!raw) return 0;
  if (e.type === 'OYO' && raw < oyoMinimum(e.activity)) return 0;
  const m = settings.multipliers[e.activity];
  return raw * (m === undefined ? 1 : m);
}

/**
 * Total meters: work plus optional warmup and cooldown meters. Rest meters never
 * count (David, 2026-10-25). Lifting is not distance (David, 2026-10-23): its
 * meters never count toward the season total. Its minutes weigh 0, so it never
 * counts toward OYO either.
 */
export function meterTotal(e) {
  return /^lifting$/i.test(e.activity) ? 0 : (e.workM || 0) + (e.warmupM || 0) + (e.cooldownM || 0);
}

/** 'practice' for practices and make-ups (make-ups count as practice), 'oyo' for OYO. */
export function bucket(e) {
  return e.type === 'OYO' ? 'oyo' : 'practice';
}

// ---- practices and completion ---------------------------------------------

/** Practices an athlete is expected at: not canceled, and for her squad (or everyone). */
export function practicesFor(athlete, practices) {
  return practices.filter((p) => !p.canceled &&
    (!/^(varsity|novice)$/i.test(p.squad) || p.squad.toLowerCase() === athlete.squad.toLowerCase()));
}

/**
 * One row per expected practice up to `today`: { date, done, how }.
 * Done = a Full or Modified practice that day, or a make-up logged for it.
 * Today's practice only counts once it is logged, so it never shows as missed.
 */
export function practiceRecord(athlete, feed, today) {
  const mine = feed.entries.filter((e) => e.athleteId === athlete.id);
  const attended = new Map();
  mine.forEach((e) => {
    if (e.type === 'Practice' && (e.status === 'Full' || e.status === 'Modified')) attended.set(e.date, e.status);
    if (e.type === 'Practice' && e.status === 'Out' && !attended.has(e.date)) attended.set(e.date, 'Out');
  });
  const madeUp = new Map();
  mine.forEach((e) => { if (e.type === 'Make-up' && e.makeupFor) madeUp.set(e.makeupFor, e.date); });
  const seen = new Set();
  return practicesFor(athlete, feed.practices)
    .filter((p) => p.date <= today && !seen.has(p.date) && seen.add(p.date))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((p) => {
      const s = attended.get(p.date);
      if (s === 'Full' || s === 'Modified') return { date: p.date, done: true, how: s };
      if (madeUp.has(p.date)) return { date: p.date, done: true, how: 'Make-up', makeupDate: madeUp.get(p.date) };
      return { date: p.date, done: false, how: s === 'Out' ? 'Out' : 'Not logged' };
    })
    .filter((r) => r.done || r.date < today);
}

/** Consecutive completed practices, counting back from the most recent. */
export function practiceStreak(record) {
  let n = 0;
  for (let i = record.length - 1; i >= 0 && record[i].done; i--) n++;
  return n;
}

/** Missed practices that can still be made up (within the window), oldest first. */
export function openMakeups(record, today, windowDays) {
  return record.filter((r) => !r.done && daysBetween(r.date, today) <= windowDays)
    .map((r) => ({ date: r.date, makeUpBy: addDays(r.date, windowDays) }));
}

// ---- weekly totals ----------------------------------------------------------

/** { practice, oyo, total } weighted minutes per athlete for one Mon-Sun week. */
export function weekMinutes(entries, settings, monday) {
  const end = addDays(monday, 6);
  const out = {};
  entries.forEach((e) => {
    if (e.date < monday || e.date > end) return;
    const t = out[e.athleteId] || (out[e.athleteId] = { practice: 0, oyo: 0, total: 0, rawTotal: 0 });
    const w = weightedMinutes(e, settings);
    t[bucket(e)] += w;
    t.total += w;
    t.rawTotal += rawMinutes(e);
  });
  return out;
}

/** True when 4 or more days of the Mon-Sun week starting `monday` fall in a break (Settings oyo.break.dates). */
export function isBreakWeek(monday, settings) {
  const ranges = (settings.oyoBreak && settings.oyoBreak.ranges) || [];
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    if (ranges.some((r) => d >= r.from && d <= r.to)) n++;
  }
  return n >= 4;
}

/**
 * An athlete's OYO goals for one week: her usual Required and Elite, or the
 * break goals in a break week (blank break goals keep her usual ones).
 * Shaped like an athlete so oyoStatus takes it.
 */
export function oyoGoals(athlete, monday, settings) {
  if (!isBreakWeek(monday, settings)) return { oyoRequired: athlete.oyoRequired, oyoElite: athlete.oyoElite, breakWeek: false };
  const b = settings.oyoBreak;
  return { oyoRequired: b.required ?? athlete.oyoRequired, oyoElite: b.elite ?? athlete.oyoElite, breakWeek: true };
}

/** OYO goal status for weighted OYO minutes, against an athlete's goals (or oyoGoals for one week). */
export function oyoStatus(minutes, athlete) {
  if (minutes >= athlete.oyoElite) return 'elite';
  if (minutes >= athlete.oyoRequired) return 'required';
  return 'short';
}

/** Consecutive finished weeks (before this one) that met OYO Required. */
export function oyoWeekStreak(athlete, feed, today) {
  const mine = feed.entries.filter((e) => e.athleteId === athlete.id);
  if (!mine.length) return 0;
  const first = mine.reduce((m, e) => (e.date < m ? e.date : m), mine[0].date);
  let n = 0;
  for (let mon = addDays(weekStart(today), -7); mon >= weekStart(first); mon = addDays(mon, -7)) {
    const w = weekMinutes(mine, feed.settings, mon)[athlete.id];
    if (!w || w.oyo < oyoGoals(athlete, mon, feed.settings).oyoRequired) break;
    n++;
  }
  return n;
}

/**
 * Minutes by zone (raw training minutes) for entries in [from, to]. Counted
 * warm-up and cool-down are Aerobic minutes, whatever the session's zone.
 */
export function zoneMinutes(entries, from, to) {
  const z = Object.fromEntries(ZONES.map((k) => [k, 0]));
  entries.forEach((e) => {
    if (e.date < from || e.date > to || e.status === 'Out') return;
    if (z.hasOwnProperty(e.zone)) z[e.zone] += (e.workS || 0) / 60;
    z.Aerobic += warmCoolS(e) / 60;
  });
  return z;
}

// ---- benchmarks -------------------------------------------------------------

export function better(test, a, b) {
  const va = resultValue(a), vb = resultValue(b);
  return /min|30r20/.test(test) ? va > vb : va < vb;
}

export function resultValue(b) {
  return b.test === '20min' || b.test === '30r20' ? b.meters : b.timeS;
}

/** Best valid result per test for an athlete, this school year and all time. */
export function personalBests(athleteId, benchmarks, yearStart) {
  const out = {};
  benchmarks.forEach((b) => {
    if (b.athleteId !== athleteId || !b.valid || !resultValue(b)) return;
    const t = out[b.test] || (out[b.test] = { season: null, allTime: null, count: 0 });
    t.count++;
    if (!t.allTime || better(b.test, b, t.allTime)) t.allTime = b;
    if (b.date >= yearStart && (!t.season || better(b.test, b, t.season))) t.season = b;
  });
  return out;
}

// ---- load, effort, progress (David, 2026-10-23) ------------------------------

export const LOAD_JUMP_PCT = 15;   // fallback when the feed has no loadJumpPct
const TRAILING_WEEKS = 3;

/**
 * Weekly load for one athlete's entries, one row per Monday in `mondays`:
 * weighted minutes, average session RPE (weighted by training minutes) and the
 * trailing average of the weeks before it. A week is flagged when it is more
 * than `jumpPct` above that average. The trailing average uses up to 3 earlier
 * weeks, counting only weeks since her first logged session, so her 2nd and 3rd
 * weeks compare with what exists and her first week is never flagged.
 */
export function loadTrend(entries, settings, mondays) {
  const jumpPct = settings.loadJumpPct ?? LOAD_JUMP_PCT;
  const logged = entries.filter((e) => e.status !== 'Out');
  const firstWeek = logged.length ? weekStart(logged.reduce((m, e) => (e.date < m ? e.date : m), logged[0].date)) : null;
  const totals = new Map();
  const weekOf = (mon) => {
    if (!totals.has(mon)) {
      const end = addDays(mon, 6);
      let total = 0, rpeMin = 0, rpeSum = 0, sessions = 0;
      logged.forEach((e) => {
        if (e.date < mon || e.date > end) return;
        sessions++;
        total += weightedMinutes(e, settings);
        const raw = rawMinutes(e);
        if (e.rpe && raw) { rpeSum += e.rpe * raw; rpeMin += raw; }
      });
      totals.set(mon, { total, rpe: rpeMin ? rpeSum / rpeMin : null, sessions });
    }
    return totals.get(mon);
  };
  return mondays.map((mon) => {
    const w = weekOf(mon);
    const before = [];
    for (let i = 1; i <= TRAILING_WEEKS; i++) {
      const prev = addDays(mon, -7 * i);
      if (!firstWeek || prev < firstWeek) break;
      before.push(weekOf(prev).total);
    }
    const trailing = before.length ? before.reduce((x, y) => x + y, 0) / before.length : null;
    const changePct = trailing ? (100 * (w.total - trailing)) / trailing : null;
    return { weekStart: mon, total: w.total, rpe: w.rpe, sessions: w.sessions, trailing, trailingWeeks: before.length,
      changePct, flag: changePct !== null && changePct > jumpPct };
  });
}

/** Meters that count like rowing: BikeErg meters count half (same monitor, double the distance). */
function rowMeters(e) {
  if (/bikeerg/i.test(e.activity)) return (e.workM || 0) / 2;
  if (/rowerg/i.test(e.activity)) return e.workM || 0;
  return 0;
}

/**
 * Steady-state (Aerobic) split per week on the RowErg and BikeErg (BikeErg as
 * row-equivalent): total main-set time x 500 / meters, so long pieces weigh
 * more. Weeks with no steady erg work have split null.
 */
export function steadySplits(entries, mondays) {
  const steady = entries.filter((e) => e.status !== 'Out' && e.zone === 'Aerobic' && e.workS > 0 && rowMeters(e) > 0);
  return mondays.map((mon) => {
    const end = addDays(mon, 6);
    let s = 0, m = 0;
    steady.forEach((e) => { if (e.date >= mon && e.date <= end) { s += e.workS; m += rowMeters(e); } });
    return { weekStart: mon, splitS: m ? (s * 500) / m : null, meters: m };
  });
}

/**
 * Faster or slower: the average split of her latest weeks with steady work
 * against the same number of weeks with steady work just before them (3 and 3
 * once she has 6; fewer before that). Negative changeS = faster. Null until
 * there are 2 such weeks.
 */
export function splitTrend(weeks) {
  const have = weeks.filter((w) => w.splitS !== null);
  const n = Math.min(TRAILING_WEEKS, Math.floor(have.length / 2));
  if (!n) return null;
  const avg = (l) => l.reduce((x, w) => x + w.splitS, 0) / l.length;
  const recent = have.slice(-n), earlier = have.slice(-2 * n, -n);
  return { changeS: avg(recent) - avg(earlier), recentS: avg(recent), earlierS: avg(earlier), weeksEach: n };
}

/** 2k time from a 20' result: 20' split - 8.5 s, x 4 (the GMS 2k-equivalent rule in Gms.gs). */
export function twoKFrom20(meters) {
  return meters ? ((1200 * 500) / meters - 8.5) * 4 : null;
}

/**
 * Projected 2k: from her latest valid 20' this school year, shown only when it
 * is newer than her latest 2k (else her real 2k says more). Null otherwise.
 */
export function projected2k(athleteId, benchmarks, yearStart) {
  const mine = benchmarks.filter((b) => b.athleteId === athleteId && b.valid && b.date >= yearStart && resultValue(b));
  const latest = (test) => mine.filter((b) => b.test === test).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const twenty = latest('20min'), twoK = latest('2000m');
  if (!twenty || (twoK && twoK.date >= twenty.date)) return null;
  return { timeS: twoKFrom20(twenty.meters), from: { date: twenty.date, meters: twenty.meters }, last2k: twoK ? { date: twoK.date, timeS: twoK.timeS } : null };
}

/** Planned practices done this calendar month (make-ups count), from practiceRecord rows. */
export function monthConsistency(record, today) {
  const first = today.slice(0, 8) + '01';
  const month = record.filter((r) => r.date >= first);
  const done = month.filter((r) => r.done).length;
  return { done, expected: month.length, pct: month.length ? Math.round((100 * done) / month.length) : null };
}

// ---- balance: 100m vs 2k vs 20' in watts (David, 2026-10-27, coaches only) ----

export const BALANCE_WINDOW_DAYS = 365;
export const BALANCE_HALF_LIFE_DAYS = 56;   // a pair 56 days apart weighs half as much as one on the same day
export const BALANCE_WEAK_WEIGHT = 0.25;    // under this the pairing is marked weak (about 4 months apart)
export const GMS_100M_DIVISOR = 0.786;      // same constants as Gms.gs, used to compare the tracker's own rules
export const GMS_20_PLUS_S = 8.5;

/** Concept2 watts from a 500 m split in seconds (same formula as wattsFromSplit in Plan.gs). */
export const wattsFromSplit = (split500) => (split500 > 0 ? 2.80 / Math.pow(split500 / 500, 3) : null);

/** Watts for a valid 100m, 2000m or 20min result; null for anything else. */
export function benchmarkWatts(b) {
  if (b.test === '100m' && b.timeS > 0) return wattsFromSplit((b.timeS * 5));
  if (b.test === '2000m' && b.timeS > 0) return wattsFromSplit(b.timeS / 4);
  if (b.test === '20min' && b.meters > 0) return wattsFromSplit((1200 * 500) / b.meters);
  return null;
}

/** Paul's Law: split500 at `meters` from a 2k split, +5 s per doubling of distance. */
export const paulSplit = (split2k, meters) => split2k + 5 * Math.log2(meters / 2000);

/** Paul's Law split for a 20' piece (distance depends on the split, so iterate). */
export function paulSplit20(split2k) {
  let s = split2k + 6;
  for (let i = 0; i < 25; i++) s = paulSplit(split2k, (1200 * 500) / s);
  return s;
}

/**
 * Predicted watts of the longer-or-shorter piece from the 2k result, by rule.
 * short = 100m vs 2k gap, long = 2k vs 20' gap. Splits in s/500m.
 */
export function ruleSplits(split2k) {
  return {
    paul20: paulSplit20(split2k), rule20: split2k + GMS_20_PLUS_S,
    paul100: paulSplit(split2k, 100), rule100: split2k * GMS_100M_DIVISOR
  };
}

/**
 * One gap between a harder-and-shorter test (`hi`) and a longer test (`lo`):
 * every valid pair of her results in the last 12 months, weighted by how close
 * in time the two were. Returns the best-weighted pair, the weighted average
 * ratio across all pairs, and how the tracker's rules compare for that pair.
 * Ratio = hi watts / lo watts. Null when she has no pair.
 */
export function balanceGap(athleteId, benchmarks, today, hi, lo) {
  const from = addDays(today, -BALANCE_WINDOW_DAYS);
  const mine = (test) => benchmarks.filter((b) => b.athleteId === athleteId && b.test === test && b.valid && b.date >= from && b.date <= today && benchmarkWatts(b));
  const pairs = [];
  mine(hi).forEach((a) => mine(lo).forEach((b) => {
    const days = Math.abs(daysBetween(a.date, b.date));
    const wHi = benchmarkWatts(a), wLo = benchmarkWatts(b);
    pairs.push({ hi: a, lo: b, days, weight: Math.pow(0.5, days / BALANCE_HALF_LIFE_DAYS), wattsHi: wHi, wattsLo: wLo, ratio: wHi / wLo });
  }));
  if (!pairs.length) return null;
  pairs.sort((x, y) => y.weight - x.weight || (y.wattsHi + y.wattsLo) - (x.wattsHi + x.wattsLo));
  const best = pairs[0];
  const total = pairs.reduce((s, p) => s + p.weight, 0);
  const avgRatio = pairs.reduce((s, p) => s + p.weight * p.ratio, 0) / total;
  return { best, avgRatio, pairs: pairs.length, weak: best.weight < BALANCE_WEAK_WEIGHT };
}

// ---- test pacing post-mortem (David, 2026-11-01) --------------------------------
// A look-back at how a 2k or 20' was paced, from the split list stored with the
// test (Benchmarks "Splits s"). Never a plan or a target.

export const PACING_TESTS = ['2000m', '20min'];
export const PACING_EVEN_S = 1;   // a split within this many seconds of her average counts as even

/** Her splits, each against her own average. Null when the test has no usable split list. */
export function pacingFor(b) {
  if (!b || !PACING_TESTS.includes(b.test) || !b.valid || !Array.isArray(b.splits)) return null;
  const sp = b.splits.filter((x) => Number.isFinite(x) && x > 0);
  if (sp.length < 2) return null;
  const avg = sp.reduce((s, x) => s + x, 0) / sp.length;
  const round1 = (x) => Math.round(x * 10) / 10;
  const named = b.test === '2000m' && sp.length === 4;
  const segments = sp.map((s, i) => ({
    label: named ? `${i * 500}–${(i + 1) * 500}` : `Part ${i + 1}`,
    splitS: round1(s), deltaS: round1(s - avg)
  }));
  return { id: b.id, test: b.test, date: b.date, avgS: round1(avg), segments, read: pacingRead(sp, avg) };
}

/** One plain sentence from fixed rules: how it started, what happened in the middle, how it finished. */
export function pacingRead(sp, avg) {
  const first = sp[0] - avg, last = sp[sp.length - 1] - avg;
  const mid = sp.length > 2 ? sp.slice(1, -1).reduce((s, x) => s + x, 0) / (sp.length - 2) - avg : 0;
  if (sp.every((x) => Math.abs(x - avg) < PACING_EVEN_S)) return `Even pace: every split within ${PACING_EVEN_S} second of your average.`;
  const start = first <= -PACING_EVEN_S ? 'Fast start' : first >= PACING_EVEN_S ? 'Slow start' : 'Even start';
  const middle = mid >= PACING_EVEN_S ? ', a fade through the middle' : mid <= -PACING_EVEN_S ? ', quicker through the middle' : '';
  const finish = last >= PACING_EVEN_S ? ', then slower at the end' : last <= -PACING_EVEN_S ? ', then finished strong' : ', then held to the finish';
  return start + middle + finish + '.';
}

/**
 * Where her best result stands among active rowers (1 = fastest or farthest),
 * counting each rower's best valid result for the test, all time. Null when she
 * is not an active rower or has no valid result.
 */
export function teamRank(test, athleteId, benchmarks, activeIds) {
  if (!activeIds.includes(athleteId)) return null;
  const best = {};
  benchmarks.forEach((b) => {
    if (b.test !== test || !b.valid || !resultValue(b) || !activeIds.includes(b.athleteId)) return;
    if (!best[b.athleteId] || better(test, b, best[b.athleteId])) best[b.athleteId] = b;
  });
  const mine = best[athleteId];
  if (!mine) return null;
  const ahead = Object.values(best).filter((b) => better(test, b, mine)).length;
  return { pos: ahead + 1, of: Object.keys(best).length };
}

/** One sentence naming her strongest and weakest GMS test this season, from fixed rules. Null with fewer than two tests. */
export function gmsSummary(gms, labels = TEST_LABELS) {
  const list = (gms || []).filter((g) => g.gmsPct !== null && g.gmsPct !== undefined);
  if (list.length < 2) return null;
  const sorted = list.slice().sort((x, y) => y.gmsPct - x.gmsPct);
  const top = sorted[0], low = sorted[sorted.length - 1];
  if (top.gmsPct - low.gmsPct < 1) return 'Your tests are all close to the same level.';
  return `${labels[top.test]} is your strongest test against the standard; ${labels[low.test]} has the most room to grow.`;
}
