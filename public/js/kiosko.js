/* ============================================================
 * Kiosko del mostrador: la pantalla que ve el cliente parado frente a la caja.
 *
 * Flujo (módulo de servicio al cliente):
 *   1. La cajera toca "Nuevo pedido" -> el kiosko limpia la pantalla y muestra el
 *      letrero en reposo.
 *   2. La cajera va agregando productos -> cada cambio llega por WebSocket
 *      (evento `kiosko_cart`) y la pantalla muestra EN VIVO lo que el cliente ha
 *      pedido: productos, descuento por línea, nombre y total. Aún no hay folio.
 *   3. La cajera confirma el pedido -> llega `kiosko_qr` (o `order_update` con
 *      `counter_created`) y la pantalla muestra el pedido final con su NÚMERO y su
 *      QR, para que el cliente escanee y siga su pedido o reciba el aviso.
 *   4. Al entregar/cancelar -> `order_update` y la pantalla vuelve al reposo.
 *
 * Nada se sondea: todo por el WebSocket del canal de la tienda.
 *
 * La configuración (tiempo de reposo, transición, mensaje de bienvenida y contenido
 * del carrusel) se edita con la rueda de la esquina superior derecha; las imágenes y
 * videos se SUBEN desde ahí (no se pegan URLs) y todo se guarda en la configuración
 * del negocio (`stores.settings.kiosk`).
 * ============================================================
 */

