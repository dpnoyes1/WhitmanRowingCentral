// /log in Slack: the modal, reading it back, checking it, and the reply texts.
// Mirrors apps-script/SlackLog.gs and the Form (Config.gs). The cross-check test
// compares ACTIVITIES, ZONES and the pieces rules with the Apps Script copies.
export const ACTIVITIES = ['Erg (RowErg)', 'BikeErg', 'Bike', 'Run', 'Stair stepper', 'Swim', 'Elliptical', 'Lifting'];
export const ZONES = ['Aerobic', 'Threshold', 'Anaerobic'];
export const MAX_INTERVALS = 10;
export const TIME_RE = /^\s*\d{1,3}:[0-5]\d(\.\d)?\s*$/;

const TYPES = [['practice', 'Practice'], ['oyo', 'On your own (OYO)'], ['makeup', 'Make-up for a missed practice']];
const STATUSES = [['full', 'Full'], ['modified', 'Modified (e.g. BikeErg instead)'], ['out', 'Out']];

/** Today's date (YYYY-MM-DD) in the team's time zone. */
export function todayEastern(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
}

const opt = (value, label) => ({ text: { type: 'plain_text', text: label }, value });
const label = (text) => ({ type: 'plain_text', text });
const input = (id, text, element, { optional = false, hint } = {}) => ({
  type: 'input', block_id: id, optional, label: label(text), ...(hint ? { hint: label(hint) } : {}),
  element: { action_id: 'v', ...element }
});
const text = (placeholder, extra = {}) => ({ type: 'plain_text_input', placeholder: label(placeholder), ...extra });
const select = (options, initial) => ({
  type: 'static_select', options: options.map(([v, l]) => opt(v, l)),
  ...(initial ? { initial_option: opt(...options.find(([v]) => v === initial)) } : {})
});
const list = (values) => values.map((v) => [v, v]);

export function logModal(today = todayEastern()) {
  return {
    type: 'modal', callback_id: 'log_modal',
    title: label('Log a workout'), submit: label('Save'), close: label('Cancel'),
    blocks: [
      input('athlete', 'Athlete (coaches only)', text('Full name as on the Roster'), { optional: true,
        hint: 'Athletes: leave this blank, it saves for you. Coaches: the athlete you are logging for.' }),
      input('date', 'Date of session', { type: 'datepicker', initial_date: today }),
      input('type', 'What are you logging?', select(TYPES, 'practice')),
      input('status', 'Practice only: how did you do practice?', select(STATUSES, 'full'), { optional: true,
        hint: 'Choose Out and nothing below is needed except an optional note.' }),
      input('makeup_for', 'Make-up only: date of the practice you missed', { type: 'datepicker' }, { optional: true }),
      input('activity', 'Activity', select(list(ACTIVITIES), 'Erg (RowErg)')),
      input('warmup', 'Warmup time', text('e.g. 15:00'), { hint: 'Minutes:seconds. Use 0:00 if none.' }),
      input('warmup_m', 'Warmup meters (optional)', text('e.g. 2500'), { optional: true }),
      input('main_set', "Main set (e.g. 3x10' r2')", text("3x10' r2'")),
      input('zone', 'Main set zone', select(list(ZONES))),
      input('pieces', 'Pieces', text('2:00.0, 500, 24, 1:00, 0', { multiline: true }), {
        hint: 'One line per piece (max 10): work time, meters, rate, rest time, rest meters. Rate and rest can be left off.' }),
      input('cooldown', 'Cooldown time (optional)', text('e.g. 10:00'), { optional: true }),
      input('cooldown_m', 'Cooldown meters (optional)', text('e.g. 1800'), { optional: true }),
      input('rpe', 'Session RPE (how hard was the whole session?)', select(Array.from({ length: 10 }, (_, i) => [String(i + 1), String(i + 1)]))),
      input('drag', 'Drag factor', text('105', { initial_value: '105' })),
      input('hr', 'Average heart rate (optional)', text('e.g. 150'), { optional: true }),
      input('note', 'Note for coaches (optional)', text('Only coaches see this', { multiline: true }), { optional: true })
    ]
  };
}

/** The modal's values as { field: string }, from view.state.values. */
export function readLogForm(view) {
  const out = {};
  const values = (view && view.state && view.state.values) || {};
  for (const [id, block] of Object.entries(values)) {
    const v = block && block.v;
    if (!v) continue;
    out[id] = v.type === 'static_select' ? (v.selected_option ? v.selected_option.value : '')
      : v.type === 'datepicker' ? (v.selected_date || '')
      : String(v.value == null ? '' : v.value).trim();
  }
  return out;
}

