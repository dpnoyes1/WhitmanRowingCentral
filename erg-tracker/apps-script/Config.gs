/**
 * Tab layouts, Settings defaults and Form question titles.
 * Column headers are the contract with the Netlify site: add columns at the
 * end, never rename or reorder existing ones without updating the site.
 */

var TABS = {
  ROSTER: 'Roster',
  ENTRIES: 'Entries',
  INTERVALS: 'Intervals',
  BENCHMARKS: 'Benchmarks',
  WEIGHTS: 'Weights',
  PRACTICES: 'Practices',
  SETTINGS: 'Settings',
  CHANGE_LOG: 'Change log',
  WORKOUTS: 'Workouts',
  SCHEDULE: 'Schedule',
  SQUAD_HISTORY: 'Squad history',
  RACES: 'Races'
};

var HEADERS = {};
HEADERS[TABS.ROSTER] = [
  'Athlete ID', 'Name', 'Slack member ID', 'Squad', 'Role', 'OYO group',
  'OYO required min', 'OYO elite min', 'Active', 'Notes',
  'Birthday', 'Grad year', 'Age group', 'School year'
];
HEADERS[TABS.ENTRIES] = [
  'Entry ID', 'Submitted at', 'Date', 'Athlete ID', 'Athlete', 'Entered by',
  'Session type', 'Make-up for date', 'Status', 'Activity',
  'Warmup s', 'Work s', 'Rest s', 'Cooldown s', 'Work m', 'Rest m',
  'Main set', 'Zone', 'RPE', 'Avg HR', 'Drag factor', 'Intervals',
  'Coach note', 'Source', 'Review status', 'Response ID', 'Benchmark ID',
  'Warmup m', 'Cooldown m'
];
HEADERS[TABS.INTERVALS] = [
  'Entry ID', 'Interval #', 'Work s', 'Work m', 'Avg rate', 'Rest s', 'Rest m'
];
HEADERS[TABS.BENCHMARKS] = [
  'Benchmark ID', 'Submitted at', 'Date', 'Athlete ID', 'Athlete', 'Entered by',
  'Test', 'Time s', 'Meters', 'Avg rate', 'Drag factor', 'Splits s',
  'Coach note', 'Source', 'Review status', 'Response ID', 'Entry ID', 'Drag check'
];
HEADERS[TABS.WEIGHTS] = [
  'Date', 'Athlete ID', 'Athlete', 'Weight lb', 'Entered by', 'Note'
];
HEADERS[TABS.PRACTICES] = [
  'Date', 'Squad', 'Shift', 'Start', 'End', 'Window start', 'Window end',
  'Status', 'Planned workout', 'Notes'
];
HEADERS[TABS.SETTINGS] = ['Key', 'Value', 'Notes'];
HEADERS[TABS.CHANGE_LOG] = [
  'Timestamp', 'Who', 'Tab', 'Cell', 'Row ID', 'Field', 'Old value', 'New value', 'Note'
];
// Workout library: one row per piece. Work/Rest/Start every are typed as m:ss
// by coaches (like Settings) and parsed with parseTime when read.
HEADERS[TABS.WORKOUTS] = [
  'Workout ID', 'Name', 'Piece #', 'Reps', 'Work type', 'Work', 'Rest', 'Start every',
  'Activity', 'Zone', 'Base', 'Target low %', 'Target high %', 'Rate', 'Notes'
];
// One row per session per day. Published = No keeps it hidden from athletes.
HEADERS[TABS.SCHEDULE] = [
  'Date', 'Squad', 'Session', 'Workout ID', 'Published', 'Notes'
];
// Squad each rower was on in a past school year ("2025-26"). Missing rows fall back to Roster.
HEADERS[TABS.SQUAD_HISTORY] = ['School year', 'Athlete ID', 'Athlete', 'Squad'];
// Coach-only. One row per race; times typed as m:ss and parsed when read. Seat 1 = bow, Seat 8 = stroke; 4+ uses Seats 1-4.
HEADERS[TABS.RACES] = [
  'Date', 'Regatta', 'Championship', 'Event', 'Boat', 'Round', 'Time', 'Place',
  '1st time', '2nd time', '3rd time',
  'Seat 1', 'Seat 2', 'Seat 3', 'Seat 4', 'Seat 5', 'Seat 6', 'Seat 7', 'Seat 8', 'Cox', 'Notes'
];

/** Columns holding clock times or codes that Sheets must not auto-convert. */
var TEXT_COLUMNS = {};
TEXT_COLUMNS[TABS.PRACTICES] = ['Start', 'End', 'Window start', 'Window end'];
TEXT_COLUMNS[TABS.SETTINGS] = ['Value'];
TEXT_COLUMNS[TABS.ROSTER] = ['Slack member ID'];
TEXT_COLUMNS[TABS.SQUAD_HISTORY] = ['School year'];
TEXT_COLUMNS[TABS.RACES] = ['Time', '1st time', '2nd time', '3rd time'];
TEXT_COLUMNS[TABS.WORKOUTS] = ['Workout ID', 'Work', 'Rest', 'Start every', 'Rate'];
TEXT_COLUMNS[TABS.SCHEDULE] = ['Workout ID'];

