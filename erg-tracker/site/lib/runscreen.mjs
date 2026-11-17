// Reads a photo or screenshot of a run result (Garmin, Apple Watch, Strava, MapMyRun, COROS, a treadmill and so on)
// and says whether it roughly agrees with what the athlete typed on Log activity (David, 2026-11-17).
// NOT LIVE: nothing imports this file yet, and RUN_PHOTO_CHECK stays false until David says go.
// Plan: plans/run-photo-check-plan-2026-11-17.md. Pure code like ergscreen.mjs: the caller passes an Anthropic client.
import { parseClock, stripImageMetadata, MODELS, MAX_OUTPUT_TOKENS, MAX_IMAGE_BYTES } from './ergscreen.mjs';

export const RUN_PHOTO_CHECK = false;
const MILE = 1609.344;

export const RUN_PROMPT = `You read a photo or screenshot of a finished run (a running watch, a phone app such as Garmin Connect, Apple Fitness or Workout, Strava, MapMyRun, COROS, Nike Run Club, or a treadmill display) and return what is printed on it.

Rules:
- Copy numbers exactly as shown, as text, with their unit words. Do not round, convert or fix them.
- "distance" is the total distance of the run. Put the number in "distance" and the unit printed next to it in "distance_unit": "mi", "km", "m" or "" if none is shown. A bare number on a US screen is usually miles, but only say so if the unit is printed.
- Garmin Connect (phone app) overview: a big distance number with its unit (mi, km or m) under or beside the word "Distance"; then Avg Heart Rate and Avg Pace (unit printed after the number: "12:12 /mi"); then Total Time and Total Calories. An older layout has three circles (Time, Distance with "(mi)" in its label, Calories) and a row "Pace (min/mi)" where the unit is only in the label. The phone Home screen card "Today's Activity" shows no labels: "6.22 mi", then "55:15 • 8:53 /mi" meaning time then pace. In meters, a decimal comma can appear ("800,00 m" is 800 meters).
- Apple Fitness (phone) workout summary: Distance in capitals ("11.38KM", "4.00MI"; a decimal comma is possible: "3,22KM"), Total Time or Workout Time as H:MM:SS with a leading zero hour ("0:41:39"), sometimes Elapsed Time beside Workout Time (Workout Time is the moving time), and Avg. Pace written 6'32"/KM or 10'24''/MI. "Elevation Gain 81M" is meters of climb, never the distance. Apple Watch Summary screen: "TOTAL TIME 0:53:06" and "TOTAL DISTANCE 5.26MI". A live Apple Watch workout screen has no labels for time and distance: the big yellow clock (41:57.00) is the time, the number ending in MI or KM is the distance, "AVERAGE PACE" is the pace, and "ROLLING MILE" is a live pace to ignore; add the flag "live screen, not finished". The Splits table lists one row per mile or km with a short last row (for example 00:06): never use it as the total.
- Strava (phone feed card or activity): a headline row "Distance 2.02 mi, Pace 10:24 /mi, Time 21m 2s". Time is spelled out as "21m 2s", "7m 42s" or, over an hour, "2h 6m" (no seconds): copy it exactly as shown. Some cards replace Pace with "Elev Gain 1,972 ft" (feet of climb, never the distance) and add Achievements. Strava's time is Moving Time. Above the numbers are the name of the person who posted it and the device ("Garmin fēnix 7"): put the person's name in "person" exactly as shown, or "" if no name is shown. A feed screenshot can show several activities (and weight training, walks, rides): read only the top or most complete run and add a flag.
- The activity title and notes (for example "3.25mi Easy Run" or "W7 Mon") are a plan or a name, not a result. Never take a distance or time from the title or the description text under it. The map, temperature, calories, heart rate and elevation are not the distance or time.
- "moving_time" is the time labeled Total Time, Moving Time, Workout Time, Time, Duration, Active Time or Timer. "elapsed_time" is the time labeled Elapsed Time or Total Time, only when the screen shows both. If only one time is shown, put it in "moving_time" and use "" for the other. Times look like 54:32, 1:02:15 or 0:25:30. Copy them as shown.
- "avg_pace" is the average pace for the whole run, labeled Avg Pace, Pace or Avg. Pace, as shown (for example 8:30, 8'30" or 5:12). "pace_unit" is "/mi", "/km" or "" if not shown (a label such as "Pace (min/mi)" means "/mi"). Ignore current or live pace, best pace, and any single lap or split.
- Splits, laps, graphs and heart-rate zones are not the total: never use a lap or split row as the total.
- "activity" is the sport as shown, for example "Run", "Treadmill", "Walk", "Ride", "Swim". If it is not clearly a run, still report it so the check can say so.
- "date" is the date printed on the screen exactly as shown, or "". "app" is the app or device name if you can tell, else "".
- If the image shows a list of several activities, or several runs, read only the one at the top and add a flag.
- "flags" are short notes (at most 8 words each, at most 5) for anything unclear, cut off, or hidden by glare. Use [] if clear.
- If a field is not visible, use "". If this is not a result screen at all, return empty fields and a flag.`;

