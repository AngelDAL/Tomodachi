/**
 * keyboard-nav.js — Atajos de teclado estilo videojuego para Tomodachi
 *
 * Esquema unificado (v2):
 *  - Navegación entre secciones: Ctrl+1..7 / Ctrl+Shift+1..7 / Alt+1..7
 *    (Ctrl+1..9 en algunos navegadores cambia de pestaña y no llega a la
 *    app; Ctrl+Shift y Alt son el respaldo garantizado)
 *  - Ayuda de atajos: Ctrl+/ o "?" en TODAS las páginas (F1 era poco
 *    fiable: Firefox lo reserva para su ayuda)
 *  - Paleta rápida: tecla "/" abre un menú type-to-search con secciones y
 *    acciones de la página; se escribe para filtrar, flechas para moverse,
 *    Enter para ejecutar (estilo videojuego)
 *  - Modo POS: cursor de teclado sobre la galería (↑↓←→ mueven, Enter
 *    agrega, 0-9 fijan cantidad, Esc limpia); F2/"/" buscar, Ctrl+Enter
 *    cobrar, Ctrl+M monto, Ctrl+Alt+D descuento, Ctrl+Shift+S suspender,
 *    F8 historial, F9 pantalla cliente, Ctrl+Shift+X vaciar (doble pulso)
 *    (se eliminaron F5/F6/F10: están reservados por el navegador)
 *  - Páginas sin POS: ↑↓ mueven un cursor sobre los items del menú
 *    lateral, Enter navega (como un menú de videojuego)
 *  - Badges de tecla en botones clave y panel de ayuda con la lista
 *  - Botón flotante de ayuda (FAB) en todas las páginas
 *
 * Se inyecta desde sidebar-loader.js en TODAS las páginas del menú; el
 * modo POS solo se activa en sales.html. El CSS se auto-carga.
 */
