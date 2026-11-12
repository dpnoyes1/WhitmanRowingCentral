// Lineups page (coaches only, David 2026-11-11). Nothing is saved: the lineup lives in this page and clears when you leave it.
// Averages use each rower's best 2k and 20' this school year; GMS % is the average of her 2k and 20' GMS % (from the Sheet).
// A rower with no GMS % (no test, or no weight on file) sits in a boat but is left out of the averages and is never in a Top boat.

const STANDARD_1500_S = 300;                 // Settings gms.standard_s: the 1v8 1500 m standard (5:00); GMS % is against this
const SPEED = { 8: 1, 4: 1.13 };             // a 4+ is 13% slower than an 8+ of the same level (David, 2026-11-12)
const ROLE = { top: 'Top', even: 'Even', low: 'Lower' };
const MAX_BOATS = 6;

const boat = (n, role) => ({ n, role, s: Array(n).fill(null), pin: Array(n).fill(false) });
const fresh = () => ({ out: new Set(), boats: [boat(8, 'even'), boat(8, 'even'), boat(4, 'low')], goal: 1, pick: null, open: false, built: false });
let LU = fresh();
let R = [];            // rowers from /api/lineups
let ctx = null;        // { app, esc, fmtTime, fmtNum, redraw }
const byId = (id) => R.find((r) => r.id === id);

const GOALS = [
  ['Top 4 + even 8s', 'Best 4 in a 4+ to keep up; everyone else in evenly mixed 8s', (k) => [boat(4, 'top'), ...Array.from({ length: k }, () => boat(8, 'even'))]],
  ['Even 8s + lower 4', 'Even 8s; the next 4 make a lower 4+', (k) => [...Array.from({ length: k }, () => boat(8, 'even')), boat(4, 'low')]],
  ['All boats even', 'Keep these boats and make every one even', null],
  ['Ranked', '1st boat fastest, then 2nd, and so on', null]];

const gmsOf = (r) => (r.gmsPct === null || r.gmsPct === undefined ? null : r.gmsPct);
const tagOf = (r) => (gmsOf(r) === null ? 'no GMS %' : gmsOf(r).toFixed(1) + '%');
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pace = (g, n) => (g ? (STANDARD_1500_S / (g / 100)) * SPEED[n] / 3 : null);
const seated = () => new Set(LU.boats.flatMap((b) => b.s.filter((x) => x !== null)));
const free = (b) => b.s.filter((x) => x === null).length;
const put = (b, id) => { b.s[b.s.indexOf(null)] = id; };
const boatName = (bi) => { const b = LU.boats[bi], same = LU.boats.slice(0, bi + 1).filter((x) => x.n === b.n).length; return (['1st', '2nd', '3rd', '4th', '5th', '6th'][same - 1] || same + 'th') + ' ' + b.n + '+'; };
const seatLabel = (n, k) => (k === n - 1 ? 'Stroke' : k === 0 ? 'Bow' : String(k + 1));

function stats(b) {
  const r = b.s.filter((x) => x !== null).map(byId);
  const k2 = r.map((x) => x.k2S).filter((x) => x), m20 = r.map((x) => x.m20).filter((x) => x), g = r.map(gmsOf).filter((x) => x !== null);
  return { n: r.length, k2: avg(k2), k2n: k2.length, m20: avg(m20), m20n: m20.length, g: avg(g), gn: g.length };
}

/** Pinned seats stay. Open seats are filled from ticked, unpinned rowers. Rowers with no GMS % go to Even boats (else Lower), never Top, and
 *  overflow becomes spares. Ranked rowers: Top boats take the fastest, Lower the slowest, Even share the middle and swap while that narrows the gap. */