const str = { type: 'string' };
export const RUN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['app', 'person', 'activity', 'date', 'distance', 'distance_unit', 'moving_time', 'elapsed_time', 'avg_pace', 'pace_unit', 'flags'],
  properties: {
    app: str, person: str, activity: str, date: str, distance: str, distance_unit: { type: 'string', enum: ['mi', 'km', 'm', ''] },
    moving_time: str, elapsed_time: str, avg_pace: str, pace_unit: { type: 'string', enum: ['/mi', '/km', ''] },
    flags: { type: 'array', items: str },
  },
};

/** "3.1", "5,2", "5000" + unit -> meters, or null. Without a unit, 100+ is read as meters and smaller numbers stay unknown. */
export function distanceMeters(text, unit) {
  // "800,00" and "5,18" are decimals; "1,609" (comma then exactly three digits, no other comma) is a thousands mark.
  const raw = String(text || '').trim();
  const t = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw) ? raw.replace(/,/g, '') : raw.replace(',', '.');
  const n = Number(t.replace(/[^\d.]/g, ''));
  if (!(n > 0)) return { meters: null, assumed: false };
  if (unit === 'mi') return { meters: Math.round(n * MILE), assumed: false };
  if (unit === 'km') return { meters: Math.round(n * 1000), assumed: false };
  if (unit === 'm') return { meters: Math.round(n), assumed: false };
  return { meters: null, assumed: false, bare: n };
}

/** Strava spells times out: "21m 2s", "2h 6m", "10m 0s" -> seconds, or null. (Over an hour it shows no seconds, so it is good to about a minute.) */
export function parseSpelledTime(text) {
  const m = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$/i.exec(String(text || '').trim());
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + +(m[3] || 0);
}
const anyTime = (t) => parseClock(t) ?? parseSpelledTime(t);

