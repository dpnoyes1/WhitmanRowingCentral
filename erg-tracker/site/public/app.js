// Whitman Rowing team site. Plain JS, hash routes:
// #/team, #/week, #/boards, #/stars, #/insights, #/completion, #/balance, #/settings, #/oyo, #/athletes, #/athlete/A001, #/me, #/workout/E-ID
// Data comes from /api/* behind a sign-in (an HttpOnly cookie). Athletes sign
// in as themselves (name + birthday); coaches with their own password.

import { loadPractice } from './practice.mjs';
import { openPlan } from './plan.mjs';
import { openLogMine } from './logmine.mjs';
import { shrinkPhoto } from './photo.mjs';
import { openLineups } from './lineups.mjs';

const app = document.getElementById('app');
const practiceBox = document.getElementById('practice');
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
  SESSION = s && { kind: s.kind, athlete: s.athlete, coachName: s.coachName || null };
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

const API_TIMEOUT_MS = 15000;
let returnTo = '';   // the page to go back to after signing in again
async function api(path) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), API_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' }, signal: ctl.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('This is taking too long. Check your connection and try again.');
    throw new Error(navigator.onLine === false ? 'You are offline. Reconnect and try again.' : 'Could not reach the site. Check your connection and try again.');
  } finally { clearTimeout(timer); }
  if (res.status === 401) {
    const was = !!SESSION;
    setSession(null);
    if (location.hash && location.hash !== '#/') returnTo = location.hash;
    showLogin(was ? 'You were signed out. Please sign in again.' : '');
    throw new Error('signin');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || (res.status >= 500 ? 'The site had a problem. Try again in a minute.' : 'Something went wrong.'));
  return body;
}

const isCoach = () => !!SESSION && SESSION.kind === 'team';

function setNav(active) {
  // Today's practice shows only on the page each person lands on after signing in: Team for coaches, Me for athletes.
  if (active === (isCoach() ? 'team' : 'me')) showPractice(); else practiceBox.hidden = true;
  document.getElementById('nav').hidden = false;
  document.getElementById('menu').hidden = false;
  document.getElementById('log-top').hidden = false;
  document.body.classList.add('authed');
  document.getElementById('tabbar').hidden = false;
  closeMenu();
  const m = me();
  const link = document.getElementById('nav-me');
  link.hidden = !m;
  document.getElementById('tab-me').hidden = !m;
  if (m) link.querySelector('.t').textContent = m.name.split(' ')[0];
  const coachName = isCoach() && SESSION.coachName ? SESSION.coachName : '';
  const who = m ? m.name : (isCoach() ? 'Coach' : '');
  const card = document.getElementById('usercard');
  card.hidden = !who;
  if (who) {
    // Coaches: "Coach" on the first line and the full name under it (David, 2026-11-03).
    document.getElementById('user-name').textContent = isCoach() ? 'Coach' : who;
    document.getElementById('user-role').textContent = isCoach() ? coachName : 'Athlete';
    document.getElementById('user-av').textContent = (coachName || who).trim().charAt(0).toUpperCase();
    document.getElementById('um-password').hidden = !isCoach();
  }
  document.getElementById('nav-stars').hidden = !isCoach();
  document.getElementById('nav-insights').hidden = !isCoach();
  document.getElementById('nav-balance').hidden = !isCoach();
  document.getElementById('nav-completion').hidden = !isCoach();
  document.getElementById('nav-lineups').hidden = !isCoach();
  document.getElementById('nav-weights').hidden = !isCoach();
  document.getElementById('nav-plan').hidden = !isCoach();
  document.getElementById('sec-coach').hidden = !isCoach();
  document.getElementById('nav-log-for').hidden = !isCoach();
  document.getElementById('nav-log-mine').hidden = isCoach() || !SESSION;
  document.getElementById('nav-settings').hidden = !isCoach();
  document.querySelectorAll('#side a[data-nav], #tabbar a[data-nav]').forEach((a) => {
    const on = a.dataset.nav === active;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

/** Side navigation (David, 2026-11-02): a panel on the left on wide screens; on phones it slides in over the page from the menu button or the More tab. */
function setMenu(open) {
  document.body.classList.toggle('menu-open', open);
  for (const id of ['menu', 'menu-tab']) document.getElementById(id).setAttribute('aria-expanded', String(open));
}
function closeMenu() { setMenu(false); }
for (const id of ['menu', 'menu-tab']) {
  document.getElementById(id).onclick = () => setMenu(!document.body.classList.contains('menu-open'));
}
document.getElementById('scrim').onclick = closeMenu;
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeMenu(); });
document.getElementById('side').addEventListener('click', (ev) => { if (ev.target.closest('a')) closeMenu(); });

/** Icon-only sidebar on wide screens, remembered on this device only. */
const SIDE_KEY = 'wrc.side';
function setCollapsed(on) {
  document.body.classList.toggle('collapsed', on);
  const b = document.getElementById('collapse');
  b.setAttribute('aria-pressed', String(on));
  const label = on ? 'Expand sidebar' : 'Collapse sidebar';
  b.title = label; b.setAttribute('aria-label', label);
}
try { setCollapsed(localStorage.getItem(SIDE_KEY) === '1'); } catch { /* private mode */ }
document.getElementById('collapse').onclick = () => {
  const on = !document.body.classList.contains('collapsed');
  setCollapsed(on);
  try { localStorage.setItem(SIDE_KEY, on ? '1' : '0'); } catch { /* private mode */ }
};

/**
 * Today's practice status above every signed-in page (David, 2026-11-02), read live from the
 * "Is Whitman Rowing Today" Sheet so the girls check one site. Today only, visitor's local date.
 * Refreshed when older than 5 minutes; a failed load shows one quiet line and never blocks the page.
 */
let practiceAt = 0, practiceLoading = false, practiceFailedAt = 0;
function showPractice() {
  if (practiceLoading || (practiceFailedAt && Date.now() - practiceFailedAt < 60 * 1000)) return;
  practiceBox.hidden = false;
  if (practiceLoading || (practiceBox.innerHTML && Date.now() - practiceAt < 5 * 60 * 1000)) return;
  practiceLoading = true;
  if (!practiceBox.innerHTML) practiceBox.innerHTML = '<p class="muted small">Checking today’s practice…</p>';
  loadPractice().then((p) => {
    // Girls only (David, 2026-11-02): "Monday 11/2" then "Early Shift: 3:30–5:30 PM". No big Yes; No and Partial still say so.
    const d = new Date(p.iso + 'T12:00:00');
    const when = `${d.toLocaleDateString('en-US', { weekday: 'long' })} ${d.getMonth() + 1}/${d.getDate()}`;
    const head = p.status === 'YES' ? '' : `<p class="status">${p.status === 'NO' ? 'No practice' : 'Partial practice'}</p>`;
    const line = p.shifts ? `${p.shifts.girlsEarly ? 'Early' : 'Late'} Shift: ${esc(p.shifts.girls)}` : esc(p.note);
    practiceBox.innerHTML = `<div class="card practice st-${p.status.toLowerCase()}">
      <h2>${esc(when)}</h2>${head}<p class="note">${line}</p>${p.cachedAt ? `<p class="muted small">Saved copy from ${esc(new Date(p.cachedAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))}. Check Slack for changes.</p>` : ''}</div>`;
    practiceAt = Date.now();
  }).catch(() => {
    // Quiet failure: no error line above a page that loaded fine; try again in a minute, not on every tab.
    if (!practiceAt) { practiceBox.innerHTML = ''; practiceBox.hidden = true; }
    practiceFailedAt = Date.now();
  }).finally(() => { practiceLoading = false; });
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

// Click the name card for the menu: Log out, and for coaches Change password.
const userMenu = document.getElementById('user-menu'), userBtn = document.getElementById('usercard-btn');
function setUserMenu(open) { userMenu.hidden = !open; userBtn.setAttribute('aria-expanded', String(open)); }
userBtn.onclick = (ev) => { ev.stopPropagation(); setUserMenu(userMenu.hidden); };
document.addEventListener('click', (ev) => { if (!userMenu.hidden && !ev.target.closest('#user-menu')) setUserMenu(false); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !userMenu.hidden) { setUserMenu(false); userBtn.focus(); } });
document.getElementById('um-logout').onclick = () => { setUserMenu(false); signOut(); };
const pwDialog = document.getElementById('pw-dialog'), pwMsg = document.getElementById('pw-msg');
document.getElementById('um-password').onclick = () => {
  setUserMenu(false); closeMenu();
  document.getElementById('pw-form').reset(); pwMsg.textContent = ''; pwMsg.className = 'error small';
  pwDialog.showModal ? pwDialog.showModal() : pwDialog.setAttribute('open', '');
  document.getElementById('pw-current').focus();
};
document.getElementById('pw-cancel').onclick = () => pwDialog.close();
document.getElementById('pw-form').onsubmit = async (ev) => {
  ev.preventDefault();
  const cur = document.getElementById('pw-current').value, nx = document.getElementById('pw-new').value, again = document.getElementById('pw-again').value;
  pwMsg.className = 'error small';
  if (nx !== again) { pwMsg.textContent = 'The two new passwords do not match.'; return; }
  const btn = document.getElementById('pw-save'); btn.disabled = true; pwMsg.textContent = '';
  try {
    const res = await fetch('/api/password', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ current: cur, next: nx }) });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) { pwDialog.close(); setSession(null); showLogin('You were signed out. Please sign in again.'); return; }
    if (!res.ok) { pwMsg.textContent = body.error || 'Could not save the password.'; return; }
    pwMsg.className = 'good-text small'; pwMsg.textContent = 'Saved. Use it the next time you sign in.';
    document.getElementById('pw-form').reset();
    setTimeout(() => { if (pwDialog.open) pwDialog.close(); }, 1500);
  } catch { pwMsg.textContent = 'Could not reach the site. Check your connection and try again.'; }
  finally { btn.disabled = false; }
};

