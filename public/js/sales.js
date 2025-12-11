/**
 * Lógica de Punto de Venta (Carrito y Venta) - Versión Simplificada
 */
let CART = [];
let MULTI_CARTS = { '1': [], '2': [], '3': [], '4': [] }; // Soporte para múltiples carritos
let CURRENT_TAB = '1';

let CURRENT_STORE_ID = null;
let allProducts = [];
let allCategories = [];
let activeCategoryId = null;
let categoryBar;
let isCatDragging = false;
let catDragStartX = null;
let catScrollStart = 0;
let PARKED_SALES = []; // Nueva variable para ventas suspendidas

// Variables globales para elementos DOM
let searchInput, searchResults, cartBody, emptyCartMsg;
let totalBadge, cartBadge, discountInput, taxInput, paymentMethodSelect;
let checkoutReceivedInput, checkoutChangeDisplay, finalizeSaleBtn;
let cartToggle, cartPanel, closeCartBtn, productGallery, cartHandleBtn, panelTotalEl;

// Modal elements
let itemOptionsModal, closeItemModalBtn, saveItemOptionsBtn;
let modalProductName, modalOriginalPrice, modalNewPrice;
let discountTypeSelect, discPercentInput, discFixedInput, nxnBuyInput, nxnPayInput;
let optPercent, optFixed, optNxn;

let EDITING_PRODUCT_ID = null;

function initPOS() {
  // Inicializar referencias a elementos DOM
  searchInput = document.getElementById('searchInput');
  searchResults = document.getElementById('searchResults');
  cartBody = document.getElementById('cartBody');
  emptyCartMsg = document.getElementById('emptyCartMsg');
  totalBadge = document.getElementById('totalBadge');
  cartBadge = document.getElementById('cartCountBadge');
  discountInput = document.getElementById('discountInput');
  taxInput = document.getElementById('taxInput');
  paymentMethodSelect = document.getElementById('paymentMethod');
  checkoutReceivedInput = document.getElementById('checkoutReceived');
  checkoutChangeDisplay = document.getElementById('checkoutChange');
  finalizeSaleBtn = document.getElementById('finalizeSaleBtn');
  cartToggle = document.getElementById('cartToggle');
  cartPanel = document.getElementById('cartPanel');
  closeCartBtn = document.getElementById('closeCartBtn');
  productGallery = document.getElementById('productGallery');
  categoryBar = document.getElementById('categoryBar');
  cartHandleBtn = document.getElementById('cartHandle');
  panelTotalEl = document.getElementById('panelTotal');

  // Modal elements init
  itemOptionsModal = document.getElementById('itemOptionsModal');
  closeItemModalBtn = document.getElementById('closeItemModalBtn');
  saveItemOptionsBtn = document.getElementById('saveItemOptionsBtn');
  modalProductName = document.getElementById('modalProductName');
  modalOriginalPrice = document.getElementById('modalOriginalPrice');
  modalNewPrice = document.getElementById('modalNewPrice');
  discountTypeSelect = document.getElementById('discountTypeSelect');
  discPercentInput = document.getElementById('discPercentInput');
  discFixedInput = document.getElementById('discFixedInput');
  nxnBuyInput = document.getElementById('nxnBuyInput');
  nxnPayInput = document.getElementById('nxnPayInput');
  optPercent = document.getElementById('opt-percent');
  optFixed = document.getElementById('opt-fixed');
  optNxn = document.getElementById('opt-nxn');

  // Obtener store_id del atributo de datos en el body
  CURRENT_STORE_ID = document.body.getAttribute('data-store-id') || 1;

  // Ahora vinculamos eventos
  bindEvents();

  // Inyectar interfaz de pestañas si no existe
  injectCartTabsUI();
  injectHistorySidebar();

  // Inyectar Sidebar de Historial
  // injectHistorySidebar(); // Ya llamado arriba

  // Persistencia: Cargar carritos guardados (Sistema Multi-Tab)
  const savedCarts = localStorage.getItem('tomodachi_multi_carts');
  if (savedCarts) {
    try {
      MULTI_CARTS = JSON.parse(savedCarts);
    } catch (e) {
      console.error('Error cargando carritos guardados', e);
      localStorage.removeItem('tomodachi_multi_carts');
    }
  } else {
    // Migración: Si existe un carrito antiguo simple, moverlo al tab 1
    const oldCart = localStorage.getItem('tomodachi_cart');
    if (oldCart) {
      try {
        MULTI_CARTS['1'] = JSON.parse(oldCart);
        localStorage.removeItem('tomodachi_cart');
      } catch (e) { }
    }
  }

  // Recuperar pestaña activa
  const savedTab = localStorage.getItem('tomodachi_current_tab');
  if (savedTab && MULTI_CARTS[savedTab]) {
    CURRENT_TAB = savedTab;
  }

  // Inicializar carrito actual
  CART = MULTI_CARTS[CURRENT_TAB] || [];

  // Actualizar UI inicial de pestañas
  document.querySelectorAll('.cart-tab-btn').forEach(btn => {
    const t = btn.getAttribute('data-tab');
    if (t === CURRENT_TAB) btn.classList.add('active');
    else btn.classList.remove('active');
    updateTabBadge(t);
  });

  renderCart();

  // Cargar ventas suspendidas
  const savedParked = localStorage.getItem('tomodachi_parked_sales');
  if (savedParked) {
    try {
      PARKED_SALES = JSON.parse(savedParked);
      updateParkedSalesIndicator();
    } catch (e) {
      console.error('Error cargando ventas suspendidas', e);
    }
  }

  loadCategoriesAndProducts();
}

function bindEvents() {
  // Búsqueda con debounce
  let debounceTimer;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const term = searchInput.value.trim();
      if (!term) {
        if (searchResults) searchResults.classList.add('hidden');
        if (productGallery) productGallery.style.display = 'grid';
        return;
      }
      debounceTimer = setTimeout(() => searchProducts(term), 300);
    });
  }

  // Carrito toggle
  if (cartToggle) {
    cartToggle.addEventListener('click', () => {
      toggleCartPanel();
    });
  }

  if (closeCartBtn && cartPanel) {
    closeCartBtn.addEventListener('click', () => {
      cartPanel.classList.remove('open');
      cartPanel.setAttribute('aria-hidden', 'true');
    });
  }

  if (cartHandleBtn) {
    cartHandleBtn.addEventListener('click', () => toggleCartPanel());
    // Drag para abrir/cerrar
    let startX = null, dragging = false;
    const onDown = (e) => { startX = (e.touches ? e.touches[0].clientX : e.clientX); dragging = true; };
    const onMove = (e) => {
      if (!dragging) return;
      const x = (e.touches ? e.touches[0].clientX : e.clientX);
      const dx = startX - x; // positivo al arrastrar hacia la izquierda
      if (!cartPanel.classList.contains('open') && dx > 40) { toggleCartPanel(true); dragging = false; }
      if (cartPanel.classList.contains('open') && dx < -40) { toggleCartPanel(false); dragging = false; }
    };
    const onUp = () => { dragging = false; };
    cartHandleBtn.addEventListener('mousedown', onDown);
    cartHandleBtn.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
  }

  // Pestañas del carrito (Venta 1, 2, 3, 4)
  document.querySelectorAll('.cart-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabName = btn.getAttribute('data-tab');
      switchCartTab(tabName);
    });
  });

  // Pestañas internas del panel (Productos / Ajustes)
  document.querySelectorAll('.panel-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabId = btn.getAttribute('data-tab');

      // Update buttons
      document.querySelectorAll('.panel-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update content
      document.querySelectorAll('.cart-tab-content').forEach(c => c.classList.remove('active'));
      const content = document.getElementById(`tab-${tabId}`);
      if (content) content.classList.add('active');
    });
  });

  // Eventos de cálculos
  if (discountInput) discountInput.addEventListener('input', recalcTotals);
  if (taxInput) taxInput.addEventListener('input', recalcTotals);
  if (paymentMethodSelect) paymentMethodSelect.addEventListener('change', onPaymentMethodChange);
  if (checkoutReceivedInput) {
    checkoutReceivedInput.addEventListener('input', recalcChange);
    // Seleccionar todo el texto al enfocar para edición rápida
    checkoutReceivedInput.addEventListener('focus', (e) => {
      e.target.select();
      setTimeout(() => e.target.select(), 0);
    });
  }
  if (finalizeSaleBtn) finalizeSaleBtn.addEventListener('click', finalizeSale);

  // Modal events
  if (closeItemModalBtn) closeItemModalBtn.addEventListener('click', closeItemOptions);
  if (saveItemOptionsBtn) saveItemOptionsBtn.addEventListener('click', saveItemOptions);
  if (discountTypeSelect) discountTypeSelect.addEventListener('change', onDiscountTypeChange);

  // Live preview events
  [discPercentInput, discFixedInput, nxnBuyInput, nxnPayInput].forEach(el => {
    if (el) el.addEventListener('input', updateModalPreview);
  });

  // Global Hotkeys
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F2') { // F2: Enfocar búsqueda
      e.preventDefault();
      if (searchInput) searchInput.focus();
    }
    if (e.key === 'F4') { // F4: Cobrar / Finalizar
      e.preventDefault();
      if (finalizeSaleBtn && !finalizeSaleBtn.disabled) finalizeSaleBtn.click();
    }
    if (e.key === 'F7') { // F7: Suspender venta
      e.preventDefault();
      parkCurrentSale();
    }
    if (e.key === 'Escape') { // ESC: Cerrar modales o limpiar búsqueda
      if (itemOptionsModal && !itemOptionsModal.classList.contains('hidden')) {
        closeItemOptions();
      } else if (document.activeElement === searchInput) {
        searchInput.value = '';
        searchInput.blur();
        if (searchResults) searchResults.classList.add('hidden');
        if (productGallery) productGallery.style.display = 'grid';
      }
    }
  });

  // Eliminado auto-cierre al hacer click fuera: el usuario controla con botones
}

