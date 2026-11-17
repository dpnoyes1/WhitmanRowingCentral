// Water import (on-water plan Step 2). Coaches only; nothing here reaches the athlete feed except the Entries rows the Sheet writes.
// POST /api/water/preview { name, data (base64 FIT) } -> what the file holds, plus the boat and lineup to suggest.
// POST /api/water/save { name, data, boatName, boatClass, kind } -> the Sheet stores the file, the session, its pieces and the
//   credits. The file is read again here on save, so the numbers never come from the browser.
// GET  /api/water?date=YYYY-MM-DD -> what is already imported that day, and its saved lineups.
// GET  /api/water/report?date=YYYY-MM-DD&rate=all|r20|r24|r28 -> the coaches' results page (Steps 3 and 4) for the season up to that date.
//      Each rower's season GMS % comes from the feed (the Lineups page's numbers) for the even-lineup rule and the erg part of "Who wins".
// POST /api/water/ratings-use { date, use: 'Automatic' | 'Count' | 'Leave out' } -> a coach's choice for whether that day counts in "Who wins".
import { liveSession } from '../lib/auth.mjs';
import { callSheet } from '../lib/slack.mjs';
import { readFit } from '../lib/fit.mjs';
import { summarize } from '../lib/water.mjs';
import { waterReportView, RATE_KEYS } from '../lib/waterreport.mjs';
import { schoolYearStart } from '../lib/stats.mjs';
import { getFeed } from '../lib/feed.mjs';
import { lineupsView } from '../lib/views.mjs';

const env = (k) => Netlify.env.get(k);
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
export const MAX_FIT_BYTES = 3 * 1024 * 1024;   // a session file is a few hundred KB; 25 hours of strokes stays well under this
const KINDS = ['Practice', 'Pieces', 'Race'];
const CLASSES = ['8+', '4+', '4x', '4-', '2x', '2-', '1x'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TZ = 'America/New_York';

/** Date (YYYY-MM-DD) and clock ("3:45 PM") in Eastern time for a Unix time. */
export function easternDay(unix) {
  const d = new Date(unix * 1000);
  return {
    date: new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d),
    clock: new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(d),
    minutes: Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(d)) * 60 +
      Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, minute: 'numeric' }).format(d)),
    weekday: new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d),
  };
}

/** The boat, class and lineup to suggest for a file (no shifts on the water: David, 2026-11-16). ctx: the Sheet's water-context answer for its date. */
export function suggestFor(fileUnit, ctx) {
  const boatName = (ctx.units || {})[fileUnit] || '';
  const lineup = (ctx.lineups || []).find((l) => l.fromPiece === '' && boatName && l.boatName.toLowerCase() === boatName.toLowerCase()) || null;
  return { boatName, boatClass: lineup ? lineup.boatClass : '', lineupId: lineup ? lineup.lineupId : '' };
}

/** Reads a base64 FIT upload; { fit } or { error } in plain words. */
export function readUpload(body) {
  if (!body || typeof body.data !== 'string' || !body.data) return { error: 'No file.' };
  const name = String(body.name || 'session.fit').slice(0, 120);
  if (!/\.fit$/i.test(name)) return { error: name + ' is not a .fit file. Export FIT from the NK Logbook app (CSV has no clock times).' };
  const bytes = Buffer.from(body.data, 'base64');
  if (bytes.length > MAX_FIT_BYTES) return { error: name + ' is too big for one session.' };
  try {
    const fit = readFit(new Uint8Array(bytes), name);
    if (!fit.strokes.length) return { error: name + ' has no strokes in it.' };
    return { fit, name, bytes };
  } catch (e) {
    return { error: name + ': ' + e.message + '.' };
  }
}

/** One file as the import page shows it. */
export function fileView(fit, name, kind) {
  const s = summarize(fit, kind || null);
  const when = easternDay(s.start || fit.strokes[0].t);
  return {
    name, unit: fit.unit, unitSource: fit.unitSource, start: new Date((s.start || fit.strokes[0].t) * 1000).toISOString(), date: when.date, clock: when.clock,
    kind: s.kind, elapsedS: s.elapsedS, movingS: s.movingS, meters: s.meters, avgSplitS: s.avgSplitS, avgRate: s.avgRate, strokes: s.strokes,
    pieces: s.pieces.map((p) => ({ n: p.n, start: new Date(p.start * 1000).toISOString(), workS: p.workS, meters: p.meters, splitS: p.splitS, rate: p.rate, strokes: p.strokes })),
    curve: Object.fromEntries(Object.entries(s.curves).map(([k, pts]) => [k, pts.map((p) => ({ durS: p.durS, splitS: p.splitS, meters: p.meters, rate: p.rate }))])),
    warnings: s.warnings, sessionId: sessionIdOf(fit.unit, s.start || fit.strokes[0].t), when,
  };
}

// Same rule as waterSessionId_ in apps-script/Water.gs: the unit and the start time.
export const sessionIdOf = (unit, startUnix) => 'WS-' + (String(unit || '').replace(/[^0-9A-Za-z]/g, '') || 'nounit') + '-' + Math.round(Number(startUnix) || 0);

async function readBody(req) {
  const origin = req.headers.get('origin');
  if (!/^application\/json/i.test(req.headers.get('content-type') || '') || (origin && origin !== new URL(req.url).origin)) return null;
  try { return await req.json(); } catch { return null; }
}