(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };

    // Helper locales (este kiosko no carga tables.js). El descuento se guarda POR LÍNEA.
    function dinero(n) {
        try { return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0); }
        catch (e) { return '$' + (Number(n) || 0).toFixed(2); }
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function cant(n) {
        var v = Number(n) || 0;
        return (Number.isInteger(v) ? parseInt(v, 10) : v.toFixed(2));
    }
    function mm(s) {
        s = Math.max(0, Number(s) || 0);
        var m = Math.floor(s / 60), se = s % 60;
        return (m < 10 ? '0' + m : m) + ':' + (se < 10 ? '0' + se : se);
    }
    function etiquetaEstado(st) {
        return ({ 'pending': 'En preparación', 'ready': '¡Listo!', 'completed': 'Entregado', 'cancelled': 'Cancelado' }[st] || st || '');
    }
    function etiquetaPago(p) {
        p = p || {};
        if (p.payment_status === 'paid') return '<i class="fas fa-check-circle"></i> Pagado';
        if (p.payment_status === 'partial') return '<i class="fas fa-coins"></i> Con adelanto de ' + dinero(p.paid_amount);
        return '<i class="fas fa-clock"></i> Se cobra al entregar';
    }

    var QUIEN = null;      // { store_id, orig: la respuesta completa de settings }
    var cfg = { reposo_seconds: 60, transicion: 'fade', bienvenida: 'Bienvenidos', assets: [] };

    var borrador = null;   // carrito en vivo (sin folio, sin QR) o null
    var destacado = null;  // pedido final (con folio y QR) o null
    var reloj = null;      // temporizador del tiempo del pedido final
    var socketRt = null;
    var qr = null;
    var timerReposo = null;    // cuenta el tiempo sin pedido -> reposo
    var timerCarrusel = null;  // rota los slides en reposo

    // ============================================================
    // Pintado: una sola pantalla para carrito en vivo o pedido final
    // ============================================================
    function pintar() {
        if (borrador) { pintarBorrador(); return; }
        if (destacado) { pintarDestacado(); }
    }

    function pintarItems(items) {
        var h = '';
        (items || []).forEach(function (it) {
            var origen = '';
            var precio = Number(it.unit_price) || 0;
            var desc = Number(it.discount) || 0;
            if (desc > 0) {
                var descFila = desc / (Number(it.quantity) || 1);
                var base = Number(it.base_price || it.product_price) || (precio + descFila);
                if (base <= 0) base = precio + descFila;
                // Precio original en muted y rayado; el real es el que resalta. Nada más.
                origen = '<span class="k-precio-orig">' + dinero(base) + '</span>';
            }
            h += '<div class="k-item">' +
                '<div class="k-izq"><span class="k-cant">' + cant(it.quantity) + '×</span>' +
                '<span class="k-nombre-item">' + esc(it.name || it.product_name || '') + '</span></div>' +
                '<span class="k-precio">' + origen + '<b>' + dinero(precio * (Number(it.quantity) || 1)) + '</b></span>' +
                '</div>';
        });
        $('kItems').innerHTML = h || '<div style="color:var(--text-muted)">Sin productos aún</div>';
    }

    function pintarTotales(subtotal, descuento, total) {
        $('kResumen').innerHTML =
            '<div class="k-fila"><span>Subtotal</span><b>' + dinero(subtotal) + '</b></div>' +
            (descuento > 0 ? '<div class="k-fila"><span>Descuentos</span><b style="color:var(--danger-color)">-' + dinero(descuento) + '</b></div>' : '') +
            '<div class="k-fila k-final"><span>Total</span><b>' + dinero(total) + '</b></div>';
    }

    function pintarBorrador() {
        var b = borrador;
        // Nada de título ni reloj: solo lo que se va pidiendo.
        $('kFolio').textContent = '';
        pintarItems(b.items);
        pintarTotales(b.subtotal, b.discount, b.total);
        var pago = $('kPago');
        if (pago) pago.style.display = 'none';
        limpiarQr();
        $('kPedido').classList.remove('hidden');
        $('kReposo').classList.remove('activo');
        document.body.classList.add('k-pedido-visible');
    }

    function pintarDestacado() {
        var p = destacado;
        $('kFolio').textContent = '#' + esc(p.number);
        pintarItems(p.items);
        var subtotal = Number(p.subtotal) || 0;
        var descuento = Number(p.discount) || 0;
        var total = Number(p.total);
        if (!(total > 0)) total = subtotal - descuento;
        pintarTotales(subtotal, descuento, total);
        var pago = $('kPago');
        if (pago) { pago.style.display = ''; pago.innerHTML = etiquetaPago(p); }
        pintarQr(p);
        $('kPedido').classList.remove('hidden');
        $('kReposo').classList.remove('activo');
        document.body.classList.add('k-pedido-visible');
    }

    function limpiarQr() {
        if (qr) { try { qr.clear(); } catch (e) {} qr = null; }
        $('kQr').innerHTML = '';
    }

    function pintarQr(p) {
        var caja = $('kQr');
        limpiarQr();
        if (!p || !p.tracking_token) return;
        var url = window.location.origin + '/public/seguimiento.html?t=' + encodeURIComponent(p.tracking_token);
        try {
            qr = new QRCode(caja, {
                text: url, width: 220, height: 220,
                colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H
            });
        } catch (e) { /* sin QR no se tumba la pantalla */ }
        var can = caja.querySelector('canvas') || caja.querySelector('img');
        if (can) { can.style.width = '220px'; can.style.height = '220px'; }
    }

    // ============================================================
    // Estados: borrador (vivo) / pedido final (QR) / reposo
    // ============================================================
    function finAnotacion() {
        borrador = null;
        destacado = null;
        if (reloj) { clearInterval(reloj); reloj = null; }
        document.body.classList.remove('k-pedido-visible');
        limpiarQr();
        $('kItems').innerHTML = '';
        $('kResumen').innerHTML = '';
        $('kPedido').classList.add('hidden');
        detenerReposo();
        habilitarReposo();
    }

    // Carrito en vivo: llega un `kiosko_cart` de la cajera mientras arma el pedido.
    function mostrarBorrador(msg) {
        var items = (msg && msg.items) || [];
        if (!items.length) { finAnotacion(); return; }
        detenerReposo();
        destacado = null;
        limpiarQr();
        // Se pide la vista previa para tener los precios con promoción en la pantalla.
        fetch('../api/dining/counter.php', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'preview', items: items })
        })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                var calc = d && (d.data && d.data.lines ? d.data : d);
                var lines = (calc && calc.lines) || [];
                var filas = items.map(function (it) {
                    var l = lines.find(function (x) { return Number(x.product_id) === Number(it.product_id); }) || {};
                    return {
                        product_id: it.product_id,
                        quantity: it.quantity,
                        name: l.product_name || l.name || '',
                        unit_price: Number(l.price || l.unit_price) || 0,
                        base_price: Number(l.original_price) || 0,
                        discount: Number(l.discount) || 0
                    };
                });
                borrador = {
                    name: msg.name || '',
                    items: filas,
                    subtotal: Number(calc && calc.subtotal) || 0,
                    discount: Number(calc && calc.discount) || 0,
                    total: Number(calc && calc.total) || 0
                };
                pintarBorrador();
            })
            .catch(function () { /* si falla la vista previa, no se rompe */ });
    }

    // Pedido final con su QR: llega `kiosko_qr` (o `order_update` counter_created).
    function mostrarPedido(id) {
        fetch('../api/dining/counter.php?orden=' + encodeURIComponent(id), { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                var p = d && d.data;
                if (!p || d.success === false) { finAnotacion(); return; }
                detenerReposo();
                borrador = null;
                destacado = p;
                pintarDestacado();
            })
            .catch(function () {});
    }

    function refrescarDestacado() {
        if (!destacado) return;
        fetch('../api/dining/counter.php?orden=' + encodeURIComponent(destacado.counter_order_id), { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                var p = d && d.data;
                if (!p || d.success === false) return;
                destacado = p;
                pintarDestacado();
                if (p.status === 'completed' || p.status === 'cancelled') finAnotacion();
            })
            .catch(function () {});
    }

    // ============================================================
    // Reposo: carrusel o letrero de bienvenida (centrado).
    // ============================================================
    function detenerReposo() {
        if (timerReposo) { clearTimeout(timerReposo); timerReposo = null; }
        if (timerCarrusel) { clearInterval(timerCarrusel); timerCarrusel = null; }
    }

    function habilitarReposo() {
        detenerReposo();
        if (borrador || destacado) return;
        timerReposo = setTimeout(function () { iniciarReposo(); }, (Number(cfg.reposo_seconds) || 60) * 1000);
    }

    function iniciarReposo() {
        if (borrador || destacado) return;
        $('kPedido').classList.add('hidden');
        var zona = $('kReposo');
        zona.classList.add('activo');
        var vivos = (cfg.assets || []).filter(function (a) { return a && a.url; });
        if (!vivos.length) {
            zona.innerHTML = '<div class="kr-sin"><div><i class="fas fa-utensils"></i>' + esc(cfg.bienvenida || 'Bienvenidos') + '</div></div>';
            return;
        }
        var idx = 0;
        function pintarSlide(i) {
            var a = vivos[i];
            var html = (a.type === 'video')
                ? '<video src="' + esc(a.url) + '" autoplay muted loop playsinline></video>'
                : '<img src="' + esc(a.url) + '" alt="">';
            var nuevo = document.createElement('div');
            nuevo.className = 'kr-slide ' + (cfg.transicion === 'none' ? '' : 'kr-fade');
            nuevo.innerHTML = html;
            zona.appendChild(nuevo);
            var viejos = zona.querySelectorAll('.kr-slide');
            requestAnimationFrame(function () {
                viejos.forEach(function (el) { if (el !== nuevo) el.style.opacity = '0'; });
            });
            setTimeout(function () {
                viejos.forEach(function (el) { if (el !== nuevo && el.parentNode) el.parentNode.removeChild(el); });
            }, 1000);
        }
        pintarSlide(idx);
        if (vivos.length > 1) {
            timerCarrusel = setInterval(function () { idx = (idx + 1) % vivos.length; pintarSlide(idx); }, 7000);
        }
    }

    // ============================================================
    // Tiempo real
    // ============================================================
    function conectarTiempoReal() {
        if (socketRt || !QUIEN) return;
        socketRt = window.TomodachiRealtime && TomodachiRealtime.conectar({
            canal: 'store:' + (QUIEN.store_id !== undefined ? QUIEN.store_id : '1'),
            onEvento: function (msg) {
                if (!msg) return;
                if (msg.type === 'kiosko_cart') { mostrarBorrador(msg); return; }
                if (msg.type === 'kiosko_qr' && msg.counter) { mostrarPedido(msg.counter); return; }
                if (msg.type === 'order_update' && msg.counter) {
                    var evento = msg.event || '';
                    if (evento === 'counter_created') { mostrarPedido(msg.counter); return; }
                    if (destacado && Number(msg.counter) === Number(destacado.counter_order_id)) {
                        var viva = destacado;
                        if (evento === 'counter_delivered' || evento === 'counter_cancelled' || viva.status === 'completed' || viva.status === 'cancelled') {
                            destacado.status = /cancel/.test(evento) ? 'cancelled' : 'completed';
                            finAnotacion();
                        } else {
                            refrescarDestacado();
                        }
                    }
                }
            },
            onEstado: function () {}
        });
    }

    // ============================================================
    // Configuración del kiosko (rueda arriba a la derecha)
    // ============================================================
    function cargarCfg(settings) {
        var k = (settings && settings.kiosk) || {};
        cfg = {
            reposo_seconds: Number(k.reposo_seconds) > 0 ? Number(k.reposo_seconds) : 60,
            transicion: k.transicion === 'slide' || k.transicion === 'none' ? k.transicion : 'fade',
            bienvenida: (k.bienvenida && String(k.bienvenida).trim()) || 'Bienvenidos',
            assets: Array.isArray(k.assets) ? k.assets.filter(function (a) { return a && a.url; }) : []
        };
    }

    function renderPanel() {
        $('kReposoTiempo').value = cfg.reposo_seconds;
        $('kTransicion').value = cfg.transicion;
        $('kMensaje').value = cfg.bienvenida;
        var lista = $('kAssetList');
        lista.innerHTML = '';
        if (!cfg.assets.length) {
            var vacio = document.createElement('div');
            vacio.className = 'k-help';
            vacio.textContent = 'Todavía no hay contenido. Sube una imagen o un video.';
            lista.appendChild(vacio);
            return;
        }
        cfg.assets.forEach(function (a, i) {
            var div = document.createElement('div');
            div.className = 'k-asset';
            div.innerHTML = (a.type === 'video'
                    ? '<video src="' + esc(a.url) + '" muted playsinline></video>'
                    : '<img src="' + esc(a.url) + '" alt="">') +
                '<span class="k-asset-url">' + esc(a.type === 'video' ? '🎬 Video' : '🖼 Imagen') + '</span>' +
                '<button type="button" data-rm="' + i + '" title="Quitar"><i class="fas fa-trash"></i></button>';
            lista.appendChild(div);
        });
    }

    function abrirPanel() { renderPanel(); $('kPanel').classList.add('abierto'); }
    function cerrarPanel() { $('kPanel').classList.remove('abierto'); }

    function subirArchivos(files) {
        if (!files || !files.length) return;
        var archivo = files[0];
        var fd = new FormData();
        fd.append('file', archivo);
        $('kSubirAsset').disabled = true;
        var original = $('kSubirAsset').textContent;
        $('kSubirAsset').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subiendo…';
        fetch('../api/kiosk/upload.php', {
            method: 'POST', credentials: 'include',
            body: fd
        })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                $('kSubirAsset').disabled = false;
                $('kSubirAsset').innerHTML = original;
                if (!d || d.success === false) { alert((d && (d.message || (d.data && d.data.file))) || 'No se pudo subir'); return; }
                var u = (d.data && (d.data.url || (d.data.data && d.data.data.url))) || (d.url);
                var tipo = (d.data && d.data.type) || (d.type) || (String(archivo.type).indexOf('video') === 0 ? 'video' : 'image');
                var url = u || (d.data && d.data.url);
                if (typeof url === 'string' && url.charAt(0) === '/') url = url;
                cfg.assets.push({ type: tipo, url: url });
                $('kAssetFile').value = '';
                renderPanel();
            })
            .catch(function (e) {
                $('kSubirAsset').disabled = false;
                $('kSubirAsset').innerHTML = original;
                alert('Error de red al subir');
            });
    }

    function guardarConfig() {
        $('kGuardado').style.display = 'none';
        var cfgNueva = {
            reposo_seconds: Math.max(5, Number($('kReposoTiempo').value) || 60),
            transicion: $('kTransicion').value,
            bienvenida: ($('kMensaje').value || '').trim() || 'Bienvenidos',
            assets: cfg.assets.slice()
        };
        var origen = (QUIEN && QUIEN.orig) || {};
        var settings = Object.assign({}, (origen.settings || {}));
        settings.kiosk = cfgNueva;
        var cuerpo = Object.assign({}, origen);
        cuerpo.settings = settings;
        fetch('../api/stores/settings.php', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cuerpo)
        })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d || d.success === false) { alert((d && d.message) || 'No se pudo guardar'); return; }
                cfg = cfgNueva;
                QUIEN.orig = Object.assign({}, cuerpo, { settings: settings });
                $('kGuardado').style.display = 'inline';
                setTimeout(function () { $('kGuardado').style.display = 'none'; }, 2500);
                cerrarPanel();
            })
            .catch(function () { alert('Error de red al guardar'); });
    }

    // ============================================================
    // Arranque
    // ============================================================
    function iniciar() {
        fetch('../api/stores/settings.php', { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d || d.success === false) { window.location.href = 'login.html'; return; }
                var origen = d.data || {};
                QUIEN = { store_id: origen.store_id, orig: origen };
                cargarCfg(origen.settings);
                conectarTiempoReal();
                habilitarReposo();
            })
            .catch(function () { window.location.href = 'login.html'; });
    }

    document.addEventListener('DOMContentLoaded', function () {
        $('kAjustes').addEventListener('click', abrirPanel);
        $('kCerrarPanel').addEventListener('click', cerrarPanel);
        $('kPanel').addEventListener('click', function (ev) { if (ev.target === $('kPanel')) cerrarPanel(); });
        $('kAssetList').addEventListener('click', function (ev) {
            var btn = ev.target.closest('[data-rm]');
            if (!btn) return;
            cfg.assets.splice(Number(btn.getAttribute('data-rm')), 1);
            renderPanel();
        });
        $('kSubirAsset').addEventListener('click', function () {
            var input = $('kAssetFile');
            subirArchivos(input && input.files);
        });
        $('kAssetFile').addEventListener('change', function () { subirArchivos(this.files); });
        $('kGuardarCfg').addEventListener('click', guardarConfig);
        iniciar();
    });
})();