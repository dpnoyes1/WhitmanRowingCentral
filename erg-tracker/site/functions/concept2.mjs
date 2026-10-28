// /api/concept2/connect (athlete, redirects to Concept2), /status, /disconnect.
import { session } from '../lib/auth.mjs';
import * as C2 from '../lib/concept2.mjs';

const env = (k) => Netlify.env.get(k);
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

export async function handleConcept2(req, envFn, deps = {}) {
  const who = session(envFn, req);
  if (!who) return json({ error: 'signin' }, 401);
  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  if (!C2.configured(envFn)) return json({ error: 'Logbook sync is not set up yet.' }, 503);
  const store = deps.store === undefined ? await C2.defaultStore() : deps.store;
  if (!store) return json({ error: 'Storage is not available.' }, 503);

  if (path === '/api/concept2/status') {
    if (who.kind === 'team') return json({ kind: 'team', connected: await C2.connectedIds(store) });
    return json({ kind: 'athlete', connected: await C2.isConnected(store, who.id) });
  }
  if (who.kind !== 'athlete') return json({ error: 'Athletes connect their own Logbook account.' }, 403);
  if (path === '/api/concept2/connect' && req.method === 'GET') {
    const url = C2.authorizeUrl(envFn, req, C2.makeState(envFn, who.id));
    return new Response(null, { status: 302, headers: { location: url, 'cache-control': 'no-store' } });
  }
  if (path === '/api/concept2/disconnect' && req.method === 'POST') {
    await C2.disconnect(envFn, store, who.id);
    return json({ ok: true });
  }
  return json({ error: 'Not found.' }, 404);
}

export default (req) => handleConcept2(req, env);

export const config = { path: ['/api/concept2/connect', '/api/concept2/status', '/api/concept2/disconnect'] };