(function () {
  'use strict';
  if (window.__keyboardNavLoaded) return;
  window.__keyboardNavLoaded = true;

  // ============================================================
  // 1. Navegación entre secciones — Ctrl+1..7 / Ctrl+Shift / Alt
  // ============================================================
  const PAGES = [
    { key: '1', href: 'dashboard.html', icon: 'fa-chart-line', text: 'Dashboard' },
    { key: '2', href: 'sales.html', icon: 'fa-cash-register', text: 'Punto de Venta' },
    { key: '3', href: 'inventory.html', icon: 'fa-box', text: 'Inventario' },
    { key: '4', href: 'customers.html', icon: 'fa-users', text: 'Clientes' },
    { key: '5', href: 'promotions.html', icon: 'fa-tags', text: 'Promociones' },
    { key: '6', href: 'finance.html', icon: 'fa-wallet', text: 'Finanzas' },
    { key: '7', href: 'reports.html', icon: 'fa-chart-bar', text: 'Reportes' }
  ];

  function currentPage() {
    return (window.location.pathname.split('/').pop() || 'index.html');
  }

  function goToPage(href) {
    if (currentPage() === href) return;
    window.location.href = href;
  }

  function handlePageShortcut(e) {
    if (!/^[1-7]$/.test(e.key)) return false;
    const isCtrl = e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
    const isCtrlShift = e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey;
    const isAlt = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    if (!isCtrl && !isCtrlShift && !isAlt) return false;
    const page = PAGES.find(p => p.key === e.key);
    if (!page) return false;
    e.preventDefault();
    e.stopPropagation();
    goToPage(page.href);
    return true;
  }

  // ============================================================
  // 2. Detección del modo POS (diferida: el DOM puede no estar listo)
  // ============================================================
  function posElements() {
    return {
      gallery: document.getElementById('productGallery'),
      results: document.getElementById('searchResults')
    };
  }

  function isPosPage() {
    return !!document.getElementById('productGallery');
  }

  let cursorIndex = -1;      // índice dentro de visibleItems()
  let qtyBuffer = '';        // cantidad tecleada (ej. "3")
  let hintEl = null;
  let helpOverlay = null;
  let paletteOverlay = null;
  let paletteIndex = 0;
  let paletteItems = [];
  let vaciarArmed = false;   // doble-pulso vaciar
  let fabEl = null;

  function isModalOpen() {
    const modals = document.querySelectorAll('.modal-overlay:not(.hidden), dialog[open]');
    for (const m of modals) {
      if (m.id === 'productContextMenu') continue;
      return true;
    }
    return false;
  }

  function isEditableFocus() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  // Items visibles actualmente (galería o resultados de búsqueda)
  function visibleItems() {
    const { gallery, results } = posElements();
    if (results && !results.classList.contains('hidden')) {
      return Array.from(results.querySelectorAll('.gallery-item'));
    }
    if (gallery && gallery.style.display !== 'none') {
      return Array.from(gallery.querySelectorAll('.gallery-item'));
    }
    return [];
  }

  function clampIndex(i, len) {
    if (len === 0) return -1;
    if (i < 0) return 0;
    if (i >= len) return len - 1;
    return i;
  }

  // Calcula el número de columnas del grid según las posiciones reales
  function gridCols() {
    const items = visibleItems();
    if (items.length < 2) return 1;
    const r0 = items[0].getBoundingClientRect();
    let cols = 1;
    for (let i = 1; i < items.length; i++) {
      const ri = items[i].getBoundingClientRect();
      if (Math.abs(ri.top - r0.top) < 4) cols++;
      else break;
    }
    return cols;
  }

  function selectIndex(i) {
    const items = visibleItems();
    const len = items.length;
    if (len === 0) {
      clearCursor();
      return;
    }
    const ni = clampIndex(i, len);
    cursorIndex = ni;
    items.forEach((el, idx) => el.classList.toggle('kbd-selected', idx === ni));
    const el = items[ni];
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    renderQtyBadge();
    showGalleryHint();
  }

  function moveCursor(dx, dy) {
    const items = visibleItems();
    if (items.length === 0) return;
    if (cursorIndex < 0) { selectIndex(0); return; }
    const cols = gridCols();
    const ni = cursorIndex + dx + dy * cols;
    selectIndex(ni);
  }

  function clearCursor() {
    visibleItems().forEach(el => el.classList.remove('kbd-selected'));
    cursorIndex = -1;
    qtyBuffer = '';
    renderQtyBadge();
  }

  // Badge "×N" sobre el item seleccionado mientras se teclea cantidad
  function renderQtyBadge() {
    const items = visibleItems();
    items.forEach(el => {
      const b = el.querySelector('.kbd-qty-badge');
      if (b) b.remove();
    });
    if (!qtyBuffer || cursorIndex < 0) return;
    const el = items[cursorIndex];
    if (!el) return;
    const badge = document.createElement('span');
    badge.className = 'kbd-qty-badge';
    badge.textContent = '\u00d7' + qtyBuffer;
    el.appendChild(badge);
  }

  function addSelected() {
    const items = visibleItems();
    if (items.length === 0) return;
    const idx = cursorIndex >= 0 ? cursorIndex : 0;
    const el = items[idx];
    if (!el) return;
    const prod = {
      product_id: parseInt(el.getAttribute('data-id'), 10),
      product_name: (el.querySelector('h4, .g-name') || {}).textContent || 'Producto',
      unit_price: parseFloat(el.getAttribute('data-price')),
      image_path: el.getAttribute('data-image'),
      stock_quantity: el.getAttribute('data-stock'),
      is_bulk: parseInt(el.getAttribute('data-is_bulk'), 10) || 0,
      bulk_unit: el.getAttribute('data-bulk_unit') || 'kg',
      category_id: el.getAttribute('data-category') || undefined
    };
    const qty = parseInt(qtyBuffer, 10);
    const q = (!qtyBuffer || isNaN(qty) || qty < 1) ? 1 : qty;
    qtyBuffer = '';

    if (prod.is_bulk == 1) {
      if (typeof promptBulkQuantity === 'function') promptBulkQuantity(prod);
    } else {
      kbdAddProduct(prod, q);
    }
    selectIndex(cursorIndex >= 0 ? cursorIndex : 0);
  }

  // Agrega q unidades respetando stock, con la MISMA lógica que
  // _addToCartInternal pero en una sola operación (para teclado rápido).
  function kbdAddProduct(prod, q) {
    if (typeof CART === 'undefined') return;
    const existing = CART.find(i => i.product_id === prod.product_id);
    const maxStock = (prod.stock_quantity !== undefined && prod.stock_quantity !== null && prod.stock_quantity !== '')
      ? parseInt(prod.stock_quantity, 10) : null;
    const currentQty = existing ? existing.quantity : 0;

    if (maxStock !== null && (currentQty + q) > maxStock) {
      if (typeof showNotification === 'function') showNotification(`Stock insuficiente. Disponible: ${maxStock}`, 'error');
      if (typeof playSound === 'function') playSound('Error.mp3');
      return;
    }

    if (existing) {
      existing.quantity += q;
      if (typeof recalcItemPrice === 'function') recalcItemPrice(existing);
    } else {
      CART.push({
        product_id: prod.product_id,
        product_name: prod.product_name,
        unit_price: prod.unit_price,
        original_price: prod.unit_price,
        quantity: q,
        subtotal: prod.unit_price * q,
        image_path: prod.image_path,
        discount_type: 'none',
        discount_value: 0,
        nxn_buy: 0,
        nxn_pay: 0,
        stock_quantity: maxStock,
        is_bulk: prod.is_bulk || 0,
        bulk_unit: prod.bulk_unit || 'kg',
        category_id: prod.category_id
      });
    }
    if (typeof playSound === 'function') playSound('Sound2.mp3');
    if (typeof renderCart === 'function') renderCart();
    if (typeof showNotification === 'function') showNotification('Producto añadido', 'success');
  }

  // ============================================================
  // 3. Hint flotante de la galería (se muestra al usar teclado)
  // ============================================================
  function showGalleryHint() {
    if (hintEl) {
      hintEl.classList.add('show');
      return;
    }
    hintEl = document.createElement('div');
    hintEl.className = 'kbd-gallery-hint';
    hintEl.innerHTML =
      '<span>Navega</span><kbd>\u2190</kbd><kbd>\u2191</kbd><kbd>\u2193</kbd><kbd>\u2192</kbd>' +
      '<span>Agrega</span><kbd>Enter</kbd>' +
      '<span>Cantidad</span><kbd>0-9</kbd>' +
      '<span>Ayuda</span><kbd>Ctrl+/</kbd>';
    const { gallery, results } = posElements();
    const cont = gallery || results;
    if (cont && cont.parentNode) cont.parentNode.appendChild(hintEl);
    requestAnimationFrame(() => hintEl && hintEl.classList.add('show'));
  }

  // ============================================================
  // 4. Atajos de acción del POS
  //    - Ctrl+ combinaciones (seguras en navegadores)
  //    - Teclas directas cuando hay un item seleccionado (cursor
  //      activo): D descuento, M monto, S suspender, P pantalla,
  //      H historial, X vaciar — estilo videojuego
  //    - Sin cursor activo: las letras FILTRAN la galería
  //      (type-to-search directo, sin necesidad de "/")
  //    (F5/F6/F10/F3 eliminados: reservados por el navegador)
  // ============================================================
  function handlePosShortcut(e) {
    if (!isPosPage()) return false;
    const ctrl = e.ctrlKey && !e.metaKey && !e.altKey;
    const ctrlShift = e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey;

    // Ctrl+Enter: cobrar (alias de F4 legacy en sales.js)
    if (ctrl && e.key === 'Enter') {
      e.preventDefault();
      const btn = document.getElementById('finalizeSaleBtn');
      if (btn && !btn.disabled) btn.click();
      return true;
    }
    // Ctrl+Shift+X: vaciar carrito (doble pulso)
    if (ctrlShift && (e.key === 'x' || e.key === 'X')) {
      e.preventDefault();
      vaciarCarritoConConfirmacion();
      return true;
    }
    // F8: historial (seguro en navegadores)
    if (!ctrl && !e.altKey && !e.metaKey && e.key === 'F8') {
      e.preventDefault();
      const btn = document.getElementById('toggleHistoryBtn');
      if (btn) btn.click();
      return true;
    }
    // F9: pantalla cliente (seguro)
    if (!ctrl && !e.altKey && !e.metaKey && e.key === 'F9') {
      e.preventDefault();
      const btn = document.getElementById('toggleCustomerDisplayBtn');
      if (btn) btn.click();
      return true;
    }
    return false;
  }

  // Teclas directas de acción (solo con cursor activo) + filtro de letras
  let kbdFilter = ''; // filtro incremental de galería

  function posLetterActions(e) {
    if (!isPosPage() || isEditableFocus() || isModalOpen()) return false;
    if (e.ctrlKey || e.altKey || e.metaKey) return false;
    const key = e.key.toLowerCase();

    // Backspace: quitar último carácter del filtro
    if (e.key === 'Backspace') {
      if (kbdFilter) {
        e.preventDefault();
        kbdFilter = kbdFilter.slice(0, -1);
        applyKbdFilter();
        return true;
      }
      return false;
    }

    // Teclas de acción: SOLO si hay cursor activo (modo juego)
    if (cursorIndex >= 0) {
      const actions = {
        d: () => focusInput('discountInput'),
        m: () => focusInput('checkoutReceived'),
        s: () => { if (typeof parkCurrentSale === 'function') parkCurrentSale(); },
        p: () => { const b = document.getElementById('toggleCustomerDisplayBtn'); if (b) b.click(); },
        h: () => { const b = document.getElementById('toggleHistoryBtn'); if (b) b.click(); },
        x: () => vaciarCarritoConConfirmacion()
      };
      if (actions[key]) {
        e.preventDefault();
        actions[key]();
        return true;
      }
    }

    // Letras (y espacio): filtro incremental de la galería
    if (/^[a-záéíóúñü ]$/i.test(key) || e.key === ' ') {
      if (key.length === 1) {
        e.preventDefault();
        kbdFilter += key;
        applyKbdFilter();
        return true;
      }
    }
    return false;
  }

  function focusInput(id) {
    const el = document.getElementById(id);
    if (!el) return;
    // Si el campo vive en la pestaña Ajustes (oculta por defecto),
    // activar esa pestaña primero — focus() en display:none no funciona
    const adjTab = el.closest('#tab-adjustments');
    if (adjTab) {
      const tabBtn = document.querySelector('.panel-tab-btn[data-tab="adjustments"]');
      if (tabBtn && !tabBtn.classList.contains('active')) {
        tabBtn.click();
        setTimeout(() => { el.focus(); el.select(); }, 80);
        return;
      }
    }
    el.focus();
    el.select();
  }

  function applyKbdFilter() {
    const term = kbdFilter.trim().toLowerCase();
    // Mostrar/ocultar badge de filtro
    let badge = document.querySelector('.kbd-filter-badge');
    if (!term) {
      if (badge) badge.remove();
      if (typeof filterAndRenderProducts === 'function') filterAndRenderProducts();
      return;
    }
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'kbd-filter-badge';
      badge.innerHTML = '<span></span><button class="kbd-filter-clear" title="Limpiar filtro (Esc)">\u00d7</button>';
      const { gallery, results } = posElements();
      const cont = gallery || results;
      if (cont && cont.parentNode) cont.parentNode.appendChild(badge);
      badge.querySelector('.kbd-filter-clear').addEventListener('click', () => {
        kbdFilter = '';
        applyKbdFilter();
      });
    }
    badge.querySelector('span').textContent = 'Filtrando: ' + kbdFilter;

    // Filtrar productos por nombre (usa la lista global de sales.js)
    if (typeof allProducts === 'undefined') return;
    const filtered = allProducts.filter(p =>
      (p.product_name || '').toLowerCase().includes(term)
    );
    if (typeof renderGallery === 'function') renderGallery(filtered);
    if (cursorIndex < 0) selectIndex(0);
  }

  function clearKbdFilter() {
    kbdFilter = '';
    applyKbdFilter();
  }

  // Vaciar carrito con doble pulso: primero arma, segundo vacía
  function vaciarCarritoConConfirmacion() {
    if (typeof CART === 'undefined' || !CART.length) {
      vaciarArmed = false;
      if (typeof showNotification === 'function') showNotification('El carrito ya está vacío', 'info');
      return;
    }
    if (!vaciarArmed) {
      vaciarArmed = true;
      if (typeof showNotification === 'function') showNotification('Pulsa de nuevo para vaciar el carrito', 'warning');
      setTimeout(() => { vaciarArmed = false; }, 2500);
      return;
    }
    vaciarArmed = false;
    CART.length = 0;
    if (typeof MULTI_CARTS !== 'undefined') MULTI_CARTS[CURRENT_TAB || '1'] = [];
    try { localStorage.setItem('tomodachi_multi_carts', JSON.stringify(MULTI_CARTS)); } catch (e) {}
    if (typeof renderCart === 'function') renderCart();
    if (typeof playSound === 'function') playSound('Sound3.mp3');
    if (typeof showNotification === 'function') showNotification('Carrito vaciado', 'info');
  }

  // ============================================================
  // 5. Panel de ayuda de atajos (Ctrl+/ o "?") — TODAS las páginas
  // ============================================================
  function toggleHelp() {
    if (helpOverlay && helpOverlay.classList.contains('show')) closeHelp();
    else openHelp();
  }

  function helpGroups() {
    const pos = isPosPage();
    const groups = [];
    groups.push({
      title: 'Navegación',
      rows: [
        { keys: ['Ctrl', '1'], desc: '…<kbd>7</kbd> <span>(o Alt+1..7)</span> Cambiar de sección' },
        { keys: ['Ctrl', '/'], desc: 'Esta ayuda (en cualquier página)' },
        { keys: ['/'], desc: 'Paleta rápida: escribe para ir a secciones/acciones' },
        { keys: ['Esc'], desc: 'Cerrar modales / limpiar selección' }
      ]
    });
    if (pos) {
      groups.push({
        title: 'Punto de Venta',
        rows: [
          { keys: ['\u2190', '\u2191', '\u2193', '\u2192'], desc: 'Mover selección entre productos' },
          { keys: ['Enter'], desc: 'Agregar producto seleccionado' },
          { keys: ['0'], desc: '…<kbd>9</kbd> <span>Teclear cantidad (ej. 3 + Enter)</span>' },
          { keys: ['A-Z'], desc: 'Escribir filtra productos (sin cursor); con cursor activo:' },
          { keys: ['D'], desc: 'Descuento' },
          { keys: ['M'], desc: 'Monto recibido' },
          { keys: ['S'], desc: 'Suspender venta' },
          { keys: ['H'], desc: 'Historial de ventas' },
          { keys: ['P'], desc: 'Pantalla cliente' },
          { keys: ['X'], desc: 'Vaciar carrito (doble pulso)' },
          { keys: ['Ctrl', 'Enter'], desc: 'Cobrar venta' },
          { keys: ['F2'], desc: 'Buscar producto (o tecla /)' },
          { keys: ['F8'], desc: 'Historial (alternativa)' },
          { keys: ['F9'], desc: 'Pantalla cliente (alternativa)' }
        ]
      });
    }
    return groups;
  }

  function openHelp() {
    if (!helpOverlay) {
      helpOverlay = document.createElement('div');
      helpOverlay.className = 'kbd-help-overlay';
      helpOverlay.innerHTML = `
        <div class="kbd-help-panel" role="dialog" aria-modal="true" aria-label="Atajos de teclado">
          <div class="kbd-help-header">
            <h2><i class="fas fa-keyboard"></i> Atajos de teclado</h2>
            <button class="kbd-help-close" aria-label="Cerrar"><i class="fas fa-times"></i></button>
          </div>
          <div class="kbd-help-body" id="kbdHelpBody"></div>
          <div class="kbd-help-footer">Navega con teclado: el enfoque se muestra con un anillo de color. Pulsa / para la paleta rápida.</div>
        </div>`;
      document.body.appendChild(helpOverlay);
      const closeBtn = helpOverlay.querySelector('.kbd-help-close');
      if (closeBtn) closeBtn.addEventListener('click', closeHelp);
      helpOverlay.addEventListener('click', (e) => {
        if (e.target === helpOverlay) closeHelp();
      });
    }
    // Re-render grupos (contextuales)
    const body = helpOverlay.querySelector('#kbdHelpBody');
    if (body) {
      body.innerHTML = helpGroups().map(g => `
        <div class="kbd-help-group">
          <h3>${g.title}</h3>
          ${g.rows.map(r => `
            <div class="kbd-help-row">
              ${r.keys.map(k => `<kbd>${k}</kbd>`).join('')}
              <span>${r.desc}</span>
            </div>`).join('')}
        </div>`).join('');
    }
    helpOverlay.classList.add('show');
    const first = helpOverlay.querySelector('.kbd-help-close');
    if (first) first.focus();
  }

  function closeHelp() {
    if (helpOverlay) helpOverlay.classList.remove('show');
  }

  // ============================================================
  // 6. Paleta rápida (tecla "/"): type-to-search de secciones/acciones
  // ============================================================
  function paletteActions() {
    const actions = PAGES.map(p => ({
      icon: p.icon,
      text: p.text,
      shortcut: 'Ctrl+' + p.key,
      run: () => goToPage(p.href)
    }));
    if (isPosPage()) {
      actions.unshift(
        { icon: 'fa-search', text: 'Buscar producto', shortcut: 'F2 /', run: () => { const i = document.getElementById('searchInput'); if (i) i.focus(); } },
        { icon: 'fa-check-double', text: 'Cobrar venta', shortcut: 'Ctrl+Enter', run: () => { const b = document.getElementById('finalizeSaleBtn'); if (b && !b.disabled) b.click(); } },
        { icon: 'fa-money-bill-wave', text: 'Monto recibido', shortcut: 'M', run: () => focusInput('checkoutReceived') },
        { icon: 'fa-percent', text: 'Descuento', shortcut: 'D', run: () => focusInput('discountInput') },
        { icon: 'fa-pause-circle', text: 'Suspender venta', shortcut: 'S', run: () => { if (typeof parkCurrentSale === 'function') parkCurrentSale(); } },
        { icon: 'fa-history', text: 'Historial de ventas', shortcut: 'H', run: () => { const b = document.getElementById('toggleHistoryBtn'); if (b) b.click(); } },
        { icon: 'fa-tv', text: 'Pantalla cliente', shortcut: 'P', run: () => { const b = document.getElementById('toggleCustomerDisplayBtn'); if (b) b.click(); } },
        { icon: 'fa-trash-alt', text: 'Vaciar carrito', shortcut: 'X', run: vaciarCarritoConConfirmacion }
      );
    }
    return actions;
  }

  function openPalette() {
    if (!paletteOverlay) {
      paletteOverlay = document.createElement('div');
      paletteOverlay.className = 'kbd-palette-overlay';
      paletteOverlay.innerHTML = `
        <div class="kbd-palette" role="dialog" aria-modal="true" aria-label="Paleta rápida">
          <div class="kbd-palette-input-wrap">
            <i class="fas fa-search"></i>
            <input type="text" class="kbd-palette-input" placeholder="Escribe para ir a una sección o acción…" autocomplete="off">
            <span class="kbd-palette-hint" style="font-size:0.7rem;color:var(--text-muted);"><kbd>Esc</kbd> cerrar</span>
          </div>
          <div class="kbd-palette-list"></div>
        </div>`;
      document.body.appendChild(paletteOverlay);
      paletteOverlay.addEventListener('click', (e) => {
        if (e.target === paletteOverlay) closePalette();
      });
      const input = paletteOverlay.querySelector('.kbd-palette-input');
      input.addEventListener('input', () => { paletteIndex = 0; renderPalette(); });
      input.addEventListener('keydown', (e) => {
        e.stopPropagation(); // no dejar que el handler global lo procese
        if (e.key === 'Escape') { closePalette(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); movePalette(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); movePalette(-1); return; }
        if (e.key === 'Enter') { e.preventDefault(); runPalette(); return; }
      });
    }
    const input = paletteOverlay.querySelector('.kbd-palette-input');
    input.value = '';
    paletteIndex = 0;
    renderPalette();
    paletteOverlay.classList.add('show');
    setTimeout(() => input.focus(), 30);
  }

  function closePalette() {
    if (paletteOverlay) paletteOverlay.classList.remove('show');
  }

  function filteredPaletteItems() {
    const input = paletteOverlay ? paletteOverlay.querySelector('.kbd-palette-input') : null;
    const term = (input ? input.value : '').trim().toLowerCase();
    const all = paletteActions();
    if (!term) return all;
    return all.filter(a => a.text.toLowerCase().includes(term) || a.shortcut.toLowerCase().includes(term));
  }

  function renderPalette() {
    if (!paletteOverlay) return;
    const list = paletteOverlay.querySelector('.kbd-palette-list');
    const items = filteredPaletteItems();
    paletteItems = items;
    if (!items.length) {
      list.innerHTML = '<div class="kbd-palette-empty">Sin resultados</div>';
      return;
    }
    paletteIndex = clampIndex(paletteIndex, items.length);
    list.innerHTML = items.map((a, i) => `
      <div class="kbd-palette-item ${i === paletteIndex ? 'active' : ''}" data-i="${i}">
        <i class="fas ${a.icon}"></i>
        <span>${a.text}</span>
        <span class="kbd-palette-shortcut">${a.shortcut}</span>
      </div>`).join('');
    list.querySelectorAll('.kbd-palette-item').forEach(el => {
      el.addEventListener('click', () => { paletteIndex = parseInt(el.dataset.i, 10); runPalette(); });
      el.addEventListener('mousemove', () => {
        const i = parseInt(el.dataset.i, 10);
        if (i !== paletteIndex) { paletteIndex = i; renderPalette(); }
      });
    });
    const active = list.querySelector('.kbd-palette-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function movePalette(d) {
    const items = filteredPaletteItems();
    if (!items.length) return;
    paletteIndex = clampIndex(paletteIndex + d, items.length);
    renderPalette();
  }

  function runPalette() {
    const items = filteredPaletteItems();
    const item = items[paletteIndex];
    if (!item) return;
    closePalette();
    item.run();
  }

  // ============================================================
  // 7. Cursor de menú lateral (páginas sin POS): ↑↓ mueven, Enter va
  // ============================================================
  function sidebarLinks() {
    return Array.from(document.querySelectorAll('.sidebar-nav a[href]'));
  }

  let sidebarIndex = -1;

  function sidebarSelect(i) {
    const links = sidebarLinks();
    if (!links.length) return;
    const ni = clampIndex(i, links.length);
    sidebarIndex = ni;
    links.forEach((el, idx) => el.classList.toggle('kbd-selected', idx === ni));
    links[ni].scrollIntoView({ block: 'nearest' });
  }

  function sidebarClear() {
    sidebarLinks().forEach(el => el.classList.remove('kbd-selected'));
    sidebarIndex = -1;
  }

  function handleSidebarKeys(e) {
    if (isPosPage() || isEditableFocus() || isModalOpen()) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const links = sidebarLinks();
      if (!links.length) return false;
      e.preventDefault();
      if (sidebarIndex < 0) sidebarSelect(e.key === 'ArrowDown' ? 0 : links.length - 1);
      else sidebarSelect(sidebarIndex + (e.key === 'ArrowDown' ? 1 : -1));
      return true;
    }
    if (e.key === 'Enter' && sidebarIndex >= 0) {
      const links = sidebarLinks();
      if (links[sidebarIndex]) {
        e.preventDefault();
        const href = links[sidebarIndex].getAttribute('href');
        if (href && !href.startsWith('#')) goToPage(href);
      }
      return true;
    }
    return false;
  }

  // ============================================================
  // 8. Badges de tecla en botones clave del POS
  // ============================================================
  function injectKeyBadges() {
    if (!isPosPage()) return;
    const addBadge = (btn, label) => {
      if (!btn) return;
      if (btn.querySelector('.key-badge')) return;
      const b = document.createElement('span');
      b.className = 'key-badge';
      b.textContent = label;
      btn.appendChild(b);
    };
    addBadge(document.getElementById('finalizeSaleBtn'), 'Ctrl+Enter');
    addBadge(document.getElementById('toggleHistoryBtn'), 'F8');
    addBadge(document.getElementById('toggleCustomerDisplayBtn'), 'F9');
  }

  // ============================================================
  // 9. Botón flotante de ayuda (FAB) — todas las páginas
  // ============================================================
  function ensureFab() {
    if (fabEl || document.querySelector('.kbd-fab')) return;
    // No mostrar en login/landing (no hay menú)
    if (!document.querySelector('.sidebar-nav')) return;
    fabEl = document.createElement('button');
    fabEl.className = 'kbd-fab';
    fabEl.title = 'Atajos de teclado (Ctrl+/)';
    fabEl.setAttribute('aria-label', 'Atajos de teclado');
    fabEl.innerHTML = '<i class="fas fa-keyboard"></i>';
    fabEl.addEventListener('click', toggleHelp);
    document.body.appendChild(fabEl);
  }

  // ============================================================
  // 10. Handler global de teclado
  // ============================================================
  document.addEventListener('keydown', (e) => {
    // Paleta abierta: el input maneja sus propias teclas; aquí solo
    // cerramos con Esc si el foco no está en el input
    if (paletteOverlay && paletteOverlay.classList.contains('show')) {
      if (e.key === 'Escape' && !isEditableFocus()) {
        e.preventDefault();
        closePalette();
      }
      return;
    }

    // Ayuda abierta: SOLO Escape la cierra
    if (helpOverlay && helpOverlay.classList.contains('show')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeHelp();
      }
      return;
    }

    // Ctrl+/ o ? → ayuda (en TODAS las páginas)
    if ((e.ctrlKey && e.key === '/') || (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey)) {
      e.preventDefault();
      toggleHelp();
      return;
    }

    // Tecla "/" → paleta rápida (en todas las páginas); en el POS "/"
    // enfoca la búsqueda directamente (estándar de videojuegos)
    if (e.key === '/' && !e.ctrlKey && !e.altKey && !e.metaKey && !isEditableFocus()) {
      e.preventDefault();
      if (isPosPage()) {
        const si = document.getElementById('searchInput');
        if (si) { si.focus(); si.select(); }
      } else {
        openPalette();
      }
      return;
    }

    // 10.1 Navegación entre secciones
    if (handlePageShortcut(e)) return;

    // 10.2 Atajos de acción del POS (Ctrl+Enter, Ctrl+Shift+X, F8, F9)
    if (handlePosShortcut(e)) return;

    // 10.3 Páginas sin POS: cursor de menú lateral
    if (handleSidebarKeys(e)) return;

    if (!isPosPage()) return;

    // 10.4 Cursor de galería del POS
    if (isModalOpen()) return;

    const editable = isEditableFocus();

    // Escape: limpiar filtro/buffer/selección; si no hay nada, sales.js
    if (e.key === 'Escape') {
      // Si el foco está en un input del POS (monto/descuento/impuesto),
      // Esc sale del campo y devuelve el control a la galería (estilo
      // videojuego). searchInput lo maneja sales.js (limpia y blur).
      const ae = document.activeElement;
      if (ae && ['checkoutReceived', 'discountInput', 'taxInput', 'apartadoPaidInput'].includes(ae.id)) {
        e.preventDefault();
        ae.blur();
        return;
      }
      if (kbdFilter) {
        e.preventDefault();
        clearKbdFilter();
        return;
      }
      if (qtyBuffer) {
        e.preventDefault();
        qtyBuffer = '';
        renderQtyBadge();
        return;
      }
      if (cursorIndex >= 0) {
        e.preventDefault();
        clearCursor();
        return;
      }
      return;
    }

    // Teclas directas: acción (con cursor) o filtro incremental de letras
    if (posLetterActions(e)) return;

    // Flechas de navegación de la galería
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const activeEl = document.activeElement;
      const inSearch = activeEl && activeEl.id === 'searchInput';
      const inResults = (posElements().results && !posElements().results.classList.contains('hidden'));
      if (editable && !(inSearch && inResults)) return;
      e.preventDefault();
      const dx = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      const dy = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      moveCursor(dx, dy);
      return;
    }

    // Enter: agregar seleccionado
    if (e.key === 'Enter') {
      const activeEl = document.activeElement;
      const tag = activeEl ? activeEl.tagName : '';
      if (tag === 'BUTTON' || tag === 'A' || tag === 'SELECT') return;
      if (editable && !(activeEl && activeEl.id === 'searchInput')) return;
      e.preventDefault();
      addSelected();
      return;
    }

    // Números: acumular cantidad (solo fuera de inputs)
    if (!editable && /^[0-9]$/.test(e.key)) {
      e.preventDefault();
      if (qtyBuffer.length < 3) qtyBuffer += e.key;
      if (cursorIndex < 0) selectIndex(0);
      else renderQtyBadge();
      return;
    }
  });

  // Clic en un producto → activa selección ahí
  document.addEventListener('click', (e) => {
    const item = e.target.closest('.gallery-item');
    if (!item || !isPosPage()) return;
    const items = visibleItems();
    const idx = items.indexOf(item);
    if (idx >= 0) {
      cursorIndex = idx;
      items.forEach((el, i) => el.classList.toggle('kbd-selected', i === idx));
    }
  });

  // ============================================================
  // 11. Arranque
  // ============================================================
  function loadCss() {
    if (!document.querySelector('link[href="css/keyboard-nav.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'css/keyboard-nav.css';
      document.head.appendChild(link);
    }
  }

  function init() {
    loadCss();
    injectKeyBadges();
    ensureFab();
    // El body debe poder recibir foco para que las teclas directas
    // funcionen después de hacer clic en zonas vacías (estilo videojuego)
    document.body.setAttribute('tabindex', '-1');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  try { loadCss(); } catch (e) {}
})();
