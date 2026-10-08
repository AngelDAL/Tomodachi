/* ============================================================
 * Kiosko del mostrador: la pantalla que ve el cliente parado frente a la caja.
 *
 * Dos estados:
 *   1. LISTA: todos los pedidos activos, en tarjetas grandes para leer de lejos.
 *   2. DESTACADO: un solo pedido en pantalla con su QR, cuando la cajera lo manda
 *      (evento `kiosko_qr` por el canal de la tienda) o cuando lo abre esta vez.
 *
 * Todo en vivo por WebSocket: el backend ya emite `order_update` (crear/avisar/entregar/
 * cancelar) y `kiosko_qr` al canal de la tienda, y aquí no se sondea nada.
 *
 * El QR del pedido apunta a `seguimiento.html?t=<token>`: esa es la página donde el cliente
 * ve el tiempo, el estado y el pago, así que el kiosko le da la llave de entrada.
 *
 * Nota pendiente (por pedido del dueño): en reposo, cuando nadie usa la pantalla, se podrá
 * mostrar contenido (promociones, video o imágenes). El hueco existe (`#kReposo` y
 * `mostrarEnReposo()`); la implementación es para después.
 * ============================================================
 */

(function () {
    'use strict';

    var API = '../api/dining/counter.php';
    var QUIEN = null;          // { store_id, ... }
    var pedidos = [];          // última copia de la lista
    var destacado = null;      // pedido en pantalla (id o null)
    var reloj = null;          // temporizador del tiempo del pedido destacado
    var socketRt = null;

    var $ = function (id) { return document.getElementById(id); };

    // ============================================================
    // Estado y colores (el mismo idioma que el resto del mostrador)
    // ============================================================
    var ETIQUETA = {
        pending:   ['En preparación', ''],
        ready:     ['¡Listo!', 'k-ready'],
        completed: ['Entregado', ''],
        cancelled: ['Cancelado', '']
    };

    function etiquetaPago(p) {
        if (p.payment_status === 'paid') return '<i class="fas fa-circle-check"></i> Pagado';
        if (p.payment_status === 'partial') return '<i class="fas fa-coins"></i> Con adelanto de ' + tpDinero(p.paid_amount);
        return '<i class="fas fa-hourglass"></i> Paga al recoger';
    }

    function mm(segundos) {
        segundos = Math.max(0, Math.floor(Number(segundos) || 0));
        var m = Math.floor(segundos / 60), s = segundos % 60;
        return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }

    // ============================================================
    // La lista en vivo
    // ============================================================
    function niveles() {
        // Los que llevan más tiempo primero: es la información que urge.
        if (!pedidos.length) return;
        pedidos.sort(function (a, b) { return (Number(a.segundos) || 0) - (Number(b.segundos) || 0); });
    }

    function tarjeta(p) {
        var est = ETIQUETA[p.status] || ['—', ''];
        var linea = (p.items || []).map(function (it) {
            return '<div class="k-item"><span>' + tpCantidad(it.quantity) + '× ' + tpEsc(it.product_name) +
                (it.notes ? ' <span style="color:var(--warning-color)">(' + tpEsc(it.notes) + ')</span>' : '') +
                '</span></div>';
        }).join('');
        return '<article class="k-tarjeta ' + est[1] + '">' +
            '<div class="k-tarjeta-head"><span class="k-folio">#' + p.number + '</span>' +
            '<span class="k-estado">' + est[0] + '</span></div>' +
            (p.customer_name ? '<div class="k-nombre">' + tpEsc(p.customer_name) + '</div>' : '') +
            (p.notes ? '<div class="k-item" style="color:var(--warning-color)"><i class="fas fa-note-sticky"></i> ' + tpEsc(p.notes) + '</div>' : '') +
            (linea ? '<div class="k-items">' + linea + '</div>' : '') +
            '<div class="k-pie"><span class="k-total">' + tpDinero(p.total) + '</span>' +
            '<span class="k-tiempo"><i class="fas fa-hourglass-half"></i>' + mm(p.segunos !== undefined ? p.segunos : 0) + '</span></div>' +
        '</article>';
    }

    function pintarLista() {
        var cont = $('kLista');
        var est = ETIQUETA[destacado ? destacado.status : ''];
        // Estado destacado abierto: la lista no se ve.
        if (destacado) { cont.innerHTML = ''; return; }
        niveles();
        if (!pedidos.length) {
            cont.innerHTML = '<div class="k-vacio"><i class="fas fa-utensils"></i> Aún no hay pedidos de mostrador</div>';
        } else {
            cont.innerHTML = pedidos.map(tarjeta).join('');
        }
        $('kCuenta').textContent = pedidos.length;
    }

    function cargarLista(silencioso) {
        fetch(API, { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                var lista = (d && d.data) || [];
                pedidos = (d && d.success !== false && Array.isArray(lista)) ? lista : [];
                // Si el pedido destacado cambió, se refresca; si ya se entregó/canceló, se vuelve a la lista.
                if (destacado) {
                    var viva = pedidos.filter(function (p) { return Number(p.counter_order_id) === Number(destacado.counter_order_id); })[0];
                    if (!viva || viva.status === 'completed' || viva.status === 'cancelled') {
                        mostrarLista();
                    } else {
                        destacado = viva;
                        pintarDestacado();
                    }
                }
                pintarLista();
            })
            .catch(function () { if (!silencioso) $('kLista').innerHTML = '<div class="k-vacio"><i class="fas fa-triangle-exclamation"></i> No se pudo leer los pedidos</div>'; });
    }

    // ============================================================
    // Pedido destacado (con su QR)
    // ============================================================
    function mostrarPedido(contraOrden) {
        fetch(API + '?orden=' + encodeURIComponent(contraOrden), { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                var p = d && d.data;
                if (!p || d.success === false) { return; }
                destacado = p;
                pintarDestacado();
            })
            .catch(function () {});
    }

    function pintarDestacado() {
        var p = destacado;
        if (!p) return;
        var est = ETIQUETA[p.status] || ['—', ''];
        $('kLista').classList.add('hidden');
        $('kPedido').classList.remove('hidden');
        $('kReposo').classList.remove('activo');

        $('kFolio').textContent = '#' + p.number;
        $('kNombre').textContent = p.customer_name || '';
        $('kEstado').textContent = est[0];
        if (p.status === 'ready') $('kPedido').style.background = 'linear-gradient(180deg, rgba(52,192,122,.12), transparent)';
        else $('kPedido').style.background = '';

        // El QR de la página del cliente: marco blanco y esquinas redondeadas, sin enlace.
        var qr = $('kQr');
        qr.innerHTML = '';
        var url = 'seguimiento.html?t=' + encodeURIComponent(p.tracking_token || '');
        try {
            var caja = qr.getBoundingClientRect();
            var lado = Math.min(320, Math.max(180, Math.floor(Math.min(caja.width, window.innerHeight * 0.5))));
            if (typeof QRCode === 'function') {
                new QRCode(qr, { text: url, width: lado, height: lado, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
            } else {
                qr.innerHTML = '<div class="k-vacio" style="min-height:180px">No se pudo dibujar el código</div>';
            }
        } catch (e) { qr.innerHTML = ''; }

        var items = (p.items || []).map(function (it) {
            return '<div class="k-item"><span><b>' + tpCantidad(it.quantity) + '×</b> ' + tpEsc(it.product_name) + '</span>' +
                '<span class="k-precio">' + tpDinero(it.line_total) + '</span></div>';
        }).join('');
        $('kItems').innerHTML = (p.notes ? '<div class="k-item" style="color:var(--warning-color)"><i class="fas fa-note-sticky"></i> ' + tpEsc(p.notes) + '</div>' : '') + items;

        $('kResumen').innerHTML =
            '<div class="k-fila"><span>Subtotal</span><b>' + tpDinero(p.subtotal) + '</b></div>' +
            (Number(p.discount) > 0.004 ? '<div class="k-fila"><span>Descuentos</span><b>-' + tpDinero(p.discount) + '</b></div>' : '') +
            '<div class="k-fila k-final"><span>Total</span><b>' + tpDinero(p.total) + '</b></div>';
        $('kPago').innerHTML = etiquetaPago(p);

        // El tiempo corriendo viene de los segundos que manda el servidor (robusto a zonas horarias).
        clearInterval(reloj);
        reloj = setInterval(function () {
            destacado.segundos = (Number(destacado.segundos) || 0) + 1;
            $('kTiempo').textContent = mm(destacado.segundos);
        }, 1000);
        $('kTiempo').textContent = mm(p.segundos);
    }

    function mostrarLista() {
        destacado = null;
        clearInterval(reloj);
        $('kPedido').classList.add('hidden');
        $('kLista').classList.remove('hidden');
        pintarLista();
    }

    // ============================================================
    // Tiempo real (lo único que mantiene todo al día: nada de sondear)
    // ============================================================
    function conectarTiempoReal() {
        if (!QUIEN || !socketRt) {
            socketRt = window.TomodachiRealtime && TomodachiRealtime.conectar({
                canal: 'store:' + (QUIEN ? QUIEN.store_id : '1'),
                onEvento: function (msg) {
                    if (!msg) return;
                    if (msg.type === 'kiosko_qr' && msg.counter) {
                        mostrarPedido(msg.counter);
                        return;
                    }
                    if (msg.type === 'order_update' && msg.counter) {
                        cargarLista(true);
                    }
                },
                onEstado: function () { /* la pantalla no necesita mostrar el estado de la conexión */ }
            });
        }
    }

    // ============================================================
    // Pantalla completa (y el hueco para el modo reposo)
    // ============================================================
    function fullscreen() {
        var el = document.documentElement;
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            if (document.exitFullscreen) document.exitFullscreen();
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        } else {
            var p = el.requestFullscreen || el.webkitRequestFullscreen;
            if (p) p.call(el).catch(function () {});
        }
    }

    /** Hueco listo para el contenido en reposo (promociones, video, imágenes): por implementar. */
    function mostrarEnReposo() {
        var zona = $('kReposo');
        if (zona && !zona.innerHTML) {
            zona.innerHTML = '<div class="k-vacio"><i class="fas fa-tv"></i> Pantalla en reposo</div>';
        }
        if (zona) zona.classList.add('activo');
    }

    // ============================================================
    // Arranque
    // ============================================================
    function iniciar() {
        // Necesita la sesión del personal para leer los pedidos: sin ella, a iniciar sesión.
        fetch('../api/stores/settings.php', { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d || d.success === false) { window.location.href = 'login.html'; return; }
                QUIEN = d.data || {};
                conectarTiempoReal();
                cargarLista(false);
            })
            .catch(function () { window.location.href = 'login.html'; });
    }

    document.addEventListener('DOMContentLoaded', function () {
        $('kFullscreen').addEventListener('click', fullscreen);
        $('kVolver').addEventListener('click', mostrarLista);
        // En pantallas de mostrador lo común es dejarla a pantalla completa: se intenta al primer
        // toque (los navegadores lo permiten tras un gesto) y queda a mano el botón para salir.
        document.body.addEventListener('click', function unaVez(ev) {
            var el = document.documentElement;
            if (!document.fullscreenElement && !document.webkitFullscreenElement && (el.requestFullscreen || el.webkitRequestFullscreen)) {
                var p = el.requestFullscreen || el.webkitRequestFullscreen;
                p.call(el).catch(function () {});
            }
            document.body.removeEventListener('click', unaVez);
        }, { once: true });
        iniciar();
    });
})();