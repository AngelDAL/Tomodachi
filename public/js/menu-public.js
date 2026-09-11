/**
 * Carta pública del comensal.
 *
 * Se abre desde el QR, que apunta a /m/<token> (o ?t=<token>).
 * Es de solo lectura: ver la carta no autoriza a pedir. El flujo de pedido
 * (cuenta por mesa) tiene su propio control de sesión en otra fase.
 */
(function () {
    'use strict';

    // Ruta absoluta: la página se sirve en /m/<token>, donde una ruta relativa
    // resolvería contra /m/ y daría 404.
    var API = '/api/menu/public.php';

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

    function mostrar(id) {
        ['cartaCargando', 'cartaError', 'cartaContenido'].forEach(function (x) {
            var el = document.getElementById(x);
            if (el) el.classList.toggle('hidden', x !== id);
        });
    }

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
    // Render
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

        var aviso = menu.allow_notes
            ? 'Pide al personal si necesitas algo especial.'
            : '';
        document.getElementById('cartaPieAviso').textContent = aviso;

        mostrar('cartaContenido');
        conectarNav();
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
    // Arranque
    // ============================================================

    function iniciar() {
        var token = tokenDeUrl();
        if (!token) {
            fallar('Enlace inválido', 'Este enlace no corresponde a ninguna carta. Escanea de nuevo el código QR.');
            return;
        }

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
