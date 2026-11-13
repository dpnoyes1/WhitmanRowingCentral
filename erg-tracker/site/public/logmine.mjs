// Athlete "Log a run": a phone form for a run, ride, swim and so on, saved for herself only (David, 2026-11-12).
// Distance in miles, kilometers or meters; the site sends meters. Erg work is not logged here.
import { shrinkPhoto } from './photo.mjs';

const ACTIVITIES = ['Run', 'Bike', 'Stair stepper', 'Swim', 'Elliptical'];
const UNITS = { mi: ['miles', 1609.344], km: ['kilometers', 1000], m: ['meters', 1] };

export function paceText(timeS, meters) {
  if (!(timeS > 0) || !(meters > 0)) return '';
  const per = (m) => { const s = Math.round(timeS / meters * m); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  return `Pace ${per(1609.344)} per mile, ${per(1000)} per km.`;
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
  const S = { activity: 'Run', date: days[0], type: 'oyo', dist: '', unit: 'mi', time: '', rpe: '', note: '', photo: '', photoName: '', msg: '', err: '', busy: false, rid: rid() };
  const meters = () => { const n = Number(String(S.dist).replace(',', '.')); return n > 0 ? Math.round(n * UNITS[S.unit][1]) : 0; };
  const field = (label, k, extra = '') => `<label class="f">${label}<input class="in" data-f="${k}" value="${esc(S[k])}" autocomplete="off" ${extra}></label>`;
  const draw = () => {
    app.innerHTML = `<div class="head"><div><h1>Log a run</h1><p class="muted">Non-erg workouts. Erg comes via Concept2, Slack or the Form.</p></div></div>
      <form class="card logfor" id="logmine" novalidate>
        <label class="f">Activity<select class="in" data-f="activity">${ACTIVITIES.map((a) => `<option${a === S.activity ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select></label>
        <div class="lf-row"><label class="f">Date<select class="in" data-f="date">${days.map((d, i) => `<option value="${d}"${d === S.date ? ' selected' : ''}>${i === 0 ? 'Today' : i === 1 ? 'Yesterday' : esc(fmtDay(d))}</option>`).join('')}</select></label>
          <label class="f">Was it<select class="in" data-f="type"><option value="oyo"${S.type === 'oyo' ? ' selected' : ''}>On my own</option><option value="practice"${S.type === 'practice' ? ' selected' : ''}>At practice</option></select></label></div>
        <div class="lf-row">${field('Distance', 'dist', 'inputmode="decimal" placeholder="3.1"')}
          <label class="f">Unit<select class="in" data-f="unit">${Object.entries(UNITS).map(([k, [n]]) => `<option value="${k}"${k === S.unit ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
          ${field('Time (min:sec)', 'time', 'inputmode="numeric" placeholder="25:30"')}</div>
        <p class="muted small" id="lm-pace">${esc(paceText(parseDuration(S.time), meters()) || 'Pace appears with distance and time.')}</p>
        ${field('Effort 1 to 10 (optional)', 'rpe', 'inputmode="numeric"')}
        ${field('Note for coaches (optional)', 'note')}
        <div class="f"><span>Photo of your watch or phone screen (optional)</span>${S.photo ? `<div class="lf-row"><span class="pill">${esc(S.photoName || 'Photo added')}</span> <button class="btn ghost sm" type="button" id="lm-photo-x">Remove</button></div>` : '<input class="in" type="file" id="lm-photo" accept="image/*" aria-label="Photo of your watch or phone screen">'}
          <span class="muted small">Kept as a small private copy, with location data removed.</span></div>
        ${S.err ? `<p class="error" role="alert">${esc(S.err)}</p>` : ''}${S.msg ? `<p class="notice" role="status">${esc(S.msg)}</p>` : ''}
        <div class="actions"><button class="btn" type="submit"${S.busy ? ' disabled' : ''}>${S.busy ? 'Saving…' : 'Save'}</button></div></form>`;
    const f = app.querySelector('#logmine');
    f.querySelectorAll('[data-f]').forEach((el) => {
      el.oninput = () => { S[el.dataset.f] = el.value; S.msg = S.err = ''; const p = app.querySelector('#lm-pace'); if (p && ['dist', 'time', 'unit'].includes(el.dataset.f)) p.textContent = paceText(parseDuration(S.time), meters()) || 'Pace appears with distance and time.'; };
      if (el.tagName === 'SELECT') el.onchange = () => { S[el.dataset.f] = el.value; };
    });
    const pick = f.querySelector('#lm-photo');
    if (pick) pick.onchange = async () => {
      const file = pick.files && pick.files[0];
      if (!file) return;
      try { S.photo = await shrinkPhoto(file); S.photoName = file.name; S.err = ''; } catch { S.err = 'That photo could not be read. Try another one.'; }
      draw();
    };
    const drop = f.querySelector('#lm-photo-x');
    if (drop) drop.onclick = () => { S.photo = ''; S.photoName = ''; draw(); };
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const sec = parseDuration(S.time), m = meters();
      if (!m) { S.err = 'Type your distance.'; draw(); return; }
      if (!sec) { S.err = 'Type your time like 25:30.'; draw(); return; }
      if (S.rpe && !/^(10|[1-9])$/.test(S.rpe.trim())) { S.err = 'Effort is a number from 1 to 10, or leave it blank.'; draw(); return; }
      S.busy = true; S.err = S.msg = ''; draw();
      const form = { date: S.date, type: S.type, activity: S.activity, pieces: `${clock(sec)}, ${m}`, rpe: S.rpe.trim(), note: S.note.trim() };
      const pace = paceText(sec, m);
      try {
        const res = await fetch('/api/log-mine', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: S.rid, form, ...(S.photo ? { photo: S.photo } : {}) }) });
        const out = await res.json().catch(() => ({}));
        if (res.status === 401) { signedOut(); return; }
        if (!res.ok) S.err = out.error || 'Nothing was saved.';
        else {
          S.msg = `Saved${out.photo === 'failed' ? ', but the photo could not be saved' : out.photo ? ' with your photo' : ''}. ${pace}`.trim();
          Object.assign(S, { dist: '', time: '', rpe: '', note: '', photo: '', photoName: '', rid: rid() });
        }
      } catch { S.err = 'Could not reach the site. Nothing was saved.'; }
      S.busy = false; draw();
    };
  };
  draw();
}
