// Checks on a read erg screen (step 2 of the photo plan, plans/erg-photo-build-plan.md).
// Pure functions over the shape normalizeRead() returns in ergscreen.mjs: seconds and meters.
// Rules come from erg-slack-map/slack-alerts-and-logging-map.md ("Photo checks that don't add up").
//
// A check never fixes a number silently. It returns issues, each with a level:
//   hold - numbers don't add up: held as "Check photo", athlete and coaches both told
//   ask  - the athlete must answer or resend before it can be saved
//   flag - saves, but coaches see it
//   note - saves, shown on the athlete's Confirm card ("calculated, please check")

const tenths = (n) => Math.round(n * 10) / 10;

/** Seconds -> m:ss.0, for messages only (data stays in seconds). */
export function formatClock(s) {
  const t = Math.round(s * 10) / 10;
  const m = Math.floor(t / 60);
  const rest = tenths(t - m * 60).toFixed(1).padStart(4, '0');
  return `${m}:${rest}`;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const toUTC = (day) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const pad = (n) => String(n).padStart(2, '0');

/**
 * The date printed on a screen as YYYY-MM-DD, or null when it can't be trusted
 * ("Mar 15 2105" is a misread time of day). A missing year means the year of `today`.
 */
export function parseScreenDate(text, today) {
  const t = String(text || '').trim().toLowerCase().replace(/,/g, '');
  if (!t) return null;
  const thisYear = Number(today.slice(0, 4));
  let y, m, d;
  let x;
  if ((x = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [y, m, d] = [+x[1], +x[2], +x[3]];
  else if ((x = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) [m, d, y] = [+x[1], +x[2], +x[3] < 100 ? 2000 + +x[3] : +x[3]];
  else if ((x = t.match(/^([a-z]{3})[a-z]*\.? (\d{1,2})(?: (\d{4}))?$/))) {
    m = MONTHS.indexOf(x[1]) + 1;
    d = +x[2];
    y = x[3] ? +x[3] : thisYear;
  } else return null;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  if (y < thisYear - 15 || y > thisYear + 1) return null;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return new Date(toUTC(iso)).toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * The workout title on a PM screen. Returns null when it isn't a plain workout title.
 *   "2000m" / "6:30"      -> { kind: 'single', by: 'distance'|'time', value }
 *   "6x500m/2:00r"        -> { kind: 'intervals', reps, by: 'distance', value: 500, restS: 120 }
 *   "10x3:00/1:15r"       -> { kind: 'intervals', reps, by: 'time', value: 180, restS: 75 }
 */
export function parseTitle(title) {
  const t = String(title || '').trim().toLowerCase().replace(/\s/g, '');
  const clock = '(\\d{1,2}:\\d{2}(?:\\.\\d)?)';
  const sec = (s) => { const [m, r] = s.split(':'); return Number(m) * 60 + Number(r); };
  let x;
  if ((x = t.match(new RegExp(`^(\\d+)x(\\d+)m/${clock}r$`)))) return { kind: 'intervals', reps: +x[1], by: 'distance', value: +x[2], restS: sec(x[3]) };
  if ((x = t.match(new RegExp(`^(\\d+)x${clock}/${clock}r$`)))) return { kind: 'intervals', reps: +x[1], by: 'time', value: sec(x[2]), restS: sec(x[3]) };
  if ((x = t.match(/^(\d+)m$/))) return { kind: 'single', by: 'distance', value: +x[1] };
  if ((x = t.match(new RegExp(`^${clock}$`)))) return { kind: 'single', by: 'time', value: sec(x[1]) };
  return null;
}

/** Meters per split unit: the RowErg split is per 500 m, the BikeErg split per 1000 m. */
const splitUnit = (machine) => (machine === 'BikeErg' ? 1000 : 500);

/** Work out whichever of time, meters and average split is missing from the other two (marked "calculated"). */
export function fillMissing(read) {
  const r = { ...read, calculated: [...(read.calculated || [])] };
  if (!r.machine) return r;
  const d = splitUnit(r.machine);
  if (r.totalMeters == null && r.totalTimeS != null && r.avgSplitS) {
    r.totalMeters = Math.round((r.totalTimeS / r.avgSplitS) * d);
    r.calculated.push('meters');
  } else if (r.totalTimeS == null && r.totalMeters != null && r.avgSplitS) {
    r.totalTimeS = tenths((r.totalMeters / d) * r.avgSplitS);
    r.calculated.push('time');
  } else if (r.avgSplitS == null && r.totalTimeS != null && r.totalMeters) {
    r.avgSplitS = tenths((r.totalTimeS / r.totalMeters) * d);
    r.calculated.push('average split');
  }
  return r;
}

/**
 * A row above the line that equals the sum of the rows under it is the workout's subtotal
 * (the summary row), not a piece. Taken out of `pieces` so nothing counts twice (David, 2026-10-28).
 */
export function dropSubtotal(read) {
  const pieces = read.pieces || [];
  if (pieces.length < 3) return { read, dropped: null };
  const sameTime = (a, b, n) => a != null && b != null && Math.abs(a - b) <= 0.1 * n + 0.3;
  for (let i = 0; i < pieces.length; i++) {
    const others = pieces.filter((_, j) => j !== i);
    const p = pieces[i];
    const timeOk = others.every((o) => o.timeS != null) && sameTime(p.timeS, others.reduce((a, o) => a + o.timeS, 0), others.length);
    const metersKnown = p.meters != null && others.every((o) => o.meters != null);
    const metersOk = !metersKnown || Math.abs(p.meters - others.reduce((a, o) => a + o.meters, 0)) <= 2;
    if (timeOk && metersOk) return { read: { ...read, pieces: others }, dropped: p };
  }
  return { read, dropped: null };
}

const issue = (code, level, athlete, coach, coaches = true) => ({ code, level, coaches, athlete, coach });

const resend = 'Please send a clearer photo, or type it in with /log.';

/**
 * Run every check. ctx: { today: 'YYYY-MM-DD', priorTotals: [{ timeS, meters }] }.
 * Returns { read (with missing numbers filled), issues, status } where status is the
 * worst level: 'hold' | 'ask' | 'clean' (flag and note still save).
 */
export function runChecks(input, ctx) {
  let read = fillMissing(input);
  const issues = [];
  const sub = dropSubtotal(read);
  read = sub.read;
  if (sub.dropped) issues.push(issue('subtotal_dropped', 'note', '', `The summary row (${sub.dropped.meters != null ? sub.dropped.meters + ' m, ' : ''}${formatClock(sub.dropped.timeS)}) was not counted as a piece`, true));
  const title = parseTitle(read.title);
  const pieces = read.pieces || [];

  if (!read.machine) {
    issues.push(issue('machine_unknown', 'ask', 'Is this a rower or a BikeErg? I could not see /500m or /1000m on the screen.', 'Split unit not visible', false));
  }
  if (read.totalTimeS == null || read.totalMeters == null) {
    issues.push(issue('totals_missing', 'ask', `I could not read the total time and meters. ${resend}`, 'Totals unreadable', false));
    return finish(read, issues);
  }
  for (const what of read.calculated) {
    issues.push(issue('calculated', 'note', `The ${what} was calculated from the other numbers, please check it.`, '', false));
  }

  // Working time, not Total Time (David, 2026-10-28): an interval screen's header Total Time includes
  // rest. When the time we have is longer than the pace allows, it is that header, so use the working time.
  if (read.machine && read.avgSplitS && !read.calculated.length) {
    const d = splitUnit(read.machine);
    const expect = (read.totalMeters / d) * read.avgSplitS;
    const tol = 0.05 * (read.totalMeters / d) + 0.3;
    const interval = (title && title.kind === 'intervals') || read.restMeters != null ||
      (!title && pieces.length > 1 && read.metersColumn === 'per_piece');
    if (interval && read.totalTimeS - expect > tol) {
      const times = pieces.map((p) => p.timeS);
      const sum = times.length && times.every((t) => t != null) ? tenths(times.reduce((a, b) => a + b, 0)) : null;
      const working = sum != null && Math.abs(sum - expect) <= tol + 0.1 * pieces.length ? sum : tenths(expect);
      issues.push(issue('working_time', 'note', '', `Total Time on the screen (${formatClock(read.totalTimeS)}) includes rest; used working time ${formatClock(working)}`, true));
      read = { ...read, totalTimeInclRestS: read.totalTimeInclRestS ?? read.totalTimeS, totalTimeS: working };
    }
  }

  // Pace: time must match meters at the average split.
  if (read.machine && read.avgSplitS) {
    const d = splitUnit(read.machine);
    const expect = (read.totalMeters / d) * read.avgSplitS;
    const tol = 0.05 * (read.totalMeters / d) + 0.3;
    if (!read.calculated.length && Math.abs(expect - read.totalTimeS) > tol) {
      issues.push(issue('pace_mismatch', 'hold',
        `The numbers on this photo don't add up (${read.totalMeters} m at ${formatClock(read.avgSplitS)} should take ${formatClock(expect)} but the screen says ${formatClock(read.totalTimeS)}). ${resend} A coach has been told.`,
        `Time ${formatClock(read.totalTimeS)} vs ${formatClock(expect)} from ${read.totalMeters} m at ${formatClock(read.avgSplitS)}`));
    }
    if (read.avgSplitS < 60 || read.avgSplitS > 400) {
      issues.push(issue('split_implausible', 'flag', '', `Average split ${formatClock(read.avgSplitS)} looks off for ${read.machine}`, true));
    }
  }

  // Pieces: how many are on the screen, and do they add up.
  const reps = title && title.kind === 'intervals' ? title.reps : null;
  const partial = reps != null && pieces.length < reps;
  if (partial) {
    issues.push(issue('pieces_missing', 'ask',
      `The screen shows ${pieces.length} of ${reps} pieces. Scroll the list and send a photo of the rest, or tap "That's everything".`,
      `Only ${pieces.length} of ${reps} pieces visible`, false));
  } else if (pieces.length) {
    const times = pieces.map((p) => p.timeS);
    if (times.every((t) => t != null)) {
      const sum = tenths(times.reduce((a, b) => a + b, 0));
      if (Math.abs(sum - read.totalTimeS) > 0.1 * pieces.length + 0.3) {
        issues.push(issue('splits_sum', 'hold',
          `The numbers on this photo don't add up (the splits total ${formatClock(sum)} but the screen says ${formatClock(read.totalTimeS)}). ${resend} A coach has been told.`,
          `Splits total ${formatClock(sum)}, screen total ${formatClock(read.totalTimeS)}`));
      }
    }
    if (read.metersColumn !== 'none' && read.metersColumn !== 'unclear' && pieces.every((p) => p.meters != null)) {
      const sum = pieces.reduce((a, p) => a + p.meters, 0);
      if (Math.abs(sum - read.totalMeters) > 2) {
        issues.push(issue('meters_sum', 'hold',
          `The numbers on this photo don't add up (the pieces total ${sum} m but the screen says ${read.totalMeters} m). ${resend} A coach has been told.`,
          `Pieces total ${sum} m, screen total ${read.totalMeters} m`));
      }
    }
    if (reps != null) {
      const off = pieces.some((p) => (title.by === 'distance' ? p.meters != null && Math.abs(p.meters - title.value) > 2
        : p.timeS != null && Math.abs(p.timeS - title.value) > 0.3));
      if (off) issues.push(issue('pieces_vs_title', 'flag', '', `A piece differs from the workout title ${read.title}`, true));
      // Total Time on the screen includes a rest after the last piece (N rests for N pieces).
      if (read.totalTimeInclRestS != null) {
        const expect = read.totalTimeS + title.restS * reps;
        if (Math.abs(read.totalTimeInclRestS - expect) > 1.5) {
          issues.push(issue('rest_total', 'flag', '', `Total Time ${formatClock(read.totalTimeInclRestS)} vs ${formatClock(expect)} from work plus ${reps} rests`, true));
        }
      }
    }
  }

  // Date: only a screen more than 3 days from today is questioned (David, 2026-10-27).
  const shown = parseScreenDate(read.date, ctx.today);
  if (shown) {
    const days = Math.round((toUTC(ctx.today) - toUTC(shown)) / 86400000);
    if (Math.abs(days) > 3) {   // flag only: monitor clocks reset (a dead battery gives an old date), and the entry uses the day sent
      issues.push(issue('date_off', 'flag', '', `Screen date ${shown} is ${Math.abs(days)} days ${days > 0 ? 'before' : 'after'} the day sent; logged on the day sent`, true));
    }
  }

  // The same totals logged before.
  if ((ctx.priorTotals || []).some((p) => p.meters === read.totalMeters && Math.abs(p.timeS - read.totalTimeS) < 0.05)) {
    issues.push(issue('repeat_totals', 'flag', '', `Same totals already logged: ${read.totalMeters} m in ${formatClock(read.totalTimeS)}`, true));
  }

  return finish(read, issues);
}

function finish(read, issues) {
  const status = issues.some((i) => i.level === 'hold') ? 'hold' : issues.some((i) => i.level === 'ask') ? 'ask' : 'clean';
  return { read, issues, status };
}
