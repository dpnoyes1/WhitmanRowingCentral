// Whitman Rowing team site. Plain JS, hash routes:
// #/team, #/week, #/boards, #/stars, #/oyo, #/athletes, #/athlete/A001, #/me
// Data comes from /api/* behind a sign-in (an HttpOnly cookie). Athletes sign
// in as themselves (name + birthday); coaches with the coach password.

const app = document.getElementById('app');
const tip = document.getElementById('tip');
const OLD_ME_KEY = 'wrc.me';   // the old "pick your name" choice, cleared on sign-in
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

let SESSION = null;   // { kind: 'athlete' | 'team', athlete: { id, name, squad } | null }

/** The signed-in athlete, or null for a coach. */
function me() {
  return SESSION && SESSION.athlete;
}

async function signOut() {
  await fetch('/api/logout', { method: 'POST' });
  SESSION = null;
  showLogin();
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
  const link = document.getElementById('nav-me');
  link.hidden = !m;
  if (m) link.textContent = m.name.split(' ')[0];
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
  if (b) b.onclick = signOut;
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
    <p class="muted">Sign in with your first and last name and the password from your coach.</p>
    <form id="login">
      <label for="name" class="small">Name</label>
      <input id="name" autocomplete="username" autocapitalize="words" spellcheck="false">
      <label for="pw" class="small">Password</label>
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
      body: JSON.stringify({ name: document.getElementById('name').value, password: document.getElementById('pw').value })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { err.textContent = body.error || 'Could not sign in.'; return; }
    store.set(OLD_ME_KEY, null);
    SESSION = null;
    location.hash = '#/';
    route();
  };
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
      ${v.own ? '<button class="linkish small" id="not-you">Not you? Sign out</button>' : ''}</div>
    ${v.own || v.coach ? todayCard(v.todayPlan, v.own ? null : id) : ''}
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
    ${v.own || v.coach ? gmsCard(v.gms, v.coach) : starsLine(v.gms)}
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
  const notYou = document.getElementById('not-you');
  if (notYou) notYou.onclick = signOut;
  wireTips(app);
  wireFooter();
}

const MAX_STARS = 5;
const starText = (n) => '★'.repeat(n) + '<span class="star-off">' + '★'.repeat(MAX_STARS - n) + '</span>';
const BAND = { 5: '100% GMS or better', 4: '97% GMS', 3: '96% GMS', 2: '95% GMS', 1: 'under 95% GMS' };

/** Stars only, for anyone viewing someone else's page. */
function starsLine(gms) {
  const s = gms.filter((g) => g.stars !== null);
  if (!s.length) return '';
  const best = Math.max(...s.map((g) => g.stars));
  return `<div class="card"><h2>Stars <span class="stars" aria-label="${best} stars">${starText(best)}</span></h2>
    <p class="muted small">${s.map((g) => `${TEST_LABELS[g.test]}: ${g.stars} star${g.stars === 1 ? '' : 's'}`).join(' · ')}</p></div>`;
}

function nextStarText(g) {
  const n = g.nextStar;
  if (g.stars === MAX_STARS) return 'Top band reached.';
  if (!n) return '';
  if (g.test === '2000m') {
    return `Next star: <b>${n.secondsFaster.toFixed(1)}s faster</b> on your 2k (${fmtTime(n.targetS)}, about ${n.splitFaster.toFixed(1)}s/500m).`;
  }
  return `Next star: <b>${fmtNum(n.metersMore)} m more</b> on your 20' (${fmtNum(n.targetM)} m, about ${n.splitFaster.toFixed(1)}s/500m faster).`;
}

/** Her own page and coaches: GMS % per test and how far to the next star, in time or meters. */
function gmsCard(gms, coach = false) {
  if (!gms.length) return '<div class="card"><h2>Gold Medal Standard</h2><p class="muted">No tests with a GMS yet this season.</p></div>';
  return `<div class="card"><h2>Gold Medal Standard <span class="pill">${coach ? 'coach view' : 'only you see this'}</span></h2>
    <div class="table-wrap"><table><tr><th>Test</th><th class="r">Best this season</th><th class="r">GMS</th><th>Stars</th><th></th></tr>
    ${gms.map((g) => `<tr><td>${TEST_LABELS[g.test]}</td><td class="r">${fmtResult(g)}</td><td class="r">${g.gmsPct.toFixed(1)}%</td>
      <td class="stars">${g.stars === null ? '' : starText(g.stars)}</td><td class="small wrap">${g.stars === null ? '' : nextStarText(g)}</td></tr>`).join('')}
    </table></div><p class="muted small">100% = the 1v8 standard (5:00 for 1500m). Stars come from your 2k and 20'.</p></div>`;
}

