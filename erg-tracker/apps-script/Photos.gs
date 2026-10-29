/**
 * Erg-screen photo copies (photo plan step 6; David, 2026-10-28). The Netlify
 * function shrinks each photo to about 150 KB and removes location data, then
 * sends it with the save. The copy goes into one Drive folder owned by the
 * account that runs this script (the coaching account). The folder is never
 * shared: the team sees photos only through the site, which asks for one by
 * Entry ID ('photo-get'). The Entries row keeps only the Drive link, in
 * `Photo link`; the site feed says only whether a photo exists.
 *
 * Logbook wins (David, 2026-10-28): when Logbook has the same workout as a
 * photo entry, the Logbook entry is kept and the photo moves onto it.
 */

var PHOTO_GET_ACTION = 'photo-get';
var PHOTO_FOLDER_PROP = 'PHOTO_FOLDER_ID';
var PHOTO_FOLDER_NAME = 'Whitman erg photos (private)';
var PHOTO_MAX_BASE64 = 400000;   // about 300 KB of image; the function aims for 150 KB

/** Drive file id from a Drive link ('.../file/d/<id>/view') or a bare id; '' if there is none. */
function photoFileId_(link) {
  var t = String(link || '').trim();
  var m = t.match(/\/d\/([A-Za-z0-9_-]{10,})/) || t.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(t) ? t : '';
}

/**
 * Pure: is `candidate` the same workout as `mine`? Both { athleteId, date 'YYYY-MM-DD', workS, workM }.
 * Same athlete and day, meters within 1% (at least 20 m) and time within 1.5% (at least 5 s).
 */
function photoSameWorkout_(mine, candidate) {
  if (String(mine.athleteId) !== String(candidate.athleteId) || mine.date !== candidate.date) return false;
  var m = Number(mine.workM), cm = Number(candidate.workM), s = Number(mine.workS), cs = Number(candidate.workS);
  if (!(m > 0) || !(cm > 0) || !(s > 0) || !(cs > 0)) return false;
  return Math.abs(m - cm) <= Math.max(20, 0.01 * m) && Math.abs(s - cs) <= Math.max(5, 0.015 * s);
}

/** Pure: an Entries object -> the shape photoSameWorkout_ compares. */
function photoEntryShape_(e) {
  return { athleteId: e['Athlete ID'], date: isDate_(e.Date) ? dayKey_(e.Date) : String(e.Date || ''), workS: e['Work s'], workM: e['Work m'] };
}

/** Pure: the Logbook entry (not rejected) that is the same workout as `mine`, or null. */
function photoFindLogbookTwin_(mine, entries) {
  var hits = entries.filter(function (e) {
    return String(e.Source) === 'Logbook' && !/reject/i.test(String(e['Review status'])) && photoSameWorkout_(mine, photoEntryShape_(e));
  });
  return hits.length ? hits[0] : null;
}

/** Pure: Slack photo entries (with a photo, not rejected) that are the same workout as `mine`. */
function photoFindSlackTwins_(mine, entries) {
  return entries.filter(function (e) {
    return String(e.Source) === 'Slack' && String(e['Photo link'] || '').trim() && !/reject/i.test(String(e['Review status'])) &&
      photoSameWorkout_(mine, photoEntryShape_(e));
  });
}

function photoFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PHOTO_FOLDER_PROP);
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (err) { /* deleted or no access: make a new one */ }
  }
  var folder = DriveApp.createFolder(PHOTO_FOLDER_NAME);   // private to the account that runs the script
  props.setProperty(PHOTO_FOLDER_PROP, folder.getId());
  return folder;
}

/** Saves a base64 JPEG in the photo folder and returns its Drive link. Throws if it is missing or too big. */
function savePhotoCopy_(base64, entryId) {
  var data = String(base64 || '');
  if (!data) throw new Error('No photo');
  if (data.length > PHOTO_MAX_BASE64) throw new Error('Photo copy is too big');
  var blob = Utilities.newBlob(Utilities.base64Decode(data), 'image/jpeg', entryId + '.jpg');
  return photoFolder_().createFile(blob).getUrl();
}

function setPhotoLink_(found, link) {
  tab_(TABS.ENTRIES).getRange(found.row, HEADERS[TABS.ENTRIES].indexOf('Photo link') + 1).setValue(link);
}

/**
 * For slackSave_: a photo whose workout Logbook already has is not saved as a
 * second entry. The photo goes onto the Logbook entry (when it has none) and the
 * answer says 'merged'. Otherwise returns null and the entry is written as usual.
 */
function photoBeforeWrite_(photoBase64) {
  return function (result) {
    var e = result.entry;
    var twin = photoFindLogbookTwin_(photoEntryShape_(e), readObjects_(TABS.ENTRIES));
    if (!twin) return null;
    var found = findEntryBy_('Entry ID', twin['Entry ID']);
    var out = { status: 'merged', entryId: String(twin['Entry ID']), athlete: String(twin.Athlete), pieces: result.intervals.length, photo: 'none' };
    if (found && photoBase64 && !String(twin['Photo link'] || '').trim()) {
      try { setPhotoLink_(found, savePhotoCopy_(photoBase64, twin['Entry ID'])); out.photo = 'added'; } catch (err) { out.photo = 'failed'; }
    } else if (String(twin['Photo link'] || '').trim()) {
      out.photo = 'kept';
    }
    return out;
  };
}

/**
 * Logbook wins, the other way round: a Logbook entry that is the same workout as
 * a Slack photo entry takes over its photo, and the photo entry is removed.
 * `row` is the Logbook entry about to be written ({entry}). Call under the script lock.
 */
function photoTakeOverFromSlack_(row) {
  var twins = photoFindSlackTwins_(photoEntryShape_(row.entry), readObjects_(TABS.ENTRIES));
  if (!twins.length) return;
  var twin = twins[0];
  row.entry['Photo link'] = String(twin['Photo link']);
  var found = findEntryBy_('Entry ID', twin['Entry ID']);
  if (found) deleteEntry_(found);
  logChange_({ Who: 'logbook', Tab: TABS.ENTRIES, 'Row ID': String(twin['Entry ID']), Note: 'Logbook replaced the Slack photo entry; the photo moved to ' + row.entry['Entry ID'] });
}

/** doPost action 'photo-get': { entryId } -> { status: 'ok', mime, data (base64) } or { status: 'none' }. */
function processPhotoGet_(body) {
  try {
    var found = findEntryBy_('Entry ID', body.entryId);
    if (!found) return { status: 'none' };
    var link = tab_(TABS.ENTRIES).getRange(found.row, HEADERS[TABS.ENTRIES].indexOf('Photo link') + 1).getValue();
    var id = photoFileId_(link);
    if (!id) return { status: 'none' };
    var blob = DriveApp.getFileById(id).getBlob();
    return { status: 'ok', mime: blob.getContentType() || 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()) };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}
