// Concept2 sends the athlete back here (registered redirect URI, so this keeps
// Netlify's default function path). The signed state and her site sign-in must
// name the same athlete, so nobody can attach an account to someone else.
import { session } from '../lib/auth.mjs';
import * as C2 from '../lib/concept2.mjs';

const env = (k) => Netlify.env.get(k);
const back = (result) => new Response(null, { status: 302, headers: { location: '/?logbook=' + result + '#/me', 'cache-control': 'no-store' } });

export async function handleCallback(req, envFn, deps = {}) {
  const url = new URL(req.url);
  const who = session(envFn, req);
  if (!who || who.kind !== 'athlete' || !C2.configured(envFn)) return back('error');
  if (url.searchParams.get('error')) return back('denied');   // she tapped Deny
  if (C2.readState(envFn, url.searchParams.get('state')) !== who.id) return back('error');
  const code = url.searchParams.get('code');
  if (!code) return back('error');
  const store = deps.store === undefined ? await C2.defaultStore() : deps.store;
  if (!store) return back('error');
  const fetchImpl = deps.fetch || fetch;
  try {
    const tokens = await C2.exchangeCode(envFn, fetchImpl, code, C2.redirectUri(envFn, req));
    const logbookId = await C2.fetchLogbookUserId(fetchImpl, tokens.access);
    await C2.saveConnection(envFn, store, who.id, tokens, logbookId);
    return back('connected');
  } catch (err) {
    console.error('logbook connect failed:', err.message);
    return back('error');
  }
}

export default (req) => handleCallback(req, env);
