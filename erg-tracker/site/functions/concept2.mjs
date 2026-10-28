// /api/concept2/connect (athlete, redirects to Concept2), /status, /disconnect.
import { session } from '../lib/auth.mjs';
import * as C2 from '../lib/concept2.mjs';
import { getFeed } from '../lib/feed.mjs';
import { callSheet } from '../lib/logbook-sync.mjs';

const env = (k) => Netlify.env.get(k);
const DONE_HIDE_MS = 15 * 60 * 1000;   // the feed copy can lag; hide a confirmed session meanwhile
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

export async function handleConcept2(req, envFn, deps = {}) {
  const who = session(envFn, req);
  if (!who) return json({ error: 'signin' }, 401);
  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  if (!C2.configured(envFn)) return json({ error: 'Logbook sync is not set up yet.' }, 503);
  const store = deps.store === undefined ? await C2.defaultStore() : deps.store;
  if (!store) return json({ error: 'Storage is not available.' }, 503);

  if (path === '/api/concept2/status') {
    if (who.kind === 'team') return json({ kind: 'team', connected: await C2.connectedList(store) });
    const info = await C2.connectionInfo(store, who.id);
    return json({ kind: 'athlete', connected: !!info, username: info ? info.username || '' : '' });
  }
  if (path === '/api/concept2/disconnect' && req.method === 'POST') {
    // Athletes disconnect themselves; a coach names the athlete (?athlete=A001).
    const target = who.kind === 'team' ? new URL(req.url).searchParams.get('athlete') : who.id;
    if (!target || !/^[A-Za-z0-9-]+$/.test(target)) return json({ error: 'Say which athlete.' }, 400);
    await C2.disconnect(envFn, store, target);
    return json({ ok: true });
  }
  if (who.kind !== 'athlete') return json({ error: 'Athletes connect their own Logbook account.' }, 403);
  if (path === '/api/concept2/pending' && req.method === 'GET') {
    let feed;
    try { feed = (await getFeed(envFn, deps)).data; } catch { return json({ error: 'The team data could not be loaded. Try again in a minute.' }, 502); }
    const recent = Date.now() - DONE_HIDE_MS;
    const hidden = new Set();
    const mine = (feed.logbookPending || []).filter((p) => p.athleteId === who.id);
    for (const p of mine) if (Number(await store.get('done/' + p.id)) > recent) hidden.add(p.id);
    return json({ pending: mine.filter((p) => !hidden.has(p.id)) });
  }
  if (path === '/api/concept2/confirm' && req.method === 'POST') {
    let b = {};
    try { b = await req.json(); } catch { b = {}; }
    if (!b.entryId || !/^[A-Za-z0-9-]+$/.test(String(b.entryId))) return json({ error: 'Which session?' }, 400);
    const payload = { action: 'logbook-confirm', athleteId: who.id, entryId: String(b.entryId) };
    if (['Practice', 'OYO', 'Make-up'].includes(b.sessionType)) payload.sessionType = b.sessionType;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(b.makeupFor || ''))) payload.makeupFor = b.makeupFor;
    if (b.rpe !== undefined && b.rpe !== '') payload.rpe = Number(b.rpe);
    if (['2000m', '20min'].includes(b.benchmark)) payload.benchmark = b.benchmark;
    try {
      const out = await callSheet(envFn, deps.fetch || fetch, payload);
      await store.set('done/' + payload.entryId, String(Date.now()));
      return json({ ok: true, benchmark: !!out.benchmark });
    } catch (err) {
      return json({ error: String(err.message).replace(/^Sheet said: /, '') }, 400);
    }
  }
  if (path === '/api/concept2/connect' && req.method === 'GET') {
    const url = C2.authorizeUrl(envFn, req, C2.makeState(envFn, who.id));
    return new Response(null, { status: 302, headers: { location: url, 'cache-control': 'no-store' } });
  }
  return json({ error: 'Not found.' }, 404);
}

export default (req) => handleConcept2(req, env);

export const config = { path: ['/api/concept2/connect', '/api/concept2/status', '/api/concept2/disconnect', '/api/concept2/pending', '/api/concept2/confirm'] };
