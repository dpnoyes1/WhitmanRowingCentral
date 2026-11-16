// Water import page (coaches only; on-water plan Step 2). A coach adds the FIT files exported from the NK Logbook app after practice.
// Each file is read on the server (/api/water/preview), shown with its boat, shift and that boat's saved lineup, and saved on a tap
// (/api/water/save), which credits every rower in the boat with its moving time and meters. Saving the same file again updates it.

const KINDS = ['Practice', 'Pieces', 'Race'];
const SHIFTS = ['Early', 'Late', 'Other'];
const CLASSES = ['8+', '4+', '4x', '4-', '2x', '2-', '1x'];
let F = [];            // one per file: { key, name, data, state: 'reading'|'ready'|'saving'|'saved'|'error', view, pick, lineups, msg }
let ctx = null;        // { app, esc, fmtTime, fmtNum }
let wired = false;

/** h:mm:ss for long times, m:ss for short ones. */
export const clock = (s) => {
  if (s === null || s === undefined) return '–';
  const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};

/** The saved lineup a file would credit (same date, shift and boat name; first lineup only), or null. */
export function lineupFor(lineups, pick) {
  const name = (pick.boatName || '').trim().toLowerCase();
  return (lineups || []).find((l) => l.fromPiece === '' && l.shift === pick.shift && l.boatName.toLowerCase() === name) || null;
}

/** What saving will do, in one line. */
export function creditLine(lineup, view) {
  if (!lineup) return null;
  const rowers = lineup.seats.filter(Boolean).length;
  return `${rowers} rower${rowers === 1 ? '' : 's'}${lineup.cox ? ' and the cox' : ''} · each rower gets ${clock(view.movingS)} and ${Math.round(view.meters).toLocaleString('en-US')} m${lineup.cox ? '; the cox gets attendance only' : ''}`;
}

const toBase64 = (file) => new Promise((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] || '');
  r.onerror = () => fail(new Error('Could not read ' + file.name));
  r.readAsDataURL(file);
});

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let out = {};
  try { out = await res.json(); } catch { out = {}; }
  if (!res.ok) throw new Error(out.error || 'Could not reach the site.');
  return out;
}

async function addFiles(list) {
  for (const file of list) {
    const key = file.name + ':' + file.size + ':' + file.lastModified;
    if (F.some((f) => f.key === key)) continue;
    const f = { key, name: file.name, state: 'reading', msg: '' };
    F.push(f); draw();
    try {
      f.data = await toBase64(file);
      const out = await post('/api/water/preview', { name: file.name, data: f.data });
      Object.assign(f, { state: 'ready', view: out.file, lineups: out.lineups, imported: out.imported,
        pick: { boatName: out.suggest.boatName || '', boatClass: out.suggest.boatClass || '8+', shift: out.suggest.shift, kind: out.file.kind } });
    } catch (e) { f.state = 'error'; f.msg = e.message; }
    draw();
  }
}

async function save(f) {
  if (!f.pick.boatName.trim()) { f.msg = 'Pick the boat.'; draw(); return; }
  f.state = 'saving'; f.msg = ''; draw();
  try {
    const out = await post('/api/water/save', { name: f.name, data: f.data, ...f.pick });
    const rowers = out.credited.filter((c) => !c.cox).length, cox = out.credited.some((c) => c.cox);
    f.state = 'saved';
    f.msg = (out.reimport ? 'Updated. ' : 'Saved. ') + (out.credited.length
      ? `${rowers} rower${rowers === 1 ? '' : 's'} credited ${clock(out.movingS)} and ${Math.round(out.meters).toLocaleString('en-US')} m${cox ? ', cox marked at practice' : ''}.`
      : 'No lineup saved for this boat yet, so nobody was credited. Save the lineup on the Lineups page and it credits this file then.');
    f.imported = { by: 'you', boatName: f.pick.boatName };
  } catch (e) { f.state = 'ready'; f.msg = e.message; }
  draw();
}

