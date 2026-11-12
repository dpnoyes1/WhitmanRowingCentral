// Add workout (coach workout builder), laid out like the redesign mockup: type it in plain language or fill the
// builder (Single / Intervals / Variable), tap days on the week, then Save draft or Save and publish. Saves go to the
// Sheet's Workouts and Schedule tabs through /api/workouts, so the Sheet checks every piece. Coaches only.
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

/** Plain-language text -> builder fields. Exported for the tests. */
export function parseNL(s) {
  const t = String(s).toLowerCase().replace(/×/g, 'x').replace(/\s+/g, ' ').trim(), o = {}, tm = (x) => (x.includes(':') ? x : x + ':00');
  const c = [['aerobic', 'Aerobic'], ['steady', 'Aerobic'], ['threshold', 'Threshold'], ['anaerobic', 'Sprint'], ['sprint', 'Sprint'], ['benchmark', 'Benchmark'], ['test', 'Benchmark']].find(([w]) => t.includes(w));
  if (c) o.cat = c[1];
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
    o.type = 'single'; o.by = isT ? 'time' : 'distance'; o.single = isT ? tm(nums[0]) : String(km ? Math.round(parseFloat(nums[0]) * 1000) : nums[0]);
    return o;
  }
  return o;
}

/** The builder state -> the pieces the Sheet saves, or { err } in plain words. Exported for the tests. */
export function buildPieces(B) {
  const tim = B.by === 'time', zone = ZONE_OF[B.cat] || '';
  const bad = tim ? 'Type the time as minutes:seconds, like 30:00.' : 'Type the distance in meters, like 2000.';
  const ok = (v) => (tim ? tsec(v) !== null : dnum(v) !== null);
  const wt = tim ? 'Time' : 'Distance';
  const piece = (work, rest, reps = 1) => ({ workType: wt, reps: String(reps), work: tim ? work.trim() : clean(work), rest: rest || '', startEvery: '', zone, base: '', lowPct: '', highPct: '', rate: '' });
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
  const tim = B.by === 'time', fmtTot = (n) => (tim ? hms(n) : n.toLocaleString('en-US') + ' m');
  const w = (x) => (tim ? tsec(x) : dnum(x));
  if (B.type === 'single') { const n = w(B.single); return { text: tim ? hms(n) : n + ' m', note: 'One continuous piece' }; }
  if (B.type === 'intervals') {
    const n = +B.n, ww = w(B.work), r = tsec(B.rest);
    return { text: `${n} × ${tim ? hms(ww) : ww + ' m'} / ${hms(r)}`, note: `Total work ${fmtTot(n * ww)} · ${n - 1} rest${n === 2 ? '' : 's'} of ${hms(r)}` };
  }
  const rows = B.rows[B.by], ws = rows.map((x) => w(x.w)), rs = rows.filter((x) => x.r.trim() !== '').map((x) => hms(tsec(x.r)));
  return { text: ws.map((x) => (tim ? hms(x) : x)).join(' / ') + (tim ? '' : ' m') + (rs.length ? ' · rest ' + rs.join(' / ') : ''), note: `${rows.length} intervals · Total work ${fmtTot(ws.reduce((a, b) => a + b, 0))}` };
}

// Dates are handled as YYYY-MM-DD text; arithmetic goes through UTC so a daylight change never moves a day.
const toDate = (d) => new Date(d + 'T00:00:00Z');
const iso = (dt) => dt.toISOString().slice(0, 10);
const addDays = (d, n) => { const dt = toDate(d); dt.setUTCDate(dt.getUTCDate() + n); return iso(dt); };
const mondayOf = (d) => addDays(d, -((toDate(d).getUTCDay() + 6) % 7));

