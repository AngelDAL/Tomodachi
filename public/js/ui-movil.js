/**
 * ui-movil.js — que las etiquetas largas no se encimen en el teléfono.
 *
 * EL PROBLEMA
 * En una fila de acciones caben tres botones en una computadora y no caben en un teléfono
 * de 390 px. Los botones se encogen, el texto se corta ("Movimien…") y lo que se lee es
 * basura: peor que no poner nada. Lo mismo pasa con etiquetas que se encimen con el texto
 * de al lado.
 *
 * LO QUE HACE
 * Recorre los botones que YA tienen un icono, mide su etiqueta con el ancho real que
 * tienen y, si no cabe, esconde SOLO el texto y deja el icono (con el nombre completo en
 * el `title`, y el texto sigue disponible para los lectores de pantalla). Si el teléfono
 * se gira o la pantalla se ensancha, se vuelve a medir y las etiquetas reaparecen.
 *
 * Se ejecuta en varias pasadas porque es un problema de acomodo: cuando un botón se queda
 * con el icono, sus vecinos ganan espacio y algunos que antes no cabían ya caben.
 *
 * NO adivina por el largo del texto: mide. Así funciona igual con "Corte" que con
 * "Movimientos", sin listas de excepciones que se quedan viejas.
 */
(function () {
    'use strict';

    var ANCHO_MOVIL = 768;
    var PASADAS = 3;

    function enMovil() {
        return window.matchMedia('(max-width: ' + ANCHO_MOVIL + 'px)').matches;
    }

    function tieneIcono(el) {
        return !!el.querySelector('i.fa, i.fas, i.far, i.fab, svg, .icono, .icon');
    }

    function esBotonDeAccion(el) {
        if (el.disabled) return false;
        if (el.classList.contains('nav-item') || el.closest('.nav-item')) return false; // esa barra tiene su propio trato
        if (el.hasAttribute('data-sin-compactar')) return false;
        if (el.closest('.modal, .drawer-content, .tp-modal, .mp-modal')) return false;    // dentro de un modal hay espacio de sobra
        if (!tieneIcono(el)) return false;
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    /**
     * Envuelve la etiqueta (el texto suelto del botón) en un <span> para poder esconderla
     * sin tocar el icono. Se hace UNA sola vez por botón; después solo se alterna la clase.
     */
    function envolverEtiqueta(el) {
        if (el.dataset.etiquetaEnvuelta === '1') return el.querySelector('.btn-texto');
        var nodos = Array.prototype.slice.call(el.childNodes);
        var textos = nodos.filter(function (n) {
            return n.nodeType === 3 && n.textContent.trim().length > 1;
        });
        if (!textos.length) { el.dataset.etiquetaEnvuelta = '1'; return null; }
        var span = document.createElement('span');
        span.className = 'btn-texto';
        textos.forEach(function (n) {
            if (!span.textContent) span.textContent = n.textContent.trim();
            el.removeChild(n);
        });
        el.appendChild(span);
        el.dataset.etiquetaEnvuelta = '1';
        return span;
    }

    function medir() {
        if (!enMovil()) {
            // En pantalla grande no se esconde nada —y no se toca el DOM—: solo se limpia lo
            // que se hubiera marcado antes (al girar el teléfono, las etiquetas vuelven).
            Array.prototype.forEach.call(document.querySelectorAll('.btn-solo-icono'), function (el) {
                el.classList.remove('btn-solo-icono');
                el.removeAttribute('title');
            });
            return;
        }

        var botones = Array.prototype.slice.call(
            document.querySelectorAll('button, a.btn, .btn, .terminal-actions > *, .acciones > *')
        ).filter(esBotonDeAccion);

        // Todo visible primero: una etiqueta ya escondida siempre "cabe" y nunca volvería.
        var preparados = [];
        botones.forEach(function (el) {
            el.classList.remove('btn-solo-icono');
            var span = envolverEtiqueta(el);
            if (span) preparados.push({ boton: el, span: span });
        });

        if (!enMovil()) return;   // ya cubierto arriba: aquí solo se llega en móvil

        for (var pasada = 0; pasada < PASADAS; pasada++) {
            preparados.forEach(function (par) {
                var el = par.boton;
                if (el.classList.contains('btn-solo-icono')) return;
                // ¿El contenido no cabe en el botón? Entonces sobra la etiqueta.
                if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
                    el.classList.add('btn-solo-icono');
                    el.setAttribute('title', par.span.textContent.trim());
                }
            });
        }
    }

    // Con retraso y agrupado: las páginas pintan listas (tarjetas de caja, movimientos)
    // después de cargar, y no queremos medir en cada tecla.
    var pendiente = null;
    var midiendo = false;
    function medirPronto() {
        if (midiendo) return;   // los cambios que provoca la propia medición no cuentan
        if (pendiente) clearTimeout(pendiente);
        pendiente = setTimeout(function () {
            pendiente = null;
            midiendo = true;
            try { medir(); } finally { midiendo = false; }
        }, 150);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', medirPronto);
    } else {
        medirPronto();
    }
    window.addEventListener('resize', medirPronto);
    window.addEventListener('orientationchange', medirPronto);

    // Las listas que se pintan solas (dinero, movimientos, puntos) también se revisan.
    if (window.MutationObserver && document.body) {
        var observadorMedida = new MutationObserver(medirPronto);
        observadorMedida.observe(document.body, { childList: true, subtree: true });
        window.__uiMovilObservador = observadorMedida;
    }
})();