function switchCartTab(tabName) {
  if (tabName === CURRENT_TAB) return;

  // Guardar estado actual (por seguridad, aunque renderCart lo mantiene)
  MULTI_CARTS[CURRENT_TAB] = [...CART];

  // Cambiar contexto
  CURRENT_TAB = tabName;
  localStorage.setItem('tomodachi_current_tab', CURRENT_TAB);
  CART = MULTI_CARTS[CURRENT_TAB] || [];

  // Actualizar UI Botones
  document.querySelectorAll('.cart-tab-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('data-tab') === tabName) {
      btn.classList.add('active');
    }
  });

  // Limpiar inputs de pago al cambiar de venta
  if (discountInput) discountInput.value = '';
  if (taxInput) taxInput.value = '';
  if (checkoutReceivedInput) checkoutReceivedInput.value = '';
  if (typeof resetMoneyCounts === 'function') resetMoneyCounts(true);

  // Renderizar el nuevo carrito
  renderCart();
}

async function searchProducts(term) {
  try {
    // Eliminado store_id de los parámetros, el backend usa la sesión
    const res = await fetch('../api/inventory/products.php?search=' + term, { method: 'GET', headers: { 'Content-Type': 'application/json' }, credentials: 'include' });
    if (!await checkSessionStatus(res)) return; // Verificar sesión
    const resData = await res.json();
    if (!resData.success) { return; }
    const list = resData.data || [];

    if (!list.length) {
      searchResults.innerHTML = '<div class="empty-cart">Sin resultados</div>';
      productGallery.style.display = 'none';
      searchResults.classList.remove('hidden');
      return;
    }

    // Renderizar resultados con el mismo estilo que la galería principal
    searchResults.innerHTML = list.map((p, index) => `
      <div class="gallery-item" data-id="${p.product_id}" data-price="${p.price}" data-stock="${p.stock_quantity !== undefined ? p.stock_quantity : ''}" data-image="${p.image_path || ''}" title="${escapeHtml(p.product_name)}" style="animation-delay: ${Math.min(index * 0.05, 0.5)}s">
        <div class="img-wrap">${p.image_path ? `<img src="/${p.image_path}" alt="img">` : '<span class="no-img">Sin imagen</span>'}</div>
        <div class="g-name">${escapeHtml(p.product_name)}</div>
        <div class="g-price">${formatCurrency(p.price)}</div>
      </div>
    `).join('');

    productGallery.style.display = 'none';
    searchResults.classList.remove('hidden');

    Array.from(searchResults.querySelectorAll('.gallery-item')).forEach(el => {
      el.addEventListener('click', () => {
        // Feedback visual
        el.classList.add('item-added-feedback');

        addProductToCart({
          product_id: parseInt(el.getAttribute('data-id')),
          product_name: el.querySelector('.g-name').textContent,
          unit_price: parseFloat(el.getAttribute('data-price')),
          image_path: el.getAttribute('data-image'),
          stock_quantity: parseInt(el.getAttribute('data-stock')) // Asumiendo que viene en data-stock o similar, si no, undefined
        });

        // Pequeño delay para apreciar el feedback antes de cerrar resultados
        setTimeout(() => {
          searchInput.value = '';
          searchResults.classList.add('hidden');
          productGallery.style.display = 'grid';
        }, 250);
      });
    });
  } catch (e) {
    console.error(e);
  }
}

function addProductToCart(prod) {
  const existing = CART.find(i => i.product_id === prod.product_id);

  // Validación de Stock
  const currentQty = existing ? existing.quantity : 0;
  // Si prod.stock_quantity es undefined o null, asumimos infinito o no controlado
  const maxStock = (prod.stock_quantity !== undefined && prod.stock_quantity !== null && prod.stock_quantity !== '') ? parseInt(prod.stock_quantity) : null;

  if (maxStock !== null && (currentQty + 1) > maxStock) {
    showNotification(`Stock insuficiente. Disponible: ${maxStock}`, 'error');
    playSound('Error.mp3');
    return;
  }

  if (existing) {
    existing.quantity += 1;
    recalcItemPrice(existing);
  } else {
    CART.push({
      product_id: prod.product_id,
      product_name: prod.product_name,
      unit_price: prod.unit_price,
      original_price: prod.unit_price,
      quantity: 1,
      subtotal: prod.unit_price,
      image_path: prod.image_path,
      discount_type: 'none',
      discount_value: 0,
      nxn_buy: 0,
      nxn_pay: 0,
      stock_quantity: maxStock // Guardar referencia del stock
    });
  }
  playSound('Sound2.mp3');
  renderCart();
  showNotification('Producto añadido', 'success');
}

function renderCart() {
  // Persistencia: Guardar estado multi-carrito
  MULTI_CARTS[CURRENT_TAB] = CART;
  localStorage.setItem('tomodachi_multi_carts', JSON.stringify(MULTI_CARTS));

  // Actualizar badge de la pestaña actual
  updateTabBadge(CURRENT_TAB);

  if (!cartBody || !emptyCartMsg) return;

  if (!CART.length) {
    cartBody.innerHTML = '';
    emptyCartMsg.style.display = 'block';
    if (finalizeSaleBtn) finalizeSaleBtn.disabled = true;
    if (cartBadge) {
      cartBadge.textContent = '0';
      cartBadge.style.display = 'none';
    }
  } else {
    emptyCartMsg.style.display = 'none';
    if (finalizeSaleBtn) finalizeSaleBtn.disabled = false;

    // Calculate total items count
    const totalItems = CART.reduce((sum, item) => sum + item.quantity, 0);
    if (cartBadge) {
      cartBadge.textContent = totalItems;
      cartBadge.style.display = 'flex';
    }

    cartBody.innerHTML = CART.map(item => {
      let imgHtml = '<div class="cart-item-img-placeholder"><i class="fas fa-box"></i></div>';
      if (item.image_path) {
        // Ensure path is correct
        let src = item.image_path;
        if (!src.startsWith('/') && !src.startsWith('http')) src = '/' + src;
        imgHtml = `<img src="${src}" alt="img" class="cart-item-img">`;
      }

      // Price display (show original crossed out if discounted)
      let priceHtml = formatCurrency(item.unit_price);
      if (item.unit_price < item.original_price) {
        priceHtml = `<div class="price-col">
                <span class="old-price">${formatCurrency(item.original_price)}</span>
                <span class="new-price">${formatCurrency(item.unit_price)}</span>
            </div>`;
      }

      return `<tr>
      <td>
        <div class="cart-item-info">
            ${imgHtml}
            <div class="cart-item-name">${escapeHtml(item.product_name)}</div>
        </div>
      </td>
      <td>${priceHtml}</td>
      <td><input type="number" min="1" value="${item.quantity}" data-id="${item.product_id}" class="qty-input"></td>
      <td>
        <div class="cart-actions">
            <button class="edit-btn" data-id="${item.product_id}" title="Editar precio/descuento"><i class="fas fa-pencil-alt"></i></button>
            <button class="remove-btn" data-id="${item.product_id}" title="Eliminar"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>`;
    }).join('');

    // Bind qty changes
    Array.from(cartBody.querySelectorAll('.qty-input')).forEach(inp => {
      inp.addEventListener('input', () => {
        let q = parseInt(inp.value); if (!q || q < 1) q = 1; inp.value = q;
        const id = parseInt(inp.getAttribute('data-id'));
        const it = CART.find(i => i.product_id === id);
        if (it) {
          it.quantity = q;
          recalcItemPrice(it);
          renderCart();
        }
      });
    });

    // Bind remove
    Array.from(cartBody.querySelectorAll('.remove-btn')).forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.getAttribute('data-id'));
        CART = CART.filter(i => i.product_id !== id);
        playSound('Sound3.mp3');
        renderCart();
      });
    });

    // Bind edit
    Array.from(cartBody.querySelectorAll('.edit-btn')).forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.getAttribute('data-id'));
        openItemOptions(id);
      });
    });
  }
  recalcTotals();
}

// Helper para badges de pestañas
function updateTabBadge(tabId) {
  const btn = document.querySelector(`.cart-tab-btn[data-tab="${tabId}"]`);
  if (!btn) return;

  const items = MULTI_CARTS[tabId] || [];
  const count = items.reduce((s, i) => s + i.quantity, 0);

  let badge = btn.querySelector('.tab-badge');
  if (badge) {
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }
}

