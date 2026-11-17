// Plan workouts (coach workout planner). A card per day with its workouts in order; "+ Add workout" under a day opens
// the builder for THAT day (type it in plain language or fill Single / Intervals / Variable, or start from a saved
// workout); tap a workout to edit, delete or publish it; arrows reorder a day. Saves go to the Sheet's Workouts and
// Schedule tabs through /api/workouts, so the Sheet checks every piece. Coaches only.
const DAYFULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CATS = ['Aerobic', 'Threshold', 'Sprint', 'Benchmark', 'Other'];
const ZONE_OF = { Aerobic: 'Aerobic', Threshold: 'Threshold', Sprint: 'Anaerobic' };   // Benchmark and Other: no zone
const PRESET = {
  distance: () => [{ w: '2000', r: '8:00' }, { w: '1500', r: '6:00' }, { w: '1000', r: '4:00' }, { w: '500', r: '2:00' }, { w: '250', r: '' }],
  time: () => [{ w: '20:00', r: '3:00' }, { w: '15:00', r: '2:00' }, { w: '10:00', r: '1:00' }, { w: '5:00', r: '' }]
};

const tsec = (s) => { const m = /^(\d{1,3}):([0-5]\d)$/.exec(String(s).trim()); return m ? +m[1] * 60 + +m[2] : null; };
const dnum = (s) => { const m = /^\d{2,5}$/.exec(String(s).replace(/[,\s]|m$/gi, '')); return m ? +m[0] : null; };
const hms = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`; };
const clean = (s) => String(s).replace(/[,\s]|m$/gi, '');
const MILE = 1609.344, RUN = 'Run', ERG = 'Erg (RowErg)';
/** A distance as typed: meters for an erg piece, miles or km (decimals allowed) for a run. null when not a number. */
const distNum = (B, s) => {
  if (B.act !== RUN) return dnum(s);
  const t = clean(s);
  return /^\d{1,3}(\.\d{1,2})?$/.test(t) && +t > 0 ? +t : null;
};
const toMeters = (B, v) => (B.act === RUN ? Math.round(+v * (B.unit === 'km' ? 1000 : MILE)) : +v);
const distText = (B, v) => (B.act === RUN ? `${v} ${B.unit === 'km' ? 'km' : 'mi'}` : v + ' m');
/** A custom pace target typed as m:ss or m:ss.d, between 1:00 and 25:00. */
const paceOk = (s) => { const m = /^(\d{1,2}):([0-5]\d)(\.\d)?$/.exec(String(s).trim()); return !!m && +m[1] * 60 + +m[2] >= 60 && +m[1] * 60 + +m[2] <= 1500; };
const paceUnit = (B) => (B.act === RUN ? (B.unit === 'km' ? 'per km' : 'per mile') : 'per 500m');

/** Plain-language text -> builder fields. Exported for the tests. */
export function parseNL(s) {
  const t = String(s).toLowerCase().replace(/×/g, 'x').replace(/\s+/g, ' ').trim(), o = {}, tm = (x) => (x.includes(':') ? x : x + ':00');
  const c = [['aerobic', 'Aerobic'], ['steady', 'Aerobic'], ['threshold', 'Threshold'], ['anaerobic', 'Sprint'], ['sprint', 'Sprint'], ['benchmark', 'Benchmark'], ['test', 'Benchmark']].find(([w]) => t.includes(w));
  if (c) o.cat = c[1];
  if (/\brun(s|ning)?\b/.test(t)) { o.act = RUN; o.unit = /\bkm\b|kilomet/.test(t) ? 'km' : 'mi'; }
  const di = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].findIndex((d) => new RegExp('\\b' + d).test(t));
  if (di >= 0) o.day = di;
  const parts = t.split(/\bwith\b|\brest\b|@/), nums = parts[0].match(/\d[\d:]*/g) || [];
  const im = /(\d+)\s*x\s*(\d[\d:]*)\s*(min|meters|m)?/.exec(t);
  if (im) {
    const after = t.slice(im.index + im[0].length), rm = /(\d[\d:]*)\s*(?:min)?\s*(?:rest|r\b)/.exec(after) || /(?:\/|with|@)\s*(\d[\d:]*)/.exec(after);
    const isT = im[2].includes(':') || im[3] === 'min';
    o.type = 'intervals'; o.by = isT ? 'time' : 'distance'; o.n = im[1]; o.work = isT ? tm(im[2]) : im[2]; o.rest = rm ? tm(rm[1]) : '';
    return o;
  }
  if (/variable|pyramid/.test(t) ? nums.length >= 2 : nums.length >= 3) {
    const by = nums.some((x) => x.includes(':')) ? 'time' : 'distance', rests = ((parts[1] || '').match(/\d[\d:]*/g) || []).map(tm);
    o.type = 'variable'; o.by = by; o.rows = nums.map((w, i) => ({ w: by === 'time' ? tm(w) : w.replace(/\D/g, ''), r: rests[i] || '' }));
    return o;
  }
  if (nums.length === 1) {
    const km = /km/.test(t), isT = nums[0].includes(':') || /\bmin/.test(t);
    o.type = 'single'; o.by = isT ? 'time' : 'distance'; o.single = isT ? tm(nums[0]) : String(km && o.act !== RUN ? Math.round(parseFloat(nums[0]) * 1000) : nums[0]);
    return o;
  }
  return o;
}

/** The builder state -> the pieces the Sheet saves, or { err } in plain words. Exported for the tests. */
export function buildPieces(B) {
  const tim = B.by === 'time', zone = ZONE_OF[B.cat] || '';
  const run = B.act === RUN;
  const bad = tim ? 'Type the time as minutes:seconds, like 30:00.' : run ? `Type the distance in ${B.unit === 'km' ? 'kilometers' : 'miles'}, like 3.1.` : 'Type the distance in meters, like 2000.';
  const ok = (v) => (tim ? tsec(v) !== null : distNum(B, v) !== null);
  const wt = tim ? 'Time' : 'Distance';
  if (B.paceOn && !paceOk(B.pace)) return { err: `Type the pace target as minutes:seconds ${paceUnit(B)}, like ${run ? '8:00' : '1:45.0'}.` };
  const piece = (work, rest, reps = 1) => ({ workType: wt, reps: String(reps), work: tim ? work.trim() : String(toMeters(B, clean(work))), rest: rest || '', startEvery: '', zone, base: '', lowPct: '', highPct: '', rate: '',
    ...(run ? { activity: RUN, ...(tim ? {} : { unit: B.unit === 'km' ? 'km' : 'mi' }) } : {}), ...(B.paceOn ? { pace: B.pace.trim() } : {}) });
  if (B.type === 'single') {
    if (!ok(B.single)) return { err: bad };
    return { pieces: [piece(B.single, '')] };
  }
  if (B.type === 'intervals') {
    if (!/^\d{1,2}$/.test(String(B.n).trim()) || +B.n < 1) return { err: 'Type how many intervals, like 6.' };
    if (!ok(B.work)) return { err: bad };
    if (tsec(B.rest) === null) return { err: 'Type the rest as minutes:seconds, like 1:30.' };
    return { pieces: [piece(B.work, B.rest.trim(), +B.n)] };
  }
  const rows = B.rows[B.by];
  if (rows.length < 2) return { err: 'Add at least two intervals.' };
  if (rows.length > 12) return { err: 'A workout can have up to 12 pieces.' };
  for (const [i, x] of rows.entries()) {
    if (!ok(x.w)) return { err: `Interval ${i + 1}: ${bad.charAt(0).toLowerCase() + bad.slice(1)}` };
    if (x.r.trim() !== '' && tsec(x.r) === null) return { err: `Interval ${i + 1}: type the rest as minutes:seconds, like 2:00.` };
  }
  return { pieces: rows.map((x) => piece(x.w, x.r.trim())) };
}

/** What the coach reads under Preview. Exported for the tests. */
export function previewOf(B) {
  const b = buildPieces(B);
  if (b.err) return { err: b.err };
  const tim = B.by === 'time', fmtTot = (n) => (tim ? hms(n) : B.act === RUN ? Math.round(n * 100) / 100 + (B.unit === 'km' ? ' km' : ' mi') : n.toLocaleString('en-US') + ' m');
  const w = (x) => (tim ? tsec(x) : distNum(B, x));
  const goal = B.paceOn ? ` · Goal pace ${B.pace.trim()} ${paceUnit(B).replace('per ', '/').replace('mile', 'mi').replace('500m', '500m')}` : '';
  if (B.type === 'single') { const n = w(B.single); return { text: (B.act === RUN ? 'Run · ' : '') + (tim ? hms(n) : distText(B, n)), note: 'One continuous piece' + goal }; }
  if (B.type === 'intervals') {
    const n = +B.n, ww = w(B.work), r = tsec(B.rest);
    return { text: `${B.act === RUN ? 'Run · ' : ''}${n} × ${tim ? hms(ww) : distText(B, ww)} / ${hms(r)}`, note: `Total work ${fmtTot(n * ww)} · ${n - 1} rest${n === 2 ? '' : 's'} of ${hms(r)}${goal}` };
  }
  const rows = B.rows[B.by], ws = rows.map((x) => w(x.w)), rs = rows.filter((x) => x.r.trim() !== '').map((x) => hms(tsec(x.r)));
  return { text: (B.act === RUN ? 'Run · ' : '') + ws.map((x) => (tim ? hms(x) : x)).join(' / ') + (tim ? '' : B.act === RUN ? (B.unit === 'km' ? ' km' : ' mi') : ' m') + (rs.length ? ' · rest ' + rs.join(' / ') : ''), note: `${rows.length} intervals · Total work ${fmtTot(ws.reduce((a, b) => a + b, 0))}${goal}` };
}

// Dates are handled as YYYY-MM-DD text; arithmetic goes through UTC so a daylight change never moves a day.
const toDate = (d) => new Date(d + 'T00:00:00Z');
const iso = (dt) => dt.toISOString().slice(0, 10);
const addDays = (d, n) => { const dt = toDate(d); dt.setUTCDate(dt.getUTCDate() + n); return iso(dt); };
const mondayOf = (d) => addDays(d, -((toDate(d).getUTCDay() + 6) % 7));


/** A saved workout's pieces -> builder fields, or null when the builder cannot show it faithfully. Exported for the tests. */
export function fromPieces(pieces, name = '') {
  if (!Array.isArray(pieces) || !pieces.length || pieces.length > 12) return null;
  const types = new Set(pieces.map((p) => p.workType));
  if (types.size !== 1 || !['Time', 'Distance'].includes(pieces[0].workType)) return null;
  if (pieces.some((p) => p.startEvery || p.base || p.lowPct || p.highPct || p.rate || p.notes)) return null;
  const acts = new Set(pieces.map((p) => p.activity || ERG)), paces = new Set(pieces.map((p) => p.pace || ''));
  const units = new Set(pieces.map((p) => p.unit || ''));
  if (acts.size !== 1 || paces.size !== 1 || ![ERG, RUN].includes([...acts][0])) return null;
  const act = [...acts][0], pace = [...paces][0], unit = act === RUN ? ([...units][0] === 'km' ? 'km' : 'mi') : '';
  if (act === ERG && [...units][0]) return null;
  if (pace && !paceOk(pace)) return null;
  const zones = new Set(pieces.map((p) => p.zone || ''));
  if (zones.size !== 1) return null;
  const by = pieces[0].workType === 'Time' ? 'time' : 'distance';
  const ok = (v) => (by === 'time' ? tsec(v) !== null : dnum(v) !== null);
  const cat = { Aerobic: 'Aerobic', Threshold: 'Threshold', Anaerobic: 'Sprint', '': 'Other' }[[...zones][0]];
  if (!cat || pieces.some((p) => !ok(p.work || '') || (p.rest && tsec(p.rest) === null))) return null;
  // A run by distance is kept in meters; show it back in the unit the coach typed.
  const shown = (p) => (by === 'time' ? p.work : act === RUN ? String(Math.round(+clean(p.work) / (unit === 'km' ? 1000 : MILE) * 100) / 100) : clean(p.work));
  const reps = (p) => +(p.reps || 1), o = { name, cat, by, act, unit: unit || 'mi', paceOn: !!pace, pace };
  if (pieces.length === 1) {
    const p = pieces[0];
    if (reps(p) === 1 && !p.rest) return { ...o, type: 'single', single: shown(p) };
    if (!p.rest || tsec(p.rest) === null || reps(p) < 1 || reps(p) > 99) return null;
    return { ...o, type: 'intervals', n: String(reps(p)), work: shown(p), rest: p.rest };
  }
  if (pieces.some((p) => reps(p) !== 1)) return null;
  return { ...o, type: 'variable', rows: pieces.map((p) => ({ w: shown(p), r: p.rest || '' })) };
}

export function openPlan(v, ctx) {
  const { app, esc, fmtDate } = ctx;
  let data = v, msg = '', err = '', nlMsg = null, busy = false, busyKind = '', asking = false, scrollTo = '';
  // From Friday on the week to plan is next week (David, 2026-11-12: a coach plans ahead).
  const startWeek = () => { const dow = (toDate(data.today).getUTCDay() + 6) % 7; return dow >= 4 ? addDays(mondayOf(data.today), 7) : mondayOf(data.today); };
  const B = {
    open: false, edit: null, day: '', also: [], useId: '', keep: false, pick: '', act: ERG, unit: 'mi', paceOn: false, pace: '',
    notes: '', name: '', cat: 'Aerobic', type: 'intervals', by: 'time', single: '30:00', n: '2', work: '30:00', rest: '1:30',
    rows: { distance: PRESET.distance(), time: PRESET.time() }, nl: '', squad: 'All', session: 'Practice', published: false,
    week: startWeek()
  };
  { const f = data.library.find((w) => w.saved !== false); B.pick = f ? f.id : ''; }
  let nameTouched = false;

  const opt = (list, cur) => list.map((o) => `<option${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('');
  const seg = (items, cur, attr, cls = '') => `<div class="seg fill ${cls}" role="group">${items.map(([k, l]) => `<button type="button" ${attr}="${k}" aria-pressed="${cur === k}">${l}</button>`).join('')}</div>`;
  const bad = (ok) => (ok ? '' : ' bad');
  const tim = () => B.by === 'time';
  const okW = (x) => (tim() ? tsec(x) !== null : distNum(B, x) !== null);
  const input = (k, val, o = {}) => `<input class="in${o.big ? ' bigv' : ''}${bad(o.ok !== false)}" data-k="${k}"${o.i !== undefined ? ` data-i="${o.i}"` : ''} value="${esc(val)}" inputmode="${o.mode || 'text'}" autocomplete="off"${o.ph ? ` placeholder="${esc(o.ph)}"` : ''}${o.aria ? ` aria-label="${esc(o.aria)}"` : ''}>`;
  const fld = (label, k, val, o) => `<label class="f">${label}${input(k, val, o)}</label>`;
  const lib = (id) => data.library.find((w) => w.id === id);
  const keyOf = (u) => ({ day: u.day, workoutId: u.workoutId, squad: u.squad, session: u.session });
  const sameKey = (a, b) => a && b && a.day === b.day && a.workoutId === b.workoutId && a.squad === b.squad && a.session === b.session;

  const byseg = () => `<div class="f">Work by${seg([['distance', 'Distance'], ['time', 'Time']], B.by, 'data-by', 'tall')}</div>`;
  const run = () => B.act === RUN;
  const dLabel = () => (run() ? `Distance (${B.unit === 'km' ? 'kilometers' : 'miles'})` : 'Distance (meters)');
  const wLabel = (t) => (t ? 'Time (min : sec)' : dLabel());
  const fields = () => {
    const t = tim();
    if (B.type === 'single') return `<div class="fgrid">${byseg()}${fld(wLabel(t), 'single', B.single, { big: 1, ok: okW(B.single), mode: run() && !t ? 'decimal' : 'text' })}</div>`;
    if (B.type === 'intervals') {
      return `<div class="fgrid">${fld('Intervals', 'n', B.n, { big: 1, mode: 'numeric', ok: /^\d{1,2}$/.test(B.n.trim()) && +B.n >= 1 })}${byseg()}</div>
        <div class="fgrid">${fld(t ? 'Work time (min : sec)' : 'Work ' + dLabel().toLowerCase(), 'work', B.work, { big: 1, ok: okW(B.work), mode: run() && !t ? 'decimal' : 'text' })}${fld('Rest (min : sec)', 'rest', B.rest, { big: 1, ok: tsec(B.rest) !== null })}</div>`;
    }
    const rows = B.rows[B.by];
    return `<div class="fgrid">${byseg()}<div></div></div>
      <div class="vrows"><div class="vrow hd"><span></span><span>${t ? 'Work (min : sec)' : run() ? 'Work (' + (B.unit === 'km' ? 'km' : 'miles') + ')' : 'Work (meters)'}</span><span>Rest after (min : sec)</span><span></span></div>
      ${rows.map((x, i) => `<div class="vrow"><span class="ix">${i + 1}</span>${input('rw', x.w, { big: 1, i, aria: `Interval ${i + 1} work`, ok: okW(x.w) })}${input('rr', x.r, { big: 1, i, aria: `Interval ${i + 1} rest`, ph: 'none', ok: x.r.trim() === '' || tsec(x.r) !== null })}<button type="button" class="xbtn" data-delrow="${i}" aria-label="Remove interval ${i + 1}">×</button></div>`).join('')}</div>
      <div class="chips"><button type="button" class="btn ghost sm" data-addrow="1"${rows.length >= 12 ? ' disabled' : ''}>+ Add interval</button><button type="button" class="btn ghost sm" data-clearrows="1">Clear</button></div>`;
  };

  const pvHtml = () => {
    const p = previewOf(B);
    return p.err ? ['–', `<span class="warn-text">${esc(p.err)}</span>`]
      : [esc(p.text), esc(p.note) + (B.paceOn ? '. Everyone sees this goal pace.' : B.act === RUN ? '.' : '. Athletes see this with their own pace window, worked out from a percentage of their 20\' watts.')];
  };

  const dayShort = (d) => `${fmtDate(d, { weekday: 'short' })} ${toDate(d).getUTCDate()}`;
  const dayLong = (d) => fmtDate(d, { weekday: 'long', month: 'short', day: 'numeric' });

  // ---- the week: a card per day, workouts in order, + Add workout under each day ----
  const weekHtml = () => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(B.week, i));
    // Mon to Fri get a card each; Sat and Sun share one "Weekend" card (David, 2026-11-17: no weekend practice, OYO only).
    const groups = [...days.slice(0, 5).map((d) => [d]), days.slice(5)];
    const cardsFor = (d, past) => {
      const there = data.upcoming.map((u, i) => ({ u, i })).filter((x) => x.u.day === d);
      return there.map(({ u, i }, n) => {
        const sel = B.open && sameKey(B.edit && B.edit.key, keyOf(u)), sum = (lib(u.workoutId) || {}).summary || '';
        const arrows = past ? '' : `<span class="pmv"><button type="button" class="xbtn sm" data-mv="${i}:-1"${n === 0 || busy ? ' disabled' : ''} aria-label="Move ${esc(u.name || u.workoutId)} earlier">↑</button><button type="button" class="xbtn sm" data-mv="${i}:1"${n === there.length - 1 || busy ? ' disabled' : ''} aria-label="Move ${esc(u.name || u.workoutId)} later">↓</button></span>`;
        return `<div class="pcard${sel ? ' sel' : ''}"><div class="phd"><span class="eyebrow">Workout ${n + 1}</span>${arrows}</div>
          <button type="button" class="pmain" data-edit="${i}"${past ? ' disabled' : ''} aria-label="${past ? '' : 'Edit '}${esc(u.name || u.workoutId)}, ${esc(dayShort(d))}">
            <b>${esc(u.name || u.workoutId)}</b>${sum ? `<span class="num">${esc(sum)}</span>` : ''}
            <small>${esc(u.squad)} · ${esc(u.session)} <span class="pill${u.published ? ' good' : ''}">${u.published ? 'Published' : 'Draft'}</span></small>${u.notes ? `<small class="pnote">${esc(u.notes)}</small>` : ''}</button></div>`;
      }).join('') || '<p class="muted">No workouts yet</p>';
    };
    return groups.map((g) => {
      const multi = g.length > 1, adding = B.open && !B.edit && g.includes(B.day);
      const count = data.upcoming.filter((u) => g.includes(u.day)).length;
      const head = multi ? `<b>Weekend</b> <span class="num">${toDate(g[0]).getUTCDate()}–${toDate(g[1]).getUTCDate()}</span>` : `<b>${esc(fmtDate(g[0], { weekday: 'short' }))}</b> <span class="num">${toDate(g[0]).getUTCDate()}</span>`;
      const block = (d) => {
        const past = d < data.today, on = adding && B.day === d;
        return `<div class="pdayblock">${multi ? `<div class="eyebrow">${esc(dayShort(d))}</div>` : ''}${cardsFor(d, past)}
          <button type="button" class="padd${on ? ' on' : ''}" data-add="${d}"${past || busy ? ' disabled' : ''}>${on ? 'Adding below ↓' : multi ? `+ Add to ${esc(fmtDate(d, { weekday: 'short' }))}` : '+ Add workout'}</button></div>`;
      };
      return `<section class="pday${adding ? ' pick' : ''}"><header>${head}<small>${count ? `${count} planned` : ''}</small></header>${g.map(block).join('')}</section>`;
    }).join('');
  };
  const weekLabel = () => `${fmtDate(B.week, { month: 'short', day: 'numeric' })} to ${fmtDate(addDays(B.week, 6), { month: 'short', day: 'numeric' })}`;

  // ---- the editor: opens under the week, names its day ----
  const editorHtml = () => {
    if (!B.open) return `<div class="card pempty"><p><b>Your week, one workout at a time.</b></p><p class="muted">Tap “+ Add workout” under a day to build one for that day, or tap a workout to change it.</p></div>`;
    const [pt, pn] = pvHtml(), editing = !!B.edit, day = editing ? B.edit.key.day : B.day;
    const picks = data.library.filter((w) => w.saved !== false);
    const saved = picks.length ? `<div class="f">Start from a saved workout<div class="nlrow"><select class="in" data-k="pick" aria-label="Saved workout">${picks.map((w) => `<option value="${esc(w.id)}"${w.id === B.pick ? ' selected' : ''}>${esc(w.name)}${w.summary ? ' · ' + esc(w.summary) : ''}</option>`).join('')}</select><button type="button" class="btn ghost sm" data-usepick="1">Use it</button></div><span class="sub">It fills in the builder. Change anything you like; the saved one is never changed.</span></div>` : '';
    const using = B.useId ? lib(B.useId) : null;
    const builder = B.useId
      ? `<div class="card"><div class="eyebrow">Using saved workout</div><div class="big num">${esc(using ? using.name : B.useId)}</div><p class="note">${esc(using ? using.summary : '')} Used exactly as saved.</p><button type="button" class="btn ghost sm" data-ownbuild="1">Build my own instead</button></div>`
      : `<div class="f nlf">Type it in plain language, then check the builder below<div class="nlrow">${input('nl', B.nl, { aria: 'Describe the workout', ph: '2 × 30:00 with 1:30 rest, aerobic' })}<button type="button" class="btn sm" data-fill="1">Fill builder</button></div>
        <span id="nlmsg" class="sub${nlMsg && nlMsg.err ? ' warn-text' : ''}">${nlMsg ? esc(nlMsg.t) : 'e.g. “4 × 2000 m, 4:00 rest, threshold”'}</span></div>
      <div class="fgrid">${fld('Name', 'name', B.name, { ph: 'Monday aerobic' })}<label class="f">Category<select class="in" data-k="cat">${opt(CATS, B.cat)}</select></label></div>
      <div class="f">Activity${seg([[ERG, 'Erg'], [RUN, 'Run']], B.act, 'data-act')}</div>
      ${run() && B.by === 'distance' ? `<div class="f">Run distance in${seg([['mi', 'Miles'], ['km', 'Kilometers']], B.unit, 'data-unit')}</div>` : ''}
      ${seg([['single', 'Single'], ['intervals', 'Intervals'], ['variable', 'Variable']], B.type, 'data-type')}
      ${fields()}
      <div class="f"><label class="chk"><input type="checkbox" data-paceon="1"${B.paceOn ? ' checked' : ''}> Set a custom pace target (athletes, coaches and coxswains see it)</label>
        ${B.paceOn ? fld(`Pace target (min : sec ${paceUnit(B)})`, 'pace', B.pace, { big: 1, ok: paceOk(B.pace), ph: run() ? '8:00' : '1:45.0' }) : ''}</div>
      <div class="f"><label class="chk"><input type="checkbox" data-keep="1"${B.keep ? ' checked' : ''}> Save to my saved workouts (to reuse later)</label><span class="sub">Leave this off for a one-off. It is still planned for the day.</span></div>
      <div class="card"><div class="eyebrow">Preview</div><div class="big num" id="pv">${pt}</div><p class="note" id="pvn">${pn}</p></div>`;
    const others = editing ? '' : Array.from({ length: 7 }, (_, i) => addDays(B.week, i)).filter((d) => d !== B.day && d >= data.today);
    const also = editing || !others.length ? '' : `<div class="f">Also add to these days<div class="alsodays" role="group" aria-label="Also add to">${others.map((d) => `<button type="button" data-also="${d}" aria-pressed="${B.also.includes(d)}">${esc(dayShort(d))}</button>`).join('')}</div></div>`;
    const nDays = 1 + B.also.length, on = nDays > 1 ? ` on ${nDays} days` : '';
    const dis = busy ? ' disabled' : '';
    const label = (kind, idle, doing) => (busy && busyKind === kind ? doing : idle);
    const actions = editing
      ? `<div class="actions pedit">${asking
          ? `<span class="wgask" role="group" aria-label="Confirm delete"><span>Athletes can see this one. Remove it from ${esc(dayShort(day))}? It stays in your saved workouts.</span><button type="button" class="btn sm danger" data-rmyes="1"${dis}>${label('remove', 'Yes, delete', 'Deleting…')}</button><button type="button" class="btn ghost sm" data-rmno="1"${dis}>Keep it</button></span>`
          : `<button type="button" class="btn ghost danger-o" data-del="1"${dis}>Delete workout</button>`}
          <button type="button" class="btn ghost" data-cancel="1"${dis}>Cancel</button><button type="button" class="btn${busy && busyKind === 'update' ? ' busy' : ''}" data-update="1"${dis}><span class="spinner" aria-hidden="true"></span><span class="label">${label('update', 'Save changes', 'Saving…')}</span></button></div>`
      : `<div class="actions"><button type="button" class="btn ghost" data-cancel="1"${dis}>Cancel</button><button class="btn ghost${busy && busyKind === 'draft' ? ' busy' : ''}" type="button" data-save="draft"${dis}><span class="spinner" aria-hidden="true"></span><span class="label">${label('draft', 'Save draft' + on, 'Saving…')}</span></button><button class="btn${busy && busyKind === 'publish' ? ' busy' : ''}" type="button" data-save="publish"${dis}><span class="spinner" aria-hidden="true"></span><span class="label">${label('publish', 'Save and publish' + on, 'Publishing…')}</span></button></div>`;
    return `<section class="card peditor pstack" id="peditor"><div class="eyebrow">${editing ? 'Editing' : 'Adding to'} · ${esc(dayLong(day))}</div><h2>${editing ? 'Edit workout' : 'Add workout'}</h2>
      ${saved}${builder}
      <div class="fgrid"><label class="f">Squad<select class="in" data-k="squad">${opt(['All', 'Varsity', 'Novice'], B.squad)}</select></label><label class="f">Session<select class="in" data-k="session">${opt(['Practice', 'OYO'], B.session)}</select></label></div>
      ${fld('Notes for the day (athletes and coaches see this)', 'notes', B.notes, { ph: 'e.g. Meet at the boathouse at 3:00' })}
      ${editing ? `<div class="f">Who can see it${seg([['draft', 'Draft (hidden)'], ['published', 'Published']], B.published ? 'published' : 'draft', 'data-pub')}</div>` : ''}
      ${also}${actions}${busy ? '<p class="note" role="status">Saving to the Sheet. This can take a few seconds.</p>' : ''}</section>`;
  };

  const draw = () => {
    app.innerHTML = `<div class="head"><div><div class="eyebrow">Coach · Plans</div><h1>Plan workouts</h1></div>
        <div class="wkhead"><button class="btn ghost sm" type="button" data-wk="-1" aria-label="Previous week">‹</button><div class="eyebrow">${esc(weekLabel())}</div><button class="btn ghost sm" type="button" data-wk="1" aria-label="Next week">›</button></div></div>
      <div id="pnotice">${busy && busyKind === 'move' ? '<p class="notice" role="status">Saving the new order…</p>' : ''}${msg ? `<p class="notice" role="status">${esc(msg)}</p>` : ''}${err ? `<p class="notice warn" role="alert">${esc(err)}</p>` : ''}</div>
      <div class="pweek">${weekHtml()}</div>
      <p class="note">Drafts are hidden from athletes until published. The arrows set the order athletes see on that day.</p>
      ${editorHtml()}`;
    wire();
    if (scrollTo) { const el = app.querySelector(scrollTo); scrollTo = ''; if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  };

  // Keystrokes update the numbers and the preview in place, so typing never loses its place.
  const refreshPreview = () => {
    const [pt, pn] = pvHtml();
    const a = app.querySelector('#pv'), b = app.querySelector('#pvn');
    if (a) a.innerHTML = pt; if (b) b.innerHTML = pn;
  };
  const setK = (k, val, i) => {
    if (k === 'rw') B.rows[B.by][i].w = val; else if (k === 'rr') B.rows[B.by][i].r = val;
    else if (k === 'nl') B.nl = val; else B[k] = val;
  };
  const apply = (o) => {
    B.type = o.type; B.by = o.by;
    if (o.type === 'single') B.single = o.single;
    if (o.type === 'intervals') { B.n = o.n; B.work = o.work; B.rest = o.rest; }
    if (o.type === 'variable') B.rows[o.by] = o.rows;
    if (o.cat) B.cat = o.cat;
    if ('act' in o) B.act = o.act;
    if ('unit' in o) B.unit = o.unit;
    if ('paceOn' in o) { B.paceOn = o.paceOn; B.pace = o.pace || ''; }
  };

  const fill = () => {
    const o = parseNL(B.nl);
    if (!o.type) { nlMsg = { err: 1, t: 'I could not read that. Try “6 × 30:00 with 1:30 rest, aerobic”.' }; draw(); return; }
    apply(o);
    if (o.day !== undefined && !B.edit) { const d = addDays(B.week, o.day); if (d !== B.day && d >= data.today && !B.also.includes(d)) B.also.push(d); }
    if (!nameTouched && !B.name.trim() && (o.cat || o.day !== undefined)) B.name = (o.day !== undefined ? DAYFULL[o.day] + ' ' : '') + (o.cat ? o.cat.toLowerCase() : 'workout');
    nlMsg = { t: 'Filled in below. Check the numbers, then save.' };
    draw();
  };

  const resetBuilder = () => {
    Object.assign(B, { notes: '', name: '', cat: 'Aerobic', type: 'intervals', by: 'time', single: '30:00', n: '2', work: '30:00', rest: '1:30', nl: '', useId: '', keep: false, also: [], act: ERG, unit: 'mi', paceOn: false, pace: '' });
    B.rows = { distance: PRESET.distance(), time: PRESET.time() };
    nameTouched = false; nlMsg = null; asking = false;
  };
  const openAdd = (d) => { err = msg = ''; resetBuilder(); B.open = true; B.edit = null; B.day = d; scrollTo = '#peditor'; draw(); };
  const openEdit = (i) => {
    const u = data.upcoming[i]; if (!u) return;
    err = msg = ''; resetBuilder();
    const l = lib(u.workoutId), parsed = l && fromPieces(l.pieces, l.name);
    B.open = true; B.edit = { key: keyOf(u) }; B.day = u.day;
    B.squad = u.squad; B.session = u.session; B.notes = u.notes || ''; B.published = !!u.published; B.name = u.name || '';
    if (parsed) { apply(parsed); nameTouched = true; } else B.useId = u.workoutId;
    B.keep = !l || l.saved !== false;
    scrollTo = '#peditor'; draw();
  };
  const usePick = () => {
    const l = lib(B.pick); if (!l) return;
    B.keep = false;
    const parsed = fromPieces(l.pieces, l.name);
    if (parsed) { apply(parsed); B.name = l.name; B.useId = ''; nameTouched = true; nlMsg = { t: `Loaded “${l.name}”. Change anything, then save.` }; }
    else { B.useId = l.id; nlMsg = null; }
    draw();
  };

  // Reorder at once on screen, then confirm with the Sheet; put the old order back if it fails.
  const moveSession = async (i, d) => {
    if (busy) return;
    const u = data.upcoming[i]; if (!u) return;
    const j = (() => { for (let x = i + d; x >= 0 && x < data.upcoming.length; x += d) { if (data.upcoming[x].day === u.day) return x; } return -1; })();
    if (j < 0) return;
    const before = data.upcoming.slice(), key = keyOf(u);
    const next = before.slice(); [next[i], next[j]] = [next[j], next[i]];
    data = { ...data, upcoming: next };
    const ok = await act({ move: { key, dir: d } }, 'move', '');
    if (!ok) data = { ...data, upcoming: before };
    draw();
  };

  function wire() {
    app.querySelectorAll('[data-add]').forEach((b) => { b.onclick = () => openAdd(b.dataset.add); });
    app.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => openEdit(Number(b.dataset.edit)); });
    app.querySelectorAll('[data-mv]').forEach((b) => { b.onclick = () => { const [i, d] = b.dataset.mv.split(':').map(Number); moveSession(i, d); }; });
    app.querySelectorAll('[data-type]').forEach((b) => { b.onclick = () => { B.type = b.dataset.type; draw(); }; });
    app.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => { B.act = b.dataset.act; draw(); }; });
    app.querySelectorAll('[data-unit]').forEach((b) => { b.onclick = () => { B.unit = b.dataset.unit; draw(); }; });
    const kp = app.querySelector('[data-keep]'); if (kp) kp.onchange = () => { B.keep = kp.checked; };
    const po = app.querySelector('[data-paceon]'); if (po) po.onchange = () => { B.paceOn = po.checked; draw(); };
    app.querySelectorAll('[data-by]').forEach((b) => { b.onclick = () => { B.by = b.dataset.by; draw(); }; });
    app.querySelectorAll('[data-pub]').forEach((b) => { b.onclick = () => { B.published = b.dataset.pub === 'published'; draw(); }; });
    app.querySelectorAll('[data-also]').forEach((b) => { b.onclick = () => { const d = b.dataset.also, i = B.also.indexOf(d); if (i >= 0) B.also.splice(i, 1); else B.also.push(d); B.also.sort(); draw(); }; });
    app.querySelectorAll('input[data-k]').forEach((el) => {
      el.oninput = () => {
        setK(el.dataset.k, el.value, Number(el.dataset.i));
        if (el.dataset.k === 'name') nameTouched = true;
        if (el.dataset.k !== 'nl' && el.dataset.k !== 'name' && el.dataset.k !== 'notes') refreshPreview();
      };
      if (el.dataset.k === 'nl') el.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); fill(); } };
      else el.onchange = draw;   // redraw once a field is left, so a wrong number is marked
    });
    app.querySelectorAll('select[data-k]').forEach((el) => { el.onchange = () => { setK(el.dataset.k, el.value); if (el.dataset.k === 'cat') refreshPreview(); }; });
    const f = app.querySelector('[data-fill]'); if (f) f.onclick = fill;
    const up = app.querySelector('[data-usepick]'); if (up) up.onclick = usePick;
    const ob = app.querySelector('[data-ownbuild]'); if (ob) ob.onclick = () => { B.useId = ''; draw(); };
    app.querySelectorAll('[data-delrow]').forEach((b) => { b.onclick = () => { B.rows[B.by].splice(Number(b.dataset.delrow), 1); draw(); }; });
    const add = app.querySelector('[data-addrow]'); if (add) add.onclick = () => { B.rows[B.by].push({ w: '', r: '' }); draw(); };
    const clr = app.querySelector('[data-clearrows]'); if (clr) clr.onclick = () => { B.rows[B.by] = [{ w: '', r: '' }, { w: '', r: '' }]; draw(); };
    app.querySelectorAll('[data-wk]').forEach((b) => { b.onclick = () => { B.week = addDays(B.week, 7 * Number(b.dataset.wk)); draw(); }; });
    app.querySelectorAll('[data-save]').forEach((b) => { b.onclick = () => save(b.dataset.save === 'publish'); });
    const cn = app.querySelector('[data-cancel]'); if (cn) cn.onclick = () => { B.open = false; B.edit = null; asking = false; err = msg = ''; draw(); };
    const up2 = app.querySelector('[data-update]'); if (up2) up2.onclick = update;
    const del = app.querySelector('[data-del]'); if (del) del.onclick = () => { if (B.published) { asking = true; draw(); } else remove(); };
    const ry = app.querySelector('[data-rmyes]'); if (ry) ry.onclick = remove;
    const rn = app.querySelector('[data-rmno]'); if (rn) rn.onclick = () => { asking = false; draw(); };
  }

  // What the editor holds as the saved workout: new pieces from the builder, or a saved one used as is.
  const workoutPart = () => {
    if (B.useId) return { part: { workoutId: B.useId } };
    const built = buildPieces(B);
    if (!B.name.trim()) return { err: 'Give the workout a name.' };
    if (built.err) return { err: 'Fix the numbers first. ' + built.err };
    return { part: { name: B.name.trim(), pieces: built.pieces, keep: B.keep } };
  };

  // One call to /api/workouts; every answer carries the Sheet's fresh week.
  const act = async (body, kind, done) => {
    if (busy) return false;
    err = msg = '';
    busy = true; busyKind = kind; draw();
    let ok = false;
    try {
      const res = await fetch('/api/workouts', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (res.status === 401) { ctx.signedOut(); return false; }
      if (!res.ok) err = out.error || 'Nothing was saved.';
      else { data = out; if (ctx.saved) ctx.saved(out); msg = typeof done === 'function' ? done(out) : done; ok = true; }
    } catch { err = 'Could not reach the site. Check the week before trying again.'; }
    busy = false; asking = false;
    return ok;
  };
  const after = (ok) => { if (ok) { B.open = false; B.edit = null; } scrollTo = '#pnotice'; draw(); };

  const save = async (publish) => {
    const w = workoutPart();
    if (w.err) { err = w.err; draw(); return; }
    const dates = [B.day, ...B.also].sort();
    const ok = await act({ dates, squad: B.squad, session: B.session, publish, notes: B.notes.trim(), ...w.part }, publish ? 'publish' : 'draft',
      () => `Added “${B.name || (lib(B.useId) || {}).name || 'workout'}” to ${dates.map(dayShort).join(', ')}${publish ? ', published' : ' as a draft'}.`);
    after(ok);
  };
  const update = async () => {
    const w = workoutPart();
    if (w.err) { err = w.err; draw(); return; }
    const ok = await act({ update: { key: B.edit.key, to: { squad: B.squad, session: B.session, notes: B.notes.trim(), publish: B.published, ...w.part } } }, 'update',
      () => `Saved changes to ${dayShort(B.edit.key.day)}.`);
    after(ok);
  };
  const remove = async () => {
    const k = B.edit.key, u = data.upcoming.find((x) => sameKey(keyOf(x), k));
    const ok = await act({ remove: k }, 'remove', () => `Deleted “${(u && u.name) || k.workoutId}” from ${dayShort(k.day)}. It is still in your saved workouts.`);
    after(ok);
  };

  draw();
  // Opened from the last answer: swap in the Sheet's current one unless a save is under way or the page has changed.
  if (ctx.refresh) ctx.refresh.then((nv) => { if (!busy && !B.open && ctx.stillHere()) { data = nv; draw(); } }).catch(() => {});
}
