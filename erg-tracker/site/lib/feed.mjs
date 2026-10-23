// Reads the Sheet's private feed (Apps Script web app, see apps-script/Feed.gs).
// Building the feed takes Apps Script several seconds, so visitors should never
// wait on it (David, 2026-10-23): a scheduled function (refresh-feed.mjs)
// fetches it every 5 minutes into one shared copy in Netlify Blobs, and every
// function instance reads that copy, keeping it in memory for a minute.
// If the shared copy is missing or old, the Sheet is asked directly; if the
// Sheet is slow or down, the last good copy is served for up to a day and
// marked stale.

export const FEED_TTL_MS = 60 * 1000;            // in-memory, per instance
export const SHARED_FRESH_MS = 15 * 60 * 1000;   // shared copy counts as current
const STALE_LIMIT_MS = 24 * 60 * 60 * 1000;
const BLOB_STORE = 'feed', BLOB_KEY = 'latest';
let cache = null;   // { data, at }

export function clearFeedCache() {
  cache = null;
}

/** The shared copy in Netlify Blobs: { get(), set(entry) }, or null where Blobs isn't available (tests, local dev). */
async function defaultShared() {
  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore(BLOB_STORE);
    return {
      get: () => store.get(BLOB_KEY, { type: 'json' }),
      set: (entry) => store.setJSON(BLOB_KEY, entry)
    };
  } catch {
    return null;
  }
}

/** Asks the Sheet for the feed. Several seconds; throws on any problem. */
async function fetchSheet(env, fetchImpl) {
  const url = env('FEED_URL'), key = env('FEED_KEY');
  if (!url || !key) throw new Error('FEED_URL and FEED_KEY must be set in Netlify');
  // Apps Script answers a POST with a redirect to the result; fetch follows it.
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ key }),
    redirect: 'follow'
  });
  if (!res.ok) throw new Error('feed HTTP ' + res.status);
  const data = await res.json();
  if (data.error) throw new Error('feed said: ' + data.error);
  if (!Array.isArray(data.athletes)) throw new Error('feed has no athletes');
  return data;
}

/**
 * The feed for a request: memory, then the shared copy, then the Sheet.
 * deps: { fetchImpl, now, shared } (shared: null turns the shared copy off).
 */
export async function getFeed(env, { fetchImpl = fetch, now = Date.now(), shared } = {}) {
  if (cache && now - cache.at < FEED_TTL_MS) return { data: cache.data, stale: false };
  const store = shared === undefined ? await defaultShared() : shared;
  const copy = store ? await store.get().catch(() => null) : null;
  if (copy && copy.data && now - copy.at < SHARED_FRESH_MS) {
    cache = { data: copy.data, at: now };
    return { data: copy.data, stale: false };
  }
  try {
    const data = await fetchSheet(env, fetchImpl);
    cache = { data, at: now };
    if (store) await store.set({ at: now, data }).catch((err) => console.error('feed copy not saved:', err.message));
    return { data, stale: false };
  } catch (err) {
    const last = [cache, copy].filter((x) => x && x.data && now - x.at < STALE_LIMIT_MS).sort((x, y) => y.at - x.at)[0];
    if (last) return { data: last.data, stale: true };
    throw err;
  }
}

/** Scheduled every 5 minutes: fetch the Sheet's feed into the shared copy. */
export async function refreshFeed(env, { fetchImpl = fetch, now = Date.now(), shared } = {}) {
  const store = shared === undefined ? await defaultShared() : shared;
  if (!store) throw new Error('Netlify Blobs is not available');
  const data = await fetchSheet(env, fetchImpl);
  await store.set({ at: now, data });
  cache = { data, at: now };
  return { athletes: data.athletes.length, generatedAt: data.generatedAt };
}
