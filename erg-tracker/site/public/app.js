// Whitman Rowing team site. Plain JS, hash routes:
// #/team, #/week, #/boards, #/stars, #/insights, #/balance, #/oyo, #/athletes, #/athlete/A001, #/me, #/workout/E-ID
// Data comes from /api/* behind a sign-in (an HttpOnly cookie). Athletes sign
// in as themselves (name + birthday); coaches with the coach password.

const app = document.getElementById('app');
const tip = document.getElementById('tip');
const OLD_ME_KEY = 'wrc.me';   // the old "pick your name" choice, cleared on sign-in
const SQUAD_KEY = 'wrc.squad';
const RESULTS_SORT_KEY = 'wrc.resultsSort';
const SESSION_KEY = 'wrc.session';   // who is signed in, so pages open without waiting on /api/session
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

function setSession(s) {
  SESSION = s && { kind: s.kind, athlete: s.athlete };
  store.set(SESSION_KEY, SESSION ? JSON.stringify(SESSION) : null);
}

/** The remembered session, or null. The cookie still decides: any 401 clears it. */
function savedSession() {
  try { return JSON.parse(store.get(SESSION_KEY)) || null; } catch { return null; }
}

/** The signed-in athlete, or null for a coach. */
function me() {
  return SESSION && SESSION.athlete;
}

async function signOut() {
  await fetch('/api/logout', { method: 'POST' });
  setSession(null);
  showLogin();
}

async function api(path) {
  const res = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  if (res.status === 401) { setSession(null); showLogin(); throw new Error('signin'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Something went wrong.');
  return body;
}

const isCoach = () => !!SESSION && SESSION.kind === 'team';

function setNav(active) {
  document.getElementById('nav').hidden = false;
  document.getElementById('menu').hidden = false;
  document.getElementById('log-top').hidden = false;
  closeMenu();
  const m = me();
  const link = document.getElementById('nav-me');
  link.hidden = !m;
  if (m) link.textContent = m.name.split(' ')[0];
  document.getElementById('nav-stars').hidden = !isCoach();
  document.getElementById('nav-insights').hidden = !isCoach();
  document.getElementById('nav-balance').hidden = !isCoach();
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === active));
}

/** Phone menu (David, 2026-10-28): the links fold into a hamburger under 720px; CSS ignores it on wider screens. */
function closeMenu() {
  document.querySelector('.top').classList.remove('open');
  document.getElementById('menu').setAttribute('aria-expanded', 'false');
}
document.getElementById('menu').onclick = () => {
  const open = document.querySelector('.top').classList.toggle('open');
  document.getElementById('menu').setAttribute('aria-expanded', String(open));
};
document.getElementById('nav').addEventListener('click', (ev) => { if (ev.target.closest('a')) closeMenu(); });

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
    el.addEventListener('pointerleave', (ev) => { if (ev.pointerType !== 'touch') tip.hidden = true; });   // touch: stays until the next tap elsewhere
  });
}

// A tooltip opened by touch never gets pointerleave, so the next tap anywhere else (or a scroll) closes it.
document.addEventListener('pointerdown', (ev) => { if (!ev.target.closest('[data-tip]')) tip.hidden = true; });
window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });

// ---- charts --------------------------------------------------------------

/**
 * Stacked weekly bars: practice + OYO minutes. rows: [{ weekStart, practice, oyo }].
 * load (optional, same weeks): [{ rpe, trailing, changePct, flag }]; trailing and
 * flag only reach coaches, who see the 3-week average as a tick and jumps marked.
 */
function weeklyChart(rows, caption, load = null) {
  const narrow = window.innerWidth < 600;
  const W = narrow ? 380 : 640, H = narrow ? 200 : 220, padL = 34, padB = 26, padT = 10;
  const max = Math.max(60, ...rows.map((r, i) => Math.max(r.practice + r.oyo, (load && load[i].trailing) || 0)));
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
    const l = load && load[i];
    const label = `<b>Week of ${fmtDate(r.weekStart)}</b><br>Practice ${fmtMin(p)}<br>OYO ${fmtMin(o)}<br>Total ${fmtMin(p + o)}` +
      (l && l.rpe !== null ? `<br>Average RPE ${l.rpe}` : '') +
      (l && l.trailing !== null && l.trailing !== undefined ? `<br>${l.trailingWeeks}-week average before: ${fmtMin(l.trailing)}${l.changePct === null ? '' : ` (${l.changePct > 0 ? '+' : ''}${l.changePct}%)`}` : '');
    const gap = o > 0 && p > 0 ? 2 : 0;
    const cx = padL + i * bw + bw / 2;
    const tick = l && l.trailing ? `<line class="avg-tick" x1="${cx - barW / 2 - 4}" x2="${cx + barW / 2 + 4}" y1="${y(l.trailing)}" y2="${y(l.trailing)}"/>` : '';
    const flag = l && l.flag ? `<text class="flag-label" x="${cx}" y="${Math.max(padT + 10, Math.min(y(p + o), l.trailing ? y(l.trailing) : H) - 5)}" text-anchor="middle">▲${l.changePct}%</text>` : '';
    return `<g data-tip="${esc(label)}">
      <rect x="${padL + i * bw}" y="${padT}" width="${bw}" height="${H - padT - padB}" fill="transparent"/>
      ${p > 0 ? `<rect x="${x}" y="${yp}" width="${barW}" height="${Math.max(0, y(0) - yp)}" fill="var(--series-1)" rx="${o > 0 ? 0 : 4}"/>` : ''}
      ${o > 0 ? `<rect x="${x}" y="${yo}" width="${barW}" height="${Math.max(0, yp - yo - gap)}" fill="var(--series-2)" rx="4"/>` : ''}
      ${tick}${flag}
      <text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle">${fmtDate(r.weekStart, { month: 'numeric', day: 'numeric' })}</text>
    </g>`;
  }).join('');
  const coachLoad = load && load.some((l) => l.trailing !== undefined);
  const table = `<details class="small"><summary class="muted">Show as a table</summary><div class="table-wrap"><table>
    <tr><th>Week of</th><th class="r">Practice</th><th class="r">OYO</th><th class="r">Total</th>${coachLoad ? '<th class="r">vs average</th>' : ''}</tr>
    ${rows.map((r, i) => `<tr><td>${fmtDate(r.weekStart)}${load && load[i].rpe != null ? `<div class="muted small">RPE ${load[i].rpe}</div>` : ''}</td><td class="r">${fmtMin(r.practice)}</td><td class="r">${fmtMin(r.oyo)}</td><td class="r">${fmtMin(r.practice + r.oyo)}</td>
      ${coachLoad ? `<td class="r">${load[i].changePct === null ? '' : `${load[i].flag ? '▲ ' : ''}${load[i].changePct > 0 ? '+' : ''}${load[i].changePct}%`}</td>` : ''}</tr>`).join('')}
  </table></div></details>`;
  return `<div class="chart">
    <div class="legend"><span><i style="background:var(--series-1)"></i>Practice</span><span><i style="background:var(--series-2)"></i>OYO</span>${coachLoad ? '<span><i class="tick-key"></i>Average of the 3 weeks before</span><span class="flag-label">▲ jump</span>' : ''}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(caption)}">${grid}${bars}</svg>${table}</div>`;
}

/** One 100% bar of minutes by zone, easy (Aerobic) to hard (Anaerobic). */
function zoneBar(z) {
  const zones = ['Aerobic', 'Threshold', 'Anaerobic'];
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

/**
 * One series by week as a line with dots; weeks with no value leave a gap.
 * points: [{ weekStart, value }]. invert puts lower values on top (faster splits).
 */
function lineChart(points, { caption, fmt, invert = false, pad = 1, tipLabel, min = null, max = null }) {
  const have = points.filter((p) => p.value !== null && p.value !== undefined);
  if (!have.length) return '<p class="muted">Nothing logged yet.</p>';
  const narrow = window.innerWidth < 600;
  const W = narrow ? 380 : 640, H = 150, padL = 44, padB = 24, padT = 12, padR = 8;
  const lo = min ?? Math.min(...have.map((p) => p.value)) - pad, hi = max ?? Math.max(...have.map((p) => p.value)) + pad;
  const y = (v) => padT + (H - padT - padB) * (invert ? (v - lo) / (hi - lo) : 1 - (v - lo) / (hi - lo));
  const bw = (W - padL - padR) / points.length;
  const x = (i) => padL + i * bw + bw / 2;
  const grid = [lo, (lo + hi) / 2, hi].map((v) => `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>` +
    `<text class="axis" x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`).join('');
  let path = '', pen = false;
  points.forEach((p, i) => {
    if (p.value === null || p.value === undefined) { pen = false; return; }
    path += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
    pen = true;
  });
  const dots = points.map((p, i) => `<g data-tip="${esc(`<b>Week of ${fmtDate(p.weekStart)}</b><br>${tipLabel}: ${p.value === null || p.value === undefined ? 'none' : fmt(p.value)}`)}">
      <rect x="${padL + i * bw}" y="${padT}" width="${bw}" height="${H - padT - padB}" fill="transparent"/>
      ${p.value === null || p.value === undefined ? '' : `<circle cx="${x(i)}" cy="${y(p.value)}" r="4.5" class="dot-mark"/>`}
      <text class="axis" x="${x(i)}" y="${H - 6}" text-anchor="middle">${fmtDate(p.weekStart, { month: 'numeric', day: 'numeric' })}</text></g>`).join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(caption)}">${grid}<path d="${path}" class="line-mark"/>${dots}</svg></div>`;
}

