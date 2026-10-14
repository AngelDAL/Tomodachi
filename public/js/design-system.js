/* ================================================================
   Tomodachi — Design System (animaciones chill unificadas)
   Se carga en las páginas de la app. Detecta elementos comunes
   (cards, tablas, títulos, estadísticas, KPIs) y les aplica
   animaciones suaves con anime.js cuando entran al viewport.
   No interfiere con la lógica existente de cada módulo.
   ================================================================ */
(function () {
  if (typeof anime === 'undefined') return; // requerido anime.js

  // ------------- helpers -------------
  function isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  // Aplica entrada suave a un grupo de elementos (stagger)
  function revealGroup(elements) {
    if (!elements || !elements.length) return;
    anime({
      targets: elements,
      translateY: [16, 0],
      opacity: [0, 1],
      delay: anime.stagger(80, {start: 40}),
      duration: 650,
      easing: 'easeOutCubic',
      begin: function () {
        // quitar opacidad 0 heredada para que no blockeen clics
        elements.forEach(function (el) { el.style.pointerEvents = 'auto'; });
      }
    });
  }

  // Contador suave para <span data-count="123" data-prefix="$">
  function animateCounters(scope) {
    var counters = (scope || document).querySelectorAll('[data-count]');
    counters.forEach(function (el) {
      if (el.dataset.done) return;
      el.dataset.done = '1';
      var target = parseFloat(el.dataset.count);
      var prefix = el.dataset.prefix || '';
      var dec = parseInt(el.dataset.decimals || 0, 10);
      anime({
        targets: { v: 0 },
        v: target,
        round: dec,
        duration: 1300,
        easing: 'easeInOutQuad',
        update: function (a) {
          el.textContent = prefix + a.animations[0].currentValue.toLocaleString('es-MX');
        }
      });
    });
  }

  // ------------- selección de elementos comunes -------------
  function collectTargets() {
    // tarjetas
    var cards = document.querySelectorAll('.card, .dashboard-card, .stat-card, .widget-card');
    // filas de tablas (body)
    var rows = document.querySelectorAll('table tbody tr, .table tbody tr, .data-table tbody tr');
    // listas de items (cada <li>) — para carrito, listados
    var listItems = document.querySelectorAll('ul > li:not(.no-animate)');
    // KPIs
    var kpis = document.querySelectorAll('.kpi, .stat-value, .metric-value');

    // Títulos ya animan con la fuente Sora; no sobreanimar.

    // Linked list de grupos
    var groups = [];
    if (cards.length > 4) groups.push(cards);       // solo rejillas de cards
    if (rows.length > 3) groups.push(rows);
    if (kpis.length) { /* counters aparte */ animateCounters(document); }

    // Observar entrada en viewport una sola vez
    if (groups.length) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          // animar el conjunto al que pertenece el primer elemento visible
          revealGroup(groups[0]); // animamos el primero para simplicidad y ritmo
          io.disconnect();
        });
      }, { threshold: 0.15 });
      var first = groups[0][0];
      if (first) io.observe(first);
    }

    // Contadores dentro de cards, una vez visibles
    if (cards.length) {
      var cio = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) animateCounters(en.target); });
      }, { threshold: 0.2 });
      cards.forEach(function (c) { if (c.querySelector('[data-count]')) cio.observe(c); });
    }
  }

  // Esperar a que cargue el DOM y los estilos
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', collectTargets);
  } else {
    collectTargets();
  }

  // Re-ejecutar tras navegación de pestañas (evento custom que app.js puede disparar)
  document.addEventListener('ds:refresh', collectTargets);
})();


/* ================================================================
   Confirmaciones y entradas en tarjeta — nunca `alert/confirm/prompt`
   ----------------------------------------------------------------
   `confirm()` y `prompt()` bloquean el hilo (en una tablet de caja se
   sienten como si la app se hubiera colgado) y no se pueden estilizar.
   Estas funciones devuelven promesa y usan una tarjeta compacta con los
   tokens del tema, así que claro y oscuro salen solos.

       if (!await confirmarAccion({ titulo: 'Eliminar', mensaje: '…' })) return;
       const clave = await pedirTexto({ titulo: 'Clave de rastreo', etiqueta: 'CLABE o CEP' });

   Viven aquí porque este es el único script que cargan TODAS las
   pantallas (31 páginas); en `app.js` sólo estarían en las 11 que lo
   cargan. El CSS se inyecta una sola vez desde aquí para no depender de
   que la página traiga una hoja concreta.
   ================================================================ */
