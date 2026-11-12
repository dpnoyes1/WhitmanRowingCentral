// Concept2 Logbook results -> the Sheet (phase 2). A webhook (concept2-webhook)
// and a 15-minute poll (concept2-poll) both end up in syncResult(): fetch the
// result with the athlete's own token, normalize it to seconds and meters, and
// POST it to the Apps Script write action (apps-script/Logbook.gs), which saves
// a pending Entries row for her to confirm. Webhook payloads are never trusted
// for data (retries and signatures are undocumented): they only say "look".
import { LOGBOOK, accessTokenFor, athleteForLogbookUser } from './concept2.mjs';
import { notifyLogbook } from './slacklogbook.mjs';

const MACHINES = { rower: 'rower', bike: 'bikerg', skierg: 'skierg' };   // Logbook "bike" is the BikeErg
const SEEN_DAYS = 30;

const tenths = (x) => (x === undefined || x === null || x === '' || isNaN(Number(x)) ? '' : Math.round(Number(x)) / 10);
const num = (x) => (x === undefined || x === null || x === '' || isNaN(Number(x)) ? '' : Number(x));
const txt = (x) => (x === undefined || x === null ? '' : String(x));

// Heart rate object { average, min, max, ending, rest, recovery } -> flat fields (blank when missing).
const hrOf = (h) => { const o = h && typeof h === 'object' ? h : {};
  return { hrAvg: num(o.average), hrMin: num(o.min), hrMax: num(o.max), hrEnding: num(o.ending), hrRest: num(o.rest), hrRecovery: num(o.recovery) }; };
// Targets { pace (tenths), watts, stroke_rate, heart_rate_zone, calories } -> flat fields.
const targetsOf = (t) => { const o = t && typeof t === 'object' ? t : {};
  return { targetPaceS: tenths(o.pace), targetWatts: num(o.watts), targetRate: num(o.stroke_rate), targetHrZone: num(o.heart_rate_zone), targetCalories: num(o.calories) }; };
// One split or interval from the API -> everything it carries.
const pieceOf = (iv) => ({
  timeS: tenths(iv.time), distanceM: num(iv.distance), rate: num(iv.stroke_rate),
  restTimeS: tenths(iv.rest_time), restDistanceM: num(iv.rest_distance),
  calories: num(iv.calories_total), wattMinutes: num(iv.wattminutes_total), type: txt(iv.type), machine: txt(iv.machine),
  ...hrOf(iv.heart_rate), ...targetsOf(iv.targets)
});

/**
 * One Logbook result (API shape: time in tenths of a second, distance in meters,
 * date in her local time) -> the payload the Sheet expects. Interval workouts
 * become pieces; anything else (Just Row, single distance or time pieces with
 * splits) is one piece, so the Sheet still gets a session. Returns null for a
 * result with no time.
 */
export function normalizeResult(r) {
  const m = String(r.date || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/);
  if (!m || !r.id) return null;
  const workout = r.workout && typeof r.workout === 'object' ? r.workout : {};
  const pieces = (Array.isArray(workout.intervals) ? workout.intervals : []).map(pieceOf).filter((p) => p.timeS > 0);
  const splits = (Array.isArray(workout.splits) ? workout.splits : []).map(pieceOf);
  const timeS = tenths(r.time);
  if (!pieces.length && !(timeS > 0)) return null;
  return {
    id: r.id, localDate: m[1], localTime: Number(m[2]) + ':' + m[3],
    machine: MACHINES[r.type] || String(r.type || 'unknown'),
    name: String(r.comments || r.workout_type || '').slice(0, 80),
    workoutType: String(r.workout_type || ''),
    timeS, distanceM: num(r.distance), dragFactor: num(r.drag_factor),
    rate: num(r.stroke_rate), intervals: pieces,
    // Everything else Logbook sends (kept in the Sheet so nothing has to be fetched again later).
    splits, calories: num(r.calories_total), strokeCount: num(r.stroke_count), ...hrOf(r.heart_rate),
    restTimeTotalS: tenths(r.rest_time), restDistanceTotalM: num(r.rest_distance),
    logbookSource: txt(r.source), verified: r.verified === undefined || r.verified === null ? '' : r.verified ? 'Yes' : 'No',
    ranked: r.ranked === undefined || r.ranked === null ? '' : r.ranked ? 'Yes' : 'No', timezone: txt(r.timezone), dateUtc: txt(r.date_utc),
    privacy: txt(r.privacy), comments: txt(r.comments), targets: Object.keys(workout.targets || {}).length ? workout.targets : null
  };
}

