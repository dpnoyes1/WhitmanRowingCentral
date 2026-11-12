// Coach workout builder: build a workout, pick dates, squad and session, save to the Sheet's Workouts and
// Schedule tabs. New sessions are drafts unless Publish is ticked. Coaches only (the API refuses athletes).
export function openPlan(v, ctx) {
  const { app, esc, fmtDate } = ctx;
  let data = v, msg = '', err = '';
  let mode = 'new';
  let piece = () => ({ workType: 'Time', reps: '1', work: '', rest: '', startEvery: '', zone: '', base: '', lowPct: '', highPct: '', rate: '' });
  let form = { name: '', pieces: [piece()], dates: [], squad: 'All', session: 'Practice', publish: false, workoutId: data.library[0] ? data.library[0].id : '' };

  const opt = (list, cur) => list.map((o) => `<option value="${esc(o)}"${o === cur ? ' selected' : ''}>${esc(o || 'None')}</option>`).join('');
  const pieceHtml = (p, i) => `<div class="card" data-piece="${i}"><div class="lu-head"><h2>Piece ${i + 1}</h2>${form.pieces.length > 1 ? `<button class="btn ghost sm" type="button" data-rm="${i}">Remove</button>` : ''}</div>
    <div class="lf-row">
      <label class="f">Work type<select class="in" data-k="workType">${opt(['Time', 'Distance'], p.workType)}</select></label>
      <label class="f">Reps<input class="in" data-k="reps" inputmode="numeric" value="${esc(p.reps)}"></label>
      <label class="f">${p.workType === 'Time' ? 'Work time (m:ss)' : 'Work meters'}<input class="in" data-k="work" inputmode="${p.workType === 'Time' ? 'text' : 'numeric'}" placeholder="${p.workType === 'Time' ? '20:00' : '500'}" value="${esc(p.work)}"></label>
    </div><div class="lf-row">
      <label class="f">Rest (m:ss)<input class="in" data-k="rest" placeholder="2:00" value="${esc(p.rest)}"></label>
      <label class="f">Or start every<input class="in" data-k="startEvery" placeholder="3:30" value="${esc(p.startEvery)}"></label>
      <label class="f">Rate<input class="in" data-k="rate" placeholder="18-20" value="${esc(p.rate)}"></label>
    </div><div class="lf-row">
      <label class="f">Zone<select class="in" data-k="zone">${opt(['', 'Aerobic', 'Threshold', 'Anaerobic'], p.zone)}</select></label>
      <label class="f">Target based on<select class="in" data-k="base">${opt(['', '2k', "20'"], p.base)}</select></label>
      <label class="f">Target low %<input class="in" data-k="lowPct" inputmode="numeric" value="${esc(p.lowPct)}"></label>
      <label class="f">Target high %<input class="in" data-k="highPct" inputmode="numeric" value="${esc(p.highPct)}"></label>
    </div><p class="muted small">Leave the target % blank to use the zone's default from Settings.</p></div>`;

  const when = () => `<div class="card"><div class="lu-head"><h2>When</h2></div>
    <div class="lf-row">
      <label class="f">Add a date<input class="in" id="pl-date" type="date" min="${esc(data.today)}"></label>
      <label class="f">Squad<select class="in" data-f="squad">${opt(['All', 'Varsity', 'Novice'], form.squad)}</select></label>
      <label class="f">Session<select class="in" data-f="session">${opt(['Practice', 'OYO'], form.session)}</select></label>
    </div>
    <div class="lu-actions">${form.dates.map((d, i) => `<button class="btn ghost sm" type="button" data-undate="${i}" aria-label="Remove ${esc(d)}">${esc(fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' }))} ✕</button>`).join('') || '<span class="muted small">No dates yet. A new workout with no dates is saved to the library only.</span>'}</div>
    <label class="small"><input type="checkbox" data-f="publish"${form.publish ? ' checked' : ''}> Publish now so athletes see it. Unticked sessions are drafts only coaches see in the Sheet.</label></div>`;

  const upcoming = () => `<div class="card"><div class="lu-head"><h2>Next 4 weeks</h2></div>${data.upcoming.length ? `<div class="table-wrap"><table>
    <tr><th>Date</th><th>Squad</th><th>Session</th><th>Workout</th><th>Status</th></tr>
    ${data.upcoming.map((u) => `<tr><td>${esc(fmtDate(u.day, { weekday: 'short', month: 'short', day: 'numeric' }))}</td><td>${esc(u.squad)}</td><td>${esc(u.session)}</td><td>${esc(u.name || u.workoutId)}</td><td><span class="pill ${u.published ? '' : 'warn'}">${u.published ? 'Published' : 'Draft'}</span></td></tr>`).join('')}</table></div>` : '<p class="muted">Nothing scheduled in the next 4 weeks.</p>'}
    <p class="muted small">Draft sessions are published by ticking Published on the Schedule tab in the Sheet.</p></div>`;

  const draw = () => {
    app.innerHTML = `<div class="head"><div><h1>Plan</h1><p class="muted">Coaches only. Build a workout and put it on the calendar. Targets for each rower come from her best 2k or 20' and the zone or % you set.</p></div></div>
      ${msg ? `<p class="notice" role="status">${esc(msg)}</p>` : ''}${err ? `<p class="notice warn" role="alert">${esc(err)}</p>` : ''}
      ${upcoming()}
      <div class="lu-actions" role="group" aria-label="What to do"><button class="btn${mode === 'new' ? '' : ' ghost'}" type="button" data-mode="new">New workout</button><button class="btn${mode === 'old' ? '' : ' ghost'}" type="button" data-mode="old"${data.library.length ? '' : ' disabled'}>Schedule a saved workout</button></div>
      <div class="logfor">${mode === 'new' ? `<label class="f">Workout name<input class="in" id="pl-name" maxlength="60" placeholder="3 x 20:00" value="${esc(form.name)}"></label>
        ${form.pieces.map(pieceHtml).join('')}
        <div><button class="btn ghost" type="button" id="pl-add"${form.pieces.length >= 12 ? ' disabled' : ''}>Add a piece</button></div>`
      : `<label class="f">Saved workout<select class="in" data-f="workoutId">${data.library.map((w) => `<option value="${esc(w.id)}"${w.id === form.workoutId ? ' selected' : ''}>${esc(w.name)}${w.summary ? ' · ' + esc(w.summary) : ''}</option>`).join('')}</select></label>`}
        ${when()}
        <div><button class="btn" type="button" id="pl-save">${mode === 'new' ? 'Save workout' : 'Schedule it'}</button></div></div>`;
    app.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => { mode = b.dataset.mode; msg = err = ''; draw(); }; });
    const name = app.querySelector('#pl-name');
    if (name) name.oninput = () => { form.name = name.value; };
    app.querySelectorAll('[data-piece]').forEach((el) => {
      const i = Number(el.dataset.piece);
      el.querySelectorAll('[data-k]').forEach((inp) => {
        inp.onchange = () => { form.pieces[i][inp.dataset.k] = inp.value; if (inp.dataset.k === 'workType') draw(); };
        inp.oninput = () => { form.pieces[i][inp.dataset.k] = inp.value; };
      });
    });
    app.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { form.pieces.splice(Number(b.dataset.rm), 1); draw(); }; });
    const add = app.querySelector('#pl-add');
    if (add) add.onclick = () => { const last = form.pieces[form.pieces.length - 1]; form.pieces.push({ ...piece(), workType: last.workType }); draw(); };
    app.querySelectorAll('[data-f]').forEach((inp) => {
      inp.onchange = () => { form[inp.dataset.f] = inp.type === 'checkbox' ? inp.checked : inp.value; };
    });
    app.querySelectorAll('[data-undate]').forEach((b) => { b.onclick = () => { form.dates.splice(Number(b.dataset.undate), 1); draw(); }; });
    app.querySelector('#pl-date').onchange = (e) => {
      const d = e.target.value;
      if (d && !form.dates.includes(d)) { form.dates.push(d); form.dates.sort(); }
      draw();
    };
    app.querySelector('#pl-save').onclick = save;
  };

  const save = async (e) => {
    const btn = e.currentTarget;
    err = msg = '';
    const body = { dates: form.dates, squad: form.squad, session: form.session, publish: form.publish };
    if (mode === 'new') { body.name = form.name; body.pieces = form.pieces; } else {
      body.workoutId = form.workoutId;
      if (!form.dates.length) { err = 'Pick at least one date.'; draw(); return; }
    }
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const res = await fetch('/api/workouts', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (res.status === 401) { ctx.signedOut(); return; }
      if (!res.ok) { err = out.error || 'Nothing was saved.'; draw(); return; }
      data = out;
      msg = mode === 'new' ? `Saved as ${out.savedId}${form.dates.length ? ` and scheduled on ${form.dates.length} date${form.dates.length > 1 ? 's' : ''}${form.publish ? '' : ' as a draft'}` : ' in the library'}.` : `Scheduled${form.publish ? '' : ' as a draft'}.`;
      form = { ...form, name: '', pieces: [piece()], dates: [], workoutId: out.savedId || form.workoutId };
    } catch { err = 'Could not reach the site. Check the list above before saving again.'; }
    draw();
  };
  draw();
}