function wireFooter() {
  const b = document.getElementById('signout');
  if (b) b.onclick = signOut;
}

function showError(err) {
  if (err.message === 'signin') return;
  app.innerHTML = `<div class="card"><p class="error">${esc(err.message)}</p><button class="btn ghost" id="retry">Try again</button></div>`;
  document.getElementById('retry').onclick = () => { app.innerHTML = SKELETON; route(); };
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
  if (!total) return '<p class="empty">No sessions logged yet.</p>';
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
  if (!have.length) return '<p class="empty">Nothing logged yet.</p>';
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

function showLogin(note = '') {
  practiceBox.hidden = true;
  document.getElementById('nav').hidden = true;
  document.getElementById('menu').hidden = true;
  document.getElementById('log-top').hidden = true;
  document.body.classList.remove('authed');
  document.getElementById('tabbar').hidden = true;
  closeMenu();
  app.innerHTML = `<div class="login card">
    <h1>Whitman Rowing</h1>
    <p class="muted">Athletes: your first and last name, and your birthday as the password (MM/DD/YYYY) the first time; you then choose your own password. If you forget it, ask a coach to reset it. Coaches: your full name, and your birthday the first time (then set your own password from the menu).</p>
    ${note ? `<p class="notice" role="status">${esc(note)}</p>` : ''}
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
    if (res.status === 429) return done('Too many sign-ins from this network right now. Wait a minute and try again.');
    if (body.mustChange && res.status === 200) { done(''); return chooseLoginPassword(document.getElementById('name').value, document.getElementById('pw').value); }
    if (!res.ok) return done(body.error || 'Could not sign in.');
    store.set(OLD_ME_KEY, null);
    setSession(null);
    const back = returnTo; returnTo = '';
    if (back && back !== '#/') { if (location.hash === back) route(); else location.hash = back; } else { location.hash = '#/'; route(); }
  };
}

/** Athlete first sign-in or after a coach reset (David, 2026-11-12): choose a password of 6 or more characters before the session starts. */
function chooseLoginPassword(name, current) {
  const card = app.querySelector('.login');
  card.innerHTML = `<h1>Choose your password</h1>
    <p class="muted">Pick a password you will remember, at least 6 characters. You will use it to sign in from now on, and your birthday will no longer work.</p>
    <form id="choosepw">
      <label for="npw" class="small">New password</label>
      <input id="npw" type="password" autocomplete="new-password" required minlength="6">
      <label for="npw2" class="small">Type it again</label>
      <input id="npw2" type="password" autocomplete="new-password" required minlength="6">
      <button class="btn" type="submit" id="savepw"><span class="spinner" aria-hidden="true"></span><span class="label">Save and sign in</span></button>
      <p id="choose-err" class="error small" role="alert"></p>
    </form>`;
  document.getElementById('npw').focus();
  document.getElementById('choosepw').onsubmit = async (ev) => {
    ev.preventDefault();
    const err = document.getElementById('choose-err'), btn = document.getElementById('savepw');
    const a = document.getElementById('npw').value, b = document.getElementById('npw2').value;
    err.textContent = '';
    if (a.trim().length < 6) { err.textContent = 'Your password needs at least 6 characters.'; return; }
    if (a !== b) { err.textContent = 'The two passwords do not match.'; return; }
    if (btn.disabled) return;
    btn.disabled = true; btn.classList.add('busy');
    const fail = (msg) => { btn.disabled = false; btn.classList.remove('busy'); err.textContent = msg; };
    let res, out;
    try {
      res = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, password: current, newPassword: a }) });
      out = await res.json().catch(() => ({}));
    } catch { return fail('Could not reach the site. Check your connection and try again.'); }
    if (res.status === 401) return showLogin('That did not work. Please sign in again.');
    if (!res.ok) return fail(out.error || 'Could not save your password.');
    store.set(OLD_ME_KEY, null);
    setSession(null);
    const back = returnTo; returnTo = '';
    if (back && back !== '#/') { if (location.hash === back) route(); else location.hash = back; } else { location.hash = '#/'; route(); }
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
      ${teamTodayCard(wk, squad)}
      ${t.notLogged ? notLoggedCard(t.notLogged, squad) : ''}
      ${t.splits ? splitsCard(t.splits) : ''}
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

/** Coaches only: average season-best split for each group, 2k and 20' together (David, 2026-10-25). */
function splitsCard(s) {
  return `<div class="card"><h2>Average season-best results</h2>
    <div class="table-wrap"><table><tr><th>Group</th><th class="r">2k Time</th><th class="r">2k Split</th><th class="r">20' Meters</th><th class="r">20' Split</th><th class="r">Average Stars</th></tr>
    ${s.groups.map((g) => `<tr><td>${esc(g.label)}</td>
      <td class="r">${g.twoK.avgTime === null ? '–' : fmtTime(g.twoK.avgTime)}</td>
      <td class="r">${g.twoK.avgSplit === null ? '–' : fmtTime(g.twoK.avgSplit)}</td>
      <td class="r">${g.twenty.avgMeters === null ? '–' : fmtNum(g.twenty.avgMeters)}</td>
      <td class="r">${g.twenty.avgSplit === null ? '–' : fmtTime(g.twenty.avgSplit)}</td>
      <td class="r">${g.avgStars === null ? '–' : g.avgStars.toFixed(1)}</td></tr>`).join('')}
    </table></div></div>`;
}

/**
 * Team page: today's workout for the chosen squad (an athlete always sees
 * her own, with her targets). Nothing today: the next scheduled day this week.
 */
/** Coaches: rowers with nothing logged yet this week, for the chosen squad. */
function notLoggedCard(nl, squad) {
  const list = nl.rowers.filter((r) => squad === 'all' || r.squad.toLowerCase() === squad);
  return `<div class="card"><h2>Not logged yet this week <span class="pill ${list.length ? 'warn' : 'good'}">${list.length}</span></h2>
    ${list.length ? `<p class="small">${list.map((r) => `<a href="#/athlete/${esc(r.id)}">${esc(r.name)}</a>`).join(' · ')}</p><p class="muted small">Nothing logged since Monday ${fmtDate(nl.weekStart)}.</p>` : '<p class="muted">Everyone has logged something this week.</p>'}</div>`;
}

function teamTodayCard(wk, squad) {
  if (!wk) return '';
  // An athlete's week is already her squad only; coaches follow the squad switch.
  const noviceOwn = (d, x) => squad === 'novice' && /^varsity$/i.test(x.squad) && !wk.days.some((dd) => dd.day === d && dd.sessions.some((y) => y.session === x.session && /^novice$/i.test(y.squad)));
  const forSquad = (x, d) => !!wk.athlete || squad === 'all' || !/^(varsity|novice)$/i.test(x.squad) || x.squad.toLowerCase() === squad || noviceOwn(d, x);
  const days = wk.days.filter((d) => d.day >= wk.today).map((d) => ({ ...d, sessions: d.sessions.filter((x) => forSquad(x, d.day)) })).filter((d) => d.sessions.length);
  const d = days[0];
  const title = !d ? 'Today' : d.day === wk.today ? 'Today' : `Next: ${fmtDay(d.day)}`;
  const body = d ? d.sessions.map((x) => sessionBlock({ ...x, results: undefined }, !!wk.athlete)).join('')
    : '<p class="muted small">Nothing scheduled for the rest of this week.</p>';
  return `<div class="card today"><h2>${title}</h2>${body}<p class="small"><a href="#/week">The whole week</a></p></div>`;
}

function recentList(t) {
  const names = Object.fromEntries(t.athletes.map((a) => [a.id, a.name]));
  if (!t.recent.length) return '<p class="empty">Nothing logged yet.</p>';
  // Activity sits under the name so the table fits a phone (David, 2026-10-28).
  return `<div class="table-wrap"><table>${t.recent.map((r) => `<tr>
    <td>${fmtDate(r.date)}</td><td><a href="#/athlete/${esc(r.athleteId)}">${esc(names[r.athleteId] || '')}</a>
    <div class="muted small">${esc(r.test ? r.mainSet : r.type)}${r.activity && r.activity !== 'Erg (RowErg)' ? ' · ' + esc(r.activity) : ''}</div></td>
    <td class="r">${fmtMin(r.minutes)}</td></tr>`).join('')}</table></div>`;
}

async function showAthletes() {
  // Coaches see a Concept2 icon next to each athlete connected to Logbook (David, 2026-11-12). A failed lookup just hides the icons.
  const [t, c2] = await Promise.all([api('/api/team'), isCoach() ? api('/api/concept2/status').catch(() => null) : null]);
  const linked = new Set(c2 && Array.isArray(c2.connected) ? c2.connected.map((c) => c.id) : []);
  setNav('athletes');
  const mine = me();
  app.innerHTML = `<div class="head"><div><h1>Athletes</h1><p class="muted">${t.athletes.length} rowers</p></div>
    <div style="min-width:220px"><input type="search" id="q" placeholder="Find a name" aria-label="Find a name"></div></div>
    ${['Varsity', 'Novice'].map((sq) => `<div class="card" data-squad><h2>${sq}</h2><div class="athletes">
      ${t.athletes.filter((a) => a.squad === sq).map((a) => `<a href="#/athlete/${esc(a.id)}" data-name="${esc(a.name.toLowerCase())}">
        <span>${esc(a.name)}${mine && mine.id === a.id ? ' (you)' : ''}${a.stars === null ? '' : `<span class="stars small" role="img" aria-label="${starWord(a.stars)}">${starText(a.stars)}</span>`}${linked.has(a.id) ? '<img class="c2" src="/icons/concept2.png" alt="Connected to Concept2 Logbook" title="Connected to Concept2 Logbook" width="18" height="18">' : ''}</span><span class="pill">${esc(a.grade)}</span></a>`).join('')}
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
  const toElite = w.oyoStatus === 'elite' ? '' : ` · ${fmtMin(Math.max(0, a.oyoElite - w.oyoMin))} to Elite`;
  const makeups = v.openMakeups.length ? `<div class="card"><h2>Make-ups open</h2>
      ${v.openMakeups.map((m) => `<p><b>Missed ${fmtDay(m.date)}</b>: make it up by <b>${fmtDay(m.makeUpBy)}</b> <span class="pill warn">${daysLeft(m.makeUpBy, v.today)}</span></p>
        ${m.sessions.length ? m.sessions.map((s) => sessionBlock(s, true)).join('') : '<p class="muted small">No workout was published for this day.</p>'}`).join('')}
      <p class="muted small">Log it on the form as "Make-up for a missed practice" with the date you missed.</p></div>` : '';
  const madeUp = v.madeUp && v.madeUp.length ? `<div class="card"><h2>Made up</h2>
      ${v.madeUp.map((m) => `<p>${fmtDay(m.date)} practice <span class="pill good">Made up ${fmtDate(m.makeupDate)} ✓</span></p>`).join('')}</div>` : '';
  app.innerHTML = `${staleNote(v.meta)}
    <div class="head"><div><h1>${esc(a.name)}</h1><p class="muted">${esc(a.squad)} · ${esc(a.grade)}${a.active ? '' : ' · inactive'}${s.completionPct === null ? '' : ` · completion ${s.completionPct}% this season`}</p></div>
      ${v.own ? '<button class="linkish small" id="not-you">Not you? Sign out</button>' : ''}</div>
    ${v.own || v.coach ? todayCard(v.todayPlan, v.own ? null : id) : ''}
    ${v.own || v.coach ? '<div id="logbook-card"></div>' : ''}
    <div class="card"><h2>OYO this week: ${fmtMin(w.oyoMin)} <span class="pill ${w.oyoStatus === 'short' ? '' : 'good'}">${oyoText}${toElite}</span>${a.breakWeek ? ' <span class="pill">Break week</span>' : ''}</h2>
      <div class="meter" role="img" aria-label="OYO ${Math.round(w.oyoMin)} of ${a.oyoRequired} required, ${a.oyoElite} elite">
        <div class="fill" style="width:${Math.min(100, (100 * w.oyoMin) / oyoMax)}%"></div>
        <div class="mark" style="left:${(100 * a.oyoRequired) / oyoMax}%"><span>Required ${a.oyoRequired}m</span></div>
        <div class="mark" style="left:${(100 * a.oyoElite) / oyoMax}%"><span>Elite ${a.oyoElite}m</span></div>
      </div></div>
    <div class="grid">
      ${tile('Practices this week', `${w.practicesDone}/${w.practicesExpected}`, fmtMin(w.practiceMin) + ' weighted')}
      ${tile('Season completion', s.completionPct === null ? '–' : s.completionPct + '%', `${s.practicesDone} of ${s.practicesExpected}${s.makeupsDone ? ` · ${s.makeupsDone} make-up${s.makeupsDone > 1 ? 's' : ''}` : ''}`)}
      ${tile('Practice streak', v.streaks.practices, 'in a row')}
      ${tile('OYO goal streak', v.streaks.oyoWeeks, v.streaks.oyoWeeks === 1 ? 'week' : 'weeks in a row')}
      ${tile('Season training', fmtMin(s.trainingMin), fmtNum(s.meters) + ' m')}
      ${v.insights ? monthTile(v.insights.month, v.today) : ''}
    </div>
    ${makeups}${madeUp}
    ${v.own || v.coach ? gmsCard(v.gms, v.coach, v.gmsSummary, v.bests) : starsLine(v.gms)}
    <div class="card"><h2>Best results</h2>${bestsTable(v)}</div>
    ${v.own || v.coach ? pacingCard(v.pacing) : ''}
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
  wirePacing(v.pacing);
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
      ${body}</div>
    ${w.photo ? `<div class="card"><h2>Erg screen</h2>
      <a href="/api/photo/${encodeURIComponent(id)}" target="_blank" rel="noopener"><img class="erg-photo" loading="lazy" alt="Photo of the erg screen for this workout" src="/api/photo/${encodeURIComponent(id)}"></a>
      <p class="muted small">Tap the photo to open it larger.</p></div>` : ''}${footer(v.meta)}`;
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
const starWord = (n) => `${n} of ${MAX_STARS} stars`;
/** Average of the 2k and 20' stars, matching seasonStars on the server. */
const avgStars = (list) => (list.length ? Math.round((2 * list.reduce((x, y) => x + y, 0)) / list.length) / 2 : null);

/** Stars only, for anyone viewing someone else's page. */
function starsLine(gms) {
  const s = gms.filter((g) => g.stars !== null);
  if (!s.length) return '';
  const avg = avgStars(s.map((g) => g.stars));
  return `<div class="card"><h2>Stars <span class="stars" role="img" aria-label="${starWord(avg)}">${starText(avg)}</span></h2>
    <p class="muted small">${s.map((g) => `${TEST_LABELS[g.test]}: ${starWord(g.stars)}`).join(' · ')}${s.length > 1 ? ' · average of the two' : ''}</p></div>`;
}

function nextStarText(g) {
  const n = g.nextStar;
  if (g.stars === MAX_STARS) return 'Top band reached.';
  if (!n) return '';
  if (g.test === '2000m') {
    return `Next star: <b>${n.secondsFaster.toFixed(1)}s faster</b> on your 2k (${fmtTime(n.targetS)}${n.splitFaster >= 0.1 ? `, about ${n.splitFaster.toFixed(1)}s/500m` : ''}).`;
  }
  return `Next star: <b>${fmtNum(n.metersMore)} m more</b> on your 20' (${fmtNum(n.targetM)} m${n.splitFaster >= 0.1 ? `, about ${n.splitFaster.toFixed(1)}s/500m faster` : ''}).`;
}

/** Her own page and coaches: GMS % per test and how far to the next star, in time or meters. */
function gmsCard(gms, coach = false, summary = null, bests = []) {
  if (!gms.length) {
    // A 2k or 20' this season but no GMS means no weight on file: the result stands, unadjusted (David, 2026-11-11).
    const tested = bests.some((b) => b.season && (b.test === '2000m' || b.test === '20min'));
    const her = coach ? 'her' : 'your', herObj = coach ? 'her' : 'you';
    return `<div class="card"><h2>Gold Medal Standard</h2><p class="empty">${tested
      ? `A test is recorded this season, and it is shown unadjusted below. The GMS % and stars appear once a coach adds ${her} weight.`
      : `No 2k or 20' test this season yet. A test gives ${herObj} a GMS % and stars.`}</p></div>`;
  }
  // The next-star text is long, so it sits behind "Show more" instead of making the table scroll sideways.
  const more = gms.filter((g) => g.stars !== null && nextStarText(g)).map((g) => `<p>${TEST_LABELS[g.test]}: ${nextStarText(g)}</p>`).join('');
  return `<div class="card"><h2>Gold Medal Standard <span class="pill">${coach ? 'coach view' : 'only you see this'}</span></h2>
    <div class="table-wrap"><table><tr><th>Test</th><th class="r">Best GMS this season</th><th class="r">GMS</th><th>Stars</th></tr>
    ${gms.map((g) => `<tr><td>${TEST_LABELS[g.test]}</td><td class="r">${fmtResult(g)}<div class="muted small">${split(g)} /500m</div></td><td class="r">${g.gmsPct.toFixed(1)}%</td>
      <td class="stars">${g.stars === null ? '' : starText(g.stars)}</td></tr>`).join('')}
    </table></div>
    ${more ? `<button class="linkish small more-toggle" type="button">Show more</button><div class="small" hidden>${more}</div>` : ''}
    ${summary ? `<p class="callout">${esc(summary)}</p>` : ''}
    <p class="muted small">100% = the 1v8 standard (5:00 for 1500m). Stars come from your 2k and 20'. 500m and 100m are power checks with no stars. Each row is the test with your highest GMS %, which can differ from your fastest time.</p></div>`;
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
  return `<details class="team-results"><summary>Results: ${logged.length} of ${s.results.length} logged${logged.length && !logged.every((x) => x.result.test) ? ` · ${inRange} all in range` : ''}</summary>
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
  app.innerHTML = `${staleNote(v.meta)}<div class="head"><div><h1>${prev ? 'Last week' : 'This week'}</h1>
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
    const isMeters = state.test === '20min' || state.test === '30r20', gmsCol = isCoach() && state.test !== '30r20';
    const yr = Number(String(v.yearStart).slice(0, 4));
    app.innerHTML = `${staleNote(v.meta)}<div class="head"><div><div class="eyebrow">School year ${yr}-${String((yr + 1) % 100).padStart(2, '0')}</div><h1>Boards</h1>
      <p class="muted small">Raw erg scores.<span class="age-note"> Varsity is 10th-12th, Fr/Nov is 7th-9th.</span></p></div>
      <div class="filters chips">${seg('window', [['season', 'This school year'], ['allTime', 'All time']])}
        ${seg('group', [['all', 'All'], ['varsity', 'Varsity <span class="age">(10th-12th)</span>'], ['freshman', 'Fr/Nov <span class="age">(7th-9th)</span>']])}</div></div>
      <div class="filters tests">${seg('test', [...v.tests].sort((x, y) => (x.test === '20min' ? -1 : y.test === '20min' ? 1 : 0)).map((x) => [x.test, TEST_LABELS[x.test]]))}</div>
      <div class="card board">${rows.length ? `<div class="table-wrap"><table>
        <tr><th class="r">#</th><th>Athlete</th><th class="r">${isMeters ? 'Distance' : 'Time'}</th><th class="r">Split</th><th class="r rate">Rate</th>${gmsCol ? '<th class="r gms">GMS %</th>' : ''}<th class="date">Date</th></tr>
        ${rows.map((r, i) => `<tr${mine && mine.id === r.id ? ' class="me"' : ''}><td class="r rk">${i + 1}</td>
          <td><a class="nm" href="#/athlete/${esc(r.id)}">${esc(r.name)}</a>${r.alum ? ' <span class="pill">alum</span>' : ''}
            <div class="sub">${r.stars === null ? '' : `<span class="stars" role="img" aria-label="${r.stars} stars">${starText(r.stars)}</span>`}${state.group === 'all' && r.group ? ` <span class="muted">${r.group === 'freshman' ? 'Fr/Nov' : 'Varsity'} piece</span>` : ''}</div></td>
          <td class="r big-result">${fmtResult(r)}</td><td class="r">${split(r)}</td><td class="r rate">${r.avgRate || '–'}</td>${gmsCol ? `<td class="r gms">${typeof r.gmsPct === 'number' ? r.gmsPct.toFixed(1) + '%' : '–'}</td>` : ''}<td class="date">${r.dateApprox ? esc(r.schoolYear) : fmtDate(r.date)}</td></tr>`).join('')}
      </table></div>` : `<p class="empty">No ${esc(TEST_LABELS[state.test])} results yet${state.group === 'all' ? '' : ' for this group'}${state.window === 'season' ? ' this school year' : ''}. Try another test or group.</p>`}</div>${footer(v.meta)}`;
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
  app.innerHTML = `${staleNote(v.meta)}<div class="head"><div><h1>GMS Rating</h1>
    <p class="muted">Average of each rower's 2k and 20' stars this school year (one test: that test's stars). Every 2k or 20' earns ★. More stars at 95%, 96%, 97% and 100% of the Gold Medal Standard (100% = 1v8 speed).</p></div></div>
    ${groups.map((g) => g.rows.length ? `<div class="card"><h2><span class="stars" role="img" aria-label="${starWord(g.n)}">${starText(g.n)}</span> ${starWord(g.n)} <span class="muted small">${g.rows.length}</span></h2>
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
  const trend = (t) => (!t ? '<span class="muted">–</span>' : Math.abs(t.changeS) < 0.5 ? 'same'
    : `<span class="${t.changeS < 0 ? 'good-text' : ''}">${t.changeS < 0 ? '▲' : '▼'} ${Math.abs(t.changeS).toFixed(1)}s</span>`);
  const flagged = v.rowers.filter((r) => r.thisWeek.flag || r.lastWeek.flag).length;
  const missedFlagged = v.rowers.filter((r) => r.missed.flag).length;
  // Missed practices lead (David, 2026-11-03); load jumps stay, quieter: a ▲ with no pill.
  const jump = (w) => (w.changePct === null ? '<span class="muted">–</span>'
    : w.flag ? `<span class="jump" title="More than ${v.jumpPct}% above her 3-week average">▲ ${w.changePct > 0 ? '+' : ''}${w.changePct}%</span>`
      : `<span class="muted">${w.changePct > 0 ? '+' : ''}${w.changePct}%</span>`);
  const loadCell = (w) => `<td class="r">${fmtMin(w.total)}</td><td class="r">${jump(w)}</td>`;
  let which = 'season';
  const draw = () => {
  const over = v.rowers.filter((r) => r.oyo.pct !== null && r.oyo.pct >= v.overreachPct).sort((x, y) => y.oyo.pct - x.oyo.pct);
  const pc = (r) => (which === 'recent' ? r.attendance.recent : r.attendance.season);
  const low = v.rowers.filter((r) => pc(r) !== null && pc(r) < 80).sort((x, y) => pc(x) - pc(y));
  const run = v.testsRun || { has2k: true, has20: true };   // only a test the team has done can be missing
  const miss2k = (r) => run.has2k && !r.tests.has2k, miss20 = (r) => run.has20 && !r.tests.has20;
  const noTest = v.rowers.filter((r) => miss2k(r) || miss20(r));
  const rowLink = (r, right) => `<div class="ins-row"><a href="#/athlete/${encodeURIComponent(r.id)}">${esc(r.name)}</a> <span class="muted small">${esc(r.squad)}</span><span class="r">${right}</span></div>`;
  const lb = v.logbook && v.logbook.active ? v.logbook : null;
  const lbTile = lb ? tile('Missing Logbook account', lb.missing ? lb.missing.length : '–', lb.missing ? 'not connected to Concept2' : 'could not check') : '';
  const alerts = `<div class="grid">${tile('Overreaching on OYO', over.length, `${v.overreachPct}% or more of Standard`)}${tile('Attendance under 80%', low.length, which === 'recent' ? `last ${v.attendanceRecent} practices` : 'this season')}${tile("Missing a test", noTest.length, "2k or 20' this school year")}${lbTile}</div>
    <div class="cols">
      <div class="card"><h2>Overreaching on OYO</h2><p class="muted small">This week's weighted OYO minutes at ${v.overreachPct}% or more of her Standard goal.</p>${over.length ? over.map((r) => rowLink(r, `<b class="num">${fmtMin(r.oyo.minutes)}</b> <span class="pill warn">${r.oyo.pct}% of Standard</span>`)).join('') : '<p class="muted">Nobody this week.</p>'}</div>
      <div class="card"><div class="ins-head"><h2>Attendance under 80%</h2><div class="seg" role="group" aria-label="Attendance period"><button type="button" data-att="season" aria-pressed="${which === 'season'}">Season</button><button type="button" data-att="recent" aria-pressed="${which === 'recent'}">Past 2 weeks</button></div></div>
        <p class="muted small">A made-up practice counts as present. ${which === 'recent' ? `Her last ${v.attendanceRecent} practices.` : 'Every practice so far this school year.'}</p>${low.length ? low.map((r) => rowLink(r, `<b class="num">${pc(r)}%</b>`)).join('') : '<p class="muted">Nobody.</p>'}</div>
      <div class="card"><h2>Missing a test</h2><p class="muted small">No 2k or no 20' yet this school year. A test only counts once most of the team has done it${!run.has2k ? " (no team 2k yet, so none flagged for it)" : ''}.</p>${noTest.length ? noTest.map((r) => rowLink(r, `<span class="muted small">${[miss2k(r) && 'no 2k', miss20(r) && "no 20'"].filter(Boolean).join(', ')}</span>`)).join('') : '<p class="muted">Everyone has both.</p>'}</div>
      ${lb ? `<div class="card"><h2>Missing Logbook account</h2><p class="muted small">Not connected to Concept2 Logbook yet, so her ErgData workouts do not arrive on their own.</p>${!lb.missing ? '<p class="muted">The connection list could not be read. Reload to try again.</p>' : lb.missing.length ? lb.missing.map((r) => rowLink(r, '<img class="c2" src="/icons/concept2.png" alt="" width="18" height="18" style="opacity:.4">')).join('') : '<p class="muted">Everyone is connected.</p>'}</div>` : ''}
    </div>`;
  app.innerHTML = `${staleNote(v.meta)}<div class="head"><div><h1>Insights</h1>
    <p class="muted">Coaches only. ${missedFlagged ? `<b>${missedFlagged} rower${missedFlagged > 1 ? 's' : ''} missing ${v.missedFlagAt} or more practices without making them up.</b>` : 'Nobody is missing practices without making them up.'}
      Load jumps are shown quietly: weighted minutes against her average for the 3 weeks before (fewer in her first weeks); ▲ means more than ${v.jumpPct}% above it${flagged ? ` (${flagged} rower${flagged > 1 ? 's' : ''})` : ''}.</p></div></div>
    ${alerts}
    <div class="card"><div class="table-wrap"><table class="insights">
      <tr><th>Rower</th><th class="r">Missed, 4 wks</th><th class="r" colspan="2">This week so far</th><th class="r" colspan="2">Last week</th><th class="r">RPE last week</th>
        <th class="r">Steady split</th><th class="r">Est. 2k</th><th class="r">${fmtDate(v.today, { month: 'long' })}</th><th class="r">Streak</th></tr>
      ${v.rowers.map((r) => `<tr><td><a href="#/athlete/${encodeURIComponent(r.id)}">${esc(r.name)}</a> <span class="muted small">${esc(r.squad)}</span></td>
        <td class="r">${r.missed.count ? `${r.missed.flag ? '<span class="pill warn">' : '<span>'}${r.missed.count}</span><div class="muted small">${r.missed.open} open · ${r.missed.overdue} overdue</div>` : '<span class="muted">0</span>'}</td>
        ${loadCell(r.thisWeek)}${loadCell(r.lastWeek)}<td class="r">${r.lastWeek.rpe ?? ''}</td>
        <td class="r">${trend(r.splitTrend)}</td><td class="r">${r.projected2k ? fmtTime(r.projected2k) : ''}</td>
        <td class="r">${r.month.pct === null ? '–' : `${r.month.pct}% <span class="muted small">${r.month.done}/${r.month.expected}</span>`}</td>
        <td class="r">${r.month.streak}</td></tr>`).join('')}
    </table></div>
    <p class="muted small">Missed: practices not logged or made up in the last ${v.missedWindowDays} days (open = still inside the make-up window, overdue = past it); ${v.missedFlagAt} or more is flagged. Steady split: her latest weeks of Aerobic erg work against the weeks before (▲ faster). Est. 2k: from a 20' newer than her last 2k. Month: planned practices logged, make-ups count. Open a rower for her charts.</p></div>
    ${footer(v.meta)}`;
  app.querySelectorAll('[data-att]').forEach((b) => { b.onclick = () => { which = b.dataset.att; draw(); }; });
  wireFooter();
  };
  draw();
}

/** Coaches only: log a workout for an athlete. The test question appears only for ONE piece of exactly 2000 m, 500 m, 100 m or 20:00.0. */
/** Athletes only: log her own run, ride or swim from her phone. */
async function showLogMine() {
  setNav('logrun');
  openLogMine({ app, esc, fmtDay, signedOut: () => showLogin('You were signed out. Please sign in again.') });
}

async function showLogFor() {
  const team = await api('/api/team');
  setNav('log');
  const athletes = [...team.athletes].sort((x, y) => x.name.localeCompare(y.name));
  const today = new Date().toLocaleDateString('en-CA');
  const dayOpts = Array.from({ length: 15 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - i); return d.toLocaleDateString('en-CA'); });
  const S = { athlete: '', date: today, type: 'practice', status: 'full', makeup: dayOpts[1], activity: 'Erg (RowErg)', photo: '', photoName: '', mode: 'single', time: '', dist: '', rate: '', pieces: '', rpe: '', drag: '', note: '', test: null, msg: '', err: '', busy: false, rid: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) };
  const onErg = () => S.activity === 'Erg (RowErg)';
  const tenths = (t) => { const m = /^(\d{1,3}):([0-5]\d)(?:\.(\d))?$/.exec(String(t).trim()); return m ? (+m[1] * 60 + +m[2]) * 10 + (m[3] ? +m[3] : 0) : null; };
  const lines = () => String(S.pieces).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const pieceText = () => (S.mode === 'single' ? `${S.time.trim()}, ${S.dist.replace(/[,\s]/g, '')}${onErg() && S.rate.trim() ? ', ' + S.rate.trim() : ''}` : lines().join('\n'));
  /** The test this entry could be, or null: exactly one piece, 2000 m, 500 m or 100 m (any time), or exactly 20:00.0. */
  const testKind = () => {
    if (S.type === 'practice' && S.status === 'out') return null;
    if (!onErg()) return null;   // a test is always on the RowErg
    const one = S.mode === 'single' ? [[S.time, S.dist.replace(/[,\s]/g, '')]] : [];   // intervals never ask (David, 2026-11-11)
    if (one.length !== 1) return null;
    const [t, m] = one[0];
    if (tenths(t) === 12000) return { key: '20min', label: "20:00", what: "20' test" };
    const meters = /^\d{1,5}$/.test(String(m)) ? +m : null;
    return { 2000: { key: '2000m', label: '2000 m', what: '2k test' }, 500: { key: '500m', label: '500 m', what: '500 m power check' }, 100: { key: '100m', label: '100 m', what: '100 m power check' } }[meters] || null;
  };
  const field = (label, k, extra = '') => `<label class="f">${label}<input class="in" data-f="${k}" value="${esc(S[k])}" autocomplete="off" ${extra}></label>`;
  /** Run pace per mile and per km from the typed time and meters, shown under the fields. */
  const paceText = () => {
    const t = tenths(S.time), m = +S.dist.replace(/[,\s]/g, '');
    if (!t || !(m > 0)) return 'Pace shows here once time and distance are typed.';
    const per = (meters) => { const sec = Math.round(t / 10 / m * meters); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
    return `Pace ${per(1609.344)} per mile, ${per(1000)} per km.`;
  };
  const paceHint = () => (S.activity === 'Run' ? `<p class="muted small" id="lf-pace">${paceText()}</p>` : '');
  const draw = () => {
    const kind = testKind(), out = S.type === 'practice' && S.status === 'out';
    if (!kind) S.test = null;
    app.innerHTML = `<div class="head"><div><h1>Log for an athlete</h1><p class="muted">Coaches only. Saves the same workout the Form would make, for an erg piece or a run, bike, swim and so on (no photo for now). The athlete's own page and boards update within about 5 minutes.</p></div></div>
      <form class="card logfor" id="logfor" novalidate>
        <label class="f">Athlete<select class="in" data-f="athlete"><option value="">Choose an athlete</option>${athletes.map((x) => `<option value="${esc(x.id)}"${x.id === S.athlete ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label class="f">Activity<select class="in" data-f="activity">${['Erg (RowErg)', 'BikeErg', 'Run', 'Bike', 'Stair stepper', 'Swim', 'Elliptical'].map((a) => `<option value="${esc(a)}"${a === S.activity ? ' selected' : ''}>${a === 'Erg (RowErg)' ? 'Erg (RowErg)' : esc(a)}</option>`).join('')}</select></label>
        <div class="lf-row"><label class="f">Date<select class="in" data-f="date">${dayOpts.map((d, i) => `<option value="${d}"${d === S.date ? ' selected' : ''}>${i === 0 ? 'Today' : i === 1 ? 'Yesterday' : fmtDay(d)}</option>`).join('')}</select></label>
          <label class="f">Workout<select class="in" data-f="type"><option value="practice"${S.type === 'practice' ? ' selected' : ''}>Practice</option><option value="oyo"${S.type === 'oyo' ? ' selected' : ''}>OYO</option><option value="makeup"${S.type === 'makeup' ? ' selected' : ''}>Make-up</option></select></label></div>
        ${S.type === 'practice' ? `<div class="seg" role="group" aria-label="Practice status">${[['full', 'Full'], ['modified', 'Modified'], ['out', 'Out']].map(([v, l]) => `<button type="button" data-status="${v}" aria-pressed="${S.status === v}">${l}</button>`).join('')}</div>` : ''}
        ${S.type === 'makeup' ? `<label class="f">Make-up for<select class="in" data-f="makeup">${dayOpts.slice(1).map((d) => `<option value="${d}"${d === S.makeup ? ' selected' : ''}>${fmtDay(d)}</option>`).join('')}</select></label>` : ''}
        ${out ? field('Note for coaches (optional)', 'note') : `
        <div class="seg" role="group" aria-label="Pieces">${[['single', 'Single piece'], ['intervals', 'Intervals']].map(([v, l]) => `<button type="button" data-mode="${v}" aria-pressed="${S.mode === v}">${l}</button>`).join('')}</div>
        ${S.mode === 'single' ? `<div class="lf-row">${field('Time (min:sec.tenth)', 'time', 'placeholder="20:00.0"')}${field('Distance (meters)', 'dist', `inputmode="numeric" placeholder="${S.activity === 'Run' ? '5000' : '4936'}"`)}${onErg() ? field('Stroke rate (optional)', 'rate', 'inputmode="numeric"') : ''}</div>${paceHint()}`
          : `<label class="f">One line per piece: time, meters, rate (optional), rest time (optional)<textarea class="in" data-f="pieces" rows="5" placeholder="7:44.8, 2000, 31, 4:00">${esc(S.pieces)}</textarea></label>`}
        <div class="lf-row">${field('Effort 1 to 10 (optional)', 'rpe', 'inputmode="numeric"')}${S.activity === 'Erg (RowErg)' || S.activity === 'BikeErg' ? field('Drag factor (optional)', 'drag', 'inputmode="numeric"') : ''}</div>
        ${kind ? `<div class="card hl" id="lf-test"><b>This piece is exactly ${kind.label}. Is it a test?</b><div class="seg" role="group" aria-label="Is it a test?"><button type="button" data-test="yes" aria-pressed="${S.test === 'yes'}">Yes, a test</button><button type="button" data-test="no" aria-pressed="${S.test === 'no'}">No</button></div>
          <p class="muted small">${S.test === 'yes' ? `Saves as a ${kind.what}. It counts on the boards${kind.key === '500m' || kind.key === '100m' ? ' (power checks have no stars or GMS %)' : ' and in her stars'}. A missing drag factor is flagged for coaches.` : S.test === 'no' ? 'Saves as a normal workout. It will not count on the boards.' : 'Pick one before saving.'}</p></div>`
          : !onErg() ? `<p class="muted small">${esc(S.activity)} is not an erg piece, so there is no test question. No photo is attached for now.</p>`
          : '<p class="muted small"><b>No test question.</b> It appears only for a single piece of exactly 2000 m, 500 m, 100 m or 20:00.0. Pieces inside intervals and near misses like 20:00.3 or 1999 m never ask.</p>'}
        ${field('Note for coaches (optional)', 'note')}
        <div class="f"><span>Photo of the screen or watch (optional)</span>${S.photo ? `<div class="lf-row"><span class="pill">${esc(S.photoName || 'Photo added')}</span> <button class="btn ghost sm" type="button" id="lf-photo-x">Remove</button></div>` : '<input class="in" type="file" id="lf-photo" accept="image/*" aria-label="Photo of the screen or watch">'}
          <span class="muted small">Kept as a small private copy, with location data removed. Proof for runs, rides and other non-erg work.</span></div>`}
        ${S.err ? `<p class="error" role="alert">${esc(S.err)}</p>` : ''}${S.msg ? `<p class="notice" role="status">${esc(S.msg)}</p>` : ''}
        <div class="actions"><button class="btn" type="submit"${S.busy ? ' disabled' : ''}>${S.busy ? 'Saving…' : 'Save workout'}</button></div></form>`;
    const f = app.querySelector('#logfor');
    f.querySelectorAll('[data-f]').forEach((el) => { el.oninput = () => { S[el.dataset.f] = el.value; S.msg = ''; S.err = ''; if (['time', 'dist', 'pieces'].includes(el.dataset.f)) refreshTest(); const pc = app.querySelector('#lf-pace'); if (pc) pc.textContent = paceText(); }; el.onchange = () => { S[el.dataset.f] = el.value; if (el.tagName !== 'SELECT' || ['athlete', 'date', 'makeup'].includes(el.dataset.f)) return; draw(); }; });
    f.querySelectorAll('[data-status]').forEach((b) => { b.onclick = () => { S.status = b.dataset.status; draw(); }; });
    f.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => { S.mode = b.dataset.mode; S.test = null; draw(); }; });
    f.querySelectorAll('[data-test]').forEach((b) => { b.onclick = () => { S.test = b.dataset.test; draw(); }; });
    const pick = f.querySelector('#lf-photo');
    if (pick) pick.onchange = async () => {
      const file = pick.files && pick.files[0];
      if (!file) return;
      try { S.photo = await shrinkPhoto(file); S.photoName = file.name; S.err = ''; } catch { S.err = 'That photo could not be read. Try another one.'; }
      draw();
    };
    const drop = f.querySelector('#lf-photo-x');
    if (drop) drop.onclick = () => { S.photo = ''; S.photoName = ''; draw(); };
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      if (!S.athlete) { S.err = 'Choose an athlete.'; draw(); return; }
      if (testKind() && !S.test) { S.err = 'Answer the test question first.'; draw(); return; }
      S.busy = true; S.err = ''; S.msg = ''; draw();
      const form = { date: S.date, activity: S.activity, type: S.type, status: S.type === 'practice' ? S.status : '', makeup_for: S.type === 'makeup' ? S.makeup : '', rpe: S.rpe, drag: S.activity === 'Erg (RowErg)' || S.activity === 'BikeErg' ? S.drag : '', note: S.note };
      if (!(S.type === 'practice' && S.status === 'out')) { form.pieces = pieceText(); if (testKind()) form.test = S.test; }
      try {
        const res = await fetch('/api/log', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ athleteId: S.athlete, requestId: S.rid, form, ...(S.photo ? { photo: S.photo } : {}) }) });
        const out2 = await res.json().catch(() => ({}));
        if (res.status === 401) { showLogin('You were signed out. Please sign in again.'); return; }
        if (!res.ok) { S.err = out2.error || 'Nothing was saved.'; }
        else {
          S.msg = `Saved${out2.athlete ? ' for ' + out2.athlete : ''}${out2.test ? ' as a test' : ''}${out2.photo === 'failed' ? ', but the photo could not be saved' : out2.photo ? ' with the photo' : ''}.`;
          Object.assign(S, { photo: '', photoName: '', time: '', dist: '', rate: '', pieces: '', rpe: '', drag: '', note: '', test: null, rid: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) });
        }
      } catch { S.err = 'Could not reach the site. Nothing was saved.'; }
      S.busy = false; draw();
    };
  };
  /** Only the test card changes while typing, so the field you are in keeps focus. */
  const refreshTest = () => { const before = !!app.querySelector('#lf-test'), after = !!testKind(); if (before !== after) { const el = document.activeElement, k = el && el.dataset && el.dataset.f, pos = el && el.selectionStart; draw(); const n = k && app.querySelector(`[data-f="${k}"]`); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* not a text field */ } } } };
  draw();
}

/** Coaches only: current weight per rower, entered here instead of in the hidden tab. Weight never reaches a team or athlete page. */
async function showWeights() {
  let v = await api('/api/weights');
  setNav('weights');
  let editing = null, msg = '';
  const draw = () => {
    const n = (s) => v.rows.filter((r) => r.status === s).length;
    app.innerHTML = `<div class="head"><div><h1>Weights</h1><p class="muted">Coaches only. Athletes never see this page. Only the current weight is shown; each entry is dated, so past tests keep the weight they were scored with. There is no history, trend or graph.</p></div></div>
      <div class="grid">${tile('Current', n('Current'), 'entered this school year')}${tile('Due', n('Due'), `entered before ${fmtDate(v.yearStart)}`)}${tile('Missing', n('Missing'), 'tests score unadjusted')}</div>
      ${msg ? `<p class="notice" role="status">${esc(msg)}</p>` : ''}
      <div class="card"><div class="table-wrap"><table>
        <tr><th>Athlete</th><th class="r">Weight (lb)</th><th>Entered by</th><th>Updated</th><th>Status</th><th></th></tr>
        ${v.rows.map((r) => `<tr><td>${esc(r.name)} <span class="muted small">${esc(r.squad)}</span></td>
          <td class="r">${editing === r.id ? `<input class="wt-in" id="wt-in" inputmode="decimal" autocomplete="off" aria-label="Weight in pounds for ${esc(r.name)}" value="${r.lb ?? ''}" placeholder="lb">` : r.lb === null ? '–' : r.lb}</td>
          <td>${esc(r.by || '–')}</td><td>${r.day ? fmtDate(r.day, { month: 'short', day: 'numeric', year: 'numeric' }) : '–'}</td>
          <td><span class="pill ${r.status === 'Current' ? '' : 'warn'}">${r.status}</span></td>
          <td class="r">${editing === r.id ? `<button class="btn sm" type="button" data-wsave="${esc(r.id)}">Save</button> <button class="btn ghost sm" type="button" data-wcancel="1">Cancel</button>` : `<button class="btn ghost sm" type="button" data-wedit="${esc(r.id)}">${r.status === 'Missing' ? 'Enter' : 'Edit'}</button>`}</td></tr>`).join('')}
      </table></div></div>`;
    const input = app.querySelector('#wt-in');
    if (input) { input.focus(); input.select(); input.onkeydown = (e) => { if (e.key === 'Enter') app.querySelector('[data-wsave]').click(); if (e.key === 'Escape') { editing = null; draw(); } }; }
    app.querySelectorAll('[data-wedit]').forEach((b) => { b.onclick = () => { editing = b.dataset.wedit; msg = ''; draw(); }; });
    app.querySelectorAll('[data-wcancel]').forEach((b) => { b.onclick = () => { editing = null; draw(); }; });
    app.querySelectorAll('[data-wsave]').forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        try {
          const res = await fetch('/api/weights', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ athleteId: b.dataset.wsave, lb: app.querySelector('#wt-in').value }) });
          const out = await res.json().catch(() => ({}));
          if (res.status === 401) { showLogin('You were signed out. Please sign in again.'); return; }
          if (!res.ok) { msg = out.error || 'Nothing was saved.'; b.disabled = false; draw(); return; }
          v = out; editing = null; msg = 'Saved.';
        } catch { msg = 'Could not reach the site. Nothing was saved.'; }
        draw();
      };
    });
  };
  draw();
}

/** Coaches only: build a workout and schedule it. Saves to the Sheet's Workouts and Schedule tabs. */
async function showPlan() {
  const v = await api('/api/workouts');
  setNav('plan');
  openPlan(v, { app, esc, fmtDate, signedOut: () => showLogin('You were signed out. Please sign in again.') });
}

/** Coaches only: build boats from today's group. Nothing is saved. */
async function showLineups() {
  const v = await api('/api/lineups');
  setNav('lineups');
  openLineups(v.rowers, { app, esc, fmtTime, fmtNum });
}

/** Coaches only: Name, season %, then the last practice days and OYO weeks. */
async function showCompletion() {
  const v = await api('/api/completion');
  setNav('completion');
  const sym = { F: '✓', M: 'M', U: 'MU', P: '!', O: '✕', W: '…' };
  const name = { F: 'Full', M: 'Modified', U: 'Made up', P: 'Out, make-up open', O: 'Out, window closed', W: 'Week in progress' };
  const cell = (c, title) => `<td class="c">${c ? `<span class="cg cg-${c}" title="${esc(title || name[c])}">${sym[c]}</span>` : ''}</td>`;
  const head = (d) => `<th class="c">${fmtDate(d, { weekday: 'short' })}<br>${fmtDate(d, { month: 'short', day: 'numeric' })}</th>`;
  app.innerHTML = `${staleNote(v.meta)}<div class="head"><div><h1>Attendance</h1>
    <p class="muted">Coaches only. Last ${v.dates.length} practice days, with each rower's completion % for the whole school year since ${fmtDate(v.yearStart)}.</p></div></div>
    <div class="card"><div class="legend">${['F', 'M', 'U', 'P', 'O', 'W'].map((k) => `<span><span class="cg cg-${k}">${sym[k]}</span> ${name[k]}</span>`).join('')}</div>
    <div class="table-wrap"><table class="insights grid">
      <tr><th>Rower</th><th class="r">Season</th>${v.dates.map(head).join('')}${v.weekStarts.map((w, i) => `<th class="c">OYO<br>${i ? 'this wk' : 'last wk'}</th>`).join('')}</tr>
      ${v.rows.map((r) => `<tr><td><a href="#/athlete/${encodeURIComponent(r.id)}">${esc(r.name)}</a> <span class="muted small">${esc(r.squad)}</span></td>
        <td class="r"><b>${r.pct === null ? '–' : r.pct + '%'}</b></td>${r.cells.map((c) => cell(c)).join('')}${r.oyo.map((o) => cell(o.code, `${o.minutes} of ${o.required} min`)).join('')}</tr>`).join('')}
    </table></div>
    <p class="muted small">Season %: practices logged or made up out of practices planned so far this school year. Any miss counts, with no excused split. OYO is not in the %. Hover a cell for details.</p></div>
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
  if (!v.bests.length) return '<p class="empty">No 2k or 20\u2019 test yet. When one is logged, the result, GMS and stars show up here.</p>';
  // Split under the season result and date under the all-time result, so it fits a phone (David, 2026-10-28).
  // Rank is among active rowers' all-time bests, the same as the PR boards. A Pacing link opens that test's look-back (her own page and coaches).
  const havePacing = new Set((v.pacing || []).map((p) => p.id));
  const paceLink = (r) => (r && havePacing.has(r.id) ? ` <button class="linkish small" type="button" data-pace="${esc(r.id)}">Pacing</button>` : '');
  return `<div class="table-wrap"><table><tr><th>Test</th><th class="r">This season</th><th class="r">All time</th></tr>
    ${v.bests.map((b) => `<tr><td>${TEST_LABELS[b.test]}${b.rank ? `<div class="muted small">#${b.rank.pos} on team</div>` : ''}</td>
      <td class="r">${b.season ? fmtResult(b.season) : '–'}<div class="muted small">${b.season ? split(b.season) : ''}${paceLink(b.season)}</div></td>
      <td class="r">${fmtResult(b.allTime)}<div class="muted small">${fmtDate(b.allTime.date, { month: '2-digit', day: '2-digit', year: '2-digit' })}${b.season && b.season.id === b.allTime.id ? '' : paceLink(b.allTime)}</div></td></tr>`).join('')}
  </table></div>`;
}

const daysLeft = (by, today) => {
  const n = Math.round((new Date(by + 'T12:00:00') - new Date(today + 'T12:00:00')) / 86400000);
  return n <= 0 ? 'Last day' : `${n} day${n === 1 ? '' : 's'} left`;
};

// ---- test pacing look-back (David, 2026-11-01) ----

/** One test's pacing: each split against her own average. Bars lean left (faster) or right (slower); the delta carries a sign and a word, so color is never the only cue. */
function pacingBody(p) {
  const max = Math.max(2, ...p.segments.map((x) => Math.abs(x.deltaS)));
  return `<div class="pace-head"><span class="muted small">${TEST_LABELS[p.test]} · ${fmtDate(p.date, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
      <span class="muted small">average ${fmtTime(p.avgS)} /500m</span></div>
    ${p.segments.map((x) => {
      const w = Math.min(100, Math.round((Math.abs(x.deltaS) / max) * 100));
      const word = x.deltaS < 0 ? 'faster' : x.deltaS > 0 ? 'slower' : 'on average';
      return `<div class="pace-row"><span class="muted">${esc(x.label)}</span><b>${fmtTime(x.splitS)}</b>
        <div class="pace-bar" role="img" aria-label="${Math.abs(x.deltaS).toFixed(1)} seconds ${word} than your average">
          <div class="half fast">${x.deltaS < 0 ? `<i style="width:${w}%"></i>` : ''}</div><div class="half slow">${x.deltaS > 0 ? `<i style="width:${w}%"></i>` : ''}</div></div>
        <span class="muted pace-delta">${x.deltaS === 0 ? '0.0s' : (x.deltaS > 0 ? '+' : '−') + Math.abs(x.deltaS).toFixed(1) + 's'}</span></div>`;
    }).join('')}
    <p class="small">${esc(p.read)}</p>`;
}

/** Her most recent 2k or 20' by default; pick any other test from the list or a Pacing link in Best results. */
function pacingCard(list) {
  if (!list || !list.length) return `<div class="card" id="pacing"><h2>Test pacing</h2><p class="muted">Pacing appears here after a 2k or 20' that has its splits entered.</p></div>`;
  const opts = list.map((p) => `<option value="${esc(p.id)}">${TEST_LABELS[p.test]} · ${fmtDate(p.date, { month: 'short', day: 'numeric', year: 'numeric' })}</option>`).join('');
  return `<div class="card" id="pacing"><h2>Test pacing</h2>
    ${list.length > 1 ? `<label class="small">Test <select id="pace-pick">${opts}</select></label>` : ''}
    <div id="pace-body">${pacingBody(list[0])}</div>
    <p class="muted small">Blue is faster than your own average, orange is slower. A look back at one test, not a plan.</p></div>`;
}

function wirePacing(list) {
  const body = document.getElementById('pace-body');
  if (!body || !list || !list.length) return;
  const show = (id) => {
    const p = list.find((x) => x.id === id);
    if (!p) return;
    body.innerHTML = pacingBody(p);
    const pick = document.getElementById('pace-pick');
    if (pick) pick.value = id;
  };
  const pick = document.getElementById('pace-pick');
  if (pick) pick.onchange = () => show(pick.value);
  app.querySelectorAll('button[data-pace]').forEach((b) => {
    b.onclick = () => { show(b.dataset.pace); document.getElementById('pacing').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  });
}

function testsTable(tests) {
  if (!tests.length) return '<p class="empty">No 2k or 20\u2019 test yet. When one is logged, the result, GMS and stars show up here.</p>';
  return `<div class="table-wrap"><table><tr><th>Date</th><th>Test</th><th class="r">Result</th><th class="r">Split</th><th class="r">Rate</th><th></th></tr>
    ${tests.map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${TEST_LABELS[r.test]}</td><td class="r">${fmtResult(r)}</td>
      <td class="r">${split(r)}</td><td class="r">${r.avgRate ?? ''}</td>
      <td>${r.valid ? '' : '<span class="pill bad">rate over 20</span>'}</td></tr>`).join('')}
  </table></div>`;
}

function sessionsTable(rows) {
  if (!rows.length) return '<p class="empty">Nothing logged yet.</p>';
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

// ---- coach settings (coaches only) ------------------------------------------
// Replaces editing the Settings tab in the Sheet (David, 2026-11-01). The Sheet sends the
// field list; only fields that changed are sent back, and the Sheet checks every value.

async function showSettings() {
  const [v, pw, apw] = await Promise.all([api('/api/settings'), api('/api/coach-passwords').catch(() => null), api('/api/athlete-passwords').catch(() => null)]);
  setNav('settings');
  const draw = (sections, saved) => {
    app.innerHTML = `<div class="head"><div><h1>Settings</h1>
      <p class="muted">Coaches only. Changes recalculate all history: raw minutes, times and weights are stored and these values are applied when shown. Pages pick up a change within about 5 minutes.</p></div>
      <button class="btn" id="save" type="button" disabled>Save changes</button></div>
      <p id="settings-msg" class="${saved ? 'notice' : 'error'}" role="status" ${saved ? '' : 'hidden'}>${saved ? esc(saved) : ''}</p>
      <div class="settings-grid">${sections.map((s) => `<section class="card"><h2>${esc(s.title)}</h2>
        ${s.note ? `<p class="muted small">${esc(s.note)}</p>` : ''}
        ${s.fields.map((f) => `<div class="setting${f.wide ? ' wide' : ''}"><label for="s-${esc(f.key)}">${esc(f.label)}</label>
          <input id="s-${esc(f.key)}" data-key="${esc(f.key)}" data-was="${esc(f.value)}" type="text" value="${esc(f.value)}" autocomplete="off" ${f.optional ? 'placeholder="(blank)"' : ''}>
          ${f.help ? `<span class="muted small">${esc(f.help)}</span>` : ''}<span class="error small" id="e-${esc(f.key)}" hidden></span></div>`).join('')}</section>`).join('')}
        <section class="card"><h2>Access</h2>
          <p class="small">The Slack, Concept2 and sign-in settings are not here on purpose: passwords live as Netlify environment variables, and coach sign-ins and Slack IDs stay in the Sheet's Settings tab.</p></section>
        ${coachPasswordsCard(pw)}
        ${athletePasswordsCard(apw)}
      </div>${footer(v.meta)}`;
    wireFooter();
    wireCoachPasswords();
    wireAthletePasswords();
    const save = document.getElementById('save');
    const inputs = [...app.querySelectorAll('input[data-key]')];
    const changed = () => inputs.filter((i) => i.value.trim() !== i.dataset.was);
    inputs.forEach((i) => i.addEventListener('input', () => { save.disabled = !changed().length; }));
    save.onclick = async () => {
      const changes = Object.fromEntries(changed().map((i) => [i.dataset.key, i.value]));
      const msg = document.getElementById('settings-msg');
      app.querySelectorAll('[id^="e-"]').forEach((e) => { e.hidden = true; });
      msg.hidden = true;
      save.disabled = true; save.classList.add('busy');
      try {
        const res = await fetch('/api/settings', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ changes }) });
        if (res.status === 401) { setSession(null); showLogin(); return; }
        const body = await res.json().catch(() => ({}));
        if (res.ok) return draw(body.sections, body.changed ? `Saved ${body.changed} change${body.changed === 1 ? '' : 's'}.` : 'Nothing was different.');
        Object.entries(body.errors || {}).forEach(([k, m]) => {
          const e = document.getElementById('e-' + k);
          if (e) { e.textContent = m; e.hidden = false; }
        });
        msg.className = 'error'; msg.textContent = body.error || 'Something went wrong.'; msg.hidden = false;
      } catch {
        msg.className = 'error'; msg.textContent = 'Could not reach the site. Nothing was saved.'; msg.hidden = false;
      }
      save.classList.remove('busy'); save.disabled = false;
    };
  };
  draw(v.sections, '');
}

/**
 * Coach passwords (David, 2026-11-03): any coach can reset any coach's personal password from Settings.
 * A reset clears it, so that coach signs in with their birthday again and can set a new one from the menu.
 */
function coachPasswordsCard(pw) {
  const list = pw && pw.coaches;
  const rows = !list ? '<p class="error small">The list could not be loaded. Reload the page to try again.</p>'
    : !list.length ? '<p class="muted small">No coach has set a personal password yet.</p>'
      : `<ul class="pw-list">${list.map((c) => `<li><span>${esc(c.name)}${c.you ? ' (you)' : ''}${c.updatedAt ? `<span class="muted small"> · set ${esc(fmtDate(c.updatedAt.slice(0, 10)))}</span>` : ''}</span>
        <button class="btn ghost" type="button" data-reset="${esc(c.key)}" data-name="${esc(c.name)}">Reset</button></li>`).join('')}</ul>`;
  return `<section class="card" id="coach-pw"><h2>Coach passwords</h2>
    <p class="muted small">If a coach forgets their password, reset it here. They then sign in with their birthday again (MM/DD/YYYY) and can set a new password from the menu.</p>
    ${rows}<p id="coach-pw-msg" class="small" role="status"></p></section>`;
}

function wireCoachPasswords() {
  app.querySelectorAll('[data-reset]').forEach((b) => {
    b.onclick = async () => {
      const msg = document.getElementById('coach-pw-msg');
      if (!confirm(`Reset ${b.dataset.name}'s password? Their birthday will sign them in again until they set a new one.`)) return;
      b.disabled = true; msg.className = 'small'; msg.textContent = '';
      try {
        const res = await fetch('/api/coach-passwords', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reset: b.dataset.reset }) });
        if (res.status === 401) { setSession(null); showLogin('You were signed out. Please sign in again.'); return; }
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { msg.className = 'error small'; msg.textContent = body.error || 'That did not work.'; b.disabled = false; return; }
        b.closest('li').remove();
        msg.className = 'good-text small'; msg.textContent = `${b.dataset.name}'s password is reset. Their birthday signs them in now.`;
      } catch {
        msg.className = 'error small'; msg.textContent = 'Could not reach the site. Nothing was changed.'; b.disabled = false;
      }
    };
  });
}

