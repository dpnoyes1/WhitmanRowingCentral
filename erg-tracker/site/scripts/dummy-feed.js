// Writes the feed the Sheet would send with the dummy data loaded, for local
// development and tests: `node site/scripts/dummy-feed.js > /tmp/feed.json`.
// Every athlete in it is made up (IDs A901+).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

// Matches the fake FEED_KEY the site's tests and local dev server use.
const FAKE_FEED_KEY = 'fake-key';
const signLogin = (id, day) => crypto.createHmac('sha256', FAKE_FEED_KEY).update('login:' + id + ':' + day).digest('hex');

const dir = path.join(__dirname, '..', '..', 'apps-script');
const ctx = vm.createContext({ console });
['Config.gs', 'Time.gs', 'Gms.gs', 'Sheet.gs', 'Form.gs', 'Submit.gs', 'Setup.gs', 'Plan.gs', 'PlanSheet.gs',
  'Profile.gs', 'Dummy.gs', 'TeamGms.gs', 'Regatta.gs', 'Feed.gs'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));

function dummyFeed(asOf) {
  const settings = {};
  ctx.SETTINGS_DEFAULTS.forEach(r => { settings[r[0]] = r[1]; });
  const d = ctx.buildDummyData({ settings });
  return JSON.parse(JSON.stringify(ctx.siteFeed({
    roster: d.roster, entries: d.entries, intervals: d.intervals, benchmarks: d.benchmarks, weights: d.weights,
    practices: d.practices, schedule: d.schedule, workouts: d.workouts, squadHistory: [], settings, signLogin
  }, asOf || new Date(2026, 9, 23, 12))));
}

/** A dummy athlete's birthday as YYYY-MM-DD, for sign-in tests and local dev (all made up). */
function dummyBirthday(id) {
  const settings = {};
  ctx.SETTINGS_DEFAULTS.forEach(r => { settings[r[0]] = r[1]; });
  const r = ctx.buildDummyData({ settings }).roster.find(x => x['Athlete ID'] === id);
  return r ? ctx.dayKey_(r.Birthday) : null;
}

module.exports = { dummyFeed, dummyBirthday, FAKE_FEED_KEY };
if (require.main === module) process.stdout.write(JSON.stringify(dummyFeed()));
