/**
 * PVWatts Studio service worker.
 *
 * Makes the site installable and lets the interface open without a network.
 * Estimates still need the network: the PVWatts and geocoding requests are
 * never intercepted, so offline they fail with the client's normal
 * "Check your network connection" error instead of replaying old results.
 *
 * Caching rules:
 *   - the app shell (this origin) is precached on install and served from the
 *     cache, so the files on screen always come from one deployment;
 *   - news.json is network-first, falling back to the last copy offline (the
 *     news view shows that copy's rebuild time);
 *   - version-pinned jsDelivr files (Chart.js, pdf.js) are cache-first, since a
 *     pinned URL never changes;
 *   - every other request goes straight to the network.
 *
 * The deploy workflow replaces BUILD_ID with the commit SHA, so each deploy
 * installs a fresh cache and deletes the previous one. Served unstamped (local
 * development), the shell is fetched network-first so edits show on reload.
 */

const BUILD_ID = '__BUILD_ID__';
const IS_STAMPED = !BUILD_ID.startsWith('__');
const SHELL_CACHE = `pvwatts-shell-${BUILD_ID}`;
const RUNTIME_CACHE = 'pvwatts-runtime-v1';

const APP_SHELL = [
  './',
  'index.html',
  'styles.css',
  'pvwatts_client.js',
  'orientation_model.js',
  'magnetic_declination.js',
  'datasheet_parser.js',
  'app.js',
  'datasheet.js',
  'news.js',
  'news.json',
  'favicon.svg',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

// Needed to draw any result, so it is fetched up front rather than on first use.
const PRECACHED_CDN = ['https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'];

// Only immutable, version-pinned package URLs (name@1.2.3) are cached.
const PINNED_CDN = /^https:\/\/cdn\.jsdelivr\.net\/npm\/(?:@[^/]+\/)?[^/@]+@\d+\.\d+\.\d+\//;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    // 'reload' bypasses the HTTP cache so the precache matches this deploy.
    await shell.addAll(APP_SHELL.map(url => new Request(url, { cache: 'reload' })));
    // Best effort: an unreachable CDN must not stop the shell from installing.
    // The page's own request fills the cache later if this one fails.
    const runtime = await caches.open(RUNTIME_CACHE);
    await runtime.addAll(PRECACHED_CDN).catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(name => name.startsWith('pvwatts-') && name !== SHELL_CACHE && name !== RUNTIME_CACHE)
        .map(name => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/news.json')) {
      event.respondWith(networkFirst(request, SHELL_CACHE));
    } else if (IS_STAMPED) {
      event.respondWith(cacheFirst(request, SHELL_CACHE));
    } else {
      event.respondWith(networkFirst(request, SHELL_CACHE));
    }
    return;
  }

  if (PINNED_CDN.test(request.url)) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
  }
  // Anything else (PVWatts, Nominatim, publisher links) is left to the network.
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  // Navigations can carry a query string; the shell is the same page regardless.
  const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}
