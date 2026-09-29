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
        // La hoja del pedido nace en su altura media (se ve la cuenta y el botón) y se
        // expande a pantalla completa con el asa, si el comensal quiere ver todo.
        if (id === 'modalPedido') ponerAltoHoja('media');
    }

    function cerrarModal(id) {
        var el = qs(id);
        if (el) el.classList.add('hidden');
        if (!document.querySelector('.mp-overlay:not(.hidden)')) {
            document.body.classList.remove('con-capa');
        }
        // La hoja del pedido en el teléfono: al cerrarla se vuelve a la carta. Si no, la vista
        // "pedido" sigue puesta, la carta queda oculta y la barra del pedido escondida: el
        // comensal ve una pantalla EN BLANCO.
        if (id === 'modalPedido' && !pedidoEnColumna() && estado.vista === 'pedido') {
            estado.vista = 'carta';
            aplicarVista();
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

    /**
     * Aviso CON una acción ("Deshacer").
     *
     * Quitar un platillo con un desliz no puede ser irreversible: en un teléfono el dedo
     * resbala, y el comensal no tiene forma de saber que se equivocó. Dura más que un
     * aviso normal (7 s) porque hay que alcanzar el botón.
     */
    function avisoConAccion(texto, etiqueta, accion) {
        var el = qs('mpAviso');
        if (!el) return;
        el.innerHTML = '<span class="mp-aviso-texto">' + esc(texto) + '</span>' +
                       '<button type="button" class="mp-aviso-accion">' + esc(etiqueta) + '</button>';
        el.classList.remove('hidden', 'es-error', 'es-exito');
        el.classList.add('es-exito');

        var ocultar = function () {
            el.classList.add('hidden');
            el.innerHTML = '';
        };
        if (avisoTemporizador) clearTimeout(avisoTemporizador);
        avisoTemporizador = setTimeout(ocultar, 7000);

        var boton = el.querySelector('.mp-aviso-accion');
        if (boton) {
            boton.addEventListener('click', function () {
                if (avisoTemporizador) clearTimeout(avisoTemporizador);
                ocultar();
                accion();
            });
        }
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
        // El nombre del negocio ya no se pinta en la carta (se retiró el encabezado); sigue
        // vivo en la pestaña del navegador, que es donde se consulta.
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

        // La carta ya NO pinta encabezado: ni logo, ni nombre de la tienda, ni título, ni
        // descripción. El comensal acaba de escanear el QR de ESTE negocio; lo que necesita
        // es ver platillos, y ese bloque se comía la parte alta de la pantalla. La marca
        // queda en los colores del tema (aplicarMarca) y el nombre del negocio en la
        // pestaña del navegador.
        var menu = datos.menu || {};
        document.title = (datos.store && datos.store.name ? datos.store.name + ' · ' : '') +
                         (menu.name || 'Carta');

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

        estado.socio = leerSocio();
        pintarControlesProducto();

        // Pestañas del teléfono: solo tienen sentido si se puede pedir.
        mostrarEl(qs('cartaVistaTabs'), true);
        aplicarVista();

        // La invitación a pedir (columna en el escritorio, píldora en el teléfono) y, si ya
        // hay cuenta, el pedido de verdad con su barra.
        actualizarPedidoBar();

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

    // ============================================================
    // Activación: dos números (o su QR) y el mesero que autoriza
    // ============================================================
    /**
     * Pregunta en qué va la solicitud de ESTE dispositivo.
     *
     * Se llama en cada cambio de cuenta (al unirse y en cada refresco/sondeo) y también al
     * terminar de pintar, así el drawer se pone en verde solo aunque el WebSocket esté caído.
     * Nunca regenera el par: eso solo pasa si el cliente lo pide a propósito.
     */
    function revisarActivacion() {
        if (!estado.socio || !estado.socio.join_token) {
            estado.activacion = null;
            estado.puedePedir = true;
            return;
        }
        peticion(API_SESSION, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'estado_activacion', join_token: estado.socio.join_token })
        }).then(function (r) {
            // Se cerró la cuenta, o quien atiende expulsó a ESTE dispositivo: se suelta el
            // vínculo y se le dice qué hacer, en vez de dejarlo esperando algo que ya no llega.
            if (r.status === 404) {
                cerrarModal('drawerActivar');
                olvidarSocio();
                estado.socio = null;
                estado.activacion = null;
                estado.puedePedir = false;
                pintarControlesProducto();
                actualizarPedidoBar();
                aviso('Te sacaron de la cuenta. Toca «Pedir» para volver a entrar', 'error');
                return;
            }
            if (!r.ok) return;

            var d = (r.body && r.body.data) || null;
            var antes = estado.activacion && estado.activacion.estado;
            estado.activacion = d;
            pintarActivacion();
            // Aviso corto la primera vez que pasa a activo: el comensal tiene que enterarse.
            if (d && d.estado === 'activo' && antes !== 'activo') {
                aviso('Ya puedes pedir', 'ok');
            }
        }).catch(function () { /* sin red: se queda como estaba y el sondeo lo reintenta */ });
    }

    /** El par de números, en su QR: el MISMO dato. Escanearlo y teclearlo dan lo mismo. */
    function urlDeActivacion(codigo) {
        var url = window.location.origin + '/public/tables.html?vista=activar&c=' + encodeURIComponent(codigo);
        if (estado.punto) url += '&p=' + encodeURIComponent(estado.punto);
        return url;
    }

    function pintarQrActivacion(codigo) {
        var caja = qs('activarQr');
        if (!caja) return;
        caja.innerHTML = '';
        if (!codigo || !window.QRCode) return;
        try {
            new QRCode(caja, { text: urlDeActivacion(codigo), width: 168, height: 168, correctLevel: QRCode.CorrectLevel.M });
        } catch (e) { caja.innerHTML = ''; }
    }

    /** El drawer de activación: pendiente (con sus números), activo o rechazado. */
    function pintarActivacion() {
        var a = estado.activacion;
        var drawer = qs('drawerActivar');
        if (!drawer) return;

        var activo = !a || a.requiere === false || a.estado === 'activo';
        estado.puedePedir = activo;
        pintarControlesProducto();

        if (activo) {
            if (!a || a.requiere === false || drawer.classList.contains('hidden')) return;
            // Se activó mientras el drawer estaba abierto: se le dice que ya puede.
            qs('activarPar').textContent = 'Listo';
            qs('activarQr').innerHTML = '';
            qs('activarPaso1').textContent = 'Ya te activaron.';
            qs('activarPaso2').classList.add('hidden');
            qs('activarEstado').textContent = 'Toca lo que quieras del menú.';
            mostrarEl(qs('btnActivarOtraVez'), false);
            mostrarEl(qs('btnActivadoListo'), true);
            return;
        }

        abrirModal('drawerActivar');
        var vencido = a.vencido === true || !a.codigo;
        var rechazado = a.estado === 'rechazado';

        qs('activarPar').textContent = (vencido || rechazado)
            ? '--'
            : String(a.codigo).charAt(0) + ' ' + String(a.codigo).charAt(1);
        qs('activarPaso1').textContent = rechazado
            ? 'Quien te atiende no autorizó este dispositivo.'
            : (vencido ? 'Tus números vencieron.' : '1. Dile estos dos números a quien te atiende, o muéstrale este código:');
        mostrarEl(qs('activarPaso2'), !vencido && !rechazado);
        qs('activarEstado').textContent = rechazado
            ? 'Toca "Generar otros números" para intentarlo otra vez.'
            : 'Esperando a que te activen…';
        mostrarEl(qs('btnActivarOtraVez'), vencido || rechazado);
        mostrarEl(qs('btnActivadoListo'), false);
        pintarQrActivacion((vencido || rechazado) ? null : a.codigo);
    }

    /** Pide (o vuelve a pedir) el par de números para este dispositivo. */
    function pedirActivacion() {
        if (!estado.socio) return;
        mostrarAvisoModal('activarError', '');
        apiPost(API_SESSION, { action: 'solicitar_activacion', join_token: estado.socio.join_token })
            .then(function (d) {
                estado.activacion = d || null;
                pintarActivacion();
                aviso('Listos: muéstraselos a quien te atiende', 'ok');
            })
            .catch(function (e) { mostrarAvisoModal('activarError', e.message); });
    }

    /** Avisa a la vista de que la cuenta cambió: repinta donde corresponda.
     *  Si el pedido está en su columna, repinta esa columna; si no, el modal de respaldo. */
    function alCambiarCuenta() {
        actualizarPedidoBar();
        pintarControlesProducto();
        // El estado de la activación se pregunta en cada cambio de cuenta (al unirse y en cada
        // refresco/sondeo): así el drawer se pone en verde solo, aunque no haya WebSocket.
        revisarActivacion();

        // Con el dedo encima NO se repinta: el sondeo (cada 10 s) o el WebSocket pueden
        // reemplazar el renglón que se está arrastrando, y el gesto se perdería en el aire
        // —el dedo seguiría sobre un nodo ya fuera del documento—. Se deja para el final.
        if (deslizLinea) { renderPendiente = true; return; }
        renderPedido();
    }

    /** Pinta el pedido donde le toque: columna (escritorio) o hoja (teléfono). */
    function renderPedido() {
        if (pedidoEnColumna()) {
            renderPedidoPanel();
        } else if (qs('modalPedido') && !qs('modalPedido').classList.contains('hidden')) {
            renderPedidoModal();
        }
    }

    /** Repinta lo que quedó pendiente por un gesto en curso. */
    function volcarRenderPendiente() {
        if (!renderPendiente) return;
        renderPendiente = false;
        renderPedido();
    }

    /** Arranca la observación de la cuenta: refresco inicial, socket y sondeo. */
    function activarCuenta() {
        actualizarCtaPedir();
        actualizarPedidoBar();
        refrescarCuenta({ silencioso: true });
        conectarSocket();
        iniciarSondeo();
    }

    /**
     * La invitación a pedir, y dónde vive.
     *
     * Antes era la "barra del comensal": un renglón de ancho completo bajo el encabezado,
     * con el nombre de la cuenta, su código y un botón. Se retiró: el código no lo usa el
     * comensal (ya hay otra forma de empezar a pedir) y la barra se comía alto en TODAS las
     * vistas. Ahora la invitación vive donde vive el pedido:
     *   - escritorio → dentro de la columna "Tu pedido";
     *   - teléfono   → una píldora flotante.
     * Con cuenta abierta, ninguna de las dos aparece: manda el pedido de verdad.
     */
    function actualizarCtaPedir() {
        if (!admitePedido(estado.mode)) {
            mostrarEl(qs('pedidoPanelCta'), false);
            return;
        }
        var sinCuenta = !estado.socio;
        // La invitación del teléfono es la PESTAÑA "Pedido" (ver `verPedido()`), no una
        // píldora flotante: flotando tapaba el botón "Agregar" del platillo que quedara
        // debajo. En el escritorio vive dentro de la columna.
        mostrarEl(qs('pedidoPanelCta'), sinCuenta && pedidoEnColumna());

        var texto = qs('pedidoPanelCtaTexto');
        if (texto) {
            texto.textContent = (estado.mode === 'open_tab')
                ? 'Únete a la cuenta de tu mesa con su código, o pide que te la abran.'
                : 'Arma tu pedido y envíalo a cocina cuando estés listo.';
        }
    }

    function actualizarPedidoBar() {
        var bar = qs('orderBar');
        if (!bar) return;

        var enColumna = pedidoEnColumna();
        var hayCuenta = !!estado.socio && !!estado.cuenta;

        // La columna del pedido también se muestra SIN cuenta: ahí vive la invitación a
        // pedir (antes era una barra de ancho completo la que lo hacía).
        if (enColumna && admitePedido(estado.mode)) {
            mostrarEl(qs('pedidoPanel'), true);
            document.body.classList.add('con-panel');
        } else {
            mostrarEl(qs('pedidoPanel'), false);
            document.body.classList.remove('con-panel');
        }

        actualizarCtaPedir();

        if (!hayCuenta) {
            bar.classList.add('hidden');
            document.body.classList.remove('con-pedido');
            // Sin cuenta no hay pestaña de pedido: el teléfono se queda en la carta.
            if (estado.vista === 'pedido' && !enColumna) {
                estado.vista = 'carta';
                aplicarVista();
            }
            renderPedido();
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

        // En el teléfono el pedido es la hoja inferior: la columna no se usa.
        if (enColumna && qs('modalPedido') && !qs('modalPedido').classList.contains('hidden')) {
            cerrarModal('modalPedido');
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

        // TRES situaciones, y cada una ofrece algo distinto:
        //   · sin cuenta            → se muestra "Agregar" y al tocarlo se abre el flujo para
        //                             empezar a pedir. Antes la carta salía SIN un solo botón
        //                             y el comensal no tenía por dónde (fricción anotada).
        //   · con cuenta y activa   → los controles de verdad (cantidad, notas, enviar).
        //   · activación pendiente  → nada: es el candado del mesero, el dispositivo todavía
        //                             no está autorizado.
        var activo = !!estado.socio && estado.puedePedir !== false;
        var pausado = activo && estado.cuenta && estado.cuenta.session &&
                      estado.cuenta.session.ordering_enabled === false;
        var sinCuenta = !estado.socio;

        slots.forEach(function (slot) {
            var id = slot.dataset.productoId;
            var p = estado.productos[id];
            slot.innerHTML = '';

            // Producto agotado o inexistente: no hay control.
            if (!p || p.sold_out) {
                slot.classList.add('hidden');
                return;
            }
            // Activación pendiente: el mesero todavía no autoriza a ESTE dispositivo.
            if (estado.socio && estado.puedePedir === false) {
                slot.classList.add('hidden');
                return;
            }
            slot.classList.remove('hidden');

            if (pausado) {
                slot.innerHTML = '<span class="mp-pausa-chip">Pedidos en pausa</span>';
                return;
            }

            var pend = sinCuenta ? 0 : cantidadPropia(id, 'pending');
            var enviado = sinCuenta ? 0 : cantidadPropia(id, 'sent');
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

    function renderGrupo(g, propio) {
        var nombre = propio ? 'Tú' : (g.nombre || 'Comensal');

        // Cuántas piezas y cuánto suma ESTE comensal: es la primera pregunta que hace
        // cualquiera en una cuenta compartida. Sale de las líneas ya recibidas.
        var piezas = 0, suma = 0;
        g.items.forEach(function (it) {
            piezas += Number(it.quantity) || 0;
            suma += Number(it.line_total) || 0;
        });
        var resumen = piezas > 0
            ? '<span class="mp-grupo-resumen">' + esc(piezas) + (piezas === 1 ? ' pieza' : ' piezas') +
              ' · ' + dinero(suma) + '</span>'
            : '';

        var filas = g.items.map(function (it) { return renderItem(it, propio); }).join('');
        if (!filas) {
            filas = '<p class="mp-vacio mp-vacio-mini">Sin platillos todavía.</p>';
        }

        return '<section class="mp-grupo' + (propio ? ' es-propio' : '') + '">' +
                   '<div class="mp-grupo-cabecera"><i class="fas fa-user"></i><span>' + esc(nombre) + '</span>' + resumen + '</div>' +
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

        var contenido =
            '<div class="mp-item" data-item="' + esc(it.order_item_id) + '">' +
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

        // Solo lo MÍO y PENDIENTE se quita con un desliz: lo que ya está en cocina lo
        // cancela el personal, y lo que pidió otro comensal no es decisión mía. El bote de
        // la fila de acciones se queda: el desliz no lo anuncia un lector de pantalla.
        if (!puedeEditar) return contenido;

        return '<div class="mp-item-desliz" data-item="' + esc(it.order_item_id) + '">' +
                   '<div class="mp-item-fondo" aria-hidden="true"><i class="fas fa-trash-can"></i> Quitar</div>' +
                   contenido +
               '</div>';
    }

    function renderPedidoModal() {
        var cont = qs('pedidoLista');
        if (!cont) return;

        // Aquí se pintaba el "Código de la cuenta: XPWW". Retirado: el comensal no lo usa
        // para nada (la cuenta la abre el mesero o él mismo, y para unirse hay código aparte).
        var c = estado.cuenta;
        if (!c) {
            cont.innerHTML = '<p class="mp-vacio">Cargando el pedido…</p>';
            qs('pedidoTotal').textContent = dinero(0);
            mostrarEl(qs('pedidoResumen'), false);
            mostrarEl(qs('pedidoGestoAyuda'), false);
            return;
        }

        qs('pedidoResumen').textContent = resumenCuentaTexto(c);
        mostrarEl(qs('pedidoResumen'), true);

        // La ayuda del gesto solo aparece si HAY algo que se pueda deslizar: prometer un
        // gesto que no hace nada es peor que no mencionarlo.
        mostrarEl(qs('pedidoGestoAyuda'), hayLineaDeslizable(c));

        // Se muestran todos los comensales; quien no pidió aparece como vacío.
        cont.innerHTML = listaDeCuenta(c);

        qs('pedidoTotal').textContent = dinero((c.totals && c.totals.total) || 0);

        var pendientes = pendientesDe(c);
        var btn = qs('btnEnviarCocina');
        if (btn) btn.disabled = pendientes === 0;
        var ayuda = qs('pedidoPieAyuda');
        if (ayuda) ayuda.textContent = textoSegunPendientes(pendientes);
    }

    /** ¿Hay alguna línea PROPIA y todavía pendiente? Es lo único que se puede deslizar. */
    function hayLineaDeslizable(c) {
        if (!c || !estado.socio) return false;
        return (c.items || []).some(function (it) {
            return String(it.participant_id) === String(estado.socio.participant_id) && esPendiente(it.status);
        });
    }

    /** El pedido en la columna de la derecha (escritorio/tableta). Mismo contenido que el
     *  modal: una sola verdad para que no diverjan. */
    function renderPedidoPanel() {
        var cont = qs('pedidoPanelLista');
        if (!cont) return;

        var sinCuenta = !estado.socio;

        // Sin cuenta: la columna muestra la INVITACIÓN a pedir; la lista y el pie
        // (total + enviar) no tienen nada que decir todavía.
        mostrarEl(qs('pedidoPanelCta'), sinCuenta && admitePedido(estado.mode));
        mostrarEl(cont, !sinCuenta);
        mostrarEl(qs('pedidoPanelPie'), !sinCuenta);
        mostrarEl(qs('pedidoPanelResumen'), !sinCuenta);
        if (sinCuenta) return;

        var c = estado.cuenta;
        if (!c) {
            cont.innerHTML = '<p class="mp-vacio">Cargando el pedido…</p>';
            qs('pedidoPanelTotal').textContent = dinero(0);
            mostrarEl(qs('pedidoPanelResumen'), false);
            return;
        }

        qs('pedidoPanelResumen').textContent = resumenCuentaTexto(c);
        mostrarEl(qs('pedidoPanelResumen'), true);

        cont.innerHTML = listaDeCuenta(c);
        qs('pedidoPanelTotal').textContent = dinero((c.totals && c.totals.total) || 0);

        var pendientes = pendientesDe(c);
        var btn = qs('btnEnviarCocinaPanel');
        if (btn) btn.disabled = pendientes === 0;
        var ayuda = qs('pedidoPanelAyuda');
        if (ayuda) ayuda.textContent = textoSegunPendientes(pendientes);
    }

    /**
     * Agrupa por comensal y devuelve el HTML de la lista. Compartido por la columna y el
     * modal: se ven igual aunque vivan en sitios distintos.
     *
     * ORDEN: primero lo MÍO, después lo de la mesa (con su separador). Es la razón por la
     * que el comensal abre esta pantalla: ver y ajustar su parte. Antes los grupos salían
     * en orden de llegada y "Tú" podía quedar hasta abajo, en una cuenta de seis.
     */
    function listaDeCuenta(c) {
        var grupos = [], porId = {};
        var yo = estado.socio ? String(estado.socio.participant_id) : null;

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

        if (!grupos.length) {
            return '<p class="mp-vacio">Todavía no hay nada en esta cuenta.</p>';
        }

        // Lo mío primero (orden estable: entre los demás no se toca el de llegada).
        grupos.sort(function (a, b) {
            if (a.id === yo) return -1;
            if (b.id === yo) return 1;
            return 0;
        });

        var html = '', ajenos = false;
        grupos.forEach(function (g) {
            var propio = yo !== null && g.id === yo;
            if (!propio && !ajenos) {
                ajenos = true;
                html += '<p class="mp-grupo-sep"><span>De la mesa</span></p>';
            }
            html += renderGrupo(g, propio);
        });
        return html;
    }

    /** "3 personas · 6 piezas · $210.00" — la cabecera de la cuenta, en una línea. */
    function resumenCuentaTexto(c) {
        if (!c) return '';
        var personas = (c.participants || []).length;
        var piezas = 0;
        (c.items || []).forEach(function (it) { piezas += Number(it.quantity) || 0; });
        var total = (c.totals && c.totals.total) || 0;

        return personas + (personas === 1 ? ' persona' : ' personas') + ' · ' +
               piezas + (piezas === 1 ? ' pieza' : ' piezas') + ' · ' + dinero(total);
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
        // Al volver a la carta se baja la hoja del pedido (si estaba abierta).
        if (!pedidoEnColumna()) cerrarModal('modalPedido');
        // El enlace deja de pedir "abre en el pedido" cuando el cliente ya está viendo la carta.
        if ((window.location.hash || '').toLowerCase() === '#pedido') {
            try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) { /* sin history */ }
        }
    }

    function verPedido() {
        // Sin cuenta, "Pedido" ES la invitación: la pestaña abre el flujo para empezar
        // (abrir cuenta o unirse). Antes abría una hoja vacía que decía "Cargando…".
        if (!estado.socio) {
            abrirPedirModal();
            return;
        }
        estado.vista = 'pedido';
        aplicarVista();
        // En el teléfono "el pedido" ES la hoja inferior. Sin abrirla, la vista pedido esconde
        // la carta (y la barra del pedido) y la pantalla queda en blanco: el comensal toca
        // "Pedido" y no aparece nada. En escritorio y tableta manda la columna de siempre.
        if (!pedidoEnColumna()) {
            abrirModal('modalPedido');
            renderPedidoModal();
        }
        refrescarCuenta({ silencioso: false });
    }

    // ============================================================
    // GESTOS DEL TELÉFONO — hoja que se arrastra y línea que se desliza
    // ============================================================
    //
    // En un teléfono el pedido es una hoja inferior. Dos gestos que antes no existían:
    //   · Subir desde la barra del pedido para abrirla, y jalarla por su asa (arriba =
    //     pantalla completa, abajo = se baja y luego se cierra).
    //   · Deslizar a la izquierda un platillo PROPIO y pendiente para quitarlo.
    // Todo vive detrás de `esHojaMovil()`: en escritorio y tableta no se enciende nada y
    // la columna del pedido sigue siendo la de siempre.

    var UMBRAL_CERRAR   = 110;  // px hacia abajo para bajar/cerrar la hoja
    var UMBRAL_EXPANDIR = 55;   // px hacia arriba para ponerla completa
    var UMBRAL_ABRIR    = 45;   // px hacia arriba en la barra para abrirla
    var UMBRAL_QUITAR   = 88;   // px hacia la izquierda para quitar la línea

    function esHojaMovil() {
        return !pedidoEnColumna();
    }

    function hojaModal() {
        return document.querySelector('#modalPedido .mp-modal');
    }

    /** Altura de la hoja: 'media' (por defecto) o 'completa'. */
    function ponerAltoHoja(alto) {
        var m = hojaModal();
        if (!m) return;
        m.classList.toggle('es-completa', alto === 'completa');
    }

    var arrastreHoja = null;

    /** El asa y la cabecera son la zona de arrastre: la lista NO, para no pelear con el scroll. */
    function conectarHoja() {
        var modal = hojaModal();
        if (!modal) return;
        [qs('hojaAsa'), modal.querySelector('.mp-modal-head')].forEach(function (zona) {
            if (!zona) return;
            zona.addEventListener('touchstart', hojaToca, { passive: true });
            zona.addEventListener('touchmove', hojaMueve, { passive: false });
            zona.addEventListener('touchend', hojaSuelta);
            zona.addEventListener('touchcancel', hojaSuelta);
        });

        var bar = qs('orderBar');
        if (bar) {
            bar.addEventListener('touchstart', barraToca, { passive: true });
            bar.addEventListener('touchmove', barraMueve, { passive: false });
            bar.addEventListener('touchend', function () { arrastreBarra = null; });
        }
    }

    function hojaToca(ev) {
        if (!esHojaMovil()) return;
        var t = ev.touches && ev.touches[0];
        if (!t) return;
        arrastreHoja = { y0: t.clientY, dy: 0 };
    }

    function hojaMueve(ev) {
        if (!arrastreHoja) return;
        var t = ev.touches && ev.touches[0];
        var m = hojaModal();
        if (!t || !m) return;

        var dy = t.clientY - arrastreHoja.y0;
        arrastreHoja.dy = dy;

        // Se sigue al dedo con un tope: arriba poco (la hoja no se despega del borde), abajo
        // lo suficiente para que se vea que se está bajando.
        var topeArriba = m.classList.contains('es-completa') ? -8 : -70;
        var d = Math.max(topeArriba, Math.min(dy, 240));

        m.classList.add('arrastrando');
        m.style.transform = 'translateY(' + d + 'px)';
        if (Math.abs(dy) > 6 && ev.cancelable) ev.preventDefault();
    }

    function hojaSuelta() {
        if (!arrastreHoja) return;
        var dy = arrastreHoja.dy;
        arrastreHoja = null;

        var m = hojaModal();
        if (!m) return;
        m.classList.remove('arrastrando');
        m.style.transform = '';

        var completa = m.classList.contains('es-completa');

        if (dy < -UMBRAL_EXPANDIR) { ponerAltoHoja('completa'); return; }
        if (dy > UMBRAL_CERRAR) {
            // Estando completa, bajar la deja "media" (no se cierra de un tirón).
            if (completa) { ponerAltoHoja('media'); return; }
            verCarta();   // baja la hoja y devuelve la vista a la carta
            return;
        }
        if (dy > 40) ponerAltoHoja('media');
    }

    var arrastreBarra = null;

    function barraToca(ev) {
        if (!esHojaMovil()) return;
        var t = ev.touches && ev.touches[0];
        if (!t) return;
        arrastreBarra = { y0: t.clientY };
    }

    /** Un tirón hacia arriba en la barra del pedido abre la hoja (sin buscar el botón). */
    function barraMueve(ev) {
        if (!arrastreBarra) return;
        var t = ev.touches && ev.touches[0];
        if (!t) return;
        if (t.clientY - arrastreBarra.y0 > -UMBRAL_ABRIR) return;
        arrastreBarra = null;
        if (ev.cancelable) ev.preventDefault();
        abrirPedido();
    }

    // ---------- Deslizar una línea para quitarla ----------

    var deslizLinea = null;
    var renderPendiente = false;

    function conectarDeslizLineas() {
        ['pedidoLista', 'pedidoPanelLista'].forEach(function (id) {
            var cont = qs(id);
            if (!cont || cont.dataset.deslizListo) return;
            cont.dataset.deslizListo = '1';
            cont.addEventListener('touchstart', deslizToca, { passive: true });
            cont.addEventListener('touchmove', deslizMueve, { passive: false });
            cont.addEventListener('touchend', deslizSuelta);
            cont.addEventListener('touchcancel', deslizSuelta);
        });
    }

    function deslizToca(ev) {
        var fila = ev.target && ev.target.closest ? ev.target.closest('.mp-item-desliz') : null;
        if (!fila) { deslizLinea = null; return; }
        var t = ev.touches && ev.touches[0];
        if (!t) return;
        deslizLinea = { fila: fila, x0: t.clientX, y0: t.clientY, dx: 0, decidido: null };
    }

    function deslizMueve(ev) {
        if (!deslizLinea) return;
        var t = ev.touches && ev.touches[0];
        if (!t) return;

        var dx = t.clientX - deslizLinea.x0;
        var dy = t.clientY - deslizLinea.y0;

        // Hasta que el movimiento no es claramente horizontal no se decide: si el dedo va
        // vertical, el gesto es el scroll de la lista y aquí no se toca nada.
        if (!deslizLinea.decidido) {
            if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
            deslizLinea.decidido = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'x' : 'y';
        }
        if (deslizLinea.decidido !== 'x') return;

        if (ev.cancelable) ev.preventDefault();
        deslizLinea.dx = Math.max(-140, Math.min(0, dx));

        var linea = deslizLinea.fila.querySelector('.mp-item');
        if (linea) {
            linea.classList.add('sin-transicion');
            linea.style.transform = 'translateX(' + deslizLinea.dx + 'px)';
        }
    }

    function deslizSuelta() {
        if (!deslizLinea) return;
        var d = deslizLinea;
        deslizLinea = null;

        var linea = d.fila.querySelector('.mp-item');
        if (linea) {
            linea.classList.remove('sin-transicion');
            linea.style.transform = '';
        }
        if (d.decidido === 'x' && d.dx <= -UMBRAL_QUITAR) {
            quitarConDeshacer(d.fila.dataset.item);
        }
        // Se suelta el dedo: ahora sí lo que hubiera quedado pendiente de pintar.
        volcarRenderPendiente();
    }

    /**
     * Quita una línea y ofrece DESHACERLA.
     *
     * El desliz es cómodo pero se dispara sin querer: sin deshacer, un platillo se cae de la
     * cuenta y el comensal lo vuelve a agregar (o se queda sin pedirlo).
     */
    function quitarConDeshacer(itemId) {
        var it = ((estado.cuenta && estado.cuenta.items) || []).filter(function (x) {
            return String(x.order_item_id) === String(itemId);
        })[0];
        if (!it) return;

        quitarItem(itemId);
        avisoConAccion(Number(it.quantity) + ' x ' + it.product_name + ' fuera', 'Deshacer', function () {
            agregarItem(it.product_id, it.quantity, it.notes)
                .then(function () { aviso('Se volvió a agregar', 'ok'); })
                .catch(function (e) { aviso(e.message, 'error'); });
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
            case 'quitar':       quitarConDeshacer(b.dataset.item); break;
            // Controles POR LÍNEA (cada platillo con sus notas)
            case 'lineamenos':   cambiarCantidadLinea(b.dataset.item, Number(b.dataset.cantidad) - 1); break;
            case 'lineamas':     cambiarCantidadLinea(b.dataset.item, Number(b.dataset.cantidad) + 1); break;
            case 'notas':        alternarNotasLinea(b.dataset.item); break;
            case 'guardarnotas': guardarNotasLinea(b.dataset.item); break;
            case 'iniciar':      iniciarPedido(); break;
            case 'unirse':       unirsePedido(); break;
            case 'enviar':       enviarCocina(); break;
            // Activación: pedir otra vez el par de números, o cerrar el drawer al quedar listo.
            case 'reactivar':         pedirActivacion(); break;
            case 'cerrarActivacion':  cerrarModal('drawerActivar'); break;
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

        // Gestos del teléfono: la hoja del pedido y el desliz de las líneas. Se conectan
        // una sola vez, sobre los contenedores fijos del documento.
        conectarHoja();
        conectarDeslizLineas();

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
