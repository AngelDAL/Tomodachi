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