export function openPlan(v, ctx) {
  const { app, esc, fmtDate } = ctx;
  let data = v, msg = '', err = '', nlMsg = null, busy = false;
  // From Friday on the week to plan is next week (David, 2026-11-12: a coach plans ahead).
  const startWeek = () => { const dow = (toDate(data.today).getUTCDay() + 6) % 7; return dow >= 4 ? addDays(mondayOf(data.today), 7) : mondayOf(data.today); };
  const B = {
    mode: 'new', name: '', cat: 'Aerobic', type: 'intervals', by: 'time', single: '30:00', n: '2', work: '30:00', rest: '1:30',
    rows: { distance: PRESET.distance(), time: PRESET.time() }, nl: '', squad: 'All', session: 'Practice',
    week: startWeek(), days: [], workoutId: data.library[0] ? data.library[0].id : ''
  };
  let nameTouched = false;

  const opt = (list, cur) => list.map((o) => `<option${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('');
  const seg = (items, cur, attr, cls = '') => `<div class="seg fill ${cls}" role="group">${items.map(([k, l]) => `<button type="button" ${attr}="${k}" aria-pressed="${cur === k}">${l}</button>`).join('')}</div>`;
  const bad = (ok) => (ok ? '' : ' bad');
  const tim = () => B.by === 'time';
  const okW = (x) => (tim() ? tsec(x) !== null : dnum(x) !== null);
  const input = (k, val, o = {}) => `<input class="in${o.big ? ' bigv' : ''}${bad(o.ok !== false)}" data-k="${k}"${o.i !== undefined ? ` data-i="${o.i}"` : ''} value="${esc(val)}" inputmode="${o.mode || 'text'}" autocomplete="off"${o.ph ? ` placeholder="${esc(o.ph)}"` : ''}${o.aria ? ` aria-label="${esc(o.aria)}"` : ''}>`;
  const fld = (label, k, val, o) => `<label class="f">${label}${input(k, val, o)}</label>`;

  const byseg = () => `<div class="f">Work by${seg([['distance', 'Distance'], ['time', 'Time']], B.by, 'data-by', 'tall')}</div>`;
  const fields = () => {
    const t = tim();
    if (B.type === 'single') return `<div class="fgrid">${byseg()}${fld(t ? 'Time (min : sec)' : 'Distance (meters)', 'single', B.single, { big: 1, ok: okW(B.single) })}</div>`;
    if (B.type === 'intervals') {
      return `<div class="fgrid">${fld('Intervals', 'n', B.n, { big: 1, mode: 'numeric', ok: /^\d{1,2}$/.test(B.n.trim()) && +B.n >= 1 })}${byseg()}</div>
        <div class="fgrid">${fld(t ? 'Work time (min : sec)' : 'Work distance (meters)', 'work', B.work, { big: 1, ok: okW(B.work) })}${fld('Rest (min : sec)', 'rest', B.rest, { big: 1, ok: tsec(B.rest) !== null })}</div>`;
    }
    const rows = B.rows[B.by];
    return `<div class="fgrid">${byseg()}<div></div></div>
      <div class="vrows"><div class="vrow hd"><span></span><span>${t ? 'Work (min : sec)' : 'Work (meters)'}</span><span>Rest after (min : sec)</span><span></span></div>
      ${rows.map((x, i) => `<div class="vrow"><span class="ix">${i + 1}</span>${input('rw', x.w, { big: 1, i, aria: `Interval ${i + 1} work`, ok: okW(x.w) })}${input('rr', x.r, { big: 1, i, aria: `Interval ${i + 1} rest`, ph: 'none', ok: x.r.trim() === '' || tsec(x.r) !== null })}<button type="button" class="xbtn" data-delrow="${i}" aria-label="Remove interval ${i + 1}">×</button></div>`).join('')}</div>
      <div class="chips"><button type="button" class="btn ghost sm" data-addrow="1"${rows.length >= 12 ? ' disabled' : ''}>+ Add interval</button><button type="button" class="btn ghost sm" data-clearrows="1">Clear</button></div>`;
  };

  const pvHtml = () => {
    const p = previewOf(B);
    return p.err ? ['–', `<span class="warn-text">${esc(p.err)}</span>`]
      : [esc(p.text), esc(p.note) + '. Athletes see this with their own pace window, worked out from a percentage of their 20\' watts.'];
  };

  const dayLabel = (d) => `${fmtDate(d, { weekday: 'short' })} ${toDate(d).getUTCDate()}`;
  const weekGrid = () => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(B.week, i));
    return days.map((d) => {
      const past = d < data.today, picked = B.days.includes(d);
      const there = data.upcoming.filter((u) => u.day === d);
      const lines = there.map((u) => `<span class="wgl"><span class="a num">${esc(u.name || u.workoutId)}</span><span class="pill${u.published ? ' good' : ''}">${u.published ? 'Published' : 'Draft'}</span><small>${esc(u.squad)} · ${esc(u.session)}</small></span>`).join('');
      return `<button type="button" class="wg${picked ? ' pick' : ''}${lines ? '' : ' add'}" data-day="${d}"${past ? ' disabled' : ''} aria-pressed="${picked}"><b>${esc(dayLabel(d))}</b>${lines || ''}<span class="${lines ? 'wgmark' : 'muted'}">${picked ? '✓ This workout' : past ? '' : '+ Add'}</span></button>`;
    }).join('');
  };
  const weekLabel = () => `${fmtDate(B.week, { month: 'short', day: 'numeric' })} to ${fmtDate(addDays(B.week, 6), { month: 'short', day: 'numeric' })}`;

  const draw = () => {
    const [pt, pn] = pvHtml();
    const builder = B.mode === 'new' ? `
      <div class="f nlf">Type it in plain language, then check the builder below<div class="nlrow">${input('nl', B.nl, { aria: 'Describe the workout', ph: '2 × 30:00 with 1:30 rest, aerobic, Monday' })}<button type="button" class="btn sm" data-fill="1">Fill builder</button></div>
        <span id="nlmsg" class="sub${nlMsg && nlMsg.err ? ' warn-text' : ''}">${nlMsg ? esc(nlMsg.t) : 'Press Enter or Fill builder. Try “4 × 2000 m with 4:00 rest, threshold, Wednesday” or “variable 2000, 1500, 1000, 500, 250 with 8, 6, 4, 2 min rest”.'}</span></div>
      <div class="fgrid">${fld('Name', 'name', B.name, { ph: 'Monday aerobic' })}<label class="f">Category<select class="in" data-k="cat">${opt(CATS, B.cat)}</select></label></div>
      ${seg([['single', 'Single'], ['intervals', 'Intervals'], ['variable', 'Variable']], B.type, 'data-type')}
      ${fields()}
      <div class="card"><div class="eyebrow">Preview</div><div class="big num" id="pv">${pt}</div><p class="note" id="pvn">${pn}</p></div>`
      : `<label class="f">Saved workout<select class="in" data-k="workoutId">${data.library.map((w) => `<option value="${esc(w.id)}"${w.id === B.workoutId ? ' selected' : ''}>${esc(w.name)}${w.summary ? ' · ' + esc(w.summary) : ''}</option>`).join('')}</select></label>`;
    app.innerHTML = `<div class="head"><div><div class="eyebrow">Coach · Plans</div><h1>${B.mode === 'new' ? 'Add workout' : 'Schedule a saved workout'}</h1></div>
        <div class="seg" role="group" aria-label="What to do"><button type="button" data-mode="new" aria-pressed="${B.mode === 'new'}">New workout</button><button type="button" data-mode="old" aria-pressed="${B.mode === 'old'}"${data.library.length ? '' : ' disabled'}>Saved workout</button></div></div>
      ${msg ? `<p class="notice" role="status">${esc(msg)}</p>` : ''}${err ? `<p class="notice warn" role="alert">${esc(err)}</p>` : ''}
      <div class="cols w"><div class="pstack">${builder}
        <div class="fgrid"><label class="f">Squad<select class="in" data-k="squad">${opt(['All', 'Varsity', 'Novice'], B.squad)}</select></label><label class="f">Session<select class="in" data-k="session">${opt(['Practice', 'OYO'], B.session)}</select></label></div>
        <div class="actions"><button class="btn ghost" type="button" data-save="draft"${busy ? ' disabled' : ''}>Save draft</button><button class="btn" type="button" data-save="publish"${busy ? ' disabled' : ''}>Save and publish</button></div>
      </div><div class="pstack"><div class="wkhead"><button class="btn ghost sm" type="button" data-wk="-1" aria-label="Previous week">‹</button><div class="eyebrow">Week of ${esc(weekLabel())} · tap a day to put this workout on it</div><button class="btn ghost sm" type="button" data-wk="1" aria-label="Next week">›</button></div>
        <div class="weekgrid">${weekGrid()}</div>
        <p class="note">Drafts stay hidden from athletes until published. Every number is typed; there are no scrolling pickers. Save puts the workout on every highlighted day; with none highlighted it is saved to the library only.</p></div></div>`;
    wire();
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

  const fill = () => {
    const o = parseNL(B.nl);
    if (!o.type) { nlMsg = { err: 1, t: 'I could not read that. Try “6 × 30:00 with 1:30 rest, aerobic, Monday”.' }; draw(); return; }
    B.type = o.type; B.by = o.by;
    if (o.type === 'single') B.single = o.single;
    if (o.type === 'intervals') { B.n = o.n; B.work = o.work; B.rest = o.rest; }
    if (o.type === 'variable') B.rows[o.by] = o.rows;
    if (o.cat) B.cat = o.cat;
    if (o.day !== undefined) { const d = addDays(B.week, o.day); if (d >= data.today && !B.days.includes(d)) B.days.push(d); }
    if (!nameTouched && (o.cat || o.day !== undefined)) B.name = (o.day !== undefined ? DAYFULL[o.day] + ' ' : '') + (o.cat ? o.cat.toLowerCase() : 'workout');
    nlMsg = { t: 'Filled in below. Check the numbers, then save.' };
    draw();
  };

  function wire() {
    app.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => { B.mode = b.dataset.mode; msg = err = ''; draw(); }; });
    app.querySelectorAll('[data-type]').forEach((b) => { b.onclick = () => { B.type = b.dataset.type; draw(); }; });
    app.querySelectorAll('[data-by]').forEach((b) => { b.onclick = () => { B.by = b.dataset.by; draw(); }; });
    app.querySelectorAll('input[data-k]').forEach((el) => {
      el.oninput = () => {
        setK(el.dataset.k, el.value, Number(el.dataset.i));
        if (el.dataset.k === 'name') nameTouched = true;
        if (el.dataset.k !== 'nl' && el.dataset.k !== 'name') refreshPreview();
      };
      if (el.dataset.k === 'nl') el.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); fill(); } };
      else el.onchange = draw;   // redraw once a field is left, so a wrong number is marked
    });
    app.querySelectorAll('select[data-k]').forEach((el) => { el.onchange = () => { setK(el.dataset.k, el.value); if (el.dataset.k === 'cat') refreshPreview(); }; });
    const f = app.querySelector('[data-fill]'); if (f) f.onclick = fill;
    app.querySelectorAll('[data-delrow]').forEach((b) => { b.onclick = () => { B.rows[B.by].splice(Number(b.dataset.delrow), 1); draw(); }; });
    const add = app.querySelector('[data-addrow]'); if (add) add.onclick = () => { B.rows[B.by].push({ w: '', r: '' }); draw(); };
    const clr = app.querySelector('[data-clearrows]'); if (clr) clr.onclick = () => { B.rows[B.by] = [{ w: '', r: '' }, { w: '', r: '' }]; draw(); };
    app.querySelectorAll('[data-day]').forEach((b) => {
      b.onclick = () => { const d = b.dataset.day, i = B.days.indexOf(d); if (i >= 0) B.days.splice(i, 1); else B.days.push(d); B.days.sort(); draw(); };
    });
    app.querySelectorAll('[data-wk]').forEach((b) => { b.onclick = () => { B.week = addDays(B.week, 7 * Number(b.dataset.wk)); draw(); }; });
    app.querySelectorAll('[data-save]').forEach((b) => { b.onclick = () => save(b.dataset.save === 'publish'); });
  }

  const save = async (publish) => {
    err = msg = '';
    const body = { dates: B.days, squad: B.squad, session: B.session, publish };
    if (B.mode === 'new') {
      const built = buildPieces(B);
      if (!B.name.trim()) { err = 'Give the workout a name.'; draw(); return; }
      if (built.err) { err = 'Fix the numbers first. ' + built.err; draw(); return; }
      body.name = B.name.trim(); body.pieces = built.pieces;
    } else {
      body.workoutId = B.workoutId;
      if (!B.days.length) { err = 'Tap at least one day.'; draw(); return; }
    }
    busy = true; draw();
    try {
      const res = await fetch('/api/workouts', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (res.status === 401) { ctx.signedOut(); return; }
      if (!res.ok) { err = out.error || 'Nothing was saved.'; busy = false; draw(); return; }
      data = out;
      const n = B.days.length;
      msg = B.mode === 'new'
        ? `Saved as ${out.savedId}${n ? ` and put on ${n} day${n > 1 ? 's' : ''}${publish ? ', published' : ' as a draft'}` : ' in the library'}.`
        : `Scheduled${publish ? ' and published' : ' as a draft'}.`;
      B.days = [];
      if (B.mode === 'new') { B.name = ''; nameTouched = false; B.nl = ''; nlMsg = null; B.workoutId = out.savedId || B.workoutId; }
    } catch { err = 'Could not reach the site. Check the week before saving again.'; }
    busy = false;
    draw();
  };
  draw();
}
