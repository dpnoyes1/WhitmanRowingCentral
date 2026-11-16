// FIT file reader for NK SpeedCoach and CoxBox exports (on-water plan, Step 0; David, 2026-11-13).
// No dependencies and no Node-only calls, so the same file runs in a Netlify function and in the browser.
// readFit(bytes, fileName) -> { unit, unitSource, start, strokes, laps, session, device, sport, warnings, crcOk }
// Every time is in seconds, every distance in meters, every speed in m/s. Clock times are Unix seconds (UTC).

export const FIT_EPOCH = 631065600;        // FIT times count seconds from 1989-12-31 00:00 UTC
export const MAX_SPEED = 8;                // m/s (about 1:02.5/500m): faster than any boat, so a value above it is junk
                                           // (NK's own sample has a first stroke at 254 m/s)

// Base types: [size, reader, invalid value check]
const BASE = {
  0x00: [1, 'u8', (v) => v === 0xff],          // enum
  0x01: [1, 's8', (v) => v === 0x7f],
  0x02: [1, 'u8', (v) => v === 0xff],
  0x03: [2, 's16', (v) => v === 0x7fff],
  0x04: [2, 'u16', (v) => v === 0xffff],
  0x05: [4, 's32', (v) => v === 0x7fffffff],
  0x06: [4, 'u32', (v) => v === 0xffffffff],
  0x07: [1, 'str', () => false],
  0x08: [4, 'f32', (v) => !Number.isFinite(v)],
  0x09: [8, 'f64', (v) => !Number.isFinite(v)],
  0x0a: [1, 'u8', (v) => v === 0],             // uint8z
  0x0b: [2, 'u16', (v) => v === 0],            // uint16z
  0x0c: [4, 'u32', (v) => v === 0],            // uint32z
  0x0d: [1, 'u8', (v) => v === 0xff],          // byte
  0x0e: [8, 's64', (v) => v === 0x7fffffffffffffffn],
  0x0f: [8, 'u64', (v) => v === 0xffffffffffffffffn],
  0x10: [8, 'u64', (v) => v === 0n],
};

// Messages and fields this reader names: global number -> { field number: [name, scale, offset] }
const MESG = {
  0: ['file_id', { 0: ['type'], 1: ['manufacturer'], 2: ['product'], 3: ['serial'], 4: ['time_created'], 8: ['product_name'] }],
  18: ['session', { 253: ['timestamp'], 2: ['start_time'], 5: ['sport'], 6: ['sub_sport'], 7: ['elapsed', 1000], 8: ['timer', 1000],
    9: ['distance', 100], 10: ['strokes'], 14: ['avg_speed', 1000], 16: ['avg_hr'], 18: ['avg_rate'], 26: ['laps'], 124: ['enh_avg_speed', 1000] }],
  19: ['lap', { 253: ['timestamp'], 2: ['start_time'], 7: ['elapsed', 1000], 8: ['timer', 1000], 9: ['distance', 100], 10: ['strokes'],
    13: ['avg_speed', 1000], 15: ['avg_hr'], 17: ['avg_rate'], 24: ['trigger'], 25: ['sport'], 110: ['enh_avg_speed', 1000] }],
  20: ['record', { 253: ['timestamp'], 0: ['lat'], 1: ['lon'], 3: ['hr'], 4: ['rate'], 5: ['distance', 100], 6: ['speed', 1000], 7: ['power'],
    12: ['dps', 100], 18: ['cycles'], 19: ['total_cycles'], 73: ['enh_speed', 1000], 87: ['dps16', 100] }],
  21: ['event', { 253: ['timestamp'], 0: ['event'], 1: ['event_type'] }],
  23: ['device_info', { 253: ['timestamp'], 0: ['device_index'], 2: ['manufacturer'], 3: ['serial'], 4: ['product'], 27: ['product_name'] }],
  12: ['sport', { 0: ['sport'], 1: ['sub_sport'], 3: ['name'] }],
  206: ['field_description', { 0: ['dev_index'], 1: ['field_num'], 2: ['base_type'], 3: ['name'], 6: ['scale'], 7: ['offset'], 8: ['units'] }],
};
const ROWING_SPORT = 15;                   // FIT sport "rowing"

// ---- CRC (FIT's own 16-bit CRC) --------------------------------------------------------------------------------
const CRC_TABLE = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];
export function fitCrc(bytes, start = 0, end = bytes.length, crc = 0) {
  for (let i = start; i < end; i++) {
    const b = bytes[i];
    let t = CRC_TABLE[crc & 0xf]; crc = (crc >> 4) & 0x0fff; crc = crc ^ t ^ CRC_TABLE[b & 0xf];
    t = CRC_TABLE[crc & 0xf]; crc = (crc >> 4) & 0x0fff; crc = crc ^ t ^ CRC_TABLE[(b >> 4) & 0xf];
  }
  return crc;
}