function tile(label, value, sub = '') {
  return `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
}

// ---- pages ---------------------------------------------------------------

function showLogin() {
  document.getElementById('nav').hidden = true;
  document.getElementById('menu').hidden = true;
  document.getElementById('log-top').hidden = true;
  closeMenu();
  app.innerHTML = `<div class="login card">
    <h1>Whitman Rowing</h1>
    <p class="muted">Sign in with your first and last name and the password from your coach.</p>
    <form id="login">
      <label for="name" class="small">Name</label>
      <input id="name" autocomplete="username" autocapitalize="words" spellcheck="false">
      <label for="pw" class="small">Password</label>
      <input id="pw" type="password" autocomplete="current-password" required>
      <button class="btn" type="submit" id="signin"><span class="spinner" aria-hidden="true"></span><span class="label">Sign in</span></button>
      <p id="login-err" class="error small" role="alert"></p>
    </form>
    <p class="small login-links"><a href="/logworkout" target="_blank" rel="noopener">Log a workout</a> · <a href="/guide" target="_blank" rel="noopener">How logging works</a></p></div>`;
  document.getElementById('login').onsubmit = async (ev) => {
    ev.preventDefault();
    const err = document.getElementById('login-err');
    err.textContent = '';
    const btn = document.getElementById('signin');
    if (btn.disabled) return;
    btn.disabled = true; btn.classList.add('busy'); btn.querySelector('.label').textContent = 'Signing in…';
    const done = (msg) => { btn.disabled = false; btn.classList.remove('busy'); btn.querySelector('.label').textContent = 'Sign in'; err.textContent = msg; };
    let res, body;
    try {
      res = await fetch('/api/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: document.getElementById('name').value, password: document.getElementById('pw').value })
      });
      body = await res.json().catch(() => ({}));
    } catch { return done('Could not reach the site. Check your connection and try again.'); }
    if (!res.ok) return done(body.error || 'Could not sign in.');
    store.set(OLD_ME_KEY, null);
    setSession(null);
    location.hash = '#/';
    route();
  };
}

async function showTeam() {
  const [t, wk] = await Promise.all([api('/api/team'), api('/api/week').catch(() => null)]);
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
        ${tile('Season completion', g.season.completionPct === null ? '–' : g.season.completionPct + '%', 'since Jul 1')}
        ${tile('Training this week', fmtMin(w.avgPerRower), 'average per rower')}
        ${tile('OYO goal met', `${w.oyoMetRequired}/${g.rowers}`, `${w.oyoElite} at Elite · ${w.oyoLogged} logged OYO`)}
      </div>
      ${t.splits ? splitsCard(t.splits) : ''}
      <div class="card"><h2>Weekly training (average per rower, weighted minutes)</h2>
        ${weeklyChart(g.weekly.map((r) => ({ weekStart: r.weekStart, practice: r.practiceAvg, oyo: r.oyoAvg })), 'Weekly training minutes per rower')}</div>
      <div class="two">
        <div class="stack-col"><div class="card"><h2>Intensity, last 4 weeks</h2>${zoneBar(g.zones)}</div>
          ${teamTodayCard(wk, squad)}</div>
        <div class="card"><h2>Latest logs</h2>${recentList(t)}</div>
      </div>${footer(t.meta)}`;
    app.querySelectorAll('[data-sq]').forEach((b) => { b.onclick = () => { squad = b.dataset.sq; store.set(SQUAD_KEY, squad); render(); }; });
    wireTips(app);
    wireFooter();
  };
  render();
}

/** Coaches only: average season-best split for each group, 2k and 20' together (David, 2026-10-25). */
function splitsCard(s) {
  return `<div class="card"><h2>Average season-best results</h2>
    <p class="muted small">Each rower's best 2k or 20' this school year as a split per 500m (20' at 2k pace, minus 8.5 s). Ranked fastest first, team-wide.</p>
    <div class="table-wrap"><table><tr><th>Group</th><th class="r">Rowers</th><th class="r">2k split</th><th class="r">20' meters</th><th class="r">Combined</th></tr>
    ${s.groups.map((g) => `<tr><td>${esc(g.label)}</td><td class="r">${g.n} of ${g.rowers}</td>
      <td class="r">${g.twoK.avgSplit === null ? '–' : `${fmtTime(g.twoK.avgSplit)}<div class="muted small">${g.twoK.n} tested</div>`}</td>
      <td class="r">${g.twenty.avgMeters === null ? '–' : `${fmtNum(g.twenty.avgMeters)} m<div class="muted small">${fmtTime(g.twenty.avgSplit)} /500m · ${g.twenty.n} tested</div>`}</td>
      <td class="r">${g.avgSplit === null ? '–' : fmtTime(g.avgSplit) + ' /500m'}</td></tr>`).join('')}
    </table></div><p class="muted small">2k split is the average best 2k per 500m. 20' is the average best distance and its real split. Combined is the old number (each rower's best of the two).</p></div>`;
}

/**
 * Team page: today's workout for the chosen squad (an athlete always sees
 * her own, with her targets). Nothing today: the next scheduled day this week.
 */
function teamTodayCard(wk, squad) {
  if (!wk) return '';
  // An athlete's week is already her squad only; coaches follow the squad switch.
  const forSquad = (x) => !!wk.athlete || squad === 'all' || !/^(varsity|novice)$/i.test(x.squad) || x.squad.toLowerCase() === squad;
  const days = wk.days.filter((d) => d.day >= wk.today).map((d) => ({ ...d, sessions: d.sessions.filter(forSquad) })).filter((d) => d.sessions.length);
  const d = days[0];
  const title = !d ? 'Today' : d.day === wk.today ? 'Today' : `Next: ${fmtDay(d.day)}`;
  const body = d ? d.sessions.map((x) => sessionBlock({ ...x, results: undefined }, !!wk.athlete)).join('')
    : '<p class="muted small">Nothing scheduled for the rest of this week.</p>';
  return `<div class="card today"><h2>${title}</h2>${body}<p class="small"><a href="#/week">The whole week</a></p></div>`;
}

