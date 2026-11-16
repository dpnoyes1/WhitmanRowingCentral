// On-water math (plan: Memory/projects/on-water-speedcoach-plan-2026-11-13.md, Step 0; David, 2026-11-13).
// Pure functions over the strokes and laps from lib/fit.mjs. No Sheet, network or Node-only calls.
// Times are seconds, distances meters, speeds m/s, splits seconds per 500 m. Clock times are Unix seconds.

export const WATER = {
  maxGapS: 8,            // a stroke counts toward moving time when it comes within 8 s of the one before... (David, 2026-11-13: tune on real practices)
  driftSpeed: 1.5,       // ...and the boat is above drifting speed (1.5 m/s is a 5:33/500m split)
  maxSpeed: 8,           // anything faster is a GPS jump or junk
  durations: [30, 60, 120, 240, 360, 600, 1200, 1800, 3600],   // best split by duration (30 s to 60 min); timestamps are whole seconds, so nothing shorter
  minPieceS: 30,         // a lap shorter than this, or under minPieceM, or slower than a drift, is rest, not a piece
  minPieceM: 100,
  matchStartS: 60,       // pieces on two boats match when they start within a minute...
  matchMetersPct: 10,    // ...and cover about the same distance (within 10%)...
  matchTimePct: 5,       // ...or last about the same time (within 5%, for timed pieces)
  boatFactor: { '8+': 1, '4+': 1.13 },   // a 4+ takes 1.13 x an 8+'s time (David, 2026-11-12, same as the Lineups page). Sweep only for comparisons.
  minPieces: 8,          // a rating shows only after about 8 compared pieces...
  minLineups: 4,         // ...across at least 4 different lineups (plan section 5)
};

const round1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const splitOf = (seconds, meters) => (seconds > 0 && meters > 0 ? (500 * seconds) / meters : null);

/** The strokes as steps: each stroke after the first, with the time and meters since the one before and whether the boat was rowing.
 *  Distance restarts (a new interval) and GPS jumps are handled so meters never go backwards or leap. */
export function steps(strokes, o = WATER) {
  const out = [];
  for (let i = 1; i < strokes.length; i++) {
    const a = strokes[i - 1], b = strokes[i];
    const dt = b.t - a.t;
    let dm = null;
    if (a.dist != null && b.dist != null) dm = b.dist >= a.dist ? b.dist - a.dist : b.dist;   // smaller = the monitor restarted its distance
    if (dm == null || dm > o.maxSpeed * Math.max(dt, 1) + 5) dm = b.speed != null ? b.speed * Math.max(dt, 0) : 0;
    const speed = b.speed != null ? b.speed : dt > 0 ? dm / dt : null;
    const moving = dt >= 0 && dt <= o.maxGapS && speed != null && speed >= o.driftSpeed;
    out.push({ t0: a.t, t: b.t, dt, dm, speed, rate: b.rate, moving });
  }
  return out;
}

// The first stroke of a rowing stretch took time too, though no stroke before it marks its start: credit one stroke's length (60 / rate).
const leadIn = (stroke, o) => (stroke.rate > 0 ? Math.min(60 / stroke.rate, o.maxGapS) : 0);

/** Moving time and meters (plan section 3: minutes are moving time only, meters are the full distance recorded). */
export function movement(strokes, o = WATER) {
  const st = steps(strokes, o);
  // the first stroke's own meters, when the monitor's distance starts from zero (it always has so far)
  const first = strokes[0] && strokes[0].dist != null && strokes[0].dist <= o.maxSpeed * o.maxGapS ? strokes[0].dist : 0;
  let movingS = 0, movingM = 0, meters = first, was = false;
  st.forEach((s, i) => {
    meters += s.dm;
    if (s.moving) {
      if (!was) { const a = strokes[i], lead = leadIn(a, o); movingS += lead; movingM += lead * (a.speed ?? s.speed); }
      movingS += s.dt; movingM += s.dm;
    }
    was = s.moving;
  });
  const rates = strokes.map((s) => s.rate).filter((r) => r != null && r > 0);
  return {
    elapsedS: strokes.length ? strokes[strokes.length - 1].t - strokes[0].t : 0,
    movingS: Math.round(movingS), movingM: Math.round(movingM), meters: Math.round(meters),
    avgSplitS: round1(splitOf(movingS, movingM)),
    avgRate: round1(mean(rates)),
    strokes: strokes.length,
  };
}

