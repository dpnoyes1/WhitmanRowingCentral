// In-app Back (David, 2026-11-16; design advice from Fable). A small history of the pages
// opened in this tab, kept in sessionStorage, so Back returns to the last page with its
// scroll position and on-page choices. Each browser history entry carries its place in the
// stack ({ wrc: n }), so the Back button, the browser's Back and the iPhone edge-swipe
// all land on the same entry. Pure functions here; app.js does the DOM and storage.

export const KEY = 'wrc.backstack';
export const MAX = 40;

// state: { stack: [{ hash, y, ui, title }], pos }
// how: { idx: history.state.wrc or undefined, replace: a redirect replaced this entry,
//        reset: a menu or tab-bar link was tapped }
// Returns { state, kind, entry }: kind is 'new', 'reset', 'replace', 'same' (a redraw of the
// same entry), or 'restore' (Back or Forward to an entry we know); entry is the one now shown.
export function navStep(prev, hash, how = {}) {
  const st = valid(prev) ? { stack: prev.stack.slice(), pos: prev.pos } : { stack: [], pos: -1 };
  const top = st.stack[st.pos];
  if (how.replace && top) {
    st.stack[st.pos] = { hash };
    return { state: st, kind: 'replace', entry: st.stack[st.pos] };
  }
  const n = how.idx;
  if (Number.isInteger(n) && st.stack[n] && st.stack[n].hash === hash) {
    const kind = n === st.pos ? 'same' : 'restore';
    st.pos = n;
    return { state: st, kind, entry: st.stack[n] };
  }
  // A menu tap, an empty stack, or a history entry we no longer know (Back past a menu tap) starts over.
  if (how.reset || !top || Number.isInteger(n)) return { state: { stack: [{ hash }], pos: 0 }, kind: 'reset', entry: { hash } };
  if (top.hash === hash) return { state: st, kind: 'same', entry: top };
  const stack = st.stack.slice(0, st.pos + 1).concat({ hash });
  const cut = Math.max(0, stack.length - MAX);
  return { state: { stack: stack.slice(cut), pos: stack.length - 1 - cut }, kind: 'new', entry: stack[stack.length - 1] };
}

// Saves what the page being left looked like, so Back can put it back.
export function snapshot(prev, data) {
  if (!valid(prev) || !prev.stack[prev.pos]) return prev;
  const stack = prev.stack.slice();
  stack[prev.pos] = { ...stack[prev.pos], ...data };
  return { stack, pos: prev.pos };
}

// The page Back goes to: the previous page in this tab, or else a parent page (a deep link or
// a relaunched app has no history). Never leaves the app.
export function backTarget(st, hash, parent) {
  if (valid(st) && st.pos > 0 && st.stack[st.pos - 1]) {
    const p = st.stack[st.pos - 1];
    return { history: true, hash: p.hash, label: p.title || labelOf(p.hash) };
  }
  // parent: a page's own parent, as a hash or { hash, label } (a workout names its athlete).
  const up = parent ? (typeof parent === 'string' ? { hash: parent } : parent) : (parentOf(hash) ? { hash: parentOf(hash) } : null);
  return up && up.hash ? { history: false, hash: up.hash, label: up.label || labelOf(up.hash) } : null;
}

export function parentOf(hash) {
  const page = String(hash || '').replace(/^#\/?/, '').split('/')[0];
  if (page === 'athlete') return '#/athletes';
  return null;
}

const LABELS = { team: 'Team', week: 'Week', athletes: 'Athletes', boards: 'Boards', stars: 'GMS Rating', insights: 'Insights',
  completion: 'Attendance', attendance: 'Attendance', lineups: 'Lineups', weights: 'Weights', plan: 'Plan workouts',
  log: 'Log for an athlete', logrun: 'Log a workout', balance: 'Balance', settings: 'Settings', oyo: 'OYO', me: 'my page' };
export function labelOf(hash) {
  const page = String(hash || '').replace(/^#\/?/, '').split('/')[0];
  return LABELS[page] || '';
}

export function clampScroll(y, max) {
  const n = Number(y) || 0;
  return Math.max(0, Math.min(n, Math.max(0, max)));
}

function valid(st) {
  return !!st && Array.isArray(st.stack) && Number.isInteger(st.pos) && st.pos >= -1 && st.pos < st.stack.length;
}