/**
 * Athlete passwords (David, 2026-11-12): a coach resets an athlete's password here. The site makes a random temporary
 * one and shows it once; the athlete types it with her name and must then choose her own (6+ characters).
 */
function athletePasswordsCard(apw) {
  const list = apw && apw.athletes;
  const label = { birthday: 'birthday (no password yet)', set: 'has her own password', temporary: 'temporary password issued' };
  const body = !list ? '<p class="error small">The list could not be loaded. Reload the page to try again.</p>'
    : `<label class="small" for="apw-pick">Athlete</label>
      <select id="apw-pick" class="in">${list.map((a) => `<option value="${esc(a.id)}">${esc(a.name)} · ${esc(label[a.status] || a.status)}</option>`).join('')}</select>
      <button class="btn" type="button" id="apw-reset">Reset password</button>`;
  return `<section class="card" id="athlete-pw"><h2>Athlete passwords</h2>
    <p class="muted small">Athletes sign in with their birthday once, then choose their own password. If one forgets, reset it here: you get a random temporary password to give her. She types it with her name and then chooses a new one.</p>
    ${body}<p id="athlete-pw-msg" class="small" role="status"></p></section>`;
}

function wireAthletePasswords() {
  const b = document.getElementById('apw-reset');
  if (!b) return;
  b.onclick = async () => {
    const sel = document.getElementById('apw-pick'), msg = document.getElementById('athlete-pw-msg');
    const name = sel.options[sel.selectedIndex].textContent.split(' · ')[0];
    if (!confirm(`Reset ${name}'s password? Her current password (or birthday) will stop working.`)) return;
    b.disabled = true; msg.className = 'small'; msg.textContent = '';
    try {
      const res = await fetch('/api/athlete-passwords', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reset: sel.value }) });
      if (res.status === 401) { setSession(null); showLogin('You were signed out. Please sign in again.'); return; }
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { msg.className = 'error small'; msg.textContent = out.error || 'That did not work.'; b.disabled = false; return; }
      msg.className = 'good-text small';
      msg.innerHTML = `${esc(out.name)}'s temporary password is <strong class="mono">${esc(out.password)}</strong>. Give it to her now: it is shown only once. She types it with her name, then chooses her own password.`;
      sel.options[sel.selectedIndex].textContent = `${out.name} · temporary password issued`;
      b.disabled = false;
    } catch {
      msg.className = 'error small'; msg.textContent = 'Could not reach the site. Nothing was changed.'; b.disabled = false;
    }
  };
}

