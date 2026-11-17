// Water results page (coaches only; on-water plan Steps 3 and 4). Reads /api/water/report, which comes straight from the Sheet, never
// from the athlete feed. Day: each boat's numbers and best split by duration, and pieces rowed side by side with margins on the 8+ scale.
// Season: best curves by boat, class and athlete. Who generally wins: win record and the adjusted rating with its range.

let ctx = null, wired = false, state = { date: '', rate: 'all', tab: 'day' };

export const durLabel = (d) => (d < 60 ? d + 's' : d / 60 + "'");
const pct = (x) => (x === null || x === undefined ? '–' : (x > 0 ? '+' : '') + x.toFixed(1) + '%');

let emptyText = 'Nothing yet.';
function curveTable(rows, durations, label, cellFor) {
  const { esc, fmtTime } = ctx;
  const used = durations.filter((d) => rows.some((r) => r.points.some((p) => p.durS === d)));
  if (!rows.length || !used.length) return `<p class="muted small">${ctx.esc(emptyText)}</p>`;
  return `<div class="table-wrap"><table class="wr-curve"><thead><tr><th>${esc(label)}</th>${used.map((d) => `<th class="r">${durLabel(d)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${cellFor(r)}</td>${used.map((d) => { const p = r.points.find((x) => x.durS === d);
      return `<td class="r num">${p ? `${fmtTime(p.splitS)}<br><small class="muted">${p.rate ? p.rate.toFixed(0) + ' spm' : ''}${p.from ? ' · ' + esc(p.from.slice(5)) : ''}</small>` : ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
}

const COLORS = ['#6cb4ee', '#f5a742', '#5cc98a', '#c48bf0', '#ef6f6c', '#e8d35a'];

/** A split-by-duration curve like cycling's power curve: time on a log scale across, faster splits higher. series: [{ label, points }]. */
export function curveChart(series, durations) {
  const { esc, fmtTime } = ctx;
  const lines = series.filter((x) => x.points.length);
  if (!lines.length) return '';
  const W = 720, H = 260, L = 56, R = 16, T = 14, B = 34;
  const all = lines.flatMap((x) => x.points.map((p) => p.splitS));
  const step = [1, 2, 5, 10, 15, 20, 30, 60].find((k) => (Math.max(...all) - Math.min(...all)) / k <= 5) || 60;   // round split steps
  const lo = Math.floor(Math.min(...all) / step) * step, hi = Math.ceil(Math.max(...all) / step) * step + (Math.max(...all) % step === 0 ? step : 0);
  const d0 = Math.log(durations[0]), d1 = Math.log(durations[durations.length - 1]);
  const x = (d) => L + ((Math.log(d) - d0) / (d1 - d0)) * (W - L - R);
  const y = (sp) => T + ((sp - lo) / (hi - lo)) * (H - T - B);   // faster (lower split) at the top
  const grid = [];
  for (let v = lo; v <= hi; v += step) grid.push(v);
  return `<figure class="wr-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Best split by duration">
    ${grid.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${fmtTime(v).replace(/\.0$/, '')}</text>`).join('')}
    ${durations.map((d) => `<line x1="${x(d)}" x2="${x(d)}" y1="${T}" y2="${H - B}" class="g"/><text x="${x(d)}" y="${H - B + 16}" text-anchor="middle">${durLabel(d)}</text>`).join('')}
    ${lines.map((ln, i) => { const c = COLORS[i % COLORS.length], pts = ln.points.filter((p) => durations.includes(p.durS));
      return `<polyline points="${pts.map((p) => x(p.durS) + ',' + y(p.splitS)).join(' ')}" fill="none" stroke="${c}" stroke-width="2.5"/>` +
        pts.map((p) => `<circle cx="${x(p.durS)}" cy="${y(p.splitS)}" r="3.5" fill="${c}"><title>${esc(ln.label)} ${durLabel(p.durS)}: ${fmtTime(p.splitS)}${p.rate ? ' at ' + p.rate.toFixed(0) : ''}</title></circle>`).join(''); }).join('')}
  </svg><figcaption>${lines.map((ln, i) => `<span><i style="background:${COLORS[i % COLORS.length]}"></i>${esc(ln.label)}</span>`).join('')}<span class="muted">split /500m, faster is higher; time across on a log scale</span></figcaption></figure>`;
}

function dayTab(v) {
  const { esc, fmtTime, fmtNum } = ctx;
  const clock = (s) => { const t = Math.round(s || 0), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60); return h ? `${h}:${String(m).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` : `${m}:${String(t % 60).padStart(2, '0')}`; };
  const crew = (c) => (c ? esc(c.names.join(', ')) + (c.cox ? ` · cox ${esc(c.cox)}` : '') : '<span class="warn-text">no lineup saved</span>');
  const at = (u) => new Date(u * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  return `<div class="card"><h2>Boats</h2>${v.boats.length ? `<div class="table-wrap"><table><thead><tr><th>Boat</th><th>Kind</th><th class="r">Moving</th><th class="r">Meters</th><th class="r">Avg split</th><th class="r">Rate</th></tr></thead><tbody>
      ${v.boats.map((b) => `<tr><td class="wr-who"><b>${esc(b.boatName)}</b> <span class="muted">${esc(b.boatClass)}</span><br><small class="muted">${crew(b.crew)}</small></td><td>${esc(b.kind)}${b.pieces ? ` (${b.pieces})` : ''}</td>
        <td class="r num">${clock(b.movingS)}</td><td class="r num">${fmtNum(b.meters)}</td><td class="r num">${b.avgSplitS ? fmtTime(b.avgSplitS) : '–'}</td><td class="r num">${b.avgRate ?? '–'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No water files imported for this day.</p>'}</div>
    <div class="card"><h2>Best split by duration</h2><p class="muted small">The fastest average split each boat held for that long today (${esc(v.rateKeys[v.rateKey])}). Mostly shows the day's conditions: compare boats on the same piece below, not across days.</p>
      ${curveChart(v.boats.map((b) => ({ label: b.boatName + ' ' + b.boatClass, points: b.curve })), v.durations)}
      ${curveTable(v.boats.map((b) => ({ ...b, points: b.curve })), v.durations, 'Boat', (b) => `<b>${esc(b.boatName)}</b> <span class="muted">${esc(b.boatClass)}</span>`)}</div>
    <div class="card"><h2>Pieces side by side</h2><p class="muted small">Pieces that started within a minute of each other over the same distance or time. Splits on the 8+ scale (a 4+ at 1.13), margin against the piece's average; + is faster. Sculling boats are listed but not compared.</p>
      ${v.groups.length ? `<div class="wr-use"><label>This day in Who wins <select data-wruse="1">${['Automatic', 'Count', 'Leave out'].map((u) => `<option${u === v.dayOverride ? ' selected' : ''}>${u}</option>`).join('')}</select></label>
          <span class="muted small">Automatic counts a piece only when the boats are within ${v.ratings.evenGmsPts} GMS points and the same crews have not raced on ${v.ratings.progressionDays}+ days. Change it if a day is mislabeled.</span></div>` : ''}
      ${v.groups.length ? v.groups.map((g) => `<div class="wr-piece"><h3>${at(g.start)} · ${fmtNum(g.results[0].meters)} m <span class="pill ${g.rating.counts ? 'good' : 'warn'}">${!g.rating.counts ? 'Left out of Who wins' : Object.values(g.rating.boats || {}).every(Boolean) ? 'Counts in Who wins' : 'Counts in Who wins (some boats)'}</span></h3><p class="muted small">${esc(g.rating.reason)}</p><div class="table-wrap"><table><thead><tr><th>#</th><th>Boat</th><th class="r">Split</th><th class="r">8+ scale</th><th class="r">Margin</th><th class="r">Rate</th></tr></thead><tbody>
        ${g.results.map((r) => `<tr><td>${r.place ?? '–'}</td><td class="wr-who"><b>${esc(r.boatName)}</b> <span class="muted">${esc(r.boatClass)}</span>${g.rating.counts && g.rating.boats && g.rating.boats[r.boatName] === false ? ' <span class="pill">not counted</span>' : ''}<br><small class="muted">${crew(r.crew)}</small></td><td class="r num">${fmtTime(r.splitS)}</td><td class="r num">${r.adjSplitS ? fmtTime(r.adjSplitS) : '–'}</td>
          <td class="r num ${r.marginPct > 0 ? 'good-text' : r.marginPct < 0 ? 'warn-text' : ''}">${pct(r.marginPct)}</td><td class="r num">${r.rate ?? '–'}</td></tr>`).join('')}</tbody></table></div></div>`).join('')
        : `<p class="muted">No pieces rowed side by side this day.${v.unmatchedPieces ? ` ${v.unmatchedPieces} piece${v.unmatchedPieces === 1 ? '' : 's'} had no match: upload every boat's file on set-piece days.` : ' Comparisons come from set-piece days with every boat\'s file uploaded.'}</p>`}</div>`;
}

function seasonTab(v) {
  const { esc } = ctx;
  return `<div class="card"><h2>By boat</h2><p class="muted small">Season best for each duration (${esc(v.rateKeys[v.rateKey])}), with the rate and date it came from. A best-ever curve mostly shows the best day's water.</p>
      ${curveChart(v.season.byBoat.map((b) => ({ label: b.boatName + ' ' + b.boatClass, points: b.points })), v.durations)}
      ${curveTable(v.season.byBoat, v.durations, 'Boat', (b) => `<b>${esc(b.boatName)}</b> <span class="muted">${esc(b.boatClass)}</span>`)}</div>
    <div class="card"><h2>By boat class</h2>${curveChart(v.season.byClass.map((b) => ({ label: b.boatClass, points: b.points })), v.durations)}${curveTable(v.season.byClass, v.durations, 'Class', (b) => esc(b.boatClass))}</div>
    <div class="card"><h2>By athlete</h2><p class="muted small">The best of any sweep boat she sat in, on the 8+ scale. It says what her boats did, not what she did.</p>
      ${curveTable(v.season.byAthlete, v.durations, 'Athlete', (a) => esc(a.name))}</div>`;
}

function winsTab(v) {
  const { esc } = ctx, r = v.ratings;
  const range = (x) => (x.range[0] == null ? '' : `${pct(x.range[0])} to ${pct(x.range[1])}`);
  const out = Object.entries(r.leftOut).map(([why, n]) => `${n} ${esc(why)}`).join('; ');
  const erg = r.slope != null;
  return `<div class="card"><h2>Who generally wins</h2>
      <p class="small">From <b>${r.pieces}</b> piece${r.pieces === 1 ? '' : 's'} in even lineups (boats within ${r.evenGmsPts} GMS points) on ${r.days} day${r.days === 1 ? '' : 's'}, <b>${r.lineups}</b> different lineup${r.lineups === 1 ? '' : 's'}.${out ? ` Left out: ${out}.` : ''}</p>
      ${!r.gmsKnown ? '<p class="small warn-text">No GMS % could be read, so no lineup can be judged even yet.</p>' : ''}
      ${r.rowers.length && !r.enough ? `<p class="small warn-text">Early: ${r.lineups} different lineups for ${r.rowers.filter((x) => x.status !== 'too early').length} rated rowers. Numbers settle once there are about as many different lineups as rowers. Swapping rowers between boats between pieces helps most.</p>` : ''}
      <p class="muted small"><b>From erg</b>: what her GMS % predicts (${erg ? `1 GMS point is worth about ${r.slope.toFixed(2)}% of boat speed on the water, learned from ${r.slopeBasis} uneven pieces` : 'not learned yet: needs some pieces with boats at least 1.5 GMS points apart, so ratings are not split yet'}). <b>Beyond erg</b>: what she adds on the water beyond that, after accounting for who she sat with. <b>Overall</b> is the two together. Differences inside the range are not real. Rowers who have not swapped boats against each other cannot be separated. Use this as one input alongside seat races.</p>
      ${r.rowers.length ? `<div class="table-wrap"><table><thead><tr><th>Rower</th><th class="r">Overall</th><th class="r">From erg</th><th class="r">Beyond erg</th><th class="r">Range</th><th class="r">Pieces</th><th class="r">Lineups</th><th class="r">Won</th></tr></thead><tbody>
        ${r.rowers.map((x) => `<tr class="${x.status === 'too early' ? 'muted' : ''}"><td class="wr-who"><b>${esc(x.name)}</b>${x.status === 'early' ? ' <span class="pill">early</span>' : ''}${x.sameAs.length ? `<br><small class="warn-text">always with ${esc(x.sameAs.join(', '))}</small>` : ''}</td>
          ${x.status === 'too early' ? '<td class="r num" colspan="4">too early</td>' : `<td class="r num"><b>${pct(x.overall)}</b></td><td class="r num">${x.fromErg == null ? '–' : pct(x.fromErg)}</td><td class="r num">${pct(x.rating)}</td><td class="r num">${range(x)}</td>`}
          <td class="r num">${x.pieces}</td><td class="r num">${x.lineups}</td><td class="r num">${x.wins}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No pieces count yet. Set-piece days in even lineups, with every boat\'s file and a saved lineup for each boat, give results.</p>'}
      ${r.together.length ? `<p class="small warn-text">Always in the same boat, so not separable: ${r.together.map((g) => esc(g.join(' and '))).join('; ')}. Mix them into different boats to tell them apart.</p>` : ''}</div>
    ${r.shells.length > 1 || r.coxes.length > 1 ? `<div class="card"><h2>Shells and coxswains</h2><p class="muted small">The same fit also estimates what each shell and coxswain adds. Treat it the same way: ranges that overlap mean no difference.</p>
      <div class="table-wrap"><table><tbody>${r.shells.map((s) => `<tr><td>Shell <b>${esc(s.shell)}</b></td><td class="r num">${pct(s.rating)}</td><td class="r num">${range(s)}</td></tr>`).join('')}
      ${r.coxes.map((c) => `<tr><td>Cox <b>${esc(c.name)}</b></td><td class="r num">${pct(c.rating)}</td><td class="r num">${range(c)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
}

async function load() {
  const q = new URLSearchParams({ rate: state.rate, ...(state.date ? { date: state.date } : {}) });
  const res = await fetch('/api/water/report?' + q, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || 'Could not load the water results.');
  return out;
}

async function saveUse(use) {
  const res = await fetch('/api/water/ratings-use', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: state.date, use }) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) alert(out.error || 'Could not save that.');
  draw();
}

async function draw() {
  const { app, esc } = ctx;
  let v;
  try { v = await load(); } catch (e) { app.querySelector('.wr-body').innerHTML = `<p class="warn-text">${esc(e.message)}</p>`; return; }
  if (!document.querySelector('.wresults')) return;
  state.date = v.date;
  emptyText = v.rateKey === 'all' ? 'Nothing yet.' : 'No stretch at ' + v.rateKeys[v.rateKey].replace(' and under', ' strokes a minute or under') + ' yet.';
  const tabs = [['day', 'Day'], ['season', 'Curves'], ['wins', 'Who wins']];
  app.querySelector('.wr-tools').innerHTML = `<label>Day <select data-wrdate="1">${v.days.length ? v.days.map((d) => `<option${d === v.date ? ' selected' : ''}>${esc(d)}</option>`).join('') : '<option>none yet</option>'}</select></label>
    <label>Stroke rate <select data-wrrate="1">${Object.entries(v.rateKeys).map(([k, t]) => `<option value="${k}"${k === v.rateKey ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
    <div class="seg" role="group" aria-label="View">${tabs.map(([k, t]) => `<button type="button" aria-pressed="${state.tab === k}" data-wrtab="${k}">${t}</button>`).join('')}</div>`;
  app.querySelector('.wr-body').innerHTML = state.tab === 'day' ? dayTab(v) : state.tab === 'season' ? seasonTab(v) : winsTab(v);
}

function wire() {
  if (wired) return; wired = true;
  const on = () => !!ctx && !!document.querySelector('.wresults');
  document.addEventListener('change', (e) => { const t = on() && e.target; if (!t || !t.dataset) return;
    if (t.dataset.wrdate) { state.date = t.value; draw(); } else if (t.dataset.wrrate) { state.rate = t.value; draw(); } else if (t.dataset.wruse) saveUse(t.value); });
  document.addEventListener('click', (e) => { const b = on() && e.target.closest && e.target.closest('[data-wrtab]'); if (!b) return; state.tab = b.dataset.wrtab; draw(); });
}

/** Called each time the page opens. */
export function openWaterResults(c) {
  ctx = c; wire();
  ctx.app.innerHTML = `<div class="wresults"><div class="head"><div><div class="eyebrow">Coach tools · athletes never see this page</div><h1>Water results</h1>
    <p class="muted">Wind, current and water temperature move a split far more than a lineup change does, so the fair comparison is boats on the same piece at the same time.</p></div></div>
    <div class="card wr-tools"></div><div class="wr-body"><p class="muted">Loading...</p></div></div>`;
  draw();
}
