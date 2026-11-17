// Coaches' on-water results (plan Steps 3 and 4). Pure: takes what the Sheet's water-report action sends (sessions, pieces, lineups)
// and builds the page: one day's boats and side-by-side pieces, season-best curves, and who generally wins. Never in the athlete feed.
import { WATER, matchPieces, bestCurve, winRecord, adjustedRatings } from './water.mjs';

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
    out.push({ groupId: g.id, boatClass: r.boatClass, marginPct: r.marginPct, place: r.place, rowers: seated(r.lineup), shell: r.boatName, cox: r.lineup.cox || '', lineupKey: r.lineup.lineupId });
  }
  return out;
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

/** The whole page for a date (YYYY-MM-DD) and rate key, from the Sheet's water-report answer for the season so far. */
export function waterReportView(raw, date, rateKey = 'all', o = WATER) {
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
  const groups = dayGroups(sessions, d, o).map((g) => ({ ...g, results: g.results.map((r) => ({ ...r, crew: crew(r.lineup), lineup: undefined })) }));
  const piecesToday = sessions.filter((s) => s.date === d && s.kind !== 'Practice').reduce((a, s) => a + s.pieces.length, 0);
  const results = ratingResults(sessions, o);
  const r = adjustedRatings(results, { shells: true, coxes: true }, o);
  const withName = (x) => ({ ...x, name: names[x.id] || x.id });
  return {
    date: d, days, rateKey, rateKeys: RATE_KEYS, durations: o.durations,
    boats, groups, unmatchedPieces: piecesToday - groups.reduce((a, g) => a + g.results.length, 0),
    season: seasonCurves(sessions, rateKey, o),
    ratings: {
      pieces: r.pieces, minPieces: o.minPieces, minLineups: o.minLineups,
      rowers: r.rowers.map(withName).map((x) => ({ ...x, sameAs: x.sameAs.map((id) => names[id] || id) })),
      shells: r.shells, coxes: r.coxes.map((c) => ({ ...c, name: names[c.cox] || c.cox })),
      together: r.together.map((g) => g.map((id) => names[id] || id)),
      record: winRecord(results, o).map(withName),
    },
  };
}
