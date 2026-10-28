// Concept2 Logbook results -> the Sheet (phase 2). A webhook (concept2-webhook)
// and a 15-minute poll (concept2-poll) both end up in syncResult(): fetch the
// result with the athlete's own token, normalize it to seconds and meters, and
// POST it to the Apps Script write action (apps-script/Logbook.gs), which saves
// a pending Entries row for her to confirm. Webhook payloads are never trusted
// for data (retries and signatures are undocumented): they only say "look".
import { LOGBOOK, accessTokenFor, athleteForLogbookUser } from './concept2.mjs';

const MACHINES = { rower: 'rower', bike: 'bikerg', skierg: 'skierg' };   // Logbook "bike" is the BikeErg
const SEEN_DAYS = 30;

const tenths = (x) => (x === undefined || x === null || x === '' || isNaN(Number(x)) ? '' : Math.round(Number(x)) / 10);
const num = (x) => (x === undefined || x === null || x === '' || isNaN(Number(x)) ? '' : Number(x));

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
  const pieces = (Array.isArray(workout.intervals) ? workout.intervals : []).map((iv) => ({
    timeS: tenths(iv.time), distanceM: num(iv.distance), rate: num(iv.stroke_rate),
    restTimeS: tenths(iv.rest_time), restDistanceM: num(iv.rest_distance)
  })).filter((p) => p.timeS > 0);
  const timeS = tenths(r.time);
  if (!pieces.length && !(timeS > 0)) return null;
  return {
    id: r.id, localDate: m[1], localTime: Number(m[2]) + ':' + m[3],
    machine: MACHINES[r.type] || String(r.type || 'unknown'),
    name: String(r.comments || r.workout_type || '').slice(0, 80),
    workoutType: String(r.workout_type || ''),
    timeS, distanceM: num(r.distance), dragFactor: num(r.drag_factor),
    rate: num(r.stroke_rate), intervals: pieces
  };
}

async function logbookGet(fetchImpl, access, path) {
  const res = await fetchImpl(LOGBOOK + '/api/users/me/' + path, { headers: { authorization: 'Bearer ' + access, accept: 'application/json' } });
  const body = res.status === 404 ? {} : await res.json().catch(() => ({}));
  return { status: res.status, data: body && body.data };
}

export const fetchResult = (fetchImpl, access, id) => logbookGet(fetchImpl, access, 'results/' + encodeURIComponent(id));

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
const newKey = (athleteId) => 'new/' + athleteId;
export const NEW_SESSION_MS = 30 * 60 * 1000;

/** True when a session was written for her in the last half hour. */
export async function hasNewSession(store, athleteId, now = Date.now()) {
  return now - Number(await store.get(newKey(athleteId))) < NEW_SESSION_MS;
}
const fingerprint = (p) => JSON.stringify([p.timeS, p.distanceM, p.localDate, p.localTime, p.intervals.length, p.deleted ? 1 : 0]);

/**
 * Sends one result to the Sheet unless it was already sent unchanged.
 * Returns 'sent', 'same', 'skipped' (no time) or 'deleted'.
 */
export async function syncResult(env, store, fetchImpl, athleteId, apiResult) {
  const payload = normalizeResult(apiResult);
  if (!payload) return 'skipped';
  const fp = fingerprint(payload);
  if ((await store.get(seenKey(payload.id))) === fp) return 'same';
  await sendToSheet(env, fetchImpl, athleteId, payload);
  await store.set(seenKey(payload.id), fp);
  await store.set(newKey(athleteId), String(Date.now()));   // her pending cards are read from the Sheet for a while
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
  return { status: await syncResult(env, store, fetchImpl, athleteId, got.data), event };
}

/** The backup poll: every connected athlete's results from the last few days. */
export async function pollAll(env, store, fetchImpl, { now = Date.now(), days = 3 } = {}) {
  const from = new Date(now - days * 86400000).toISOString().slice(0, 10);
  const ids = (await store.list('conn/')).map((k) => k.slice(5));
  const out = { athletes: ids.length, sent: 0, same: 0, skipped: 0, failed: 0 };
  for (const id of ids) {
    try {
      const access = await accessTokenFor(env, store, fetchImpl, id, now);
      if (!access) { out.failed++; continue; }
      const list = await listRecent(fetchImpl, access, from);
      if (list.status !== 200 || !Array.isArray(list.data)) { out.failed++; continue; }
      for (const r of list.data) {
        try { out[await syncResult(env, store, fetchImpl, id, r)]++; } catch (err) { out.failed++; console.error('logbook sync failed:', err.message); }
      }
    } catch (err) {
      out.failed++;
      console.error('logbook poll failed for one athlete:', err.message);
    }
  }
  try {   // unchanged sessions count after 20 hours (David, 2026-10-25)
    out.accepted = (await callSheet(env, fetchImpl, { action: 'logbook-accept-due' })).accepted;
  } catch (err) {
    console.error('logbook accept-due failed:', err.message);
  }
  return out;
}