/** Rowing stretches: runs of moving steps, as [{ t: [..], d: [..] }] with cumulative meters, so no curve window spans a rest. */
export function segments(strokes, o = WATER) {
  const st = steps(strokes, o);
  const segs = [];
  let cur = null;
  st.forEach((s, i) => {
    if (!s.moving) { cur = null; return; }
    if (!cur) {
      const a = strokes[i], lead = Math.round(leadIn(a, o));
      cur = lead ? { t: [s.t0 - lead, s.t0], d: [0, lead * (a.speed ?? s.speed)] } : { t: [s.t0], d: [0] };
      segs.push(cur);
    }
    const last = cur.d[cur.d.length - 1];
    if (s.dt === 0) { cur.d[cur.d.length - 1] = last + s.dm; return; }
    cur.t.push(s.t); cur.d.push(last + s.dm);
  });
  return segs;
}

// Meters at second k inside a segment, by straight line between strokes.
function perSecond(seg) {
  const t0 = seg.t[0], n = seg.t[seg.t.length - 1] - t0;
  const d = new Float64Array(n + 1);
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const t = t0 + k;
    while (j < seg.t.length - 2 && seg.t[j + 1] < t) j++;
    const ta = seg.t[j], tb = seg.t[j + 1] ?? ta, da = seg.d[j], db = seg.d[j + 1] ?? da;
    d[k] = tb > ta ? da + ((db - da) * (t - ta)) / (tb - ta) : db;
  }
  return { t0, d };
}

/** Best average split the boat held for each duration (plan section 4), with the stroke rate over that stretch.
 *  [{ durS, splitS, meters, rate, at }] for each duration that fits inside one rowing stretch. */
export function bestSplits(strokes, o = WATER) {
  const series = segments(strokes, o).map(perSecond);
  const out = [];
  for (const D of o.durations) {
    let best = null;
    for (const { t0, d } of series) {
      for (let k = 0; k + D < d.length; k++) {
        const m = d[k + D] - d[k];
        if (!best || m > best.m) best = { m, at: t0 + k };
      }
    }
    if (!best || best.m <= 0) continue;
    const rates = strokes.filter((s) => s.t > best.at && s.t <= best.at + D && s.rate > 0).map((s) => s.rate);
    out.push({ durS: D, splitS: round1(splitOf(D, best.m)), meters: Math.round(best.m), rate: round1(mean(rates)), at: best.at });
  }
  return out;
}

/** Season-best curve: for each duration, the fastest point from any of the curves given (each point keeps its own date or session). */
export function bestCurve(curves) {
  const by = new Map();
  for (const c of curves) for (const p of c.points || c) {
    const cur = by.get(p.durS);
    if (p.splitS != null && (!cur || p.splitS < cur.splitS)) by.set(p.durS, { ...p, from: c.from ?? p.from ?? null });
  }
  return [...by.values()].sort((a, b) => a.durS - b.durS);
}

/** The work pieces in a file: each lap that is real work (rest laps, if a monitor writes them, are dropped). Stats come from the strokes inside the
 *  lap where there are any, else from the lap itself. */