function card(f, i) {
  const { esc } = ctx;
  if (f.state === 'reading') return `<div class="card wi"><b>${esc(f.name)}</b><p class="muted small">Reading...</p></div>`;
  if (f.state === 'error') return `<div class="card wi"><div class="lu-head"><h2>${esc(f.name)}</h2><button type="button" class="btn ghost sm" data-wdrop="${i}">Remove</button></div><p class="small warn">${esc(f.msg)}</p></div>`;
  const v = f.view, p = f.pick, lu = lineupFor(f.lineups, p), boats = [...new Set((f.lineups || []).map((l) => l.boatName))];
  const busy = f.state === 'saving';
  const sel = (attr, opts, cur, label) => `<label>${label}<select data-${attr}="${i}"${busy ? ' disabled' : ''}>${opts.map((o) => `<option${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
  return `<div class="card wi"><div class="lu-head"><h2>${esc(v.date)} · ${esc(v.clock)}</h2><span class="muted small">${esc(f.name)}</span>
      ${f.state !== 'saving' ? `<button type="button" class="btn ghost sm" data-wdrop="${i}">Remove</button>` : ''}</div>
    <p class="small num">Unit ${esc(v.unit || '?')}${v.unitSource === 'name' ? ' (from the file name)' : ''} · <b>${clock(v.movingS)}</b> moving (${clock(v.elapsedS)} on the clock) · <b>${Math.round(v.meters).toLocaleString('en-US')} m</b>
      · ${v.avgSplitS ? clock(v.avgSplitS) + ' /500m' : '–'} · ${v.avgRate ?? '–'} spm${v.pieces.length ? ` · ${v.pieces.length} piece${v.pieces.length === 1 ? '' : 's'}` : ''}</p>
    ${v.warnings.length ? `<p class="muted small">${v.warnings.map(esc).join(' ')}</p>` : ''}
    ${f.imported ? `<p class="small">Already imported${f.imported.by ? ' by ' + esc(f.imported.by) : ''}. Saving again updates it.</p>` : ''}
    <div class="wi-pick">
      <label>Boat<input type="text" list="wboats-${i}" maxlength="40" value="${esc(p.boatName)}" data-wboat="${i}" placeholder="Shell name"${busy ? ' disabled' : ''}>
        <datalist id="wboats-${i}">${boats.map((b) => `<option value="${esc(b)}">`).join('')}</datalist></label>
      ${sel('wcls', CLASSES, p.boatClass, 'Class')}${sel('wshift', SHIFTS, p.shift, 'Shift')}${sel('wkind', KINDS, p.kind, 'Kind')}</div>
    <p class="small ${lu ? '' : 'warn'}">${lu ? 'Lineup: ' + esc(lu.seatNames.filter(Boolean).join(', ')) + (lu.coxName ? ' · cox ' + esc(lu.coxName) : '') + '<br><span class="muted">' + esc(creditLine(lu, v)) + '</span>'
      : `No lineup saved for ${esc(p.boatName || 'this boat')} on ${esc(v.date)}, ${esc(p.shift)}. You can still save the file; rowers are credited when the lineup is saved.`}</p>
    <div class="lu-actions"><button type="button" class="btn sm" data-wsave="${i}"${busy ? ' disabled' : ''}>${busy ? 'Saving...' : f.state === 'saved' ? 'Save again' : 'Save'}</button></div>
    ${f.msg ? `<p class="small${f.state === 'saved' ? '' : ' warn'}" role="status">${esc(f.msg)}</p>` : ''}</div>`;
}

function draw() {
  const { app } = ctx;
  if (!document.querySelector('.wimport')) return;
  const ready = F.filter((f) => f.state === 'ready').length;
  document.querySelector('.wimport-list').innerHTML = F.map(card).join('');
  const all = document.querySelector('[data-wsaveall]');
  all.hidden = ready < 2; all.textContent = `Save all ${ready}`;
  void app;
}

function shell() {
  ctx.app.innerHTML = `<div class="wimport"><div class="head"><div><div class="eyebrow">Coach tools · athletes never see this page</div><h1>Water import</h1>
      <p class="muted">After practice, sync each SpeedCoach or CoxBox to the NK Logbook app, export each session as a FIT file, and add the files here. Every rower in the boat's saved lineup gets the boat's moving time and meters.</p></div></div>
    <div class="card"><label class="btn" for="wfiles">Add FIT files</label><input id="wfiles" type="file" accept=".fit" multiple hidden data-wfiles="1">
      <button type="button" class="btn ghost sm" data-wsaveall="1" hidden>Save all</button>
      <p class="muted small">Files stay private: the original goes to a coaches-only Drive folder.</p></div>
    <div class="wimport-list"></div></div>`;
  draw();
}

function wire() {
  if (wired) return; wired = true;
  const on = () => !!ctx && !!document.querySelector('.wimport');
  document.addEventListener('change', (e) => {
    const t = on() && e.target; if (!t || !t.dataset) return;
    if (t.dataset.wfiles) { addFiles([...t.files]); t.value = ''; return; }
    const i = +(t.dataset.wcls ?? t.dataset.wshift ?? t.dataset.wkind ?? -1); if (!(i >= 0) || !F[i]) return;
    if (t.dataset.wcls !== undefined) F[i].pick.boatClass = t.value;
    if (t.dataset.wshift !== undefined) F[i].pick.shift = t.value;
    if (t.dataset.wkind !== undefined) F[i].pick.kind = t.value;
    draw();
  });
  document.addEventListener('input', (e) => { const t = on() && e.target; if (!t || !t.dataset || t.dataset.wboat === undefined) return;
    const f = F[+t.dataset.wboat]; f.pick.boatName = t.value;
    const lu = lineupFor(f.lineups, f.pick); if (lu) f.pick.boatClass = lu.boatClass; });
  document.addEventListener('focusout', (e) => { const t = on() && e.target; if (t && t.dataset && t.dataset.wboat !== undefined) draw(); });
  document.addEventListener('click', (e) => {
    if (!on()) return; const q = (s) => e.target.closest(s);
    if (q('[data-wsave]')) save(F[+q('[data-wsave]').dataset.wsave]);
    else if (q('[data-wdrop]')) { F.splice(+q('[data-wdrop]').dataset.wdrop, 1); draw(); }
    else if (q('[data-wsaveall]')) { (async () => { for (const f of F.filter((x) => x.state === 'ready')) await save(f); })(); }
  });
}

/** Called each time the page opens. Files already added in this tab stay, so a coach can come back to them. */
export function openWater(c) {
  ctx = c; wire(); shell();
}