/** The first problem in the pieces box as a sentence, or ''. */
export function piecesError(textValue) {
  const lines = String(textValue || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  if (!lines.length) return 'Enter at least one piece';
  if (lines.length > MAX_INTERVALS) return `At most ${MAX_INTERVALS} pieces (you have ${lines.length})`;
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].split(',').map((x) => x.trim());
    const where = `Piece ${i + 1}: `;
    if (f.length > 5) return where + 'too many commas (work time, meters, rate, rest time, rest meters)';
    const time = (v, what) => (v !== '' && !TIME_RE.test(v) ? `${where}${what} "${v}" should look like 2:00.0` : '');
    const num = (v, what, max) => (v !== '' && (!/^\d+(\.\d+)?$/.test(v) || Number(v) > max) ? `${where}${what} "${v}" is not a number I can use` : '');
    if (f[0] === '') return where + 'work time is missing';
    let e = time(f[0], 'work time');
    if (e) return e;
    if (f[1] === undefined || f[1] === '') return where + 'work meters are missing';
    e = num(f[1], 'work meters', 100000) || num(f[2] || '', 'stroke rate', 80) || time(f[3] || '', 'rest time') || num(f[4] || '', 'rest meters', 100000);
    if (e) return e;
  }
  return '';
}

/** { block_id: message } for Slack to show next to the fields, or {} when it's fine to save. */
export function validateLogForm(f, today = todayEastern()) {
  const errors = {};
  const type = f.type || 'practice';
  if (!f.date) errors.date = 'Pick the date';
  else if (f.date > today) errors.date = 'That date is in the future';
  if (type === 'makeup') {
    if (!f.makeup_for) errors.makeup_for = 'Pick the date of the practice you missed';
    else if (f.makeup_for >= f.date) errors.makeup_for = 'The missed practice is before the make-up';
  }
  if (type === 'practice' && (f.status || 'full') === 'out') return errors;   // nothing else is needed
  const number = (id, what, min, max, whole = true) => {
    const v = f[id];
    if (v === undefined || v === '') return;
    const n = Number(v);
    if (!/^\d+(\.\d+)?$/.test(v) || n < min || n > max || (whole && !Number.isInteger(n))) errors[id] = `${what} should be a number from ${min} to ${max}`;
  };
  const time = (id, required) => {
    const v = f[id] || '';
    if (v === '' && required) errors[id] = 'Required, like 15:00';
    else if (v !== '' && !TIME_RE.test(v)) errors[id] = 'Use minutes:seconds, like 15:00';
  };
  if (!f.activity) errors.activity = 'Pick an activity';
  time('warmup', true);
  time('cooldown', false);
  number('warmup_m', 'Meters', 0, 20000);
  number('cooldown_m', 'Meters', 0, 20000);
  number('hr', 'Heart rate', 40, 230);
  number('drag', 'Drag factor', 50, 250);
  if (!f.drag) errors.drag = 'Required (usually 105)';
  if (!f.main_set) errors.main_set = 'Describe the workout';
  if (!f.zone) errors.zone = 'Pick a zone';
  if (!f.rpe) errors.rpe = 'Pick an RPE';
  const pe = piecesError(f.pieces);
  if (pe) errors.pieces = pe;
  return errors;
}

/** When the Slack account isn't a coach's or on an active Roster row. */
export const NOT_ON_ROSTER = ':lock: I don\'t know this Slack account yet. Ask a coach to add your Slack member ID to the Roster, or use the Form: whitmanrowingcentral.netlify.app/logworkout';

/** DM text after the Sheet answers. */
export function logReply(result) {
  if (result.status === 'ok') {
    if (result.entryStatus === 'Out') return ':white_check_mark: Saved: you were Out. Coaches can see it in the Sheet.';
    const bits = [result.sessionType, result.activity, `${result.pieces} piece${result.pieces === 1 ? '' : 's'}`].filter(Boolean).join(', ');
    return `:white_check_mark: Saved${result.athlete ? ' for ' + result.athlete : ''} (${bits}).` + (result.flagged ? ' It doesn\'t match today\'s plan, so a coach will take a look.' : '');
  }
  if (result.status === 'duplicate') return ':information_source: That was already saved. Nothing changed.';
  if (result.status === 'not_allowed') return NOT_ON_ROSTER;
  if (result.status === 'not_yourself') return ':lock: Not saved: you can only log for yourself. Leave the Athlete box blank and run /log again.';
  if (result.status === 'unknown_name') return ':warning: Not saved: that name isn\'t an active athlete on the Roster. Coaches: check the spelling and run /log again.';
  return `:warning: Not saved: ${result.error || 'unknown problem'}. Run /log again, or use the Form.`;
}

/** The FYI DM to an athlete when a coach logged for her, or '' when none is due. */
export function fyiText(result) {
  if (!result || result.status !== 'ok' || !result.notifySlackId) return '';
  const by = result.by || 'A coach';
  if (result.entryStatus === 'Out') return `:information_source: FYI: ${by} marked you Out. If that's wrong, tell a coach.`;
  const bits = [result.sessionType, result.activity, `${result.pieces} piece${result.pieces === 1 ? '' : 's'}`].filter(Boolean).join(', ');
  return `:information_source: FYI: ${by} logged a workout for you (${bits}). If that's wrong, tell a coach.`;
}