function injectCartTabsUI() {
  // Evitar duplicados
  if (document.getElementById('cartTabsContainer')) return;

  const cartPanel = document.getElementById('cartPanel');
  // Si no hay panel lateral, buscar contenedor principal del carrito
  const targetContainer = cartPanel || document.getElementById('cartBody')?.closest('.col-md-4') || document.querySelector('.cart-section');

  if (!targetContainer) return;

  const tabsContainer = document.createElement('div');
  tabsContainer.id = 'cartTabsContainer';

  // Estilos CSS inyectados
  const style = document.createElement('style');
  style.textContent = `
        #cartTabsContainer {
            display: flex;
            width: 100%;
            background: #f8f9fa;
            padding: 10px 10px 0;
            border-bottom: 1px solid #dee2e6;
            gap: 5px;
            overflow-x: auto;
            scrollbar-width: none; /* Firefox */
        }
        #cartTabsContainer::-webkit-scrollbar { display: none; } /* Chrome/Safari */
        
        .cart-tab-btn {
            flex: 1;
            min-width: 60px;
            padding: 12px 5px;
            border: 1px solid transparent;
            background: #e9ecef;
            color: #6c757d;
            border-radius: 8px 8px 0 0;
            cursor: pointer;
            position: relative;
            font-weight: 600;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            font-size: 0.9rem;
            outline: none;
        }
        .cart-tab-btn:hover { background: #dee2e6; }
        
        .cart-tab-btn.active {
            background: #fff;
            color: var(--primary-color, #2e7d32);
            border-color: #dee2e6;
            border-bottom-color: #fff;
            margin-bottom: -1px;
            box-shadow: 0 -2px 4px rgba(0,0,0,0.02);
            font-weight: 700;
            z-index: 2;
        }
        
        .cart-tab-btn .tab-icon { font-size: 1.1rem; }
        .cart-tab-btn .tab-label { display: inline-block; }
        
        /* Badge de contador */
        .tab-badge {
            background: #dc3545;
            color: white;
            font-size: 0.7rem;
            padding: 2px 6px;
            border-radius: 10px;
            position: absolute;
            top: 4px;
            right: 4px;
            display: none;
            min-width: 18px;
            text-align: center;
            line-height: 1.2;
            box-shadow: 0 2px 2px rgba(0,0,0,0.1);
        }

        /* Ajustes Móvil */
        @media (max-width: 768px) {
            .cart-tab-btn .tab-label { display: none; }
            .cart-tab-btn { padding: 10px 5px; }
            .cart-tab-btn .tab-icon { font-size: 1.2rem; margin: 0; }
        }
    `;
  document.head.appendChild(style);

  // Generar botones de carritos
  ['1', '2', '3', '4'].forEach(num => {
    const btn = document.createElement('button');
    btn.className = 'cart-tab-btn';
    btn.setAttribute('data-tab', num);
    btn.innerHTML = `
            <i class="fas fa-shopping-cart tab-icon"></i>
            <span class="tab-badge">0</span>
        `;
    btn.title = `Venta ${num}`;
    btn.onclick = () => switchCartTab(num);
    tabsContainer.appendChild(btn);
  });



  // Insertar en el DOM y reestructurar para vistas
  const header = targetContainer.querySelector('.cart-header') || targetContainer.querySelector('h2') || targetContainer.querySelector('.card-header');

  if (header) {
    header.parentNode.insertBefore(tabsContainer, header.nextSibling);
  } else {
    targetContainer.insertBefore(tabsContainer, targetContainer.firstChild);
  }


}

function injectHistorySidebar() {
  if (document.getElementById('historyHandle')) return;

  // 1. Crear Botón Flotante (Handle)
  const historyHandle = document.createElement('button');
  historyHandle.id = 'historyHandle';
  historyHandle.className = 'cart-handle history-handle'; // Reutiliza estilos base
  historyHandle.setAttribute('aria-label', 'Abrir historial');
  historyHandle.innerHTML = '<i class="fas fa-history"></i>';

  // Estilos específicos para diferenciarlo y posicionarlo
  // Inicialmente oculto fuera de pantalla (translateX)
  historyHandle.style.cssText = `
        top: 59%; /* Debajo del carrito */
        background: #6c757d; /* Color sutil (gris) */
        transform: translateX(120%); /* Oculto a la derecha */
        transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
        display: flex; /* Siempre flex, controlamos visibilidad con transform */
        z-index: 1049;
    `;

  // 2. Crear Panel Lateral
  const historyPanel = document.createElement('aside');
  historyPanel.id = 'historyPanel';
  historyPanel.className = 'cart-side-panel'; // Reutiliza estilos base
  historyPanel.setAttribute('aria-label', 'Historial de Ventas');
  historyPanel.setAttribute('aria-hidden', 'true');
  historyPanel.style.zIndex = '1051'; // Un poco más alto que el carrito por si acaso

  historyPanel.innerHTML = `
        <div class="cart-side-header" style="background: #f8f9fa; color: #333; border-bottom: 1px solid #dee2e6;">
            <h2>Historial</h2>
            <button class="close-cart" id="closeHistoryBtn" aria-label="Cerrar historial"><i class="fas fa-times"></i></button>
        </div>
        <div id="historyPanelBody" style="flex: 1; overflow-y: auto; padding: 10px;">
            <!-- Contenido dinámico -->
        </div>
    `;

  // Insertar en el DOM
  document.body.appendChild(historyHandle);
  document.body.appendChild(historyPanel);

  // 3. Lógica de Toggle
  const cartPanel = document.getElementById('cartPanel');
  const cartHandle = document.getElementById('cartHandle');

  function toggleHistory(forceOpen = null) {
    const isOpen = historyPanel.classList.contains('open');
    const shouldOpen = forceOpen !== null ? forceOpen : !isOpen;

    if (shouldOpen) {
      // Cerrar carrito si está abierto
      if (cartPanel && cartPanel.classList.contains('open')) {
        cartPanel.classList.remove('open');
        cartPanel.setAttribute('aria-hidden', 'true');
      }

      historyPanel.classList.add('open');
      historyPanel.setAttribute('aria-hidden', 'false');
      renderHistoryView(); // Cargar datos al abrir
    } else {
      historyPanel.classList.remove('open');
      historyPanel.setAttribute('aria-hidden', 'true');

      // REQUERIMIENTO: Al cerrar historial, volver a abrir el carrito
      if (cartPanel) {
        cartPanel.classList.add('open');
        cartPanel.setAttribute('aria-hidden', 'false');
      }
    }
  }

  // Event Listeners
  historyHandle.onclick = () => toggleHistory();
  document.getElementById('closeHistoryBtn').onclick = () => toggleHistory(false);

  // Observador para mostrar/ocultar el botón de historial según el estado del carrito
  // Usamos MutationObserver para detectar cambios en la clase 'open' del cartPanel
  if (cartPanel) {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const isCartOpen = cartPanel.classList.contains('open');
          const isHistoryOpen = historyPanel.classList.contains('open');

          // Mostrar botón si el carrito está abierto O si el historial está abierto
          if (isCartOpen || isHistoryOpen) {
            historyHandle.style.transform = 'translateX(0)';
          } else {
            // Ocultar botón si ambos están cerrados
            historyHandle.style.transform = 'translateX(120%)';
          }
        }
      });
    });
    observer.observe(cartPanel, { attributes: true });
    // También observar el panel de historial para mantener el botón visible
    const historyObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const isCartOpen = cartPanel.classList.contains('open');
          const isHistoryOpen = historyPanel.classList.contains('open');

          if (isCartOpen || isHistoryOpen) {
            historyHandle.style.transform = 'translateX(0)';
          } else {
            historyHandle.style.transform = 'translateX(120%)';
          }
        }
      });
    });
    historyObserver.observe(historyPanel, { attributes: true });
  }

  // Estilos CSS extra
  const style = document.createElement('style');
  style.textContent = `
        .history-item-card {
            background: #fff;
            border: 1px solid #eee;
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 10px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.02);
            transition: transform 0.2s;
        }
        .history-item-card:hover { transform: translateY(-2px); box-shadow: 0 4px 8px rgba(0,0,0,0.05); }
        .h-header { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.9rem; color: #555; }
        .h-id { font-weight: bold; color: #333; }
        .h-details { font-size: 0.85rem; color: #777; margin-bottom: 8px; display: flex; justify-content: space-between; }
        .h-footer { display: flex; justify-content: space-between; align-items: center; border-top: 1px dashed #eee; padding-top: 8px; }
        .h-total { font-size: 1.1rem; font-weight: bold; color: var(--primary-color, #2e7d32); }
        .btn-reprint { background: #f0f0f0; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; color: #333; }
        .btn-reprint:hover { background: #e0e0e0; }
    `;
  document.head.appendChild(style);
}