/**
 * Columns the Sheet fills itself with one array formula in the header cell.
 * Each builder gets {header: column letter} and returns the formula. The
 * formulas mirror ageGroup() / schoolYear() in Profile.gs.
 */
var COMPUTED_COLUMNS = {};
COMPUTED_COLUMNS[TABS.ROSTER] = {
  'Age group': function (c) { return ageGroupFormula_(c['Birthday']); },
  'School year': function (c) { return schoolYearFormula_(c['Grad year']); }
};

/** Tabs whose manual edits are written to the Change log. */
var LOGGED_TABS = [TABS.ENTRIES, TABS.INTERVALS, TABS.BENCHMARKS, TABS.WEIGHTS, TABS.ROSTER];

var ACTIVITIES = [
  ['Erg (RowErg)', 1.0],
  ['BikeErg', 1.0],
  ['Bike', 0.6],
  ['Run', 1.2],
  ['Stair stepper', 0.9],
  ['Swim', 0.8],
  ['Elliptical', 0.7],
  ['Lifting', 0]
];

// Every test also becomes an Entries session. meters/seconds fill the fixed side
// of the piece; zone is the default tag for that session (assumption, edit freely).
var BENCHMARK_TESTS = {
  '100m': { score: 'time', meters: 100, zone: 'Anaerobic' },
  '500m': { score: 'time', meters: 500, zone: 'Anaerobic' },
  '2000m': { score: 'time', meters: 2000, zone: 'Anaerobic' },
  "20' (20 min)": { score: 'meters', key: '20min', seconds: 1200, zone: 'Threshold' },
  '30r20': { score: 'meters', seconds: 1800, zone: 'Aerobic' }
};

var ZONES = ['Aerobic', 'Threshold', 'Anaerobic'];
var MAX_INTERVALS = 10;

/** [key, default value, note]. Values are stored as text; read with getSettings(). */
var SETTINGS_DEFAULTS = [
  ['timezone', 'America/New_York', 'Spreadsheet and script time zone'],
  ['school_year_start', '07-01', 'MM-DD. Leaderboards "School Year" start'],
  ['coaches', 'Coach David, Coach Forrest, Coach Greta', 'Comma separated. Shown in "Entered by"'],
  ['default_drag_factor', '105', 'Prefilled; other values flagged for coaches'],
  ['makeup_window_days', '7', 'Make-ups must be within this many days'],
  ['site.test_password', '', 'MM/DD/YYYY. While set, every athlete signs in to the team site with this date instead of her birthday'],
  ['site.coaches', '', 'Coach sign-ins for the team site: "First Last MM/DD/YYYY", separated by ;. Coaches see everything, GMS % included'],
  ['site.url', 'https://whitmanrowingcentral.netlify.app', 'Team site address, checked every hour for alerts'],
  ['alerts.email', '', 'Where alerts go when no Slack webhook is set. Blank: the Sheet owner'],
  ['backup.keep', '12', 'Weekly backups kept in Drive > Erg tracker backups (archives are always kept)'],
  ['backup.folder_id', '', 'Filled in automatically on the first backup'],
  ['return_to_training_days', '5', 'Consecutive days out that trigger a ramp-back week'],
  ['autoaccept_hours', '48', 'Phase 2: unchanged auto-labels accepted after this'],
  ['load.jump_pct', '15', "Coaches see a flag when a week's weighted minutes are more than this % above the average of the 3 weeks before (fewer in her first weeks)"],
  ['oyo.standard.required', '60', 'Weekly weighted OYO minutes Required, the same for every athlete'],
  ['oyo.standard.elite', '120', 'Weekly weighted OYO minutes Elite, the same for every athlete'],
  ['oyo.break.dates', '', 'Breaks with no practice, e.g. 12/23/2026-01/03/2027; more than one separated by ;. A week with 4 or more break days uses the break goals'],
  ['oyo.break.required', '', 'Weekly OYO Required in break weeks, for everyone. Blank = the normal goal'],
  ['oyo.break.elite', '', 'Weekly OYO Elite in break weeks, for everyone. Blank = the normal goal'],
  ['gms.standard_s', '300', '1v8 1500m standard (5:00). GMS % is always vs this'],
  ['gms.star2_pct', '95', 'GMS % for 2 stars. Every 2k or 20\' earns 1 star; each edge counts as in'],
  ['gms.star3_pct', '96', 'GMS % for 3 stars'],
  ['gms.star4_pct', '97', 'GMS % for 4 stars'],
  ['gms.star5_pct', '100', 'GMS % for 5 stars'],
  ['gms.factor_1500', '0.75', 'P = factor * T * (W/ref)^exp'],
  ['gms.ref_weight_lb', '270', ''],
  ['gms.exponent', '0.222', ''],
  ['gms.offset_20min_s', '8.5', '2k split = 20 min split - offset'],
  ['gms.divisor_500m', '0.895', '2k split = 500m split / divisor'],
  ['gms.divisor_100m', '0.786', '2k split = 100m split / divisor'],
  ['team_gms.min_group', '3', 'Team site hides a GMS average with fewer rowers than this'],
  ['rate_cap_30r20', '20', '30r20 valid when average rate <= this'],
  ['shift.early.days', 'Mon,Wed,Fri-even', 'Girls winter early shift'],
  ['shift.early.start', '15:30', ''],
  ['shift.early.end', '17:30', ''],
  ['shift.late.days', 'Tue,Thu,Fri-odd', 'Girls winter late shift'],
  ['shift.late.start', '17:00', ''],
  ['shift.late.end', '19:00', ''],
  ['shift.window_pad_min', '30', 'Classification window = shift +/- this'],
  ['season.winter_start', '', 'YYYY-MM-DD. Used by "Generate practice schedule"'],
  ['season.winter_end', '', 'YYYY-MM-DD'],
  ['target.default_base', '2k', "Base when a workout piece leaves Base blank: 2k or 20'"],
  ['target.Aerobic.2000m', '60-70', 'PLACEHOLDER: % of season-best 2k watts. A range shows a range'],
  ['target.Threshold.2000m', '80', 'PLACEHOLDER: one number shows a single target'],
  ['target.Anaerobic.2000m', '95', 'PLACEHOLDER'],
  ['target.Aerobic.20min', '70-80', "PLACEHOLDER: % of season-best 20' watts"],
  ['target.Threshold.20min', '95', 'PLACEHOLDER'],
  ['target.Anaerobic.20min', '110', 'PLACEHOLDER'],
  ['target.single_tolerance_pct', '2', 'Plan check: a single target is hit within +/- this %'],
  ['form.id', '', 'Written by setup()'],
  ['form.edit_url', '', 'Written by setup()'],
  ['form.share_url', '', 'Prefilled link to share with athletes. Written by setup()']
].concat(ACTIVITIES.map(function (a) {
  return ['multiplier.' + a[0], String(a[1]), 'Coaching approximation; edit freely'];
}));