function recentList(t) {
  const names = Object.fromEntries(t.athletes.map((a) => [a.id, a.name]));
  if (!t.recent.length) return '<p class="muted">Nothing logged yet.</p>';
  // Activity sits under the name so the table fits a phone (David, 2026-10-28).
  return `<div class="table-wrap"><table>${t.recent.map((r) => `<tr>
    <td>${fmtDate(r.date)}</td><td><a href="#/athlete/${esc(r.athleteId)}">${esc(names[r.athleteId] || '')}</a>
    <div class="muted small">${esc(r.test ? r.mainSet : r.type)}${r.activity && r.activity !== 'Erg (RowErg)' ? ' · ' + esc(r.activity) : ''}</div></td>
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
        <span>${esc(a.name)}${mine && mine.id === a.id ? ' (you)' : ''}${a.stars === null ? '' : `<span class="stars small" aria-label="${starWord(a.stars)}">${starText(a.stars)}</span>`}</span><span class="pill">${esc(a.grade)}</span></a>`).join('')}
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
  // Fixed 3 h scale (Required 1 h, Elite 2 h); a bar stops at the end (David, 2026-10-28). Other goals (break weeks) scale to 1.5 x Elite.
  const oyoMax = Math.max(180, a.oyoElite * 1.5);
  const oyoText = { elite: 'Elite reached', required: 'Required met', short: `${fmtMin(Math.max(0, a.oyoRequired - w.oyoMin))} to Required` }[w.oyoStatus];
  const makeups = v.openMakeups.length ? `<div class="card"><h2>Make-ups open</h2>
      ${v.openMakeups.map((m) => `<p><b>Missed ${fmtDay(m.date)}</b>: make it up by <b>${fmtDay(m.makeUpBy)}</b></p>
        ${m.sessions.length ? m.sessions.map((s) => sessionBlock(s, true)).join('') : '<p class="muted small">No workout was published for this day.</p>'}`).join('')}
      <p class="muted small">Log it on the form as "Make-up for a missed practice" with the date you missed.</p></div>` : '';
  app.innerHTML = `${staleNote(v.meta)}
    <div class="head"><div><h1>${esc(a.name)}</h1><p class="muted">${esc(a.squad)} · ${esc(a.grade)}${a.active ? '' : ' · inactive'}</p></div>
      ${v.own ? '<button class="linkish small" id="not-you">Not you? Sign out</button>' : ''}</div>
    ${v.own || v.coach ? todayCard(v.todayPlan, v.own ? null : id) : ''}
    ${v.own || v.coach ? '<div id="logbook-card"></div>' : ''}
    <div class="grid">
      ${tile('Practices this week', `${w.practicesDone}/${w.practicesExpected}`, fmtMin(w.practiceMin) + ' weighted')}
      ${tile('Season completion', s.completionPct === null ? '–' : s.completionPct + '%', `${s.practicesDone} of ${s.practicesExpected}${s.makeupsDone ? ` · ${s.makeupsDone} make-up${s.makeupsDone > 1 ? 's' : ''}` : ''}`)}
      ${tile('Practice streak', v.streaks.practices, 'in a row')}
      ${tile('OYO goal streak', v.streaks.oyoWeeks, v.streaks.oyoWeeks === 1 ? 'week' : 'weeks in a row')}
      ${tile('Season training', fmtMin(s.trainingMin), fmtNum(s.meters) + ' m')}
      ${v.insights ? monthTile(v.insights.month, v.today) : ''}
    </div>
    <div class="card"><h2>OYO this week: ${fmtMin(w.oyoMin)} <span class="pill ${w.oyoStatus === 'short' ? '' : 'good'}">${oyoText}</span>${a.breakWeek ? ' <span class="pill">Break week</span>' : ''}</h2>
      <div class="meter" role="img" aria-label="OYO ${Math.round(w.oyoMin)} of ${a.oyoRequired} required, ${a.oyoElite} elite">
        <div class="fill" style="width:${Math.min(100, (100 * w.oyoMin) / oyoMax)}%"></div>
        <div class="mark" style="left:${(100 * a.oyoRequired) / oyoMax}%"><span>Required ${a.oyoRequired}m</span></div>
        <div class="mark" style="left:${(100 * a.oyoElite) / oyoMax}%"><span>Elite ${a.oyoElite}m</span></div>
      </div></div>
    ${makeups}
    ${v.own || v.coach ? gmsCard(v.gms, v.coach) : starsLine(v.gms)}
    <div class="card"><h2>Best results</h2>${bestsTable(v)}</div>
    <div class="card"><h2>Weekly training (weighted minutes)</h2>${weeklyChart(v.weekly, 'Weekly training minutes', v.insights && v.insights.load)}
      ${v.insights ? loadNote(v.insights, v.coach) : ''}</div>
    ${v.insights ? effortCard(v.insights) + progressCard(v.insights, v.coach) : ''}
    <div class="two">
      <div class="card"><h2>Intensity, last 4 weeks</h2>${zoneBar(v.zones)}</div>
      <div class="card"><h2>Last 10 practices</h2><div class="dots">
        ${v.recentPractices.slice().reverse().map((r) => `<span class="dot ${r.how === 'Make-up' ? 'mu' : r.done ? 'done' : ''}"
          data-tip="${esc(fmtDay(r.date) + ': ' + (r.how === 'Make-up' ? 'made up ' + fmtDate(r.makeupDate) : r.how))}">${new Date(r.date + 'T12:00:00').getDate()}</span>`).join('')}
      </div><p class="muted small">Filled: done. Ring: made up. Empty: missed.</p></div>
    </div>
    <div class="card"><h2>Tests</h2>${testsTable(v.tests)}</div>
    ${v.own || v.coach ? workoutsCard(v.workouts, v.yearStart) : `<div class="card"><h2>Recent sessions</h2>${sessionsTable(v.sessions)}</div>`}${footer(v.meta)}`;
  const notYou = document.getElementById('not-you');
  if (notYou) notYou.onclick = signOut;
  if (v.own || v.coach) loadLogbookCard(id, !!v.own);
  app.querySelectorAll('tr.session-row').forEach((tr) => { tr.onclick = () => { tr.nextElementSibling.hidden = !tr.nextElementSibling.hidden; }; });
  app.querySelectorAll('button.more-toggle').forEach((b) => {
    b.onclick = () => { const d = b.nextElementSibling; d.hidden = !d.hidden; b.textContent = d.hidden ? 'Show more' : 'Show less'; };
  });
  wireTips(app);
  wireFooter();
  wireWorkouts(v.workouts, v.yearStart);
}

// ---- my workouts: filter by zone and school year, click in for splits -----

const WORKOUT_ZONES = ['Aerobic', 'Threshold', 'Anaerobic'];
const workoutFilter = { year: 'current', zone: '' };   // remembered while the page is open

function workoutsCard(rows, yearStart) {
  return `<div class="card" id="my-workouts"><h2>My workouts</h2>
    <div class="workout-tools">
      <div class="seg" role="group" aria-label="School year">
        <button type="button" data-year="current" aria-pressed="true">This school year</button>
        <button type="button" data-year="all" aria-pressed="false">All</button></div>
      <div class="seg" role="group" aria-label="Zone">
        ${['', ...WORKOUT_ZONES].map((z) => `<button type="button" data-zone="${z}" aria-pressed="${z === '' ? 'true' : 'false'}">${z || 'All zones'}</button>`).join('')}</div>
    </div>
    <div id="workout-list">${workoutList(rows, yearStart)}</div>
    <p class="muted small">Open a workout to see its splits against your targets. Splits are kept for this school year; older workouts show totals only.</p></div>`;
}

/** Rows for the current filter. Zone filter is on the Zone tag (Aerobic, Threshold, Anaerobic). */
function workoutList(rows, yearStart) {
  const shown = rows.filter((r) => (workoutFilter.year === 'all' || r.date >= yearStart) && (!workoutFilter.zone || r.zone === workoutFilter.zone));
  if (!shown.length) return '<p class="muted">No workouts match these filters.</p>';
  // Activity, zone and RPE sit under the type so the table fits a phone (David, 2026-10-28).
  return `<div class="table-wrap"><table><tr><th>Date</th><th>Workout</th><th class="r">Min</th><th class="r">Meters</th></tr>
    ${shown.map((r) => `<tr><td><a href="#/workout/${encodeURIComponent(r.id)}">${fmtDate(r.date)}</a></td>
      <td>${esc(r.type)}${r.status && r.status !== 'Full' ? ` <span class="pill">${esc(r.status)}</span>` : ''}${r.makeupFor ? ` <span class="muted small">for ${fmtDate(r.makeupFor)}</span>` : ''}
        <div class="muted small">${[r.activity, r.zone, r.rpe != null && `RPE ${r.rpe}`].filter(Boolean).map((x) => esc(x)).join(' · ')}</div></td>
      <td class="r">${fmtMin(r.minutes)}</td><td class="r">${r.meters ? fmtNum(r.meters) : ''}</td></tr>`).join('')}
  </table></div>`;
}

function wireWorkouts(rows, yearStart) {
  const card = document.getElementById('my-workouts');
  if (!card) return;
  card.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.year) workoutFilter.year = b.dataset.year;
    if (b.dataset.zone !== undefined) workoutFilter.zone = b.dataset.zone;
    card.querySelectorAll('[data-year]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.year === workoutFilter.year)));
    card.querySelectorAll('[data-zone]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.zone === workoutFilter.zone)));
    document.getElementById('workout-list').innerHTML = workoutList(rows, yearStart);
  });
}

/** One logged workout: totals, and when it is in this school year, each interval against its target. */
async function showWorkout(id) {
  const v = await api('/api/workout/' + encodeURIComponent(id));
  const w = v.workout, d = v.detail;
  const mine = me();
  const own = mine && mine.id === v.athlete.id;
  setNav(own ? 'me' : 'athletes');
  const pills = `${resultPills({ test: w.test || (d && d.test), status: w.status, type: w.type, date: w.date, activity: w.activity, hit: d ? d.hit : null })}`;
  let body;
  if (!d) {
    body = '<p class="muted">Splits are kept for this school year. This workout is older, so only its totals show.</p>';
  } else {
    const rowsHtml = d.pieces.length ? d.pieces.map((p, pi) => {
      const ivs = d.intervals.filter((x) => x.piece === pi);
      return `<tr><td>${esc(p.label)}</td><td class="r target">${p.target ? fmtTarget(p.target) : '<span class="muted">–</span>'}</td>
        <td class="r splits">${workSplits(ivs, d.rowErg, isBike(w))}</td></tr>`;
    }).join('') : '';
    const extra = d.intervals.filter((x) => x.piece === null);
    body = `${d.matches === false ? `<p class="muted small">${esc(d.reason)}</p>` : ''}
      ${d.pieces.length ? `<table class="pieces"><tr><th></th><th class="r">Target</th><th class="r">Logged</th></tr>${rowsHtml}
        ${extra.length ? `<tr><td class="muted">Extra</td><td></td><td class="r splits">${workSplits(extra, d.rowErg, isBike(w))}</td></tr>` : ''}</table>`
        : `<table class="pieces"><tr><th>Interval</th><th class="r">Logged</th></tr>${d.intervals.map((x) => `<tr><td>${x.n}</td><td class="r splits">${workSplits([x], d.rowErg, isBike(w))}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">No intervals logged.</td></tr>'}</table>`}
      <p class="muted small">Logged splits: ✓ in range, ↓ under target, ↑ over target. * BikeErg split per 1000m. Targets are the ones that stood on the day the workout was planned.</p>`;
  }
  app.innerHTML = `${staleNote(v.meta)}
    <div class="head"><div><h1>${esc(v.athlete.name)} · ${fmtDay(w.date)}</h1>
      <p class="muted"><a href="#/athlete/${encodeURIComponent(v.athlete.id)}">Back to ${own ? 'my page' : esc(v.athlete.name)}</a></p></div></div>
    <div class="card"><h2>${esc(d && d.workout ? d.workout : w.type)}</h2>
      <div class="result-line">${pills}</div>
      <div class="grid">
        ${tile('Minutes', fmtMin(w.minutes), `${fmtMin(w.weighted)} weighted`)}
        ${tile('Meters', w.meters ? fmtNum(w.meters) : '–', w.zone ? `Zone ${w.zone}` : 'No zone')}
        ${tile('RPE', w.rpe ?? '–', '')}
      </div>
      ${body}</div>${footer(v.meta)}`;
  wireFooter();
}

/** Each interval's split (or its time and meters for machines without a split), marked against the target. */
function workSplits(list, rowErg, bike = false) {
  if (!list.length) return '<span class="muted">–</span>';
  return list.map((x) => {
    if (!rowErg) return `${fmtTime(x.workS)} · ${x.workM ? fmtNum(x.workM) + ' m' : ''}`;
    return splitsCell([x], bike);
  }).join(' ');
}

// ---- load, effort, progress, consistency (own page and coaches only) ------

function monthTile(m, today) {
  const name = fmtDate(today, { month: 'long' });
  return tile(`${name} so far`, m.pct === null ? '–' : m.pct + '%', `${m.done} of ${m.expected} practices logged`);
}

function loadNote(ins, coach) {
  if (!coach) return '<p class="muted small">Only you and your coaches see your effort and progress below.</p>';
  const flagged = ins.load.filter((l) => l.flag);
  return `<p class="muted small">The tick is her average for the 3 weeks before (fewer in her first weeks). ▲ marks a week more than ${ins.jumpPct}% above it.
    ${flagged.length ? `<b>${flagged.length} week${flagged.length > 1 ? 's' : ''} flagged.</b>` : 'No jumps in these weeks.'}</p>`;
}

function effortCard(ins) {
  return `<div class="card"><h2>Effort (average session RPE)</h2>
    ${lineChart(ins.load.map((l) => ({ weekStart: l.weekStart, value: l.rpe })), { caption: 'Average session RPE by week', fmt: (v) => String(Math.round(v * 10) / 10), min: 1, max: 10, tipLabel: 'Average RPE' })}
    <p class="muted small">RPE 1-10 from the form, averaged over the week's training minutes. Rising effort with the same splits can mean she's tired.</p></div>`;
}

function changeText(d, lowerBetter) {
  if (d === null || d === undefined) return '';
  if (d === 0) return '<span class="muted">same</span>';
  const better = lowerBetter ? d < 0 : d > 0;
  const amt = lowerBetter ? `${Math.abs(d).toFixed(1)}s` : `${fmtNum(Math.abs(d))} m`;
  return `<span class="${better ? 'good-text' : 'muted'}">${better ? '▲' : '▼'} ${amt} ${lowerBetter ? (better ? 'faster' : 'slower') : (better ? 'more' : 'less')}</span>`;
}

function progressCard(ins, coach) {
  const who = coach ? 'her' : 'your';
  const t = ins.splitTrend;
  const trend = !t ? '<p class="muted">Not enough steady erg work logged yet to show a trend.</p>'
    : `<p>${Math.abs(t.changeS) < 0.5 ? 'About the same as' : `<b>${Math.abs(t.changeS).toFixed(1)}s/500m ${t.changeS < 0 ? 'faster' : 'slower'}</b> than`} ${t.weeksEach > 1 ? `the ${t.weeksEach} weeks before` : 'the week before'}
      <span class="muted">(${fmtTime(t.earlierS)} → ${fmtTime(t.recentS)})</span></p>`;
  const rows = (test) => ins.progress[test].map((r) => `<tr><td>${fmtDate(r.date)}</td><td class="r">${fmtResult(r)}<div class="muted small">${split(r)}</div></td>
      <td class="r">${changeText(r.change, test === '2000m')}</td></tr>`).join('');
  const table = (test) => ins.progress[test].length ? `<div><h3>${TEST_LABELS[test]}</h3><div class="table-wrap"><table>
      <tr><th>Date</th><th class="r">Result / split</th><th class="r">Change</th></tr>${rows(test)}</table></div></div>`
    : `<div><h3>${TEST_LABELS[test]}</h3><p class="muted">None this school year.</p></div>`;
  const p = ins.projected2k;
  const proj = p ? `<p><b>Estimated 2k: ${fmtTime(p.timeS)}</b> <span class="muted">from ${who} 20' on ${fmtDate(p.from.date)} (${fmtNum(p.from.meters)} m)${p.last2k ? `; last real 2k ${fmtTime(p.last2k.timeS)} on ${fmtDate(p.last2k.date)}` : ''}. An estimate only: ${who} next 2k test is the real answer.</span></p>` : '';
  return `<div class="card"><h2>Progress</h2>
    <h3>Steady-state split (Aerobic on the erg)</h3>${trend}
    ${lineChart(ins.steady.map((w) => ({ weekStart: w.weekStart, value: w.splitS })), { caption: 'Steady-state split by week, faster is higher', fmt: fmtTime, invert: true, pad: 1, tipLabel: 'Average split' })}
    <p class="muted small">Higher on the chart is faster. BikeErg counts at half its meters, like the rest of the site. Rate and drag aren't taken into account, so read it as a rough trend.</p>
    <h3>Tests this school year</h3>${proj}<div class="two">${table('2000m')}${table('20min')}</div></div>`;
}

const MAX_STARS = 5;
/** Filled, half and empty stars; n can end in .5. */
function starText(n) {
  const full = Math.floor(n), half = n - full >= 0.5 ? 1 : 0;
  return '★'.repeat(full) + (half ? '<span class="star-half">★</span>' : '') + '<span class="star-off">' + '★'.repeat(MAX_STARS - full - half) + '</span>';
}
const starWord = (n) => `${n} star${n === 1 ? '' : 's'}`;
/** Average of the 2k and 20' stars, matching seasonStars on the server. */
const avgStars = (list) => (list.length ? Math.round((2 * list.reduce((x, y) => x + y, 0)) / list.length) / 2 : null);

/** Stars only, for anyone viewing someone else's page. */
function starsLine(gms) {
  const s = gms.filter((g) => g.stars !== null);
  if (!s.length) return '';
  const avg = avgStars(s.map((g) => g.stars));
  return `<div class="card"><h2>Stars <span class="stars" aria-label="${starWord(avg)}">${starText(avg)}</span></h2>
    <p class="muted small">${s.map((g) => `${TEST_LABELS[g.test]}: ${starWord(g.stars)}`).join(' · ')}${s.length > 1 ? ' · average of the two' : ''}</p></div>`;
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
  // The next-star text is long, so it sits behind "Show more" instead of making the table scroll sideways.
  const more = gms.filter((g) => g.stars !== null && nextStarText(g)).map((g) => `<p>${TEST_LABELS[g.test]}: ${nextStarText(g)}</p>`).join('');
  return `<div class="card"><h2>Gold Medal Standard <span class="pill">${coach ? 'coach view' : 'only you see this'}</span></h2>
    <div class="table-wrap"><table><tr><th>Test</th><th class="r">Best this season</th><th class="r">GMS</th><th>Stars</th></tr>
    ${gms.map((g) => `<tr><td>${TEST_LABELS[g.test]}</td><td class="r">${fmtResult(g)}<div class="muted small">${split(g)} /500m</div></td><td class="r">${g.gmsPct.toFixed(1)}%</td>
      <td class="stars">${g.stars === null ? '' : starText(g.stars)}</td></tr>`).join('')}
    </table></div>
    ${more ? `<button class="linkish small more-toggle" type="button">Show more</button><div class="small" hidden>${more}</div>` : ''}
    <p class="muted small">100% = the 1v8 standard (5:00 for 1500m). Stars come from your 2k and 20'.</p></div>`;
}

// ---- week ahead ----

const NO_TARGET = "No target yet: do a 2k or 20' to get one.";

const MARK = { in: ['✓', 'in range'], below: ['↓', 'under target'], above: ['↑', 'over target'] };

/** Logged splits for one piece, each marked against her target range. */
function splitsCell(list, bike = false) {
  if (!list || !list.length) return '<span class="muted">–</span>';
  return list.map((x) => {
    const m = MARK[x.status];
    return `<span class="sp ${x.status || ''}"${m ? ` title="${m[1]}"` : ''}>${x.splitS === null ? '✓' : fmtTime(x.splitS) + (bike ? '*' : '')}${m ? ` <span aria-label="${m[1]}">${m[0]}</span>` : ''}</span>`;
  }).join(' ');
}

const isBike = (r) => /bikeerg/i.test(r.activity || '');

/** Pills for one logged result: status, machine, make-up, and the range verdict. */
function resultPills(r) {
  const verdict = r.hit === true ? '<span class="pill good">All in range</span>' : r.hit === false ? '<span class="pill warn">Some off target</span>' : '';
  return `<span class="pill">${r.test ? 'Test done' : esc(r.status || 'Logged')}</span>${r.type === 'Make-up' ? ` <span class="pill">Make-up ${fmtDate(r.date)}</span>` : ''}${r.activity && !/rowerg/i.test(r.activity) ? ` <span class="pill">${esc(r.activity)}</span>` : ''} ${verdict}`;
}

/**
 * One session: workout name, then each piece with her target (when she has
 * one) and, once she's logged it, her splits against it. Coaches viewing the
 * whole team get everyone's results in a fold-out.
 */
function sessionBlock(s, withTargets, today = '') {
  const r = s.result;
  const status = r ? `<div class="result-line">${resultPills(r)}${r.matches ? '' : ` <span class="muted small">${esc(r.reason)}</span>`}</div>`
    : s.missed ? '<div class="result-line"><span class="pill">Not logged</span></div>' : '';
  return `<div class="session"><div class="session-head"><b>${esc(s.workout)}</b>
      ${/^(varsity|novice)$/i.test(s.squad) ? `<span class="pill">${esc(s.squad)}</span>` : ''}${s.session !== 'Practice' ? ` <span class="pill">${esc(s.session)}</span>` : ''}</div>
    ${s.notes ? `<p class="muted small">${esc(s.notes)}</p>` : ''}${status}
    <table class="pieces">${r ? '<tr><th></th>' + (withTargets ? '<th class="r">Target</th>' : '') + '<th class="r">Logged</th></tr>' : ''}
      ${s.pieces.map((p, i) => `<tr><td>${esc(p.label)}${p.notes ? `<div class="muted small">${esc(p.notes)}</div>` : ''}</td>
      ${withTargets ? `<td class="r target">${p.target ? fmtTarget(p.target) : '<span class="muted">–</span>'}</td>` : ''}
      ${r ? `<td class="r splits">${splitsCell(r.pieces[i], isBike(r))}</td>` : ''}</tr>`).join('')}
      ${r && r.extra.length ? `<tr><td class="muted">Extra</td>${withTargets ? '<td></td>' : ''}<td class="r splits">${splitsCell(r.extra, isBike(r))}</td></tr>` : ''}</table>
    ${s.results ? teamResults(s, today) : ''}</div>`;
}

/** Average logged split (RowErg-equivalent /500m) across every piece, or null. */
function avgSplit(r) {
  const all = [...r.pieces.flat(), ...r.extra].map((x) => x.splitS).filter((x) => x !== null);
  return all.length ? all.reduce((x, y) => x + y, 0) / all.length : null;
}

/**
 * Coaches: everyone in the session's squad, logged or not, with splits against
 * their targets. Sortable by name or by speed (average split, fastest first;
 * no split last). The choice sticks across fold-outs.
 */
function teamResults(s, today) {
  const logged = s.results.filter((x) => x.result);
  const inRange = logged.filter((x) => x.result.hit === true).length;
  const ahead = today && s.day > today;
  const sort = store.get(RESULTS_SORT_KEY) || 'name';
  return `<details class="team-results"><summary>Results: ${logged.length} of ${s.results.length} logged${logged.length ? ` · ${inRange} all in range` : ''}</summary>
    <div class="seg results-sort" role="group" aria-label="Sort results">
      <button data-sort="name" aria-pressed="${sort === 'name'}">Name</button><button data-sort="speed" aria-pressed="${sort === 'speed'}">Speed</button></div>
    <div class="table-wrap"><table><thead><tr><th class="r rank">#</th><th>Name</th><th>Status</th><th class="r">Avg</th>${s.pieces.map((p) => `<th class="r">${esc(p.label)}</th>`).join('')}</tr></thead><tbody>
    ${s.results.map((x) => {
      const avg = x.result ? avgSplit(x.result) : null;
      return `<tr data-name="${esc(x.name.toLowerCase())}" data-speed="${avg === null ? '' : avg}"><td class="r rank muted"></td><td><a href="#/athlete/${esc(x.id)}">${esc(x.name)}</a></td>
      <td>${x.result ? resultPills(x.result) : `<span class="muted small">${ahead ? '' : 'Not logged'}</span>`}</td>
      <td class="r">${avg === null ? '' : fmtTime(avg) + (isBike(x.result) ? '*' : '')}</td>
      ${s.pieces.map((p, i) => `<td class="r splits">${x.result ? splitsCell(x.result.pieces[i], isBike(x.result)) : ''}${x.targets[i] ? `<div class="muted small">${esc(x.targets[i].replace(/\s*\([^)]*\)$/, ''))}</div>` : ''}</td>`).join('')}</tr>`;
    }).join('')}
    </tbody></table></div></details>`;
}

