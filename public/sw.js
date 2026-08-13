/* ============================================================
 * Service Worker — Modo offline básico (Fase B)
 *
 * Estrategia:
 * - Assets estáticos (JS/CSS/imágenes/fuentes): cache-first con
 *   revalidación en segundo plano (stale-while-revalidate).
 * - Navegación (HTML): network-first con fallback a caché
 *   (así siempre ves la última versión cuando hay internet).
 * - API de solo lectura (productos, categorías, clientes):
 *   network-first con fallback a caché.
 * - Las ventas offline NO se cachean aquí: el frontend las
 *   encola en IndexedDB (tomodachi_offline_queue) y se sincronizan
 *   al recuperar conexión (ver app.js / sales.js).
 *
 * Registro: public/js/offline.js (guard para HTTPS).
 * ============================================================ */

const CACHE_NAME = 'tomodachi-cache-v3';
const STATIC_ASSETS = [
  '/public/css/fonts.css',
  '/public/css/main.css',
  '/public/css/sidebar-modern.css',
  '/public/css/mobile-nav.css',
  '/public/css/dashboard.css',
  '/public/css/inventory.css',
  '/public/css/sales.css',
  '/public/css/promotions.css',
  '/public/css/finance.css',
  '/public/css/reports.css',
  '/public/js/app.js',
  '/public/js/sidebar-loader.js',
  '/public/js/theme-init.js',
  '/public/js/thermal-print.js',
  '/public/lib/fontawesome/css/all.min.css',
  '/public/lib/fontawesome/webfonts/fa-solid-900.woff2',
  '/public/lib/fontawesome/webfonts/fa-regular-400.woff2',
  '/public/lib/fontawesome/webfonts/fa-brands-400.woff2',
  '/public/lib/qrcodejs/qrcode.min.js',
  '/public/lib/html5-qrcode/html5-qrcode.min.js',
  '/public/assets/images/default-logo.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Guard: solo interceptar rutas de la app (mismo origen, /public)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith('/public/')) return;

  // API de solo lectura: network-first con fallback a caché.
  // SOLO se cachean respuestas exitosas (status 200) — nunca errores,
  // 401/403/500 ni bodies de error, o el SW serviría "vacíos" después.
  // verify_session.php NO se cachea (depende de la sesión activa).
  if (url.pathname.includes('/api/')) {
    if (event.request.method !== 'GET') return; // POST/PUT/DELETE pasan directo (cola offline del frontend)
    if (url.pathname.includes('verify_session.php')) {
      // Sesión: siempre a red, sin caché (evita servir sesiones viejas)
      event.respondWith(fetch(event.request).catch(() => new Response('{"success":false,"message":"offline"}', { status: 503, headers: { 'Content-Type': 'application/json' } })));
      return;
    }
    event.respondWith(
      fetch(event.request)
        .then((resp) => {
          // Solo cachear respuestas válidas de datos
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Navegación (HTML): network-first con fallback a caché
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached || caches.match('/public/dashboard.html')))
    );
    return;
  }

  // Assets estáticos: stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((resp) => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return resp;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

/* ============================================================
 * Push (FCM) — receptor de notificaciones
 * (B6; se activa solo si hay VAPID configurado en el servidor)
 * ============================================================ */
self.addEventListener('push', (event) => {
  let data = { title: 'Tomodachi POS', body: 'Nueva notificación', url: '/public/dashboard.html' };
  try { data = event.data ? event.data.json() : data; } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'Tomodachi POS', {
      body: data.body || '',
      icon: '/public/assets/images/default-logo.png',
      badge: '/public/assets/images/default-logo.png',
      data: { url: data.url || '/public/dashboard.html' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/public/dashboard.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) { client.navigate(url); return client.focus(); }
      }
      return clients.openWindow(url);
    })
  );
});