// ---- week ahead ----

const NO_TARGET = "No target yet: do a 2k or 20' to get one.";

/** One session: workout name, then each piece with her target (when she has one). */
function sessionBlock(s, withTargets) {
  return `<div class="session"><div class="session-head"><b>${esc(s.workout)}</b>
      ${/^(varsity|novice)$/i.test(s.squad) ? `<span class="pill">${esc(s.squad)}</span>` : ''}${s.session !== 'Practice' ? ` <span class="pill">${esc(s.session)}</span>` : ''}</div>
    ${s.notes ? `<p class="muted small">${esc(s.notes)}</p>` : ''}
    <table class="pieces">${s.pieces.map((p) => `<tr><td>${esc(p.label)}${p.notes ? `<div class="muted small">${esc(p.notes)}</div>` : ''}</td>
      ${withTargets ? `<td class="r target">${p.target ? fmtTarget(p.target) : '<span class="muted">–</span>'}</td>` : ''}</tr>`).join('')}</table></div>`;
}

/** "2:07.0 /500m (171 W)" as pace, with watts underneath. */
function fmtTarget(t) {
  const m = t.match(/^(.*?)\s*\(([^)]*)\)$/);
  return m ? `${esc(m[1])}<div class="muted small">${esc(m[2])}</div>` : esc(t);
}

/** Today's plan with targets. Coaches viewing an athlete pass her id so the week link opens her week. */
function todayCard(sessions, id = null) {
  if (!sessions || !sessions.length) return '';
  const none = sessions.every((s) => s.pieces.every((p) => !p.target));
  return `<div class="card today"><h2>Today</h2>${sessions.map((s) => sessionBlock(s, true)).join('')}
    ${none ? `<p class="muted small">${NO_TARGET}</p>` : ''}<p class="small"><a href="#/week${id ? '/' + encodeURIComponent(id) : ''}">The rest of the week</a></p></div>`;
}

