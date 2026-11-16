import { sessionSecret, makeToken, sessionCookie, clearCookie, athleteFor, parseBirthday, nameKey, displayName, adminKey } from '../lib/auth.mjs';
import { defaultCoachStore, defaultAthleteStore, checkPasswordRecord, readCredential, setCoachPassword, athletePasswordProblem, cleanPassword } from '../lib/coachpw.mjs';
import { getFeed } from '../lib/feed.mjs';

const env = (k) => Netlify.env.get(k);
const json = (body, status = 200, headers = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
const unavailable = () => json({ error: 'Sign-in is not working right now. Try again in a minute.' }, 503);

/**
 * POST /api/login { name, password }. An athlete types her name and her
 * birthday as the password; so does a coach listed in the Sheet's
 * site.coaches, or with the personal password she set from the menu. There is no shared password.
 *
 * Athlete passwords (David, 2026-11-12): an athlete with no password of her own signs in with her birthday once, and
 * then must choose a password (6 characters or more) before she gets a session. A coach's reset leaves a random
 * temporary password that works the same way. The first call answers { mustChange: true } with no cookie; the page
 * asks for the new password and calls again with { newPassword }, which saves it and signs her in.
 */
export async function handleLogin(req, envFn, deps = {}) {
  if (new URL(req.url).pathname === '/api/logout') {
    return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
  }
  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  if (typeof body.password === 'string') body.password = body.password.trim();   // a stray space from a phone keyboard
  if (typeof body.name === 'string') body.name = body.name.trim();
  const secret = sessionSecret(envFn);
  if (!secret) return json({ error: 'The site is not set up yet (missing FEED_KEY).' }, 500);
  let athlete = null;
  let coachName = '';
  let mustChange = false, athleteStore = null, changeStore = null, changeKey = '', cred = '';
  if (body.name) {
    try {
      const feed = (await getFeed(envFn, deps)).data;
      const key = nameKey(body.name);
      // Only a name that is not on the Roster can be a coach, so athletes never touch the coach password store.
      if (!feed.athletes.some((a) => nameKey(a.name) === key)) {
        // A coach with a personal password signs in with that, and her birthday no longer works.
        const store = deps.coachStore === undefined ? await defaultCoachStore() : deps.coachStore;
        // Review 2026-11-16: with no password store, a birthday could get past a saved password. Refuse for now instead.
        if (!store) return unavailable();
        if (adminKey(envFn)) {
          // Only the admin adds coaches (David, 2026-11-13): a coach is someone with a record here, made by the admin with a
          // temporary password. Only the admin can still use a birthday (the way back in), and only until they set a password.
          const rec = await checkPasswordRecord(store, key, body.password);
          if (rec && rec.ok) { athlete = 'team'; coachName = displayName(body.name); mustChange = rec.temp; changeStore = store; changeKey = key; cred = rec.v; }
          else if (rec === null && key === adminKey(envFn)) {
            athlete = athleteFor(envFn, feed, body.name, body.password);
            if (athlete === 'team') coachName = displayName(body.name);
          }
        } else {
          const own = await checkPasswordRecord(store, key, body.password);
          if (own && own.ok) { athlete = 'team'; coachName = displayName(body.name); cred = own.v; }
          else if (own) athlete = null;
          if (own === null) {
            athlete = athleteFor(envFn, feed, body.name, body.password);
            if (athlete === 'team') coachName = displayName(body.name);
          }
        }
      } else {
        athleteStore = deps.athleteStore === undefined ? await defaultAthleteStore() : deps.athleteStore;
        if (!athleteStore) return unavailable();
        // Two athletes can share a name (review 2026-11-16): try each one's own password, and a birthday finds the one it
        // belongs to. The same athlete ID is then used for the password check, the password save and the session.
        const matches = feed.athletes.filter((a) => a.active && nameKey(a.name) === key);
        for (const a of matches) {
          const own = await checkPasswordRecord(athleteStore, a.id, body.password);
          if (own && own.ok) { athlete = a; mustChange = own.temp; cred = own.v; break; }
        }
        if (!athlete) {
          // No password of her own yet: her birthday works once, then she must choose one.
          const a = athleteFor(envFn, feed, body.name, body.password);
          if (a && a !== 'team' && (await readCredential(athleteStore, a.id)) === null) { athlete = a; mustChange = true; }
        }
        if (athlete) { changeStore = athleteStore; changeKey = athlete.id; }
      }
      // Counts only (no names, dates or codes), to tell a missing Settings row from a typo.
      if (!athlete) {
        const logins = feed.logins || [];
        console.log('login failed:', JSON.stringify({
          feedVersion: feed.version, generatedAt: feed.generatedAt, athleteCodes: logins.filter((l) => !l.coach).length,
          coachCodes: logins.filter((l) => l.coach).length, dateParsed: !!parseBirthday(body.password),
          nameIsAthlete: feed.athletes.some((a) => nameKey(a.name) === nameKey(body.name))
        }));
      }
    } catch (err) {
      console.error('feed error:', err.message);
      return json({ error: 'Sign-in is not working right now. Try again in a minute.' }, 502);
    }
  }
  if (!athlete) {
    await new Promise((r) => setTimeout(r, deps.failDelayMs ?? 600));   // slows down guessing
    return json({ error: "That name and password don't match. Check the spelling of your first and last name, and type your birthday as MM/DD/YYYY (coaches: your password, if you set one)." }, 401);
  }
  if (mustChange) {
    if (body.newPassword === undefined) return json({ mustChange: true });
    const next = cleanPassword(body.newPassword);
    const problem = athletePasswordProblem(next);
    if (problem) return json({ mustChange: true, error: problem }, 400);
    if (next === cleanPassword(body.password)) return json({ mustChange: true, error: 'Choose a new password, not the one you just typed.' }, 400);
    try { cred = await setCoachPassword(changeStore, changeKey, next); } catch (err) {
      console.error('athlete password save error:', err.message);
      return json({ mustChange: true, error: 'The new password could not be saved. Try again.' }, 502);
    }
  }
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(makeToken(secret, athlete === 'team' ? 'team' : athlete.id, Date.now(), coachName, cred)) });
}

export default (req) => handleLogin(req, env);

export const config = {
  path: ['/api/login', '/api/logout'],
  method: 'POST',
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
