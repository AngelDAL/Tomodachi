/* ============================================================
 * Service worker del SEGUIMIENTO de un pedido de mostrador.
 *
 * Es aparte del service worker de la app (public/sw.js) a propósito: aquel cachea el POS para
 * uso sin conexión y no tiene nada que hacer en el teléfono de un cliente. Este solo recibe el
 * push del aviso "tu pedido está listo" y abre el enlace al tocarlo.
 * ============================================================ */

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (event) {
    var datos = { title: 'Tu pedido', body: 'Hay una actualización de tu pedido.' };
    try {
        if (event.data) {
            var j = event.data.json();
            datos = Object.assign(datos, j || {});
        }
    } catch (e) { /* payload no-JSON: se usa el texto por defecto */ }

    event.waitUntil(self.registration.showNotification(datos.title, {
        body: datos.body,
        // El icono lo manda el servidor (el logo del negocio, o el de Tomodachi). Nunca el
        // default-logo.png de antes: era un PNG de 1x1 y el navegador pintaba un cuadro roto.
        icon: datos.icon || '/public/assets/app-icons/tomodachi-icon-192.png',
        tag: 'tomodachi-pedido',
        renotify: true,
        requireInteraction: true,
        vibrate: [120, 60, 120],
        data: { url: datos.url || '/public/seguimiento.html' }
    }));
});

self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    var url = (event.notification.data && event.notification.data.url) || '/public/seguimiento.html';
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (lista) {
        for (var i = 0; i < lista.length; i++) {
            if (lista[i].url === url && 'focus' in lista[i]) return lista[i].focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
    }));
});
