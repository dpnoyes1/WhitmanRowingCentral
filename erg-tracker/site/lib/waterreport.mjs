// Coaches' on-water results (plan Steps 3 and 4). Pure: takes what the Sheet's water-report action sends (sessions, pieces, lineups)
// and builds the page: one day's boats and side-by-side pieces, season-best curves, and who generally wins. Never in the athlete feed.
import { WATER, matchPieces, bestCurve, winRecord, adjustedRatings, gmsSlope } from './water.mjs';

export const RATE_KEYS = { all: 'Any rate', r20: '20 and under', r24: '24 and under', r28: '28 and under' };
const unix = (iso) => (iso ? Math.round(Date.parse(iso) / 1000) : null);
const seated = (l) => (l ? l.seats.filter(Boolean) : []);

/** Names by athlete ID, from the lineups' seat and cox names. */
function namesOf(lineups) {
  const n = {};
  for (const l of lineups) {
    l.seats.forEach((id, k) => { if (id && l.seatNames && l.seatNames[k]) n[id] = l.seatNames[k]; });
    if (l.cox && l.coxName) n[l.cox] = l.coxName;
  }
  return n;
}

/** Sessions with their pieces (Unix starts) and the lineup each credits. */
export function joinSessions(raw) {
  const lineupById = new Map((raw.lineups || []).map((l) => [l.lineupId, l]));
  return (raw.sessions || []).map((s) => ({
    ...s, startUnix: unix(s.start),
    lineup: lineupById.get(s.lineupId) || null,
    pieces: (raw.pieces || []).filter((p) => p.sessionId === s.sessionId).sort((a, b) => a.n - b.n)
      .map((p) => ({ id: p.pieceId, n: p.n, start: unix(p.start), workS: p.workS, meters: p.meters, splitS: p.splitS, rate: p.rate, lineup: lineupById.get(p.lineupId) || lineupById.get(s.lineupId) || null })),
  }));
}

/** Matched pieces for one day: rowed side by side (start within a minute, same distance or time), adjusted to the 8+ scale, with margins. */
export function dayGroups(sessions, date, o = WATER) {
  const day = sessions.filter((s) => s.date === date && s.kind !== 'Practice' && s.pieces.length);
  const byId = new Map(day.map((s) => [s.sessionId, s]));
  return matchPieces(day.map((s) => ({ id: s.sessionId, boatClass: s.boatClass, pieces: s.pieces })), o).map((g) => ({
    id: date + ':' + g.id, start: g.start,
    results: g.results.map((r) => {
      const s = byId.get(r.sessionId), p = s.pieces.find((x) => x.id === r.pieceId) || {};
      return { ...r, boatName: s.boatName, n: p.n, rate: p.rate, lineup: p.lineup || s.lineup };
    }).sort((a, b) => (a.place ?? 99) - (b.place ?? 99)),
  }));
}

/** Boat results for the ratings: every matched sweep piece in the range, with its rowers, shell and cox. */
export function ratingResults(sessions, o = WATER) {
  const dates = [...new Set(sessions.map((s) => s.date))].sort();
  const out = [];
  for (const d of dates) for (const g of dayGroups(sessions, d, o)) for (const r of g.results) {
    if (!o.boatFactor[r.boatClass] || r.marginPct == null || !r.lineup) continue;
    out.push({ groupId: g.id, day: d, boatClass: r.boatClass, marginPct: r.marginPct, place: r.place, rowers: seated(r.lineup), shell: r.boatName, cox: r.lineup.cox || '', lineupKey: r.lineup.lineupId });
  }
  return out;
}

/** Which compared pieces count toward "Who wins". gms: { id: GMS % }; overrides: { 'YYYY-MM-DD': 'Count' | 'Leave out' } (the coach's choice
 *  for a day; anything else is automatic). Automatic rule, per piece: keep the largest set of boats whose average GMS are all within evenGmsPts
 *  of each other (a deliberately lower 4+ is left out, the even 8s still count), boats missing more than maxMissingGms GMS % are left out, and
 *  the piece is left out when the exact same crews raced on progressionDays+ days. Margins and places are re-figured among the boats kept.
 *  Returns { used: results that count, pieces: { groupId: { counts, reason, gap, boats: { boatName: counts } } } }. */
