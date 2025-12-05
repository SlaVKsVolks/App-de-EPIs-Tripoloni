const CACHE_NAME = 'app-ep-v9';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/styles.css',
    '/js/main.js',
    '/js/api.js',
    '/js/config.js',
    '/js/db.js',
    '/js/ui.js',
    '/logo-circle.svg',
    '/logo-t.svg',
    '/manifest.json'
];

// Install Event - Cache Assets
self.addEventListener('install', event => {
    console.log('[SW] Service Worker v8 installing...');
    self.skipWaiting(); // Force this SW to become the active one
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Caching App Shell');
                return cache.addAll(ASSETS_TO_CACHE);
            })
    );
});

// Activate Event - Cleanup Old Caches
self.addEventListener('activate', event => {
    console.log('[SW] Activating Service Worker...');
    event.waitUntil(
        caches.keys().then(keyList => {
            return Promise.all(keyList.map(key => {
                if (key !== CACHE_NAME) {
                    console.log('[SW] Removing old cache', key);
                    return caches.delete(key);
                }
            }));
        })
    );
    return self.clients.claim();
});

// Fetch Event - Network First, Fallback to Cache
self.addEventListener('fetch', event => {
    // 1. Ignore non-GET requests
    if (event.request.method !== 'GET') return;

    // 2. Ignore API requests (let the app handle offline logic for these via IndexedDB)
    if (event.request.url.includes('script.google.com')) {
        return;
    }

    // 3. Strategy: Network First
    event.respondWith(
        fetch(event.request)
            .then(networkResponse => {
                // Check if we received a valid response (200 OK)
                // We allow 'basic' (same-origin) and 'cors' (external valid)
                if (!networkResponse || networkResponse.status !== 200 || (networkResponse.type !== 'basic' && networkResponse.type !== 'cors')) {
                    return networkResponse;
                }

                // Clone the response because it's a stream and can only be consumed once
                const responseToCache = networkResponse.clone();

                caches.open(CACHE_NAME)
                    .then(cache => {
                        cache.put(event.request, responseToCache);
                    });

                return networkResponse;
            })
            .catch(() => {
                console.log('[SW] Network failed, falling back to cache for:', event.request.url);
                return caches.match(event.request)
                    .then(cachedResponse => {
                        if (cachedResponse) {
                            return cachedResponse;
                        }

                        // Fallback response if nothing is in cache
                        return new Response('Você está offline e este recurso não foi salvo.', {
                            status: 503,
                            statusText: 'Service Unavailable',
                            headers: { 'Content-Type': 'text/plain' }
                        });
                    });
            })
    );
});