/* ============================================================
 * Deslizar entre pestañas (móvil)
 *
 * En el teléfono las pestañas de un drawer son una sola fila, con la enfocada expandida.
 * Aquí se añade el gesto: deslizar a la izquierda avanza a la siguiente, a la derecha
 * vuelve a la anterior. El gesto se apoya en las pestañas de verdad (se les dispara su
 * clic), así que la página cambia de panel con SU propia lógica y no hay dos verdades.
 *
 * Dos cuidados para no arruinar el uso normal:
 *  - Solo cuenta si el gesto es claramente horizontal (más de 45 px y al menos 1.5 veces el
 *    movimiento vertical): si no, es un scroll de la página y no se toca nada.
 *  - Un gesto que empieza sobre un campo, botón o etiqueta se ignora: ahí el dedo está
 *    escribiendo o seleccionando texto, no navegando.
 * ============================================================ */
(function () {
    'use strict';

    var FILAS = '.drawer-tabs, .add-tabs, .panel-tabs';
    var PESTANAS = '.drawer-tab, .add-tab, .panel-tab-btn';
    var MINIMO = 45;   // px que hay que recorrer para que cuente como desliz

    function pestanasVisibles(fila) {
        return Array.prototype.slice.call(fila.querySelectorAll(PESTANAS))
            .filter(function (t) { return t.getBoundingClientRect().width > 0; });
    }

    function pasarAPestana(fila, paso) {
        var tabs = pestanasVisibles(fila);
        if (tabs.length < 2) return;
        var actual = -1;
        tabs.forEach(function (t, i) { if (t.classList.contains('active')) actual = i; });
        if (actual < 0) return;
        var destino = tabs[actual + paso];
        if (destino) destino.click();
    }

    function vigilar(fila) {
        if (fila.dataset.deslizListo === '1') return;
        fila.dataset.deslizListo = '1';

        var x0 = 0, y0 = 0, siguiendo = false;

        function empezar(e) {
            if (e.touches.length !== 1) { siguiendo = false; return; }
            var t = e.touches[0];
            // El gesto no empieza sobre un control: ahí el dedo hace otra cosa.
            if (e.target.closest && e.target.closest('input, textarea, select, button, label, a')) {
                siguiendo = false;
                return;
            }
            x0 = t.clientX; y0 = t.clientY; siguiendo = true;
        }

        function terminar(e) {
            if (!siguiendo) return;
            siguiendo = false;
            var t = e.changedTouches && e.changedTouches[0];
            if (!t) return;
            var dx = t.clientX - x0, dy = t.clientY - y0;
            if (Math.abs(dx) < MINIMO || Math.abs(dx) < Math.abs(dy) * 1.5) return;  // era un scroll
            pasarAPestana(fila, dx < 0 ? 1 : -1);
        }

        fila.addEventListener('touchstart', empezar, { passive: true });
        fila.addEventListener('touchend', terminar, { passive: true });
        fila.addEventListener('touchcancel', function () { siguiendo = false; }, { passive: true });
    }

    function prepararDesliz() {
        Array.prototype.forEach.call(document.querySelectorAll(FILAS), vigilar);
    }

    prepararDesliz();
    if (window.MutationObserver && document.body) {
        var observador = new MutationObserver(function () { prepararDesliz(); });
        observador.observe(document.body, { childList: true, subtree: true });
    }
})();

