/**
 * @file service-worker.js
 * @description PWA Service Worker for EDGE V6. Handles caching, offline capabilities,
 * network request interception, and background sync mechanisms for the quantitative OS.
 * @version 6.0.0
 */

const CACHE_VERSION = 'v6.0.0';
const CACHE_KEYS = {
    CORE: `edge-core-${CACHE_VERSION}`,
    DYNAMIC: `edge-dynamic-${CACHE_VERSION}`,
    DATA: `edge-data-${CACHE_VERSION}`
};

/**
 * Array of critical static assets required for the app shell to function offline.
 * Performance Consideration: Keep this list strictly to critical path assets
 * to minimize Time To Interactive (TTI) during the installation phase.
 * @type {string[]}
 */
const CRITICAL_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './css/reset.css',
    './css/theme.css',
    './css/animations.css',
    './css/mobile.css',
    './css/desktop.css',
    './js/bootstrap.js'
];

/**
 * Install Event Handler
 * Pre-caches critical app shell assets immediately upon installation.
 */
self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            try {
                const cache = await caches.open(CACHE_KEYS.CORE);
                await cache.addAll(CRITICAL_ASSETS);
                // Force the waiting service worker to become the active service worker
                self.skipWaiting();
            } catch (error) {
                console.error('[ServiceWorker] Installation caching failed:', error);
            }
        })()
    );
});

/**
 * Activate Event Handler
 * Cleans up legacy caches from previous versions to free up storage space.
 */
self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            try {
                const existingCaches = await caches.keys();
                const validCacheNames = Object.values(CACHE_KEYS);
                
                await Promise.all(
                    existingCaches.map((cacheName) => {
                        if (!validCacheNames.includes(cacheName)) {
                            return caches.delete(cacheName);
                        }
                    })
                );
                
                // Ensure the service worker takes control of all clients immediately
                self.clients.claim();
            } catch (error) {
                console.error('[ServiceWorker] Activation cleanup failed:', error);
            }
        })()
    );
});

/**
 * Strategy: Cache First, falling back to Network
 * Ideal for static assets (CSS, JS, Fonts, Images) that are immutable per version.
 * * @param {Request} request 
 * @returns {Promise<Response>}
 */
async function handleCacheFirstStrategy(request) {
    try {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }

        const networkResponse = await fetch(request);
        
        // Only cache valid, HTTP OK responses (ignore opaque responses for safety)
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const cache = await caches.open(CACHE_KEYS.CORE);
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.error(`[ServiceWorker] Cache-First fetch failed for ${request.url}:`, error);
        throw error;
    }
}

/**
 * Strategy: Network First, falling back to Cache
 * Ideal for API calls and dynamic data requests.
 * * @param {Request} request 
 * @returns {Promise<Response>}
 */
async function handleNetworkFirstStrategy(request) {
    try {
        const networkResponse = await fetch(request);
        
        if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(CACHE_KEYS.DATA);
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        throw new Error('[ServiceWorker] Network and Cache both failed.');
    }
}

/**
 * Fetch Event Handler
 * Intercepts network requests and routes them to the appropriate caching strategy.
 */
self.addEventListener('fetch', (event) => {
    const requestUrl = new URL(event.request.url);

    // Bypass caching for WebSocket connections and WebWorker scripts (if rapidly iterating)
    if (requestUrl.protocol === 'wss:' || requestUrl.protocol === 'ws:') {
        return;
    }

    // Bypass caching for strictly API endpoints (e.g., OKX REST fallbacks)
    if (requestUrl.hostname.includes('okx.com') || requestUrl.hostname.includes('api.')) {
        event.respondWith(handleNetworkFirstStrategy(event.request));
        return;
    }

    // Use Cache First for local assets
    event.respondWith(handleCacheFirstStrategy(event.request));
});

/**
 * Message Event Handler
 * Listens for messages from the client to trigger actions like forced updates.
 */
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