/** Orders every results table on the page by name or speed and numbers the speed ranks. */
function sortResults(root, sort) {
  root.querySelectorAll('details.team-results').forEach((d) => {
    d.querySelectorAll('.results-sort button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sort === sort)));
    const body = d.querySelector('tbody');
    const rows = [...body.rows];
    const speed = (r) => (r.dataset.speed === '' ? Infinity : Number(r.dataset.speed));
    rows.sort((a, b) => (sort === 'speed' ? speed(a) - speed(b) : 0) || a.dataset.name.localeCompare(b.dataset.name));
    let n = 0;
    rows.forEach((r) => { r.cells[0].textContent = sort === 'speed' && r.dataset.speed !== '' ? ++n : ''; body.appendChild(r); });
    d.classList.toggle('by-speed', sort === 'speed');
  });
}

function wireResultsSort(root) {
  sortResults(root, store.get(RESULTS_SORT_KEY) || 'name');
  root.querySelectorAll('.results-sort button').forEach((b) => {
    b.onclick = () => { store.set(RESULTS_SORT_KEY, b.dataset.sort); sortResults(root, b.dataset.sort); };
  });
}

/** Concept2 Logbook connection. Her own page connects; coaches see who is connected and can disconnect. */
const LOGBOOK_NOTES = {
  connected: 'Connected. Your Logbook sessions will show up here once syncing is switched on.',
  denied: 'Not connected: you chose Deny on the Concept2 page.',
  taken: 'That Concept2 account is already connected to another athlete. Sign in to your own Concept2 account and try again.',
  error: 'Something went wrong connecting. Try again, and tell a coach if it keeps happening.'
};
async function loadLogbookCard(id, own) {
  const box = document.getElementById('logbook-card');
  if (!box) return;
  const flash = own ? new URLSearchParams(location.search).get('logbook') : null;
  let connected = false, username = '';
  try {
    const st = await api('/api/concept2/status');
    if (own) { connected = !!st.connected; username = st.username || ''; }
    else {
      const row = st.connected.find((c) => c.id === id);
      connected = !!row; username = row ? row.username : '';
    }
  } catch (e) {
    return;   // not set up yet, or signed out: show nothing
  }
  const who = connected ? `Connected${username ? ' as <b>' + esc(username) + '</b>' : ''}.` : '';
  box.innerHTML = `<div class="card"><h2>Concept2 Logbook</h2>
    ${LOGBOOK_NOTES[flash] ? `<p>${esc(LOGBOOK_NOTES[flash])}</p>` : ''}
    ${connected
      ? `<p>${who} <button class="linkish small" id="logbook-off">Disconnect</button></p>`
      : own
        ? '<p class="muted small">Connect your free Concept2 Logbook account once, so erg sessions saved from ErgData can be filled in for you. We only read your results, and you can disconnect any time.</p><p><a class="btn" href="/api/concept2/connect">Connect Logbook</a></p>'
        : '<p class="muted small">Not connected. She connects from her own page.</p>'}
  </div>`;
  if (own && connected) loadLogbookPending(box);
  const off = document.getElementById('logbook-off');
  if (off) {
    off.onclick = async () => {
      off.disabled = true;
      await fetch('/api/concept2/disconnect' + (own ? '' : '?athlete=' + encodeURIComponent(id)), { method: 'POST', credentials: 'same-origin' });
      history.replaceState(null, '', location.pathname + location.hash);
      loadLogbookCard(id, own);
    };
  }
}

/**
 * "Found on Logbook": sessions waiting for her tap. Confirm counts it as shown; she can change the type first.
 * The list is read fresh each time (no cached copy), every card that is waiting appears together, and the
 * page checks again every minute while it stays open; cards already on screen are never redrawn under her.
 */
function logbookCard(p) {
  const pieces = p.pieces.length > 1
    ? `<p class="muted small">${p.pieces.map((x) => `${fmtTime(x.workS)}${x.workM ? ' · ' + fmtNum(x.workM) + ' m' : ''}${x.rate ? ' · ' + x.rate + ' spm' : ''}`).map(esc).join('<br>')}</p>` : '';
  const types = ['Practice', 'OYO', 'Make-up'].map((t) => `<option${t === p.sessionType ? ' selected' : ''}>${t}</option>`).join('');
  return `<div class="card lb-pending" data-id="${esc(p.id)}"><h2>Found on Logbook</h2>
    <p><b>${esc(fmtDay(p.date))}</b> · ${esc(p.activity)}${p.mainSet ? ' · ' + esc(p.mainSet) : ''}<br>${fmtTime(p.workS)} work · ${fmtNum(p.workM)} m${p.dragFactor ? ' · drag ' + p.dragFactor : ''}</p>${pieces}
    ${p.possibleMakeup ? `<p class="small">This looks like a make-up for ${esc(p.makeupFor ? fmtDay(p.makeupFor) : 'a missed practice')}. Check the type below.</p>` : ''}
    <p class="small"><label>Counts as <select class="lb-type">${types}</select></label>
      <label class="lb-mk"${p.sessionType === 'Make-up' ? '' : ' hidden'}> for the practice on <input type="date" class="lb-mkdate" value="${esc(p.makeupFor || '')}"></label>
      <label>Effort (1 easy – 10 max) <select class="lb-rpe"><option value="">skip</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option>${n}</option>`).join('')}</select></label>
      ${p.benchmark ? `<label><input type="checkbox" class="lb-bench"> This was my ${p.benchmark === '2000m' ? '2k' : "20'"} test</label>` : ''}</p>
    <p><button class="btn lb-confirm">Confirm</button> <span class="muted small lb-msg">If you do nothing, it counts after 20 hours${p.possibleMakeup ? ' (make-ups wait for you)' : ''}.</span></p></div>`;
}

function wireLogbookCard(card, p) {
  const type = card.querySelector('.lb-type');
  type.onchange = () => { card.querySelector('.lb-mk').hidden = type.value !== 'Make-up'; };
  card.querySelector('.lb-confirm').onclick = async (ev) => {
    const btn = ev.currentTarget, msg = card.querySelector('.lb-msg');
    btn.disabled = true;
    const bench = card.querySelector('.lb-bench');
    const res = await fetch('/api/concept2/confirm', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entryId: p.id, sessionType: type.value, makeupFor: card.querySelector('.lb-mkdate').value,
        rpe: card.querySelector('.lb-rpe').value, benchmark: bench && bench.checked ? p.benchmark : ''
      })
    });
    const out = await res.json().catch(() => ({}));
    if (res.ok) { card.innerHTML = '<h2>Found on Logbook</h2><p>Counted. Thanks!</p>'; setTimeout(() => card.remove(), 2500); }
    else { msg.textContent = out.error || 'Something went wrong.'; btn.disabled = false; }
  };
}

const LOGBOOK_RECHECK_MS = 60 * 1000;
async function loadLogbookPending(box) {
  const list = document.createElement('div');
  list.className = 'lb-list';
  box.prepend(list);
  const seen = new Set();
  const refresh = async () => {
    let pending;
    try { pending = (await api('/api/concept2/pending')).pending; } catch (e) { pending = null; }
    if (!list.isConnected) return;
    list.querySelectorAll('.lb-checking').forEach((n) => n.remove());
    if (!pending) return;
    const fresh = pending.filter((p) => !seen.has(p.id));
    fresh.forEach((p) => seen.add(p.id));
    if (fresh.length) {   // every waiting card at once
      const wrap = document.createElement('div');
      wrap.innerHTML = fresh.map(logbookCard).join('');
      wrap.querySelectorAll('.lb-pending').forEach((card) => wireLogbookCard(card, fresh.find((p) => p.id === card.dataset.id)));
      list.append(...wrap.children);
    }
  };
  list.innerHTML = '<p class="muted small lb-checking">Checking your Logbook…</p>';
  await refresh();
  const timer = setInterval(() => { if (!list.isConnected) clearInterval(timer); else refresh(); }, LOGBOOK_RECHECK_MS);
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
    ${none ? `<p class="muted small">${NO_TARGET}</p>` : ''}<p class="small today-links"><a class="btn log-btn" href="/logworkout" target="_blank" rel="noopener">Log a workout</a>
    <a href="#/week${id ? '/' + encodeURIComponent(id) : ''}">The rest of the week</a><a href="/guide" target="_blank" rel="noopener">How logging works</a></p></div>`;
}

