// Does a time and distance make sense together? (David, 2026-11-23: a 2 hour hockey game was typed as 2 minutes, a
// 4.5 km treadmill run as 3:34.) Used by /api/log-mine: an unlikely pair gets one "is that right?" before it is saved.
// Speeds are meters per second. A machine with no distance (stair stepper) is only checked when a distance is typed.
const LIMITS = {
  'Run': [0.7, 7.5], 'Bike': [1.5, 22], 'Swim': [0.12, 2.2], 'Elliptical': [0.7, 8], 'Stair stepper': [0.05, 3]
};
const MAX_S = 6 * 3600;

/** "25:30.0" or "1:02:30.0" -> seconds, or NaN. */
export function clockSeconds(t) {
  const parts = String(t).trim().split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN;
  return parts.reduce((s, p) => s * 60 + Number(p), 0);
}

const say = (s) => {
  const n = Math.round(s), h = Math.floor(n / 3600), m = Math.floor(n % 3600 / 60), r = n % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};

/** '' when the pair is believable, else a plain sentence for the athlete. */
export function plausibleProblem(activity, seconds, meters) {
  const lim = LIMITS[activity];
  if (!lim || !(seconds > 0)) return '';
  if (seconds > MAX_S) return `That is ${say(seconds)} of ${activity.toLowerCase()}. Check the time: it is hours, minutes, then seconds.`;
  if (!(meters > 0)) return '';
  const v = meters / seconds, km = (meters / 1000).toFixed(meters >= 10000 ? 0 : 1);
  if (v > lim[1]) return `That is ${km} km in ${say(seconds)}, which is faster than anyone can go. Check the time (minutes and seconds) and the distance.`;
  if (v < lim[0]) return `That is ${km} km in ${say(seconds)}, which is slower than walking. Check the time and the distance.`;
  return '';
}
