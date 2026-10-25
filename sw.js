// Service worker: appka funguje offline. Při změně souborů zvyš VERSION (dělá to karticky_deploy.py).
const VERSION = 'v2';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css', 'js/app.js', 'cards.json', 'semestr.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
const SHELL_CACHE = `shell-${VERSION}`;
const FONT_CACHE = 'fonts';

self.addEventListener('install', e => {
  // cache: 'reload' – obejít HTTP cache GitHub Pages, jinak by nová verze mohla uložit staré soubory
  e.waitUntil(caches.open(SHELL_CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('shell-') && k !== SHELL_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Apps Script vždy ze sítě (offline řeší fronta změn v appce)
  if (url.hostname.endsWith('script.google.com') || url.hostname.endsWith('googleusercontent.com')) return;

  if (url.hostname.includes('fonts.g')) {
    e.respondWith(caches.open(FONT_CACHE).then(async c => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then(r => { c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  if (url.origin === location.origin) {
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
  }
});
