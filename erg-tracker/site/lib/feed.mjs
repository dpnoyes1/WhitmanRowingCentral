// Reads the Sheet's private feed (Apps Script web app, see apps-script/Feed.gs).
// Cached in memory for 5 minutes per function instance; if the Sheet is slow
// or down, the last good copy is served for up to a day and marked stale.

export const FEED_TTL_MS = 5 * 60 * 1000;
const STALE_LIMIT_MS = 24 * 60 * 60 * 1000;
let cache = null;   // { data, at }

export function clearFeedCache() {
  cache = null;
}

export async function getFeed(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (cache && now - cache.at < FEED_TTL_MS) return { data: cache.data, stale: false };
  const url = env('FEED_URL'), key = env('FEED_KEY');
  if (!url || !key) throw new Error('FEED_URL and FEED_KEY must be set in Netlify');
  try {
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
    cache = { data, at: now };
    return { data, stale: false };
  } catch (err) {
    if (cache && now - cache.at < STALE_LIMIT_MS) return { data: cache.data, stale: true };
    throw err;
  }
}