export async function handleWater(req, envFn, deps = {}) {
  const who = await liveSession(envFn, req, deps);
  if (!who) return json({ error: 'signin' }, 401);
  if (who.kind !== 'team') return json({ error: 'Coaches only.' }, 403);
  const fetchImpl = deps.fetchImpl || fetch;
  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  const context = (dates) => callSheet(envFn, fetchImpl, { action: 'water-context', dates });

  if (req.method === 'GET' && path === '/api/water') {
    const date = new URL(req.url).searchParams.get('date') || '';
    if (!DAY.test(date)) return json({ error: 'Bad date.' }, 400);
    try {
      const c = await context([date]);
      return json({ date, sessions: c.sessions || [], lineups: c.lineups || [] });
    } catch (err) {
      console.error('water context error:', err.message);
      return json({ error: 'The Sheet did not answer. Try again in a minute.' }, 502);
    }
  }
  if (req.method === 'GET' && path === '/api/water/report') {
    const q = new URL(req.url).searchParams;
    const date = q.get('date') || easternDay((deps.now ?? Date.now()) / 1000).date, rate = q.get('rate') || 'all';
    if (!DAY.test(date) || !(rate in RATE_KEYS)) return json({ error: 'Bad request.' }, 400);
    let raw;
    try { raw = await callSheet(envFn, fetchImpl, { action: 'water-report', from: schoolYearStart(date, '07-01'), to: date }); } catch (err) {
      console.error('water report error:', err.message);
      return json({ error: 'The Sheet did not answer. Try again in a minute.' }, 502);
    }
    if (raw.status !== 'ok') return json({ error: raw.message || 'The Sheet could not read the water data.' }, 502);
    let gms = {};
    try {
      const feed = (await getFeed(envFn, deps)).data;
      for (const a of lineupsView(feed, date).rowers) if (a.gmsPct != null) gms[a.id] = a.gmsPct;
    } catch (err) { console.error('water report feed error:', err.message); gms = {}; }   // without GMS, nothing can be judged even: the page says so
    return json(waterReportView(raw, q.get('date') ? date : '', rate, { gms }));
  }
  if (req.method === 'POST' && path === '/api/water/ratings-use') {
    const body = await readBody(req);
    if (!body || !DAY.test(String(body.date || '')) || !['Automatic', 'Count', 'Leave out'].includes(body.use)) return json({ error: 'Bad request.' }, 400);
    let out;
    try { out = await callSheet(envFn, fetchImpl, { action: 'water-ratings-use', date: body.date, use: body.use, coachName: who.name || 'Coach' }); } catch (err) {
      console.error('water ratings-use error:', err.message);
      return json({ error: 'The Sheet did not answer, so nothing was saved. Try again in a minute.' }, 502);
    }
    if (out.status === 'invalid') return json({ error: out.message }, 422);
    if (out.status !== 'ok') return json({ error: 'The Sheet could not save that.' }, 502);
    return json({ date: out.date, use: out.use });
  }
  if (req.method !== 'POST' || !['/api/water/preview', '/api/water/save'].includes(path)) return json({ error: 'Not found' }, 404);
  const body = await readBody(req);
  if (!body) return json({ error: 'Bad request.' }, 400);
  const up = readUpload(body);
  if (up.error) return json({ error: up.error }, 422);

  if (path === '/api/water/preview') {
    const f = fileView(up.fit, up.name);
    let c;
    try { c = await context([f.date]); } catch (err) {
      console.error('water context error:', err.message);
      return json({ error: 'The Sheet did not answer. Try again in a minute.' }, 502);
    }
    const done = (c.sessions || []).find((s) => s.sessionId === f.sessionId) || null;
    const suggest = done ? { boatName: done.boatName, boatClass: done.boatClass, lineupId: done.lineupId } : suggestFor(f.unit, c);
    if (done) f.kind = done.kind || f.kind;
    delete f.when;
    return json({ file: f, suggest, imported: done ? { by: done.importedBy, boatName: done.boatName } : null, lineups: c.lineups || [] });
  }

  // save
  const kind = KINDS.includes(body.kind) ? body.kind : null;
  const boatClass = CLASSES.includes(body.boatClass) ? body.boatClass : null;
  const boatName = String(body.boatName || '').trim().slice(0, 40);
  if (!kind || !boatClass || !boatName) return json({ error: 'Pick the boat, class and kind.' }, 422);
  const f = fileView(up.fit, up.name, kind);
  const session = { sessionId: f.sessionId, date: f.date, unit: f.unit || '', boatName, boatClass, lineupId: '', start: f.start,
    elapsedS: f.elapsedS, movingS: f.movingS, meters: f.meters, avgSplitS: f.avgSplitS, avgRate: f.avgRate, strokes: f.strokes, kind: f.kind,
    fileName: up.name, curve: f.curve };
  let out;
  try {
    out = await callSheet(envFn, fetchImpl, { action: 'water-save', session, pieces: f.pieces, file: { name: up.name, base64: up.bytes.toString('base64') }, coachName: who.name || 'Coach' });
  } catch (err) {
    console.error('water save error:', err.message);
    return json({ error: 'The Sheet did not answer, so nothing was saved. Try again in a minute.' }, 502);
  }
  if (out.status === 'invalid') return json({ error: out.message }, 422);
  if (out.status !== 'ok') return json({ error: 'The Sheet could not save that. Nothing was changed.' }, 502);
  return json({ sessionId: out.sessionId, lineupId: out.lineupId, reimport: out.reimport, credited: out.credited || [], changes: out.changes || null,
    movingS: f.movingS, meters: f.meters, date: f.date });
}

export default (req) => handleWater(req, env);

export const config = { path: ['/api/water', '/api/water/preview', '/api/water/save', '/api/water/report', '/api/water/ratings-use'], method: ['GET', 'POST'] };