function renderHistoryView() {
  const container = document.getElementById('historyPanelBody');
  if (!container) return;

  // Cargar datos
  const saved = localStorage.getItem('tomodachi_recent_sales');
  let sales = [];
  try { sales = JSON.parse(saved) || []; } catch (e) { }

  let html = '';

  if (sales.length === 0) {
    html += '<div class="empty-cart" style="text-align: center; padding: 20px; color: #999;">No hay ventas recientes registradas en este dispositivo.</div>';
  } else {
    html += sales.map((s, idx) => `
            <div class="history-item-card">
                <div class="h-header">
                    <span class="h-id">Venta #${s.sale_id}</span>
                    <span class="h-date">${s.date}</span>
                </div>
                <div class="h-details">
                    <span>${s.items.length} productos</span>
                    <span>${s.cashier ? 'Por: ' + s.cashier : (s.customer || 'Cliente General')}</span>
                </div>
                <div class="h-footer">
                    <span class="h-total">${formatCurrency(s.total)}</span>
                    <button onclick="reprintTicketFromHistory(${idx})" class="btn-reprint" title="Reimprimir Ticket"><i class="fas fa-print"></i></button>
                </div>
            </div>
        `).join('');
  }

  container.innerHTML = html;
}

// ==========================================
// CONTROLES EXTRA (Historial)
// ==========================================

let RECENT_SALES = [];

function saveSaleToHistory(saleData) {
  // Cargar historial existente
  const saved = localStorage.getItem('tomodachi_recent_sales');
  if (saved) {
    try { RECENT_SALES = JSON.parse(saved); } catch (e) { }
  }

  // Añadir nueva venta al inicio
  RECENT_SALES.unshift(saleData);

  // Mantener solo las últimas 10 ventas
  if (RECENT_SALES.length > 10) RECENT_SALES = RECENT_SALES.slice(0, 10);

  localStorage.setItem('tomodachi_recent_sales', JSON.stringify(RECENT_SALES));
}

// Función global para el onclick del HTML inyectado
window.reprintTicketFromHistory = function (index) {
  // Recargar desde storage por si acaso
  const saved = localStorage.getItem('tomodachi_recent_sales');
  let sales = [];
  try { sales = JSON.parse(saved) || []; } catch (e) { }

  if (sales[index]) {
    printTicket(sales[index]);
  }
};

// ==========================================
// MODAL & DISCOUNT LOGIC
// ==========================================

function openItemOptions(id) {
  const item = CART.find(i => i.product_id === id);
  if (!item) return;

  EDITING_PRODUCT_ID = id;

  // Populate modal
  if (modalProductName) modalProductName.textContent = item.product_name;
  if (modalOriginalPrice) modalOriginalPrice.textContent = formatCurrency(item.original_price);

  // Set current values
  if (discountTypeSelect) discountTypeSelect.value = item.discount_type || 'none';

  if (discPercentInput) discPercentInput.value = item.discount_type === 'percent' ? item.discount_value : '';
  if (discFixedInput) discFixedInput.value = item.discount_type === 'fixed' ? item.discount_value : '';

  if (nxnBuyInput) nxnBuyInput.value = item.nxn_buy || '';
  if (nxnPayInput) nxnPayInput.value = item.nxn_pay || '';

  onDiscountTypeChange(); // Show/hide inputs
  updateModalPreview(); // Calc preview

  if (itemOptionsModal) {
    itemOptionsModal.classList.remove('hidden');
    itemOptionsModal.setAttribute('aria-hidden', 'false');
  }
}

function closeItemOptions() {
  if (itemOptionsModal) {
    itemOptionsModal.classList.add('hidden');
    itemOptionsModal.setAttribute('aria-hidden', 'true');
  }
  EDITING_PRODUCT_ID = null;
}

function onDiscountTypeChange() {
  const type = discountTypeSelect.value;

  if (optPercent) optPercent.classList.add('hidden');
  if (optFixed) optFixed.classList.add('hidden');
  if (optNxn) optNxn.classList.add('hidden');

  if (type === 'percent' && optPercent) optPercent.classList.remove('hidden');
  if (type === 'fixed' && optFixed) optFixed.classList.remove('hidden');
  if (type === 'nxn' && optNxn) optNxn.classList.remove('hidden');

  updateModalPreview();
}

function updateModalPreview() {
  const item = CART.find(i => i.product_id === EDITING_PRODUCT_ID);
  if (!item) return;

  const type = discountTypeSelect.value;
  let newPrice = item.original_price;

  if (type === 'percent') {
    const pct = parseFloat(discPercentInput.value) || 0;
    newPrice = item.original_price * (1 - pct / 100);
  } else if (type === 'fixed') {
    const discount = parseFloat(discFixedInput.value) || 0;
    newPrice = Math.max(0, item.original_price - discount);
  } else if (type === 'nxn') {
    // For NxN, the unit price depends on quantity. 
    // In preview, we can show the effective unit price based on current quantity in cart
    // or just show "Variable" or calculate for the current quantity.
    const buy = parseInt(nxnBuyInput.value) || 1;
    const pay = parseInt(nxnPayInput.value) || 1;

    if (buy > 0 && item.quantity >= buy) {
      const sets = Math.floor(item.quantity / buy);
      const remainder = item.quantity % buy;
      const payableQty = (sets * pay) + remainder;
      newPrice = (payableQty * item.original_price) / item.quantity;
    }
  }

  if (modalNewPrice) modalNewPrice.textContent = formatCurrency(newPrice);
}

function saveItemOptions() {
  const item = CART.find(i => i.product_id === EDITING_PRODUCT_ID);
  if (!item) return;

  const type = discountTypeSelect.value;
  item.discount_type = type;

  if (type === 'percent') {
    item.discount_value = parseFloat(discPercentInput.value) || 0;
  } else if (type === 'fixed') {
    item.discount_value = parseFloat(discFixedInput.value) || 0;
  } else if (type === 'nxn') {
    item.nxn_buy = parseInt(nxnBuyInput.value) || 1;
    item.nxn_pay = parseInt(nxnPayInput.value) || 1;
  } else {
    item.discount_value = 0;
  }

  recalcItemPrice(item);
  renderCart();
  closeItemOptions();
  showNotification('Precio actualizado', 'success');
}

function recalcItemPrice(item) {
  let newUnitPrice = item.original_price;

  if (item.discount_type === 'percent') {
    newUnitPrice = item.original_price * (1 - item.discount_value / 100);
  } else if (item.discount_type === 'fixed') {
    newUnitPrice = Math.max(0, item.original_price - item.discount_value);
  } else if (item.discount_type === 'nxn') {
    const buy = item.nxn_buy || 1;
    const pay = item.nxn_pay || 1;

    if (buy > 0 && item.quantity >= buy) {
      const sets = Math.floor(item.quantity / buy);
      const remainder = item.quantity % buy;
      const payableQty = (sets * pay) + remainder;
      newUnitPrice = (payableQty * item.original_price) / item.quantity;
    }
  }

  item.unit_price = newUnitPrice;
  item.subtotal = item.quantity * item.unit_price;
}

function recalcTotals() {
  const subtotal = CART.reduce((s, i) => s + i.subtotal, 0);
  const discount = (discountInput && discountInput.value) ? parseFloat(discountInput.value) : 0;
  const tax = (taxInput && taxInput.value) ? parseFloat(taxInput.value) : 0;
  const total = Math.max(0, subtotal - discount + tax);
  if (totalBadge) {
    totalBadge.textContent = formatCurrency(total);
  }
  if (panelTotalEl) {
    panelTotalEl.textContent = formatCurrency(total);
  }
  renderQuickCashButtons(); // Actualizar botones de pago rápido
  recalcChange();
}

function onPaymentMethodChange() {
  if (!paymentMethodSelect) return;
  recalcChange();
}

function recalcChange() {
  if (!paymentMethodSelect) return;
  const method = paymentMethodSelect.value;
  const subtotal = CART.reduce((s, i) => s + i.subtotal, 0);
  const discount = (discountInput && discountInput.value) ? parseFloat(discountInput.value) : 0;
  const tax = (taxInput && taxInput.value) ? parseFloat(taxInput.value) : 0;
  const total = Math.max(0, subtotal - discount + tax);
  if (method === 'cash' || method === 'mixed') {
    const received = (checkoutReceivedInput && checkoutReceivedInput.value) ? parseFloat(checkoutReceivedInput.value) : 0;
    const change = received - total;
    if (checkoutChangeDisplay) {
      checkoutChangeDisplay.textContent = formatCurrency(change >= 0 ? change : 0);
      if (change < 0) {
        checkoutChangeDisplay.classList.add('negative');
      } else {
        checkoutChangeDisplay.classList.remove('negative');
      }
    }
  } else {
    if (checkoutChangeDisplay) checkoutChangeDisplay.textContent = '—';
    if (checkoutChangeDisplay) checkoutChangeDisplay.classList.remove('negative');
  }
  // Habilitar botón finalizar según reglas
  if (finalizeSaleBtn) {
    let canFinalize = CART.length > 0;
    if (canFinalize) {
      if (method === 'cash' || method === 'mixed') {
        const received = parseFloat(checkoutReceivedInput.value) || 0;
        canFinalize = received >= total && total > 0;
      } else {
        canFinalize = total > 0;
      }
    }
    finalizeSaleBtn.disabled = !canFinalize;
  }
}