/**
 * Form question titles. The submit handler finds answers by these titles, so
 * rename a question here (and re-run "Rebuild form"), never only in the Form.
 */
var Q = {
  ATHLETE: 'Athlete',
  ENTERED_BY: 'Entered by',
  DATE: 'Date of session',
  LOG_TYPE: 'What are you logging?',
  STATUS: 'How did you do practice?',
  OUT_NOTE: 'Anything coaches should know? (optional)',
  MAKEUP_FOR: 'Date of the practice you missed',
  ACTIVITY: 'Activity',
  WARMUP: 'Warmup time',
  WARMUP_M: 'Warmup meters (optional)',
  MAIN_SET: 'Main set (e.g. 3x10\' r2\')',
  ZONE: 'Main set zone',
  COOLDOWN: 'Cooldown time (optional)',
  COOLDOWN_M: 'Cooldown meters (optional)',
  RPE: 'Session RPE (how hard was the whole session?)',
  HR: 'Average heart rate (optional)',
  DRAG: 'Drag factor',
  NOTE: 'Note for coaches (optional)',
  TEST: 'Which test?',
  B_WHERE: 'Where did you do the test?',
  B_WARMUP: 'Warmup time before the test',
  B_COOLDOWN: 'Cooldown time after the test (optional)',
  B_RPE: 'Session RPE for the whole test session',
  // Titles must be unique across the whole form, so the two test sections differ slightly.
  T_TIME: 'Test time',
  T_RATE: 'Average stroke rate (optional)',
  T_DRAG: 'Drag factor on the test',
  T_SPLITS: '500m splits (optional, comma separated)',
  T_NOTE: 'Test note for coaches (optional)',
  D_METERS: 'Total meters',
  D_RATE: 'Average stroke rate',
  D_DRAG: 'Drag factor during the test',
  D_SPLITS: 'Splits per 500m (optional, comma separated)',
  D_NOTE: 'Note on this test for coaches (optional)'
};

/** Per-interval question titles, n = 1..MAX_INTERVALS. */
function qInterval(n) {
  return {
    WORK_TIME: 'Interval ' + n + ': work time',
    WORK_M: 'Interval ' + n + ': work meters',
    RATE: 'Interval ' + n + ': average stroke rate (optional)',
    REST_TIME: 'Interval ' + n + ': rest time after (optional)',
    REST_M: 'Interval ' + n + ': rest meters (optional)',
    ANOTHER: 'Another interval after interval ' + n + '?'
  };
}

var LOG_TYPES = { PRACTICE: 'Practice', OYO: 'On your own (OYO)', MAKEUP: 'Make-up for a missed practice', BENCHMARK: 'Benchmark test' };
var TEST_WHERE = { PRACTICE: 'At practice', OYO: 'On my own' };
var STATUSES = { FULL: 'Full', MODIFIED: 'Modified (e.g. BikeErg instead)', OUT: 'Out' };
