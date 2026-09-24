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
        var observador = new MutationObserver(medirPronto);
        observador.observe(document.body, { childList: true, subtree: true });
        window.__uiMovilObservador = observador;
    }
})();