export function piecesOf(fit, o = WATER) {
  const out = [];
  for (const lap of fit.laps || []) {
    const end = lap.end ?? (lap.start + (lap.elapsedS ?? lap.timerS ?? 0));
    const inLap = fit.strokes.filter((s) => s.t >= lap.start && s.t <= end);
    let workS, meters, rate, strokes;
    if (inLap.length >= 3) {
      const mv = movement(inLap, o);
      workS = mv.movingS; meters = mv.meters; rate = mv.avgRate; strokes = inLap.length;
      if (lap.timerS && Math.abs(lap.timerS - workS) <= Math.max(3, lap.timerS * 0.05)) workS = lap.timerS;   // the monitor's own piece time, when it agrees
      if (lap.meters && Math.abs(lap.meters - meters) <= Math.max(10, lap.meters * 0.03)) meters = lap.meters;
    } else {
      workS = lap.timerS ?? lap.elapsedS; meters = lap.meters; rate = lap.avgRate; strokes = lap.strokes;
    }
    if (!(workS >= o.minPieceS) || !(meters >= o.minPieceM) || meters / workS < o.driftSpeed) continue;
    out.push({ n: out.length + 1, start: lap.start, workS: round1(workS), meters: Math.round(meters), splitS: round1(splitOf(workS, meters)), rate: round1(rate), strokes });
  }
  return out;
}

/** What kind of file this looks like: 'Pieces' (two or more work laps), 'Race' (one hard continuous piece) or 'Practice'. The coach confirms it. */
export function guessKind(fit, o = WATER) {
  const pieces = piecesOf(fit, o);
  if (pieces.length >= 2) return 'Pieces';
  const mv = movement(fit.strokes, o);
  if (mv.elapsedS > 0 && mv.movingS / mv.elapsedS >= 0.9 && mv.avgRate >= 28 && mv.meters >= 900 && mv.meters <= 6500) return 'Race';
  return 'Practice';
}

/** One row per file for the Water sessions tab (plan Step 2), apart from the boat, lineup and import details the page adds. */
export function summarize(fit, kind = null, o = WATER) {
  const mv = movement(fit.strokes, o);
  const k = kind || guessKind(fit, o);
  let pieces = k === 'Pieces' ? piecesOf(fit, o) : [];
  if (k === 'Race' && mv.movingS > 0) {
    const s = fit.strokes;
    pieces = [{ n: 1, start: s[0].t, workS: round1(mv.movingS), meters: mv.meters, splitS: round1(splitOf(mv.movingS, mv.meters)), rate: mv.avgRate, strokes: s.length }];
  }
  return {
    unit: fit.unit, start: fit.start, kind: k,
    elapsedS: mv.elapsedS, movingS: mv.movingS, meters: mv.meters,
    avgSplitS: k === 'Race' ? round1(splitOf(mv.movingS, mv.meters)) : mv.avgSplitS,
    avgRate: mv.avgRate, strokes: mv.strokes,
    pieces, curve: bestSplits(fit.strokes, o),
    warnings: fit.warnings || [],
  };
}

// ---- section 5, step one: fair results within a practice ---------------------------------------------------------

/** Groups pieces that boats rowed side by side. sessions: [{ id, boatClass, pieces: [{ id?, n, start, workS, meters }] }].
 *  Returns [{ id, start, results: [{ sessionId, pieceId, boatClass, workS, meters, splitS, adjSplitS, marginPct, place }] }],
 *  only groups with two or more boats. adjSplitS puts a 4+ on the 8+ scale; marginPct is against the piece's average (+ = faster);
 *  boats of a class with no factor (sculling, for now) are listed but get no adjusted split, margin or place. */
