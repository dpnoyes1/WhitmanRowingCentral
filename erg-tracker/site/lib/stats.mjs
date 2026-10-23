// Training stats for the team site, worked out from the Sheet feed when read
// (CLAUDE.md rule 2: raw data is stored, multipliers and goals apply here).
// Pure functions: dates are 'YYYY-MM-DD' strings, times seconds.

export const ZONES = ['UT2', 'UT1', 'AT', 'AN'];
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

/** First day of the school year containing `day`. mmdd like "08-01". */
export function schoolYearStart(day, mmdd = '08-01') {
  const y = Number(day.slice(0, 4));
  const start = `${y}-${mmdd}`;
  return start > day ? `${y - 1}-${mmdd}` : start;
}

// ---- minutes ----------------------------------------------------------------

/** Training minutes on the machine: warmup + work + rest + cooldown. */
export function rawMinutes(e) {
  if (e.status === 'Out') return 0;
  return ((e.warmupS || 0) + (e.workS || 0) + (e.restS || 0) + (e.cooldownS || 0)) / 60;
}

/**
 * Weighted minutes. A Modified practice or make-up is weighted by
 * modified_multiplier instead of its activity (it is usually BikeErg, so the
 * two are not stacked); everything else by its activity multiplier.
 */
export function weightedMinutes(e, settings) {
  const raw = rawMinutes(e);
  if (!raw) return 0;
  if (e.type !== 'OYO' && e.status === 'Modified') return raw * settings.modifiedMultiplier;
  const m = settings.multipliers[e.activity];
  return raw * (m === undefined ? 1 : m);
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

/** OYO goal status for weighted OYO minutes. */
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
    if (!w || w.oyo < athlete.oyoRequired) break;
    n++;
  }
  return n;
}

/** Minutes by zone (raw training minutes) for entries in [from, to]. */
export function zoneMinutes(entries, from, to) {
  const z = Object.fromEntries(ZONES.map((k) => [k, 0]));
  entries.forEach((e) => {
    if (e.date < from || e.date > to || !z.hasOwnProperty(e.zone)) return;
    z[e.zone] += rawMinutes(e);
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
