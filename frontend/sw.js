importScripts('/idb.js');

const CACHE_NAME = 'telesalud-shell-v10';
const APP_SHELL = [
  '/', '/index.html', '/styles.css', '/app.js', '/idb.js',
  '/manifest.json', '/protocolos.json', '/divipola.json', '/directorio_remision.json',
  '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Clinical/API traffic must never be served from cache — stale data here is a safety risk.
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// Chrome/Edge fire this once connectivity returns, waking the worker even with no tab open.
// Browsers without Background Sync support (Safari/Firefox) fall back to app.js's foreground
// online-event + polling retry, so the queue still drains once a tab is open and online.
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-encounters') {
    event.waitUntil(flushOutbox());
  }
});

async function flushOutbox() {
  const pending = await self.TelesaludDB.getOutbox();
  if (pending.length === 0) return;

  try {
    // Rojos primero, en su propio lote — ver TelesaludDB.sincronizar en idb.js. Mismo
    // comportamiento que el sondeo en primer plano (app.js), así una sincronización disparada
    // en segundo plano (pestaña cerrada) no trata un caso urgente distinto de uno rutinario.
    await self.TelesaludDB.sincronizar(pending[0]?.device_id);
    const clients = await self.clients.matchAll();
    clients.forEach((c) => c.postMessage({ type: 'sync-completed' }));
  } catch (e) {
    // Stay pending; the next 'sync' event or foreground retry will try again.
  }
}