export function matchPieces(sessions, o = WATER) {
  const all = [];
  for (const s of sessions) for (const p of s.pieces || []) all.push({ s, p });
  all.sort((a, b) => a.p.start - b.p.start);
  const groups = [];
  for (const it of all) {
    const g = groups.find((g) => Math.abs(g.anchor.start - it.p.start) <= o.matchStartS && !g.items.some((x) => x.s.id === it.s.id) &&
      (Math.abs(it.p.meters - g.anchor.meters) <= (g.anchor.meters * o.matchMetersPct) / 100 ||
       Math.abs(it.p.workS - g.anchor.workS) <= Math.max(5, (g.anchor.workS * o.matchTimePct) / 100)));
    if (g) g.items.push(it); else groups.push({ anchor: it.p, items: [it] });
  }
  return groups.filter((g) => g.items.length >= 2).map((g, gi) => {
    const results = g.items.map(({ s, p }) => {
      const splitS = splitOf(p.workS, p.meters), f = o.boatFactor[s.boatClass];
      return { sessionId: s.id, pieceId: p.id ?? s.id + ':' + p.n, boatClass: s.boatClass, workS: p.workS, meters: p.meters,
        splitS: round1(splitS), adjSplitS: f ? splitS / f : null };
    });
    const fair = results.filter((r) => r.adjSplitS != null);
    const avg = fair.length >= 2 ? mean(fair.map((r) => r.adjSplitS)) : null;
    const order = [...fair].sort((a, b) => a.adjSplitS - b.adjSplitS);
    for (const r of results) {
      r.marginPct = avg && r.adjSplitS != null ? Math.round(((avg - r.adjSplitS) / avg) * 1000) / 10 : null;
      r.place = avg && r.adjSplitS != null ? order.indexOf(r) + 1 : null;
      r.adjSplitS = round1(r.adjSplitS);
    }
    return { id: 'G' + (gi + 1), start: g.anchor.start, results };
  });
}

// ---- section 5, step two: who generally wins ---------------------------------------------------------------------

// Boat results usable for ratings: in a matched piece, a sweep boat with a margin and a lineup.
// results: [{ groupId, boatClass, marginPct, place, rowers: [ids], shell?, cox?, lineupKey? }]
const usable = (results, o) => results.filter((r) => o.boatFactor[r.boatClass] && r.marginPct != null && r.rowers && r.rowers.length);
const lineupKey = (r) => r.lineupKey || [...r.rowers].sort().join(',');

/** Win record and average margin per rower (method 1). Flatters whoever sits with strong crews; shown beside the adjusted rating. */
export function winRecord(results, o = WATER) {
  const by = new Map();
  for (const r of usable(results, o)) for (const id of r.rowers) {
    const x = by.get(id) || { id, pieces: 0, wins: 0, margins: [], lineups: new Set() };
    x.pieces++; if (r.place === 1) x.wins++; x.margins.push(r.marginPct); x.lineups.add(lineupKey(r));
    by.set(id, x);
  }
  return [...by.values()].map((x) => ({ id: x.id, pieces: x.pieces, wins: x.wins, avgMarginPct: round1(mean(x.margins)), lineups: x.lineups.size }))
    .sort((a, b) => b.avgMarginPct - a.avgMarginPct);
}

