// Concept2 calls this when a result is added, updated or deleted (set the URL in
// the Logbook developer portal: https://whitmanrowingcentral.netlify.app/api/concept2/webhook).
// Always answers 200 quickly so Logbook doesn't retry; the poll covers anything missed.
import * as C2 from '../lib/concept2.mjs';
import { handleWebhook } from '../lib/logbook-sync.mjs';

const env = (k) => Netlify.env.get(k);

export async function handleWebhookRequest(req, envFn, deps = {}) {
  if (!C2.configured(envFn)) return new Response('not set up', { status: 503 });
  const store = deps.store === undefined ? await C2.defaultStore() : deps.store;
  if (!store) return new Response('no storage', { status: 503 });
  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  try {
    const out = await handleWebhook(envFn, store, deps.fetch || fetch, body);
    console.log('logbook webhook:', JSON.stringify(out));
  } catch (err) {
    console.error('logbook webhook failed:', err.message);
  }
  return new Response('ok', { status: 200 });
}

export default (req) => handleWebhookRequest(req, env);

export const config = { path: '/api/concept2/webhook', method: 'POST' };
