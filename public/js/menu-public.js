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
        productoSel: null,
        prodCant: 1
    };

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

        if (estado.socio) activarCuenta();
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
            qs('dinerBarSub').textContent = estado.socio.display_name
                ? ('Pedidos de ' + estado.socio.display_name)
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
            actualizarPedidoBar();
            pintarControlesProducto();
            if (qs('modalPedido') && !qs('modalPedido').classList.contains('hidden')) renderPedidoModal();
            return data;
        });
    }

    function ajustarProducto(pid, delta) {
        var pend = cantidadPropia(pid, 'pending');
        var objetivo = pend + delta;
        if (objetivo < 0) objetivo = 0;
        if (objetivo > 99) objetivo = 99;

        var existente = misItems().filter(function (it) {
            return String(it.product_id) === String(pid) && esPendiente(it.status);
        })[0];
        var notas = existente && existente.notes ? existente.notes : '';

        agregarItem(pid, objetivo, notas).catch(function (e) {
            aviso(e.message, 'error');
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
            actualizarPedidoBar();
            pintarControlesProducto();
            if (qs('modalPedido') && !qs('modalPedido').classList.contains('hidden')) renderPedidoModal();
        }).catch(function (e) {
            mostrarAvisoModal('pedidoError', e.message);
        });
    }

    function refrescarCuenta(opts) {
        opts = opts || {};
        if (!estado.socio) return Promise.resolve();

        return apiGet(API_ORDER + '?join_token=' + encodeURIComponent(estado.socio.join_token))
            .then(function (data) {
                estado.cuenta = data;
                actualizarPedidoBar();
                pintarControlesProducto();
                if (qs('modalPedido') && !qs('modalPedido').classList.contains('hidden')) {
                    renderPedidoModal();
                }
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
        var btn = qs('btnEnviarCocina');
        if (btn) btn.disabled = true;
        mostrarEl(qs('pedidoError'), false);
        mostrarEl(qs('pedidoExito'), false);

        apiPost(API_ORDER, { join_token: estado.socio.join_token, action: 'send' })
            .then(function () {
                // La respuesta trae {sent, session}; la cuenta completa se
                // repinta con un GET para no depender de su forma exacta.
                return refrescarCuenta({ silencioso: true });
            })
            .then(function () {
                aviso('Pedido enviado a cocina', 'ok');
                var exito = qs('pedidoExito');
                if (exito) {
                    exito.textContent = 'Tu pedido ya está en cocina.';
                    exito.classList.remove('hidden');
                }
                renderPedidoModal();
            })
            .catch(function (e) {
                mostrarAvisoModal('pedidoError', e.message);
            })
            .then(function () {
                if (btn) btn.disabled = false;
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
        var puedeQuitar = propio && pend;
        var estadoTxt = pend ? 'Pendiente' : 'Enviado a cocina';
        var estadoCls = pend ? 'mp-estado-pend' : 'mp-estado-env';
        var notas = it.notes ? '<p class="mp-item-notas">' + esc(it.notes) + '</p>' : '';

        return '<div class="mp-item">' +
                   '<div class="mp-item-cant">' + esc(it.quantity) + 'x</div>' +
                   '<div class="mp-item-info">' +
                       '<p class="mp-item-nombre">' + esc(it.product_name) + '</p>' +
                       notas +
                       '<span class="mp-item-estado ' + estadoCls + '">' + esc(estadoTxt) + '</span>' +
                   '</div>' +
                   '<div class="mp-item-derecha">' +
                       '<span class="mp-item-precio">' + dinero(it.line_total) + '</span>' +
                       (puedeQuitar
                           ? '<button type="button" class="mp-item-quitar" data-accion="quitar" data-item="' + esc(it.order_item_id) + '" aria-label="Quitar"><i class="fas fa-trash-can"></i></button>'
                           : '') +
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

        // Agrupar por comensal respetando el orden de participants.
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

        // Se muestran todos los comensales; quien no pidió aparece como vacío.
        cont.innerHTML = grupos.length
            ? grupos.map(renderGrupo).join('')
            : '<p class="mp-vacio">Todavía no hay nada en esta cuenta.</p>';

        qs('pedidoTotal').textContent = dinero((c.totals && c.totals.total) || 0);

        // El botón de enviar se activa si hay algo pendiente en la cuenta.
        var pendientes = (c.items || []).filter(function (it) { return esPendiente(it.status); }).length;
        var btn = qs('btnEnviarCocina');
        if (btn) btn.disabled = pendientes === 0;
        var ayuda = qs('pedidoPieAyuda');
        if (ayuda) {
            ayuda.textContent = pendientes === 0
                ? 'No hay platillos pendientes de enviar.'
                : (pendientes + (pendientes === 1 ? ' platillo listo para cocina.' : ' platillos listos para cocina.'));
        }
    }

    function abrirPedido() {
        abrirModal('modalPedido');
        mostrarEl(qs('pedidoError'), false);
        mostrarEl(qs('pedidoExito'), false);
        renderPedidoModal();
        refrescarCuenta({ silencioso: false });
    }

    // ============================================================
    // Pedido: modal de producto (cantidad y notas)
    // ============================================================

    function abrirModalProducto(pid) {
        var p = estado.productos[pid];
        if (!p) return;

        estado.productoSel = pid;
        estado.prodCant = 1;

        qs('prodTitulo').textContent = p.name || 'Agregar';
        qs('prodPrecio').textContent = dinero(p.price) + ' c/u';
        qs('prodCant').textContent = '1';

        var notasW = qs('prodNotasW');
        var notas = qs('prodNotas');
        if (estado.allowNotes) {
            notasW.classList.remove('hidden');
        } else {
            notasW.classList.add('hidden');
        }
        notas.value = '';

        mostrarEl(qs('prodError'), false);
        abrirModal('modalProducto');
    }

    function cambiarCantidadProducto(delta) {
        estado.prodCant += delta;
        if (estado.prodCant < 1) estado.prodCant = 1;
        if (estado.prodCant > 99) estado.prodCant = 99;
        qs('prodCant').textContent = estado.prodCant;
    }

    function confirmarProducto() {
        var pid = estado.productoSel;
        if (!pid) return;
        var notas = estado.allowNotes ? (qs('prodNotas').value || '').trim().slice(0, 200) : '';

        var btn = qs('prodConfirmar');
        if (btn) btn.disabled = true;
        mostrarEl(qs('prodError'), false);

        agregarItem(pid, estado.prodCant, notas)
            .then(function () {
                cerrarModal('modalProducto');
                aviso('Agregado a tu pedido', 'ok');
            })
            .catch(function (e) {
                mostrarAvisoModal('prodError', e.message);
            })
            .then(function () {
                if (btn) btn.disabled = false;
            });
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

        apiPost(API_SESSION, { action: 'open', menu_token: estado.token })
            .then(function (abierta) {
                // open devuelve la cuenta; join entrega el join_token con el que
                // se opera. El que abre también debe unirse para poder pedir.
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
                mostrarCodigo(estado.socio.code);
                activarCuenta();
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
            case 'agregar':      abrirModalProducto(b.dataset.producto); break;
            case 'mas':          ajustarProducto(b.dataset.producto, 1); break;
            case 'menos':        ajustarProducto(b.dataset.producto, -1); break;
            case 'quitar':       quitarItem(b.dataset.item); break;
            case 'iniciar':      iniciarPedido(); break;
            case 'unirse':       unirsePedido(); break;
            case 'enviar':       enviarCocina(); break;
            case 'prodmas':      cambiarCantidadProducto(1); break;
            case 'prodmenos':    cambiarCantidadProducto(-1); break;
            case 'prodconfirmar':confirmarProducto(); break;
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
})();
