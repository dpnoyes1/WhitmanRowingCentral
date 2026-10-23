// Whitman Rowing team site. Plain JS, hash routes:
// #/team, #/athletes, #/athlete/A001, #/me, #/pick
// Data comes from /api/* behind the team password (an HttpOnly cookie).
// The athlete picked on this device is remembered in localStorage.

const app = document.getElementById('app');
const tip = document.getElementById('tip');
const ME_KEY = 'wrc.me';
const SQUAD_KEY = 'wrc.squad';
const TEST_LABELS = { '2000m': '2k', '20min': "20'", '500m': '500m', '100m': '100m', '30r20': '30r20' };

// ---- small helpers -------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } }
};
const fmtNum = (n) => (n === null || n === undefined ? '–' : Math.round(n).toLocaleString('en-US'));
const fmtMin = (m) => {
  if (m === null || m === undefined) return '–';
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return h ? `${h}h ${String(r).padStart(2, '0')}m` : `${r}m`;
};
const fmtTime = (s) => {
  if (s === null || s === undefined || s === '') return '';
  const t = Math.round(s * 10) / 10, m = Math.floor(t / 60), sec = t - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
};
const fmtDate = (d, opts = { month: 'short', day: 'numeric' }) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', opts);
const fmtDay = (d) => fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' });
const fmtResult = (r) => (r.test === '20min' || r.test === '30r20' ? `${fmtNum(r.meters)} m` : fmtTime(r.timeS));
const split = (r) => {
  const sec = r.test === '20min' ? 1200 : r.test === '30r20' ? 1800 : r.timeS;
  const meters = r.test === '20min' || r.test === '30r20' ? r.meters : Number(r.test.replace('m', ''));
  return sec && meters ? fmtTime((sec * 500) / meters) : '';
};

function me() {
  try { return JSON.parse(store.get(ME_KEY) || 'null'); } catch { return null; }
}

async function api(path) {
  const res = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  if (res.status === 401) { showLogin(); throw new Error('signin'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Something went wrong.');
  return body;
}

function setNav(active) {
  document.getElementById('nav').hidden = false;
  const m = me();
  document.getElementById('nav-me').textContent = m ? m.name.split(' ')[0] : 'Me';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === active));
}

function staleNote(meta) {
  if (!meta || !meta.stale) return '';
  return `<p class="notice">Showing data from ${new Date(meta.generatedAt).toLocaleString()}. The Sheet did not answer just now.</p>`;
}

function footer(meta) {
  if (!meta) return '';
  return `<p class="foot">Updated ${new Date(meta.generatedAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}. New logs show up within about 5 minutes.
    <button class="linkish" id="signout">Sign out</button></p>`;
}

function wireFooter() {
  const b = document.getElementById('signout');
  if (b) b.onclick = async () => { await fetch('/api/logout', { method: 'POST' }); store.set(ME_KEY, null); showLogin(); };
}

function showError(err) {
  if (err.message === 'signin') return;
  app.innerHTML = `<div class="card"><p class="error">${esc(err.message)}</p><button class="btn ghost" id="retry">Try again</button></div>`;
  document.getElementById('retry').onclick = () => location.reload();
}

// ---- tooltips --------------------------------------------------------------

function wireTips(root) {
  root.querySelectorAll('[data-tip]').forEach((el) => {
    const show = (ev) => {
      tip.innerHTML = el.dataset.tip;
      tip.hidden = false;
      const x = ev.clientX ?? el.getBoundingClientRect().left, y = ev.clientY ?? el.getBoundingClientRect().top;
      const w = tip.offsetWidth;
      tip.style.left = Math.min(Math.max(8, x - w / 2), window.innerWidth - w - 8) + 'px';
      tip.style.top = Math.max(8, y - tip.offsetHeight - 12) + 'px';
    };
    el.addEventListener('pointermove', show);
    el.addEventListener('pointerdown', show);
    el.addEventListener('pointerleave', () => { tip.hidden = true; });
  });
}

// ---- charts --------------------------------------------------------------

