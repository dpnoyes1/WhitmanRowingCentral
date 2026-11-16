/**
 * Display names (David, 2026-11-16): first name only, plus a last initial when two
 * athletes share a first name ("Madeleine B."); if first name and initial still clash,
 * the full name. Applied to the API's responses only. The sign-in, the Sheet and every
 * id-based lookup keep using full names.
 */
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Map of full name -> display name for every athlete in the feed. */
export function displayNames(athletes) {
  const parts = (athletes || []).map((a) => {
    const full = clean(a.name);
    const bits = full.split(' ');
    const first = bits[0] || '';
    const last = bits.length > 1 ? bits[bits.length - 1] : '';
    return { full, first, initial: last ? last[0].toUpperCase() : '' };
  }).filter((p) => p.full);
  const count = (key) => parts.reduce((m, p) => m.set(key(p), (m.get(key(p)) || 0) + 1), new Map());
  const firsts = count((p) => p.first.toLowerCase());
  const withInitial = count((p) => `${p.first.toLowerCase()} ${p.initial}`);
  const out = new Map();
  parts.forEach((p) => {
    if (out.has(p.full)) return;
    if (firsts.get(p.first.toLowerCase()) === 1 || !p.initial) out.set(p.full, p.first);
    else if (withInitial.get(`${p.first.toLowerCase()} ${p.initial}`) === 1) out.set(p.full, `${p.first} ${p.initial}.`);
    else out.set(p.full, p.full);
  });
  return out;
}

/** Copy of a JSON value with every string that is exactly a full athlete name replaced by its display name. */
export function shortenNames(value, names) {
  if (!names || !names.size) return value;
  const walk = (v) => {
    if (typeof v === 'string') return names.has(v) ? names.get(v) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v)) o[k] = walk(v[k]);
      return o;
    }
    return v;
  };
  return walk(value);
}