/* ============================================================
 * El botón "atrás" del teléfono cierra el modal, no la página
 *
 * Sin esto, en el teléfono el gesto de volver (o el botón del sistema) sacaba al usuario de
 * la pantalla en la que estaba, con el modal abierto a medias: perdía el hilo y tenía que
 * entrar otra vez. Ahora, si hay un modal o un drawer a la vista, el "atrás" lo cierra; recién
 * el siguiente "atrás" cambia de página.
 *
 * Cómo funciona: al abrirse un modal se apunta una entrada en el historial; cuando el "atrás"
 * la consume, se cierra el modal en vez de navegar. Y si el usuario lo cierra con la X, se
 * retira esa entrada para que el historial quede limpio (nada de "atrás" fantasma).
 *
 * Los modales NO son anidados en este proyecto (a propósito), así que basta con seguir uno:
 * el de más arriba.
 * ============================================================ */
(function () {
    'use strict';

    var CANDIDATOS = [
        '.modal', '.modal-overlay', '.drawer-overlay', '.tp-overlay', '.mp-overlay',
        '.quantity-modal', '.numpad-drawer', '.scanner-overlay', '.client-dialog'
    ].join(', ');

    var ESTADOS = ['show', 'active', 'open', 'visible'];
    var estado = { abierto: false, porAtras: false };

    function seVe(el) {
        var s = window.getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
        var r = el.getBoundingClientRect();
        return r.width > 40 && r.height > 40;
    }

    /**
     * El modal o drawer que está a la vista, si hay alguno.
     *
     * Se decide por lo que se VE, no por el nombre de la clase: en este proyecto conviven tres
     * maneras de abrir (`.show`, `.active` y los `<dialog>` nativos con el atributo `open`), y
     * la que se me quedó fuera fue justamente la de los diálogos de cliente.
     */
    function abiertoAhora() {
        var abiertos = [];
        Array.prototype.forEach.call(document.querySelectorAll(CANDIDATOS), function (el) {
            if (el.classList.contains('hidden')) return;
            if (el.hasAttribute('hidden')) return;
            if (!seVe(el)) return;
            abiertos.push(el);
        });
        return abiertos.length ? abiertos[abiertos.length - 1] : null;
    }

    /** Cierra el modal: con SU botón de cerrar, para que corra su propia limpieza. */
    function cerrar(el) {
        var boton = el.querySelector('.modal-close, .drawer-close, .tp-modal-cerrar, .mp-cerrar, [data-cerrar]');
        if (boton) { boton.click(); return; }
        if (typeof el.close === 'function') { el.close(); return; }   // <dialog> nativo
        ESTADOS.forEach(function (c) { el.classList.remove(c); });
        el.classList.add('hidden');
    }

    // El "atrás" del teléfono: si hay algo abierto, se cierra y NO se navega.
    window.addEventListener('popstate', function () {
        if (!estado.abierto) return;
        estado.porAtras = true;
        var el = abiertoAhora();
        if (el) cerrar(el);
        estado.abierto = false;
        setTimeout(function () { estado.porAtras = false; }, 300);
    });

    var pendiente = null;
    function revisar() {
        if (pendiente) clearTimeout(pendiente);
        pendiente = setTimeout(function () {
            pendiente = null;
            var el = abiertoAhora();

            if (el && !estado.abierto) {
                // Se abrió: se apunta una entrada para que el "atrás" tenga algo que consumir.
                estado.abierto = true;
                try { history.pushState({ tomodachiModal: true }, ''); } catch (e) {}
            } else if (!el && estado.abierto && !estado.porAtras) {
                // Se cerró desde la interfaz: se retira la entrada para no dejar un "atrás" de más.
                estado.abierto = false;
                if (history.state && history.state.tomodachiModal) history.back();
            }
        }, 120);
    }

    if (window.MutationObserver && document.body) {
        var observadorModales = new MutationObserver(revisar);
        observadorModales.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'hidden']
        });
    }
    window.addEventListener('load', revisar);
    revisar();
})();

