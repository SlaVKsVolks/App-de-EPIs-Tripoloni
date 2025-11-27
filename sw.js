const CACHE_NAME = 'epi-manager-v4';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './app.js',
    './manifest.json',
    'https://cdn-icons-png.flaticon.com/512/3063/3063823.png'
];

// Install Event - Cache Assets
self.addEventListener('install', event => {
    console.log('[SW] Service Worker v3 installing...');
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

// Fetch Event - Serve from Cache if Offline
self.addEventListener('fetch', event => {
    // 1. Ignore non-GET requests
    if (event.request.method !== 'GET') return;

    // 2. Ignore API requests (let the app handle offline logic for these via IndexedDB)
    if (event.request.url.includes('script.google.com')) {
        return;
    }

    // 3. Cache First, Fallback to Network
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                return fetch(event.request).catch(error => {
                    console.error('[SW] Fetch failed:', event.request.url, error);
                    // Return a fallback response so the app doesn't crash
                    return new Response('Network error occurred', {
                        status: 408,
                        statusText: 'Network Error'
                    });
                });
            })
    );
});