/** Pace as shown (8:30, 8'30", 5:12) -> seconds, or null. */
export function parsePace(text) {
  const m = /^(\d{1,2})\s*(?::|'|’)\s*([0-5]\d)/.exec(String(text || '').trim());
  return m ? +m[1] * 60 + +m[2] : null;
}

/** Model JSON -> seconds and meters. Never throws on odd content. */
export function normalizeRunRead(raw) {
  const flags = (Array.isArray(raw.flags) ? raw.flags : []).filter((f) => typeof f === 'string' && f).slice(0, 5);
  const d = distanceMeters(raw.distance, raw.distance_unit);
  const paceS = parsePace(raw.avg_pace);
  const per = raw.pace_unit === '/mi' ? MILE : raw.pace_unit === '/km' ? 1000 : null;
  return {
    app: String(raw.app || '').trim(),
    activity: String(raw.activity || '').trim(),
    date: String(raw.date || '').trim(),
    meters: d.meters,
    unit: raw.distance_unit || '',
    bareDistance: d.bare ?? null,
    movingS: anyTime(raw.moving_time),
    elapsedS: anyTime(raw.elapsed_time),
    person: String(raw.person || '').trim(),
    paceS,
    paceMeters: per,
    flags,
  };
}

const pct = (a, b) => Math.abs(a - b) / b;

/**
 * Does the photo roughly agree with what the athlete typed? typed = { meters, timeS, name? } (name is optional: when given and the screenshot shows a different person, the result drops to close).
 * verdict: 'match' (within tolerance), 'close' (within 10%, coaches need not act), 'mismatch',
 * or 'unreadable' (the photo gave too little to judge). Distance allows 5% for GPS drift; time is
 * judged against the moving OR the elapsed time, whichever is closer, at max(3%, 15 s).
 * A screen distance with no unit is tried as miles and as kilometers.
 */
export function compareRun(read, typed) {
  const notes = [];
  const times = [read.movingS, read.elapsedS].filter((t) => t > 0);
  let meters = read.meters;
  if (meters == null && read.bareDistance) {
    const options = [read.bareDistance * MILE, read.bareDistance * 1000].filter((m) => typed.meters > 0);
    meters = options.sort((a, b) => pct(a, typed.meters) - pct(b, typed.meters))[0] ?? null;
    if (meters != null) notes.push('Unit not shown on the screen; read as the closer of miles and km.');
  }
  if (meters == null && !times.length) return { verdict: 'unreadable', notes: ['The photo did not show a distance or time.'] };
  if (/walk|ride|bike|cycl|swim|row/i.test(read.activity) && !/run/i.test(read.activity)) notes.push(`The photo says ${read.activity}, not a run.`);

  if (typed.name && read.person) {
    const last = (n) => String(n).trim().toLowerCase().split(/\s+/).pop();
    if (last(typed.name) !== last(read.person)) notes.push('The name on the screenshot does not match the athlete.');
  }
  const dErr = meters != null && typed.meters > 0 ? pct(meters, typed.meters) : null;
  const tErr = times.length && typed.timeS > 0 ? Math.min(...times.map((t) => Math.abs(t - typed.timeS) / Math.max(typed.timeS * 0.03, 15))) : null; // 1 = at the limit
  if (read.paceS && read.paceMeters && typed.meters > 0 && typed.timeS > 0) {
    // The average pace is over the moving time; if the athlete typed the (longer) elapsed time, scale the pace the same way.
    const near = times.length ? times.reduce((a, b) => (Math.abs(b - typed.timeS) < Math.abs(a - typed.timeS) ? b : a)) : null;
    const scale = near && read.movingS > 0 ? near / read.movingS : 1;
    const typedPace = typed.timeS / typed.meters * read.paceMeters;
    if (pct(read.paceS * scale, typedPace) > 0.10) notes.push('Average pace on the photo differs from the typed distance and time.');
  }
  if (dErr == null && tErr == null) return { verdict: 'unreadable', notes: ['Nothing on the photo could be compared.'] };
  const dOk = dErr == null || dErr <= 0.05, tOk = tErr == null || tErr <= 1;
  const dClose = dErr == null || dErr <= 0.10, tClose = tErr == null || tErr <= 3.33;
  let verdict = dOk && tOk ? 'match' : dClose && tClose ? 'close' : 'mismatch';
  if (verdict === 'match' && notes.some((n) => /not a run|pace|name/.test(n))) verdict = 'close';
  return { verdict, notes, photoMeters: meters, photoTimeS: times[0] ?? null, distanceOffPct: dErr == null ? null : Math.round(dErr * 1000) / 10 };
}

/** One call to the reader. Same return shape as readErgScreen: { ok, read, usage, model } or { ok: false, reason, message }. */
export async function readRunScreen({ client, bytes, model = MODELS.primary }) {
  let image;
  try { image = stripImageMetadata(bytes); } catch (err) { return { ok: false, reason: 'bad_image', message: err.message }; }
  if (image.length > MAX_IMAGE_BYTES) return { ok: false, reason: 'too_large', message: 'Photo is over 5 MB' };
  let res;
  try {
    res = await client.messages.create({
      model, max_tokens: MAX_OUTPUT_TOKENS,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: RUN_SCHEMA } },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: image[0] === 0xff ? 'image/jpeg' : 'image/png', data: image.toString('base64') } },
        { type: 'text', text: RUN_PROMPT },
      ] }],
    });
  } catch (err) { return { ok: false, reason: 'api_error', message: err.message || 'API error' }; }
  const usage = res.usage ? { input: res.usage.input_tokens, output: res.usage.output_tokens } : null;
  if (res.stop_reason === 'refusal') return { ok: false, reason: 'refused', message: 'Model declined this image', usage };
  if (res.stop_reason === 'max_tokens') return { ok: false, reason: 'truncated', message: 'Reply was cut off', usage };
  let raw;
  try { raw = JSON.parse((res.content || []).find((c) => c.type === 'text')?.text || ''); } catch { return { ok: false, reason: 'bad_reply', message: 'Reply was not valid JSON', usage }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'bad_reply', message: 'Reply did not match the schema', usage };
  return { ok: true, read: normalizeRunRead(raw), usage, model };
}
