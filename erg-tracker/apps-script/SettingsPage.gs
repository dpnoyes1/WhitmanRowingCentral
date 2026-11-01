/**
 * Coach Settings page on the team site (David, 2026-11-01). The page reads and
 * writes the same Settings tab rows the Sheet always held, so every rule
 * (multipliers, OYO goals, GMS, stars, shifts) still reads from there; only
 * the place to edit them moves. The field list below is the one source: the
 * site draws the page from it and the Sheet checks every value against it.
 * A key that is not listed here cannot be changed from the site, which keeps
 * sign-in dates (site.coaches, site.test_password), Slack IDs, alert addresses,
 * form ids and the GMS formula constants in the Sheet only.
 *
 * Types: decimal, int, time (m:ss.s, stored as seconds), clock (a time of day,
 * stored H:MM on a 24-hour clock), days (Mon,Wed,Fri-even), mmdd, date
 * (YYYY-MM-DD), ranges (break dates). optional: true allows a blank.
 * The pure parts are tested in Node; the doPost actions at the bottom touch the Sheet.
 */

var SETTINGS_GET_ACTION = 'settings-get';
var SETTINGS_SAVE_ACTION = 'settings-save';

function settingsPageSections_() {
  return [
    { id: 'multipliers', title: 'Activity multipliers',
      note: 'Weighted minutes = minutes x multiplier. Applied when the site reads, so a change recalculates all history.',
      fields: ACTIVITIES.map(function (a) {
        return { key: 'multiplier.' + a[0], label: a[0], type: 'decimal', min: 0, max: 3 };
      }) },
    { id: 'oyo', title: 'OYO goals (weekly, weighted min)',
      note: 'The same Required and Elite goal for every athlete. Break weeks use their own goals; leave those blank to keep the usual goal.',
      fields: [
        { key: 'oyo.standard.required', label: 'Required', type: 'int', min: 0, max: 2000 },
        { key: 'oyo.standard.elite', label: 'Elite', type: 'int', min: 0, max: 2000 },
        { key: 'oyo.break.dates', label: 'Break dates', type: 'ranges', optional: true, wide: true,
          help: 'Like 12/23/2026-01/03/2027. More than one: separate with ;. A week with 4 or more break days uses the break goals.' },
        { key: 'oyo.break.required', label: 'Break week Required', type: 'int', min: 0, max: 2000, optional: true },
        { key: 'oyo.break.elite', label: 'Break week Elite', type: 'int', min: 0, max: 2000, optional: true }
      ] },
    { id: 'gms', title: 'Gold Medal Standard and stars',
      note: 'GMS % is always measured against the 1v8 standard. A band\'s lower edge counts as in. Any valid 2k or 20\' earns 1 star.',
      fields: [
        { key: 'gms.standard_s', label: '1v8 standard (1500m 8+)', type: 'time', min: 120, max: 1200, help: 'm:ss.s, like 5:00.0' },
        { key: 'gms.star2_pct', label: '2 stars at GMS %', type: 'decimal', min: 1, max: 200 },
        { key: 'gms.star3_pct', label: '3 stars at GMS %', type: 'decimal', min: 1, max: 200 },
        { key: 'gms.star4_pct', label: '4 stars at GMS %', type: 'decimal', min: 1, max: 200 },
        { key: 'gms.star5_pct', label: '5 stars at GMS %', type: 'decimal', min: 1, max: 200 }
      ] },
    { id: 'rules', title: 'Training rules',
      fields: [
        { key: 'school_year_start', label: 'School year starts (month-day)', type: 'mmdd', help: 'Season bests, stars, boards and the rollover all use it. Like 07-01' },
        { key: 'default_drag_factor', label: 'Default drag factor', type: 'int', min: 60, max: 300, help: 'Other values are flagged for coaches' },
        { key: 'load.jump_pct', label: 'Load jump flag (%)', type: 'int', min: 1, max: 200, help: 'A week more than this % above the average of the 3 weeks before' },
        { key: 'autoaccept_hours', label: 'Auto-accept after (hours)', type: 'int', min: 1, max: 720 },
        { key: 'makeup_window_days', label: 'Make-up window (days)', type: 'int', min: 1, max: 60 },
        { key: 'return_to_training_days', label: 'Return to training after (days out)', type: 'int', min: 1, max: 30 },
        { key: 'rate_cap_30r20', label: '30r20 stroke rate cap', type: 'decimal', min: 10, max: 40, help: 'A 30r20 is valid when the average rate is at or under this' }
      ] },
    { id: 'schedule', title: 'Winter practice schedule (girls)',
      note: 'Times of day, like 3:30 pm. Days like Mon,Wed,Fri-even (Fri-even is Fridays on an even date). Pressing "Generate practice schedule" in the Sheet menu still builds the Practices tab from these.',
      fields: [
        { key: 'shift.early.days', label: 'Early shift days', type: 'days' },
        { key: 'shift.early.start', label: 'Early shift start', type: 'clock' },
        { key: 'shift.early.end', label: 'Early shift end', type: 'clock' },
        { key: 'shift.late.days', label: 'Late shift days', type: 'days' },
        { key: 'shift.late.start', label: 'Late shift start', type: 'clock' },
        { key: 'shift.late.end', label: 'Late shift end', type: 'clock' },
        { key: 'shift.window_pad_min', label: 'Classification window pad (min)', type: 'int', min: 0, max: 120, help: 'Added either side of the shift' },
        { key: 'season.winter_start', label: 'Winter season starts', type: 'date', optional: true, help: 'YYYY-MM-DD' },
        { key: 'season.winter_end', label: 'Winter season ends', type: 'date', optional: true, help: 'YYYY-MM-DD' }
      ] }
  ];
}