export function gatePieces(results, gms = {}, overrides = {}, o = WATER) {
  const byGroup = [...results.reduce((m, r) => m.set(r.groupId, [...(m.get(r.groupId) || []), r]), new Map())];
  const crews = (rs) => rs.map((r) => [...r.rowers].sort().join(',')).sort().join(' | ');
  const daysOf = new Map();
  for (const [, rs] of byGroup) { const k = crews(rs); daysOf.set(k, new Set([...(daysOf.get(k) || []), rs[0].day])); }
  const avgOf = (r) => { const v = r.rowers.map((x) => gms[x]).filter((x) => x != null); return { avg: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, missing: r.rowers.length - v.length }; };
  const pieces = {}, used = [];
  for (const [id, rs] of byGroup) {
    const info = rs.map((r) => ({ r, ...avgOf(r) }));
    const judged = info.filter((b) => b.avg != null && b.missing <= o.maxMissingGms).sort((a, b) => a.avg - b.avg);
    let keep = [];
    for (let i = 0; i < judged.length; i++) {   // widest run of boats within evenGmsPts (more boats first, then the closest)
      let j = i; while (j + 1 < judged.length && judged[j + 1].avg - judged[i].avg <= o.evenGmsPts + 1e-9) j++;
      const run = judged.slice(i, j + 1);
      if (run.length > keep.length || (run.length === keep.length && run.length && run[run.length - 1].avg - run[0].avg < keep[keep.length - 1].avg - keep[0].avg)) keep = run;
    }
    const all = info.filter((b) => b.avg != null).map((b) => b.avg);
    const gap = all.length >= 2 ? Math.round((Math.max(...all) - Math.min(...all)) * 10) / 10 : null;
    const nDays = daysOf.get(crews(rs)).size, ov = overrides[rs[0].day];
    let chosen = keep.length >= 2 ? keep.map((b) => b.r) : [], reason;
    if (ov === 'Count') { chosen = rs; reason = 'counted by a coach'; }
    else if (ov === 'Leave out') { chosen = []; reason = 'left out by a coach'; }
    else if (nDays >= o.progressionDays) { chosen = []; reason = `same crews on ${nDays} days (progression)`; }
    else if (!chosen.length) reason = judged.length < 2 ? 'a boat has too many rowers with no GMS %' : `not even: boats ${gap} GMS points apart`;
    else if (chosen.length < rs.length) {
      const out = info.filter((b) => !chosen.includes(b.r)).map((b) => (b.avg == null || b.missing > o.maxMissingGms ? `${b.r.shell} (no GMS %)` : `${b.r.shell} (${Math.round(Math.abs(b.avg - keep[0].avg) * 10) / 10}+ GMS points off)`));
      reason = `even boats count; left out: ${out.join(', ')}`;
    } else reason = `even: boats ${gap} GMS points apart`;
    pieces[id] = { counts: chosen.length >= 2, reason, gap, boats: Object.fromEntries(rs.map((r) => [r.shell, chosen.includes(r)])) };
    if (chosen.length >= 2) {
      const avg = chosen.reduce((a, r) => a + r.marginPct, 0) / chosen.length, best = Math.max(...chosen.map((r) => r.marginPct));
      chosen.forEach((r) => used.push({ ...r, marginPct: Math.round((r.marginPct - avg) * 100) / 100, place: r.marginPct === best ? 1 : 2 }));
    }
  }
  return { used, pieces };
}

/** Season-best curves at one rate key: per boat (as rowed), per class, and per athlete (the best of any sweep boat she sat in, on the 8+ scale). */
export function seasonCurves(sessions, rateKey = 'all', o = WATER) {
  const pts = (s) => ((s.curve && s.curve[rateKey]) || []).map((p) => ({ ...p, from: s.date }));
  const group = (keyOf) => {
    const m = new Map();
    for (const s of sessions) { const k = keyOf(s); if (k) m.set(k, [...(m.get(k) || []), { from: s.date, points: pts(s) }]); }
    return m;
  };
  const byBoat = [...group((s) => s.boatName + '|' + s.boatClass)].map(([k, cs]) => ({ boatName: k.split('|')[0], boatClass: k.split('|')[1], points: bestCurve(cs) }));
  const byClass = [...group((s) => s.boatClass)].map(([k, cs]) => ({ boatClass: k, points: bestCurve(cs) }));
  const ath = new Map();
  for (const s of sessions) {
    const f = o.boatFactor[s.boatClass];
    if (!f || !s.lineup) continue;
    const adj = pts(s).map((p) => ({ ...p, splitS: Math.round((p.splitS / f) * 10) / 10, boatName: s.boatName }));
    for (const id of seated(s.lineup)) ath.set(id, [...(ath.get(id) || []), { from: s.date, points: adj }]);
  }
  const names = namesOf(sessions.map((s) => s.lineup).filter(Boolean));
  const byAthlete = [...ath].map(([id, cs]) => ({ id, name: names[id] || id, points: bestCurve(cs) })).sort((a, b) => a.name.localeCompare(b.name));
  return { byBoat, byClass, byAthlete };
}

