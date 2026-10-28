// Reads a photo of a Concept2 monitor with the Claude API (step 1 of the photo plan,
// plans/erg-photo-build-plan.md). Pure code: no network or SDK import here. The caller
// passes an Anthropic client, so tests use a fake and the live function builds
// `new Anthropic()` with ANTHROPIC_API_KEY from Netlify env vars.
//
// Times leave this file as seconds (CLAUDE.md rule 1). The model returns text exactly
// as shown on the screen and the code parses it.

export const MODELS = { primary: 'claude-haiku-5-5', retry: 'claude-sonnet-5-5' };
export const MAX_OUTPUT_TOKENS = 4000;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const PROMPT = `You read a photo of a Concept2 PM3, PM4 or PM5 monitor (a rowing or BikeErg result screen) and return what is printed on it.

Rules:
- Copy numbers exactly as shown, as text. Do not round, convert or fix them.
- "total" is the summary row above the line, with the WORKING time (rest is never in it) and the total work meters. On an interval screen the header "Total Time" includes rest: never use it for "total". Heart rate, stroke rate on the big live display and the large live pace are a single instant: ignore them.
- "split_label" is the unit printed next to the split column: "/500m" or "/1000m". If you cannot see it, use "".
- "pieces" are the rows of the detail list under the line, in order: one per split for a single piece, one per interval for an interval workout. Never include the summary row above the line (it is the sum of the rows beneath it) as a piece. Include only rows you can see. Never invent rows.
- The meters column on a single-piece detail screen is often a running total (500, 1000, 1500, 2000). Set "meters_column" to "cumulative" when each row is larger than the one before it and ends at the total, "per_piece" when each row is that piece's own distance, and "none" if there is no meters column. Report the numbers as shown either way.
- A time can lose its leading digits on screen (":56.7"). Copy what you see.
- "total_time_incl_rest" is the header "Total Time" only when it differs from the totals row (interval workouts); otherwise "".
- "rest_meters" is the number after "r" at the bottom of an interval screen (for example r741), or null.
- "date" is the date printed on the screen exactly as shown, or "".
- "flags" are short notes (at most 8 words each, at most 5 of them) for anything unclear, cut off, or hidden by glare or an angle. Use [] if the screen is clear.
- If a field is not visible, use "" (text) or null (number). If this is not a Concept2 monitor, return empty fields and a flag.`;

const str = { type: 'string' };
const num = { type: ['integer', 'null'] };
const PIECE = {
  type: 'object',
  additionalProperties: false,
  required: ['time', 'meters', 'split', 'rate'],
  properties: { time: str, meters: num, split: str, rate: num },
};

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'date', 'split_label', 'total', 'total_time_incl_rest', 'rest_meters', 'meters_column', 'pieces', 'flags'],
  properties: {
    title: str,
    date: str,
    split_label: str,
    total: {
      type: 'object',
      additionalProperties: false,
      required: ['time', 'meters', 'avg_split', 'avg_rate'],
      properties: { time: str, meters: num, avg_split: str, avg_rate: num },
    },
    total_time_incl_rest: str,
    rest_meters: num,
    meters_column: { type: 'string', enum: ['per_piece', 'cumulative', 'none'] },
    pieces: { type: 'array', items: PIECE },
    flags: { type: 'array', items: str },
  },
};

// ---- numbers --------------------------------------------------------------

/** "2:19.6", "1:02:03.4", ":56.7", "56.7" -> seconds rounded to tenths; null if not a time. */
export function parseClock(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (!/^(\d{0,2}:){0,2}\d{0,2}(\.\d+)?$/.test(t) || !/\d/.test(t)) return null;
  let s = 0;
  for (const part of t.split(':')) s = s * 60 + (part === '' ? 0 : Number(part));
  return Math.round(s * 10) / 10;
}

const tenths = (n) => Math.round(n * 10) / 10;

/** Which machine the screen is from, by the split label (David, 2026-10-25). */
export function machineFromSplitLabel(label) {
  const t = String(label || '').replace(/\s/g, '').toLowerCase();
  if (t === '/500m' || t === '500m') return 'RowErg';
  if (t === '/1000m' || t === '1000m') return 'BikeErg';
  return null;
}

/** Turn a running total (500, 1000, 1500) into per-piece distances. Null when it is not a clean running total. */
export function decumulate(meters, total) {
  if (meters.some((m) => m == null)) return null;
  for (let i = 1; i < meters.length; i++) if (meters[i] <= meters[i - 1]) return null;
  if (total != null && meters[meters.length - 1] !== total) return null;
  return meters.map((m, i) => m - (i ? meters[i - 1] : 0));
}

// ---- reading the model's answer --------------------------------------------

/**
 * Model JSON -> a read in seconds and meters. Never throws on odd content: anything it
 * cannot use becomes null and the checks (ergchecks.mjs) decide what to ask.
 */
