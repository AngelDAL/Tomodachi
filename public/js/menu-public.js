/**
 * Carta pública del comensal.
 *
 * Se abre desde el QR, que apunta a /m/<token> (o ?t=<token>).
 *
 * Dos modos:
 *   - menu_only     -> solo consulta (como antes). Ningún control de pedido.
 *   - order_and_pay / open_tab -> además se puede pedir: cuenta por mesa,
 *     cada comensal se une con un código y ve el pedido de todos.
 *
 * El comensal no tiene cuenta de usuario: su identidad dentro de la mesa es un
 * `join_token` que el servidor entrega al unirse y que se guarda en
 * localStorage para reconectar solo al recargar.
 *
 * CONTRATO DE localStorage (`pos_diner_session`): JSON con
 *   {
 *     join_token:   "<64 hex>",   // token de la API de pedidos
 *     participant_id: 3,          // quién es en la cuenta
 *     session_id:   12,           // la cuenta/mesa
 *     code:         "K7QP",       // código que se comparte
 *     display_name: "Ana",        // nombre rápido (puede venir vacío)
 *     menu_token:   "<token>"     // guarda: la sesión es de ESTA carta
 *   }
 *
 * TIEMPO REAL: se intenta un WebSocket por canal (session_id) y, además, se
 * mantiene un sondeo cada 10 s. Si el socket no conecta o falla, el sondeo
 * sostiene la interfaz: nunca queda bloqueada. El socket es solo un acelerador.
 */
