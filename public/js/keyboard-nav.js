/**
 * keyboard-nav.js — Atajos de teclado estilo videojuego para Tomodachi
 *
 * Incluye:
 *  - Navegación entre secciones: Alt+1..7 (Dashboard, POS, Inventario, ...)
 *    y variantes Ctrl+Alt+1..7 / Ctrl+Shift+1..7 (compatibilidad Firefox)
 *  - Modo POS: cursor de teclado sobre la galería (↑↓←→ mueven, Enter agrega,
 *    números fijan cantidad, Esc limpia)
 *  - Atajos F: F1 ayuda, F3 categoría, F5 monto recibido, F6 descuento,
 *    F8 historial, F9 pantalla cliente, F10 vaciar carrito
 *    (F2 búsqueda / F4 cobrar / F7 suspender ya viven en sales.js)
 *  - Badges de tecla en botones clave y panel de ayuda con la lista completa
 *
 * Se inyecta desde sidebar-loader.js en TODAS las páginas del menú; el
 * modo POS solo se activa en sales.html. El CSS se auto-carga.
 */
(function () {
  'use strict';
  if (window.__keyboardNavLoaded) return;
  window.__keyboardNavLoaded = true;

  // ============================================================
  // 1. Navegación entre secciones — Alt+1..7 (+ variantes)
  // ============================================================
  const PAGES = [
    { key: '1', href: 'dashboard.html', text: 'Dashboard' },
    { key: '2', href: 'sales.html', text: 'Punto de Venta' },
    { key: '3', href: 'inventory.html', text: 'Inventario' },
    { key: '4', href: 'customers.html', text: 'Clientes' },
    { key: '5', href: 'promotions.html', text: 'Promociones' },
    { key: '6', href: 'finance.html', text: 'Finanzas' },
    { key: '7', href: 'reports.html', text: 'Reportes' }
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
    const isAlt = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    const isCtrlAlt = e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey;
    const isCtrlShift = e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey;
    if (!isAlt && !isCtrlAlt && !isCtrlShift) return false;
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
  let vaciarArmed = false;   // doble-pulso F10

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
    // Mantener la selección visual
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
      '<span>Ayuda</span><kbd>F1</kbd>';
    const { gallery, results } = posElements();
    const cont = gallery || results;
    if (cont && cont.parentNode) cont.parentNode.appendChild(hintEl);
    requestAnimationFrame(() => hintEl && hintEl.classList.add('show'));
  }

  // ============================================================
  // 4. Atajos F específicos del POS (los no cubiertos por sales.js)
  // ============================================================
  function handlePosShortcut(e) {
    if (!isPosPage() || e.ctrlKey || e.metaKey || e.altKey) return false;
    switch (e.key) {
      case 'F1':
        e.preventDefault();
        toggleHelp();
        return true;
      case 'F3': {
        e.preventDefault();
        const cat = document.getElementById('categoryFilter');
        if (cat) { cat.focus(); cat.scrollIntoView({ block: 'nearest' }); }
        return true;
      }
      case 'F5': {
        e.preventDefault();
        const rec = document.getElementById('checkoutReceived');
        if (rec) { rec.focus(); rec.select(); }
        return true;
      }
      case 'F6': {
        e.preventDefault();
        const disc = document.getElementById('discountInput');
        if (disc) { disc.focus(); disc.select(); }
        return true;
      }
      case 'F8': {
        e.preventDefault();
        const btn = document.getElementById('toggleHistoryBtn');
        if (btn) btn.click();
        return true;
      }
      case 'F9': {
        e.preventDefault();
        const btn = document.getElementById('toggleCustomerDisplayBtn');
        if (btn) btn.click();
        return true;
      }
      case 'F10': {
        e.preventDefault();
        vaciarCarritoConConfirmacion();
        return true;
      }
      default:
        return false;
    }
  }

  // F10 con doble-pulso: primero arma, segundo vacía (evita accidentes)
  function vaciarCarritoConConfirmacion() {
    if (typeof CART === 'undefined' || !CART.length) {
      vaciarArmed = false;
      if (typeof showNotification === 'function') showNotification('El carrito ya está vacío', 'info');
      return;
    }
    if (!vaciarArmed) {
      vaciarArmed = true;
      if (typeof showNotification === 'function') showNotification('F10 de nuevo para vaciar el carrito', 'warning');
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
  // 5. Panel de ayuda (F1)
  // ============================================================
  function toggleHelp() {
    if (helpOverlay && helpOverlay.classList.contains('show')) {
      closeHelp();
    } else {
      openHelp();
    }
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
          <div class="kbd-help-body">
            <div class="kbd-help-group">
              <h3>Navegación</h3>
              <div class="kbd-help-row"><kbd>Alt</kbd><kbd>1</kbd>…<kbd>7</kbd><span>Cambiar de sección (Dashboard, POS, Inventario…)</span></div>
              <div class="kbd-help-row"><kbd>F1</kbd><span>Esta ayuda</span></div>
              <div class="kbd-help-row"><kbd>Esc</kbd><span>Cerrar modales / limpiar selección</span></div>
            </div>
            <div class="kbd-help-group">
              <h3>Punto de Venta</h3>
              <div class="kbd-help-row"><kbd>\u2190</kbd><kbd>\u2191</kbd><kbd>\u2193</kbd><kbd>\u2192</kbd><span>Mover selección entre productos</span></div>
              <div class="kbd-help-row"><kbd>Enter</kbd><span>Agregar producto seleccionado</span></div>
              <div class="kbd-help-row"><kbd>0</kbd>…<kbd>9</kbd><span>Teclear cantidad (ej. 3 + Enter)</span></div>
              <div class="kbd-help-row"><kbd>F2</kbd><span>Buscar producto</span></div>
              <div class="kbd-help-row"><kbd>F3</kbd><span>Filtrar por categoría</span></div>
              <div class="kbd-help-row"><kbd>F4</kbd><span>Cobrar venta</span></div>
              <div class="kbd-help-row"><kbd>F5</kbd><span>Monto recibido</span></div>
              <div class="kbd-help-row"><kbd>F6</kbd><span>Descuento</span></div>
              <div class="kbd-help-row"><kbd>F7</kbd><span>Suspender venta</span></div>
              <div class="kbd-help-row"><kbd>F8</kbd><span>Historial de ventas</span></div>
              <div class="kbd-help-row"><kbd>F9</kbd><span>Pantalla cliente</span></div>
              <div class="kbd-help-row"><kbd>F10</kbd><span>Vaciar carrito (doble pulso)</span></div>
            </div>
          </div>
          <div class="kbd-help-footer">Todo se controla sin mouse. El enfoque se muestra con un anillo de color.</div>
        </div>`;
      document.body.appendChild(helpOverlay);
      const closeBtn = helpOverlay.querySelector('.kbd-help-close');
      if (closeBtn) closeBtn.addEventListener('click', closeHelp);
      helpOverlay.addEventListener('click', (e) => {
        if (e.target === helpOverlay) closeHelp();
      });
    }
    helpOverlay.classList.add('show');
    const first = helpOverlay.querySelector('.kbd-help-close');
    if (first) first.focus();
  }

  function closeHelp() {
    if (helpOverlay) helpOverlay.classList.remove('show');
  }

  // ============================================================
  // 6. Badges de tecla en botones clave del POS
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
    addBadge(document.getElementById('finalizeSaleBtn'), 'F4');
    addBadge(document.getElementById('toggleHistoryBtn'), 'F8');
    addBadge(document.getElementById('toggleCustomerDisplayBtn'), 'F9');
  }

  // ============================================================
  // 7. Handler global de teclado
  // ============================================================
  document.addEventListener('keydown', (e) => {
    // 7.1 Navegación entre secciones (funciona en todas las páginas)
    if (handlePageShortcut(e)) return;

    // 7.2 Atajos F del POS
    if (handlePosShortcut(e)) return;

    if (!isPosPage()) return;

    // 7.3 Cursor de galería (solo cuando no hay modal ni campo editable)
    if (isModalOpen()) return;

    // Si la ayuda está abierta, SOLO Escape la cierra (y detiene al resto)
    if (helpOverlay && helpOverlay.classList.contains('show')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeHelp();
      }
      return;
    }

    const editable = isEditableFocus();

    // Escape: prioridad a cerrar ayuda; luego limpiar buffer/selección.
    // Si no hay nada que limpiar, dejar que sales.js haga su Esc.
    if (e.key === 'Escape') {
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
      return; // sales.js maneja el resto
    }

    // Flechas de navegación: SOLO fuera de campos editables, o dentro del
    // buscador cuando hay resultados (navegar resultados con ↑↓)
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const activeEl = document.activeElement;
      const inSearch = activeEl && activeEl.id === 'searchInput';
      const inResults = (posElements().results && !posElements().results.classList.contains('hidden'));
      if (editable && !(inSearch && inResults)) return; // respetar inputs normales
      e.preventDefault();
      const dx = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      const dy = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      moveCursor(dx, dy);
      return;
    }

    // Enter: agregar seleccionado. Si el cursor no está activo, agrega el
    // primer producto visible (velocidad de cajero). Respetar botones
    // enfocados (dejar que Enter los active nativamente).
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

  // Clic en un producto → activa selección ahí (para que el teclado
  // continúe desde donde el usuario hizo clic). Se registra siempre;
  // en páginas sin galería el closest() simplemente no encuentra nada.
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
  // 8. Arranque
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
  }

  // Cargar CSS cuanto antes (puede estar en <head> si el script se
  // inyecta ahí) o al DOMContentLoaded.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // Intento temprano por si el head ya existe
  try { loadCss(); } catch (e) {}
})();