function toggleCartPanel(forceOpen = null) {
  const open = forceOpen !== null ? forceOpen : !cartPanel.classList.contains('open');
  if (open) {
    cartPanel.classList.add('open');
    cartPanel.setAttribute('aria-hidden', 'false');
  } else {
    cartPanel.classList.remove('open');
    cartPanel.setAttribute('aria-hidden', 'true');
  }
}

async function finalizeSale() {
  if (!CART.length) return;
  finalizeSaleBtn.disabled = true;

  const method = paymentMethodSelect ? paymentMethodSelect.value : 'cash';
  const payload = {
    store_id: CURRENT_STORE_ID,
    items: CART.map(i => ({ product_id: i.product_id, quantity: i.quantity, price: i.unit_price })),
    payment_method: method,
    discount: (discountInput && discountInput.value) ? parseFloat(discountInput.value) : 0,
    tax: (taxInput && taxInput.value) ? parseFloat(taxInput.value) : 0
  };

  // Añadir cash_amount si es necesario
  if ((method === 'cash' || method === 'mixed') && checkoutReceivedInput) {
    payload.cash_amount = parseFloat(checkoutReceivedInput.value) || 0;
  }

  try {
    const res = await fetch('../api/sales/create_sale.php', { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' }, credentials: 'include' });
    if (!await checkSessionStatus(res)) { finalizeSaleBtn.disabled = false; return; }
    const resData = await res.json();
    if (resData.success) {
      playSound('Sound7.mp3');
      showNotification('Venta registrada', 'success');

      if (resData.register_opened) {
        showNotification('Se ha abierto una nueva caja automáticamente', 'info');
      }

      // Preparar datos para ticket
      const ticketData = {
        items: [...CART],
        total: CART.reduce((s, i) => s + i.subtotal, 0),
        date: new Date().toLocaleString(),
        sale_id: resData.sale_id || '---',
        cashier: resData.cashier_name || 'Cajero'
      };

      // Guardar en historial local
      saveSaleToHistory(ticketData);

      // Imprimir ticket si está habilitado
      const printEnabled = document.getElementById('printTicketCheckbox') && document.getElementById('printTicketCheckbox').checked;
      if (printEnabled) {
        printTicket(ticketData);
      }

      CART = [];
      MULTI_CARTS[CURRENT_TAB] = []; // Limpiar del storage global
      localStorage.setItem('tomodachi_multi_carts', JSON.stringify(MULTI_CARTS));

      renderCart();
      if (discountInput) discountInput.value = '0';
      if (taxInput) taxInput.value = '0';
      if (checkoutReceivedInput) checkoutReceivedInput.value = '0';

      // Resetear contadores de dinero visuales
      if (typeof resetMoneyCounts === 'function') resetMoneyCounts(true);

      // Mantener panel abierto; solo se cierra manualmente
    } else {
      showNotification(resData.message || 'Error venta', 'error');
    }
  } catch (e) {
    showNotification('Error al procesar venta', 'error');
  } finally {
    finalizeSaleBtn.disabled = false;
  }
}

// Ajuste: ya no existe barra de resumen separada; recalcTotals gestiona todo

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[m]); });
}

// Galería de productos + categorías
async function loadCategoriesAndProducts() {
  try {
    const [catRes, prodRes] = await Promise.all([
      fetch('../api/inventory/categories.php'),
      fetch('../api/inventory/products.php')
    ]);

    if (!await checkSessionStatus(catRes) || !await checkSessionStatus(prodRes)) return;

    const catData = await catRes.json();
    const prodData = await prodRes.json();

    if (catData.success) {
      allCategories = catData.data || [];
    }
    if (prodData.success) {
      allProducts = prodData.data || [];
    }

    renderCategoryBar();
    renderGallery(getFilteredProducts());

    // Bind interactions
    // bindCategoryDrag(); // Deshabilitado por problemas de UX en escritorio
    bindGallerySwipe();
  } catch (e) {
    console.error(e);
  }
}

function getFilteredProducts() {
  if (!activeCategoryId) return allProducts;
  return allProducts.filter(p => String(p.category_id || '') === String(activeCategoryId));
}

function renderGallery(list, animate = false) {
  if (!productGallery) return;

  // Limpiar clases de animación CSS antiguas
  productGallery.classList.remove('slide-in-left', 'slide-in-right');

  if (!list || list.length === 0) {
    productGallery.innerHTML = '<div class="empty-cart" style="grid-column: 1/-1;">No hay productos para esta categoría</div>';
    return;
  }

  // Renderizar items (ocultos si se va a animar)
  productGallery.innerHTML = list.map(p => `<div class="gallery-item" data-id="${p.product_id}" data-price="${p.price}" data-stock="${p.stock_quantity !== undefined ? p.stock_quantity : ''}" data-image="${p.image_path || ''}" title="${escapeHtml(p.product_name)}" style="opacity: ${animate ? 0 : 1};">
        <div class="img-wrap">${p.image_path ? `<img src="/${p.image_path}" alt="img">` : '<span class="no-img">Sin imagen</span>'}</div>
        <div class="g-name">${escapeHtml(p.product_name)}</div>
        <div class="g-price">${formatCurrency(p.price)}</div>
      </div>`).join('');

  Array.from(productGallery.querySelectorAll('.gallery-item')).forEach(el => {
    el.addEventListener('click', () => {
      if (isCatDragging) return; // evita clics fantasma tras arrastrar barra
      el.classList.add('item-added-feedback');
      setTimeout(() => el.classList.remove('item-added-feedback'), 500);

      addProductToCart({
        product_id: parseInt(el.getAttribute('data-id')),
        product_name: el.querySelector('.g-name').textContent,
        unit_price: parseFloat(el.getAttribute('data-price')),
        image_path: el.getAttribute('data-image'),
        stock_quantity: parseInt(el.getAttribute('data-stock'))
      });
    });
  });

  // Ejecutar animación de entrada con anime.js
  if (animate && typeof anime !== 'undefined') {
    anime({
      targets: '.gallery-item',
      opacity: [0, 1],
      translateY: [20, 0],
      scale: [0.95, 1],
      delay: anime.stagger(40), // Retraso escalonado entre elementos
      duration: 400,
      easing: 'easeOutQuad'
    });
  }
}