/** Stacked weekly bars: practice + OYO minutes. rows: [{ weekStart, practice, oyo }] */
function weeklyChart(rows, caption) {
  const narrow = window.innerWidth < 600;
  const W = narrow ? 380 : 640, H = narrow ? 200 : 220, padL = 34, padB = 26, padT = 10;
  const max = Math.max(60, ...rows.map((r) => r.practice + r.oyo));
  const step = max > 600 ? 240 : max > 240 ? 120 : 60;
  const top = Math.ceil(max / step) * step;
  const y = (v) => padT + (H - padT - padB) * (1 - v / top);
  const bw = (W - padL) / rows.length;
  const barW = Math.min(44, bw * 0.6);
  let grid = '';
  for (let v = 0; v <= top; v += step) {
    grid += `<line class="grid-line" x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>` +
      `<text class="axis" x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${v / 60}h</text>`;
  }
  const bars = rows.map((r, i) => {
    const x = padL + i * bw + (bw - barW) / 2;
    const p = r.practice, o = r.oyo;
    const yp = y(p), yo = y(p + o);
    const label = `<b>Week of ${fmtDate(r.weekStart)}</b><br>Practice ${fmtMin(p)}<br>OYO ${fmtMin(o)}<br>Total ${fmtMin(p + o)}`;
    const gap = o > 0 && p > 0 ? 2 : 0;
    return `<g data-tip="${esc(label)}">
      <rect x="${padL + i * bw}" y="${padT}" width="${bw}" height="${H - padT - padB}" fill="transparent"/>
      ${p > 0 ? `<rect x="${x}" y="${yp}" width="${barW}" height="${Math.max(0, y(0) - yp)}" fill="var(--series-1)" rx="${o > 0 ? 0 : 4}"/>` : ''}
      ${o > 0 ? `<rect x="${x}" y="${yo}" width="${barW}" height="${Math.max(0, yp - yo - gap)}" fill="var(--series-2)" rx="4"/>` : ''}
      <text class="axis" x="${padL + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${fmtDate(r.weekStart, { month: 'numeric', day: 'numeric' })}</text>
    </g>`;
  }).join('');
  const table = `<details class="small"><summary class="muted">Show as a table</summary><div class="table-wrap"><table>
    <tr><th>Week of</th><th class="r">Practice</th><th class="r">OYO</th><th class="r">Total</th></tr>
    ${rows.map((r) => `<tr><td>${fmtDate(r.weekStart)}</td><td class="r">${fmtMin(r.practice)}</td><td class="r">${fmtMin(r.oyo)}</td><td class="r">${fmtMin(r.practice + r.oyo)}</td></tr>`).join('')}
  </table></div></details>`;
  return `<div class="chart">
    <div class="legend"><span><i style="background:var(--series-1)"></i>Practice</span><span><i style="background:var(--series-2)"></i>OYO</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(caption)}">${grid}${bars}</svg>${table}</div>`;
}

/** One 100% bar of minutes by zone, easy (UT2) to hard (AN). */
function zoneBar(z) {
  const zones = ['UT2', 'UT1', 'AT', 'AN'];
  const total = zones.reduce((s, k) => s + (z[k] || 0), 0);
  if (!total) return '<p class="muted">No sessions logged yet.</p>';
  const seg = zones.map((k, i) => {
    const share = (100 * (z[k] || 0)) / total;
    return share > 0 ? `<div style="flex:${share};background:var(--seq-${i + 1})" data-tip="${k}: ${fmtMin(z[k])} (${Math.round(share)}%)"></div>` : '';
  }).join('');
  const key = zones.map((k, i) => `<div><span class="legend"><span><i style="background:var(--seq-${i + 1})"></i>${k}</span></span>
    <b>${Math.round((100 * (z[k] || 0)) / total)}%</b><span class="muted">${fmtMin(z[k] || 0)}</span></div>`).join('');
  return `<div class="stack" role="img" aria-label="Minutes by training zone">${seg}</div><div class="zones-key">${key}</div>`;
}