// ---- router --------------------------------------------------------------

const SKELETON = `<div class="skel" aria-hidden="true"><div class="skel-bar w40"></div><div class="skel-row"><div class="skel-tile"></div><div class="skel-tile"></div><div class="skel-tile"></div></div><div class="skel-card"></div></div><span class="sr-only">Loading…</span>`;

let routed = false, pendingNote = '', redirected = false;
async function route() {
  tip.hidden = true;
  const h = location.hash.replace(/^#\/?/, '');
  const [page, arg] = h.split('/');
  // Placeholder cards if a page takes more than a moment to load; the page replaces them.
  const slow = setTimeout(() => { if (SESSION) app.innerHTML = SKELETON; }, 250);
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
    if ((page === 'completion' || page === 'attendance') && isCoach()) return await showCompletion();
    if (page === 'lineups' && isCoach()) return await showLineups();
    if (page === 'weights' && isCoach()) return await showWeights();
    if (page === 'plan' && isCoach()) return await showPlan();
    if (page === 'log' && isCoach()) return await showLogFor();
    if (page === 'logrun' && SESSION && SESSION.kind === 'athlete') return await showLogMine();
    if (page === 'balance' && isCoach()) return await showBalance();
    if (page === 'settings' && isCoach()) return await showSettings();
    if (page === 'oyo') return await showOyo();
    if (page === 'athlete' && arg) return await showAthlete(decodeURIComponent(arg));
    if (page === 'workout' && arg) return await showWorkout(decodeURIComponent(arg));
    const m = me();
    if (page === 'me' && m) return await showAthlete(m.id);
    if (['stars', 'insights', 'completion', 'attendance', 'lineups', 'weights', 'plan', 'log', 'balance', 'settings'].includes(page) && !isCoach()) pendingNote = 'That page is for coaches.';
    redirected = true;
    location.replace(m ? '#/me' : '#/team');
  } catch (err) {
    showError(err);
  } finally {
    clearTimeout(slow);
    // A new page opens at the top, and keyboard and screen-reader users start at its heading.
    if (routed) window.scrollTo(0, 0);
    routed = true;
    if (redirected) { redirected = false; return; }
    if (pendingNote && SESSION && app.firstElementChild && !app.querySelector('.login')) { app.insertAdjacentHTML('afterbegin', `<p class="notice" role="status">${esc(pendingNote)}</p>`); }
    pendingNote = '';
    const h1 = app.querySelector('h1');
    if (h1 && SESSION) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); document.getElementById('live').textContent = h1.textContent; }
  }
}

document.getElementById('skip').onclick = (ev) => { ev.preventDefault(); app.focus(); };
window.addEventListener('hashchange', route);
route();

// Offline home-screen shell (David, 2026-11-03): the service worker keeps only the app files; data always needs the network.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
