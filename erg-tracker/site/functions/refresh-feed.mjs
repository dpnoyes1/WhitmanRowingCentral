// Scheduled function: every 5 minutes, copy the Sheet's feed into Netlify Blobs
// so no page load waits on Apps Script (see lib/feed.mjs). Runs on the
// published production deploy only.
import { refreshFeed } from '../lib/feed.mjs';

export default async () => {
  try {
    console.log('feed refreshed:', JSON.stringify(await refreshFeed((k) => Netlify.env.get(k))));
  } catch (err) {
    console.error('feed refresh failed:', err.message);
  }
};

export const config = { schedule: '*/5 * * * *' };