/**
 * Week ahead. Athletes get their own targets and their own results vs goal;
 * coaches see everyone's results, can open any athlete's week (#/week/ID)
 * and can look back a week (#/week/prev, #/week/ID/prev).
 */
async function showWeek(id = null, prev = false) {
  const coach = isCoach();
  const q = coach && prev ? '?week=prev' : '';
  const v = await api((id ? '/api/week/' + encodeURIComponent(id) : '/api/week') + q);
  setNav('week');
  const range = `${fmtDate(v.weekStart, { month: 'short', day: 'numeric' })} to ${fmtDate(v.weekEnd, { month: 'short', day: 'numeric' })}`;
  const any = v.days.some((d) => d.sessions.length);
  const hash = (who, back) => '#/week' + (who ? '/' + encodeURIComponent(who) : '') + (back ? '/prev' : '');
  // Coaches pick any athlete to see her targets, and switch between last week and this one.
  const team = coach ? (await api('/api/team')).athletes : null;
  const tools = team ? `<div class="week-tools"><div class="seg" role="group">
        <a href="${hash(id, true)}" aria-current="${prev ? 'page' : 'false'}">Last week</a>
        <a href="${hash(id, false)}" aria-current="${prev ? 'false' : 'page'}">This week</a></div>
      <select id="pick" aria-label="Show targets for">
      <option value="">Whole team</option>
      ${team.map((a) => `<option value="${esc(a.id)}"${id === a.id ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>` : '';
  app.innerHTML = `${staleNote(v.meta)}<div class="head"><div><h1>${prev ? 'Last week' : 'Week ahead'}</h1>
      <p class="muted">${range}${v.athlete ? ` · ${esc(v.athlete.squad)} · targets for ${esc(v.athlete.name)}` : ''}</p></div>
      ${tools}</div>
    ${v.noTargets ? `<div class="card"><p>${NO_TARGET}</p></div>` : ''}
    ${any ? v.days.map((d) => `<div class="card day${d.day === v.today ? ' is-today' : ''}${d.day < v.today ? ' past' : ''}">
        <h2>${fmtDay(d.day)}${d.day === v.today ? ' <span class="pill good">Today</span>' : ''}</h2>
        ${d.sessions.length ? d.sessions.map((s) => sessionBlock({ ...s, day: d.day }, !!v.athlete, v.today)).join('') : '<p class="muted small">Nothing scheduled.</p>'}</div>`).join('')
      : '<div class="card"><p class="muted">The plan for this week hasn\'t been published yet.</p></div>'}
    <p class="muted small">Targets come from your best 2k or 20' this school year. Steady pieces show a range; hard pieces show one number.
      Logged splits: ✓ in range, ↓ under target, ↑ over target. * BikeErg split per 1000m, which lines up with the RowErg /500m target; BikeErg never counts as a benchmark. Other machines show no split.</p>${footer(v.meta)}`;
  const pick = document.getElementById('pick');
  if (pick) pick.onchange = () => { location.hash = hash(pick.value, prev); };
  wireResultsSort(app);
  wireFooter();
}

async function showBoards() {
  const v = await api('/api/leaderboards');
  setNav('boards');
  const state = { test: store.get('wrc.board') || '2000m', window: store.get('wrc.window') || 'season', group: store.get('wrc.boardGroup') || 'all' };
  const mine = me();
  const render = () => {
    const t = v.tests.find((x) => x.test === state.test) || v.tests[0];
    const rows = state.group === 'all' ? t[state.window] : t[state.group][state.window];
    const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([k, label]) =>
      `<button data-k="${key}" data-v="${k}" aria-pressed="${state[key] === k}">${label}</button>`).join('')}</div>`;
    app.innerHTML = `${staleNote(v.meta)}<div class="head"><div><h1>Leaderboards</h1>
      <p class="muted">Raw erg scores. School year starts ${fmtDate(v.yearStart, { month: 'short', day: 'numeric' })}.</p></div></div>
      <div class="filters">${seg('test', v.tests.map((x) => [x.test, TEST_LABELS[x.test]]))}
        ${seg('window', [['season', 'School year'], ['allTime', 'All time']])}
        ${seg('group', [['all', 'All'], ['varsity', 'Varsity (10th-12th)'], ['freshman', 'Fr/Nov (7th-9th)']])}</div>
      <div class="card board">${rows.length ? `<div class="table-wrap"><table>
        <tr><th class="r">#</th><th>Name</th><th class="r">${state.test === '20min' || state.test === '30r20' ? 'Meters' : 'Time'}</th><th class="r">Split</th><th class="r rate">Rate</th><th class="date">Date</th></tr>
        ${rows.map((r, i) => `<tr${mine && mine.id === r.id ? ' class="me"' : ''}><td class="r">${i + 1}</td>
          <td><a href="#/athlete/${esc(r.id)}">${esc(r.name)}</a>${r.alum ? ' <span class="pill">alum</span>' : ''}
            <div class="sub">${r.stars === null ? '' : `<span class="stars" aria-label="${r.stars} stars">${starText(r.stars)}</span>`}${state.group === 'all' && r.group ? ` <span class="muted">${r.group === 'freshman' ? 'Fr/Nov' : 'Varsity'} piece</span>` : ''}</div></td>
          <td class="r">${fmtResult(r)}</td><td class="r">${split(r)}</td><td class="r rate">${r.avgRate || '–'}</td><td class="date">${r.dateApprox ? esc(r.schoolYear) : fmtDate(r.date)}</td></tr>`).join('')}
      </table></div>` : '<p class="muted">No results yet.</p>'}</div>${footer(v.meta)}`;
    app.querySelectorAll('[data-k]').forEach((b) => {
      b.onclick = () => {
        state[b.dataset.k] = b.dataset.v;
        store.set({ test: 'wrc.board', window: 'wrc.window', group: 'wrc.boardGroup' }[b.dataset.k], b.dataset.v);
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
  const groups = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1].map((n) => ({ n, rows: v.rowers.filter((r) => r.stars === n) }));
  const untested = v.rowers.filter((r) => r.stars === null);
  const cur = v.teamGms[0], prev = v.teamGms[1];
  const keys = ['team', 'varsity', 'novice', 'rank1_8', 'rank9_16', 'rank17'];
  const avg = (y, k) => (!y ? '–' : y.groups[k].hidden || y.groups[k].avg === null ? '–' : y.groups[k].avg.toFixed(1) + '%');
  app.innerHTML = `${staleNote(v.meta)}<div class="head"><div><h1>Stars</h1>
    <p class="muted">Average of each rower's 2k and 20' stars this school year (one test: that test's stars). Every 2k or 20' earns ★. More stars at 95%, 96%, 97% and 100% of the Gold Medal Standard (100% = 1v8 speed).</p></div></div>
    ${groups.map((g) => g.rows.length ? `<div class="card"><h2><span class="stars" aria-label="${starWord(g.n)}">${starText(g.n)}</span> ${starWord(g.n)} <span class="muted small">${g.rows.length}</span></h2>
      <div class="athletes">${g.rows.map((r) => `<a href="#/athlete/${esc(r.id)}"><span>${esc(r.name)}<span class="by-test muted small">${['2000m', '20min'].map((t) => r.byTest[t] === null ? '' : `${TEST_LABELS[t]} ${r.byTest[t]}★`).filter(Boolean).join(' · ')}</span></span><span class="pill">${esc(r.squad)}</span></a>`).join('')}</div></div>` : '').join('')}
    ${untested.length ? `<div class="card"><h2>No 2k or 20' yet this season</h2><p class="muted small">${untested.map((r) => esc(r.name)).join(', ')}</p></div>` : ''}
    <div class="card"><h2>Team Gold Medal Standard</h2>
      <p class="muted small">Average of each rower's best GMS % this school year, through ${fmtDate(cur.throughDate)}${prev ? `, next to last year through the same date` : ''}. Groups under 3 rowers are hidden.</p>
      <div class="table-wrap"><table><tr><th>Group</th><th class="r">${esc(cur.schoolYear)}</th>${prev ? `<th class="r">${esc(prev.schoolYear)}</th>` : ''}</tr>
      ${keys.map((k) => `<tr><td>${esc(cur.groups[k].label)}</td><td class="r">${avg(cur, k)}</td>${prev ? `<td class="r">${avg(prev, k)}</td>` : ''}</tr>`).join('')}
      </table></div><p class="muted small">Ranks use raw erg speed.</p></div>${footer(v.meta)}`;
  wireFooter();
}

/** Coaches only: load jumps, effort, trends and consistency for every rower. */
async function showInsights() {
  const v = await api('/api/insights');
  setNav('insights');
  const loadCell = (w) => `<td class="r">${fmtMin(w.total)}</td><td class="r">${w.changePct === null ? '<span class="muted">–</span>'
    : `${w.flag ? '<span class="pill warn">▲ ' : ''}${w.changePct > 0 ? '+' : ''}${w.changePct}%${w.flag ? '</span>' : ''}`}</td>`;
  const trend = (t) => (!t ? '<span class="muted">–</span>' : Math.abs(t.changeS) < 0.5 ? 'same'
    : `<span class="${t.changeS < 0 ? 'good-text' : ''}">${t.changeS < 0 ? '▲' : '▼'} ${Math.abs(t.changeS).toFixed(1)}s</span>`);
  const flagged = v.rowers.filter((r) => r.thisWeek.flag || r.lastWeek.flag).length;
  const missedFlagged = v.rowers.filter((r) => r.missed.flag).length;
  app.innerHTML = `${staleNote(v.meta)}<div class="head"><div><h1>Insights</h1>
    <p class="muted">Coaches only. Weighted minutes against each rower's average for the 3 weeks before (fewer in her first weeks); ▲ means more than ${v.jumpPct}% above it. ${flagged ? `<b>${flagged} flagged.</b>` : 'Nobody flagged.'} ${missedFlagged ? `<b>${missedFlagged} missing practices without making them up.</b>` : ''}</p></div></div>
    <div class="card"><div class="table-wrap"><table class="insights">
      <tr><th>Rower</th><th class="r" colspan="2">This week so far</th><th class="r" colspan="2">Last week</th><th class="r">RPE last week</th>
        <th class="r">Steady split</th><th class="r">Est. 2k</th><th class="r">${fmtDate(v.today, { month: 'long' })}</th><th class="r">Streak</th><th class="r">Missed, 4 wks</th></tr>
      ${v.rowers.map((r) => `<tr><td><a href="#/athlete/${encodeURIComponent(r.id)}">${esc(r.name)}</a> <span class="muted small">${esc(r.squad)}</span></td>
        ${loadCell(r.thisWeek)}${loadCell(r.lastWeek)}<td class="r">${r.lastWeek.rpe ?? ''}</td>
        <td class="r">${trend(r.splitTrend)}</td><td class="r">${r.projected2k ? fmtTime(r.projected2k) : ''}</td>
        <td class="r">${r.month.pct === null ? '–' : `${r.month.pct}% <span class="muted small">${r.month.done}/${r.month.expected}</span>`}</td>
        <td class="r">${r.month.streak}</td>
        <td class="r">${r.missed.count ? `${r.missed.flag ? '<span class="pill warn">' : '<span>'}${r.missed.count}</span><div class="muted small">${r.missed.open} open · ${r.missed.overdue} overdue</div>` : '<span class="muted">0</span>'}</td></tr>`).join('')}
    </table></div>
    <p class="muted small">Steady split: her latest weeks of Aerobic erg work against the weeks before (▲ faster). Est. 2k: from a 20' newer than her last 2k. Month: planned practices logged, make-ups count. Missed: practices not logged or made up in the last ${v.missedWindowDays} days (open = still inside the make-up window, overdue = past it); ${v.missedFlagAt} or more is flagged. Open a rower for her charts.</p></div>
    ${footer(v.meta)}`;
  wireFooter();
}

/** Coaches only: 100m vs 2k vs 20' in watts, beside Paul's Law and the tracker's rules. */
async function showBalance() {
  const v = await api('/api/balance');
  setNav('balance');
  const dash = '<span class="muted">–</span>';
  const gap = (g) => !g ? `<td class="r" colspan="4">${dash}</td>`
    : `<td class="r">${g.ratioPct}%${g.weak ? ' <span class="pill warn" title="Results far apart in time">weak</span>' : ''}<div class="muted small">${g.wattsHi}/${g.wattsLo} W · ${g.daysApart}d apart</div></td>
       <td class="r">${g.avgRatioPct}% <span class="muted small">${g.pairs} pair${g.pairs === 1 ? '' : 's'}</span></td>
       <td class="r">${g.rules.paul.ratioPct}%</td><td class="r">${g.rules.tracker.ratioPct}%</td>`;
  const sum = (s) => `${s.rowers} rowers · actual ${s.ratioPct ?? '–'}% · Paul ${s.paulPct ?? '–'}% · tracker rule ${s.trackerPct ?? '–'}%`;
  app.innerHTML = `${staleNote(v.meta)}<div class="head"><div><h1>Balance</h1>
    <p class="muted">Coaches only. Watts ratio of a shorter, harder piece to a longer one, from each rower's last ${v.windowDays} days. Results close in time count more (half the recency score at ${v.halfLifeDays} days apart); weak means under ${v.weakBelow} recency. Not shown to athletes.</p></div></div>
    <div class="card"><div class="table-wrap"><table class="insights">
      <tr><th rowspan="2">Rower</th><th class="r" colspan="4">100m vs 2k</th><th class="r" colspan="4">2k vs 20'</th></tr>
      <tr><th class="r">Best pair</th><th class="r">Average</th><th class="r">Paul's Law</th><th class="r">Tracker rule</th>
        <th class="r">Best pair</th><th class="r">Average</th><th class="r">Paul's Law</th><th class="r">Tracker rule</th></tr>
      ${v.rowers.map((r) => `<tr><td><a href="#/athlete/${encodeURIComponent(r.id)}">${esc(r.name)}</a> <span class="muted small">${esc(r.squad)}</span></td>${gap(r.sprint)}${gap(r.endurance)}</tr>`).join('')}
    </table></div>
    <p class="muted small">Team means (best pair): 100m vs 2k: ${sum(v.sprint)}. 2k vs 20': ${sum(v.endurance)}.</p>
    <p class="muted small">Best pair: the 2k and the other piece closest in time. Average: all her pairs, weighted the same way. Paul's Law: +5 s per 500 m for each doubling of distance, applied to that pair's 2k (outside its 1k to 10k range for 100m). Tracker rule: 20' split = 2k split + 8.5 s; 100m split = 0.786 x 2k split. The 100m watts use the 100m average split, standing start included. Ratio = shorter piece watts / longer piece watts. Open a rower for her tests.</p></div>
    ${footer(v.meta)}`;
  wireFooter();
}

async function showOyo() {
  const v = await api('/api/oyo');
  setNav('oyo');
  let which = 'now';
  const mine = me();
  const render = () => {
    const rows = v.rowers.map((r) => (which === 'now' ? r : { ...r, ...r.lastWeek }))
      .sort((x, y) => y.minutes / y.required - x.minutes / x.required || x.name.localeCompare(y.name));
    const met = rows.filter((r) => r.status !== 'short').length, elite = rows.filter((r) => r.status === 'elite').length;
    // One scale for every bar, so the Required and Elite marks line up down the board.
    // Capped at 150% of the largest Elite goal: a bar stops growing past that, so one big week can't shrink everyone else's.
    const max = Math.max(1, ...rows.map((r) => r.elite * 1.5));
    app.innerHTML = `${staleNote(v.meta)}<div class="head"><div><h1>OYO goals</h1>
      <p class="muted">Week of ${fmtDate(which === 'now' ? v.weekStart : v.lastWeekStart)}${(which === 'now' ? v.breakWeek : v.lastBreakWeek) ? ' · <b>break week goals</b>' : ''} · ${met} of ${rows.length} at Required · ${elite} at Elite</p></div>
      <div class="seg" role="group"><button data-w="now" aria-pressed="${which === 'now'}">This week</button><button data-w="last" aria-pressed="${which === 'last'}">Last week</button></div></div>
      <div class="card">${rows.map((r) => {
        return `<div class="oyo-row${mine && mine.id === r.id ? ' me' : ''}">
          <div class="oyo-name"><a href="#/athlete/${esc(r.id)}">${esc(r.name)}</a> <span class="muted small">${fmtMin(r.minutes)} / ${r.required}m${r.status === 'elite' ? ' · Elite' : ''}${which === 'now' && r.streak > 1 ? ` · ${r.streak} wk streak` : ''}</span></div>
          <div class="meter slim"><div class="fill ${r.status}" style="width:${Math.min(100, (100 * r.minutes) / max)}%"></div>
            <div class="mark" style="left:${(100 * r.required) / max}%"></div><div class="mark" style="left:${(100 * r.elite) / max}%"></div></div></div>`;
      }).join('')}<p class="muted small">Marks: Required and Elite. All bars share one scale, so the marks line up across athletes. A bar stops at 150% of Elite. Weighted minutes (run 1.2, bike 0.6, …). Minutes past Elite count in totals only.</p></div>${footer(v.meta)}`;
    app.querySelectorAll('[data-w]').forEach((b) => { b.onclick = () => { which = b.dataset.w; render(); }; });
    wireFooter();
  };
  render();
}

function bestsTable(v) {
  if (!v.bests.length) return '<p class="muted">No tests yet.</p>';
  // Split under the season result and date under the all-time result, so it fits a phone (David, 2026-10-28).
  return `<div class="table-wrap"><table><tr><th>Test</th><th class="r">This season</th><th class="r">All time</th></tr>
    ${v.bests.map((b) => `<tr><td>${TEST_LABELS[b.test]}</td>
      <td class="r">${b.season ? fmtResult(b.season) : '–'}<div class="muted small">${b.season ? split(b.season) : ''}</div></td>
      <td class="r">${fmtResult(b.allTime)}<div class="muted small">${fmtDate(b.allTime.date, { month: '2-digit', day: '2-digit', year: '2-digit' })}</div></td></tr>`).join('')}
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
  // Four columns fit a phone. Tap a row for the rest; the detail row sits under it.
  return `<div class="table-wrap"><table><tr><th>Date</th><th>Type</th><th>Activity</th><th class="r">Minutes</th></tr>
    ${rows.map((r) => {
      const extra = [
        r.mainSet && `Main set: ${esc(r.mainSet)}`, r.zone && `Zone: ${esc(r.zone)}`,
        r.status !== 'Out' && `Weighted: ${fmtMin(r.weighted)}`, r.meters && `Meters: ${fmtNum(r.meters)}`,
        r.rpe != null && `RPE ${r.rpe}`
      ].filter(Boolean).join(' · ');
      return `<tr class="session-row"><td>${fmtDate(r.date)}</td>
      <td>${esc(r.type)}${r.status && r.status !== 'Full' ? ` <span class="pill">${esc(r.status)}</span>` : ''}${r.makeupFor ? ` <span class="muted small">for ${fmtDate(r.makeupFor)}</span>` : ''}</td>
      <td>${esc(r.activity)}</td><td class="r">${r.status === 'Out' ? '' : fmtMin(r.minutes)}</td></tr>
      <tr class="detail-row" hidden><td colspan="4" class="small detail">${extra || 'Nothing else logged.'}</td></tr>`;
    }).join('')}
  </table></div>`;
}

// ---- router --------------------------------------------------------------

async function route() {
  tip.hidden = true;
  const h = location.hash.replace(/^#\/?/, '');
  const [page, arg] = h.split('/');
  try {
    if (!SESSION) {
      const saved = savedSession();
      if (saved) {
        // Open the page now; check the session in the background and redraw if it changed.
        SESSION = saved;
        api('/api/session').then((s) => {
          const was = JSON.stringify(saved);
          setSession(s);
          if (JSON.stringify(SESSION) !== was) route();
        }).catch(() => {});
      } else {
        setSession(await api('/api/session'));
      }
    }
    if (page === 'team') return await showTeam();
    if (page === 'athletes') return await showAthletes();
    if (page === 'week') {
      const rest = h.split('/').slice(1).filter(Boolean);
      const who = rest.find((x) => x !== 'prev');
      return await showWeek(who ? decodeURIComponent(who) : null, rest.includes('prev'));
    }
    if (page === 'boards') return await showBoards();
    if (page === 'stars' && isCoach()) return await showStars();
    if (page === 'insights' && isCoach()) return await showInsights();
    if (page === 'balance' && isCoach()) return await showBalance();
    if (page === 'oyo') return await showOyo();
    if (page === 'athlete' && arg) return await showAthlete(decodeURIComponent(arg));
    if (page === 'workout' && arg) return await showWorkout(decodeURIComponent(arg));
    const m = me();
    if (page === 'me' && m) return await showAthlete(m.id);
    location.replace(m ? '#/me' : '#/team');
  } catch (err) {
    showError(err);
  }
}

window.addEventListener('hashchange', route);
route();
