// "Is there practice today?" box (David, 2026-11-02). Reads the same Google Sheet as
// iswhitmanrowingtoday.com, live in the browser, using the visitor's local date.
// Nothing here touches the Sheet's data or this tracker's feed. Pure logic is exported
// for tests/run.mjs; loadPractice() is the only part that needs a browser.

export const SHEET_ID = '1c_h72UnGtO8P7U2iy6oPifMRiUG_rVsxAQlHhlyRCZ0';
export const SEASONS_GID = 0;
export const OVERRIDES_GID = 884628836;   // "Form Responses 1" (the legacy Override tab is ignored)
export const TIMEOUT_MS = 8000;

// Winter practices run in two shifts, Girls and Boys on opposite ones.
export const WINTER_SHIFTS = {
  early: '3:30–5:30 PM',
  late: '5:00–7:00 PM'
};
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const pad = (n) => String(n).padStart(2, '0');

/** Local date as YYYY-MM-DD. */
export function localIso(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "November 18, 2026", "11/4/2026" or "2026-11-04" -> "2026-11-18"; '' when unreadable. */
export function parseSheetDate(text) {
  const s = String(text ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  m = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mi = MONTHS.findIndex((x) => x.startsWith(m[1].toLowerCase().slice(0, 3)));
    if (mi >= 0) return `${m[3]}-${pad(mi + 1)}-${pad(m[2])}`;
  }
  return '';
}

/**
 * gviz table -> array of objects keyed by lower-case header. When Google cannot tell the
 * header row (all column labels blank), the first row is the header.
 */
export function tableRows(table) {
  const cell = (c) => (c ? (c.f !== undefined && c.f !== null ? String(c.f) : c.v === null || c.v === undefined ? '' : String(c.v)) : '');
  const rows = (table.rows || []).map((r) => (r.c || []).map(cell));
  let heads = (table.cols || []).map((c) => String(c.label || '').trim().toLowerCase());
  if (!heads.some(Boolean)) heads = (rows.shift() || []).map((h) => h.trim().toLowerCase());
  return rows.map((r) => Object.fromEntries(heads.map((h, i) => [h, (r[i] || '').trim()]).filter(([h]) => h)));
}

/** Seasons rows -> [{ name, start, end, days: { Monday: 'YES', ... } }] */
export function parseSeasons(rows) {
  return rows.map((r) => ({
    name: r.season || '',
    start: parseSheetDate(r['start date']),
    end: parseSheetDate(r['end date']),
    days: Object.fromEntries(DAYS.map((d) => [d, (r[d.toLowerCase()] || '').toUpperCase()]))
  })).filter((s) => s.start && s.end);
}

/** Form Responses rows -> [{ date, status, reason }] (REGATTA rows never decide today's status). */
export function parseOverrides(rows) {
  return rows.map((r) => ({
    date: parseSheetDate(r.date),
    status: (r.status || '').toUpperCase(),
    reason: r.reason || ''
  })).filter((o) => o.date && o.status !== 'REGATTA');
}

/** Girls and Boys shift for a winter weekday, or null (Sat, Sun). */
export function winterShift(iso) {
  const d = new Date(iso + 'T12:00:00');
  const wd = d.getDay();
  let girlsEarly;
  if (wd === 1 || wd === 3) girlsEarly = true;
  else if (wd === 2 || wd === 4) girlsEarly = false;
  else if (wd === 5) girlsEarly = d.getDate() % 2 === 0;
  else return null;
  return { girlsEarly, girls: girlsEarly ? WINTER_SHIFTS.early : WINTER_SHIFTS.late, boys: girlsEarly ? WINTER_SHIFTS.late : WINTER_SHIFTS.early };
}

/** { status: 'YES'|'NO'|'PARTIAL', note, shifts: {girls, boys}|null, label } for one local date. */
export function practiceFor(iso, seasons, overrides) {
  const wd = DAYS[new Date(iso + 'T12:00:00').getDay()];
  const override = overrides.find((o) => o.date === iso);
  const season = seasons.find((s) => iso >= s.start && iso <= s.end);
  let status = override ? override.status : (season ? season.days[wd] : 'NO');
  if (!['YES', 'NO', 'PARTIAL'].includes(status)) status = 'NO';
  const winter = !!season && /winter/i.test(season.name) && !!winterShift(iso);
  const shifts = winter ? winterShift(iso) : null;
  const label = { YES: 'Yes', NO: 'No', PARTIAL: 'Partial' }[status];
  if (override && override.reason) return { status, label, note: override.reason, shifts: null };
  if (status === 'PARTIAL') return { status, label, note: 'Check Slack for Details', shifts: null };
  if (status === 'YES' && shifts) return { status, label, note: '', shifts };
  return { status, label, note: 'Standard Schedule', shifts: null };
}

// ---- browser part ----------------------------------------------------------

let seq = 0;
/** Load one tab through Google's gviz endpoint with a JSONP callback (plain fetch fails on CORS). */
export function loadTab(gid) {
  return new Promise((resolve, reject) => {
    const name = `__wrcPractice${Date.now()}_${seq++}`;
    const script = document.createElement('script');
    const done = (fn, v) => { clearTimeout(timer); delete window[name]; script.remove(); fn(v); };
    const timer = setTimeout(() => done(reject, new Error('timeout')), TIMEOUT_MS);
    window[name] = (data) => {
      if (data && data.table) done(resolve, data.table);
      else done(reject, new Error('no table'));
    };
    script.onerror = () => done(reject, new Error('load failed'));
    script.src = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?gid=${gid}&tqx=responseHandler:${name}`;
    document.head.appendChild(script);
  });
}

// ---- a week at a time ------------------------------------------------------
// The browser keeps the next 7 days of results (David, 2026-11-03: people mostly want their shift
// time, and a school network may block Google). A saved copy is used only when Google cannot be read.

export const CACHE_KEY = 'wrc.practiceWeek';
export const CACHE_DAYS = 7;
export const CACHE_MAX_AGE_MS = CACHE_DAYS * 24 * 60 * 60 * 1000;

/** Results for `days` dates starting at `iso`: { 'YYYY-MM-DD': practiceFor(...) }. */
export function weekEntries(iso, seasons, overrides, days = CACHE_DAYS) {
  const out = {};
  const d = new Date(iso + 'T12:00:00');
  for (let i = 0; i < days; i++) {
    const day = localIso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, 12));
    out[day] = practiceFor(day, seasons, overrides);
  }
  return out;
}

/** The saved result for `iso`, or null when there is none or the copy is older than a week. */
export function cachedPractice(cache, iso, nowMs = Date.now()) {
  if (!cache || !cache.entries || typeof cache.savedAt !== 'number') return null;
  if (nowMs - cache.savedAt > CACHE_MAX_AGE_MS || nowMs < cache.savedAt) return null;
  const e = cache.entries[iso];
  return e ? { iso, ...e, cachedAt: cache.savedAt } : null;
}

function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; } }
function writeCache(c) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* private mode */ } }

/** Today's practice for the visitor's local date; from the saved week when Google cannot be read; throws when neither works. */
export async function loadPractice(now = new Date()) {
  const iso = localIso(now);
  try {
    const [s, o] = await Promise.all([loadTab(SEASONS_GID), loadTab(OVERRIDES_GID)]);
    const seasons = parseSeasons(tableRows(s)), overrides = parseOverrides(tableRows(o));
    writeCache({ savedAt: now.getTime(), entries: weekEntries(iso, seasons, overrides) });
    return { iso, ...practiceFor(iso, seasons, overrides) };
  } catch (err) {
    const saved = cachedPractice(readCache(), iso, now.getTime());
    if (saved) return saved;
    throw err;
  }
}
