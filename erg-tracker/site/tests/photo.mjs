// Tests for the erg screen reader and checks (lib/ergscreen.mjs, lib/ergchecks.mjs).
// All data here is made up. No photos, no network: the model is a fake client.
import assert from 'node:assert';
import * as R from '../lib/ergscreen.mjs';
import * as C from '../lib/ergchecks.mjs';

const TODAY = '2026-10-28';

// A model answer in the shape SCHEMA asks for. Override any part.
const piece = (time, meters, split, rate = 24) => ({ time, meters, split, rate });
const answer = (over = {}) => ({
  title: '2000m',
  date: '',
  split_label: '/500m',
  total: { time: '8:00.0', meters: 2000, avg_split: '2:00.0', avg_rate: 24 },
  total_time_incl_rest: '',
  rest_meters: null,
  meters_column: 'cumulative',
  pieces: [piece('2:00.0', 500, '2:00.0'), piece('2:00.0', 1000, '2:00.0'), piece('2:00.0', 1500, '2:00.0'), piece('2:00.0', 2000, '2:00.0')],
  flags: [],
  ...over,
});
const read = (over) => R.normalizeRead(answer(over));
const codes = (res) => res.issues.map((i) => i.code);

// A tiny JPEG: SOI, EXIF (APP1) with a GPS marker, APP0, a comment, a fake frame, scan data, EOI.
const seg = (marker, body) => Buffer.concat([Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff]), Buffer.from(body)]);
const fakeJpeg = () => Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  seg(0xe0, 'JFIF\0abc'),
  seg(0xe1, 'Exif\0\0GPSLatitude=44.0'),
  seg(0xfe, 'taken by a phone'),
  seg(0xc0, 'frame-data'),
  Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0xff, 0xd9]),
]);

const fakeClient = (reply) => {
  const calls = [];
  return { calls, messages: { create: async (req) => { calls.push(req); if (reply instanceof Error) throw reply; return reply; } } };
};
const okReply = (obj, extra = {}) => ({
  stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 2668, output_tokens: 900 }, ...extra,
});

