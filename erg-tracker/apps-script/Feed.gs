/**
 * Private data feed for the team site on Netlify. Only the site's server-side
 * functions call it, with a POST body {"key": "..."}. The key lives in Script
 * Properties (menu: Site feed key), never in the repo or a Sheet cell.
 *
 * Weight and birthdays never leave the Sheet. GMS %, stars and next-star gaps
 * are worked out here and only those go out. Coach notes, Slack IDs, Roster
 * notes and heart rate are left out too. siteFeed() is pure so it is tested
 * in Node; the site applies multipliers and OYO goals when it reads.
 */

var FEED_KEY_PROP = 'SITE_FEED_KEY';
var FEED_VERSION = 1;

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { body = {}; }
  var key = PropertiesService.getScriptProperties().getProperty(FEED_KEY_PROP);
  if (!key || !feedKeyMatches_(key, body.key)) return feedJson_({ error: 'unauthorized' });
  return feedJson_(siteFeed(feedInputs_(), new Date()));
}

function doGet() {
  return feedJson_({ error: 'unauthorized' });
}

function feedJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Compares every character so timing does not leak how much of the key matched. */
function feedKeyMatches_(key, given) {
  given = String(given || '');
  var diff = key.length ^ given.length;
  for (var i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ given.charCodeAt(i % Math.max(given.length, 1));
  return diff === 0;
}

function feedInputs_() {
  return {
    roster: readObjects_(TABS.ROSTER),
    entries: readObjects_(TABS.ENTRIES),
    benchmarks: readObjects_(TABS.BENCHMARKS),
    weights: readObjects_(TABS.WEIGHTS),
    practices: readObjects_(TABS.PRACTICES),
    schedule: readObjects_(TABS.SCHEDULE),
    workouts: readObjects_(TABS.WORKOUTS),
    squadHistory: readObjects_(TABS.SQUAD_HISTORY),
    settings: getSettings()
  };
}

/** Menu: shows the feed key, or makes one. Paste it into Netlify as FEED_KEY. */
function siteFeedKey() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty(FEED_KEY_PROP);
  if (key) {
    var again = ui.alert('Site feed key',
      'A key already exists. Make a new one?\n\nYes: new key (the site stops loading data until you paste it into Netlify as FEED_KEY and redeploy).\nNo: show the current key.',
      ui.ButtonSet.YES_NO_CANCEL);
    if (again === ui.Button.CANCEL || again === ui.Button.CLOSE) return;
    if (again === ui.Button.YES) key = null;
  }
  if (!key) {
    key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty(FEED_KEY_PROP, key);
  }
  ui.alert('Site feed key', 'Paste this into Netlify as the environment variable FEED_KEY:\n\n' + key +
    '\n\nKeep it private. Anyone with it and the feed URL can read team data (never weight or birthdays).', ui.ButtonSet.OK);
}

function feedDay_(d) {
  return isDate_(d) ? dayKey_(d) : '';
}

function feedNum_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

function feedRound_(x, places) {
  if (x === null || x === undefined || isNaN(x)) return null;
  var f = Math.pow(10, places || 0);
  return Math.round(x * f) / f;
}

function feedRejected_(row) {
  return /reject/i.test(String(row['Review status'] || ''));
}

