/**
 * Time helpers. Every time in the Sheet is stored as a number of seconds
 * (2:13.5 -> 133.5). m:ss.0 text only exists on the way in (form) and on the
 * way out (display). Never store formatted time text in a data tab.
 */

/** Regex used by the Google Form to validate m:ss.0 input. */
var TIME_PATTERN = '^\\s*\\d{1,3}:[0-5]\\d(\\.\\d)?\\s*$';

/**
 * Parses "m:ss.0", "m:ss", "h:mm:ss.0" or a plain number of seconds.
 * Returns seconds rounded to tenths, or null for blank input.
 * Throws on anything else so bad data is never silently stored.
 */
function parseTime(text) {
  if (text === null || text === undefined) return null;
  if (typeof text === 'number') return roundTenths_(text);
  var s = String(text).trim();
  if (s === '') return null;
  if (/^\d+(\.\d+)?$/.test(s)) return roundTenths_(Number(s));

  var parts = s.split(':');
  if (parts.length < 2 || parts.length > 3) throw new Error('Not a time: "' + text + '"');
  var secs = parts.pop();
  if (!/^[0-5]?\d(\.\d+)?$/.test(secs)) throw new Error('Bad seconds in "' + text + '"');
  var mins = parts.pop();
  if (!/^\d+$/.test(mins)) throw new Error('Bad minutes in "' + text + '"');
  var hours = parts.length ? parts.pop() : '0';
  if (!/^\d+$/.test(hours)) throw new Error('Bad hours in "' + text + '"');
  if (parts.length === 0 && hours !== '0' && Number(mins) > 59) {
    throw new Error('Minutes over 59 with hours in "' + text + '"');
  }
  return roundTenths_(Number(hours) * 3600 + Number(mins) * 60 + Number(secs));
}

/** Formats seconds as m:ss.0 (minutes are not rolled into hours: 75:00.0). */
function formatTime(seconds) {
  if (seconds === null || seconds === undefined || seconds === '') return '';
  var tenths = Math.round(Number(seconds) * 10);
  var sign = tenths < 0 ? '-' : '';
  tenths = Math.abs(tenths);
  var m = Math.floor(tenths / 600);
  var rem = tenths - m * 600;
  var ss = Math.floor(rem / 10);
  var t = rem % 10;
  return sign + m + ':' + (ss < 10 ? '0' : '') + ss + '.' + t;
}

/** Split per 500m in seconds for a piece of `meters` done in `seconds`. */
function splitPer500(seconds, meters) {
  if (!seconds || !meters) return null;
  return roundTenths_(seconds * 500 / meters);
}

function roundTenths_(n) {
  return Math.round(n * 10) / 10;
}

/** Custom Sheet function: =M_SS(B2) shows seconds as m:ss.0 for browsing. */
function M_SS(seconds) {
  if (Array.isArray(seconds)) return seconds.map(function (row) { return row.map(formatTime); });
  return formatTime(seconds);
}
