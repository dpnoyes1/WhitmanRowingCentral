// Writes the feed the Sheet would send with the dummy data loaded, for local
// development and tests: `node site/scripts/dummy-feed.js > /tmp/feed.json`.
// Every athlete in it is made up (IDs A901+).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
    roster: d.roster, entries: d.entries, benchmarks: d.benchmarks, weights: d.weights,
    practices: d.practices, schedule: d.schedule, workouts: d.workouts, squadHistory: [], settings
  }, asOf || new Date(2026, 9, 23, 12))));
}

module.exports = { dummyFeed };
if (require.main === module) process.stdout.write(JSON.stringify(dummyFeed()));