/** field definition for a Settings key, or null when the site may not change it. */
function settingsPageField_(key) {
  var found = null;
  settingsPageSections_().forEach(function (s) {
    s.fields.forEach(function (f) { if (f.key === key) found = f; });
  });
  return found;
}

/** Stored text -> what the page shows. */
function settingsDisplay_(field, stored) {
  var v = String(stored === undefined || stored === null ? '' : stored).trim();
  if (v === '') return '';
  if (field.type === 'time') {
    var n = Number(v);
    return isNaN(n) ? v : formatTime(n);
  }
  if (field.type === 'clock') {
    var m = v.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return v;
    var h = Number(m[1]);
    return ((h + 11) % 12 + 1) + ':' + m[2] + ' ' + (h < 12 ? 'am' : 'pm');
  }
  return v;
}

function settingsIsDay_(y, m, d) {
  var dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** Page text -> { value } (the text to store) or { error } in plain words. */
function settingsParse_(field, raw) {
  var t = String(raw === undefined || raw === null ? '' : raw).trim();
  if (t === '') return field.optional ? { value: '' } : { error: 'Needed.' };
  var n, m;
  switch (field.type) {
    case 'int':
    case 'decimal':
      if (!/^\d+(\.\d+)?$/.test(t)) return { error: 'Use a number.' };
      n = Number(t);
      if (field.type === 'int' && n !== Math.floor(n)) return { error: 'Use a whole number.' };
      if (n < field.min || n > field.max) return { error: 'Use a number from ' + field.min + ' to ' + field.max + '.' };
      return { value: String(n) };
    case 'time':
      try { n = parseTime(t); } catch (err) { return { error: 'Use m:ss.s, like 5:00.0.' }; }
      if (n === null || n < field.min || n > field.max) return { error: 'Use a time from ' + formatTime(field.min) + ' to ' + formatTime(field.max) + '.' };
      return { value: String(Math.round(n * 10) / 10) };
    case 'clock':
      m = t.match(/^(\d{1,2}):(\d{2})\s*([ap]m?)?$/i);
      if (!m) return { error: 'Use a time like 3:30 pm.' };
      var h = Number(m[1]), min = Number(m[2]);
      if (min > 59) return { error: 'Minutes must be 00 to 59.' };
      if (m[3]) {
        if (h < 1 || h > 12) return { error: 'Use a time like 3:30 pm.' };
        h = h % 12 + (/^p/i.test(m[3]) ? 12 : 0);
      } else {
        if (h > 23) return { error: 'Use a time like 3:30 pm.' };
        if (h < 6) return { error: 'Add am or pm, like 3:30 pm.' };
      }
      return { value: h + ':' + (min < 10 ? '0' : '') + min };
    case 'days':
      var parts = t.split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x; });
      if (!parts.length) return { error: 'Needed.' };
      for (var i = 0; i < parts.length; i++) {
        if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(-even|-odd)?$/.test(parts[i])) return { error: 'Use days like Mon,Wed,Fri-even.' };
      }
      return { value: parts.join(',') };
    case 'mmdd':
      m = t.match(/^(\d{1,2})-(\d{1,2})$/);
      if (!m || !settingsIsDay_(2024, Number(m[1]), Number(m[2]))) return { error: 'Use month-day, like 07-01.' };
      return { value: ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2) };
    case 'date':
      m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (!m || !settingsIsDay_(Number(m[1]), Number(m[2]), Number(m[3]))) return { error: 'Use YYYY-MM-DD.' };
      return { value: m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) };
    case 'ranges':
      var out = [];
      var pieces = t.split(';').map(function (x) { return x.trim(); }).filter(function (x) { return x; });
      for (var j = 0; j < pieces.length; j++) {
        m = pieces[j].match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (!m || !settingsIsDay_(Number(m[3]), Number(m[1]), Number(m[2])) || !settingsIsDay_(Number(m[6]), Number(m[4]), Number(m[5]))) {
          return { error: 'Use dates like 12/23/2026-01/03/2027, separated by ;.' };
        }
        if (new Date(Number(m[6]), Number(m[4]) - 1, Number(m[5])) < new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]))) {
          return { error: 'A break must end on or after it starts.' };
        }
        out.push(Number(m[1]) + '/' + Number(m[2]) + '/' + m[3] + '-' + Number(m[4]) + '/' + Number(m[5]) + '/' + m[6]);
      }
      return { value: out.join('; ') };
  }
  return { error: 'Not a setting you can change here.' };
}