function make() {
  LU.boats.forEach((b) => b.s.forEach((x, k) => { if (!b.pin[k]) b.s[k] = null; }));
  const pinned = seated(), pool = R.filter((a) => !LU.out.has(a.id) && !pinned.has(a.id));
  const open = LU.boats.reduce((s, b) => s + free(b), 0);
  const noG = pool.filter((a) => gmsOf(a) === null), withG = pool.filter((a) => gmsOf(a) !== null).sort((x, y) => gmsOf(y) - gmsOf(x));
  const of = (r) => LU.boats.filter((b) => b.role === r);
  const home = of('even').length ? of('even') : of('low');
  noG.slice(0, open).forEach((a) => { const b = home.filter((x) => free(x) > 0).sort((x, y) => free(y) / y.n - free(x) / x.n)[0]; if (b) put(b, a.id); });
  const left = LU.boats.reduce((s, b) => s + free(b), 0), ranked = withG.slice(0, left);
  of('top').forEach((b) => { while (free(b) && ranked.length) put(b, ranked.shift().id); });
  const jvSeats = of('low').reduce((s, b) => s + free(b), 0), low = ranked.splice(Math.max(0, ranked.length - jvSeats));
  of('low').forEach((b) => { while (free(b) && low.length) put(b, low.shift().id); });
  const ev = of('even'); let dir = 1, bi = 0;
  ranked.forEach((a) => {
    if (!ev.some((b) => free(b))) return; let guard = 0;
    while (free(ev[bi]) === 0 && guard++ < 50) { bi += dir; if (bi >= ev.length || bi < 0) { dir = -dir; bi += dir; } }
    put(ev[bi], a.id); bi += dir; if (bi >= ev.length || bi < 0) { dir = -dir; bi += dir; }
  });
  const spread = () => { const v = ev.map((b) => stats(b).g).filter((x) => x !== null); return v.length ? Math.max(...v) - Math.min(...v) : 0; };
  for (let pass = 0, better = true; better && pass < 200; pass++) {
    better = false; const base = spread();
    for (let p = 0; p < ev.length && !better; p++) for (let q = p + 1; q < ev.length && !better; q++) {
      for (let x = 0; x < ev[p].n && !better; x++) for (let y = 0; y < ev[q].n && !better; y++) {
        const bp = ev[p], bq = ev[q]; if (bp.pin[x] || bq.pin[y] || bp.s[x] === null || bq.s[y] === null) continue;
        if (gmsOf(byId(bp.s[x])) === null || gmsOf(byId(bq.s[y])) === null) continue;
        [bp.s[x], bq.s[y]] = [bq.s[y], bp.s[x]];
        if (spread() < base - 0.005) better = true; else [bp.s[x], bq.s[y]] = [bq.s[y], bp.s[x]];
      }
    }
  }
  LU.built = true;
}

function setGoal(g) {
  const atN = R.length - LU.out.size, k = Math.min(MAX_BOATS - 1, Math.max(1, Math.floor((atN - 4) / 8))), mk = GOALS[g][2];
  if (mk) LU.boats = mk(k); else LU.boats.forEach((b) => { b.role = g === 3 ? 'top' : 'even'; });
  LU.goal = g; make();
}

const remove = (id) => LU.boats.forEach((b) => b.s.forEach((x, k) => { if (x === id) { b.s[k] = null; b.pin[k] = false; } }));
function place(id, key) {
  if (key === 'pool') { remove(id); return; }
  const [bi, k] = key.split(',').map(Number), b = LU.boats[bi], was = b.s[k];
  let from = null; LU.boats.forEach((bb) => bb.s.forEach((x, kk) => { if (x === id) from = [bb, kk]; }));
  if (from) { from[0].s[from[1]] = was; from[0].pin[from[1]] = was !== null; }
  b.s[k] = id; b.pin[k] = true;
}

function chip(a, where) {
  const { esc } = ctx;
  return `<button type="button" class="luc${LU.pick === a.id ? ' on' : ''}" data-lupick="${esc(a.id)}" draggable="true" data-ludrag="${esc(a.id)}" aria-label="${esc(a.name)}, ${esc(where)}"><b>${esc(a.name)}</b><span class="num${gmsOf(a) === null ? ' w' : ''}">${tagOf(a)}</span></button>`;
}