/** Week ahead. Athletes get their own targets; coaches can open any athlete's week at #/week/ID. */
async function showWeek(id = null) {
  const v = await api(id ? '/api/week/' + encodeURIComponent(id) : '/api/week');
  setNav('week');
  const range = `${fmtDate(v.weekStart, { month: 'short', day: 'numeric' })} to ${fmtDate(v.weekEnd, { month: 'short', day: 'numeric' })}`;
  const any = v.days.some((d) => d.sessions.length);
  // Coaches pick any athlete to see her targets.
  const team = SESSION && SESSION.kind === 'team' ? (await api('/api/team')).athletes : null;
  const picker = team ? `<div><select id="pick" aria-label="Show targets for">
      <option value="">Whole team (no targets)</option>
      ${team.map((a) => `<option value="${esc(a.id)}"${id === a.id ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>` : '';
  app.innerHTML = `${staleNote(v.meta)}<div class="head"><div><h1>Week ahead</h1>
      <p class="muted">${range}${v.athlete ? ` · ${esc(v.athlete.squad)} · targets for ${esc(v.athlete.name)}` : ''}</p></div>
      ${picker}</div>
    ${v.noTargets ? `<div class="card"><p>${NO_TARGET}</p></div>` : ''}
    ${any ? v.days.map((d) => `<div class="card day${d.day === v.today ? ' is-today' : ''}${d.day < v.today ? ' past' : ''}">
        <h2>${fmtDay(d.day)}${d.day === v.today ? ' <span class="pill good">Today</span>' : ''}</h2>
        ${d.sessions.length ? d.sessions.map((s) => sessionBlock(s, !!v.athlete)).join('') : '<p class="muted small">Nothing scheduled.</p>'}</div>`).join('')
      : '<div class="card"><p class="muted">The plan for this week hasn\'t been published yet.</p></div>'}
    <p class="muted small">Targets come from your best 2k or 20' this school year. Steady pieces show a range; hard pieces show one number.</p>${footer(v.meta)}`;
  const pick = document.getElementById('pick');
  if (pick) pick.onchange = () => { location.hash = pick.value ? '#/week/' + encodeURIComponent(pick.value) : '#/week'; };
  wireFooter();
}

async function showBoards() {
  const v = await api('/api/leaderboards');
  setNav('boards');
  const state = { test: store.get('wrc.board') || '2000m', window: store.get('wrc.window') || 'season', squad: store.get(SQUAD_KEY) || 'all' };
  const mine = me();
  const render = () => {
    const t = v.tests.find((x) => x.test === state.test) || v.tests[0];
    const rows = t[state.window].filter((r) => state.squad === 'all' || r.squad.toLowerCase() === state.squad);
    const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([k, label]) =>
      `<button data-k="${key}" data-v="${k}" aria-pressed="${state[key] === k}">${label}</button>`).join('')}</div>`;
    app.innerHTML = `${staleNote(v.meta)}<div class="head"><div><h1>Leaderboards</h1>
      <p class="muted">Raw erg scores. School year starts ${fmtDate(v.yearStart, { month: 'short', day: 'numeric' })}.</p></div></div>
      <div class="filters">${seg('test', v.tests.map((x) => [x.test, TEST_LABELS[x.test]]))}
        ${seg('window', [['season', 'School year'], ['allTime', 'All time']])}
        ${seg('squad', [['all', 'All'], ['varsity', 'Varsity'], ['novice', 'Novice']])}</div>
      <div class="card board">${rows.length ? `<div class="table-wrap"><table>
        <tr><th class="r">#</th><th>Name</th><th class="r">${state.test === '20min' || state.test === '30r20' ? 'Meters' : 'Time'}</th><th class="r">Split</th><th class="r">Rate</th><th class="date">Date</th></tr>
        ${rows.map((r, i) => `<tr${mine && mine.id === r.id ? ' class="me"' : ''}><td class="r">${i + 1}</td>
          <td><a href="#/athlete/${esc(r.id)}">${esc(r.name)}</a>${r.active ? '' : ' <span class="pill">alum</span>'}
            <div class="sub">${r.stars === null ? '' : `<span class="stars" aria-label="${r.stars} stars">${starText(r.stars)}</span>`}${state.squad !== 'all' ? ` <span class="muted">#${r.rank} overall</span>` : ''}</div></td>
          <td class="r">${fmtResult(r)}</td><td class="r">${split(r)}</td><td class="r">${r.avgRate || '–'}</td><td class="date">${fmtDate(r.date)}</td></tr>`).join('')}
      </table></div>` : '<p class="muted">No results yet.</p>'}</div>${footer(v.meta)}`;
    app.querySelectorAll('[data-k]').forEach((b) => {
      b.onclick = () => {
        state[b.dataset.k] = b.dataset.v;
        store.set({ test: 'wrc.board', window: 'wrc.window', squad: SQUAD_KEY }[b.dataset.k], b.dataset.v);
        render();
      };
    });
    wireFooter();
  };
  render();
}

async function showStars() {
  const v = await api('/api/stars');
  setNav('stars');
  const groups = [5, 4, 3, 2, 1].map((n) => ({ n, rows: v.rowers.filter((r) => r.stars === n) }));
  const untested = v.rowers.filter((r) => r.stars === null);
  const cur = v.teamGms[0], prev = v.teamGms[1];
  const keys = ['team', 'varsity', 'novice', 'rank1_8', 'rank9_16', 'rank17'];
  const avg = (y, k) => (!y ? '–' : y.groups[k].hidden || y.groups[k].avg === null ? '–' : y.groups[k].avg.toFixed(1) + '%');
  app.innerHTML = `${staleNote(v.meta)}<div class="head"><div><h1>Stars</h1>
    <p class="muted">Best 2k or 20' this school year. Every 2k or 20' earns ★. More stars at 95%, 96%, 97% and 100% of the Gold Medal Standard (100% = 1v8 speed).</p></div></div>
    ${groups.map((g) => g.rows.length ? `<div class="card"><h2><span class="stars">${starText(g.n)}</span> ${BAND[g.n]} <span class="muted small">${g.rows.length}</span></h2>
      <div class="athletes">${g.rows.map((r) => `<a href="#/athlete/${esc(r.id)}"><span>${esc(r.name)}</span><span class="pill">${esc(r.squad)}</span></a>`).join('')}</div></div>` : '').join('')}
    ${untested.length ? `<div class="card"><h2>No 2k or 20' yet this season</h2><p class="muted small">${untested.map((r) => esc(r.name)).join(', ')}</p></div>` : ''}
    <div class="card"><h2>Team Gold Medal Standard</h2>
      <p class="muted small">Average of each rower's best GMS % this school year, through ${fmtDate(cur.throughDate)}${prev ? `, next to last year through the same date` : ''}. Groups under 3 rowers are hidden.</p>
      <div class="table-wrap"><table><tr><th>Group</th><th class="r">${esc(cur.schoolYear)}</th>${prev ? `<th class="r">${esc(prev.schoolYear)}</th>` : ''}</tr>
      ${keys.map((k) => `<tr><td>${esc(cur.groups[k].label)}</td><td class="r">${avg(cur, k)}</td>${prev ? `<td class="r">${avg(prev, k)}</td>` : ''}</tr>`).join('')}
      </table></div><p class="muted small">Ranks use raw erg speed.</p></div>${footer(v.meta)}`;
  wireFooter();
}

async function showOyo() {
  const v = await api('/api/oyo');
  setNav('oyo');
  let which = 'now';
  const mine = me();
  const render = () => {
    const rows = v.rowers.map((r) => (which === 'now' ? r : { ...r, minutes: r.lastWeek.minutes, status: r.lastWeek.status }))
      .sort((x, y) => y.minutes / y.required - x.minutes / x.required || x.name.localeCompare(y.name));
    const met = rows.filter((r) => r.status !== 'short').length, elite = rows.filter((r) => r.status === 'elite').length;
    app.innerHTML = `${staleNote(v.meta)}<div class="head"><div><h1>OYO goals</h1>
      <p class="muted">Week of ${fmtDate(which === 'now' ? v.weekStart : v.lastWeekStart)} · ${met} of ${rows.length} at Required · ${elite} at Elite</p></div>
      <div class="seg" role="group"><button data-w="now" aria-pressed="${which === 'now'}">This week</button><button data-w="last" aria-pressed="${which === 'last'}">Last week</button></div></div>
      <div class="card">${rows.map((r) => {
        const max = Math.max(r.elite * 1.15, r.minutes);
        return `<div class="oyo-row${mine && mine.id === r.id ? ' me' : ''}">
          <div class="oyo-name"><a href="#/athlete/${esc(r.id)}">${esc(r.name)}</a> <span class="muted small">${fmtMin(r.minutes)} / ${r.required}m${r.status === 'elite' ? ' · Elite' : ''}${which === 'now' && r.streak > 1 ? ` · ${r.streak} wk streak` : ''}</span></div>
          <div class="meter slim"><div class="fill ${r.status}" style="width:${Math.min(100, (100 * r.minutes) / max)}%"></div>
            <div class="mark" style="left:${(100 * r.required) / max}%"></div><div class="mark" style="left:${(100 * r.elite) / max}%"></div></div></div>`;
      }).join('')}<p class="muted small">Marks: Required and Elite. Weighted minutes (run 1.2, bike 0.6, …). Minutes past Elite count in totals only.</p></div>${footer(v.meta)}`;
    app.querySelectorAll('[data-w]').forEach((b) => { b.onclick = () => { which = b.dataset.w; render(); }; });
    wireFooter();
  };
  render();
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
    if (!SESSION) SESSION = await api('/api/session');
    if (page === 'team') return await showTeam();
    if (page === 'athletes') return await showAthletes();
    if (page === 'week') return await showWeek(arg ? decodeURIComponent(arg) : null);
    if (page === 'boards') return await showBoards();
    if (page === 'stars') return await showStars();
    if (page === 'oyo') return await showOyo();
    if (page === 'athlete' && arg) return await showAthlete(decodeURIComponent(arg));
    const m = me();
    if (page === 'me' && m) return await showAthlete(m.id);
    location.replace(m ? '#/me' : '#/team');
  } catch (err) {
    showError(err);
  }
}

window.addEventListener('hashchange', route);
route();
