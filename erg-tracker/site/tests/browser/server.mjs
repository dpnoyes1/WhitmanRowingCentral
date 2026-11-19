// Local copy of the team site for the browser checks (David, 2026-11-17).
// Serves public/ and runs the real /api handlers on the DUMMY feed (all athletes fake, IDs A901+).
// The Google Sheet is replaced by a small in-memory fake, so nothing real is read or written.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as A from '../../lib/auth.mjs';
import { clearFeedCache } from '../../lib/feed.mjs';
import { handle } from '../../functions/api.mjs';
import { handleLogin } from '../../functions/login.mjs';
import { handleWorkouts } from '../../functions/workouts.mjs';
import { handleLogMine } from '../../functions/logmine.mjs';
import { handleLog } from '../../functions/log.mjs';
import { handleAttendanceMark } from '../../functions/attendance-mark.mjs';
import { handleWeights } from '../../functions/weights.mjs';
import { handleSettings } from '../../functions/settings.mjs';
import { handleAthletePasswords } from '../../functions/athlete-passwords.mjs';
import { handleCoaches } from '../../functions/coaches.mjs';
import { handleLineupNames } from '../../functions/lineup-names.mjs';
import { setCoachPassword } from '../../lib/coachpw.mjs';

const require = createRequire(import.meta.url);
const { dummyFeed, dummyBirthday } = require('../../scripts/dummy-feed.js');
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const VARS = { FEED_KEY: 'fake-key', FEED_URL: 'https://sheet.invalid/exec' };
export const env = (k) => VARS[k];
export const TODAY = '2026-10-23';          // the dummy feed's day (a Friday)
export const PLAN_TODAY = '2026-10-21';     // a Wednesday, so this week's Thursday is still plannable
export const COACH = { name: 'Pat Example', birthday: '2/3/1980' };   // made up

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain' };

const mapStore = () => {
  const m = new Map();
  return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); }, remove: async (k) => { m.delete(k); }, keys: async () => [...m.keys()] };
};

/** The fake Sheet: the feed, plus the few actions the checked pages use. `state` shows what was "written". */
function makeSheet(feed, state) {
  const planOut = (extra = {}) => ({ status: 'ok', today: PLAN_TODAY, library: state.library, upcoming: state.upcoming, ...extra });
  return async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.key !== VARS.FEED_KEY) return Response.json({ error: 'bad key' });
    switch (body.action) {
      case undefined: return Response.json(feed);
      case 'workout-list': return Response.json(planOut());
      case 'workout-save': {
        state.saves.push(body);
        let id = body.workoutId;
        if (!id) {
          id = 'W' + (state.library.length + 1);
          state.library.push({ id, name: body.name, summary: `${(body.pieces || []).length} piece(s)`, pieces: body.pieces, saved: body.keep === true });
        }
        const lib = state.library.find((w) => w.id === id);
        for (const day of body.dates || []) {
          state.upcoming.push({ day, workoutId: id, name: lib.name, squad: body.squad || 'All', session: body.session || 'Practice', published: !!body.publish, notes: body.notes || '' });
        }
        state.upcoming.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
        return Response.json(planOut({ savedId: id }));
      }
      case 'site-log': state.logs.push(body); return Response.json({ status: 'ok' });
      case 'attendance-mark': state.marks = state.marks || []; state.marks.push(body); return Response.json({ status: 'ok', changed: 0, created: true });
      case 'weights-get': return Response.json({ yearStart: '2026-07-01', rows: feed.athletes.filter((a) => a.active).slice(0, 12).map((a, i) => ({ id: a.id, name: a.name, squad: a.squad, lb: i % 3 ? 130 + i : null, by: i % 3 ? 'Pat Example' : '', day: i % 3 ? '2026-09-15' : '', status: i % 3 ? 'Current' : 'Missing' })) });
      case 'settings-get': return Response.json({ sections: [{ title: 'OYO goals', fields: [{ key: 'oyo.standard.required', label: 'Standard goal (min a week)', value: '60', help: 'Elite is double.' }] }] });
      default: return Response.json({ error: 'the browser check does not fake ' + body.action });
    }
  };
}

export async function startServer({ port = 0 } = {}) {
  // The login handler logs every wrong password; the checks make a few on purpose.
  const log = console.log;
  console.log = (...a) => { if (!String(a[0]).startsWith('login failed')) log(...a); };
  const feed = dummyFeed();
  const coachCode = A.loginCode(env, 'coach:' + A.nameKey(COACH.name), '1980-02-03');
  feed.logins = [...feed.logins, { coach: true, code: coachCode }];
  const state = { library: [], upcoming: [], saves: [], logs: [] };
  const fetchImpl = makeSheet(feed, state);
  const deps = { fetchImpl, feedFetch: fetchImpl, feedShared: null, shared: null, coachStore: mapStore(), athleteStore: mapStore(), lineupStore: mapStore(), store: null, today: TODAY, failDelayMs: 0 };
  // A901 already has a password (the sweep signs in many times); A902 is brand new, so the first sign-in flow can be tested.
  await setCoachPassword(deps.athleteStore, 'A901', 'row-fast-1');
  const routes = [
    ['/api/login', handleLogin], ['/api/logout', handleLogin], ['/api/workouts', handleWorkouts], ['/api/log-mine', handleLogMine],
    ['/api/log', handleLog], ['/api/attendance-mark', handleAttendanceMark], ['/api/weights', handleWeights], ['/api/settings', handleSettings],
    ['/api/athlete-passwords', handleAthletePasswords], ['/api/coaches', handleCoaches], ['/api/lineup-names', handleLineupNames]
  ];
  clearFeedCache();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = chunks.length ? Buffer.concat(chunks) : undefined;
        const r = new Request('http://localhost:' + server.address().port + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
        const hit = routes.find(([p]) => p === url.pathname);
        let out;
        if (hit) out = await hit[1](r, env, deps);
        else if (url.pathname.startsWith('/api/concept2/')) out = Response.json({ connected: false, pending: [], athletes: [] });
        else out = await handle(r, env, deps);
        res.writeHead(out.status, Object.fromEntries(out.headers));
        res.end(Buffer.from(await out.arrayBuffer()));
        return;
      }
      let file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname);
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      console.error('browser-check server error:', err);
      res.writeHead(500); res.end('error');
    }
  });
  await new Promise((ok) => server.listen(port, '127.0.0.1', ok));
  const url = 'http://localhost:' + server.address().port;
  return { url, state, feed, athlete: { id: 'A901', name: feed.athletes.find((a) => a.id === 'A901').name, password: 'row-fast-1' },
    newAthlete: { id: 'A902', name: feed.athletes.find((a) => a.id === 'A902').name, birthday: dummyBirthday('A902') }, close: () => new Promise((ok) => server.close(ok)) };
}
