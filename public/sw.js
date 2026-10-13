/* ============================================================
 * Service Worker — Modo offline básico (Fase B)
 *
 * Estrategia:
 * - CÓDIGO de la app (JS/CSS de /public, fuera de /public/lib): NETWORK-FIRST
 *   con respaldo en caché. Antes era stale-while-revalidate y eso dejó
 *   pantallas clavadas en «Cargando…»: entregaba el JS viejo guardado y bajaba
 *   el nuevo para la SIGUIENTE carga, así que una copia mala bajo la misma URL
 *   (`counter.js?v=14`) se servía para siempre —Ctrl+F5 incluido— y el módulo
 *   nunca llegaba a ejecutarse. El código es lo único que NO puede quedarse
 *   viejo en silencio. (El módulo del mostrador se llama hoy `mostrador.js`:
 *   EasyPrivacy bloquea `/js/counter.js?` y uBlock mataba la petición.)
 * - Assets estáticos (imágenes, fuentes, librerías de /public/lib): cache-first
 *   con revalidación en segundo plano (stale-while-revalidate). Ahí el ahorro
 *   de red vale más y un archivo viejo no rompe nada.
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

// Subir esta versión BORRA las cachés viejas al activarse (ver activate): es la
// salida de emergencia cuando una copia mala quedó guardada en un navegador.
const CACHE_NAME = 'tomodachi-cache-v6';
const STATIC_ASSETS = [
  '/public/css/fonts.css',
  '/public/css/main.css',
  '/public/css/sidebar-modern.css',
  '/public/css/mobile-nav.css',
  '/public/css/dashboard.css',
  '/public/css/inventory.css',
  '/public/css/sales.css',
  '/public/css/promotions.css',
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
  '/public/assets/app-icons/tomodachi-icon-192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.allSettled(
      // Un cache.add() por activo en vez de un addAll() atómico: addAll rechaza
      // entero si UN solo request falla (404), el install falla y el navegador
      // descarta el SW. Con allSettled el SW se instala igual y queda en consola
      // qué activo faltó, en vez de perderse la funcionalidad offline completa.
      STATIC_ASSETS.map((url) => cache.add(url))
    ).then((results) => {
      const fallidos = results
        .map((r, i) => (r.status === 'rejected' ? STATIC_ASSETS[i] : null))
        .filter(Boolean);
      if (fallidos.length) {
        console.warn(`[SW] precache incompleto: ${fallidos.length} de ${STATIC_ASSETS.length} activos no se cachearon (el SW sigue activo):`, fallidos);
      }
      return self.skipWaiting();
    }))
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

  // CÓDIGO de la app (JS/CSS propios): network-first. Nunca se sirve una copia
  // guardada mientras haya red; la caché solo entra si la red falla (offline).
  // Las librerías de /public/lib se quedan con la estrategia de abajo: cambian
  // poco y pesan, así que ahí sí conviene el ahorro.
  const esCodigo = /\.(?:js|mjs|css)$/i.test(url.pathname) && !url.pathname.startsWith('/public/lib/');
  if (esCodigo) {
    event.respondWith(
      fetch(event.request)
        .then((resp) => {
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

  // Assets estáticos (imágenes, fuentes, librerías): stale-while-revalidate
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
      // El icono lo manda el servidor; si no viene, el de Tomodachi. Nunca el
      // default-logo.png, que era un PNG de 1x1 y salía como cuadro roto.
      icon: data.icon || '/public/assets/app-icons/tomodachi-icon-192.png',
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