// ---- low-level reading -----------------------------------------------------------------------------------------
function readOne(dv, off, kind, little) {
  switch (kind) {
    case 'u8': return dv.getUint8(off);
    case 's8': return dv.getInt8(off);
    case 'u16': return dv.getUint16(off, little);
    case 's16': return dv.getInt16(off, little);
    case 'u32': return dv.getUint32(off, little);
    case 's32': return dv.getInt32(off, little);
    case 'f32': return dv.getFloat32(off, little);
    case 'f64': return dv.getFloat64(off, little);
    case 'u64': return dv.getBigUint64(off, little);
    case 's64': return dv.getBigInt64(off, little);
    default: return null;
  }
}

function readField(bytes, dv, off, size, baseType, little) {
  const bt = BASE[baseType & 0x1f];
  if (!bt) return null;                                       // unknown type: skip its bytes
  const [w, kind, invalid] = bt;
  if (kind === 'str') {
    let end = off; while (end < off + size && bytes[end] !== 0) end++;
    const s = new TextDecoder().decode(bytes.subarray(off, end)).trim();
    return s || null;
  }
  if (size < w || size % w) return null;
  const vals = [];
  for (let i = 0; i < size; i += w) {
    const v = readOne(dv, off + i, kind, little);
    vals.push(invalid(v) ? null : typeof v === 'bigint' ? Number(v) : v);
  }
  return vals.length === 1 ? vals[0] : vals;
}

/** Every message in the file, in order: [{ num, name, fields: { name or number: value }, dev: { name: value } }]. */
export function readMessages(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const warnings = [];
  if (bytes.length < 12) throw new Error('Not a FIT file (too short)');
  const headerSize = bytes[0];
  const sig = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (sig !== '.FIT' || (headerSize !== 12 && headerSize !== 14)) throw new Error('Not a FIT file');
  const dataSize = dv.getUint32(4, true);
  let end = headerSize + dataSize;
  if (end > bytes.length) { warnings.push('File is cut short; read what is there'); end = bytes.length; }
  const crcOk = end + 2 <= bytes.length ? fitCrc(bytes, 0, end) === dv.getUint16(end, true) : null;
  if (crcOk === false) warnings.push('Checksum does not match; the file may be damaged');

  const defs = {};                    // local type -> definition
  const devDesc = {};                 // "devIndex:fieldNum" -> { name, baseType, scale, offset }
  const out = [];
  let lastTs = null;
  let p = headerSize;
  try {
    while (p < end) {
      const h = bytes[p++];
      let local, compressedOffset = null;
      if (h & 0x80) { local = (h >> 5) & 0x3; compressedOffset = h & 0x1f; }
      else if (h & 0x40) {                                    // definition message
        local = h & 0x0f;
        const little = bytes[p + 1] === 0;
        const num = little ? dv.getUint16(p + 2, true) : dv.getUint16(p + 2, false);
        const n = bytes[p + 4];
        p += 5;
        const fields = [];
        for (let i = 0; i < n; i++, p += 3) fields.push([bytes[p], bytes[p + 1], bytes[p + 2]]);
        const devFields = [];
        if (h & 0x20) { const nd = bytes[p++]; for (let i = 0; i < nd; i++, p += 3) devFields.push([bytes[p], bytes[p + 1], bytes[p + 2]]); }
        defs[local] = { num, little, fields, devFields };
        continue;
      } else local = h & 0x0f;

      const def = defs[local];
      if (!def) throw new Error('Data before its definition at byte ' + (p - 1));
      const [name, known] = MESG[def.num] || [String(def.num), {}];
      const fields = {}, dev = {};
      for (const [fnum, size, bt] of def.fields) {
        const v = readField(bytes, dv, p, size, bt, def.little);
        p += size;
        const k = known[fnum];
        if (!k) { if (v !== null) fields[fnum] = v; continue; }
        const [fname, scale = 1, offset = 0] = k;
        fields[fname] = v === null ? null : Array.isArray(v) ? v.map((x) => (x === null ? null : x / scale - offset)) : typeof v === 'number' ? v / scale - offset : v;
      }
      for (const [fnum, size, devIndex] of def.devFields) {
        const d = devDesc[devIndex + ':' + fnum];
        if (d) {
          const v = readField(bytes, dv, p, size, d.baseType, def.little);
          dev[d.name] = typeof v === 'number' && d.scale ? v / d.scale - (d.offset || 0) : v;
        }
        p += size;
      }
      if (fields.timestamp != null) lastTs = fields.timestamp;
      else if (compressedOffset !== null && lastTs !== null) {
        lastTs = lastTs + ((compressedOffset - (lastTs & 0x1f)) & 0x1f);
        fields.timestamp = lastTs;
      }
      if (def.num === 206 && fields.dev_index != null && fields.field_num != null) {
        devDesc[fields.dev_index + ':' + fields.field_num] = { name: fields.name || 'dev' + fields.field_num, baseType: fields.base_type, scale: fields.scale, offset: fields.offset };
      }
      out.push({ num: def.num, name, fields, dev });
    }
  } catch (e) {
    if (e instanceof RangeError) warnings.push('File ends in the middle of a message; read what was before it');
    else throw e;
  }
  return { messages: out, warnings, crcOk };
}