function _avisoEstilos() {
    if (document.getElementById('avisoEstilos')) return;
    const css = document.createElement('style');
    css.id = 'avisoEstilos';
    css.textContent = `
    .aviso-fondo { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 10050;
        display: flex; align-items: center; justify-content: center; padding: 16px; }
    .aviso-tarjeta { background: var(--bg-card); color: var(--text-color); width: 100%; max-width: 420px;
        border: 1px solid var(--border-color); border-radius: var(--border-radius, 12px);
        box-shadow: var(--shadow-lg, 0 12px 32px rgba(0,0,0,.28)); padding: 18px 18px 14px;
        font-family: var(--font-body, inherit); max-height: 90vh; overflow: auto; }
    .aviso-titulo { font-family: var(--font-heading, inherit); font-size: var(--font-size-lg, 1.125rem);
        font-weight: 700; margin: 0 0 6px; }
    .aviso-mensaje { font-size: var(--font-size-sm, .875rem); color: var(--text-light); margin: 0 0 14px;
        line-height: 1.45; }
    .aviso-campo { width: 100%; padding: 10px 12px; font-size: var(--font-size-md, 1rem); margin-bottom: 14px;
        background: var(--bg-input, var(--bg-light)); color: var(--text-color);
        border: 1px solid var(--border-color); border-radius: 8px; box-sizing: border-box; }
    .aviso-campo:focus { outline: none; border-color: var(--primary-color); box-shadow: var(--primary-focus-ring, none); }
    .aviso-botones { display: flex; gap: 10px; justify-content: flex-end; }
    .aviso-btn { padding: 10px 18px; border-radius: 8px; border: 1px solid var(--border-color);
        background: var(--bg-light); color: var(--text-color); font-size: var(--font-size-sm, .875rem);
        font-weight: 600; cursor: pointer; font-family: inherit; }
    .aviso-btn-principal { background: var(--primary-color); color: var(--text-on-primary, #08352F);
        border-color: var(--primary-color); }
    .aviso-btn-peligro { background: var(--danger-color); color: #fff; border-color: var(--danger-color); }
    @media (max-width: 480px) {
        .aviso-botones { flex-direction: column-reverse; }
        .aviso-btn { width: 100%; }
    }`;
    document.head.appendChild(css);
}

function _avisoAbrir(opciones) {
    _avisoEstilos();
    return new Promise(resolve => {
        const fondo = document.createElement('div');
        fondo.className = 'aviso-fondo';
        const tarjeta = document.createElement('div');
        tarjeta.className = 'aviso-tarjeta';
        tarjeta.setAttribute('role', 'dialog');
        tarjeta.setAttribute('aria-modal', 'true');

        const titulo = document.createElement('h3');
        titulo.className = 'aviso-titulo';
        titulo.textContent = opciones.titulo || '';
        tarjeta.appendChild(titulo);

        if (opciones.mensaje) {
            const mensaje = document.createElement('p');
            mensaje.className = 'aviso-mensaje';
            mensaje.textContent = opciones.mensaje;
            tarjeta.appendChild(mensaje);
        }

        let campo = null;
        if (opciones.campo) {
            campo = document.createElement('input');
            campo.className = 'aviso-campo';
            campo.type = 'text';
            campo.placeholder = opciones.campo.etiqueta || '';
            campo.value = opciones.campo.valor || '';
            tarjeta.appendChild(campo);
        }

        const botones = document.createElement('div');
        botones.className = 'aviso-botones';

        let cerrado = false;
        const cerrar = (resultado) => {
            if (cerrado) return;
            cerrado = true;
            document.removeEventListener('keydown', alTeclear);
            fondo.remove();
            resolve(resultado);
        };

        const alTeclear = (ev) => {
            if (ev.key === 'Escape') { ev.preventDefault(); cerrar(opciones.campo ? null : false); }
            else if (ev.key === 'Enter' && opciones.campo && document.activeElement === campo) {
                ev.preventDefault(); cerrar(campo.value.trim() || null);
            }
        };

        if (opciones.cancelar !== false) {
            const no = document.createElement('button');
            no.type = 'button';
            no.className = 'aviso-btn';
            no.textContent = opciones.textoCancelar || 'Cancelar';
            no.addEventListener('click', () => cerrar(opciones.campo ? null : false));
            botones.appendChild(no);
        }

        const si = document.createElement('button');
        si.type = 'button';
        si.className = 'aviso-btn ' + (opciones.peligroso ? 'aviso-btn-peligro' : 'aviso-btn-principal');
        si.textContent = opciones.textoConfirmar || 'Aceptar';
        si.addEventListener('click', () => cerrar(opciones.campo ? (campo.value.trim() || null) : true));
        botones.appendChild(si);
        tarjeta.appendChild(botones);

        fondo.appendChild(tarjeta);
        fondo.addEventListener('mousedown', (ev) => { if (ev.target === fondo) cerrar(opciones.campo ? null : false); });
        document.addEventListener('keydown', alTeclear);
        document.body.appendChild(fondo);
        (campo || si).focus();
    });
}

/** Pregunta de sí o no en tarjeta. Promesa: true si acepta, false si no. */
function confirmarAccion(opciones) {
    return _avisoAbrir(Object.assign({ textoConfirmar: 'Aceptar' }, opciones || {}));
}

/** Pide un texto corto (equivalente a `prompt()` sin bloqueo). Devuelve el texto o null. */
function pedirTexto(opciones) {
    const o = Object.assign({ textoConfirmar: 'Guardar' }, opciones || {});
    o.campo = { etiqueta: o.etiqueta, valor: o.valor };
    return _avisoAbrir(o);
}
