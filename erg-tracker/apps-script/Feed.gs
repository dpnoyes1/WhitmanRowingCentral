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
var FEED_VERSION = 3;

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { body = {}; }
  var key = PropertiesService.getScriptProperties().getProperty(FEED_KEY_PROP);
  if (!key || !feedKeyMatches_(key, body.key)) return feedJson_({ error: 'unauthorized' });
  if (body.action === LOGBOOK_ACTION) return feedJson_(processLogbookResult_(body));
  if (body.action === PLAN_FLAG_ACTION) return feedJson_(applyPlanFlagAction_(body));
  if (body.action === SLACK_LOG_ACTION) return feedJson_(processSlackLog_(body));
  if (body.action === SLACK_ACCESS_ACTION) return feedJson_(processSlackAccess_(body));
  if (body.action === SLACK_PHOTO_ACTION) return feedJson_(processSlackPhoto_(body));
  if (body.action === 'logbook-pending') return feedJson_(processLogbookPending_(body));
  if (body.action === 'logbook-confirm') return feedJson_(processLogbookConfirm_(body));
  if (body.action === SLACK_LOGBOOK_CONFIRM_ACTION) return feedJson_(processSlackLogbookConfirm_(body));
  if (body.action === 'logbook-accept-due') return feedJson_(processLogbookAcceptDue_());
  var inputs = feedInputs_();
  inputs.signLogin = feedLoginSigner_(key);
  return feedJson_(siteFeed(inputs, new Date()));
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

/**
 * Sign-in codes (David, 2026-10-23: athletes sign in with name + birthday).
 * HMAC-SHA256 of "login:<id>:<YYYY-MM-DD>" keyed with the feed key, as hex.
 * The site's server recomputes it from what she types; the date itself
 * never leaves the Sheet and the code never reaches a browser.
 */
function feedLoginSigner_(key) {
  return function (id, day) {
    return Utilities.computeHmacSha256Signature('login:' + id + ':' + day, key)
      .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  };
}

