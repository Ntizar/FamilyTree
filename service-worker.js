/* ===========================================================
   FamilyTree Raíces — Service Worker
   PWA: cache estático + offline para el árbol guardado
   =========================================================== */
const CACHE_NAME = 'familytree-v2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './aurora.css',
  './app.js',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400&family=Inter:wght@300;400;500;600;700&display=swap',
];

// Install — cache everything
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first, then cache
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // For API-like calls or dynamic data, skip caching
  if (event.request.url.includes('cdnjs.cloudflare.com') || event.request.url.includes('fonts.googleapis.com')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        // Clone response to cache it
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});

// Background sync for auto-save
self.addEventListener('sync', event => {
  if (event.tag === 'sync-tree-data') {
    event.waitUntil(syncTreeData());
  }
});

async function syncTreeData() {
  // Placeholder for background sync logic
  // The tree data is already in localStorage
}

// Push notifications (future feature)
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Raíces';
  const options = {
    body: data.body || 'Tienes una actualización pendiente',
    icon: './data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Cpath d=%22M16 4 C12 8, 12 14, 16 16 C20 14, 20 8, 16 4 Z%22 fill=%22%232a4d3a%22/%3E%3Cpath d=%22M16 16 L16 28%22 stroke=%22%232a4d3a%22 stroke-width=%222%22 stroke-linecap=%22round%22/%3E%3C/svg%3E',
    badge: './data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Cpath d=%22M16 4 C12 8, 12 14, 16 16 C20 14, 20 8, 16 4 Z%22 fill=%22%232a4d3a%22/%3E%3C/svg%3E',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
