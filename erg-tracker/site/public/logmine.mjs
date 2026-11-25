// Athlete "Log activity": a phone form for a run, ride, swim and so on, saved for herself only (David, 2026-11-12).
// Distance in miles, kilometers or meters; the site sends meters. Erg work is not logged here.
import { shrinkPhoto } from './photo.mjs';

const ACTIVITIES = ['Run', 'Bike', 'Stair stepper', 'Swim', 'Elliptical'];
// Photo first (David, 2026-11-17, live): On, picking a screenshot fills distance and time (via /api/run-photo,
// which itself answers 404 until RUN_PHOTO_CHECK is true) and the athlete checks the numbers and saves. Typing stays as the fallback.
const PHOTO_FIRST = true;
/** Machines that show no distance: the athlete can leave Distance blank and it is saved as 0 m (minutes still count). */
export const NO_DISTANCE = ['Stair stepper', 'Elliptical'];
const UNITS = { mi: ['miles', 1609.344], km: ['kilometers', 1000], m: ['meters', 1] };

export function paceText(timeS, meters) {
  if (!(timeS > 0) || !(meters > 0)) return '';
  const per = (m) => { const s = Math.round(timeS / meters * m); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  return `Pace ${per(1609.344)} per mile, ${per(1000)} per km.`;
}

/** The phone number pad has no colon, so digits typed alone get one: 2530 -> 25:30, 10230 -> 1:02:30. One or two digits stay as minutes; anything with a colon is left as typed. */
export function autoClock(t) {
  const s = String(t).trim();
  if (!/^\d{3,6}$/.test(s)) return s;
  const sec = s.slice(-2), min = s.slice(-4, -2), h = s.slice(0, -4);
  return s.length <= 4 ? `${s.slice(0, -2)}:${sec}` : `${h}:${min}:${sec}`;
}

/** "25:00", "1:02:30" or "25" (minutes) -> seconds, or null. */
export function parseDuration(t) {
  const s = String(t).trim();
  if (/^\d{1,3}$/.test(s)) return +s * 60;
  const m = /^(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)$/.exec(s);
  return m ? (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] : null;
}

const clock = (sec) => `${Math.floor(sec / 3600) ? Math.floor(sec / 3600) + ':' : ''}${String(Math.floor(sec % 3600 / 60)).padStart(Math.floor(sec / 3600) ? 2 : 1, '0')}:${String(sec % 60).padStart(2, '0')}.0`;

export function openLogMine(ctx) {
  const { app, esc, fmtDay, signedOut } = ctx;
  const days = Array.from({ length: 8 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - i); return d.toLocaleDateString('en-CA'); });
  const rid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  const S = { activity: 'Run', date: days[0], type: 'oyo', dist: '', unit: 'mi', time: '', note: '', photo: '', photoName: '', msg: '', err: '', busy: false, rid: rid(), done: null };
  const meters = () => { const n = Number(String(S.dist).replace(',', '.')); return n > 0 ? Math.round(n * UNITS[S.unit][1]) : 0; };
  const field = (label, k, extra = '') => `<label class="f">${label}<input class="in" data-f="${k}" value="${esc(S[k])}" autocomplete="off" ${extra}></label>`;
  const drawDone = () => {
    const d = S.done;
    app.innerHTML = `<div class="head"><div><h1>Log activity</h1></div></div>
      <div class="card logdone" role="status" aria-live="polite"><div class="logdone-tick" aria-hidden="true">✓</div>
        <h2>${d.already ? 'Already saved' : 'Saved'}</h2>
        <p class="logdone-what"><strong>${esc(d.what)}</strong></p>
        <p class="muted">${esc(d.already ? `This workout was already saved${d.savedAt ? ' at ' + d.savedAt : ''}. Nothing was added, so you don't need to submit again.` : 'Your coaches can see it now. You do not need to submit it again.')}${d.photo ? ' ' + esc(d.photo) : ''}</p>
        ${d.pace ? `<p class="muted small">${esc(d.pace)}</p>` : ''}
        <div class="actions"><button class="btn" type="button" id="lm-again">Log another activity</button></div></div>`;
    app.querySelector('#lm-again').onclick = () => { S.done = null; draw(); };
    window.scrollTo && window.scrollTo(0, 0);
  };
  const draw = () => {
    if (S.done) { drawDone(); return; }
    const photoBlock = `        <div class="f"><span>Photo of your watch or phone screen (optional)</span>${S.photo ? `<div class="lf-row"><span class="pill">${esc(S.photoName || 'Photo added')}</span> <button class="btn ghost sm" type="button" id="lm-photo-x">Remove</button></div>` : '<input class="in" type="file" id="lm-photo" accept="image/*" aria-label="Photo of your watch or phone screen">'}</div>`;
    const oneEach = '<p class="muted small" id="lm-one">One at a time. Save, then Log another.</p>';
    app.innerHTML = `<div class="head"><div><h1>Log activity</h1><p class="muted">Non-erg workouts only.</p></div></div>
      <form class="card logfor" id="logmine" novalidate>
        ${PHOTO_FIRST ? photoBlock : ''}${oneEach}
        <label class="f">Activity<select class="in" data-f="activity">${ACTIVITIES.map((a) => `<option${a === S.activity ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select></label>
        <div class="lf-row"><label class="f">Date<select class="in" data-f="date">${days.map((d, i) => `<option value="${d}"${d === S.date ? ' selected' : ''}>${i === 0 ? 'Today' : i === 1 ? 'Yesterday' : esc(fmtDay(d))}</option>`).join('')}</select></label>
</div>
        <div class="f" role="group" aria-label="Was it"><span>Was it</span><div class="seg fill" id="lm-type">${[['oyo', 'On my own'], ['practice', 'At practice'], ['makeup', 'Make up']].map(([k, l]) => `<button type="button" data-type="${k}" aria-pressed="${S.type === k}">${l}</button>`).join('')}</div>
          ${S.type === 'makeup' ? '<span class="muted small">Counts as that day\'s practice, marked Modified.</span>' : ''}</div>
        <div class="lf-row">${field(NO_DISTANCE.includes(S.activity) ? 'Distance (optional)' : 'Distance', 'dist', 'inputmode="decimal" placeholder="' + (NO_DISTANCE.includes(S.activity) ? 'leave blank' : '3.1') + '"')}
          <label class="f">Unit<select class="in" data-f="unit">${Object.entries(UNITS).map(([k, [n]]) => `<option value="${k}"${k === S.unit ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
          ${field('Time (min:sec)', 'time', 'inputmode="numeric" placeholder="25:30"')}</div>
        <p class="muted small" id="lm-pace">${esc(paceText(parseDuration(S.time), meters()) || 'Pace appears with distance and time.')}</p>
        ${field('Note for coaches (optional)', 'note')}
        ${PHOTO_FIRST ? '' : photoBlock}
        ${S.err ? `<p class="error" role="alert">${esc(S.err)}</p>` : ''}${S.msg ? `<p class="notice" role="status">${esc(S.msg)}</p>` : ''}${S.ask ? `<div class="notice" role="alert"><p>${esc(S.ask)}</p><div class="actions"><button class="btn ghost" type="button" id="lm-fix">Fix it</button> <button class="btn" type="button" id="lm-anyway">It is right, save it</button></div></div>` : ''}
        <div class="actions"><button class="btn" type="submit"${S.busy ? ' disabled' : ''}>${S.busy ? 'Saving…' : 'Save'}</button></div></form>`;
    const f = app.querySelector('#logmine');
    f.querySelectorAll('[data-f]').forEach((el) => {
      el.oninput = (ev) => { if (el.dataset.f === 'time') { if (ev.data === ':') S.colon = true; if (!el.value) S.colon = false; const v = S.colon ? el.value : autoClock(el.value.replace(/:/g, '')); if (v !== el.value) el.value = v; } S[el.dataset.f] = el.value; S.msg = S.err = S.ask = ''; S.confirmed = false; const p = app.querySelector('#lm-pace'); if (p && ['dist', 'time', 'unit'].includes(el.dataset.f)) p.textContent = paceText(parseDuration(S.time), meters()) || 'Pace appears with distance and time.'; };
      if (el.tagName === 'SELECT') el.onchange = () => { S[el.dataset.f] = el.value; if (el.dataset.f === 'activity') draw(); };
    });
    f.querySelectorAll('#lm-type button').forEach((b) => { b.onclick = () => { S.type = b.dataset.type; S.msg = S.err = ''; draw(); }; });
    const pick = f.querySelector('#lm-photo');
    if (pick) pick.onchange = async () => {
      const file = pick.files && pick.files[0];
      if (!file) return;
      try { S.photo = await shrinkPhoto(file); S.photoName = file.name; S.err = ''; } catch { S.err = 'That photo could not be read. Try another one.'; }
      if (PHOTO_FIRST && S.photo) {
        S.msg = 'Reading your photo…'; draw();
        try {
          const res = await fetch('/api/run-photo', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ photo: S.photo }) });
          const out = await res.json().catch(() => ({}));
          if (res.status === 401) { signedOut(); return; }
          if (out.status === 'read') { Object.assign(S, { dist: out.dist || S.dist, unit: out.unit || S.unit, time: out.time || S.time }); S.msg = 'Read from your photo. Check the numbers, then save.'; }
          else { S.msg = ''; S.err = 'Could not read the numbers. Type them in.'; }
        } catch { S.msg = ''; S.err = 'Could not read the photo. Type the numbers in.'; }
      }
      draw();
    };
    const fix = f.querySelector('#lm-fix');
    if (fix) fix.onclick = () => { S.ask = ''; S.confirmed = false; draw(); const t = app.querySelector('[data-f="time"]'); if (t) t.focus(); };
    const anyway = f.querySelector('#lm-anyway');
    if (anyway) anyway.onclick = () => { S.confirmed = true; S.ask = ''; f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true })); };
    const drop = f.querySelector('#lm-photo-x');
    if (drop) drop.onclick = () => { S.photo = ''; S.photoName = ''; draw(); };
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const sec = parseDuration(S.time), m = meters();
      const noDist = NO_DISTANCE.includes(S.activity) && !String(S.dist).trim();
      if (!m && !noDist) { S.err = 'Type your distance.'; draw(); return; }
      if (!sec) { S.err = 'Type your time like 25:30.'; draw(); return; }
      if (S.busy) return;
      S.busy = true; S.err = S.msg = ''; draw();
      const form = { date: S.date, type: S.type, activity: S.activity, pieces: `${clock(sec)}, ${m || 0}`, note: S.note.trim() };
      const pace = paceText(sec, m);
      try {
        const res = await fetch('/api/log-mine', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: S.rid, form, ...(S.confirmed ? { confirmed: true } : {}), ...(S.photo ? { photo: S.photo } : {}) }) });
        const out = await res.json().catch(() => ({}));
        if (res.status === 401) { signedOut(); return; }
        if (!res.ok) S.err = out.error || 'Nothing was saved.';
        else if (out.status === 'confirm') { S.ask = out.message || 'Check the time and distance.'; S.confirmed = false; }
        else if (out.status === 'already' || out.status === 'duplicate') {
          // A repeat of a workout already saved (David, 2026-11-22): a warning, not a second "Saved". The form stays as typed.
          S.err = `Already saved${out.savedAt ? ' at ' + out.savedAt : ''}. Not added again. Press Save once.`;
        } else {
          const when = S.date === days[0] ? 'today' : S.date === days[1] ? 'yesterday' : fmtDay(S.date);
          const what = `${S.activity}${m ? ', ' + S.dist.trim() + ' ' + UNITS[S.unit][0] : ''}, ${S.time.trim()}, ${when}`;
          S.done = { what, pace, already: false, savedAt: '', photo: out.photo === 'failed' ? 'The photo could not be saved.' : out.photo ? 'Your photo was saved too.' : '' };
          Object.assign(S, { dist: '', time: '', note: '', photo: '', photoName: '', msg: '', ask: '', confirmed: false, rid: rid() });
        }
      } catch { S.err = 'Could not reach the site. Nothing was saved.'; }
      S.busy = false; draw();
    };
  };
  draw();
}