function tile(label, value, sub = '') {
  return `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
}

// ---- pages ---------------------------------------------------------------

function showLogin() {
  document.getElementById('nav').hidden = true;
  app.innerHTML = `<div class="login card">
    <h1>Whitman Rowing</h1>
    <p class="muted">Enter the team password from your coach.</p>
    <form id="login">
      <label for="pw" class="small">Team password</label>
      <input id="pw" type="password" autocomplete="current-password" required>
      <button class="btn" type="submit">Sign in</button>
      <p id="login-err" class="error small" role="alert"></p>
    </form></div>`;
  document.getElementById('login').onsubmit = async (ev) => {
    ev.preventDefault();
    const err = document.getElementById('login-err');
    err.textContent = '';
    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('pw').value })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { err.textContent = body.error || 'Could not sign in.'; return; }
    location.hash = me() ? '#/me' : '#/pick';
    route();
  };
}

async function showPick() {
  const t = await api('/api/team');
  setNav('me');
  const bySquad = {};
  t.athletes.forEach((a) => { (bySquad[a.squad || 'Team'] = bySquad[a.squad || 'Team'] || []).push(a); });
  app.innerHTML = `<div class="head"><div><h1>Who are you?</h1>
    <p class="muted">Pick your name so this device opens your page. You can change it any time.</p></div></div>
    ${Object.keys(bySquad).sort((a, b) => (a === 'Varsity' ? -1 : b === 'Varsity' ? 1 : a.localeCompare(b))).map((sq) => `
      <div class="card"><h2>${esc(sq)}</h2><div class="pick">
        ${bySquad[sq].map((a) => `<button data-id="${esc(a.id)}" data-name="${esc(a.name)}"><span>${esc(a.name)}</span><span class="pill">${esc(a.grade)}</span></button>`).join('')}
      </div></div>`).join('')}
    <p><button class="btn ghost" id="skip">I'm a coach or just looking</button></p>${footer(t.meta)}`;
  app.querySelectorAll('.pick button').forEach((b) => {
    b.onclick = () => { store.set(ME_KEY, JSON.stringify({ id: b.dataset.id, name: b.dataset.name })); location.hash = '#/me'; };
  });
  document.getElementById('skip').onclick = () => { store.set(ME_KEY, null); location.hash = '#/team'; };
  wireFooter();
}

