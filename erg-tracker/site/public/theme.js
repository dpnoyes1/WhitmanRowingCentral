// Light / dark switch (David, 2026-10-25). No saved choice = follow the device
// (style.css handles that). A choice is remembered on this device only.
// Loaded in <head> so the theme is set before the page paints.
(function () {
  const KEY = 'wrc.theme';   // 'light' | 'dark'; absent = follow the device
  const root = document.documentElement;
  const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

  function saved() {
    try { return localStorage.getItem(KEY); } catch { return null; }
  }
  function save(v) {
    try { v === null ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, v); } catch { /* private mode */ }
  }

  const choice = saved();
  if (choice === 'light' || choice === 'dark') root.dataset.theme = choice;

  function current() {
    return root.dataset.theme || (systemDark() ? 'dark' : 'light');
  }

  function paint(button) {
    const dark = current() === 'dark';
    // Show the icon for where a click takes you: moon in light mode, sun in dark.
    button.innerHTML = dark
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="currentColor"/></svg>';
    const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('theme');
    if (!button) return;
    paint(button);
    button.addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      save(next);
      paint(button);
    });
  });
})();