// Solves (A + lambda I) x = b by Gaussian elimination. A is small (one row per rower, shell and cox).
function solve(A, b, lambda) {
  const n = b.length, M = A.map((row, i) => [...row.map((v, j) => v + (i === j ? lambda : 0)), b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / piv; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

// Seeded random numbers, so ranges are the same every run.
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

function fitEffects(groups, cols, ridge) {
  const n = cols.length, idx = new Map(cols.map((c, i) => [c, i]));
  const A = Array.from({ length: n }, () => new Array(n).fill(0)), b = new Array(n).fill(0);
  for (const g of groups) {
    // each boat's row: 1/k for each rower (a boat is the average of its seats), 1 for its shell and cox; then centered within the piece,
    // so the day's water and the piece's overall pace drop out
    const rows = g.map((r) => {
      const x = new Map();
      for (const id of r.rowers) x.set('r:' + id, (x.get('r:' + id) || 0) + 1 / r.rowers.length);
      if (r.shell && idx.has('s:' + r.shell)) x.set('s:' + r.shell, 1);
      if (r.cox && idx.has('c:' + r.cox)) x.set('c:' + r.cox, 1);
      return { x, y: r.marginPct };
    });
    const avg = new Map();
    for (const { x } of rows) for (const [k, v] of x) avg.set(k, (avg.get(k) || 0) + v / rows.length);
    const yAvg = mean(rows.map((r) => r.y));
    for (const { x, y } of rows) {
      const v = new Array(n).fill(0);
      for (const [k, a] of avg) v[idx.get(k)] -= a;
      for (const [k, a] of x) v[idx.get(k)] += a;
      const yy = y - yAvg;
      for (let i = 0; i < n; i++) if (v[i]) { b[i] += v[i] * yy; for (let j = 0; j < n; j++) if (v[j]) A[i][j] += v[i] * v[j]; }
    }
  }
  const diag = mean(A.map((row, i) => row[i]).filter((v) => v > 0)) || 1;
  return solve(A, b, ridge * diag);
}

/** Adjusted rating (method 2, like adjusted plus-minus): each boat's margin is the average of its rowers' effects (+ shell and cox effects when
 *  asked), fitted over every compared piece at once, so who you sat with is accounted for. rating is in margin %: a boat of rowers like her would
 *  beat the field by that much. range is the 10th to 90th percentile over 200 resamples of the pieces; a gap inside it means nothing.
 *  status 'too early' until minPieces pieces across minLineups lineups. together lists rowers who always sat together and cannot be told apart. */
export function adjustedRatings(results, opts = {}, o = WATER) {
  const { shells = false, coxes = false, ridge = 0.05, resamples = 200, seed = 7 } = opts;
  const rs = usable(results, o);
  const groups = [...rs.reduce((m, r) => m.set(r.groupId, [...(m.get(r.groupId) || []), r]), new Map()).values()].filter((g) => g.length >= 2);
  const rowers = [...new Set(groups.flat().flatMap((r) => r.rowers))].sort();
  const cols = [...rowers.map((id) => 'r:' + id),
    ...(shells ? [...new Set(groups.flat().map((r) => r.shell).filter(Boolean))].map((s) => 's:' + s) : []),
    ...(coxes ? [...new Set(groups.flat().map((r) => r.cox).filter(Boolean))].map((c) => 'c:' + c) : [])];
  if (!cols.length) return { rowers: [], shells: [], coxes: [], together: [], pieces: 0 };
  const est = fitEffects(groups, cols, ridge);

  const rand = rng(seed), boot = cols.map(() => []);
  for (let k = 0; k < resamples; k++) {
    const sample = groups.map(() => groups[Math.floor(rand() * groups.length)]);
    fitEffects(sample, cols, ridge).forEach((v, i) => boot[i].push(v));
  }
  const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]; };

  // rowers who appear in exactly the same boat results cannot be separated
  const seen = new Map();
  groups.flat().forEach((r, i) => { for (const id of r.rowers) seen.set(id, [...(seen.get(id) || []), i]); });
  const bySig = new Map();
  for (const [id, list] of seen) { const k = list.join(','); bySig.set(k, [...(bySig.get(k) || []), id]); }
  const together = [...bySig.values()].filter((g) => g.length >= 2).map((g) => g.sort());
  const twinOf = new Map(together.flatMap((g) => g.map((id) => [id, g.filter((x) => x !== id)])));

  const rec = new Map(winRecord(rs, o).map((w) => [w.id, w]));
  const row = (c, i) => ({ rating: round1(est[i]), range: [round1(pct(boot[i], 0.1)), round1(pct(boot[i], 0.9))] });
  return {
    pieces: groups.length,
    rowers: rowers.map((id) => {
      const i = cols.indexOf('r:' + id), w = rec.get(id);
      const early = w.pieces < o.minPieces || w.lineups < o.minLineups;
      return { id, ...row('r:' + id, i), pieces: w.pieces, lineups: w.lineups, wins: w.wins, avgMarginPct: w.avgMarginPct,
        status: early ? 'too early' : 'ok', sameAs: twinOf.get(id) || [] };
    }).sort((a, b) => (a.status === b.status ? b.rating - a.rating : a.status === 'ok' ? -1 : 1)),
    shells: cols.map((c, i) => [c, i]).filter(([c]) => c.startsWith('s:')).map(([c, i]) => ({ shell: c.slice(2), ...row(c, i) })),
    coxes: cols.map((c, i) => [c, i]).filter(([c]) => c.startsWith('c:')).map(([c, i]) => ({ cox: c.slice(2), ...row(c, i) })),
    together,
  };
}