// ---- the rowing view of a file ---------------------------------------------------------------------------------
const unix = (t) => (t == null ? null : t + FIT_EPOCH);

/** Unit number from a file name such as "CoxBox_011009863_2026-10-18.fit" or "SpeedCoach-3121111.fit": the first run of 5+ digits
 *  after the device word, else the first run of 6+ digits that is not a date. */
export function unitFromName(fileName) {
  if (!fileName) return null;
  const base = String(fileName).split(/[\\/]/).pop();
  const m = base.match(/(?:coxbox|speedcoach|speed\s*coach|sc|nk)[\s_-]*(?:gps[\s_-]*2?[\s_-]*)?(\d{5,})/i);
  if (m) return m[1];
  const isDate = (r) => r.length === 8 && /^(19|20)\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(r);   // 20261018
  const runs = (base.replace(/\d{4}-\d{2}-\d{2}|\d{8}T\d{4,6}/g, ' ').match(/\d{6,}/g) || []).filter((r) => !isDate(r));
  return runs[0] || null;
}

/** Reads a SpeedCoach or CoxBox FIT export. Strokes with impossible speed keep their row but lose the speed (null). */
export function readFit(input, fileName = '') {
  const { messages, warnings, crcOk } = readMessages(input);
  const by = (n) => messages.filter((m) => m.name === n).map((m) => m.fields);
  const fileId = by('file_id')[0] || {};
  const dev = by('device_info').find((d) => d.serial) || {};
  const sess = by('session')[0] || null;

  let unit = fileId.serial || dev.serial || null, unitSource = unit ? 'file' : null;
  if (unit) unit = String(unit);
  else { unit = unitFromName(fileName); unitSource = unit ? 'name' : null; }
  if (!unit) warnings.push('No unit number in the file or its name');

  const strokes = [];
  let junk = 0;
  for (const m of messages) {
    if (m.name !== 'record') continue;
    const f = m.fields;
    if (f.timestamp == null) continue;
    let speed = f.enh_speed ?? f.speed ?? null;
    if (speed !== null && (speed < 0 || speed > MAX_SPEED)) { speed = null; junk++; }
    const dps = f.dps16 ?? f.dps ?? m.dev.distance_per_stroke ?? m.dev.DistancePerStroke ?? null;
    strokes.push({
      t: unix(f.timestamp),
      dist: f.distance ?? null,
      speed,
      rate: f.rate ?? null,
      hr: f.hr ?? null,
      dps,
      count: f.total_cycles ?? null,
      lat: f.lat == null ? null : f.lat * (180 / 2 ** 31),
      lon: f.lon == null ? null : f.lon * (180 / 2 ** 31),
    });
  }
  if (junk) warnings.push(junk + ' stroke' + (junk === 1 ? '' : 's') + ' had an impossible speed; that speed was dropped');
  strokes.sort((a, b) => a.t - b.t);

  const laps = by('lap').map((l) => ({
    start: unix(l.start_time),
    end: unix(l.timestamp),
    elapsedS: l.elapsed ?? null,
    timerS: l.timer ?? null,
    meters: l.distance ?? null,
    strokes: l.strokes ?? null,
    avgSpeed: l.enh_avg_speed ?? l.avg_speed ?? null,
    avgRate: l.avg_rate ?? null,
  })).filter((l) => l.start != null).sort((a, b) => a.start - b.start);

  const session = sess && {
    start: unix(sess.start_time),
    end: unix(sess.timestamp),
    elapsedS: sess.elapsed ?? null,
    timerS: sess.timer ?? null,
    meters: sess.distance ?? null,
    strokes: sess.strokes ?? null,
    avgSpeed: sess.enh_avg_speed ?? sess.avg_speed ?? null,
    avgRate: sess.avg_rate ?? null,
    sport: sess.sport ?? null,
  };
  const start = (session && session.start) || (laps[0] && laps[0].start) || (strokes[0] && strokes[0].t) || unix(fileId.time_created);
  const sport = (session && session.sport) ?? (by('sport')[0] || {}).sport ?? null;
  if (!strokes.length) warnings.push('No strokes in the file');

  return {
    unit, unitSource, fileName: fileName ? String(fileName).split(/[\\/]/).pop() : '',
    start, strokes, laps, session,
    device: { manufacturer: fileId.manufacturer ?? null, product: fileId.product ?? null, name: fileId.product_name || dev.product_name || null },
    sport, rowing: sport === null || sport === ROWING_SPORT,
    warnings, crcOk,
  };
}