function renderCategoryBar() {
  if (!categoryBar) return;
  const pills = [{ category_id: null, category_name: 'Todos', icon_class: 'fa-border-all' }, ...allCategories];
  categoryBar.innerHTML = pills.map(cat => `
    <button class="category-pill ${(!activeCategoryId && cat.category_id === null) || (String(activeCategoryId) === String(cat.category_id)) ? 'active' : ''}" data-id="${cat.category_id === null ? '' : cat.category_id}">
      <i class="fas ${cat.icon_class || 'fa-tag'}"></i>
      <span class="cat-label">${escapeHtml(cat.category_name)}</span>
    </button>
  `).join('');

  Array.from(categoryBar.querySelectorAll('.category-pill')).forEach(el => {
    el.addEventListener('click', () => {
      // if (isCatDragging) return; // Deshabilitado check de drag
      const id = el.getAttribute('data-id');
      const newId = id ? id : null;

      // Determinar dirección para animación
      let direction = 'next';
      const currentIdx = getCategoryIndex(activeCategoryId);
      const newIdx = getCategoryIndex(newId);

      if (newIdx < currentIdx) direction = 'prev';

      setActiveCategory(newId, direction);
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
  });
}

function getCategoryIndex(id) {
  // null es index 0
  if (id === null) return 0;
  // Buscar en allCategories
  const idx = allCategories.findIndex(c => String(c.category_id) === String(id));
  return idx === -1 ? 0 : idx + 1; // +1 porque 'Todos' es 0
}

function setActiveCategory(id, direction = 'none') {
  // Si es la misma categoría, no hacer nada
  if (String(activeCategoryId) === String(id)) return;

  const updateState = () => {
    activeCategoryId = id;
    renderCategoryBar();
    renderGallery(getFilteredProducts(), true);
    scrollToActiveCategoryPill();
  };

  // Si hay items y anime.js está disponible, animar salida
  const currentItems = document.querySelectorAll('.gallery-item');
  if (typeof anime !== 'undefined' && currentItems.length > 0) {
    anime({
      targets: '.gallery-item',
      opacity: [1, 0],
      scale: [1, 0.9],
      duration: 150,
      easing: 'easeInQuad',
      complete: updateState
    });
  } else {
    updateState();
  }
}

function bindGallerySwipe() {
  if (!productGallery || productGallery.dataset.swipeBound === '1') return;
  productGallery.dataset.swipeBound = '1';

  let touchStartX = 0;
  let touchEndX = 0;
  const minSwipeDistance = 50;

  productGallery.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  productGallery.addEventListener('touchend', e => {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
  }, { passive: true });

  function handleSwipe() {
    const distance = touchEndX - touchStartX;

    if (Math.abs(distance) < minSwipeDistance) return;

    const currentIdx = getCategoryIndex(activeCategoryId);
    const totalCats = allCategories.length + 1; // +1 por 'Todos'

    if (distance < 0) {
      // Swipe Left -> Next Category
      if (currentIdx < totalCats - 1) {
        const nextIdx = currentIdx + 1;
        const nextId = nextIdx === 0 ? null : allCategories[nextIdx - 1].category_id;
        setActiveCategory(nextId, 'next');
      }
    } else {
      // Swipe Right -> Prev Category
      if (currentIdx > 0) {
        const prevIdx = currentIdx - 1;
        const prevId = prevIdx === 0 ? null : allCategories[prevIdx - 1].category_id;
        setActiveCategory(prevId, 'prev');
      }
    }
  }
}

function scrollToActiveCategoryPill() {
  setTimeout(() => {
    const activePill = categoryBar.querySelector('.category-pill.active');
    if (activePill) {
      activePill.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, 50);
}

function bindCategoryDrag() {
  // Función deshabilitada para simplificar la interacción y evitar conflictos con clics
  return;
}

// Funcionalidad de escáner
async function fetchByCode(code) {
  try {
    // Eliminado store_id de los parámetros, el backend usa la sesión
    const res = await fetch('../api/inventory/scanner.php?barcode=' + code, { method: 'GET', headers: { 'Content-Type': 'application/json' }, credentials: 'include' });
    if (!await checkSessionStatus(res)) return;
    const resData = await res.json();
    if (resData.success && resData.data) {
      const p = resData.data;
      addProductToCart({
        product_id: p.product_id,
        product_name: p.product_name,
        unit_price: parseFloat(p.price),
        image_path: p.image_path,
        stock_quantity: p.stock_quantity // Asegurar que el backend lo envíe
      });
      showScannedProductOverlay(p);
      showNotification('Producto añadido', 'success');
    } else {
      showNotification('Código no encontrado', 'error');
    }
  } catch (e) {
    showNotification('Error escáner', 'error');
  }
}

function showScannedProductOverlay(product) {
  let overlay = document.getElementById('scannerOverlay');
  const container = document.getElementById('scannerContainer');

  if (!container) return;

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'scannerOverlay';
    overlay.className = 'scanner-overlay';
    container.appendChild(overlay);
  }

  // Ajustar ruta de imagen si es relativa
  let imgPath = product.image_path;
  if (imgPath && !imgPath.startsWith('http') && !imgPath.startsWith('/')) {
    imgPath = '/' + imgPath;
  }
  // if (!imgPath) imgPath = '/Tomodachi/public/assets/images/no-image.png';

  // Escapar comillas simples para CSS url()
  const cssImgPath = imgPath.replace(/'/g, "\\'");

  overlay.innerHTML = `
    <div class="scanned-product-card" style="position: relative; overflow: hidden; background: white; z-index: 1;">
      <!-- Fondo con imagen borrosa -->
      <div style="
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background-image: url('${cssImgPath}');
          background-size: cover;
          background-position: center;
          filter: blur(8px);
          opacity: 0.4;
          z-index: -1;
      "></div>
      
      <!-- Contenido principal -->
      <div style="position: relative; z-index: 2; padding: 10px;">
        <img src="${imgPath}" alt="Producto" style="max-width:120px; max-height:120px; object-fit:contain; margin-bottom:10px; border-radius: 8px; background: rgba(255,255,255,0.9); padding: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
        <div class="scanned-info">
          <h3 style="margin:0 0 5px; font-size:1.1rem; color:#222; font-weight: 700; text-shadow: 0 1px 1px rgba(255,255,255,0.8);">${escapeHtml(product.product_name)}</h3>
          <span class="price" style="font-size:1.4rem; font-weight:bold; color:var(--primary-color); text-shadow: 0 2px 0 rgba(255,255,255,1);">${formatCurrency(product.price)}</span>
        </div>
      </div>
    </div>
  `;

  overlay.classList.add('visible');

  if (window.scanOverlayTimeout) clearTimeout(window.scanOverlayTimeout);
  window.scanOverlayTimeout = setTimeout(() => {
    overlay.classList.remove('visible');
  }, 2000);
}

// Función para pruebas visuales con flujo real
function probarEfectosVisuales(barcode = '7501234567890') {
  console.log(`🎬 Iniciando prueba de escáner con código: ${barcode}...`);

  // 1. Referencias al DOM
  const scannerContainer = document.getElementById('scannerContainer');
  const toggleBtn = document.getElementById('toggleScannerBtn');
  const productsMain = document.querySelector('.products-main');

  if (!scannerContainer || !toggleBtn) {
    console.error("❌ No se encontraron elementos del escáner.");
    return;
  }

  // 2. Activar modo escáner visualmente si no está activo
  if (scannerContainer.classList.contains('hidden')) {
    scannerContainer.classList.remove('hidden');
    if (productsMain) productsMain.classList.add('hidden');
    toggleBtn.innerHTML = '<i class="fas fa-times"></i>';
    toggleBtn.setAttribute('aria-label', 'Cerrar escáner');
    scannerContainer.style.backgroundColor = "#000";
    scannerContainer.style.minHeight = "300px";
  }

  console.log("📷 Escáner activo. Simulando lectura...");

  // 3. Simular delay de lectura y llamar al flujo real
  setTimeout(() => {
    console.log(`📡 Consultando API con código: ${barcode}`);
    // Llamada real al backend
    fetchByCode(barcode);

    // Enfocar input recibido (opcional, ya que el usuario podría seguir escaneando)
    const receivedInput = document.getElementById('checkoutReceived');
    if (receivedInput) {
      // receivedInput.focus(); 
    }

  }, 1500);
}

// Exponer globalmente
window.probarEfectosVisuales = probarEfectosVisuales;

// Exponer fetchByCode globalmente
window.fetchByCode = fetchByCode;

function playSound(filename) {
  const audio = new Audio('assets/sound/' + filename);
  audio.play().catch(e => console.warn('Error playing sound:', e));
}

function printTicket(data) {
  const win = window.open('', 'PrintTicket', 'width=400,height=600');
  if (!win) {
    showNotification('Habilita pop-ups para imprimir ticket', 'warning');
    return;
  }

  const storeName = localStorage.getItem('tomodachi_store_name') || 'Tomodachi Store';

  const itemsHtml = data.items.map(item => `
    <tr>
      <td style="padding: 5px 0;">${item.quantity} x ${item.product_name}</td>
      <td style="text-align: right;">$${(item.unit_price * item.quantity).toFixed(2)}</td>
    </tr>
  `).join('');

  const html = `
    <html>
    <head>
      <title>Ticket de Venta</title>
      <style>
        body { font-family: 'Courier New', monospace; font-size: 12px; margin: 0; padding: 20px; }
        .header { text-align: center; margin-bottom: 20px; }
        .header h2 { margin: 0; font-size: 16px; }
        table { width: 100%; border-collapse: collapse; }
        .total { margin-top: 10px; border-top: 1px dashed #000; padding-top: 10px; text-align: right; font-weight: bold; font-size: 14px; }
        .footer { margin-top: 20px; text-align: center; font-size: 10px; }
        .powered-by { font-size: 8px; color: #888; margin-top: 5px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>${storeName}</h2>
        <p>Fecha: ${data.date}</p>
        <p>Venta #: ${data.sale_id}</p>
      </div>
      <table>
        ${itemsHtml}
      </table>
      <div class="total">
        TOTAL: $${data.total.toFixed(2)}
      </div>
      <div class="footer">
        <p>¡Gracias por su compra!</p>
        <p class="powered-by">Tomodachi powered by Baburu</p>
      </div>
      <script>
        window.onload = function() { window.print(); window.close(); }
      </script>
    </body>
    </html>
  `;

  win.document.write(html);
  win.document.close();
}

// ==========================================
// NUEVAS IMPLEMENTACIONES (Park Sale, Quick Cash, Session Check)
// ==========================================

async function checkSessionStatus(response) {
  if (response.status === 401 || response.status === 403) {
    showNotification('La sesión ha expirado. Redirigiendo...', 'error');
    setTimeout(() => window.location.href = '/login.php', 2000);
    return false;
  }
  return true;
}

function parkCurrentSale() {
  if (CART.length === 0) return showNotification('El carrito está vacío', 'warning');

  const saleData = {
    id: Date.now(),
    timestamp: new Date().toLocaleString(),
    items: [...CART],
    total: CART.reduce((s, i) => s + i.subtotal, 0)
  };

  PARKED_SALES.push(saleData);
  localStorage.setItem('tomodachi_parked_sales', JSON.stringify(PARKED_SALES));

  CART = [];
  // localStorage.removeItem('tomodachi_cart'); // Ya no se usa
  renderCart();
  updateParkedSalesIndicator();
  showNotification('Venta suspendida/guardada', 'success');
}

function restoreParkedSale(id) {
  const index = PARKED_SALES.findIndex(s => s.id === id);
  if (index === -1) return;

  if (CART.length > 0) {
    if (!confirm('Hay productos en el carrito actual. ¿Deseas sobrescribirlos?')) return;
  }

  CART = [...PARKED_SALES[index].items];
  PARKED_SALES.splice(index, 1);
  localStorage.setItem('tomodachi_parked_sales', JSON.stringify(PARKED_SALES));

  renderCart();
  updateParkedSalesIndicator();
  showNotification('Venta recuperada', 'success');
}

function updateParkedSalesIndicator() {
  // Buscar o crear el indicador
  let indicator = document.getElementById('parkedSalesBtn');

  if (!indicator) {
    // Intentar inyectarlo en la barra superior o cerca del carrito
    const target = document.querySelector('.cart-header') || document.getElementById('cartPanel');
    if (target) {
      indicator = document.createElement('button');
      indicator.id = 'parkedSalesBtn';
      indicator.className = 'btn-parked-sales';
      indicator.style.cssText = 'margin: 5px; padding: 5px 10px; background: #ff9800; color: white; border: none; border-radius: 4px; cursor: pointer; display: none; font-size: 0.8rem;';
      indicator.onclick = showParkedSalesList;

      if (target.classList.contains('cart-header')) {
        target.appendChild(indicator);
      } else {
        target.insertBefore(indicator, target.firstChild);
      }
    }
  }

  if (indicator) {
    indicator.textContent = `Suspendidas (${PARKED_SALES.length})`;
    indicator.style.display = PARKED_SALES.length > 0 ? 'inline-block' : 'none';
  }
}

function showParkedSalesList() {
  if (PARKED_SALES.length === 0) return;

  // Crear un modal simple dinámicamente
  const modalId = 'parkedSalesModal';
  let modal = document.getElementById(modalId);

  if (!modal) {
    modal = document.createElement('div');
    modal.id = modalId;
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; justify-content: center; align-items: center;';
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  }

  const listHtml = PARKED_SALES.map(s => `
        <div style="background: #f5f5f5; padding: 10px; margin-bottom: 10px; border-radius: 5px; display: flex; justify-content: space-between; align-items: center;">
            <div>
                <strong>${s.timestamp}</strong><br>
                ${s.items.length} items - Total: ${formatCurrency(s.total)}
            </div>
            <button onclick="restoreParkedSale(${s.id}); document.getElementById('${modalId}').style.display='none';" style="background: #4caf50; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer;">Recuperar</button>
        </div>
    `).join('');

  modal.innerHTML = `
        <div style="background: white; padding: 20px; border-radius: 8px; max-width: 400px; width: 90%; max-height: 80vh; overflow-y: auto;">
            <h3 style="margin-top: 0;">Ventas Suspendidas</h3>
            ${listHtml}
            <button onclick="document.getElementById('${modalId}').style.display='none'" style="margin-top: 10px; width: 100%; padding: 8px;">Cerrar</button>
        </div>
    `;

  modal.style.display = 'flex';
}

// ==========================================
// SISTEMA DE PAGO RÁPIDO (Billetes y Monedas)
// ==========================================

let moneyCounts = {};

function renderQuickCashButtons() {
  const input = document.getElementById('checkoutReceived');
  if (!input) return;

  // Asegurar que el input tenga un wrapper para posicionar el botón
  let wrapper = document.getElementById('money-input-wrapper');
  if (!wrapper) {
    // Crear wrapper alrededor del input existente
    wrapper = document.createElement('div');
    wrapper.id = 'money-input-wrapper';
    wrapper.style.cssText = 'position: relative; display: flex; align-items: stretch; width: 100%;';

    // Mover el input dentro del wrapper
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    // Ajustar estilo del input
    input.style.flex = '1';
    input.style.borderTopRightRadius = '0';
    input.style.borderBottomRightRadius = '0';

    // Botón para abrir el panel
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'money-panel-toggle';
    btn.innerHTML = '<i class="fas fa-money-bill-wave"></i>';
    btn.title = "Seleccionar billetes/monedas";
    btn.onclick = toggleMoneyPanel;
    btn.style.cssText = 'padding: 0 15px; background: var(--primary-color, #4CAF50); color: white; border: none; border-top-right-radius: 4px; border-bottom-right-radius: 4px; cursor: pointer; font-size: 1.1rem;';

    wrapper.appendChild(btn);

    // Listener para limpiar contadores si se escribe manualmente
    input.addEventListener('input', (e) => {
      if (e.isTrusted) { // Solo si es evento de usuario real
        resetMoneyCounts(false); // false = no borrar input, solo visuales
        // Ocultar panel al escribir
        const panel = document.getElementById('money-panel-tooltip');
        const overlay = document.getElementById('money-panel-overlay');
        if (panel) panel.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
      }
    });

    injectMoneyPanelStyles();
  }
}

function injectMoneyPanelStyles() {
  if (document.getElementById('money-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'money-panel-styles';
  style.textContent = `
        /* Estilos comunes */
        .money-panel-tooltip {
            background: white;
            border: 1px solid #ddd;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            border-radius: 8px;
            padding: 15px;
            z-index: 2000;
        }
        
        .money-panel-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 1999;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.3s;
        }
        .money-panel-overlay.active {
            opacity: 1;
            visibility: visible;
        }
        
        /* Escritorio */
        @media (min-width: 769px) {
            .money-panel-tooltip {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 380px;
                display: none;
                animation: fadeIn 0.2s ease-out;
            }
            .money-panel-tooltip.active {
                display: block;
            }
        }

        /* Móvil */
        @media (max-width: 768px) {
            .money-panel-tooltip {
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                width: 100%;
                border-radius: 20px 20px 0 0;
                border: none;
                box-shadow: 0 -4px 20px rgba(0,0,0,0.2);
                padding: 20px;
                z-index: 2000;
                transform: translateY(100%);
                transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
                display: block !important;
            }
            .money-panel-tooltip.active {
                transform: translateY(0);
            }
            
            /* Ajustes grid móvil */
            .money-grid { gap: 12px; }
            .money-btn { height: 55px; font-size: 1.2rem; }
        }

        @keyframes fadeIn { from { opacity: 0; transform: translate(-50%, -45%); } to { opacity: 1; transform: translate(-50%, -50%); } }

        .money-section { margin-bottom: 15px; }
        .money-section-title { font-size: 0.75rem; color: #888; margin-bottom: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
        .money-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        
        .money-btn {
            position: relative;
            border: 1px solid #e0e0e0;
            background: #fff;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            color: #333;
            transition: all 0.1s;
            user-select: none;
            box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        }
        .money-btn:active { transform: scale(0.96); }
        .money-btn:hover { background: #f9f9f9; border-color: #ccc; }
        
        /* Billetes */
        .money-btn.bill {
            height: 45px;
            border-radius: 4px;
            background: linear-gradient(135deg, #fdfbf7 0%, #f4f1ea 100%);
            color: #2e7d32;
            border-color: #c8e6c9;
            font-family: 'Courier New', monospace;
            font-size: 1.1rem;
        }
        .money-btn.bill::before {
            content: '';
            position: absolute;
            left: 3px; top: 3px; bottom: 3px; right: 3px;
            border: 1px dashed #a5d6a7;
            border-radius: 2px;
            pointer-events: none;
        }
        
        /* Monedas */
        .money-btn.coin {
            height: 50px;
            width: 50px;
            border-radius: 50%;
            margin: 0 auto;
            background: radial-gradient(circle at 30% 30%, #fff 0%, #ffd700 100%);
            border: 2px solid #d4af37;
            color: #8a6e22;
            font-size: 1rem;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .money-btn.coin.silver {
            border-color: #bdc3c7;
            background: radial-gradient(circle at 30% 30%, #fff 0%, #bdc3c7 100%);
            color: #555;
        }
        .money-btn.coin.copper {
            border-color: #d35400;
            background: radial-gradient(circle at 30% 30%, #fff 0%, #e67e22 100%);
            color: #a04000;
        }
        
        .money-count-badge {
            position: absolute;
            bottom: -6px;
            right: -6px;
            background: #d32f2f;
            color: white;
            border-radius: 50%;
            min-width: 20px;
            height: 20px;
            padding: 0 4px;
            font-size: 11px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            z-index: 2;
            font-weight: bold;
        }

        .money-remove-btn {
            position: absolute;
            bottom: -6px;
            left: -6px;
            background: rgba(0, 0, 0, 0.05);
            color: #777;
            border: 1px solid rgba(0,0,0,0.1);
            border-radius: 50%;
            width: 22px;
            height: 22px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            cursor: pointer;
            z-index: 3;
            transition: all 0.2s;
        }
        .money-remove-btn:hover { 
            background: rgba(211, 47, 47, 0.1);
            color: #d32f2f;
            border-color: #d32f2f;
            transform: scale(1.1); 
        }
        .money-remove-btn:active { transform: scale(0.9); }
        
        .money-actions {
            display: flex;
            justify-content: space-between;
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid #eee;
        }
        .btn-money-action {
            font-size: 0.8rem;
            padding: 6px 12px;
            background: #f5f5f5;
            border: 1px solid #ddd;
            border-radius: 4px;
            cursor: pointer;
            color: #555;
        }
        .btn-money-action:hover { background: #eee; }
        .btn-money-action.clear { color: #d32f2f; border-color: #ffcdd2; background: #ffebee; }
        .btn-money-action.clear:hover { background: #ffcdd2; }
    `;
  document.head.appendChild(style);
}

function toggleMoneyPanel(e) {
  if (e) e.stopPropagation();
  let panel = document.getElementById('money-panel-tooltip');
  if (!panel) {
    createMoneyPanel();
    panel = document.getElementById('money-panel-tooltip');
  }

  const overlay = document.getElementById('money-panel-overlay');

  if (panel.classList.contains('active')) {
    // Cerrar
    panel.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
  } else {
    // Abrir
    panel.classList.add('active');
    if (overlay) overlay.classList.add('active');

    // Limpiar estilos inline de posicionamiento absoluto (para que CSS fixed funcione)
    panel.style.top = '';
    panel.style.left = '';
    panel.style.bottom = '';
    panel.style.right = '';
  }
}

function positionMoneyPanel(panel) {
  const wrapper = document.getElementById('money-input-wrapper');
  if (!wrapper || !panel) return;

  // Resetear estilos para medir correctamente
  panel.style.top = '';
  panel.style.bottom = '';
  panel.style.left = '';
  panel.style.right = '';
  panel.classList.remove('pos-top', 'pos-bottom');

  const rect = wrapper.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const scrollY = window.scrollY || window.pageYOffset;
  const scrollX = window.scrollX || window.pageXOffset;

  const spaceAbove = rect.top;
  const spaceBelow = window.innerHeight - rect.bottom;
  const margin = 10;

  // Decidir posición vertical (Preferir arriba, si no cabe, abajo)
  if (spaceAbove > panelRect.height + margin || spaceAbove > spaceBelow) {
    // Mostrar Arriba (Coordenadas absolutas al documento)
    panel.style.top = (rect.top + scrollY - panelRect.height - margin) + 'px';
    panel.classList.add('pos-top');
  } else {
    // Mostrar Abajo
    panel.style.top = (rect.bottom + scrollY + margin) + 'px';
    panel.classList.add('pos-bottom');
  }

  // Ajuste Horizontal (Alinear a la derecha del input)
  let leftPos = rect.right + scrollX - panelRect.width;

  // Si se sale por la izquierda, alinear a la izquierda
  if (leftPos < 10) {
    leftPos = rect.left + scrollX;
  }

  panel.style.left = leftPos + 'px';
}

function createMoneyPanel() {
  const wrapper = document.getElementById('money-input-wrapper');
  if (!wrapper) return;

  // Overlay para móvil
  let overlay = document.getElementById('money-panel-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'money-panel-overlay';
    overlay.className = 'money-panel-overlay';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', () => {
      const panel = document.getElementById('money-panel-tooltip');
      if (panel) panel.classList.remove('active');
      overlay.classList.remove('active');
    });
  }

  const panel = document.createElement('div');
  panel.id = 'money-panel-tooltip';
  panel.className = 'money-panel-tooltip';

  // Definición de dinero
  const coins = [1, 2, 5, 10];
  const bills = [20, 50, 100, 200, 500, 1000];

  let html = `
        <div class="money-panel-header" style="text-align: center; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #eee;">
            <div style="font-size: 0.8rem; color: #888; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Total Acumulado</div>
            <div id="money-panel-total" style="font-size: 2.2rem; font-weight: 800; color: var(--primary-color, #2e7d32); line-height: 1.2; margin-top: 5px;">$0.00</div>
        </div>

        <div class="money-section">
            <div class="money-section-title">Billetes</div>
            <div class="money-grid">
                ${bills.map(val => `
                    <div class="money-btn bill" onclick="addMoney(${val})" data-val="${val}">
                        $${val}
                    </div>
                `).join('')}
            </div>
        </div>
        <div class="money-section">
            <div class="money-section-title">Monedas</div>
            <div class="money-grid" style="grid-template-columns: repeat(4, 1fr);">
                ${coins.map(val => `
                    <div class="money-btn coin ${val < 5 ? 'silver' : ''}" onclick="addMoney(${val})" data-val="${val}">
                        $${val}
                    </div>
                `).join('')}
            </div>
        </div>
        <div class="money-actions">
            <button class="btn-money-action clear" onclick="resetMoneyCounts(true)">Limpiar</button>
            <button class="btn-money-action" onclick="document.getElementById('money-panel-tooltip').classList.remove('active'); document.getElementById('money-panel-overlay').classList.remove('active');">Cerrar</button>
        </div>
    `;

  panel.innerHTML = html;
  // IMPORTANTE: Añadir al body para evitar problemas de z-index y overflow
  document.body.appendChild(panel);

  // Listener global para cerrar en escritorio (clic fuera)
  document.addEventListener('click', function closeMoneyPanel(e) {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) return; // En móvil usamos el overlay

    if (panel.classList.contains('active') &&
      !panel.contains(e.target) &&
      !e.target.closest('.money-panel-toggle')) {
      panel.classList.remove('active');
    }
  });

  // Restaurar badges si había estado
  updateMoneyBadges();
}

// Exponer globalmente para los onlick del HTML inyectado
window.addMoney = function (amount) {
  if (!moneyCounts[amount]) moneyCounts[amount] = 0;
  moneyCounts[amount]++;

  updateMoneyInput();
  updateMoneyBadges();
};

window.removeMoney = function (amount) {
  if (moneyCounts[amount] && moneyCounts[amount] > 0) {
    moneyCounts[amount]--;
    if (moneyCounts[amount] === 0) delete moneyCounts[amount];
    updateMoneyInput();
    updateMoneyBadges();
  }
};

window.resetMoneyCounts = function (clearInput = true) {
  moneyCounts = {};
  updateMoneyBadges();
  if (clearInput && checkoutReceivedInput) {
    checkoutReceivedInput.value = '';
    recalcChange();
  }
  updateMoneyPanelTotal(0);
};

function updateMoneyInput() {
  let total = 0;
  for (const [val, count] of Object.entries(moneyCounts)) {
    total += parseInt(val) * count;
  }

  if (checkoutReceivedInput) {
    checkoutReceivedInput.value = total;
    recalcChange();
  }
  updateMoneyPanelTotal(total);
}

function updateMoneyPanelTotal(total) {
  const el = document.getElementById('money-panel-total');
  if (el) el.textContent = formatCurrency(total);
}

function updateMoneyBadges() {
  const panel = document.getElementById('money-panel-tooltip');
  if (!panel) return;

  // Limpiar badges y botones de restar existentes
  panel.querySelectorAll('.money-count-badge, .money-remove-btn').forEach(el => el.remove());

  // Añadir nuevos
  for (const [val, count] of Object.entries(moneyCounts)) {
    if (count > 0) {
      const btn = panel.querySelector(`.money-btn[data-val="${val}"]`);
      if (btn) {
        // Badge de cantidad
        const badge = document.createElement('div');
        badge.className = 'money-count-badge';
        badge.textContent = count;
        btn.appendChild(badge);

        // Botón de restar
        const removeBtn = document.createElement('div');
        removeBtn.className = 'money-remove-btn';
        removeBtn.innerHTML = '<i class="fas fa-minus"></i>';
        removeBtn.title = "Restar uno";
        removeBtn.onclick = (e) => {
          e.stopPropagation(); // Evitar que dispare el addMoney del padre
          removeMoney(val);
        };
        btn.appendChild(removeBtn);
      }
    }
  }
}

// ==========================================
// INTERFAZ DE VOZ (API Pública para VoiceCommander)
// ==========================================
window.posSystem = {
  searchAndAdd: async (query, quantity) => {
    try {
      console.log(`[Voice] Searching for: ${query}, Qty: ${quantity}`);
      // Usar la lógica de búsqueda existente
      const res = await fetch('../api/inventory/products.php?search=' + encodeURIComponent(query), { method: 'GET', headers: { 'Content-Type': 'application/json' }, credentials: 'include' });
      if (!res.ok) return false;

      const resData = await res.json();
      if (!resData.success || !resData.data || resData.data.length === 0) {
        return false;
      }

      // Lógica de desempate:
      // 1. Coincidencia exacta de nombre
      // 2. Primer resultado si la lista es corta
      let product = resData.data.find(p => p.product_name.toLowerCase() === query.toLowerCase());

      if (!product) {
        // Si no hay exacta, tomar el primero (asumiendos la búsqueda ya ordena por relevancia)
        product = resData.data[0];
      }

      if (product) {
        // Agregar al carrito N veces
        for (let i = 0; i < quantity; i++) {
          addProductToCart({
            product_id: parseInt(product.product_id),
            product_name: product.product_name,
            unit_price: parseFloat(product.price),
            image_path: product.image_path,
            stock_quantity: product.stock_quantity !== undefined ? parseInt(product.stock_quantity) : null
          });
        }
        return true;
      }
      return false;
    } catch (e) {
      console.error('Error in voice searchAndAdd', e);
      return false;
    }
  },

  initCheckout: () => {
    // Simular click en carrito si está cerrado
    if (cartPanel && !cartPanel.classList.contains('open')) {
      toggleCartPanel(true);
    }
    // Enfocar input de recibido
    setTimeout(() => {
      if (checkoutReceivedInput) checkoutReceivedInput.focus();
    }, 500);
  },

  clearCart: () => {
    CART = [];
    renderCart();
    showNotification('Carrito vaciado por voz', 'info');
  }
};