(function () {
    'use strict';

    // Rutas absolutas: la página se sirve en /m/<token>, donde una ruta relativa
    // resolvería contra /m/ y daría 404.
    var API         = '/api/menu/public.php';
    var API_SESSION = '/api/dining/session.php';
    var API_ORDER   = '/api/dining/order.php';

    var LS_KEY  = 'pos_diner_session';
    var POLL_MS = 10000;   // fallback obligatorio de tiempo real

    var estado = {
        token: '',
        mode: 'menu_only',
        allowNotes: false,
        productos: {},      // product_id -> producto de la carta
        socio: null,        // sesión del comensal (localStorage)
        cuenta: null,       // última cuenta recibida de order.php
        socket: null,
        pollTimer: null,
        punto: '',          // etiqueta del punto de servicio (Mesa 1, Barra…) si el QR la trae
        notasAbiertas: null, // línea cuya caja de notas está abierta
        vista: 'carta'      // 'carta' | 'pedido' (solo manda en el teléfono)
    };

    /** ¿El pedido vive en su propia columna, junto a la carta? (escritorio/tableta).
     *  Se decide por el MEDIO que usa la columna, que es también el breakpoint del CSS. */
    function pedidoEnColumna() {
        return window.matchMedia('(min-width: 900px)').matches;
    }

    // ============================================================
    // Utilidades
    // ============================================================

    /** Escapa para insertar en HTML. Los nombres vienen del catálogo del
     *  negocio, pero igual se escapan: nunca se confía en datos para HTML. */
    function esc(v) {
        return String(v === null || v === undefined ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function tokenDeUrl() {
        // Formato corto: /m/<token>
        var m = window.location.pathname.match(/\/m\/([a-f0-9]{8,64})\/?$/i);
        if (m) return m[1];
        // Formato directo: menu.html?t=<token>
        var p = new URLSearchParams(window.location.search);
        return (p.get('t') || '').trim();
    }

    /**
     * Código de la cuenta que viene en el enlace.
     *
     * Es el QR "ya autorizado" que muestra el mesero: el cliente escanea y entra DIRECTO a
     * la cuenta de su mesa sin escribir nada. `?punto=<token del punto>` es lo que lleva el
     * QR impreso de la mesa (ahí el personal autoriza).
     */
    function codigoDeUrl() {
        var p = new URLSearchParams(window.location.search);
        return (p.get('code') || '').trim().toUpperCase().slice(0, 8);
    }

    /**
     * El punto de servicio del QR impreso (`?punto=<qr_token>`).
     *
     * Con esto la cuenta nace sabiendo DÓNDE está el cliente: sin ello, la cuenta del
     * comensal aparecía en el mapa del salón como "(sin punto)" y el mesero no sabía qué
     * mesa estaba pidiendo. Si ya hay una cuenta abierta en ese punto, el comensal entra a
     * ESA en vez de abrir una paralela.
     */
    function puntoDeUrl() {
        var p = new URLSearchParams(window.location.search);
        return (p.get('punto') || '').trim().slice(0, 64);
    }

    function qs(id) { return document.getElementById(id); }

    function mostrar(id) {
        ['cartaCargando', 'cartaError', 'cartaContenido'].forEach(function (x) {
            var el = document.getElementById(x);
            if (el) el.classList.toggle('hidden', x !== id);
        });
    }

    function mostrarEl(el, ver) { if (el) el.classList.toggle('hidden', !ver); }

    function fallar(titulo, texto) {
        document.getElementById('cartaErrorTitulo').textContent = titulo;
        document.getElementById('cartaErrorTexto').textContent = texto;
        mostrar('cartaError');
    }

    function dinero(n) {
        var v = Number(n) || 0;
        return '$' + v.toFixed(2);
    }

    // ============================================================
    // Avisos y modales
    // ============================================================

    function abrirModal(id) {
        var el = qs(id);
        if (!el) return;
        el.classList.remove('hidden');
        document.body.classList.add('con-capa');
    }

    function cerrarModal(id) {
        var el = qs(id);
        if (el) el.classList.add('hidden');
        if (!document.querySelector('.mp-overlay:not(.hidden)')) {
            document.body.classList.remove('con-capa');
        }
    }

    function mostrarAvisoModal(id, texto) {
        var el = qs(id);
        if (!el) return;
        el.textContent = texto;
        el.classList.remove('hidden');
    }

    var avisoTemporizador = null;
    /** Aviso flotante breve. tipo: 'ok' | 'error'. */
    function aviso(texto, tipo) {
        var el = qs('mpAviso');
        if (!el) return;
        el.textContent = texto;
        el.classList.remove('hidden', 'es-error', 'es-exito');
        el.classList.add(tipo === 'error' ? 'es-error' : 'es-exito');
        if (avisoTemporizador) clearTimeout(avisoTemporizador);
        avisoTemporizador = setTimeout(function () {
            el.classList.add('hidden');
        }, tipo === 'error' ? 5200 : 3000);
    }

    // ============================================================
    // HTTP (siempre rutas absolutas)
    // ============================================================

    function peticion(url, opciones) {
        return fetch(url, opciones).then(function (r) {
            return r.json().catch(function () { return null; }).then(function (j) {
                return { ok: r.ok, status: r.status, body: j };
            });
        }).catch(function () {
            var e = new Error('Revisa tu conexión e intenta de nuevo.');
            e.red = true;
            throw e;
        });
    }

    /** Desempaqueta {success,message,data} y convierte success:false en Error
     *  con el mensaje en español que mandó el servidor. */
    function desempaquetar(res) {
        if (!res.ok || !res.body || res.body.success === false) {
            var msg = (res.body && res.body.message) || 'No se pudo completar la operación.';
            var e = new Error(msg);
            e.status = res.status;
            throw e;
        }
        return res.body.data;
    }

    function apiGet(url) {
        return peticion(url, { cache: 'no-store' }).then(desempaquetar);
    }

    function apiPost(url, cuerpo) {
        return peticion(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cuerpo)
        }).then(desempaquetar);
    }

    // ============================================================
    // Sesión del comensal (localStorage)
    // ============================================================

    function leerSocio() {
        try {
            var raw = localStorage.getItem(LS_KEY);
            if (!raw) return null;
            var o = JSON.parse(raw);
            if (!o || !o.join_token || o.join_token.length < 8) return null;
            // La sesión guardada solo vale para la MISMA carta.
            if (o.menu_token && o.menu_token !== estado.token) return null;
            return {
                join_token:     String(o.join_token),
                participant_id: o.participant_id,
                session_id:     o.session_id,
                code:           String(o.code || ''),
                display_name:   String(o.display_name || ''),
                menu_token:     estado.token
            };
        } catch (e) {
            return null;
        }
    }

    function guardarSocio() {
        try { localStorage.setItem(LS_KEY, JSON.stringify(estado.socio)); } catch (e) { /* sin storage */ }
    }

    function olvidarSocio() {
        estado.socio = null;
        estado.cuenta = null;
        try { localStorage.removeItem(LS_KEY); } catch (e) { /* sin storage */ }
        detenerSocket();
        detenerSondeo();
    }

    function esSesionInvalida(err) {
        if (!err) return false;
        if ([401, 403, 404, 410].indexOf(err.status) !== -1) return true;
        return /cerrad|no existe|no encontrada|inv[aá]lid|expirad/i.test(err.message || '');
    }

    // ============================================================
    // Tema del negocio
    // ============================================================

    /**
     * Aplica los colores del negocio a la carta. Solo los de marca: el claro u
     * oscuro lo decide la preferencia del teléfono del comensal, no la tienda.
     */
    function aplicarMarca(tienda) {
        var tema = (tienda && tienda.theme) || {};
        var raiz = document.documentElement;

        if (tema.primary_color) {
            raiz.style.setProperty('--primary-color', tema.primary_color);
        }
        if (tema.secondary_color) {
            raiz.style.setProperty('--secondary-color', tema.secondary_color);
        }

        var nombre = (tienda && tienda.name) || 'Carta';
        var logo = document.getElementById('cartaLogo');
        if (tema.logo_path) {
            logo.style.backgroundImage = 'url(' + JSON.stringify(tema.logo_path).slice(1, -1) + ')';
            logo.textContent = '';
        } else {
            // Sin logo cargado: inicial del negocio, para que no quede vacío
            logo.textContent = nombre.trim().charAt(0).toUpperCase() || '?';
        }

        document.getElementById('cartaTienda').textContent = tienda.name || '';
        document.title = nombre + ' · Carta';
    }

    // ============================================================
    // Render de la carta
    // ============================================================

    function renderPromos(promos) {
        if (!promos || !promos.length) return;

        var html = promos.map(function (p) {
            var detalle = '';
            if (p.discount_type === 'percentage') {
                detalle = p.discount_value + '% de descuento';
            } else if (p.discount_type === 'fixed_amount') {
                detalle = dinero(p.discount_value) + ' de descuento';
            } else if (p.discount_type === 'fixed_price') {
                detalle = 'a ' + dinero(p.discount_value);
            }
            return '<div class="promo-chip">' +
                       '<i class="fas fa-tag"></i>' +
                       '<span>' + esc(p.name) + '</span>' +
                       (detalle ? '<small>' + esc(detalle) + '</small>' : '') +
                   '</div>';
        }).join('');

        document.getElementById('promoLista').innerHTML = html;
        document.getElementById('promoSection').classList.remove('hidden');
    }

    function productoHTML(p, menu) {
        var imagen = p.image
            ? '<div class="producto-imagen" style="background-image:url(' + esc(p.image) + ')"></div>'
            : '<div class="producto-imagen"><i class="fas fa-utensils"></i></div>';

        // Los sellos van en el pie de la tarjeta, junto al precio: así nunca
        // tapan el nombre ni la descripción.
        var sellos = '';
        if (p.featured) {
            sellos += '<span class="producto-destacado">Recomendado</span>';
        }
        if (p.promotion) {
            sellos += '<span class="producto-promo">' + esc(p.promotion.name) + '</span>';
        }
        if (p.sold_out) {
            sellos += '<span class="producto-agotado-chip">Agotado</span>';
        }

        // Hueco para el control de pedido (se pinta cuando el comensal se une).
        var acciones = '<div class="producto-pedir hidden" data-producto-id="' + esc(p.product_id) + '"></div>';

        return '<article class="producto-carta' + (p.sold_out ? ' agotado' : '') + '"' +
                    ' data-producto="' + esc(p.product_id) + '">' +
                    imagen +
                    '<div class="producto-datos">' +
                        '<h3 class="producto-nombre">' + esc(p.name) + '</h3>' +
                        (p.description ? '<p class="producto-desc">' + esc(p.description) + '</p>' : '') +
                        '<div class="producto-pie">' +
                            '<span class="producto-precio">' + dinero(p.price) + '</span>' +
                            sellos +
                        '</div>' +
                        acciones +
                    '</div>' +
               '</article>';
    }

    function renderCarta(datos) {
        aplicarMarca(datos.store);

        var menu = datos.menu || {};
        document.getElementById('cartaNombre').textContent = menu.name || 'Carta';

        if (menu.welcome_message) {
            var b = document.getElementById('cartaBienvenida');
            b.textContent = menu.welcome_message;
            b.classList.remove('hidden');
        }
        if (menu.description) {
            var d = document.getElementById('cartaDescripcion');
            d.textContent = menu.description;
            d.classList.remove('hidden');
        }

        var secciones = datos.sections || [];
        if (!secciones.length) {
            fallar('Carta vacía', 'Esta carta todavía no tiene productos. Avisa al personal.');
            return;
        }

        // Navegación por sección (chips)
        if (secciones.length > 1) {
            var nav = secciones.map(function (s, i) {
                var id = 'seccion-' + i;
                return '<button type="button" class="seccion-chip' + (i === 0 ? ' activa' : '') +
                       '" data-destino="' + id + '">' + esc(s.name) + '</button>';
            }).join('');
            document.getElementById('seccionNavLista').innerHTML = nav;
            document.getElementById('seccionNav').classList.remove('hidden');
        }

        var html = secciones.map(function (s, i) {
            var productos = (s.items || []).map(function (p) {
                return productoHTML(p, menu);
            }).join('');
            return '<section id="seccion-' + i + '" class="carta-seccion">' +
                       '<h2 class="carta-seccion-titulo">' + esc(s.name) + '</h2>' +
                       '<div class="carta-grid">' + productos + '</div>' +
                   '</section>';
        }).join('');

        document.getElementById('secciones').innerHTML = html;

        var aviso_pie = menu.allow_notes
            ? 'Pide al personal si necesitas algo especial.'
            : '';
        document.getElementById('cartaPieAviso').textContent = aviso_pie;

        mostrar('cartaContenido');
        conectarNav();
        configurarPedido(datos);
    }

    function conectarNav() {
        document.querySelectorAll('.seccion-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                var destino = document.getElementById(chip.dataset.destino);
                if (destino) {
                    destino.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        });

        // El chip activo sigue a la sección visible
        var observador = new IntersectionObserver(function (entradas) {
            entradas.forEach(function (e) {
                if (!e.isIntersecting) return;
                var idx = (e.target.id || '').replace('seccion-', '');
                document.querySelectorAll('.seccion-chip').forEach(function (c) {
                    c.classList.toggle('activa', c.dataset.destino === 'seccion-' + idx);
                });
            });
        }, { rootMargin: '-15% 0px -70% 0px' });

        document.querySelectorAll('.carta-seccion').forEach(function (s) {
            observador.observe(s);
        });
    }

    // ============================================================
    // Pedido: activación
    // ============================================================

    function admitePedido(mode) {
        return mode === 'order_and_pay' || mode === 'open_tab';
    }

    function configurarPedido(datos) {
        var menu = datos.menu || {};
        estado.mode = menu.mode || 'menu_only';
        estado.allowNotes = !!menu.allow_notes;

        // Índice de productos por id (para resolver nombre/precio/agotado).
        (datos.sections || []).forEach(function (s) {
            (s.items || []).forEach(function (p) {
                estado.productos[String(p.product_id)] = p;
            });
        });

        // menu_only: la carta se comporta como siempre, sin controles de pedido.
        if (!admitePedido(estado.mode)) return;

        mostrarEl(qs('dinerBar'), true);

        estado.socio = leerSocio();
        actualizarBarraComensal();
        pintarControlesProducto();

        // Pestañas del teléfono: solo tienen sentido si se puede pedir.
        mostrarEl(qs('cartaVistaTabs'), true);
        aplicarVista();

        if (estado.socio) activarCuenta();
    }

    /** Enciende la pestaña activa y hace visible el lado que toca. */
    function aplicarVista() {
        var activa = pestañaDeVista(estado.vista === 'pedido' ? 'pedido' : 'carta');
        var pedido = (estado.vista === 'pedido');
        document.body.classList.toggle('vista-pedido', pedido);
        var tabs = document.querySelectorAll('.carta-vista-tab');
        tabs.forEach(function (t) {
            t.classList.toggle('activo', t === activa);
        });
    }

    function pestañaDeVista(vista) {
        return document.querySelector('.carta-vista-tab[data-vista-tab="' + vista + '"]');
    }

    /** Avisa a la vista de que la cuenta cambió: repinta donde corresponda.
     *  Si el pedido está en su columna, repinta esa columna; si no, el modal de respaldo. */
    function alCambiarCuenta() {
        actualizarPedidoBar();
        pintarControlesProducto();
        if (pedidoEnColumna()) {
            renderPedidoPanel();
        } else if (qs('modalPedido') && !qs('modalPedido').classList.contains('hidden')) {
            renderPedidoModal();
        }
    }

    /** Arranca la observación de la cuenta: refresco inicial, socket y sondeo. */
    function activarCuenta() {
        actualizarBarraComensal();
        refrescarCuenta({ silencioso: true });
        conectarSocket();
        iniciarSondeo();
    }

    function actualizarBarraComensal() {
        var bar = qs('dinerBar');
        if (!bar) return;
        var btn = qs('dinerBarBoton');

        if (estado.socio) {
            qs('dinerBarTitulo').textContent = 'Cuenta ' + (estado.socio.code || '');
            qs('dinerBarSub').textContent = estado.punto
                ? ('Estás en ' + estado.punto + ' · agrega platillos a la cuenta')
                : 'Agrega platillos a la cuenta de la mesa';
            btn.textContent = 'Ver pedido';
            btn.dataset.accion = 'ver';
        } else {
            qs('dinerBarTitulo').textContent = 'Pide desde tu teléfono';
            qs('dinerBarSub').textContent = (estado.mode === 'open_tab')
                ? 'Únete a la cuenta de tu mesa con su código'
                : 'Arma tu pedido y envíalo a cocina';
            btn.textContent = 'Pedir';
            btn.dataset.accion = 'pedir';
        }
    }

    function actualizarPedidoBar() {
        var bar = qs('orderBar');
        if (!bar) return;

        if (!estado.socio || !estado.cuenta) {
            bar.classList.add('hidden');
            document.body.classList.remove('con-pedido');
            mostrarEl(qs('pedidoPanel'), false);
            document.body.classList.remove('con-panel');
            // Sin cuenta no hay pestaña de pedido: el teléfono se queda en la carta.
            if (estado.vista === 'pedido' && !pedidoEnColumna()) {
                estado.vista = 'carta';
                aplicarVista();
            }
            return;
        }

        var c = estado.cuenta;
        var piezas = 0;
        (c.items || []).forEach(function (it) { piezas += Number(it.quantity) || 0; });
        var total = (c.totals && Number(c.totals.total)) || 0;

        qs('orderBarPiezas').textContent = piezas;
        qs('orderBarTotal').textContent = dinero(total);

        // Discreto cuando está vacío, pero presente para poder abrir la cuenta.
        bar.classList.toggle('vacia', piezas === 0);
        bar.classList.remove('hidden');
        document.body.classList.add('con-pedido');

        // La columna del pedido (escritorio/tableta) siempre visible; el modal solo
        // en pantallas angostas, donde el pedido es una hoja inferior.
        if (pedidoEnColumna()) {
            mostrarEl(qs('pedidoPanel'), true);
            document.body.classList.add('con-panel');
            if (qs('modalPedido') && !qs('modalPedido').classList.contains('hidden')) {
                cerrarModal('modalPedido');
            }
        } else {
            mostrarEl(qs('pedidoPanel'), false);
            document.body.classList.remove('con-panel');
        }
    }

    // ============================================================
    // Pedido: cuenta y productos propios
    // ============================================================

    function esPendiente(st) {
        return String(st === null || st === undefined ? 'pending' : st) === 'pending';
    }

    function misItems() {
        var c = estado.cuenta;
        if (!c || !estado.socio) return [];
        return (c.items || []).filter(function (it) {
            return String(it.participant_id) === String(estado.socio.participant_id);
        });
    }

    function cantidadPropia(id, tipo) {
        return misItems().filter(function (it) {
            var coincide = String(it.product_id) === String(id);
            return coincide && (tipo === 'pending' ? esPendiente(it.status) : !esPendiente(it.status));
        }).reduce(function (a, it) { return a + (Number(it.quantity) || 0); }, 0);
    }

    function pintarControlesProducto() {
        var slots = document.querySelectorAll('.producto-pedir');
        if (!slots.length) return;

        var activo = !!estado.socio;
        var pausado = activo && estado.cuenta && estado.cuenta.session &&
                      estado.cuenta.session.ordering_enabled === false;

        slots.forEach(function (slot) {
            var id = slot.dataset.productoId;
            var p = estado.productos[id];
            slot.innerHTML = '';

            // Sin sesión, producto agotado o inexistente: no hay control.
            if (!activo || !p || p.sold_out) {
                slot.classList.add('hidden');
                return;
            }
            slot.classList.remove('hidden');

            if (pausado) {
                slot.innerHTML = '<span class="mp-pausa-chip">Pedidos en pausa</span>';
                return;
            }

            var pend = cantidadPropia(id, 'pending');
            var enviado = cantidadPropia(id, 'sent');
            var html = '';

            if (pend > 0) {
                html += '<div class="mp-cantidad-mini">' +
                            '<button type="button" class="mp-step-mini" data-accion="menos" data-producto="' + esc(id) + '" aria-label="Quitar uno"><i class="fas fa-minus"></i></button>' +
                            '<span class="mp-cant-mini">' + esc(pend) + '</span>' +
                            '<button type="button" class="mp-step-mini" data-accion="mas" data-producto="' + esc(id) + '" aria-label="Agregar uno"><i class="fas fa-plus"></i></button>' +
                        '</div>';
            } else {
                html += '<button type="button" class="mp-agregar" data-accion="agregar" data-producto="' + esc(id) + '">' +
                            '<i class="fas fa-plus"></i> Agregar' +
                        '</button>';
            }

            if (enviado > 0) {
                html += '<span class="mp-enviado-chip"><i class="fas fa-check"></i> Enviado ' + esc(enviado) + '</span>';
            }

            slot.innerHTML = html;
        });
    }

    // ============================================================
    // Pedido: operaciones
    // ============================================================

    /**
     * Envía un ítem al pedido. `cantidad` es la cantidad FINAL de esa línea:
     * 0 quita la línea pendiente. Es la forma que encaja con el endpoint
     * (POST items:[{product_id,quantity,notes}] -> cuenta actualizada).
     */
    function agregarItem(pid, cantidad, notas) {
        if (!estado.socio) {
            return Promise.reject(new Error('Primero únete a la cuenta de la mesa.'));
        }
        var item = { product_id: Number(pid), quantity: Number(cantidad) };
        if (estado.allowNotes && notas) item.notes = notas;

        return apiPost(API_ORDER, {
            join_token: estado.socio.join_token,
            items: [item]
        }).then(function (data) {
            if (data) estado.cuenta = data;
            alCambiarCuenta();
            return data;
        });
    }

    function quitarItem(itemId) {
        // Quita una línea que todavía no se mandó a cocina.
        // Antes se mandaba cantidad 0 y el API lo rechazaba ("la cantidad debe ser mayor que
        // cero"), así que quitar un platillo NO funcionaba. Ahora hay una acción propia.
        if (!estado.socio) return;
        apiPost(API_ORDER, {
            action: 'remove',
            join_token: estado.socio.join_token,
            order_item_id: Number(itemId)
        }).then(function (data) {
            if (data) estado.cuenta = data;
            alCambiarCuenta();
        }).catch(function (e) {
            mostrarAvisoPedido('error', e.message);
        });
    }

    function refrescarCuenta(opts) {
        opts = opts || {};
        if (!estado.socio) return Promise.resolve();

        return apiGet(API_ORDER + '?join_token=' + encodeURIComponent(estado.socio.join_token))
            .then(function (data) {
                estado.cuenta = data;
                alCambiarCuenta();
                return data;
            })
            .catch(function (e) {
                if (esSesionInvalida(e)) {
                    olvidarSocio();
                    actualizarBarraComensal();
                    pintarControlesProducto();
                    actualizarPedidoBar();
                    aviso('La cuenta se cerró. Vuelve a unirte para pedir.', 'error');
                } else if (!opts.silencioso) {
                    aviso(e.message, 'error');
                }
            });
    }

    function enviarCocina() {
        if (!estado.socio) return;
        setEnviarDeshabilitado(true);
        mostrarAvisoPedido('error', null);
        mostrarAvisoPedido('exito', null);

        apiPost(API_ORDER, { join_token: estado.socio.join_token, action: 'send' })
            .then(function () {
                // La respuesta trae {sent, session}; la cuenta completa se
                // repinta con un GET para no depender de su forma exacta.
                return refrescarCuenta({ silencioso: true });
            })
            .then(function () {
                aviso('Pedido enviado a cocina', 'ok');
                mostrarAvisoPedido('exito', 'Tu pedido ya está en cocina.');
                renderPedidoPanel();
                renderPedidoModal();
            })
            .catch(function (e) {
                mostrarAvisoPedido('error', e.message);
            })
            .then(function () {
                setEnviarDeshabilitado(false);
            });
    }

    /** Habilita/deshabilita los dos botones de "Enviar a cocina" (columna y modal). */
    function setEnviarDeshabilitado(deshabilitado) {
        ['btnEnviarCocina', 'btnEnviarCocinaPanel'].forEach(function (id) {
            var b = qs(id);
            if (b) b.disabled = !!deshabilitado;
        });
    }

    /** Muestra u oculta un aviso de error/éxito en AMBAS superficies del pedido.
     *  texto null oculta. */
    function mostrarAvisoPedido(tipo, texto) {
        var ids = tipo === 'error'
            ? ['pedidoError', 'pedidoPanelError']
            : ['pedidoExito', 'pedidoPanelExito'];
        ids.forEach(function (id) {
            var el = qs(id);
            if (!el) return;
            if (texto === null || texto === undefined) {
                el.textContent = '';
                el.classList.add('hidden');
            } else {
                el.textContent = texto;
                el.classList.remove('hidden');
            }
        });
    }

    // ============================================================
    // Pedido: modal "El pedido de la mesa"
    // ============================================================

    function renderGrupo(g) {
        var propio = estado.socio && g.id === String(estado.socio.participant_id);
        var nombre = propio ? 'Tú' : (g.nombre || 'Comensal');

        var filas = g.items.map(function (it) { return renderItem(it, propio); }).join('');
        if (!filas) {
            filas = '<p class="mp-vacio mp-vacio-mini">Sin platillos todavía.</p>';
        }

        return '<section class="mp-grupo' + (propio ? ' es-propio' : '') + '">' +
                   '<div class="mp-grupo-cabecera"><i class="fas fa-user"></i><span>' + esc(nombre) + '</span></div>' +
                   '<div class="mp-grupo-items">' + filas + '</div>' +
               '</section>';
    }

    function renderItem(it, propio) {
        var pend = esPendiente(it.status);
        var puedeEditar = propio && pend;
        var estadoTxt = pend ? 'Pendiente' : 'Enviado a cocina';
        var estadoCls = pend ? 'mp-estado-pend' : 'mp-estado-env';
        var notas = it.notes ? '<p class="mp-item-notas"><i class="fas fa-pen"></i> ' + esc(it.notes) + '</p>' : '';
        var cant = Number(it.quantity) || 0;
        var abierta = estado.notasAbiertas === String(it.order_item_id);

        // Controles POR LÍNEA. Lo mío y pendiente se puede ajustar pieza por pieza; lo que ya
        // está en cocina no (ahí lo correcto es pedirle al personal).
        var acciones = '';
        if (puedeEditar) {
            acciones =
                '<div class="mp-linea-acciones">' +
                    '<button type="button" class="mp-linea-btn" data-accion="lineamenos" data-item="' + esc(it.order_item_id) + '" data-cantidad="' + esc(cant) + '" aria-label="Una menos"><i class="fas fa-minus"></i></button>' +
                    '<button type="button" class="mp-linea-btn" data-accion="lineamas" data-item="' + esc(it.order_item_id) + '" data-cantidad="' + esc(cant) + '" aria-label="Una más"><i class="fas fa-plus"></i></button>' +
                    '<button type="button" class="mp-linea-btn' + (abierta ? ' activo' : '') + '" data-accion="notas" data-item="' + esc(it.order_item_id) + '">' +
                        '<i class="fas fa-pen"></i> ' + (it.notes ? 'Cambiar nota' : 'Anotar') +
                    '</button>' +
                    '<button type="button" class="mp-item-quitar" data-accion="quitar" data-item="' + esc(it.order_item_id) + '" aria-label="Quitar"><i class="fas fa-trash-can"></i></button>' +
                '</div>';
        }

        // La caja de notas vive DENTRO de la propia línea: se abre aquí mismo, sin otro modal.
        var caja = '';
        if (puedeEditar && abierta) {
            caja =
                '<div class="mp-linea-notas-caja">' +
                    '<input type="text" id="notasLinea' + esc(it.order_item_id) + '" class="mp-notas-input" maxlength="200"' +
                        ' placeholder="Sin cebolla, sin salsa, término medio…" value="' + esc(it.notes || '') + '">' +
                    '<button type="button" class="mp-linea-btn primario" data-accion="guardarnotas" data-item="' + esc(it.order_item_id) + '">Guardar</button>' +
                '</div>';
        }

        return '<div class="mp-item">' +
                   '<div class="mp-item-cant">' + esc(cant) + 'x</div>' +
                   '<div class="mp-item-info">' +
                       '<p class="mp-item-nombre">' + esc(it.product_name) + '</p>' +
                       notas +
                       '<span class="mp-item-estado ' + estadoCls + '">' + esc(estadoTxt) + '</span>' +
                       acciones +
                       caja +
                   '</div>' +
                   '<div class="mp-item-derecha">' +
                       '<span class="mp-item-precio">' + dinero(it.line_total) + '</span>' +
                   '</div>' +
               '</div>';
    }

    function renderPedidoModal() {
        var cont = qs('pedidoLista');
        if (!cont) return;

        // textContent no interpreta HTML: aquí NO se escapa (evita doble codificación).
        qs('pedidoCodigo').textContent = (estado.socio && estado.socio.code)
            ? ('Código de la cuenta: ' + estado.socio.code) : '';

        var c = estado.cuenta;
        if (!c) {
            cont.innerHTML = '<p class="mp-vacio">Cargando el pedido…</p>';
            qs('pedidoTotal').textContent = dinero(0);
            return;
        }

        // Se muestran todos los comensales; quien no pidió aparece como vacío.
        cont.innerHTML = listaDeCuenta(c);

        qs('pedidoTotal').textContent = dinero((c.totals && c.totals.total) || 0);

        // El botón de enviar se activa si hay algo pendiente en la cuenta.
        var pendientes = pendientesDe(c);
        var btn = qs('btnEnviarCocina');
        if (btn) btn.disabled = pendientes === 0;
        var ayuda = qs('pedidoPieAyuda');
        if (ayuda) ayuda.textContent = textoSegunPendientes(pendientes);
    }

    /** El pedido en la columna de la derecha (escritorio/tableta). Mismo contenido que el
     *  modal: una sola verdad para que no diverjan. */
    function renderPedidoPanel() {
        var cont = qs('pedidoPanelLista');
        if (!cont) return;

        qs('pedidoPanelCodigo').textContent = (estado.socio && estado.socio.code)
            ? ('Código ' + estado.socio.code) : '';

        var c = estado.cuenta;
        if (!c) {
            cont.innerHTML = '<p class="mp-vacio">Cargando el pedido…</p>';
            qs('pedidoPanelTotal').textContent = dinero(0);
            return;
        }

        cont.innerHTML = listaDeCuenta(c);
        qs('pedidoPanelTotal').textContent = dinero((c.totals && c.totals.total) || 0);

        var pendientes = pendientesDe(c);
        var btn = qs('btnEnviarCocinaPanel');
        if (btn) btn.disabled = pendientes === 0;
        var ayuda = qs('pedidoPanelAyuda');
        if (ayuda) ayuda.textContent = textoSegunPendientes(pendientes);
    }

    /** Agrupa por comensal y devuelve el HTML de la lista. Compartido por la columna
     *  y el modal: se ven igual aunque vivan en sitios distintos. */
    function listaDeCuenta(c) {
        var grupos = [], porId = {};
        (c.participants || []).forEach(function (p) {
            var g = { id: String(p.participant_id), nombre: p.display_name, items: [] };
            porId[g.id] = g;
            grupos.push(g);
        });
        (c.items || []).forEach(function (it) {
            var g = porId[String(it.participant_id)];
            if (!g) {
                g = { id: String(it.participant_id), nombre: 'Comensal', items: [] };
                porId[g.id] = g;
                grupos.push(g);
            }
            g.items.push(it);
        });

        return grupos.length
            ? grupos.map(renderGrupo).join('')
            : '<p class="mp-vacio">Todavía no hay nada en esta cuenta.</p>';
    }

    function pendientesDe(c) {
        return (c.items || []).filter(function (it) { return esPendiente(it.status); }).length;
    }

    function textoSegunPendientes(pendientes) {
        if (pendientes === 0) return 'No hay platillos pendientes de enviar.';
        return pendientes + (pendientes === 1
            ? ' platillo listo para cocina.'
            : ' platillos listos para cocina.');
    }

    function abrirPedido() {
        // Escritorio/tableta: el pedido ya vive en su columna; se lleva la vista ahí.
        if (pedidoEnColumna()) {
            var panel = qs('pedidoPanel');
            if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            refrescarCuenta({ silencioso: false });
            return;
        }
        // Teléfono: el pedido es la pestaña de pantalla completa que ya existe.
        verPedido();
    }

    // ============================================================
    // Pedido: agregar de uno en uno (sin modal de por medio)
    // ============================================================
    //
    // Así se pide de verdad en una mesa: un toque, un platillo; otro toque, otro más. Cada
    // platillo lleva SUS notas ("sin cebolla" en uno no puede caerle al de al lado), así que
    // las notas se editan POR LÍNEA y dentro de la vista del pedido, sin abrir otra ventana
    // encima de la que ya está abierta.

    /** Agrega UNA pieza del platillo. El servidor fusiona con la línea equivalente. */
    function agregarUno(pid) {
        if (!estado.socio) { abrirPedirModal(); return; }
        var p = estado.productos[String(pid)];
        if (p && p.sold_out) { aviso('Ese platillo se agotó', 'error'); return; }

        agregarItem(pid, 1, '')
            .then(function () {
                aviso((p ? p.name : 'Platillo') + ' agregado', 'ok');
            })
            .catch(function (e) { aviso(e.message, 'error'); });
    }

    /** Las líneas MÍAS pendientes de un platillo (la más antigua primero). */
    function lineasPropiasDe(pid) {
        return misItems().filter(function (it) {
            return String(it.product_id) === String(pid) && esPendiente(it.status);
        });
    }

    /**
     * Quita una pieza del platillo tocado.
     *
     * Se quita de la línea SIN notas primero (la "normal") y, si no hay, de la última con
     * notas: bajar de dos a uno un platillo anotado no puede tocar el otro renglón.
     */
    function quitarUnoDeProducto(pid) {
        if (!estado.socio) return;
        var lineas = lineasPropiasDe(pid);
        if (!lineas.length) return;

        var sinNotas = lineas.filter(function (it) { return !it.notes; });
        var objetivo = sinNotas.length ? sinNotas[0] : lineas[lineas.length - 1];
        cambiarCantidadLinea(objetivo.order_item_id, (Number(objetivo.quantity) || 0) - 1);
    }

    /** La cantidad de UNA línea (0 la quita). Es lo que respeta las notas de cada renglón. */
    function cambiarCantidadLinea(itemId, cantidad) {
        if (!estado.socio) return Promise.resolve();
        return apiPost(API_ORDER, {
            action: 'set_quantity',
            join_token: estado.socio.join_token,
            order_item_id: Number(itemId),
            quantity: Math.max(0, Number(cantidad) || 0)
        }).then(function (data) {
            if (data) estado.cuenta = data;
            alCambiarCuenta();
            return data;
        }).catch(function (e) {
            aviso(e.message, 'error');
        });
    }

    /** Abre o cierra la caja de notas de una línea, DENTRO de la vista del pedido. */
    function alternarNotasLinea(itemId) {
        estado.notasAbiertas = String(estado.notasAbiertas) === String(itemId) ? null : String(itemId);
        alCambiarCuenta();
        if (estado.notasAbiertas) {
            var campo = qs('notasLinea' + itemId);
            if (campo) setTimeout(function () { campo.focus(); }, 60);
        }
    }

    /** Guarda las notas de esa línea (vacío = borrar la nota). */
    function guardarNotasLinea(itemId) {
        var campo = qs('notasLinea' + itemId);
        if (!campo) return;
        var texto = (campo.value || '').trim().slice(0, 200);

        apiPost(API_ORDER, {
            action: 'set_notes',
            join_token: estado.socio.join_token,
            order_item_id: Number(itemId),
            notes: texto
        }).then(function (data) {
            if (data) estado.cuenta = data;
            estado.notasAbiertas = null;
            alCambiarCuenta();
            aviso(texto ? 'Nota guardada' : 'Nota borrada', 'ok');
        }).catch(function (e) {
            aviso(e.message, 'error');
        });
    }

    // ============================================================
    // Vista del teléfono (carta / pedido)
    // ============================================================

    function verCarta() {
        estado.vista = 'carta';
        aplicarVista();
        // El enlace deja de pedir "abre en el pedido" cuando el cliente ya está viendo la carta.
        if ((window.location.hash || '').toLowerCase() === '#pedido') {
            try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) { /* sin history */ }
        }
    }

    function verPedido() {
        estado.vista = 'pedido';
        aplicarVista();
        refrescarCuenta({ silencioso: false });
    }

    // ============================================================
    // Pedido: iniciar cuenta / unirse
    // ============================================================

    function leerNombre() {
        var v = (qs('inpNombre').value || '').trim();
        return v.slice(0, 60);
    }

    function consultarSesion() {
        return apiGet(API_SESSION + '?menu_token=' + encodeURIComponent(estado.token))
            .catch(function () { return null; });
    }

    function abrirPedirModal() {
        mostrarEl(qs('modalPedirError'), false);
        qs('inpNombre').value = estado.socio ? (estado.socio.display_name || '') : '';
        var deUrl = codigoDeUrl();
        qs('inpCodigo').value = deUrl || '';
        qs('inpCodigo').placeholder = 'ABCD';

        // Si el mesero ya te pasó el enlace con el código de la cuenta, no lo escribas: solo
        // tu nombre. Ese es el QR "ya autorizado" de la mesa.
        var campoCodigo = qs('inpCodigo').closest('.mp-campo');
        if (campoCodigo) campoCodigo.classList.toggle('hidden', !!deUrl);

        var bloqueIniciar = qs('bloqueIniciar');
        var hint = qs('modalPedirHint');

        if (estado.mode === 'order_and_pay') {
            bloqueIniciar.classList.remove('hidden');
            hint.classList.add('hidden');
        } else {
            // open_tab: la mesa la abre el personal; solo queda unirse.
            bloqueIniciar.classList.add('hidden');
            hint.textContent = 'Pide al personal que abra la mesa y únete con el código de la cuenta.';
            hint.classList.remove('hidden');
        }

        abrirModal('modalPedir');

        // Consulta informativa: si ya hay una cuenta abierta, insinúa su código.
        consultarSesion().then(function (data) {
            var ses = data && data.session;
            if (!ses || !ses.code) return;
            if (!qs('inpCodigo').value) qs('inpCodigo').placeholder = String(ses.code);
        });
    }

    /** Crea la cuenta y se une a ella con el nombre dado. */
    function iniciarPedido() {
        var nombre = leerNombre();
        var btn = qs('btnIniciar');
        mostrarEl(qs('modalPedirError'), false);
        if (btn) btn.disabled = true;

        // El punto va viajando: si la carta se abrió desde el QR impreso de la mesa, la
        // cuenta nace sabiendo DÓNDE está el cliente (y si el personal ya la abrió, entra a
        // ESA cuenta en vez de abrir una paralela en la misma mesa).
        apiPost(API_SESSION, {
            action: 'open',
            menu_token: estado.token,
            table_token: puntoDeUrl()
        })
            .then(function (abierta) {
                // open devuelve la cuenta; join entrega el join_token con el que
                // se opera. El que abre también debe unirse para poder pedir.
                if (abierta && abierta.punto) estado.punto = String(abierta.punto);
                return apiPost(API_SESSION, {
                    action: 'join',
                    code: abierta.code,
                    display_name: nombre
                }).then(function (union) {
                    return { abierta: abierta, union: union };
                });
            })
            .then(function (r) {
                var u = r.union || {};
                estado.socio = {
                    join_token:     String(u.join_token),
                    participant_id: (u.participant_id !== undefined ? u.participant_id : null),
                    session_id:     (u.session_id !== undefined ? u.session_id : r.abierta.session_id),
                    code:           String(u.code || r.abierta.code || ''),
                    display_name:   nombre,
                    menu_token:     estado.token
                };
                guardarSocio();
                cerrarModal('modalPedir');
                // Si la cuenta ya existía (la abrió el mesero), no se "abre": se entra.
                if (r.abierta && r.abierta.existente) {
                    aviso('Te uniste a la cuenta ' + estado.socio.code, 'ok');
                } else {
                    mostrarCodigo(estado.socio.code);
                }
                activarCuenta();
                // En el teléfono, pedir lleva a la pestaña del pedido (el "carrito").
                // En escritorio la columna ya está a la vista.
                if (!pedidoEnColumna()) verPedido();
                aviso('Listo, ya puedes pedir', 'ok');
            })
            .catch(function (e) {
                // Aquí cae, por ejemplo, el aviso de open_tab pidiendo al personal.
                mostrarAvisoModal('modalPedirError', e.message);
            })
            .then(function () {
                if (btn) btn.disabled = false;
            });
    }

    function unirsePedido() {
        var code = (qs('inpCodigo').value || '').trim().toUpperCase();
        var nombre = leerNombre();
        var btn = qs('btnUnirse');
        mostrarEl(qs('modalPedirError'), false);

        if (!/^[A-Z0-9]{4}$/.test(code)) {
            mostrarAvisoModal('modalPedirError', 'Escribe el código de 4 caracteres de la cuenta.');
            return;
        }

        if (btn) btn.disabled = true;
        apiPost(API_SESSION, { action: 'join', code: code, display_name: nombre })
            .then(function (u) {
                estado.socio = {
                    join_token:     String(u.join_token),
                    participant_id: u.participant_id,
                    session_id:     u.session_id,
                    code:           String(u.code || code),
                    display_name:   nombre,
                    menu_token:     estado.token
                };
                guardarSocio();
                cerrarModal('modalPedir');
                activarCuenta();
                if (!pedidoEnColumna()) verPedido();
                aviso('Te uniste a la cuenta ' + estado.socio.code, 'ok');
            })
            .catch(function (e) {
                mostrarAvisoModal('modalPedirError', e.message);
            })
            .then(function () {
                if (btn) btn.disabled = false;
            });
    }

    function mostrarCodigo(code) {
        if (!code) return;
        qs('codigoGrande').textContent = code;
        abrirModal('modalCodigo');
    }

    // ============================================================
    // Tiempo real: WebSocket + sondeo de respaldo
    // ============================================================

    function socketUrl(credencial) {
        var host = window.location.hostname;
        var consulta = 'session=' + encodeURIComponent(credencial.canal)
            + '&token=' + encodeURIComponent(credencial.token)
            + '&exp=' + encodeURIComponent(credencial.exp);
        // Local: el relay corre aparte en 8765.
        if (host === 'localhost' || host === '127.0.0.1') {
            return 'ws://localhost:8765/?' + consulta;
        }
        var scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return scheme + '//' + window.location.host + '/ws/?' + consulta;
    }

    /**
     * Pide el token del canal al servidor y conecta.
     * El relay ya no acepta el canal de una cuenta sin token: el `session_id` es un entero
     * corto y cualquiera podía adivinarlo para escuchar el pedido de otra mesa. Si el token
     * no se consigue, se sigue funcionando con el sondeo (nunca se bloquea la carta).
     */
    function conectarSocket() {
        if (!estado.socio || typeof WebSocket === 'undefined') return;
        detenerSocket();
        var sesion = estado.socio.session_id;
        fetch('/api/ws/token.php?canal=' + encodeURIComponent(sesion)
              + '&join_token=' + encodeURIComponent(estado.socio.join_token || ''),
              { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (datos) {
                if (!datos || datos.success === false || !datos.data) return;
                try {
                    estado.socket = new WebSocket(socketUrl(datos.data));
                } catch (e) {
                    estado.socket = null;
                    return;
                }
                var s = estado.socket;

                s.onmessage = function (ev) {
                    var msg = null;
                    try { msg = JSON.parse(ev.data); } catch (e) { return; }
                    // El servidor avisa que la cuenta cambió: se vuelve a pedir y repinta.
                    if (msg && msg.type === 'order_update') {
                        refrescarCuenta({ silencioso: true });
                    }
                };
                s.onerror = function () {
                    try { s.close(); } catch (e) { /* ignore */ }
                };
                s.onclose = function () {
                    if (estado.socket === s) estado.socket = null;
                    // Sin reconexión agresiva: el sondeo ya mantiene la cuenta fresca.
                };
            })
            .catch(function () { /* sin tiempo real: el sondeo sostiene la vista */ });
    }

    function detenerSocket() {
        if (!estado.socket) return;
        var s = estado.socket;
        estado.socket = null;
        try { s.onclose = null; s.close(); } catch (e) { /* ignore */ }
    }

    function iniciarSondeo() {
        detenerSondeo();
        estado.pollTimer = setInterval(function () {
            if (document.hidden) return;
            refrescarCuenta({ silencioso: true });
        }, POLL_MS);
    }

    function detenerSondeo() {
        if (estado.pollTimer) {
            clearInterval(estado.pollTimer);
            estado.pollTimer = null;
        }
    }

    // ============================================================
    // Eventos
    // ============================================================

    function manejarClic(ev) {
        var t = ev.target;
        if (!t || !t.closest) return;
        var b = t.closest('[data-accion]');
        if (!b || b.disabled) return;

        switch (b.dataset.accion) {
            case 'pedir':        abrirPedirModal(); break;
            case 'ver':          abrirPedido(); break;
            case 'cerrarPanel':  verCarta(); break;
            case 'verCarta':     verCarta(); break;
            case 'verPedido':    verPedido(); break;
            // Agregar es UN toque: no abre nada encima de lo que ya está abierto.
            case 'agregar':      agregarUno(b.dataset.producto); break;
            case 'mas':          agregarUno(b.dataset.producto); break;
            case 'menos':        quitarUnoDeProducto(b.dataset.producto); break;
            case 'quitar':       quitarItem(b.dataset.item); break;
            // Controles POR LÍNEA (cada platillo con sus notas)
            case 'lineamenos':   cambiarCantidadLinea(b.dataset.item, Number(b.dataset.cantidad) - 1); break;
            case 'lineamas':     cambiarCantidadLinea(b.dataset.item, Number(b.dataset.cantidad) + 1); break;
            case 'notas':        alternarNotasLinea(b.dataset.item); break;
            case 'guardarnotas': guardarNotasLinea(b.dataset.item); break;
            case 'iniciar':      iniciarPedido(); break;
            case 'unirse':       unirsePedido(); break;
            case 'enviar':       enviarCocina(); break;
        }
    }

    function manejarCerrar(ev) {
        var t = ev.target;
        if (!t) return;
        if (t.closest && t.closest('[data-cerrar]')) {
            cerrarModal(t.closest('[data-cerrar]').dataset.cerrar);
            return;
        }
        // Clic en el fondo oscuro: cierra el modal.
        if (t.classList && t.classList.contains('mp-overlay')) {
            cerrarModal(t.id);
        }
    }

    function manejarTeclado(ev) {
        if (ev.key !== 'Escape') return;
        var abierto = document.querySelector('.mp-overlay:not(.hidden)');
        if (abierto) cerrarModal(abierto.id);
    }

    // ============================================================
    // Arranque
    // ============================================================

    function iniciar() {
        var token = tokenDeUrl();
        if (!token) {
            fallar('Enlace inválido', 'Este enlace no corresponde a ninguna carta. Escanea de nuevo el código QR.');
            return;
        }
        estado.token = token;

        document.addEventListener('click', manejarClic);
        document.addEventListener('click', manejarCerrar);
        document.addEventListener('keydown', manejarTeclado);
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden && estado.socio) refrescarCuenta({ silencioso: true });
        });

        mostrar('cartaCargando');

        fetch(API + '?t=' + encodeURIComponent(token), { cache: 'no-store' })
            .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
            .then(function (res) {
                if (!res.ok || !res.body || res.body.success === false) {
                    var msg = (res.body && res.body.message) || 'La carta no está disponible.';
                    fallar('No se pudo abrir la carta', msg);
                    return;
                }
                renderCarta(res.body.data || {});
            })
            .catch(function () {
                fallar('Sin conexión', 'Revisa tu conexión a internet e intenta de nuevo.');
            });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }

    // El reparto cambia con el ancho: se reubica el pedido (columna o pestaña) sin
    // recargar. Es el único repintado completo, y solo pasa al girar o redimensionar.
    window.addEventListener('resize', function () {
        if (!estado.socio || !estado.cuenta) return;
        actualizarPedidoBar();
        if (pedidoEnColumna()) renderPedidoPanel();
    });

    // Enlace que se reenvía tal cual: el QR impreso de la mesa deja `#pedido` en la URL
    // para que al reabrirla se entre directo al pedido (en el teléfono).
    if ((window.location.hash || '').toLowerCase() === '#pedido' && !pedidoEnColumna()) {
        estado.vista = 'pedido';
        aplicarVista();
    }
})();
