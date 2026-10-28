// Scheduled backup for the Logbook webhook: every 15 minutes, look at each
// connected athlete's last few days of results and send any the Sheet hasn't seen.
import * as C2 from '../lib/concept2.mjs';
import { pollAll } from '../lib/logbook-sync.mjs';

export default async () => {
  const env = (k) => Netlify.env.get(k);
  if (!C2.configured(env)) return;
  try {
    const store = await C2.defaultStore();
    if (!store) return;
    console.log('logbook poll:', JSON.stringify(await pollAll(env, store, fetch)));
  } catch (err) {
    console.error('logbook poll failed:', err.message);
  }
};

export const config = { schedule: '*/15 * * * *' };
