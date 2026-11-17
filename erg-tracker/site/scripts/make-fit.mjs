// Made-up FIT files for the on-water tests (plan Step 0). Real Whitman files are only checked by hand and never go in the repo.
// writeFit(spec) -> Uint8Array in the same layout NK's exports use (file_id, records, laps, session; little-endian).
// The practice and pieces generators are seeded, so every run makes the same file.
// CLI: node erg-tracker/site/scripts/make-fit.mjs <out-dir>   writes the sample files there (for trying the import page by hand).
import { fitCrc, FIT_EPOCH } from '../lib/fit.mjs';

const T = { enum: [0x00, 1], u8: [0x02, 1], u16: [0x84, 2], s32: [0x85, 4], u32: [0x86, 4], u32z: [0x8c, 4], str16: [0x07, 16] };
const INVALID = { enum: 0xff, u8: 0xff, u16: 0xffff, s32: 0x7fffffff, u32: 0xffffffff, u32z: 0 };

// [field number, type, value(spec) ] per message
const LAYOUT = {
  file_id: [0, [[0, 'enum', () => 4], [1, 'u16', (s) => s.manufacturer ?? 255], [2, 'u16', (s) => s.product ?? 0], [3, 'u32z', (s) => s.serial ?? null], [4, 'u32', (s) => s.start - FIT_EPOCH]]],
  record: [20, [[253, 'u32', (r) => r.t - FIT_EPOCH], [5, 'u32', (r) => (r.dist == null ? null : Math.round(r.dist * 100))], [6, 'u16', (r) => (r.speed == null ? null : Math.min(65534, Math.round(r.speed * 1000)))],
    [4, 'u8', (r) => r.rate ?? null], [0, 's32', (r) => (r.lat == null ? null : Math.round((r.lat * 2 ** 31) / 180))], [1, 's32', (r) => (r.lon == null ? null : Math.round((r.lon * 2 ** 31) / 180))],
    [19, 'u32', (r) => r.count ?? null]]],
  lap: [19, [[253, 'u32', (l) => l.end - FIT_EPOCH], [2, 'u32', (l) => l.start - FIT_EPOCH], [7, 'u32', (l) => Math.round(l.elapsedS * 1000)], [8, 'u32', (l) => Math.round(l.timerS * 1000)],
    [9, 'u32', (l) => Math.round(l.meters * 100)], [10, 'u32', (l) => l.strokes ?? null], [13, 'u16', (l) => Math.round((l.meters / l.timerS) * 1000)], [17, 'u8', (l) => l.avgRate ?? null]]],
  session: [18, [[253, 'u32', (s) => s.end - FIT_EPOCH], [2, 'u32', (s) => s.start - FIT_EPOCH], [5, 'enum', () => 15], [7, 'u32', (s) => Math.round(s.elapsedS * 1000)],
    [8, 'u32', (s) => Math.round(s.timerS * 1000)], [9, 'u32', (s) => Math.round(s.meters * 100)], [10, 'u32', (s) => s.strokes ?? null]]],
};

function put(arr, type, v) {
  const [, size] = T[type];
  if (v == null) v = INVALID[type];
  for (let i = 0; i < size; i++) arr.push((v >>> (8 * i)) & 0xff);
}

/** spec: { serial?, start, strokes: [{ t, dist, speed, rate, lat?, lon? }], laps?: [{ start, end, elapsedS, timerS, meters, strokes, avgRate }],
 *  omitSerial?, omitSession?, cutAt? (bytes to keep, for a damaged-file test) } */
export function writeFit(spec) {
  const body = [];
  const define = (local, name) => {
    const [num, fields] = LAYOUT[name];
    body.push(0x40 | local, 0, 0, num & 0xff, num >> 8, fields.length);
    for (const [f, type] of fields) body.push(f, T[type][1], T[type][0]);
  };
  const data = (local, name, obj) => { body.push(local); for (const [, type, get] of LAYOUT[name][1]) put(body, type, get(obj)); };

  define(0, 'file_id'); data(0, 'file_id', { ...spec, serial: spec.omitSerial ? null : spec.serial });
  define(1, 'record'); for (const r of spec.strokes) data(1, 'record', r);
  if (spec.laps && spec.laps.length) { define(2, 'lap'); for (const l of spec.laps) data(2, 'lap', l); }
  if (!spec.omitSession) {
    const s = spec.strokes, first = s[0], last = s[s.length - 1];
    const timerS = spec.laps && spec.laps.length ? spec.laps.reduce((a, l) => a + l.timerS, 0) : last.t - first.t;
    const meters = spec.laps && spec.laps.length ? spec.laps.reduce((a, l) => a + l.meters, 0) : last.dist - first.dist;
    define(3, 'session'); data(3, 'session', { start: spec.start, end: last.t, elapsedS: last.t - spec.start, timerS, meters, strokes: s.length });
  }
  const header = [14, 0x20, 0x08, 0x08, ...[0, 1, 2, 3].map((i) => (body.length >>> (8 * i)) & 0xff), 0x2e, 0x46, 0x49, 0x54];
  const hcrc = fitCrc(Uint8Array.from(header));
  header.push(hcrc & 0xff, hcrc >> 8);
  const all = Uint8Array.from([...header, ...body]);
  const crc = fitCrc(all);
  const out = Uint8Array.from([...all, crc & 0xff, crc >> 8]);
  return spec.cutAt ? out.subarray(0, spec.cutAt) : out;
}