export function normalizeRead(raw) {
  const total = raw.total || {};
  const label = machineFromSplitLabel(raw.split_label);
  const flags = (Array.isArray(raw.flags) ? raw.flags : []).filter((f) => typeof f === 'string' && f).slice(0, 5);
  let pieces = (Array.isArray(raw.pieces) ? raw.pieces : []).map((p) => ({
    timeS: parseClock(p.time),
    meters: Number.isFinite(p.meters) ? p.meters : null,
    splitS: parseClock(p.split),
    rate: Number.isFinite(p.rate) ? p.rate : null,
  }));
  const totalMeters = Number.isFinite(total.meters) ? total.meters : null;
  let metersAs = raw.meters_column || 'none';
  if (metersAs === 'cumulative' && pieces.length) {
    const per = decumulate(pieces.map((p) => p.meters), totalMeters);
    if (per) pieces = pieces.map((p, i) => ({ ...p, meters: per[i] }));
    else { flags.push('meters column not a clean running total'); metersAs = 'unclear'; }
  }
  return {
    title: String(raw.title || '').trim(),
    date: String(raw.date || '').trim(),
    machine: label,
    totalTimeS: parseClock(total.time),
    totalMeters,
    avgSplitS: parseClock(total.avg_split),
    avgRate: Number.isFinite(total.avg_rate) ? total.avg_rate : null,
    totalTimeInclRestS: parseClock(raw.total_time_incl_rest),
    restMeters: Number.isFinite(raw.rest_meters) ? raw.rest_meters : null,
    metersColumn: metersAs,
    pieces,
    flags,
    calculated: [],
  };
}

// ---- image prep ------------------------------------------------------------

/**
 * Remove location and camera metadata before the image leaves our function (privacy
 * plan). JPEG: drops APP1-APP15 (EXIF, XMP, GPS) and comment segments. PNG: drops
 * eXIf and text chunks. Pixels are untouched. Resizing is a later step.
 */
export function stripImageMetadata(bytes) {
  const b = Buffer.from(bytes);
  if (b[0] === 0xff && b[1] === 0xd8) return stripJpeg(b);
  if (b.length > 8 && b.readUInt32BE(0) === 0x89504e47) return stripPng(b);
  throw new Error('Photo must be a JPEG or PNG');
}

function stripJpeg(b) {
  const out = [b.subarray(0, 2)];
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) throw new Error('Damaged JPEG');
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xda) { out.push(b.subarray(i)); return Buffer.concat(out); } // image data to the end
    if (marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { out.push(b.subarray(i, i + 2)); i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) throw new Error('Damaged JPEG');
    const drop = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!drop) out.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  throw new Error('Damaged JPEG');
}

function stripPng(b) {
  const drop = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt']);
  const out = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i);
    const type = b.toString('latin1', i + 4, i + 8);
    const end = i + 12 + len;
    if (end > b.length) throw new Error('Damaged PNG');
    if (!drop.has(type)) out.push(b.subarray(i, end));
    i = end;
  }
  return Buffer.concat(out);
}

// ---- the call ---------------------------------------------------------------

/**
 * Read one photo. `client` is an Anthropic client (needs `messages.create`).
 * Returns { ok: true, read, usage, model } or { ok: false, reason, message } where reason is
 * 'too_large' | 'bad_image' | 'refused' | 'truncated' | 'bad_reply' | 'api_error'.
 * The caller retries once on MODELS.retry when the checks reject a read.
 */
export async function readErgScreen({ client, bytes, model = MODELS.primary }) {
  let image;
  try {
    image = stripImageMetadata(bytes);
  } catch (err) {
    return { ok: false, reason: 'bad_image', message: err.message };
  }
  if (image.length > MAX_IMAGE_BYTES) return { ok: false, reason: 'too_large', message: 'Photo is over 5 MB' };
  const mediaType = image[0] === 0xff ? 'image/jpeg' : 'image/png';

  let res;
  try {
    res = await client.messages.create({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image.toString('base64') } },
          { type: 'text', text: PROMPT },
        ],
      }],
    });
  } catch (err) {
    return { ok: false, reason: 'api_error', message: err.message || 'API error' };
  }

  const usage = res.usage ? { input: res.usage.input_tokens, output: res.usage.output_tokens } : null;
  if (res.stop_reason === 'refusal') return { ok: false, reason: 'refused', message: 'Model declined this image', usage };
  if (res.stop_reason === 'max_tokens') return { ok: false, reason: 'truncated', message: 'Reply was cut off', usage };
  const text = (res.content || []).find((c) => c.type === 'text');
  let raw;
  try {
    raw = JSON.parse(text ? text.text : '');
  } catch {
    return { ok: false, reason: 'bad_reply', message: 'Reply was not valid JSON', usage };
  }
  if (!raw || typeof raw !== 'object' || !raw.total || !Array.isArray(raw.pieces)) {
    return { ok: false, reason: 'bad_reply', message: 'Reply did not match the schema', usage };
  }
  return { ok: true, read: normalizeRead(raw), usage, model };
}