function feedInputs_() {
  return {
    roster: readObjects_(TABS.ROSTER),
    entries: readObjects_(TABS.ENTRIES),
    intervals: readObjects_(TABS.INTERVALS),
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

/** A date typed in a Settings cell (a Date, M/D/YYYY or YYYY-MM-DD) as YYYY-MM-DD, or ''. */
function feedParseDay_(v) {
  if (isDate_(v)) return dayKey_(v);
  var t = String(v || '').trim(), m;
  if (!t) return '';
  if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  var d = new Date(t);   // getSettings() turns a date cell into Date's text
  return isNaN(d) ? '' : dayKey_(d);
}

/**
 * Break date ranges from Settings oyo.break.dates ("12/23/2026-01/03/2027; ..."),
 * as [{ from, to }] with YYYY-MM-DD days. Dates are taken in pairs; an odd one is ignored.
 */
function feedBreakRanges_(v) {
  var days = (String(v || '').match(/\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{1,2}-\d{1,2}/g) || []).map(feedParseDay_);
  var out = [];
  for (var i = 0; i + 1 < days.length; i += 2) {
    if (days[i] && days[i + 1]) out.push(days[i] <= days[i + 1] ? { from: days[i], to: days[i + 1] } : { from: days[i + 1], to: days[i] });
  }
  return out;
}

/** Name for matching sign-ins; same rule as nameKey in site/lib/auth.mjs. */
function feedNameKey_(name) {
  return String(name || '').toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
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

/**
 * Logbook sessions waiting for the athlete's tap: shown on her page (and to
 * coaches) as "Found on Logbook". Pieces are raw time and meters, no weight.
 */
function feedLogbookPending_(inputs, known) {
  var ivByEntry = {};
  (inputs.intervals || []).forEach(function (iv) { (ivByEntry[iv['Entry ID']] = ivByEntry[iv['Entry ID']] || []).push(iv); });
  return inputs.entries.filter(function (e) {
    return isDate_(e.Date) && known[e['Athlete ID']] && feedPending_(e) && !feedRejected_(e) && String(e.Source) === 'Logbook';
  }).map(function (e) {
    var pieces = (ivByEntry[e['Entry ID']] || []).map(function (iv) {
      return { n: feedNum_(iv['Interval #']), workS: feedNum_(iv['Work s']), workM: feedNum_(iv['Work m']), rate: feedNum_(iv['Avg rate']) };
    });
    var shape = logbookBenchmarkShape(e, ivByEntry[e['Entry ID']] || []);
    return {
      id: String(e['Entry ID']), athleteId: e['Athlete ID'], date: feedDay_(e.Date),
      sessionType: String(e['Session type'] || ''), makeupFor: feedDay_(e['Make-up for date']),
      possibleMakeup: /make-?up/i.test(String(e['Review status'])), activity: String(e.Activity || ''),
      mainSet: String(e['Main set'] || ''), workS: feedNum_(e['Work s']), workM: feedNum_(e['Work m']),
      dragFactor: feedNum_(e['Drag factor']), benchmark: shape, pieces: pieces
    };
  });
}

/** Logbook sessions wait for the athlete's tap (or the 20-hour rule) before they count. */
function feedPending_(row) {
  return /^pending/i.test(String(row['Review status'] || ''));
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
  // One OYO Required and Elite for every athlete (David, 2026-10-27). The old
  // Roster columns OYO group / required / elite are no longer read.
  var oyoRequired = num('oyo.standard.required', 60);
  var oyoElite = num('oyo.standard.elite', 120);

  var athletes = inputs.roster.filter(function (r) {
    return String(r.Name || '').trim() !== '' && String(r['Athlete ID'] || '').trim() !== '';
  }).map(function (r) {
    return {
      id: String(r['Athlete ID']).trim(),
      name: String(r.Name).trim(),
      squad: String(r.Squad || '').trim(),
      role: /cox/i.test(String(r.Role)) ? 'Coxswain' : 'Rower',
      grade: schoolYear(r['Grad year'], asOf),
      gradYear: feedNum_(r['Grad year']),
      active: isActive_(r.Active),
      oyoRequired: oyoRequired,
      oyoElite: oyoElite
    };
  });
  var known = {};
  athletes.forEach(function (a) { known[a.id] = true; });

  // One sign-in code per active athlete with a birthday, or with the shared
  // Settings test password while it is set, plus one per coach in
  // site.coaches (keyed by name). See feedLoginSigner_.
  var logins = [];
  if (inputs.signLogin) {
    var testDay = feedParseDay_(s['site.test_password']);
    inputs.roster.forEach(function (r) {
      var id = String(r['Athlete ID'] || '').trim(), day = testDay || feedDay_(r.Birthday);
      if (id && day && String(r.Name || '').trim() && isActive_(r.Active)) logins.push({ id: id, code: inputs.signLogin(id, day) });
    });
    String(s['site.coaches'] || '').split(/[;\n]/).forEach(function (part) {
      var m = part.trim().match(/^(.*\S)\s+(\S+)$/);
      var day = m && feedParseDay_(m[2]), key = m && feedNameKey_(m[1]);
      if (day && key) logins.push({ coach: true, code: inputs.signLogin('coach:' + key, day) });
    });
  }

  var practices = inputs.practices.filter(function (p) { return isDate_(p.Date); }).map(function (p) {
    return {
      date: feedDay_(p.Date), squad: String(p.Squad || '').trim(), shift: String(p.Shift || '').trim(),
      canceled: /cancel/i.test(String(p.Status))
    };
  });

  var entries = inputs.entries.filter(function (e) {
    return isDate_(e.Date) && known[e['Athlete ID']] && !feedRejected_(e) && !feedPending_(e);
  }).map(function (e) {
    return {
      id: String(e['Entry ID']), date: feedDay_(e.Date), athleteId: e['Athlete ID'],
      type: String(e['Session type'] || ''), makeupFor: feedDay_(e['Make-up for date']),
      status: String(e.Status || ''), activity: String(e.Activity || ''),
      warmupS: feedNum_(e['Warmup s']), workS: feedNum_(e['Work s']), restS: feedNum_(e['Rest s']),
      cooldownS: feedNum_(e['Cooldown s']), workM: feedNum_(e['Work m']), restM: feedNum_(e['Rest m']),
      warmupM: feedNum_(e['Warmup m']), cooldownM: feedNum_(e['Cooldown m']),
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
      dateApprox: /import/i.test(String(b.Source || '')),   // imported history: the date is a placeholder inside the school year
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
  // Last week (coaches look back), this week and next. Each session carries what was logged against it.
  var weeks = [-7, 0, 7].map(function (offset) {
    var start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + offset);
    var w = weekPlanForSite(planInputs, start);
    feedWeekResults_(w.sessions, inputs, start);
    return { weekStart: w.weekStart, sessions: w.sessions };   // coachFlags stay in the Sheet
  });

  return {
    version: FEED_VERSION,
    generatedAt: asOf.toISOString(),
    today: feedDay_(asOf),
    settings: {
      timezone: s.timezone || 'America/New_York',
      schoolYearStart: s.school_year_start || '07-01',
      multipliers: multipliers,
      oyoRequired: oyoRequired,
      oyoElite: oyoElite,
      rateCap30r20: rateCap,
      makeupWindowDays: num('makeup_window_days', 7),
      loadJumpPct: num('load.jump_pct', 15),
      oyoBreak: {
        ranges: feedBreakRanges_(s['oyo.break.dates']),
        required: num('oyo.break.required', null),
        elite: num('oyo.break.elite', null)
      }
    },
    athletes: athletes,
    practices: practices,
    entries: entries,
    benchmarks: benchmarks,
    teamGms: teamGms,
    weeks: weeks,
    logged: feedLogged_(inputs, teamGmsYearStart_(asOf, s.school_year_start), s),
    logbookPending: feedLogbookPending_(inputs, known),
    logins: logins
  };
}

/**
 * Adds results to each site session: every logged entry whose planned session
 * (plannedFor; make-ups use the missed date) falls in the week, checked against
 * the plan with checkAgainstPlan. The site shows each athlete only her own;
 * coaches see everyone's (David, 2026-10-23). Raw splits only, no weight.
 */
function feedWeekResults_(sessions, inputs, start) {
  var end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  var s = inputs.settings || {};
  var squadOf = {};
  inputs.roster.forEach(function (r) { squadOf[r['Athlete ID']] = r.Squad; });
  var ivByEntry = {};
  (inputs.intervals || []).forEach(function (iv) { (ivByEntry[iv['Entry ID']] = ivByEntry[iv['Entry ID']] || []).push(iv); });
  sessions.forEach(function (sn) { sn.results = []; });
  inputs.entries.forEach(function (e) {
    if (!isDate_(e.Date) || !(e['Athlete ID'] in squadOf) || feedRejected_(e) || feedPending_(e) || String(e.Status) === 'Out') return;
    var planned = plannedFor(e, squadOf[e['Athlete ID']], inputs.schedule);
    if (!planned || planned.Date < start || planned.Date >= end) return;
    var sn = sessions.filter(function (x) {
      return x.day === dayKey_(planned.Date) && x.session === (planned.Session || 'Practice') && x.workoutId === String(planned['Workout ID']).trim();
    })[0];
    if (!sn) return;   // not published
    var bases = {};
    Object.keys(PLAN_BASES).forEach(function (b) {
      var best = seasonBestWatts(inputs.benchmarks, e['Athlete ID'], b, planned.Date, s.school_year_start);
      if (best) bases[b] = best.watts;
    });
    // Targets are RowErg splits. BikeErg counts at half its meters, so its /1000m split
    // compares to the RowErg /500m target (shown with a * on the site); other machines
    // don't compare, so no split or range. A benchmark test is scored as a test, not
    // against a range: split shown, no in/out mark.
    var activity = String(e.Activity || '');
    var rowErg = activity === '' || /rowerg|bikeerg/i.test(activity);
    var ivs = rowEquivalentIntervals((ivByEntry[e['Entry ID']] || []).slice()
      .sort(function (a, b) { return Number(a['Interval #']) - Number(b['Interval #']); }), activity);
    var c = checkAgainstPlan(ivs, workoutPieces(inputs.workouts, planned['Workout ID']), bases, s);
    var test = String(e['Benchmark ID'] || '') !== '';
    sn.results.push({
      athleteId: String(e['Athlete ID']), entryId: String(e['Entry ID']), date: feedDay_(e.Date),
      type: String(e['Session type'] || ''), status: String(e.Status || ''), activity: activity, test: test,
      matches: c.matches, reason: c.reason, hit: rowErg && !test ? c.hit : null, flag: planFlag(e, c),
      intervals: c.intervals.map(function (r, i) {
        var ws = feedNum_(ivs[i]['Work s']), wm = feedNum_(ivs[i]['Work m']);
        return rowErg ? { n: r.n, splitS: ws && wm ? Math.round((ws * 5000) / wm) / 10 : null, status: test ? '' : r.status }
          : { n: r.n, splitS: null, status: '' };
      })
    });
  });
}

/**
 * Splits and targets for every logged workout since yearStart (the current
 * school year; David, 2026-10-25). A piece's target is the one that stood on
 * the planned date (season best then). Older workouts are left out: their
 * totals stay in `entries`. Athletes see only their own (api.mjs).
 */
function feedLogged_(inputs, yearStart, s) {
  var squadOf = {};
  inputs.roster.forEach(function (r) { squadOf[r['Athlete ID']] = r.Squad; });
  var ivByEntry = {};
  (inputs.intervals || []).forEach(function (iv) { (ivByEntry[iv['Entry ID']] = ivByEntry[iv['Entry ID']] || []).push(iv); });
  var out = [];
  inputs.entries.forEach(function (e) {
    if (!isDate_(e.Date) || e.Date < yearStart || !(e['Athlete ID'] in squadOf) || feedRejected_(e) || feedPending_(e) || String(e.Status) === 'Out') return;
    var activity = String(e.Activity || '');
    var rowErg = activity === '' || /rowerg|bikeerg/i.test(activity);
    var test = String(e['Benchmark ID'] || '') !== '';
    var ivs = rowEquivalentIntervals((ivByEntry[e['Entry ID']] || []).slice()
      .sort(function (a, b) { return Number(a['Interval #']) - Number(b['Interval #']); }), activity);
    var planned = plannedFor(e, squadOf[e['Athlete ID']], inputs.schedule);
    var pieces = planned ? workoutPieces(inputs.workouts, planned['Workout ID']) : [];
    var bases = {};
    if (planned) {
      Object.keys(PLAN_BASES).forEach(function (b) {
        var best = seasonBestWatts(inputs.benchmarks, e['Athlete ID'], b, planned.Date, s.school_year_start);
        if (best) bases[b] = best.watts;
      });
    }
    var c = planned ? checkAgainstPlan(ivs, pieces, bases, s) : null;
    var owner = [];   // piece index for each planned interval, in order
    pieces.forEach(function (p, pi) { for (var k = 0; k < p.reps; k++) owner.push(pi); });
    out.push({
      id: String(e['Entry ID']), athleteId: e['Athlete ID'], date: feedDay_(e.Date),
      workout: pieces.length ? pieces[0].name : '', rowErg: rowErg, test: test,
      matches: c ? c.matches : null, reason: c ? c.reason : '', hit: c && rowErg && !test ? c.hit : null,
      pieces: pieces.map(function (p) {
        var pct = pieceTargetPct(p, s);
        var t = pct ? pieceTarget(p, bases[pct.base], s) : null;
        return { label: pieceLabel(p), target: rowErg && !test && t ? formatTarget(t) : null };
      }),
      intervals: ivs.map(function (iv, i) {
        var ws = feedNum_(iv['Work s']), wm = feedNum_(iv['Work m']);
        var row = c && rowErg && !test ? c.intervals[i] : null;
        return {
          n: i + 1, piece: i < owner.length ? owner[i] : null, workS: ws, workM: wm,
          splitS: rowErg && ws && wm ? Math.round((ws * 5000) / wm) / 10 : null,
          status: row ? row.status : ''
        };
      })
    });
  });
  return out;
}

/** Test keys as stored in Benchmarks ('100m', '500m', '2000m', '20min', '30r20'). */
function feedTestKeys_() {
  return Object.keys(BENCHMARK_TESTS).map(function (label) { return BENCHMARK_TESTS[label].key || label; });
}