/** What the page draws: sections with each field's current display value (a missing row shows its default). */
function settingsPageView_(settings) {
  var defaults = {};
  SETTINGS_DEFAULTS.forEach(function (d) { defaults[d[0]] = d[1]; });
  return settingsPageSections_().map(function (s) {
    return {
      id: s.id, title: s.title, note: s.note || '',
      fields: s.fields.map(function (f) {
        var stored = settings[f.key] === undefined ? defaults[f.key] : settings[f.key];
        return { key: f.key, label: f.label, type: f.type, help: f.help || '', optional: !!f.optional, wide: !!f.wide, value: settingsDisplay_(f, stored) };
      })
    };
  });
}

/**
 * changes: { key: text as typed }. Returns { updates: [{ key, old, value }], errors: { key: message } }.
 * Nothing is to be written when errors is not empty. Unchanged values are skipped.
 */
function settingsPlanSave_(settings, changes) {
  var updates = [], errors = {}, merged = {};
  Object.keys(settings).forEach(function (k) { merged[k] = settings[k]; });
  Object.keys(changes || {}).forEach(function (key) {
    var field = settingsPageField_(key);
    if (!field) { errors[key] = 'Not a setting you can change here.'; return; }
    var parsed = settingsParse_(field, changes[key]);
    if (parsed.error) { errors[key] = parsed.error; return; }
    var old = settings[key] === undefined ? '' : String(settings[key]).trim();
    merged[key] = parsed.value;
    if (parsed.value !== old) updates.push({ key: key, old: old, value: parsed.value });
  });
  // Star bands must rise: 2 < 3 < 4 < 5.
  var prev = null;
  ['gms.star2_pct', 'gms.star3_pct', 'gms.star4_pct', 'gms.star5_pct'].forEach(function (k) {
    var v = Number(merged[k]);
    if (prev !== null && !isNaN(v) && v <= prev.v && !errors[k] && !errors[prev.k]) errors[k] = 'Must be higher than the stars below it.';
    if (!isNaN(v)) prev = { k: k, v: v };
  });
  return { updates: updates, errors: errors };
}

// ---- doPost actions (touch the Sheet) ----

function processSettingsGet_() {
  return { status: 'ok', sections: settingsPageView_(getSettings()) };
}

/** body.changes: { key: text }. All or nothing; each change goes in the Change log. */
function processSettingsSave_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var changes = body.changes && typeof body.changes === 'object' ? body.changes : {};
    var plan = settingsPlanSave_(getSettings(), changes);
    if (Object.keys(plan.errors).length) return { status: 'invalid', errors: plan.errors };
    plan.updates.forEach(function (u) {
      logChange_({ Who: 'Settings page', Tab: TABS.SETTINGS, 'Row ID': u.key, Field: 'Value',
        'Old value': u.old, 'New value': u.value, Note: 'site Settings page' });
      setSetting_(u.key, u.value);
    });
    SpreadsheetApp.flush();
    return { status: 'ok', changed: plan.updates.length, sections: settingsPageView_(getSettings()) };
  } catch (err) {
    return { status: 'error', error: err.message };
  } finally {
    lock.releaseLock();
  }
}