/** Monday on or before `date`, at midnight. */
function feedMonday_(date) {
  var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/**
 * Everything the team site needs, JSON-safe (dates as YYYY-MM-DD).
 * inputs: feedInputs_() shape. asOf: Date ("today" for school year and weeks).
 */
function siteFeed(inputs, asOf) {
  var s = inputs.settings || {};
  var gmsOpts = gmsOptionsFromSettings(s);
  var num = function (key, fallback) {
    var v = parseFloat(s[key]);
    return isNaN(v) ? fallback : v;
  };

  var multipliers = {};
  ACTIVITIES.forEach(function (a) { multipliers[a[0]] = num('multiplier.' + a[0], a[1]); });
  var oyoDefaults = {
    Standard: { required: num('oyo.standard.required', 60), elite: num('oyo.standard.elite', 120) },
    Performance: { required: num('oyo.performance.required', 90), elite: num('oyo.performance.elite', 180) }
  };

  var athletes = inputs.roster.filter(function (r) {
    return String(r.Name || '').trim() !== '' && String(r['Athlete ID'] || '').trim() !== '';
  }).map(function (r) {
    var group = /perf/i.test(String(r['OYO group'])) ? 'Performance' : 'Standard';
    return {
      id: String(r['Athlete ID']).trim(),
      name: String(r.Name).trim(),
      squad: String(r.Squad || '').trim(),
      role: /cox/i.test(String(r.Role)) ? 'Coxswain' : 'Rower',
      grade: schoolYear(r['Grad year'], asOf),
      active: isActive_(r.Active),
      oyoGroup: group,
      oyoRequired: feedNum_(r['OYO required min']) !== null ? feedNum_(r['OYO required min']) : oyoDefaults[group].required,
      oyoElite: feedNum_(r['OYO elite min']) !== null ? feedNum_(r['OYO elite min']) : oyoDefaults[group].elite
    };
  });
  var known = {};
  athletes.forEach(function (a) { known[a.id] = true; });

  var practices = inputs.practices.filter(function (p) { return isDate_(p.Date); }).map(function (p) {
    return {
      date: feedDay_(p.Date), squad: String(p.Squad || '').trim(), shift: String(p.Shift || '').trim(),
      canceled: /cancel/i.test(String(p.Status))
    };
  });

  var entries = inputs.entries.filter(function (e) {
    return isDate_(e.Date) && known[e['Athlete ID']] && !feedRejected_(e);
  }).map(function (e) {
    return {
      id: String(e['Entry ID']), date: feedDay_(e.Date), athleteId: e['Athlete ID'],
      type: String(e['Session type'] || ''), makeupFor: feedDay_(e['Make-up for date']),
      status: String(e.Status || ''), activity: String(e.Activity || ''),
      warmupS: feedNum_(e['Warmup s']), workS: feedNum_(e['Work s']), restS: feedNum_(e['Rest s']),
      cooldownS: feedNum_(e['Cooldown s']), workM: feedNum_(e['Work m']), restM: feedNum_(e['Rest m']),
      mainSet: String(e['Main set'] || ''), zone: String(e.Zone || ''), rpe: feedNum_(e.RPE),
      dragFactor: feedNum_(e['Drag factor']), intervals: feedNum_(e.Intervals),
      benchmarkId: String(e['Benchmark ID'] || ''), source: String(e.Source || '')
    };
  });

  var rateCap = num('rate_cap_30r20', 20);
  var benchmarks = inputs.benchmarks.filter(function (b) {
    return isDate_(b.Date) && known[b['Athlete ID']] && !feedRejected_(b) && feedTestKeys_().indexOf(b.Test) >= 0;
  }).map(function (b) {
    var result = b.Test === '20min' || b.Test === '30r20' ? feedNum_(b.Meters) : feedNum_(b['Time s']);
    var rate = feedNum_(b['Avg rate']);
    var out = {
      id: String(b['Benchmark ID']), date: feedDay_(b.Date), athleteId: b['Athlete ID'], test: b.Test,
      timeS: feedNum_(b['Time s']), meters: feedNum_(b.Meters), avgRate: rate,
      valid: !(b.Test === '30r20' && rate !== null && rate > rateCap),
      gmsPct: null, stars: null, nextStar: null
    };
    if (result && b.Test !== '30r20') {
      var lb = weightOn_(inputs.weights, b['Athlete ID'], b.Date);
      if (lb) {
        out.gmsPct = feedRound_(gmsPercent(b.Test, result, lb, gmsOpts), 1);
        if (b.Test === '2000m' || b.Test === '20min') {
          out.stars = gmsStars(b.Test, result, lb, gmsOpts);
          var next = gmsNextStar(b.Test, result, lb, gmsOpts);
          out.nextStar = next && (b.Test === '2000m' ? {
            stars: next.stars, targetS: feedRound_(next.targetSeconds, 1),
            secondsFaster: feedRound_(next.secondsFaster, 1), splitFaster: feedRound_(next.splitFaster, 1)
          } : {
            stars: next.stars, targetM: next.targetMeters, metersMore: next.metersMore,
            splitFaster: feedRound_(next.splitFaster, 1)
          });
        }
      }
    }
    return out;
  });

  var teamGms = teamGmsForSite(teamGmsByYear({
    benchmarks: inputs.benchmarks, weights: inputs.weights, roster: inputs.roster,
    squadHistory: inputs.squadHistory || [], settings: s, asOf: asOf
  }), num('team_gms.min_group', 3)).map(function (y) {
    return { schoolYear: y.schoolYear, throughDate: feedDay_(y.throughDate), groups: y.groups };
  });

  var planInputs = {
    schedule: inputs.schedule, workouts: inputs.workouts, benchmarks: inputs.benchmarks, settings: s,
    roster: inputs.roster.filter(function (r) { return r.Name && isActive_(r.Active) && !/cox/i.test(String(r.Role)); })
  };
  var monday = feedMonday_(asOf);
  var weeks = [0, 7].map(function (offset) {
    var start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + offset);
    var w = weekPlanForSite(planInputs, start);
    return { weekStart: w.weekStart, sessions: w.sessions };   // coachFlags stay in the Sheet
  });

  return {
    version: FEED_VERSION,
    generatedAt: asOf.toISOString(),
    today: feedDay_(asOf),
    settings: {
      timezone: s.timezone || 'America/New_York',
      schoolYearStart: s.school_year_start || '08-01',
      modifiedMultiplier: num('modified_multiplier', 0.6),
      multipliers: multipliers,
      oyoDefaults: oyoDefaults,
      rateCap30r20: rateCap,
      makeupWindowDays: num('makeup_window_days', 7)
    },
    athletes: athletes,
    practices: practices,
    entries: entries,
    benchmarks: benchmarks,
    teamGms: teamGms,
    weeks: weeks
  };
}

/** Test keys as stored in Benchmarks ('100m', '500m', '2000m', '20min', '30r20'). */
function feedTestKeys_() {
  return Object.keys(BENCHMARK_TESTS).map(function (label) { return BENCHMARK_TESTS[label].key || label; });
}