async function showTeam() {
  const t = await api('/api/team');
  setNav('team');
  let squad = store.get(SQUAD_KEY) || 'all';
  const render = () => {
    const g = t.groups[squad];
    const w = g.week;
    app.innerHTML = `${staleNote(t.meta)}
      <div class="head"><div><h1>Team</h1><p class="muted">Week of ${fmtDate(t.weekStart)} · ${g.rowers} rowers</p></div>
        <div class="seg" role="group" aria-label="Squad">${['all', 'varsity', 'novice'].map((k) =>
          `<button data-sq="${k}" aria-pressed="${k === squad}">${k === 'all' ? 'All' : k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div></div>
      <div class="grid">
        ${tile('Practice completion', w.completionPct === null ? '–' : w.completionPct + '%', `${w.practicesDone} of ${w.practicesExpected} this week`)}
        ${tile('Season completion', g.season.completionPct === null ? '–' : g.season.completionPct + '%', 'since Aug 1')}
        ${tile('Training this week', fmtMin(w.avgPerRower), 'average per rower')}
        ${tile('OYO goal met', `${w.oyoMetRequired}/${g.rowers}`, `${w.oyoElite} at Elite · ${w.oyoLogged} logged OYO`)}
      </div>
      <div class="card"><h2>Weekly training (average per rower, weighted minutes)</h2>
        ${weeklyChart(g.weekly.map((r) => ({ weekStart: r.weekStart, practice: r.practiceAvg, oyo: r.oyoAvg })), 'Weekly training minutes per rower')}</div>
      <div class="two">
        <div class="card"><h2>Intensity, last 4 weeks</h2>${zoneBar(g.zones)}</div>
        <div class="card"><h2>Latest logs</h2>${recentList(t)}</div>
      </div>${footer(t.meta)}`;
    app.querySelectorAll('[data-sq]').forEach((b) => { b.onclick = () => { squad = b.dataset.sq; store.set(SQUAD_KEY, squad); render(); }; });
    wireTips(app);
    wireFooter();
  };
  render();
}

function recentList(t) {
  const names = Object.fromEntries(t.athletes.map((a) => [a.id, a.name]));
  if (!t.recent.length) return '<p class="muted">Nothing logged yet.</p>';
  return `<div class="table-wrap"><table>${t.recent.map((r) => `<tr>
    <td>${fmtDate(r.date)}</td><td><a href="#/athlete/${esc(r.athleteId)}">${esc(names[r.athleteId] || '')}</a></td>
    <td class="muted">${esc(r.test ? r.mainSet : r.type)}${r.activity && r.activity !== 'Erg (RowErg)' ? ' · ' + esc(r.activity) : ''}</td>
    <td class="r">${fmtMin(r.minutes)}</td></tr>`).join('')}</table></div>`;
}

async function showAthletes() {
  const t = await api('/api/team');
  setNav('athletes');
  const mine = me();
  app.innerHTML = `<div class="head"><div><h1>Athletes</h1><p class="muted">${t.athletes.length} rowers</p></div>
    <div style="min-width:220px"><input type="search" id="q" placeholder="Find a name" aria-label="Find a name"></div></div>
    ${['Varsity', 'Novice'].map((sq) => `<div class="card" data-squad><h2>${sq}</h2><div class="athletes">
      ${t.athletes.filter((a) => a.squad === sq).map((a) => `<a href="#/athlete/${esc(a.id)}" data-name="${esc(a.name.toLowerCase())}">
        <span>${esc(a.name)}${mine && mine.id === a.id ? ' (you)' : ''}</span><span class="pill">${esc(a.grade)}</span></a>`).join('')}
    </div></div>`).join('')}${footer(t.meta)}`;
  document.getElementById('q').oninput = (ev) => {
    const q = ev.target.value.trim().toLowerCase();
    app.querySelectorAll('.athletes a').forEach((a) => { a.hidden = q && !a.dataset.name.includes(q); });
  };
  wireFooter();
}

async function showAthlete(id) {
  const v = await api('/api/athlete/' + encodeURIComponent(id));
  const a = v.athlete, w = v.week, s = v.season;
  const mine = me();
  setNav(mine && mine.id === id ? 'me' : 'athletes');
  const oyoMax = Math.max(a.oyoElite * 1.15, w.oyoMin);
  const oyoText = { elite: 'Elite reached', required: 'Required met', short: `${fmtMin(Math.max(0, a.oyoRequired - w.oyoMin))} to Required` }[w.oyoStatus];
  const makeups = v.openMakeups.length ? `<div class="card"><h2>Make-ups open</h2><ul>
      ${v.openMakeups.map((m) => `<li>Missed ${fmtDay(m.date)}: make it up by <b>${fmtDay(m.makeUpBy)}</b></li>`).join('')}</ul>
      <p class="muted small">Log it on the form as "Make-up for a missed practice" with the date you missed.</p></div>` : '';
  app.innerHTML = `${staleNote(v.meta)}
    <div class="head"><div><h1>${esc(a.name)}</h1><p class="muted">${esc(a.squad)} · ${esc(a.grade)} · OYO ${esc(a.oyoGroup)}${a.active ? '' : ' · inactive'}</p></div>
      ${mine && mine.id === id ? '<a href="#/pick" class="small">Not you?</a>' : !mine ? `<button class="btn ghost" id="this-is-me">This is me</button>` : ''}</div>
    <div class="grid">
      ${tile('Practices this week', `${w.practicesDone}/${w.practicesExpected}`, fmtMin(w.practiceMin) + ' weighted')}
      ${tile('Season completion', s.completionPct === null ? '–' : s.completionPct + '%', `${s.practicesDone} of ${s.practicesExpected}${s.makeupsDone ? ` · ${s.makeupsDone} make-up${s.makeupsDone > 1 ? 's' : ''}` : ''}`)}
      ${tile('Practice streak', v.streaks.practices, 'in a row')}
      ${tile('OYO goal streak', v.streaks.oyoWeeks, v.streaks.oyoWeeks === 1 ? 'week' : 'weeks in a row')}
      ${tile('Season training', fmtMin(s.trainingMin), fmtNum(s.meters) + ' m')}
    </div>
    <div class="card"><h2>OYO this week: ${fmtMin(w.oyoMin)} <span class="pill ${w.oyoStatus === 'short' ? '' : 'good'}">${oyoText}</span></h2>
      <div class="meter" role="img" aria-label="OYO ${Math.round(w.oyoMin)} of ${a.oyoRequired} required, ${a.oyoElite} elite">
        <div class="fill" style="width:${Math.min(100, (100 * w.oyoMin) / oyoMax)}%"></div>
        <div class="mark" style="left:${(100 * a.oyoRequired) / oyoMax}%"><span>Required ${a.oyoRequired}m</span></div>
        <div class="mark" style="left:${(100 * a.oyoElite) / oyoMax}%"><span>Elite ${a.oyoElite}m</span></div>
      </div></div>
    ${makeups}
    <div class="card"><h2>Best results</h2>${bestsTable(v)}</div>
    <div class="card"><h2>Weekly training (weighted minutes)</h2>${weeklyChart(v.weekly, 'Weekly training minutes')}</div>
    <div class="two">
      <div class="card"><h2>Intensity, last 4 weeks</h2>${zoneBar(v.zones)}</div>
      <div class="card"><h2>Last 10 practices</h2><div class="dots">
        ${v.recentPractices.slice().reverse().map((r) => `<span class="dot ${r.how === 'Make-up' ? 'mu' : r.done ? 'done' : ''}"
          data-tip="${esc(fmtDay(r.date) + ': ' + (r.how === 'Make-up' ? 'made up ' + fmtDate(r.makeupDate) : r.how))}">${new Date(r.date + 'T12:00:00').getDate()}</span>`).join('')}
      </div><p class="muted small">Filled: done. Ring: made up. Empty: missed.</p></div>
    </div>
    <div class="card"><h2>Tests</h2>${testsTable(v.tests)}</div>
    <div class="card"><h2>Recent sessions</h2>${sessionsTable(v.sessions)}</div>${footer(v.meta)}`;
  const claim = document.getElementById('this-is-me');
  if (claim) claim.onclick = () => { store.set(ME_KEY, JSON.stringify({ id: a.id, name: a.name })); showAthlete(id); };
  wireTips(app);
  wireFooter();
}

function bestsTable(v) {
  if (!v.bests.length) return '<p class="muted">No tests yet.</p>';
  return `<div class="table-wrap"><table><tr><th>Test</th><th class="r">This season</th><th class="r">Split</th><th class="r">All time</th><th>Date</th></tr>
    ${v.bests.map((b) => `<tr><td>${TEST_LABELS[b.test]}</td>
      <td class="r">${b.season ? fmtResult(b.season) : '–'}</td><td class="r">${b.season ? split(b.season) : ''}</td>
      <td class="r">${fmtResult(b.allTime)}</td><td>${fmtDate(b.allTime.date, { month: 'short', day: 'numeric', year: 'numeric' })}</td></tr>`).join('')}
  </table></div>`;
}

function testsTable(tests) {
  if (!tests.length) return '<p class="muted">No tests yet.</p>';
  return `<div class="table-wrap"><table><tr><th>Date</th><th>Test</th><th class="r">Result</th><th class="r">Split</th><th class="r">Rate</th><th></th></tr>
    ${tests.map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${TEST_LABELS[r.test]}</td><td class="r">${fmtResult(r)}</td>
      <td class="r">${split(r)}</td><td class="r">${r.avgRate ?? ''}</td>
      <td>${r.valid ? '' : '<span class="pill bad">rate over 20</span>'}</td></tr>`).join('')}
  </table></div>`;
}

function sessionsTable(rows) {
  if (!rows.length) return '<p class="muted">Nothing logged yet.</p>';
  return `<div class="table-wrap"><table><tr><th>Date</th><th>Type</th><th>Activity</th><th>Main set</th><th>Zone</th><th class="r">Minutes</th><th class="r">Weighted</th><th class="r">Meters</th><th class="r">RPE</th></tr>
    ${rows.map((r) => `<tr><td>${fmtDate(r.date)}</td>
      <td>${esc(r.type)}${r.status && r.status !== 'Full' ? ` <span class="pill">${esc(r.status)}</span>` : ''}${r.makeupFor ? ` <span class="muted small">for ${fmtDate(r.makeupFor)}</span>` : ''}</td>
      <td>${esc(r.activity)}</td><td>${esc(r.mainSet)}</td><td>${esc(r.zone)}</td>
      <td class="r">${r.status === 'Out' ? '' : fmtMin(r.minutes)}</td><td class="r">${r.status === 'Out' ? '' : fmtMin(r.weighted)}</td>
      <td class="r">${r.meters ? fmtNum(r.meters) : ''}</td><td class="r">${r.rpe ?? ''}</td></tr>`).join('')}
  </table></div>`;
}

// ---- router --------------------------------------------------------------

async function route() {
  tip.hidden = true;
  const h = location.hash.replace(/^#\/?/, '');
  const [page, arg] = h.split('/');
  try {
    if (page === 'team') return await showTeam();
    if (page === 'athletes') return await showAthletes();
    if (page === 'athlete' && arg) return await showAthlete(decodeURIComponent(arg));
    if (page === 'pick') return await showPick();
    const m = me();
    if (page === 'me') return m ? await showAthlete(m.id) : await showPick();
    location.replace(m ? '#/me' : '#/pick');
  } catch (err) {
    showError(err);
  }
}

window.addEventListener('hashchange', route);
route();