function draw() {
  const { app, esc, fmtTime, fmtNum } = ctx;
  const atP = R.filter((a) => !LU.out.has(a.id)), sd = seated(), spare = atP.filter((a) => !sd.has(a.id));
  const seats = LU.boats.reduce((s, b) => s + b.n, 0), st = LU.boats.map(stats);
  const evI = LU.boats.map((b, i) => (b.role === 'even' ? i : -1)).filter((i) => i >= 0);
  const gs = (evI.length > 1 ? evI : LU.boats.map((b, i) => i)).map((i) => st[i].g).filter((x) => x !== null);
  const gap = gs.length > 1 ? (Math.max(...gs) - Math.min(...gs)).toFixed(1) + ' pts' : '–';
  const pickA = LU.pick !== null ? byId(LU.pick) : null;
  const fast8 = LU.boats.map((b, i) => ({ b, g: st[i].g, i })).filter((x) => x.b.n === 8 && x.g).map((x) => ({ p: pace(x.g, 8), name: boatName(x.i) })).sort((x, y) => x.p - y.p)[0];
  const tile = (l, v, sub = '') => `<div class="tile"><div class="label">${l}</div><div class="value">${v}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  const boatCard = (b, bi) => {
    const s = st[bi], p = s.g ? pace(s.g, b.n) : null;
    return `<div class="card lub"><div class="lu-head"><h2>${boatName(bi)} <span class="pill ${b.role === 'low' ? 'warn' : ''}">${ROLE[b.role]}</span></h2><span class="muted small num">${s.n}/${b.n} seats</span><button type="button" class="btn ghost sm" data-lurm="${bi}" aria-label="Remove ${boatName(bi)}">Remove</button></div>
      <div class="lurole"><span class="muted small">Boat goal</span><div class="seg" role="group" aria-label="Goal for ${boatName(bi)}">${Object.keys(ROLE).map((r) => `<button type="button" aria-pressed="${b.role === r}" data-lurole="${bi},${r}">${ROLE[r]}</button>`).join('')}</div></div>
      <div class="lus">${b.s.map((x, k) => k).reverse().map((k) => { const x = b.s[k];
        return `<div class="lusr${x === null ? ' empty' : ''}" data-luseat="${bi},${k}"${x === null ? ` tabindex="0" role="button" aria-label="Empty ${seatLabel(b.n, k)} seat in ${boatName(bi)}"` : ''}><span class="lun">${seatLabel(b.n, k)}</span>${x === null ? `<span class="muted">${pickA ? 'Tap to place here' : 'Empty'}</span>`
          : `${chip(byId(x), seatLabel(b.n, k) + ' seat')}<button type="button" class="lupin${b.pin[k] ? ' on' : ''}" data-lupin="${bi},${k}" aria-label="${b.pin[k] ? 'Unpin' : 'Pin'} ${esc(byId(x).name)}" title="${b.pin[k] ? 'Pinned: Make lineups keeps her here' : 'Pin to this seat'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3H7l3-3-1-6ZM12 13v7"/></svg></button>`}</div>`; }).join('')}</div>
      <div class="lua"><div><span class="muted small">Avg 2k</span><b class="num">${s.k2 ? fmtTime(s.k2) : '–'}</b><small class="muted num">${s.k2 ? fmtTime(s.k2 / 4) + ' /500m' : ''}${s.k2n < s.n ? `<br>${s.k2n} of ${s.n} tested` : ''}</small></div>
        <div><span class="muted small">Avg 20'</span><b class="num">${s.m20 ? fmtNum(s.m20) + ' m' : '–'}</b><small class="muted num">${s.m20 ? fmtTime((1200 * 500) / s.m20) + ' /500m' : ''}${s.m20n < s.n ? `<br>${s.m20n} of ${s.n} tested` : ''}</small></div>
        <div><span class="muted small">Avg GMS %</span><b class="num acc">${s.g ? s.g.toFixed(1) + '%' : '–'}</b><small class="muted num">${s.gn < s.n ? `${s.gn} of ${s.n} counted` : s.n ? 'all counted' : ''}</small></div></div>
      ${p ? `<div class="lupace"><span class="muted small">Boat pace, flat water (est.)</span><b class="num">${fmtTime(p)} /500m</b>${b.n !== 8 && fast8 ? `<small class="muted">${p > fast8.p ? `${(p - fast8.p).toFixed(1)} s/500m slower than the ${fast8.name}: about ${Math.round((p - fast8.p) * 4)} s head start over 2k` : `${(fast8.p - p).toFixed(1)} s/500m faster than the ${fast8.name}`}</small>` : ''}</div>` : ''}</div>`;
  };
  app.innerHTML = `<div class="head"><div><h1>Lineups</h1><p class="muted">Coaches only. Nothing is saved: the lineup clears when you leave the page.</p></div><button class="btn" type="button" data-lueven="1">Make lineups</button></div>
    <div class="grid">${tile('At practice', `${atP.length} <span class="muted small">of ${R.length}</span>`)}${tile('Seats', seats, LU.boats.map((b) => b.n + '+').join(' · ') || 'no boats')}${tile('Not in a boat', spare.length, LU.built ? 'spares' : 'still to place')}${tile(evI.length > 1 ? 'Gap between even boats' : 'Gap between boats', gap, 'best vs worst avg GMS %')}</div>
    <div class="card"><div class="lu-head"><h2>At practice today</h2><button type="button" class="btn ghost sm" data-luopen="1">${LU.open ? 'Hide list' : `Change (${LU.out.size} out)`}</button></div>
      ${LU.open ? `<div class="luat">${R.map((a) => `<label class="luck"><input type="checkbox" data-luout="${esc(a.id)}"${LU.out.has(a.id) ? '' : ' checked'}><span><b>${esc(a.name)}</b><small class="muted num">${tagOf(a)}</small></span></label>`).join('')}</div>` : `<p class="muted small">${LU.out.size ? 'Out today: ' + [...LU.out].map((i) => esc(byId(i).name)).join(', ') + '.' : 'Everyone is here. Untick anyone who is out.'}</p>`}</div>
    <div class="card"><div class="lu-head"><h2>Practice goal</h2></div><p class="muted small">${LU.goal >= 0 ? GOALS[LU.goal][1] : "Custom: you set each boat's goal below"}</p>
      <div class="lugoal">${GOALS.map(([t], g) => `<button type="button" class="btn ${LU.goal === g ? '' : 'ghost '}sm" data-lugoal="${g}">${t}</button>`).join('')}</div>
      <p class="muted small">Top boats get the fastest rowers, Lower boats the slowest, and Even boats share the middle so their averages match. A goal builds at most ${MAX_BOATS} boats from today's count; you can still change any boat's goal, add or remove boats, and pin seats.</p></div>
    <div class="card"><div class="lu-head"><h2>Not in a boat</h2></div><p class="muted small">${pickA ? `Now tap a seat for ${esc(pickA.name)}, or tap her again to cancel.` : 'Drag a name into a seat, or tap a name and then a seat.'}</p>
      <div class="lupool" data-luseat="pool">${spare.length ? spare.sort((x, y) => (gmsOf(y) ?? -1) - (gmsOf(x) ?? -1)).map((a) => chip(a, 'not in a boat')).join('') : '<span class="muted small">Everyone at practice has a seat.</span>'}</div></div>
    <div class="lu-actions"><button class="btn ghost sm" type="button" data-luadd="8">Add an 8+</button><button class="btn ghost sm" type="button" data-luadd="4">Add a 4+</button><button class="btn ghost sm" type="button" data-luclear="1">Clear unpinned seats</button></div>
    <div class="lugrid">${LU.boats.map(boatCard).join('')}</div>
    <p class="muted small">Averages use each rower's best 2k and best 20' this school year. GMS % is the average of her 2k and 20' GMS %. Rowers with no test, or no weight on file, sit in the boat but are left out of that average and are never in a Top boat; any left over are spares. Coxswains are not in this tool. Boat pace is an estimate from average GMS % for flat water with no wind; a 4+ is taken as 13% slower than an 8+ of the same level.</p>`;
}