async function logbookGet(fetchImpl, access, path) {
  const res = await fetchImpl(LOGBOOK + '/api/users/me/' + path, { headers: { authorization: 'Bearer ' + access, accept: 'application/json' } });
  const body = res.status === 404 ? {} : await res.json().catch(() => ({}));
  return { status: res.status, data: body && body.data };
}

export const fetchResult = (fetchImpl, access, id) => logbookGet(fetchImpl, access, 'results/' + encodeURIComponent(id));

export const fetchStrokes = (fetchImpl, access, id) => logbookGet(fetchImpl, access, 'results/' + encodeURIComponent(id) + '/strokes');

export const listRecent = (fetchImpl, access, fromDay) =>
  logbookGet(fetchImpl, access, 'results?from=' + encodeURIComponent(fromDay) + '&number=50');

/** POST an action to the Apps Script web app (same URL and key as the feed). */
export async function callSheet(env, fetchImpl, payload) {
  const url = env('FEED_URL'), key = env('FEED_KEY');
  if (!url || !key) throw new Error('FEED_URL and FEED_KEY must be set in Netlify');
  const res = await fetchImpl(url, {
    method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, redirect: 'follow',
    body: JSON.stringify({ key, ...payload })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error || body.status === 'error') throw new Error('Sheet said: ' + (body.error || body.status || res.status));
  return body;
}

export const sendToSheet = (env, fetchImpl, athleteId, result) =>
  callSheet(env, fetchImpl, { action: 'logbook-result', athleteId, result });

const seenKey = (id) => 'seen/' + id;
const fingerprint = (p) => JSON.stringify([p.timeS, p.distanceM, p.localDate, p.localTime, p.intervals.length, p.deleted ? 1 : 0]);

/**
 * Sends one result to the Sheet unless it was already sent unchanged.
 * Returns 'sent', 'same', 'skipped' (no time) or 'deleted'.
 */
export async function syncResult(env, store, fetchImpl, athleteId, apiResult, access = null) {
  const payload = normalizeResult(apiResult);
  if (!payload) return 'skipped';
  const fp = fingerprint(payload);
  if ((await store.get(seenKey(payload.id))) === fp) return 'same';
  // New or changed: with her token, get the full result (the list gives a summary) and the stroke data, so the Sheet keeps all of it.
  let full = apiResult, strokes = [];
  if (access) {
    try {
      if (!apiResult.workout) { const d = await fetchResult(fetchImpl, access, payload.id); if (d.status === 200 && d.data) full = { ...apiResult, ...d.data }; }
      const st = await fetchStrokes(fetchImpl, access, payload.id);
      if (st.status === 200 && Array.isArray(st.data)) strokes = st.data;
    } catch (err) { console.error('logbook detail fetch failed:', err.message); }
  }
  const body = normalizeResult(full) || payload;
  const out = await sendToSheet(env, fetchImpl, athleteId, { ...body, raw: { result: full, strokes } });
  await store.set(seenKey(payload.id), fp);
  // A new pending session also goes to her Slack DM (David, 2026-10-28), when the Roster has her member ID.
  if (out && out.slack) await notifyLogbook(env, fetchImpl, out.slack);
  return 'sent';
}

/** Webhook body -> { event, resultId, userId }. Tolerant of shape: only ids are used. */
export function readWebhook(body) {
  const b = body && typeof body === 'object' ? body : {};
  const r = b.result || b.data || {};
  const event = String(b.type || b.event || b.action || '').toLowerCase();
  const resultId = r.id ?? b.result_id ?? b.id ?? null;
  const userId = r.user_id ?? b.user_id ?? null;
  return { event, resultId: resultId === null ? null : String(resultId), userId: userId === null ? null : String(userId) };
}

/**
 * Handles one webhook nudge. Added and updated: fetch the result with her
 * token and sync it. Deleted: only trust it if Logbook now answers 404.
 */
export async function handleWebhook(env, store, fetchImpl, body) {
  const { event, resultId, userId } = readWebhook(body);
  if (!resultId || !userId) return { status: 'ignored' };
  const athleteId = await athleteForLogbookUser(store, userId);
  if (!athleteId) return { status: 'unknown user' };
  const access = await accessTokenFor(env, store, fetchImpl, athleteId);
  if (!access) return { status: 'no token' };
  const got = await fetchResult(fetchImpl, access, resultId);
  if (got.status === 404) {
    await sendToSheet(env, fetchImpl, athleteId, { id: resultId, deleted: true });
    await store.delete(seenKey(resultId));
    return { status: 'deleted' };
  }
  if (got.status !== 200 || !got.data) return { status: 'fetch failed' };
  return { status: await syncResult(env, store, fetchImpl, athleteId, got.data, access), event };
}

/**
 * One athlete's last few days of results, sent to the Sheet if new. Used by the
 * poll and by her page on load, so a missed webhook never keeps a card waiting.
 * Returns counts, with failed: 1 if her token or Logbook didn't answer.
 */
export async function syncAthlete(env, store, fetchImpl, athleteId, { now = Date.now(), days = 3 } = {}) {
  const out = { sent: 0, same: 0, skipped: 0, failed: 0 };
  const from = new Date(now - days * 86400000).toISOString().slice(0, 10);
  try {
    const access = await accessTokenFor(env, store, fetchImpl, athleteId, now);
    if (!access) { out.failed++; return out; }
    const list = await listRecent(fetchImpl, access, from);
    if (list.status !== 200 || !Array.isArray(list.data)) { out.failed++; return out; }
    for (const r of list.data) {
      try { out[await syncResult(env, store, fetchImpl, athleteId, r, access)]++; } catch (err) { out.failed++; console.error('logbook sync failed:', err.message); }
    }
  } catch (err) {
    out.failed++;
    console.error('logbook sync failed for one athlete:', err.message);
  }
  return out;
}

const POLL_BATCH = 30;   // athletes per run: one at a time at ~0.6 s each fits Netlify's 30 s scheduled-function limit (QA 2026-11-03)
const CURSOR_KEY = 'poll/cursor';

/**
 * The backup poll: connected athletes' results from the last few days. A run checks up to `batch`
 * athletes and the next run carries on after the last one, wrapping around, so with more athletes
 * than fit in one run everyone is still covered within a few runs.
 */
export async function pollAll(env, store, fetchImpl, { now = Date.now(), days = 3, batch = POLL_BATCH } = {}) {
  const ids = (await store.list('conn/')).map((k) => k.slice(5)).sort();
  const out = { athletes: ids.length, checked: 0, sent: 0, same: 0, skipped: 0, failed: 0 };
  let todo = ids;
  if (ids.length > batch) {
    const last = await store.get(CURSOR_KEY);
    let start = ids.findIndex((id) => last && id > String(last));
    if (start < 0) start = 0;
    todo = Array.from({ length: batch }, (_, i) => ids[(start + i) % ids.length]);
    await store.set(CURSOR_KEY, todo[todo.length - 1]);
  }
  for (const id of todo) {
    const one = await syncAthlete(env, store, fetchImpl, id, { now, days });
    out.checked++;
    for (const k of ['sent', 'same', 'skipped', 'failed']) out[k] += one[k];
  }
  try {   // unchanged sessions count after 20 hours (David, 2026-10-25)
    out.accepted = (await callSheet(env, fetchImpl, { action: 'logbook-accept-due' })).accepted;
  } catch (err) {
    console.error('logbook accept-due failed:', err.message);
  }
  return out;
}
