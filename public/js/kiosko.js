/* ============================================================
 * Kiosko del mostrador: la pantalla que ve el cliente parado frente a la caja.
 *
 * Una sola cosa en pantalla: el pedido del cliente que la cajera manda desde el
 * mostrador (evento `kiosko_qr`), y se mantiene vivo mientras ella agrega artículos
 * (evento `order_update`). Cuando no hay pedido a la vista, se queda en reposo:
 * pasa el tiempo configurado y salta el carrusel de imágenes/videos del negocio
 * (o una pantalla limpia en espera).
 *
 * Nada se sondea: todo llega por WebSocket al canal de la tienda.
 *
 * La configuración (tiempo de reposo, transición, contenido del carrusel) se edita
 * con la rueda de la esquina superior derecha y se guarda en `stores.settings.kiosk`
 * mediante la API de configuración.
 * ============================================================
 */

(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };

    // Helper locales (este kiosko no carga tables.js). Dinero y cantidad en el
    // formato regional del navegador; el descuento se guarda POR LÍNEA en la BD.
    function dinero(n) {
        try { return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0); }
        catch (e) { return '$' + (Number(n) || 0).toFixed(2); }
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function mm(s) {
        s = Math.max(0, Number(s) || 0);
        var m = Math.floor(s / 60), se = s % 60;
        return (m < 10 ? '0' + m : m) + ':' + (se < 10 ? '0' + se : se);
    }
    function fechaCorta(s) {
        if (!s) return '';
        var d = new Date(s);
        if (isNaN(d)) return '';
        return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    }
    function etiquetaEstado(st) {
        return ({ 'pending': 'En preparación', 'ready': '¡Listo!', 'completed': 'Entregado', 'cancelled': 'Cancelado' }[st] || st || '');
    }
    function etiquetaPago(p) {
        p = p || {};
        var s = p.payment_status;
        if (s === 'paid') return '<i class="fas fa-check-circle"></i> Pagado';
        if (s === 'partial') return '<i class="fas fa-coins"></i> Con adelanto de ' + dinero(p.paid_amount);
        return '<i class="fas fa-clock"></i> Se cobra al entregar';
    }

    var QUIEN = null;      // {store_id, settings: {...}}
    var cfg = { reposo_seconds: 60, transicion: 'fade', assets: [] };

    var destacado = null;  // pedido en pantalla (objeto) o null
    var reloj = null;      // temporizador del tiempo del pedido destacado
    var socketRt = null;
    var qr = null;
    var timerReposo = null;      // cuenta el tiempo sin pedido -> reposo
    var timerCarrusel = null;    // rota los slides en reposo

    // ============================================================
    // Pedido destacado (lo que ve el cliente)
    // ============================================================
    function pintarDestacado() {
        if (!destacado) return;
        var p = destacado;
        $('kFolio').textContent = '#' + esc(p.number);
        $('kNombre').textContent = esc(p.customer_name || '');
        $('kEstado'); // titular retirado: aquí solo importa lo que pide el cliente

        var items = '';
        (p.items || []).forEach(function (it) {
            var origen = '';
            var precio = Number(it.unit_price) || 0;
            var desc = Number(it.discount) || 0;
            if (desc > 0) {
                // El descuento se guarda POR LÍNEA: para el precio por unidad se reparte.
                var descFila = desc / (Number(it.quantity) || 1);
                var base = Number(it.product_price || it.unit_price) || precio;
                if (base > (precio + descFila)) base = precio + descFila;
                origen = '<span class="k-precio-orig">' + dinero(base) + '</span>' +
                         '<span style="color:var(--danger-color)">-' + dinero(descFila) + '</span>';
            }
            items += '<div class="k-item">' +
                '<div class="k-izq"><span class="k-cant">' + esc(it.quantity) + '×</span>' +
                '<span class="k-nombre-item">' + esc(it.name || it.product_name || '') + '</span></div>' +
                '<span class="k-precio">' + origen + '<b>' + dinero(precio * (Number(it.quantity) || 1)) + '</b></span>' +
                '</div>';
        });
        $('kItems').innerHTML = items || '<div class="k-precio" style="color:var(--text-muted)">Sin productos</div>';

        var subtotal = Number(p.subtotal) || 0;
        var descuento = Number(p.discount) || 0;
        var total = Number(p.total);
        if (!(total > 0)) total = subtotal - descuento;
        $('kResumen').innerHTML =
            '<div class="k-fila"><span>Subtotal</span><b>' + dinero(subtotal) + '</b></div>' +
            (descuento > 0 ? '<div class="k-fila"><span>Descuentos</span><b style="color:var(--danger-color)">-' + dinero(descuento) + '</b></div>' : '') +
            '<div class="k-fila k-final"><span>Total</span><b>' + dinero(total) + '</b></div>';

        var pago = $('kPago');
        if (pago) pago.innerHTML = etiquetaPago(p);
        if (pago) pago.style.display = '';

        pintarQr(p);
    }

    function pintarQr(p) {
        var caja = $('kQr');
        caja.innerHTML = '';
        if (qr) { try { qr.clear(); } catch (e) {} qr = null; }
        if (!p || !p.tracking_token) return;
        var url = window.location.origin + '/public/seguimiento.html?t=' + encodeURIComponent(p.tracking_token);
        var old = caja.querySelector('.sqrcode');
        try {
            qr = new QRCode(caja, {
                text: url, width: 220, height: 220,
                colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H
            });
            if (old) old.remove();
        } catch (e) { /* se dibuja el texto por si la librería falla */ }
        var can = caja.querySelector('canvas') || caja.querySelector('img');
        if (can) { can.style.width = '220px'; can.style.height = '220px'; }
    }

    function arrancaReloj(p) {
        if (reloj) { clearInterval(reloj); reloj = null; }
        var s = Math.max(0, Number(p.esperando_seg) || Number(p.segundos) || 0);
        $('kTiempo').textContent = mm(s);
        reloj = setInterval(function () {
            if (!destacado) return;
            destacado.esperando_seg = (Number(destacado.esperando_seg) || 0) + 1;
            $('kTiempo').textContent = mm(destacado.esperando_seg);
        }, 1000);
    }

    // Muestra un pedido en la pantalla del cliente y detiene el reposo.
    function mostrarPedido(id) {
        fetch('../api/dining/counter.php?orden=' + encodeURIComponent(id), { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                var p = d && d.data;
                if (!p || d.success === false) { limpiarAReposo(); return; }
                detenerReposo();
                destacado = p;
                pintarDestacado();
                arrancaReloj(p);
                $('kPedido').classList.remove('hidden');
                $('kReposo').classList.remove('activo');
            })
            .catch(function () { limpiarAReposo(); });
    }

    // Refresca el pedido que está en pantalla (la cajera sigue agregando artículos).
    function refrescarDestacado() {
        if (!destacado) return;
        fetch('../api/dining/counter.php?orden=' + encodeURIComponent(destacado.counter_order_id), { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                var p = d && d.data;
                if (!p || d.success === false) return;
                destacado = p;
                pintarDestacado();
                // Si ya se entregó o canceló, la pantalla vuelve al reposo.
                if (p.status === 'completed' || p.status === 'cancelled') { limpiarAReposo(); }
            })
            .catch(function () {});
    }

    function limpiarAReposo() {
        destacado = null;
        if (reloj) { clearInterval(reloj); reloj = null; }
        if (qr) { try { qr.clear(); } catch (e) {} qr = null; }
        $('kPedido').classList.add('hidden');
        detenerReposo();
        habilitarReposo();
    }

    // ============================================================
    // Reposo (carrusel de imágenes/videos, o espera limpia)
    // ============================================================
    function detenerReposo() {
        if (timerReposo) { clearTimeout(timerReposo); timerReposo = null; }
        if (timerCarrusel) { clearInterval(timerCarrusel); timerCarrusel = null; }
    }

    // Se programa para que, si nadie manda un pedido, la pantalla salte al reposo.
    function habilitarReposo() {
        detenerReposo();
        if (destacado) return;
        timerReposo = setTimeout(function () { iniciarReposo(); }, (Number(cfg.reposo_seconds) || 60) * 1000);
    }

    function iniciarReposo() {
        if (destacado) return;
        $('kPedido').classList.add('hidden');
        var zona = $('kReposo');
        zona.classList.add('activo');
        var vivos = (cfg.assets || []).filter(function (a) { return a && a.url; });
        if (!vivos.length) {
            zona.innerHTML = '<div class="kr-sin"><div><i class="fas fa-tv"></i>Bienvenidos<br><span style="font-size:1.1rem">Su pedido aparecerá aquí en seguida</span></div></div>';
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
        timerCarrusel = setInterval(function () {
            idx = (idx + 1) % vivos.length;
            pintarSlide(idx);
        }, 7000);
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
                if (msg.type === 'kiosko_qr' && msg.counter) {
                    // La cajera manda un pedido a esta pantalla: se muestra de inmediato.
                    detenerReposo();
                    mostrarPedido(msg.counter);
                    return;
                }
                if (msg.type === 'order_update' && msg.counter) {
                    if (destacado && Number(msg.counter) === Number(destacado.counter_order_id)) {
                        refrescarDestacado();  // el carrito en pantalla sigue vivo mientras la cajera agrega
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
            assets: Array.isArray(k.assets) ? k.assets.filter(function (a) { return a && a.url; }) : []
        };
    }

    function renderPanel() {
        $('kReposoTiempo').value = cfg.reposo_seconds;
        $('kTransicion').value = cfg.transicion;
        var lista = $('kAssetList');
        lista.innerHTML = '';
        cfg.assets.forEach(function (a, i) {
            var div = document.createElement('div');
            div.className = 'k-asset';
            div.innerHTML = (a.type === 'video'
                    ? '<video src="' + esc(a.url) + '" muted playsinline></video>'
                    : '<img src="' + esc(a.url) + '" alt="">') +
                '<span class="k-asset-url">' + esc(a.url) + '</span>' +
                '<button type="button" data-rm="' + i + '" title="Quitar"><i class="fas fa-trash"></i></button>';
            lista.appendChild(div);
        });
    }

    function abrirPanel() { renderPanel(); $('kPanel').classList.add('abierto'); }
    function cerrarPanel() { $('kPanel').classList.remove('abierto'); }

    function guardarConfig() {
        $('kGuardado').style.display = 'none';
        var cfgNueva = {
            reposo_seconds: Math.max(5, Number($('kReposoTiempo').value) || 60),
            transicion: $('kTransicion').value,
            assets: cfg.assets.slice()
        };
        // El POST pisa la tienda completa: se reenvía el objeto que ya venía con la
        // configuración nueva dentro, para no borrar nombre, tema ni el resto.
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
                QUIEN = {
                    store_id: origen.store_id,
                    orig: origen
                };
                cargarCfg(origen.settings);
                conectarTiempoReal();
                habilitarReposo();
            })
            .catch(function () { window.location.href = 'login.html'; });
    }

    document.addEventListener('DOMContentLoaded', function () {
        $('kAjustes').addEventListener('click', abrirPanel);
        $('kCerrarPanel').addEventListener('click', cerrarPanel);
        $('kPanel').addEventListener('click', function (ev) {
            if (ev.target === $('kPanel')) cerrarPanel();
        });
        $('kAgregarAsset').addEventListener('click', function () {
            var url = $('kAssetUrl').value.trim();
            var tipo = $('kAssetTipo').value;
            if (!url) return;
            cfg.assets.push({ type: tipo, url: url });
            $('kAssetUrl').value = '';
            renderPanel();
        });
        $('kAssetList').addEventListener('click', function (ev) {
            var btn = ev.target.closest('[data-rm]');
            if (!btn) return;
            cfg.assets.splice(Number(btn.getAttribute('data-rm')), 1);
            renderPanel();
        });
        $('kGuardarCfg').addEventListener('click', guardarConfig);
        iniciar();
    });
})();