// ---- made-up sessions ----------------------------------------------------------------------------------------------
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

/** Strokes for a list of stretches: [{ kind: 'row', s, splitS, rate } | { kind: 'spin', s } (records every 3 s, nearly still)
 *  | { kind: 'sit', s } (no records at all) ]. Whole-second timestamps, like the real files. resetEachRow restarts distance each 'row'. */
export function strokesFor(start, stretches, { seed = 1, resetEachRow = false, firstJunk = false, lat = 38.9, lon = -77.07 } = {}) {
  const rand = rng(seed), out = [];
  let t = start, dist = 0, count = 0;
  for (const st of stretches) {
    if (st.kind === 'sit') { t += st.s; continue; }
    if (st.kind === 'spin') {
      for (let k = 0; k < st.s; k += 3) { t += 3; dist += 0.6 * 3; out.push({ t: Math.round(t), dist, speed: 0.6, rate: 0, lat, lon }); }
      continue;
    }
    if (resetEachRow) dist = 0;
    const speed0 = 500 / st.splitS, gap = 60 / st.rate, end = t + st.s;
    while (t + gap <= end + 1e-9) {
      const speed = speed0 * (1 + (rand() - 0.5) * 0.02);
      t += gap; dist += speed * gap; count++;
      out.push({ t: Math.round(t), dist, speed, rate: st.rate, count, lat: lat + dist / 111000, lon });
    }
    t = end;
  }
  if (firstJunk && out.length) out[0] = { ...out[0], speed: 254 };
  return out;
}

/** A continuous 90-minute practice: warm-up, steady state with spins and a sit, cool-down. */
export function practiceFit({ serial = 3121111, start = Date.UTC(2027, 1, 3, 20, 45) / 1000, seed = 1, splitS = 130 } = {}) {
  const stretches = [
    { kind: 'row', s: 600, splitS: 150, rate: 18 }, { kind: 'spin', s: 120 }, { kind: 'sit', s: 180 },
    { kind: 'row', s: 1200, splitS, rate: 20 }, { kind: 'spin', s: 90 }, { kind: 'sit', s: 240 },
    { kind: 'row', s: 1200, splitS: splitS - 4, rate: 22 }, { kind: 'spin', s: 150 },
    { kind: 'row', s: 600, splitS: 155, rate: 18 }, { kind: 'sit', s: 1020 },
  ];
  const strokes = strokesFor(start, stretches, { seed, firstJunk: true });
  return { spec: { serial, start, strokes }, stretches };
}

/** A set-piece day: n pieces of the given meters at the given split, rest not recorded (like a programmed SpeedCoach workout),
 *  distance restarting each piece, one lap per piece. pieceStarts (seconds after start, one per piece) starts every boat's piece on the
 *  coach's "go" instead of a fixed rest after it finishes. */
export function piecesFit({ serial = 3121111, start = Date.UTC(2027, 1, 4, 21, 0) / 1000, splits = [100, 101, 99], meters = 1000, rate = 32, restS = 240, seed = 3, omitSerial = false, pieceStarts = null } = {}) {
  const strokes = [], laps = [];
  let t = start;
  splits.forEach((splitS, i) => {
    if (pieceStarts) t = start + pieceStarts[i];
    const s = (meters / 500) * splitS;
    const part = strokesFor(t, [{ kind: 'row', s, splitS, rate }], { seed: seed + i, resetEachRow: true });
    strokes.push(...part);
    const last = part[part.length - 1];
    laps.push({ start: Math.round(t), end: last.t, elapsedS: last.t - Math.round(t), timerS: last.t - Math.round(t), meters: Math.round(last.dist), strokes: part.length, avgRate: rate });
    t += s + restS;
  });
  return { spec: { serial, start, strokes, laps, omitSerial } };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = process.argv[2] || '.';
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    'FAKE_SpeedCoach_3121111_practice.fit': practiceFit().spec,
    'FAKE_SpeedCoach_3121111_pieces.fit': piecesFit().spec,
    'FAKE_CoxBox_011009863_pieces.fit': piecesFit({ serial: null, omitSerial: true, splits: [102, 103, 100], seed: 9 }).spec,
  };
  for (const [name, spec] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), writeFit(spec));
  console.log('Wrote ' + Object.keys(files).length + ' made-up FIT files to ' + dir);
}