export default function photoTests(test) {
  test('photo: clock parsing', () => {
    assert.strictEqual(R.parseClock('2:19.6'), 139.6);
    assert.strictEqual(R.parseClock('1:02:03.4'), 3723.4);
    assert.strictEqual(R.parseClock(':56.7'), 56.7);
    assert.strictEqual(R.parseClock('56.7'), 56.7);
    assert.strictEqual(R.parseClock('20:00'), 1200);
    assert.strictEqual(R.parseClock(''), null);
    assert.strictEqual(R.parseClock('abc'), null);
    assert.strictEqual(R.parseClock(null), null);
  });

  test('photo: machine comes from the split label', () => {
    assert.strictEqual(R.machineFromSplitLabel('/500m'), 'RowErg');
    assert.strictEqual(R.machineFromSplitLabel(' /1000m '), 'BikeErg');
    assert.strictEqual(R.machineFromSplitLabel(''), null);
    assert.strictEqual(R.machineFromSplitLabel('/250m'), null);
  });

  test('photo: running meters become per-piece meters', () => {
    assert.deepStrictEqual(R.decumulate([500, 1000, 1500, 2000], 2000), [500, 500, 500, 500]);
    assert.deepStrictEqual(R.decumulate([250, 500, 750, 1000, 1250, 1500], 1500), [250, 250, 250, 250, 250, 250]);
    assert.strictEqual(R.decumulate([500, 400, 1500], 1500), null, 'not rising');
    assert.strictEqual(R.decumulate([500, 1000], 2000), null, 'does not end at the total');
    const r = read();
    assert.deepStrictEqual(r.pieces.map((p) => p.meters), [500, 500, 500, 500]);
    assert.strictEqual(r.machine, 'RowErg');
    assert.strictEqual(r.totalTimeS, 480);
    // per_piece columns are left alone
    const per = read({ meters_column: 'per_piece', pieces: [piece('2:00.0', 500, '2:00.0'), piece('2:00.0', 500, '2:00.0')] });
    assert.deepStrictEqual(per.pieces.map((p) => p.meters), [500, 500]);
    // a running total that does not add up is flagged, not guessed
    const bad = read({ pieces: [piece('2:00.0', 500, '2:00.0'), piece('2:00.0', 900, '2:00.0')] });
    assert.strictEqual(bad.metersColumn, 'unclear');
    assert.ok(bad.flags.some((f) => /running total/.test(f)));
  });

  test('photo: normalizing tolerates missing and odd fields', () => {
    const r = R.normalizeRead({ title: ' 2000m ', total: { time: '', meters: null, avg_split: 'x', avg_rate: null }, pieces: [{ time: '??', meters: 'a', split: '', rate: null }], flags: ['a', '', 7, 'b'] });
    assert.strictEqual(r.totalTimeS, null);
    assert.strictEqual(r.totalMeters, null);
    assert.strictEqual(r.avgSplitS, null);
    assert.strictEqual(r.pieces[0].timeS, null);
    assert.strictEqual(r.pieces[0].meters, null);
    assert.deepStrictEqual(r.flags, ['a', 'b']);
    assert.strictEqual(r.machine, null);
    assert.strictEqual(r.title, '2000m');
  });

  test('photo: metadata is stripped from JPEG and PNG', () => {
    const out = R.stripImageMetadata(fakeJpeg());
    const text = out.toString('latin1');
    assert.ok(!/GPSLatitude|Exif|taken by a phone/.test(text), 'EXIF and comment gone');
    assert.ok(/JFIF/.test(text) && /frame-data/.test(text), 'image segments kept');
    assert.deepStrictEqual([...out.subarray(0, 2)], [0xff, 0xd8]);
    assert.ok(out.includes(Buffer.from([0x11, 0x22, 0xff, 0xd9])), 'scan data kept');
    const chunk = (type, body) => { const b = Buffer.alloc(12 + body.length); b.writeUInt32BE(body.length, 0); b.write(type, 4, 'latin1'); Buffer.from(body).copy(b, 8); return b; };
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', '0123456789abc'), chunk('eXIf', 'GPS'), chunk('tEXt', 'Comment\0hi'), chunk('IDAT', 'pixels'), chunk('IEND', '')]);
    const p = R.stripImageMetadata(png).toString('latin1');
    assert.ok(!/GPS|Comment/.test(p) && /IHDR/.test(p) && /pixels/.test(p) && /IEND/.test(p));
    assert.throws(() => R.stripImageMetadata(Buffer.from('GIF89a....')), /JPEG or PNG/);
    assert.throws(() => R.stripImageMetadata(Buffer.from([0xff, 0xd8, 0x12, 0x34])), /Damaged/);
  });

  test('photo: readErgScreen sends a stripped image and returns a normalized read', async () => {
    const client = fakeClient(okReply(answer()));
    const res = await R.readErgScreen({ client, bytes: fakeJpeg() });
    assert.ok(res.ok);
    assert.strictEqual(res.model, 'claude-haiku-5-5');
    assert.strictEqual(res.read.totalMeters, 2000);
    assert.deepStrictEqual(res.usage, { input: 2668, output: 900 });
    const req = client.calls[0];
    assert.strictEqual(req.max_tokens, 4000);
    assert.deepStrictEqual(req.output_config.format.schema, R.SCHEMA);
    assert.ok(!('temperature' in req) && !('thinking' in req), 'no sampling or thinking settings');
    const img = req.messages[0].content[0];
    assert.strictEqual(img.source.media_type, 'image/jpeg');
    const sent = Buffer.from(img.source.data, 'base64').toString('latin1');
    assert.ok(!/GPSLatitude|Exif/.test(sent), 'no EXIF reaches the model');
    assert.ok(/Concept2/.test(req.messages[0].content[1].text), 'prompt included');
    const retry = await R.readErgScreen({ client, bytes: fakeJpeg(), model: R.MODELS.retry });
    assert.strictEqual(client.calls[1].model, 'claude-sonnet-5-5');
    assert.strictEqual(retry.model, 'claude-sonnet-5-5');
  });

  test('photo: readErgScreen reports failures instead of throwing', async () => {
    const bytes = fakeJpeg();
    const fail = async (reply, b = bytes) => R.readErgScreen({ client: fakeClient(reply), bytes: b });
    assert.strictEqual((await fail(okReply(answer(), { stop_reason: 'refusal' }))).reason, 'refused');
    assert.strictEqual((await fail(okReply(answer(), { stop_reason: 'max_tokens' }))).reason, 'truncated');
    assert.strictEqual((await fail({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] })).reason, 'bad_reply');
    assert.strictEqual((await fail({ stop_reason: 'end_turn', content: [] })).reason, 'bad_reply');
    assert.strictEqual((await fail(okReply({ title: 'x' }))).reason, 'bad_reply');
    assert.strictEqual((await fail(new Error('boom'))).reason, 'api_error');
    assert.strictEqual((await fail(okReply(answer()), Buffer.from('GIF89a'))).reason, 'bad_image');
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]), Buffer.alloc(R.MAX_IMAGE_BYTES + 1)]);
    assert.strictEqual((await fail(okReply(answer()), big)).reason, 'too_large');
  });

  test('photo: clock formatting for messages', () => {
    assert.strictEqual(C.formatClock(360.8), '6:00.8');
    assert.strictEqual(C.formatClock(366.5), '6:06.5');
    assert.strictEqual(C.formatClock(59.95), '1:00.0');
    assert.strictEqual(C.formatClock(3723.4), '62:03.4');
  });

  test('photo: titles', () => {
    assert.deepStrictEqual(C.parseTitle('2000m'), { kind: 'single', by: 'distance', value: 2000 });
    assert.deepStrictEqual(C.parseTitle('20:00'), { kind: 'single', by: 'time', value: 1200 });
    assert.deepStrictEqual(C.parseTitle('6x500m/2:00r'), { kind: 'intervals', reps: 6, by: 'distance', value: 500, restS: 120 });
    assert.deepStrictEqual(C.parseTitle('10x3:00/1:15r'), { kind: 'intervals', reps: 10, by: 'time', value: 180, restS: 75 });
    assert.deepStrictEqual(C.parseTitle('3x9:00/4:30r'), { kind: 'intervals', reps: 3, by: 'time', value: 540, restS: 270 });
    assert.strictEqual(C.parseTitle('Just Row'), null);
    assert.strictEqual(C.parseTitle(''), null);
  });

  test('photo: screen dates', () => {
    assert.strictEqual(C.parseScreenDate('Oct 27 2026', TODAY), '2026-10-27');
    assert.strictEqual(C.parseScreenDate('October 27, 2026', TODAY), '2026-10-27');
    assert.strictEqual(C.parseScreenDate('Oct 27', TODAY), '2026-10-27');
    assert.strictEqual(C.parseScreenDate('10/27/2026', TODAY), '2026-10-27');
    assert.strictEqual(C.parseScreenDate('2026-10-27', TODAY), '2026-10-27');
    assert.strictEqual(C.parseScreenDate('Mar 15 2105', TODAY), null, 'a misread time of day');
    assert.strictEqual(C.parseScreenDate('Feb 30 2026', TODAY), null);
    assert.strictEqual(C.parseScreenDate('', TODAY), null);
    assert.strictEqual(C.parseScreenDate('hello', TODAY), null);
  });

  test('photo: a clean 2000 m screen passes with no issues', () => {
    const res = C.runChecks(read(), { today: TODAY });
    assert.deepStrictEqual(res.issues, []);
    assert.strictEqual(res.status, 'clean');
  });

  test('photo: splits that do not add up are held and both sides are told', () => {
    const doctored = read({
      total: { time: '6:06.5', meters: 1500, avg_split: '2:02.2', avg_rate: 28 },
      title: '1500m',
      pieces: [piece('1:00.1', 250, '2:00.2'), piece('1:00.1', 250, '2:00.2'), piece('1:00.1', 250, '2:00.2'), piece('1:00.1', 250, '2:00.2'), piece('1:00.2', 250, '2:00.4'), piece('1:00.2', 250, '2:00.4')],
      meters_column: 'per_piece',
    });
    const res = C.runChecks(doctored, { today: TODAY });
    assert.strictEqual(res.status, 'hold');
    const i = res.issues.find((x) => x.code === 'splits_sum');
    assert.ok(i && i.level === 'hold' && i.coaches);
    assert.ok(/splits total 6:00.8 but the screen says 6:06.5/.test(i.athlete), i.athlete);
    assert.ok(/clearer photo, or type it in with \/log\. A coach has been told/.test(i.athlete));
    assert.ok(!/cheat|fake|doctor|lie/i.test(i.athlete), 'neutral wording, no accusation');
    assert.ok(/6:00.8/.test(i.coach) && /6:06.5/.test(i.coach));
  });

  test('photo: time must match meters at the average split', () => {
    const res = C.runChecks(read({ total: { time: '7:30.0', meters: 2000, avg_split: '2:00.0', avg_rate: 24 }, pieces: [] }), { today: TODAY });
    assert.strictEqual(res.status, 'hold');
    assert.deepStrictEqual(codes(res), ['pace_mismatch']);
    // rounding in the average split is not a mismatch
    const ok = C.runChecks(read({ total: { time: '7:37.8', meters: 2000, avg_split: '1:54.5', avg_rate: 28 }, pieces: [] }), { today: TODAY });
    assert.strictEqual(ok.status, 'clean', JSON.stringify(ok.issues));
  });

  test('photo: BikeErg splits are per 1000 m', () => {
    const bike = read({ split_label: '/1000m', title: '4000m', total: { time: '8:00.0', meters: 4000, avg_split: '2:00.0', avg_rate: 80 }, pieces: [] });
    assert.strictEqual(bike.machine, 'BikeErg');
    assert.strictEqual(C.runChecks(bike, { today: TODAY }).status, 'clean');
    // the same numbers read as a rower would not add up
    const row = { ...bike, machine: 'RowErg' };
    assert.strictEqual(C.runChecks(row, { today: TODAY }).status, 'hold');
  });

  test('photo: missing numbers are calculated and marked', () => {
    const a = C.fillMissing(read({ total: { time: '8:00.0', meters: null, avg_split: '2:00.0', avg_rate: 24 }, pieces: [] }));
    assert.strictEqual(a.totalMeters, 2000);
    assert.deepStrictEqual(a.calculated, ['meters']);
    const b = C.fillMissing(read({ total: { time: '', meters: 2000, avg_split: '2:00.0', avg_rate: 24 }, pieces: [] }));
    assert.strictEqual(b.totalTimeS, 480);
    const c = C.fillMissing(read({ total: { time: '8:00.0', meters: 2000, avg_split: '', avg_rate: 24 }, pieces: [] }));
    assert.strictEqual(c.avgSplitS, 120);
    const res = C.runChecks(read({ total: { time: '8:00.0', meters: null, avg_split: '2:00.0', avg_rate: 24 }, pieces: [] }), { today: TODAY });
    assert.strictEqual(res.status, 'clean');
    assert.deepStrictEqual(res.issues.map((i) => [i.code, i.level]), [['calculated', 'note']]);
    assert.ok(/calculated from the other numbers, please check/.test(res.issues[0].athlete));
    // Bike time from meters uses 1000 m
    const d = C.fillMissing(read({ split_label: '/1000m', total: { time: '', meters: 4000, avg_split: '2:00.0', avg_rate: 80 }, pieces: [] }));
    assert.strictEqual(d.totalTimeS, 480);
  });

  test('photo: unreadable totals and unknown machine ask the athlete', () => {
    const none = C.runChecks(read({ total: { time: '', meters: null, avg_split: '', avg_rate: null }, pieces: [] }), { today: TODAY });
    assert.strictEqual(none.status, 'ask');
    assert.ok(codes(none).includes('totals_missing'));
    const noLabel = C.runChecks(read({ split_label: '' }), { today: TODAY });
    assert.strictEqual(noLabel.status, 'ask');
    assert.ok(codes(noLabel).includes('machine_unknown'));
    assert.ok(/rower or a BikeErg/.test(noLabel.issues[0].athlete));
  });

  const intervals = (n = 6) => read({
    title: '6x500m/2:00r',
    total: { time: '11:14.4', meters: 3000, avg_split: '1:52.4', avg_rate: 28 },
    total_time_incl_rest: '23:14.4',
    meters_column: 'per_piece',
    pieces: Array.from({ length: n }, () => piece('1:52.4', 500, '1:52.4', 28)),
  });

  test('photo: a complete interval screen passes', () => {
    const res = C.runChecks(intervals(), { today: TODAY });
    assert.deepStrictEqual(res.issues, []);
  });

  test('photo: a scrolled interval screen asks for the rest', () => {
    const tenOfTen = read({
      title: '10x3:00/1:15r',
      total: { time: '30:00.0', meters: 6974, avg_split: '2:09.0', avg_rate: 26 },
      meters_column: 'per_piece',
      pieces: Array.from({ length: 7 }, () => piece('3:00.0', 697, '2:09.0', 26)),
    });
    const res = C.runChecks(tenOfTen, { today: TODAY });
    assert.strictEqual(res.status, 'ask');
    assert.deepStrictEqual(codes(res), ['pieces_missing'], 'no false "doesn\'t add up" for a partial list');
    assert.ok(/7 of 10 pieces/.test(res.issues[0].athlete) && /That's everything/.test(res.issues[0].athlete));
  });

  test('photo: interval pieces must add to the work totals', () => {
    const r = intervals();
    r.pieces[2] = { ...r.pieces[2], meters: 450 };
    const res = C.runChecks(r, { today: TODAY });
    assert.strictEqual(res.status, 'hold');
    assert.ok(codes(res).includes('meters_sum'));
    assert.ok(codes(res).includes('pieces_vs_title'));
  });

  test('photo: Total Time counts a rest after every piece', () => {
    const r = intervals();
    r.totalTimeInclRestS = 674.4 + 600; // only 5 rests
    const res = C.runChecks(r, { today: TODAY });
    assert.ok(codes(res).includes('rest_total'));
    assert.strictEqual(res.status, 'clean', 'a flag for coaches, not a hold');
  });

  test('photo: only a date more than 3 days off is questioned', () => {
    const at = (date) => C.runChecks(read({ date }), { today: TODAY });
    assert.deepStrictEqual(at('Oct 28 2026').issues, []);
    assert.deepStrictEqual(at('Oct 25 2026').issues, [], 'exactly 3 days is fine');
    const old = at('Oct 24 2026');
    assert.strictEqual(old.status, 'clean', 'a flag for coaches, never a block: monitor clocks reset');
    assert.deepStrictEqual(old.issues.map((i) => [i.code, i.level]), [['date_off', 'flag']]);
    assert.ok(/4 days before/.test(old.issues[0].coach) && /logged on the day sent/.test(old.issues[0].coach));
    assert.strictEqual(at('Nov 2 2026').issues[0].code, 'date_off', 'a future date too');
    assert.deepStrictEqual(at('Mar 15 2105').issues, [], 'an unreadable year is ignored');
    assert.deepStrictEqual(at('').issues, []);
  });

  test('photo: summary row above the line is not a piece, and Total Time with rest is not working time', () => {
    // David's screen, 2026-10-28: 2 x 2000 m. The 4000 m row above the line is the sum of the two rows under it,
    // and the header Total Time (22:45.0) includes rest. The reader had put both in as data.
    const screen = read({
      title: '2x2000m/1:13.5r', date: '2015-11-16', meters_column: 'per_piece',
      total: { time: '22:45.0', meters: 4000, avg_split: '2:32.2', avg_rate: 22 },
      pieces: [piece('20:18.0', 4000, '2:32.2', 22), piece('10:09.0', 2000, '2:32.2', 22), piece('10:09.0', 2000, '2:32.2', 22)],
    });
    const res = C.runChecks(screen, { today: TODAY });
    assert.strictEqual(res.status, 'clean', JSON.stringify(res.issues));
    assert.strictEqual(res.read.pieces.length, 2, 'the subtotal row is gone');
    assert.strictEqual(res.read.totalTimeS, 1218, 'working time, not Total Time');
    assert.strictEqual(res.read.totalTimeInclRestS, 1365);
    assert.deepStrictEqual(codes(res).sort(), ['date_off', 'subtotal_dropped', 'working_time']);
    assert.ok(res.issues.every((i) => i.level === 'note' || i.level === 'flag'));
    // a real mismatch still holds
    const bad = read({ title: '2x2000m/2:00r', meters_column: 'per_piece', total: { time: '19:00.0', meters: 4000, avg_split: '2:32.2', avg_rate: 22 },
      pieces: [piece('10:09.0', 2000, '2:32.2'), piece('10:09.0', 2000, '2:32.2')] });
    assert.strictEqual(C.runChecks(bad, { today: TODAY }).status, 'hold');
    // a single piece with splits is never mistaken for a subtotal
    assert.strictEqual(C.dropSubtotal(read()).dropped, null);
    // and a three-interval screen that merely has a repeated size keeps all its pieces
    assert.strictEqual(C.dropSubtotal(read({ pieces: [piece('2:00.0', 500, '2:00.0'), piece('2:00.0', 500, '2:00.0'), piece('2:00.0', 500, '2:00.0')] })).dropped, null);
    // the prompt says the same
    assert.ok(/summary row above the line/.test(R.PROMPT) && /WORKING time/.test(R.PROMPT));
  });

  test('photo: repeated totals are flagged to coaches only', () => {
    const res = C.runChecks(read(), { today: TODAY, priorTotals: [{ timeS: 480, meters: 2000 }, { timeS: 500, meters: 2000 }] });
    assert.strictEqual(res.status, 'clean', 'still saves');
    assert.deepStrictEqual(res.issues.map((i) => [i.code, i.level, i.coaches]), [['repeat_totals', 'flag', true]]);
    assert.strictEqual(res.issues[0].athlete, '');
    assert.deepStrictEqual(C.runChecks(read(), { today: TODAY, priorTotals: [{ timeS: 480, meters: 1999 }] }).issues, []);
  });

  test('photo: an implausible split is flagged', () => {
    const res = C.runChecks(read({ total: { time: '2:00.0', meters: 2000, avg_split: '0:30.0', avg_rate: 24 }, pieces: [] }), { today: TODAY });
    assert.ok(codes(res).includes('split_implausible'));
  });

  test('photo: a real-shaped cumulative 1500 m detail screen passes', () => {
    // six 250 m splits, cumulative column, total 1500 m in 6:11.4 (from the 2026-10-27 test, numbers rounded)
    const r = read({
      title: '1500m',
      total: { time: '6:11.4', meters: 1500, avg_split: '2:03.8', avg_rate: 29 },
      pieces: [piece('1:01.9', 250, '2:03.8'), piece('1:01.9', 500, '2:03.8'), piece('1:01.9', 750, '2:03.8'), piece('1:01.9', 1000, '2:03.8'), piece('1:01.9', 1250, '2:03.8'), piece('1:01.9', 1500, '2:03.8')],
    });
    const res = C.runChecks(r, { today: TODAY });
    assert.deepStrictEqual(res.issues, [], JSON.stringify(res.issues));
  });
}
