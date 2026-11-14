// Offline home-screen shell (David, 2026-11-03). Caches only the app's own
// files so the installed app opens and shows its menu without a connection.
// Data (/api/*), sign-in and photos are never cached: they need the network.
const CACHE = 'whitman-shell-v6';
const SHELL = ['/', '/index.html', '/app.js', '/practice.mjs', '/lineups.mjs', '/plan.mjs', '/logmine.mjs', '/photo.mjs', '/icons/concept2.png', '/fonts/inter-400.woff2', '/fonts/inter-600.woff2', '/fonts/inter-700.woff2', '/theme.js', '/style.css', '/manifest.webmanifest',
  '/logo.png', '/favicon.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Network first so a new deploy shows at once; the cached copy is the offline fallback.
  event.respondWith(fetch(req).then((res) => {
    if (res.ok && SHELL.includes(url.pathname)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') return (await caches.match('/index.html')) || Response.error();
    return Response.error();
  }));
});