let wired = false;
function wire() {
  if (wired) return; wired = true;
  const on = () => !!ctx && !!document.querySelector('.lugrid');
  document.addEventListener('click', (e) => {
    if (!on()) return; const q = (s) => e.target.closest(s); let hit = true;
    if (q('[data-lupin]')) { const [bi, k] = q('[data-lupin]').dataset.lupin.split(',').map(Number); LU.boats[bi].pin[k] = !LU.boats[bi].pin[k]; }
    else if (q('[data-lupick]')) { const id = q('[data-lupick]').dataset.lupick, seat = q('[data-luseat]');
      if (LU.pick !== null && LU.pick !== id && seat) { place(LU.pick, seat.dataset.luseat); LU.pick = null; } else LU.pick = LU.pick === id ? null : id; }
    else if (q('[data-luseat]')) { if (LU.pick === null) return; place(LU.pick, q('[data-luseat]').dataset.luseat); LU.pick = null; }
    else if (q('[data-lueven]')) { make(); LU.pick = null; }
    else if (q('[data-luadd]')) { if (LU.boats.length < MAX_BOATS) { LU.boats.push(boat(+q('[data-luadd]').dataset.luadd, 'even')); LU.goal = -1; } }
    else if (q('[data-lurm]')) { LU.boats.splice(+q('[data-lurm]').dataset.lurm, 1); LU.goal = -1; }
    else if (q('[data-lurole]')) { const [bi, r] = q('[data-lurole]').dataset.lurole.split(','); LU.boats[+bi].role = r; LU.goal = -1; }
    else if (q('[data-lugoal]')) { setGoal(+q('[data-lugoal]').dataset.lugoal); LU.pick = null; }
    else if (q('[data-luclear]')) { LU.boats.forEach((b) => b.s.forEach((x, k) => { if (!b.pin[k]) b.s[k] = null; })); LU.built = false; }
    else if (q('[data-luopen]')) LU.open = !LU.open;
    else hit = false;
    if (hit) draw();
  });
  document.addEventListener('change', (e) => { const el = on() && e.target.closest && e.target.closest('[data-luout]'); if (!el) return; const id = el.dataset.luout;
    if (el.checked) LU.out.delete(id); else { LU.out.add(id); remove(id); if (LU.pick === id) LU.pick = null; } draw(); });
  document.addEventListener('keydown', (e) => { if (!on() || (e.key !== 'Enter' && e.key !== ' ')) return; const t = e.target.closest && e.target.closest('.lusr.empty'); if (t && e.target === t) { e.preventDefault(); t.click(); } });
  document.addEventListener('dragstart', (e) => { const el = on() && e.target.closest && e.target.closest('[data-ludrag]'); if (!el) return; e.dataTransfer.setData('text/plain', el.dataset.ludrag); e.dataTransfer.effectAllowed = 'move'; });
  document.addEventListener('dragover', (e) => { if (on() && e.target.closest && e.target.closest('[data-luseat]')) e.preventDefault(); });
  document.addEventListener('drop', (e) => { const t = on() && e.target.closest && e.target.closest('[data-luseat]'); if (!t) return; e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (!id) return; place(id, t.dataset.luseat); LU.pick = null; draw(); });
}

/** Called each time the page opens: a fresh lineup (nothing saved), everyone ticked. */
export function openLineups(rowers, c) {
  R = rowers; ctx = c; LU = fresh(); wire(); draw();
}
