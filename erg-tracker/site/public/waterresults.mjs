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

function dayTab(v) {
  const { esc, fmtTime, fmtNum } = ctx;
  const clock = (s) => { const t = Math.round(s || 0), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60); return h ? `${h}:${String(m).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` : `${m}:${String(t % 60).padStart(2, '0')}`; };
  const crew = (c) => (c ? esc(c.names.join(', ')) + (c.cox ? ` · cox ${esc(c.cox)}` : '') : '<span class="warn-text">no lineup saved</span>');
  const at = (u) => new Date(u * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  return `<div class="card"><h2>Boats</h2>${v.boats.length ? `<div class="table-wrap"><table><thead><tr><th>Boat</th><th>Kind</th><th class="r">Moving</th><th class="r">Meters</th><th class="r">Avg split</th><th class="r">Rate</th></tr></thead><tbody>
      ${v.boats.map((b) => `<tr><td class="wr-who"><b>${esc(b.boatName)}</b> <span class="muted">${esc(b.boatClass)} · ${esc(b.shift)}</span><br><small class="muted">${crew(b.crew)}</small></td><td>${esc(b.kind)}${b.pieces ? ` (${b.pieces})` : ''}</td>
        <td class="r num">${clock(b.movingS)}</td><td class="r num">${fmtNum(b.meters)}</td><td class="r num">${b.avgSplitS ? fmtTime(b.avgSplitS) : '–'}</td><td class="r num">${b.avgRate ?? '–'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No water files imported for this day.</p>'}</div>
    <div class="card"><h2>Best split by duration</h2><p class="muted small">The fastest average split each boat held for that long today (${esc(v.rateKeys[v.rateKey])}). Mostly shows the day's conditions: compare boats on the same piece below, not across days.</p>
      ${curveTable(v.boats.map((b) => ({ ...b, points: b.curve })), v.durations, 'Boat', (b) => `<b>${esc(b.boatName)}</b> <span class="muted">${esc(b.boatClass)}</span>`)}</div>
    <div class="card"><h2>Pieces side by side</h2><p class="muted small">Pieces that started within a minute of each other over the same distance or time. Splits on the 8+ scale (a 4+ at 1.13), margin against the piece's average; + is faster. Sculling boats are listed but not compared.</p>
      ${v.groups.length ? v.groups.map((g) => `<div class="wr-piece"><h3>${at(g.start)} · ${fmtNum(g.results[0].meters)} m</h3><div class="table-wrap"><table><thead><tr><th>#</th><th>Boat</th><th class="r">Split</th><th class="r">8+ scale</th><th class="r">Margin</th><th class="r">Rate</th></tr></thead><tbody>
        ${g.results.map((r) => `<tr><td>${r.place ?? '–'}</td><td class="wr-who"><b>${esc(r.boatName)}</b> <span class="muted">${esc(r.boatClass)}</span><br><small class="muted">${crew(r.crew)}</small></td><td class="r num">${fmtTime(r.splitS)}</td><td class="r num">${r.adjSplitS ? fmtTime(r.adjSplitS) : '–'}</td>
          <td class="r num ${r.marginPct > 0 ? 'good-text' : r.marginPct < 0 ? 'warn-text' : ''}">${pct(r.marginPct)}</td><td class="r num">${r.rate ?? '–'}</td></tr>`).join('')}</tbody></table></div></div>`).join('')
        : `<p class="muted">No pieces rowed side by side this day.${v.unmatchedPieces ? ` ${v.unmatchedPieces} piece${v.unmatchedPieces === 1 ? '' : 's'} had no match: upload every boat's file on set-piece days.` : ' Comparisons come from set-piece days with every boat\'s file uploaded.'}</p>`}</div>`;
}

function seasonTab(v) {
  const { esc } = ctx;
  return `<div class="card"><h2>By boat</h2><p class="muted small">Season best for each duration (${esc(v.rateKeys[v.rateKey])}), with the rate and date it came from. A best-ever curve mostly shows the best day's water.</p>
      ${curveTable(v.season.byBoat, v.durations, 'Boat', (b) => `<b>${esc(b.boatName)}</b> <span class="muted">${esc(b.boatClass)}</span>`)}</div>
    <div class="card"><h2>By boat class</h2>${curveTable(v.season.byClass, v.durations, 'Class', (b) => esc(b.boatClass))}</div>
    <div class="card"><h2>By athlete</h2><p class="muted small">The best of any sweep boat she sat in, on the 8+ scale. It says what her boats did, not what she did.</p>
      ${curveTable(v.season.byAthlete, v.durations, 'Athlete', (a) => esc(a.name))}</div>`;
}

function winsTab(v) {
  const { esc } = ctx, r = v.ratings;
  const range = (x) => `${pct(x.range[0])} to ${pct(x.range[1])}`;
  return `<div class="card"><h2>Who generally wins</h2>
      <p class="muted small">From ${r.pieces} compared piece${r.pieces === 1 ? '' : 's'} in sweep boats this season. <b>Rating</b>: how much faster than the field a boat of rowers like her would be, after accounting for who she sat with. The range is where the number would land 80% of the time with other pieces; ratings whose ranges overlap can't be told apart. A rating shows once she has ${r.minPieces} compared pieces across ${r.minLineups} different lineups. It sorts the top and bottom well and the middle poorly, and supports seat racing; it doesn't replace it.</p>
      ${r.rowers.length ? `<div class="table-wrap"><table><thead><tr><th>Rower</th><th class="r">Rating</th><th class="r">Range</th><th class="r">Pieces</th><th class="r">Lineups</th><th class="r">Won</th><th class="r">Avg margin</th></tr></thead><tbody>
        ${r.rowers.map((x) => `<tr class="${x.status === 'ok' ? '' : 'muted'}"><td class="wr-who"><b>${esc(x.name)}</b>${x.sameAs.length ? `<br><small class="warn-text">always with ${esc(x.sameAs.join(', '))}</small>` : ''}</td>
          <td class="r num">${x.status === 'ok' ? `<b>${pct(x.rating)}</b>` : 'too early'}</td><td class="r num">${x.status === 'ok' ? range(x) : ''}</td>
          <td class="r num">${x.pieces}</td><td class="r num">${x.lineups}</td><td class="r num">${x.wins}</td><td class="r num">${pct(x.avgMarginPct)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No compared pieces yet. Set-piece days with every boat\'s file and a saved lineup for each boat give results.</p>'}
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
    if (t.dataset.wrdate) { state.date = t.value; draw(); } else if (t.dataset.wrrate) { state.rate = t.value; draw(); } });
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