/** The whole page for a date (YYYY-MM-DD) and rate key, from the Sheet's water-report answer for the season so far.
 *  extra.gms: { id: GMS % } (season bests, from the feed) for the even-lineup rule and the erg part of each rating. */
export function waterReportView(raw, date, rateKey = 'all', extra = {}, o = WATER) {
  const gms = extra.gms || {};
  const sessions = joinSessions(raw);
  const days = [...new Set(sessions.map((s) => s.date))].sort().reverse();
  const d = days.includes(date) ? date : days[0] || date;
  const names = namesOf(raw.lineups || []);
  const crew = (l) => (l ? { names: seated(l).map((id) => names[id] || id), cox: l.cox ? names[l.cox] || l.cox : '' } : null);
  const boats = sessions.filter((s) => s.date === d).sort((a, b) => a.startUnix - b.startUnix).map((s) => ({
    sessionId: s.sessionId, boatName: s.boatName, boatClass: s.boatClass, kind: s.kind, start: s.start,
    movingS: s.movingS, meters: s.meters, avgSplitS: s.avgSplitS, avgRate: s.avgRate, pieces: s.pieces.length, crew: crew(s.lineup),
    curve: (s.curve && s.curve[rateKey]) || [],
  }));
  const overrides = {};
  sessions.forEach((s) => { if (s.ratingsUse === 'Count' || s.ratingsUse === 'Leave out') overrides[s.date] = s.ratingsUse; });
  const results = ratingResults(sessions, o);
  const gate = gatePieces(results, gms, overrides, o);
  const fit = gmsSlope(results, gms, {}, o);   // from every compared piece, progression included
  const r = adjustedRatings(gate.used, { shells: true, coxes: true, gms, slope: fit.slope }, o);
  const groups = dayGroups(sessions, d, o).map((g) => ({ ...g, rating: gate.pieces[g.id] || { counts: false, reason: 'not a sweep comparison with saved lineups', gap: null },
    results: g.results.map((x) => ({ ...x, crew: crew(x.lineup), lineup: undefined })) }));
  const piecesToday = sessions.filter((s) => s.date === d && s.kind !== 'Practice').reduce((a, s) => a + s.pieces.length, 0);
  const leftOut = {};
  Object.values(gate.pieces).forEach((p) => {
    const k = !p.counts ? p.reason.replace(/ \d+(\.\d+)? GMS points apart| on \d+ days/, '') : /left out:/.test(p.reason) ? 'pieces with a boat left out (not even with the others)' : null;
    if (k) leftOut[k] = (leftOut[k] || 0) + 1;
  });
  const withName = (x) => ({ ...x, name: names[x.id] || x.id });
  return {
    date: d, days, rateKey, rateKeys: RATE_KEYS, durations: o.durations,
    boats, groups, unmatchedPieces: piecesToday - groups.reduce((a, g) => a + g.results.length, 0), dayOverride: overrides[d] || 'Automatic',
    season: seasonCurves(sessions, rateKey, o),
    ratings: {
      pieces: r.pieces, days: r.days || 0, lineups: r.lineups || 0, enough: !!r.enough, minPieces: o.minPieces, minLineups: o.minLineups,
      evenGmsPts: o.evenGmsPts, progressionDays: o.progressionDays, compared: Object.keys(gate.pieces).length, leftOut,
      slope: fit.slope, slopeBasis: fit.uneven, gmsKnown: Object.keys(gms).length > 0,
      rowers: r.rowers.map(withName).map((x) => ({ ...x, sameAs: x.sameAs.map((id) => names[id] || id) })),
      shells: r.shells, coxes: r.coxes.map((c) => ({ ...c, name: names[c.cox] || c.cox })),
      together: r.together.map((g) => g.map((id) => names[id] || id)),
      record: winRecord(gate.used, o).map(withName),
    },
  };
}
