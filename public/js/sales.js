/**
 * Lógica de Punto de Venta (Carrito y Venta) - Versión Simplificada
 */
let CART = [];
let MULTI_CARTS = { '1': [], '2': [], '3': [], '4': [] }; // Soporte para múltiples carritos
let CURRENT_TAB = '1';

// Control de operaciones para evitar duplicados por clicks rápidos
let isCartProcessing = false;

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

// Agregar toggle para footer del carrito y acciones del header
function setupToggles() {
    // Footer Cart Toggle eliminado bajo solicitud del usuario
    // ahora el footer es estático y siempre visible.

    // Header Actions Toggle (Chevron Centrado) - Obsoleto
    // Se mantiene código muerto por si se revierte, pero no afectará si el elemento no existe
    const collapseHeaderBtn = document.getElementById('collapseHeaderBtn');
    const actionsRow = document.getElementById('headerActionsRow');

    if(collapseHeaderBtn && actionsRow) {
        collapseHeaderBtn.onclick = () => {
            /* Logic disabled */
        };
    }
}

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
  
  // Cart Layout Elements
  cartBadge = document.getElementById('mobileCartCount'); 

  
  productGallery = document.getElementById('productGallery');
  categoryBar = document.getElementById('categoryBar');
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
  setupToggles(); // Inicializar toggles (footer y header)

  // Delegación de eventos para el carrito (Fix doble click y performance)
  setupCartEventsDelegation();

  // Inyectar interfaz de pestañas si no existe
  injectCartTabsUI();
  // Configuración del modal de historial
  // Antes se llamaba a injectHistorySidebar, ahora usamos setupHistoryModal
  // Aseguramos que el botón exista antes de llamarlo
  if(document.getElementById('toggleHistoryBtn')) {
      // Definimos la función inline si queremos asegurar su ejecución o renombramos la inyección
      // Pero mejor, actualizamos la referencia si es necesario
      setupHistoryModal(); 
  }

  // Inicializar menú contextual y preferencias
  initContextMenu();

  // View order select
  const viewOrderSelect = document.getElementById('viewOrderSelect');
  if (viewOrderSelect) {
    viewOrderSelect.addEventListener('change', () => {
      applyPrefsAndRender();
    });
  }

  // Reset view prefs
  const resetViewBtn = document.getElementById('resetViewPrefsBtn');
  if (resetViewBtn) {
    resetViewBtn.addEventListener('click', () => {
      try {
        const storeId = document.body.getAttribute('data-store-id') || '1';
        localStorage.removeItem('pos_prefs_' + storeId);
      } catch {}
      if (viewOrderSelect) viewOrderSelect.value = 'default';
      showNotification('Orden restaurado', 'info');
      filterAndRenderProducts();
    });
  }

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
  loadActivePromotions();

  // Preferencias de impresión térmica (ancho y copias)
  const ticketWidthSel = document.getElementById('ticketWidthSelect');
  const ticketCopiesInput = document.getElementById('ticketCopiesInput');
  if (ticketWidthSel && typeof getTicketPrefs === 'function') {
    const prefs = getTicketPrefs();
    ticketWidthSel.value = prefs.width;
    if (ticketCopiesInput) ticketCopiesInput.value = prefs.copies;
    ticketWidthSel.addEventListener('change', () => {
      try { localStorage.setItem('tomodachi_ticket_width', ticketWidthSel.value); } catch (e) {}
    });
  }
  if (ticketCopiesInput) {
    ticketCopiesInput.addEventListener('change', () => {
      let v = parseInt(ticketCopiesInput.value, 10) || 1;
      if (v < 1) v = 1;
      if (v > 5) v = 5;
      ticketCopiesInput.value = v;
      try { localStorage.setItem('tomodachi_ticket_copies', String(v)); } catch (e) {}
    });
  }

  // Fiado: mostrar selector de cliente cuando el método es credit
  const custSelectorGroup = document.getElementById('customerSelectorGroup');
  if (paymentMethodSelect && custSelectorGroup) {
    const updateCustomerSelector = () => {
      const isCredit = paymentMethodSelect.value === 'credit';
      custSelectorGroup.style.display = isCredit ? 'block' : 'none';
      if (isCredit) loadCustomersIntoSelect();
    };
    paymentMethodSelect.addEventListener('change', updateCustomerSelector);
  }

  // Iniciar sync si hay sesión activa
  if (displaySessionUUID) {
    startSyncInterval();
  }
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

  // Mobile View Switcher logic (New)
  const viewSwitchBtns = document.querySelectorAll('.view-switch-btn');
  const productsColumn = document.querySelector('.products-column');
  const cartColumn = document.querySelector('.cart-column');

  if (viewSwitchBtns.length > 0) {
      viewSwitchBtns.forEach(btn => {
          btn.addEventListener('click', () => {
              const target = btn.dataset.target;
              
              viewSwitchBtns.forEach(b => b.classList.remove('active'));
              btn.classList.add('active');

              // Toggle visibility classes
              if (target === 'products-column') {
                  if(productsColumn) productsColumn.classList.add('active');
                  if(cartColumn) cartColumn.classList.remove('active');
              } else {
                  if(cartColumn) cartColumn.classList.add('active');
                  if(productsColumn) productsColumn.classList.remove('active');
              }
          });
      });
  }

  // Eventos de los Nuevos Filtros (Categoría y Orden)
  const categoryFilter = document.getElementById('categoryFilter');
  const sortFilter = document.getElementById('sortFilter');

    // Manejo del Nuevo Menú de Configuración
    const configBtn = document.getElementById('configMenuBtn');
    const configDropdown = document.getElementById('configDropdown');
    const toggleScaleBtn = document.getElementById('toggleScaleBtn');
    const toggleCustomerBtn = document.getElementById('toggleCustomerDisplayBtn');
    const toggleHistoryBtn = document.getElementById('toggleHistoryBtn');

    if (configBtn && configDropdown) {
        configBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            configDropdown.classList.toggle('hidden');
        });

        // Cerrar al hacer clic fuera
        document.addEventListener('click', (e) => {
            if (!configDropdown.contains(e.target) && e.target !== configBtn) {
                configDropdown.classList.add('hidden');
            }
        });
    }

    if(toggleScaleBtn) {
        toggleScaleBtn.addEventListener('click', () => {
             // Solo ocultar dropdown (la acción la maneja initScaleManager)
             if(configDropdown) configDropdown.classList.add('hidden');
        });
    }

    if(toggleCustomerBtn) {
        toggleCustomerBtn.addEventListener('click', () => {
             if(configDropdown) configDropdown.classList.add('hidden');
             // La acción la maneja initCustomerDisplay
        });
    }

    // Botón para copiar enlace de pantalla de cliente (para tablet)
    const copyDisplayLinkBtn = document.getElementById('copyDisplayLinkBtn');
    if (copyDisplayLinkBtn) {
        copyDisplayLinkBtn.addEventListener('click', async () => {
            if (configDropdown) configDropdown.classList.add('hidden');

            try {
                // Enviar carrito actual al servidor para crear/actualizar sesión
                const payload = {
                    cart: getCombinedCartForDisplay(),
                    totals: calculateTotalsForDisplay(),
                    storeInfo: {
                        name: localStorage.getItem('tomodachi_store_name') || document.querySelector('.sidebar-header h2')?.textContent || 'Tomodachi',
                        logo: ''
                    },
                    activeTab: parseInt(CURRENT_TAB),
                    session: displaySessionUUID || undefined
                };

                const res = await fetch('../api/sales/cart_sync.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(payload)
                });
                const json = await res.json();
                if (json.success && json.data && json.data.session) {
                    displaySessionUUID = json.data.session;
                    try { localStorage.setItem('tomodachi_display_session', displaySessionUUID); } catch (_) {}
                    startSyncInterval();
                    showNotification('✓ Enlace generado. El display se actualiza automáticamente', 'success');
                }

                if (!displaySessionUUID) {
                    showNotification('Error al crear sesión', 'error');
                    return;
                }

                // Generar URL con el UUID de sesión
                // Compatible con subcarpeta local (/Tomodachi/public) y dominio propio (raíz /public)
                const baseUrl = window.location.origin + window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1) + 'customer-display.html';
                const url = baseUrl + '?cart=' + displaySessionUUID;

                navigator.clipboard.writeText(url).then(() => {
                    showNotification('✓ Enlace copiado al portapapeles', 'success');
                }).catch(() => {
                    const textarea = document.createElement('textarea');
                    textarea.value = url;
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                    showNotification('✓ Enlace copiado al portapapeles', 'success');
                });
            } catch (e) {
                console.error('Error al crear sesión:', e);
                showNotification('Error al generar enlace', 'error');
            }
        });
    }

    if(toggleHistoryBtn) {
        toggleHistoryBtn.addEventListener('click', () => {
             if(configDropdown) configDropdown.classList.add('hidden');
             // La acción la maneja setupHistoryModal
        });
    }

    // Header Actions Toggle (Chevron Centrado) - YA NO SE USA
    /* 
    const collapseHeaderBtn = document.getElementById('collapseHeaderBtn'); 
    ... Eliminar o comentar
    */

  if(categoryFilter) {
      categoryFilter.addEventListener('change', (e) => {
          activeCategoryId = e.target.value === 'all' ? null : e.target.value;
          filterAndRenderProducts();
      });
  }

  if(sortFilter) {
      sortFilter.addEventListener('change', (e) => {
          filterAndRenderProducts(); // Re-render con orden
      });
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
  
  // Simple Swipe Navigation for Mobile
  let touchStartX = 0;
  const contentGrid = document.querySelector('.pos-content-grid');
  
  if (contentGrid) {
      contentGrid.addEventListener('touchstart', e => {
          touchStartX = e.changedTouches[0].screenX;
      }, {passive: true});
      
      contentGrid.addEventListener('touchend', e => {
          const touchEndX = e.changedTouches[0].screenX;
          const diff = touchStartX - touchEndX;
          const threshold = 50; // min swipe distance
          
          if (Math.abs(diff) < threshold) return;
          
          if (window.innerWidth <= 900) {
              const productsBtn = document.querySelector('.view-switch-btn[data-target="products-column"]');
              const cartBtn = document.querySelector('.view-switch-btn[data-target="cart-column"]');
              
              if (diff > 0) { // Swiped Left: Go to Cart (if on Products)
                   if (productsBtn && productsBtn.classList.contains('active') && cartBtn) {
                       cartBtn.click();
                   }
              } else { // Swiped Right: Go to Products (if on Cart)
                  if (cartBtn && cartBtn.classList.contains('active') && productsBtn) {
                      productsBtn.click();
                  }
              }
          }
      }, {passive: true});
  }
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
    searchResults.innerHTML = list.map((p, index) => {
      const imagePath = getRelativeImagePath(p.image_path);
      return `
      <div class="gallery-item" data-id="${p.product_id}" data-price="${p.price}" data-stock="${p.stock_quantity !== undefined ? p.stock_quantity : ''}" data-image="${p.image_path || ''}" data-is_bulk="${p.is_bulk || 0}" data-bulk_unit="${p.bulk_unit || 'kg'}" data-category="${p.category_id || ''}" title="${escapeHtml(p.product_name)}" style="animation-delay: ${Math.min(index * 0.05, 0.5)}s">
        <div class="img-wrap">${imagePath ? `<img src="${imagePath}" alt="img" onerror="this.outerHTML='<span class=\\'no-img\\'>Sin imagen</span>'">` : '<span class="no-img">Sin imagen</span>'}</div>
        <div class="item-details">
          <div class="g-name" title="${escapeHtml(p.product_name)}">${escapeHtml(p.product_name)}</div>
          <div class="g-price">${formatCurrency(p.price)}</div>
        </div>
      </div>
    `}).join('');

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
          stock_quantity: parseInt(el.getAttribute('data-stock')),
          is_bulk: parseInt(el.getAttribute('data-is_bulk')) || 0,
          bulk_unit: el.getAttribute('data-bulk_unit') || 'kg',
          category_id: el.getAttribute('data-category') || undefined
        });

        // Pequeño delay para apreciar el feedback antes de cerrar resultados
        setTimeout(() => {
          searchInput.value = '';
          searchResults.classList.add('hidden');
          productGallery.style.display = 'grid';
        }, 250);
      });
    });

    addIndicatorsToItems();
  } catch (e) {
    console.error(e);
  }
}

function addProductToCart(prod) {
  // Evitar duplicados por clicks rápidos (Debounce de operación)
  if (isCartProcessing) return;
  isCartProcessing = true;

  // Recargar promociones activas para asegurar tener las últimas reglas
  loadActivePromotions().then(() => {
      // Si es producto a granel, solicitar cantidad primero
      if (prod.is_bulk == 1) {
        promptBulkQuantity(prod);
      } else {
        _addToCartInternal(prod);
      }
  }).finally(() => {
     // Liberar bloqueo después de un breve delay para evitar rebotes
     setTimeout(() => { isCartProcessing = false; }, 300);
  });
}

function _addToCartInternal(prod) {
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
      stock_quantity: maxStock, // Guardar referencia del stock
      is_bulk: prod.is_bulk || 0,
      bulk_unit: prod.bulk_unit || 'kg',
      category_id: prod.category_id
    });
  }
  playSound('Sound2.mp3');
  renderCart();
  showNotification('Producto añadido', 'success');
}




/* Solución para el problema de doble click: DELEGACIÓN DE EVENTOS */
function setupCartEventsDelegation() {
    if(!cartBody) return;

    // Verificar si ya se adjuntaron eventos para evitar duplicados
    if (cartBody.dataset.eventsAttached === 'true') {
        console.log('Cart events already attached, skipping...');
        return;
    }

    // Solo un listener para todos los items
    cartBody.addEventListener('click', (e) => {
        // Encontrar target relevante
        const target = e.target;
        
        // 1. STEPPER BTN (+ / -)
        const stepBtn = target.closest('.step-btn');
        if (stepBtn) {
            e.stopPropagation();
            e.preventDefault(); // Prevenir selección o doble trigger
            
            // Protección contra clicks rápidos (rebote)
            if (isCartProcessing) return;
            isCartProcessing = true;
            // Liberar bloqueo rápido para permitir interacción fluida pero evitar rebotes mecánicos
            setTimeout(() => isCartProcessing = false, 250);

            handleStepBtnClick(stepBtn);
            return;
        }

        // 2. QTY DISPLAY (Manual Entry)
        const qtyDisplay = target.closest('.qty-display');
        if (qtyDisplay) {
            e.stopPropagation();
// ...

            const id = parseInt(qtyDisplay.getAttribute('data-id'));
            const it = CART.find(i => i.product_id === id);
            if(it && it.is_bulk == 1) promptBulkQuantity(it);
            return;
        }

        // 3. EDIT OPTIONS (Price or Item click?)
        // Se pidió que al seleccionar precio pueda modificarlo
        const priceArea = target.closest('.item-price-area');
        if(priceArea) {
             e.stopPropagation();
             const id = parseInt(priceArea.getAttribute('data-id'));
             openItemOptions(id);
             return;
        }
    });

    // Marcar que ya está setup
    cartBody.dataset.eventsAttached = 'true';
}

function handleStepBtnClick(btn) {
    const id = parseInt(btn.getAttribute('data-id'));
    const action = btn.getAttribute('data-action');
    const it = CART.find(i => i.product_id === id);
    if(!it) return;

    let step = it.is_bulk == 1 ? 0.1 : 1; 
    if(it.is_bulk == 1 && action === 'minus' && it.quantity <= 0.1) step = 0.01;

    let newQty = action === 'plus' ? it.quantity + step : it.quantity - step;
    
    // Fix JS float precision
    newQty = Math.round(newQty * 1000) / 1000;

    if(newQty <= 0) {
           CART = CART.filter(i => i.product_id !== id);
           playSound('Sound3.mp3');
    } else {
        // Stock Check
        const maxStock = (it.stock_quantity !== undefined && it.stock_quantity !== null && it.stock_quantity !== '') ? parseFloat(it.stock_quantity) : null;
        if (action === 'plus' && maxStock !== null && newQty > maxStock) {
            showNotification(`Stock máximo alcanzado (${maxStock})`, 'warning');
            return; 
        }
        it.quantity = newQty;
    }
    
    recalcItemPrice(it);
    renderCart();
}

function renderCart() {
  // Persistencia: Guardar estado multi-carrito
  MULTI_CARTS[CURRENT_TAB] = CART;
  localStorage.setItem('tomodachi_multi_carts', JSON.stringify(MULTI_CARTS));

  // Actualizar badge de la pestaña actual
  updateTabBadge(CURRENT_TAB);

  if (!cartBody || !emptyCartMsg) return;

  // Aplicar promociones ANTES de renderizar el HTML para que los precios
  // de cada producto reflejen el descuento (applyPromotions se llama dentro de
  // recalcTotals, pero recalcTotals se ejecuta DESPUÉS del renderizado)
  applyPromotions();
  CART.forEach(item => { item.subtotal = item.quantity * item.unit_price; });

  if (!CART.length) {
    cartBody.innerHTML = '';
    emptyCartMsg.style.display = 'block';
    if (finalizeSaleBtn) finalizeSaleBtn.disabled = true;
    if (cartBadge) {
      cartBadge.textContent = '0';
      cartBadge.classList.add('hidden');
      cartBadge.style.display = 'none';
    }
    if(panelTotalEl) {
        panelTotalEl.textContent = formatCurrency(0);
        document.getElementById('cartSubtotal').textContent = formatCurrency(0);
    }
    return;
  }

  emptyCartMsg.style.display = 'none';
  if (finalizeSaleBtn) finalizeSaleBtn.disabled = false;

  // Actualizar badge global si existe
  if (cartBadge) {
    const totalItems = CART.reduce((acc, item) => acc + item.quantity, 0); // O CART.length
    cartBadge.textContent = totalItems > 99 ? '99+' : Math.round(totalItems);
    cartBadge.classList.remove('hidden');
    cartBadge.style.display = '';
  }

    // Generate HTML (Optimized Layout requested)
    // Orden Inverso: Mostrar el último item agregado primero (LIFO visual)
    const displayCart = [...CART].reverse();

    // [Image] [Center: Name + Price below] [Right: Stepper]
    cartBody.innerHTML = displayCart.map(item => {
      let imgHtml = '<div class="cart-item-img-placeholder"><i class="fas fa-box"></i></div>';
      const imagePath = getRelativeImagePath(item.image_path);
      
      if (imagePath) {
        imgHtml = `<img src="${imagePath}" alt="img" class="cart-item-img" onerror="this.outerHTML='<div class=\\'cart-item-img-placeholder\\'><i class=\\'fas fa-box\\'></i></div>'">`;
      }

      // Price logic with discount indicator
      let priceHtml;
      if (item.unit_price < item.original_price) {
          const origTotal = item.quantity * item.original_price;
          priceHtml = `<span class="cart-orig-price">${formatCurrency(origTotal)}</span> <span class="cart-disc-price">${formatCurrency(item.subtotal)}</span>`;
          if (item.discount_type && item.discount_type !== 'none') {
              const discountLabel = item.discount_type === 'percent' ? `${item.discount_value}%` :
                                    item.discount_type === 'fixed' ? `-$${item.discount_value}` :
                                    item.discount_type === 'nxn' ? `${item.nxn_buy}x${item.nxn_pay}` : '';
              priceHtml += ` <span class="cart-disc-badge">${discountLabel}</span>`;
          }
      } else {
          priceHtml = formatCurrency(item.subtotal);
      }
      
      const unitLabel = item.is_bulk == 1 ? ` ${item.bulk_unit || 'kg'}` : '';

      return `
      <div class="cart-item-card">
          <!-- Left: Image -->
          <div class="cart-item-left">
              ${imgHtml}
          </div>
          
          <!-- Center: Name + Price -->
          <div class="cart-item-center">
              <div class="cart-item-title">${escapeHtml(item.product_name)}</div>
              <div class="item-price-area" data-id="${item.product_id}" title="Editar precio/descuento">
                  ${priceHtml}
              </div>
          </div>
          
          <!-- Right: Controls (Stepper) -->
          <div class="cart-item-right">
              <div class="cart-item-stepper">
                  <button class="step-btn minus" data-id="${item.product_id}" data-action="minus"><i class="fas fa-minus"></i></button>
                  <span class="qty-display" data-id="${item.product_id}">${parseFloat(item.quantity) + unitLabel}</span>
                  <button class="step-btn plus" data-id="${item.product_id}" data-action="plus"><i class="fas fa-plus"></i></button>
              </div>
          </div>
      </div>`;
    }).join('');

    // NOTA: Ya no vinculamos eventos aquí dentro porque usamos delegación en setupCartEventsDelegation()
    
  recalcTotals();
}

// Función para solicitar cantidad/peso de productos a granel
function promptBulkQuantity(prod) {
  const unit = prod.bulk_unit || 'kg';
  const unitLabel = unit === 'kg' ? 'kilogramos' : 
                    unit === 'g' ? 'gramos' :
                    unit === 'L' ? 'litros' :
                    unit === 'mL' ? 'mililitros' :
                    unit === 'lb' ? 'libras' :
                    unit === 'oz' ? 'onzas' :
                    unit === 'pza' ? 'piezas' :
                    unit === 'm' ? 'metros' : unit;

  // Verificar si hay balanza disponible
  const hasScale = window.scaleManager && window.scaleManager.isConnected;

  // Crear modal simple para ingreso de cantidad
  const modalHtml = `
    <div id="bulkQuantityModal" class="modal-overlay active">
      <div class="modal-content" style="max-width: 400px;">
        <div class="modal-header">
          <h3><i class="fas fa-weight-hanging"></i> ${escapeHtml(prod.product_name)}</h3>
          <button class="modal-close" onclick="closeBulkModal()"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">
          <p style="margin-bottom: 10px; color: var(--text-light);">
            <strong>Precio por ${unit}:</strong> ${formatCurrency(prod.unit_price)}
          </p>
          <div class="form-group">
            <label for="bulkQuantityInput">Cantidad en ${unitLabel}:</label>
            <input type="number" id="bulkQuantityInput" step="0.001" min="0.001" placeholder="Ej: 1.5" 
                   style="width: 100%; padding: 10px; font-size: 1.1rem;" autofocus>
          </div>
          ${hasScale ? `
            <div style="margin-top: 10px; padding: 10px; background: var(--success-color); border-radius: 6px; text-align: center;">
              <p style="color: var(--success-color); margin: 0; font-size: 0.9rem; font-weight: 600;">
                <i class="fas fa-balance-scale"></i> Leyendo balanza...
              </p>
              <p style="color: var(--success-color); margin: 5px 0 0 0; font-size: 0.85rem;">
                Peso actual: <strong id="bulkScaleWeight">--.--</strong> ${unit}
              </p>
            </div>
          ` : ''}
          <div id="bulkTotalPreview" style="margin-top: 15px; padding: 10px; background: var(--bg-light); border-radius: 6px; text-align: center;">
            <strong>Total: $0.00</strong>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" onclick="closeBulkModal()">Cancelar</button>
          ${hasScale ? `<button class="btn-secondary" onclick="useBulkScaleWeight()" style="flex: 1;">
            <i class="fas fa-sync"></i> Usar Peso de Balanza
          </button>` : ''}
          <button class="btn-primary" onclick="confirmBulkQuantity()">Agregar al Carrito</button>
        </div>
      </div>
    </div>
  `;
  
  // Insertar modal en el DOM
  let modalContainer = document.getElementById('bulkQuantityModal');
  if (modalContainer) modalContainer.remove();
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  
  // Guardar producto temporalmente
  window._tempBulkProduct = prod;
  window._bulkScaleLastWeight = null;
  
  // Auto-calcular total al escribir
  const input = document.getElementById('bulkQuantityInput');
  const preview = document.getElementById('bulkTotalPreview');
  input.addEventListener('input', () => {
    const qty = parseFloat(input.value) || 0;
    const total = qty * prod.unit_price;
    preview.innerHTML = `<strong>Total: ${formatCurrency(total)}</strong>`;
  });
  
  // Permitir confirmar con Enter
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmBulkQuantity();
  });
  
  // Si hay balanza, monitorear peso
  if (hasScale && window.scaleManager) {
    const scaleCallback = (data) => {
      window._bulkScaleLastWeight = data.weight;
      const weightEl = document.getElementById('bulkScaleWeight');
      if (weightEl) {
        weightEl.textContent = data.weight.toFixed(3);
      }
    };
    
    // Registrar temporalmente el callback
    window._bulkScaleCallback = scaleCallback;
    if (window.scaleManager.on) {
      window.scaleManager.on('onWeight', scaleCallback);
    }
  }
  
  // Enfocar input
  setTimeout(() => input.focus(), 100);
}

// Cerrar modal de cantidad a granel
function closeBulkModal() {
  const modal = document.getElementById('bulkQuantityModal');
  if (modal) modal.remove();
  
  // Limpiar callback de balanza
  if (window._bulkScaleCallback && window.scaleManager && window.scaleManager.off) {
    window.scaleManager.off('onWeight', window._bulkScaleCallback);
  }
  
  window._tempBulkProduct = null;
  window._bulkScaleLastWeight = null;
  window._bulkScaleCallback = null;
}

// Usar el peso de la balanza en el campo de cantidad
function useBulkScaleWeight() {
  if (!window._bulkScaleLastWeight) {
    showNotification('Esperando peso de la balanza...', 'warning');
    return;
  }
  
  const input = document.getElementById('bulkQuantityInput');
  if (input) {
    input.value = window._bulkScaleLastWeight.toFixed(3);
    input.dispatchEvent(new Event('input'));
    input.focus();
  }
}

// Confirmar y agregar producto a granel al carrito
function confirmBulkQuantity() {
  if (isCartProcessing) return;
  isCartProcessing = true;

  const input = document.getElementById('bulkQuantityInput');
  const quantity = parseFloat(input.value);
  
  if (!quantity || quantity <= 0) {
    showNotification('Ingresa una cantidad válida', 'warning');
    input.focus();
    isCartProcessing = false;
    return;
  }
  
  const prod = window._tempBulkProduct;
  if (!prod) {
    isCartProcessing = false;
    return;
  }

  loadActivePromotions().then(() => {
    // Buscar si ya existe en el carrito
    const existing = CART.find(i => i.product_id === prod.product_id);
    
    if (existing) {
      existing.quantity = parseFloat(existing.quantity) + quantity;
      recalcItemPrice(existing);
    } else {
      CART.push({
        product_id: prod.product_id,
        product_name: prod.product_name,
        unit_price: prod.unit_price,
        original_price: prod.unit_price,
        quantity: quantity,
        subtotal: prod.unit_price * quantity,
        image_path: prod.image_path,
        discount_type: 'none',
        discount_value: 0,
        nxn_buy: 0,
        nxn_pay: 0,
        stock_quantity: prod.stock_quantity,
        is_bulk: 1,
        bulk_unit: prod.bulk_unit || 'kg',
        category_id: prod.category_id
      });
    }
    
    playSound('Sound2.mp3');
    renderCart();
    showNotification(`${quantity} ${prod.bulk_unit} agregados`, 'success');
    closeBulkModal();
  }).finally(() => {
    setTimeout(() => isCartProcessing = false, 300);
  });
}

// Helper para badges de pestañas
function updateTabBadge(tabId) {
  const btn = document.querySelector(`.cart-tab-btn[data-tab="${tabId}"]`);
  if (!btn) return;

  const items = MULTI_CARTS[tabId] || [];
  // Contar cantidad de productos DIFERENTES (no la suma de cantidades)
  const count = items.length;

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
            background: var(--bg-light);
            padding: 10px 10px 0;
            border-bottom: 1px solid var(--border-color);
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
            background: var(--border-color);
            color: var(--text-light);
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
        .cart-tab-btn:hover { background: var(--bg-light); }
        
        .cart-tab-btn.active {
            background: var(--bg-card);
            color: var(--primary-color, #2e7d32);
            border-color: var(--border-color);
            border-bottom-color: var(--bg-card);
            margin-bottom: -1px;
            box-shadow: 0 -2px 4px rgba(0,0,0,0.02);
            font-weight: 700;
            z-index: 2;
        }
        
        .cart-tab-btn .tab-icon { font-size: 1.1rem; }
        .cart-tab-btn .tab-label { display: inline-block; }
        
        /* Badge de contador */
        .tab-badge {
            background: var(--danger-color);
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

// Modal de Historial (Reemplazo de Setup)
function setupHistoryModal() {
    const modal = document.getElementById('historyModal');
    const openBtn = document.getElementById('toggleHistoryBtn');
    const closeBtn = document.getElementById('closeHistoryModalBtn');
    const refreshBtn = document.getElementById('refreshHistoryBtn');
    const body = document.getElementById('historyModalBody');
  
    if(openBtn) {
        openBtn.onclick = (e) => {
            e.preventDefault();
            if(modal) {
                modal.classList.remove('hidden');
                modal.classList.add('active'); // Asegurar visibilidad con clase active si se usa
                renderHistoryContent();
            }
        };
    }
  
    if(closeBtn && modal) {
        closeBtn.onclick = () => {
            modal.classList.add('hidden');
            modal.classList.remove('active');
        };
    }

    if(refreshBtn) {
        refreshBtn.onclick = () => renderHistoryContent();
    }
  
    // Close on outside click is handled by CSS overlay usually, but adding JS support
    if(modal) {
        modal.onclick = (e) => {
            if(e.target === modal) {
                modal.classList.add('hidden');
                modal.classList.remove('active');
            }
        };
    }
  
    async function renderHistoryContent() {
        if(!body) return;
        body.innerHTML = `<div class="empty-state" style="text-align:center; padding: 20px; color: var(--text-muted);">
            <i class="fas fa-spinner fa-spin fa-2x"></i><p>Cargando historial...</p>
        </div>`;
        
        try {
            // Fetch real data
            const res = await fetch('../api/sales/get_sales.php?limit=20', { method: 'GET' });
            // Check session/json validity
            const contentType = res.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
                throw new Error("Respuesta no válida del servidor");
            }

            const data = await res.json();
            
            if(!data.success || !data.data || data.data.length === 0) {
                 body.innerHTML = `<div class="empty-state" style="text-align:center; padding: 20px; color: var(--text-muted);">
                    <i class="fas fa-history fa-2x"></i><p>No hay ventas recientes.</p>
                 </div>`;
                 return;
            }
  
            body.innerHTML = data.data.map(sale => {
                const total = parseFloat(sale.total).toFixed(2);
                const date = new Date(sale.sale_date).toLocaleString();
                const payMethod = sale.payment_method === 'cash' ? 'Efectivo' : 
                                 sale.payment_method === 'card' ? 'Tarjeta' : 
                                 sale.payment_method === 'transfer' ? 'Transferencia' : 'Mixto';

                return `
                <div class="history-card" style="border-left: 4px solid var(--primary-color); padding: 12px; margin-bottom: 10px; background: var(--bg-card); border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <div class="history-card-header" style="display: flex; justify-content: space-between; margin-bottom: 6px; border-bottom: 1px dashed var(--border-color); padding-bottom: 6px;">
                        <span class="h-id" style="font-weight: bold;">#${sale.sale_id}</span>
                        <span class="h-date" style="font-size: 0.85rem; color: var(--text-muted);">${date}</span>
                    </div>
                    <div class="history-card-body" style="font-size: 0.9rem; color: var(--text-medium);">
                        <div style="display: flex; justify-content: space-between;">
                            <span>Items: <strong>${sale.total_items || '?'}</strong></span>
                            <span>Pago: <strong>${payMethod}</strong></span>
                        </div>
                    </div>
                    <div class="history-card-footer" style="margin-top: 8px; display: flex; justify-content: space-between; align-items: center;">
                        <div class="h-total-price" style="font-size: 1.1rem; font-weight: bold; color: var(--text-color);">$${total}</div>
                        <button class="btn-reprint" onclick="viewSaleDetails(${sale.sale_id})" style="background: var(--bg-light); border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;"><i class="fas fa-eye"></i> Ver</button>
                    </div>
                </div>
            `}).join('');
  
        } catch (e) {
            console.error("Error loading history", e);
            body.innerHTML = `<div class="empty-state" style="text-align:center; padding: 20px; color: firebrick;">
                <i class="fas fa-exclamation-triangle"></i><p>Error al cargar historial.</p>
            </div>`;
        }
    }
}

// Función global para ver detalles (placeholder por ahora)
window.viewSaleDetails = function(id) {
    alert("Pronto: Detalles de venta #" + id);
    // Aquí se podríá implementar otro modal o redirección
};


function renderHistoryView() {
  const container = document.getElementById('historyPanelBody');
  if (!container) return;

  // Cargar datos
  const saved = localStorage.getItem('tomodachi_recent_sales');
  let sales = [];
  try { sales = JSON.parse(saved) || []; } catch (e) { }

  let html = '';

  if (sales.length === 0) {
    html += '<div class="empty-cart" style="text-align: center; padding: 20px; color: var(--text-muted);">No hay ventas recientes registradas en este dispositivo.</div>';
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

  // Marcar como editado manualmente para que applyPromotions no lo sobreescriba
  item.manual_edit = type !== 'none';

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
  // Aplicar Promociones Automáticas antes de calcular totales
  applyPromotions();

  const subtotal = CART.reduce((s, i) => s + i.subtotal, 0);
  const discount = (discountInput && discountInput.value) ? parseFloat(discountInput.value) : 0;
  const promoDiscount = (typeof CURRENT_BILL_DISCOUNT !== 'undefined') ? CURRENT_BILL_DISCOUNT : 0;
  const tax = (taxInput && taxInput.value) ? parseFloat(taxInput.value) : 0;
  const total = Math.max(0, subtotal - discount - promoDiscount + tax);
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
      } else if (method === 'credit') {
        // Fiado: requiere cliente seleccionado
        const custSel = document.getElementById('customerSelect');
        canFinalize = total > 0 && custSel && parseInt(custSel.value, 10) > 0;
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
    items: CART.map(i => ({ product_id: i.product_id, quantity: i.quantity })),
    payment_method: method,
    discount: (discountInput && discountInput.value) ? parseFloat(discountInput.value) : 0,
    tax: (taxInput && taxInput.value) ? parseFloat(taxInput.value) : 0
  };

  // Añadir cash_amount si es necesario
  if ((method === 'cash' || method === 'mixed') && checkoutReceivedInput) {
    payload.cash_amount = parseFloat(checkoutReceivedInput.value) || 0;
  }

  // Fiado: cliente y pago parcial
  if (method === 'credit') {
    const custSel = document.getElementById('customerSelect');
    payload.customer_id = custSel ? parseInt(custSel.value, 10) || 0 : 0;
    payload.amount_paid = parseFloat((document.getElementById('apartadoPaidInput') || {}).value) || 0;
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
      const subtotalCart = CART.reduce((s, i) => s + (i.subtotal != null ? i.subtotal : i.unit_price * i.quantity), 0);
      const ticketData = {
        items: CART.map(i => ({
          product_name: i.product_name,
          quantity: i.quantity,
          unit_price: i.unit_price,
          total: i.subtotal != null ? i.subtotal : i.unit_price * i.quantity
        })),
        subtotal: subtotalCart,
        discount: parseFloat((discountInput && discountInput.value) || 0),
        tax: parseFloat((taxInput && taxInput.value) || 0),
        total: resData.total != null ? resData.total : CART.reduce((s, i) => s + i.subtotal, 0),
        date: new Date().toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        sale_id: resData.sale_id || '---',
        cashier: resData.cashier_name || 'Cajero',
        payment_method: paymentMethodSelect ? paymentMethodSelect.value : 'cash',
        qr_payload: `TOMODISALE|${resData.sale_id || ''}|${(resData.total != null ? resData.total : 0).toFixed(2)}`
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
    // Modo offline: si falló la red (sin internet), encolar la venta
    if ((e instanceof TypeError || e.name === 'TypeError' || e.message.includes('Failed to fetch')) && typeof window.offlineEnqueueSale === 'function') {
      try {
        await window.offlineEnqueueSale(payload);
        showNotification('Sin conexión: venta guardada, se sincronizará al recuperar internet', 'warning');
        // Limpiar carrito (quedó encolado)
        CART = [];
        MULTI_CARTS[CURRENT_TAB] = [];
        localStorage.setItem('tomodachi_multi_carts', JSON.stringify(MULTI_CARTS));
        renderCart();
      } catch (qe) {
        showNotification('No se pudo guardar la venta offline', 'error');
      }
    } else {
      showNotification('Error al procesar venta: ' + e.message, 'error');
    }
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

    if (!catRes.ok || !prodRes.ok) return; // Simple check

    const catData = await catRes.json();
    const prodData = await prodRes.json();

    if (catData.success) {
      allCategories = catData.data || [];
    }
    
    // Si la respuesta de productos es un array directo o tiene propiedad data
    if (Array.isArray(prodData)) {
         allProducts = prodData;
    } else if (prodData.success) {
         allProducts = prodData.data || [];
    } else {
         allProducts = [];
    }

    // Poblar Select de Categorías
    const catSelect = document.getElementById('categoryFilter');
    if (catSelect) {
        // Mantener la opción "Todas" y agregar las demás
        catSelect.innerHTML = '<option value="all">Todas las categorías</option>';
        allCategories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.category_id;
            opt.textContent = cat.category_name || cat.name || 'Sin nombre';
            catSelect.appendChild(opt);
        });
    }

    filterAndRenderProducts(); // Render inicial
  } catch (e) {
    console.error('Error loading data:', e);
  }
}

function filterAndRenderProducts() {
    let filtered = allProducts;

    // 1. Filtro de Categoría
    if (activeCategoryId && activeCategoryId !== 'all') {
        filtered = filtered.filter(p => String(p.category_id || '') === String(activeCategoryId));
    }

    // 2. Ordenamiento
    const sortVal = document.getElementById('sortFilter') ? document.getElementById('sortFilter').value : 'default';
    
    // Crear copia para no mutar original
    filtered = [...filtered];

    switch(sortVal) {
        case 'price_asc':
            filtered.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
            break;
        case 'price_desc':
            filtered.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
            break;
        case 'name_asc':
            filtered.sort((a, b) => a.product_name.localeCompare(b.product_name));
            break;
        case 'newest':
            filtered.sort((a, b) => b.product_id - a.product_id); 
            break;
        default:
            // "Relevancia" o Default — aplicar preferencias
            const viewOrder = document.getElementById('viewOrderSelect');
            const viewVal = viewOrder ? viewOrder.value : 'default';
            if (viewVal === 'favorites') {
                filtered.sort((a, b) => {
                    const prefs = getPrefs();
                    const aFav = prefs.favorites.indexOf(a.product_id);
                    const bFav = prefs.favorites.indexOf(b.product_id);
                    return (aFav > -1 ? aFav - 10000 : 0) - (bFav > -1 ? bFav - 10000 : 0);
                });
            } else if (viewVal === 'pinned') {
                filtered.sort((a, b) => {
                    const prefs = getPrefs();
                    const aPin = prefs.pinned.indexOf(a.product_id);
                    const bPin = prefs.pinned.indexOf(b.product_id);
                    return (aPin > -1 ? aPin - 10000 : 0) - (bPin > -1 ? bPin - 10000 : 0);
                });
            } else {
                filtered = applyPrefsToFiltered(filtered);
            }
            break;
    }

    renderGallery(filtered);
}


function calculatePromoPrice(product) {
  if (!ACTIVE_PROMOTIONS || ACTIVE_PROMOTIONS.length === 0) return null;
  
  // Solo buscamos promos de tipo simple para mostrar precio unitario directo
  const simplePromos = ACTIVE_PROMOTIONS.filter(p => 
      p.type === 'simple_discount' && isTarget({ ...product, quantity: 1, original_price: product.price }, p)
  );

  if (simplePromos.length === 0) return null;

  // Aplicar la mejor promo disponible
  let bestPrice = parseFloat(product.price);
  let appliedPromo = null;

  simplePromos.forEach(promo => {
      let price = parseFloat(product.price);
      let discount = 0;
      
      if (promo.discount_type === 'percentage') {
          discount = price * (parseFloat(promo.discount_value) / 100);
      } else {
          discount = parseFloat(promo.discount_value);
      }
      
      let newPrice = price - discount;
      if (newPrice < 0) newPrice = 0;
      
      if (newPrice < bestPrice) {
          bestPrice = newPrice;
          appliedPromo = promo;
      }
  });

  return appliedPromo ? bestPrice : null;
}

function renderGallery(list, animate = false) {
  if (!productGallery) return;

  // Limpiar clases de animación CSS antiguas
  productGallery.classList.remove('slide-in-left', 'slide-in-right');
  
  // Asegurar que searchResults esté oculto si mostramos galería
  if (searchResults) searchResults.classList.add('hidden');
  productGallery.style.display = 'grid';

  if (!list || list.length === 0) {
    productGallery.innerHTML = '<div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);"><i class="fas fa-search" style="font-size: 2rem; margin-bottom: 10px;"></i><p>No se encontraron productos</p></div>';
    return;
  }

  // Renderizar items con estructura optimizada
  productGallery.innerHTML = list.map(p => {
    const imagePath = getRelativeImagePath(p.image_path);
    const promoPrice = calculatePromoPrice(p);
    const hasPromo = promoPrice !== null && promoPrice < parseFloat(p.price);
    
    let priceHtml = '';
    if (hasPromo) {
         priceHtml = `
            <span class="original-price" style="text-decoration: line-through; font-size: 0.8em; color: var(--text-muted);">${formatCurrency(p.price)}</span>
            <span class="promo-price" style="color: var(--danger-color); font-weight: bold;">${formatCurrency(promoPrice)}</span>
         `;
    } else {
         priceHtml = `<span class="current-price">${formatCurrency(p.price)}</span>`;
    }

    const stockBadge = (p.stock_quantity !== undefined && p.stock_quantity !== null && p.stock_quantity !== '') 
          ? `<div class="stock-badge ${p.stock_quantity < 5 ? 'low' : ''}">${p.stock_quantity}</div>` 
          : '';

    return `
      <div class="gallery-item" 
           data-id="${p.product_id}" 
           data-price="${p.price}" 
           data-stock="${p.stock_quantity !== undefined ? p.stock_quantity : ''}" 
           data-image="${p.image_path || ''}" 
           data-is_bulk="${p.is_bulk || 0}" 
           data-bulk_unit="${p.bulk_unit || 'kg'}" 
           data-category="${p.category_id || ''}"
           title="${escapeHtml(p.product_name)}">
             
        <div class="img-wrap">
            ${imagePath ? `<img src="${imagePath}" loading="lazy" alt="${escapeHtml(p.product_name)}" onerror="this.parentNode.innerHTML='<i class=\\'fas fa-box\\'></i>'">` : '<i class="fas fa-box" style="color:var(--text-light); font-size:1.5rem;"></i>'}
            ${stockBadge}
        </div>
        
        <div class="item-details">
            <h4 class="g-name" title="${escapeHtml(p.product_name)}">${escapeHtml(p.product_name)}</h4>
            <div class="g-price">${priceHtml}</div>
        </div>
      </div>
    `;
  }).join('');

  // Re-attach events
  Array.from(productGallery.querySelectorAll('.gallery-item')).forEach(el => {
      el.addEventListener('click', () => {
        // Feedback visual
        const imgWrap = el.querySelector('.img-wrap');
        if(imgWrap) {
            imgWrap.style.transform = 'scale(0.95)';
            setTimeout(() => imgWrap.style.transform = '', 150);
        }

        addProductToCart({
          product_id: parseInt(el.getAttribute('data-id')),
          product_name: el.querySelector('h4').textContent,
          unit_price: parseFloat(el.getAttribute('data-price')),
          image_path: el.getAttribute('data-image'),
          stock_quantity: el.getAttribute('data-stock'),
          is_bulk: parseInt(el.getAttribute('data-is_bulk')) || 0,
          bulk_unit: el.getAttribute('data-bulk_unit') || 'kg',
          category_id: el.getAttribute('data-category') || undefined
        });
      });
  });

  addIndicatorsToItems();
}



// ============================================================
// User Preferences (Favorites, Pinned, View Order)
// ============================================================
function getPrefs() {
  try {
    const storeId = document.body.getAttribute('data-store-id') || '1';
    const raw = localStorage.getItem('pos_prefs_' + storeId);
    return raw ? JSON.parse(raw) : { favorites: [], pinned: [], orderBy: 'default' };
  } catch { return { favorites: [], pinned: [], orderBy: 'default' }; }
}

function savePrefs(prefs) {
  try {
    const storeId = document.body.getAttribute('data-store-id') || '1';
    localStorage.setItem('pos_prefs_' + storeId, JSON.stringify(prefs));
  } catch {}
}

function toggleFavorite(productId) {
  const prefs = getPrefs();
  const idx = prefs.favorites.indexOf(productId);
  if (idx > -1) { prefs.favorites.splice(idx, 1); }
  else { prefs.favorites.unshift(productId); }
  savePrefs(prefs);
  return prefs.favorites.indexOf(productId) > -1;
}

function togglePinned(productId) {
  const prefs = getPrefs();
  const idx = prefs.pinned.indexOf(productId);
  if (idx > -1) { prefs.pinned.splice(idx, 1); }
  else { prefs.pinned.unshift(productId); }
  savePrefs(prefs);
  return prefs.pinned.indexOf(productId) > -1;
}

function isFavorite(productId) {
  return getPrefs().favorites.includes(productId);
}

function isPinned(productId) {
  return getPrefs().pinned.includes(productId);
}

// ============================================================
// Context Menu for Gallery Items
// ============================================================
let _ctxProductId = null;
let _ctxCategoryId = null;

function initContextMenu() {
  const overlay = document.getElementById('productContextMenu');
  if (!overlay) return;

  overlay.querySelectorAll('.context-menu-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      handleContextAction(action, _ctxProductId, _ctxCategoryId);
      closeContextMenu();
    });
  });

  document.addEventListener('click', (e) => {
    if (!overlay.classList.contains('hidden') && !overlay.contains(e.target)) {
      closeContextMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeContextMenu();
  });

  setupContextMenuEvents();
}

function setupContextMenuEvents() {
  const containers = [
    document.getElementById('productGallery'),
    document.getElementById('searchResults')
  ];

  containers.forEach(container => {
    if (!container) return;

    container.addEventListener('contextmenu', (e) => {
      const item = e.target.closest('.gallery-item');
      if (!item) return;
      e.preventDefault();
      showContextMenu(e, item);
    });

    let longPressTimer = null;
    container.addEventListener('touchstart', (e) => {
      const item = e.target.closest('.gallery-item');
      if (!item) return;
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        e.preventDefault();
        showContextMenu(e, item);
      }, 500);
    }, { passive: false });

    container.addEventListener('touchmove', () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    }, { passive: true });

    container.addEventListener('touchend', () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    }, { passive: true });

    container.addEventListener('touchcancel', () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    }, { passive: true });
  });
}

function showContextMenu(e, item) {
  _ctxProductId = parseInt(item.dataset.id);
  _ctxCategoryId = item.dataset.category ? parseInt(item.dataset.category) : null;

  const overlay = document.getElementById('productContextMenu');
  const nameEl = document.getElementById('contextMenuProductName');
  const favCheck = document.getElementById('ctxFavCheck');
  const pinCheck = document.getElementById('ctxPinCheck');

  nameEl.textContent = item.querySelector('h4')?.textContent || item.querySelector('.g-name')?.textContent || 'Producto';
  
  const prefs = getPrefs();
  favCheck.textContent = prefs.favorites.includes(_ctxProductId) ? '✓' : '';
  pinCheck.textContent = prefs.pinned.includes(_ctxProductId) ? '✓' : '';

  const x = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
  const y = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;

  overlay.classList.remove('hidden');
  overlay.style.left = '';
  overlay.style.right = '';
  overlay.style.top = '';
  overlay.style.bottom = '';

  const w = overlay.offsetWidth || 200;
  const h = overlay.offsetHeight || 220;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = x, top = y;
  if (left + w + 10 > vw) left = vw - w - 10;
  if (top + h + 10 > vh) top = vh - h - 10;
  if (left < 10) left = 10;
  if (top < 10) top = 10;

  overlay.style.left = left + 'px';
  overlay.style.top = top + 'px';
}

function closeContextMenu() {
  const overlay = document.getElementById('productContextMenu');
  if (overlay) overlay.classList.add('hidden');
  _ctxProductId = null;
  _ctxCategoryId = null;
}

function handleContextAction(action, productId, categoryId) {
  switch (action) {
    case 'favorite': {
      const nowFav = toggleFavorite(productId);
      showNotification(nowFav ? '★ Añadido a favoritos' : '☆ Quitado de favoritos', 'info');
      applyPrefsAndRender();
      break;
    }
    case 'pin': {
      const nowPinned = togglePinned(productId);
      showNotification(nowPinned ? '📌 Producto fijado al inicio' : '📌 Producto desfijado', 'info');
      applyPrefsAndRender();
      break;
    }
    case 'edit': {
      window.location.href = 'inventory.html';
      break;
    }
    case 'view-category': {
      if (categoryId) {
        const catFilter = document.getElementById('categoryFilter');
        if (catFilter) {
          catFilter.value = categoryId;
          catFilter.dispatchEvent(new Event('change'));
        }
      } else {
        showNotification('Este producto no tiene categoría', 'warning');
      }
      break;
    }
  }
}

// ============================================================
// Apply preferences to product ordering
// ============================================================
function applyPrefsToFiltered(filtered) {
  const prefs = getPrefs();
  return [...filtered].sort((a, b) => {
    const aFav = prefs.favorites.indexOf(a.product_id);
    const bFav = prefs.favorites.indexOf(b.product_id);
    const aPin = prefs.pinned.indexOf(a.product_id);
    const bPin = prefs.pinned.indexOf(b.product_id);

    const aScore = (aPin > -1 ? -10000 + aPin : 0) + (aFav > -1 ? -5000 + aFav : 0);
    const bScore = (bPin > -1 ? -10000 + bPin : 0) + (bFav > -1 ? -5000 + bFav : 0);

    return aScore - bScore;
  });
}

// ============================================================
// Add indicators to gallery items
// ============================================================
function addIndicatorsToItems() {
  const prefs = getPrefs();
  document.querySelectorAll('.gallery-item').forEach(el => {
    const id = parseInt(el.dataset.id);
    let indicators = el.querySelector('.item-indicators');
    if (!indicators) {
      indicators = document.createElement('div');
      indicators.className = 'item-indicators';
      el.style.position = 'relative';
      el.appendChild(indicators);
    }
    indicators.innerHTML = '';
    if (prefs.pinned.includes(id)) {
      const i = document.createElement('i');
      i.className = 'fas fa-thumbtack';
      i.title = 'Fijado';
      indicators.appendChild(i);
    }
    if (prefs.favorites.includes(id)) {
      const i = document.createElement('i');
      i.className = 'fas fa-star';
      i.title = 'Favorito';
      indicators.appendChild(i);
    }
  });
}

// ============================================================
// Re-run render with preferences
// ============================================================
function applyPrefsAndRender() {
  let filtered = allProducts;

  if (activeCategoryId && activeCategoryId !== 'all') {
    filtered = filtered.filter(p => String(p.category_id || '') === String(activeCategoryId));
  }

  const viewOrder = document.getElementById('viewOrderSelect');
  const sortVal = viewOrder ? viewOrder.value : 'default';

  if (sortVal === 'default') {
    filtered = applyPrefsToFiltered(filtered);
  } else if (sortVal === 'favorites') {
    filtered = [...filtered].sort((a, b) => {
      const prefs = getPrefs();
      const aFav = prefs.favorites.indexOf(a.product_id);
      const bFav = prefs.favorites.indexOf(b.product_id);
      return (aFav > -1 ? aFav - 10000 : 0) - (bFav > -1 ? bFav - 10000 : 0);
    });
  } else if (sortVal === 'pinned') {
    filtered = [...filtered].sort((a, b) => {
      const prefs = getPrefs();
      const aPin = prefs.pinned.indexOf(a.product_id);
      const bPin = prefs.pinned.indexOf(b.product_id);
      return (aPin > -1 ? aPin - 10000 : 0) - (bPin > -1 ? bPin - 10000 : 0);
    });
  }

  renderGallery(filtered);

  const favCheck = document.getElementById('ctxFavCheck');
  const pinCheck = document.getElementById('ctxPinCheck');
  if (favCheck && _ctxProductId) {
    const prefs = getPrefs();
    favCheck.textContent = prefs.favorites.includes(_ctxProductId) ? '✓' : '';
    pinCheck.textContent = prefs.pinned.includes(_ctxProductId) ? '✓' : '';
  }
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
        stock_quantity: p.stock_quantity, // Asegurar que el backend lo envíe
        is_bulk: p.is_bulk || 0,
        bulk_unit: p.bulk_unit || 'kg'
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
  let imgPath = getRelativeImagePath(product.image_path);
  
  // if (!imgPath) imgPath = 'assets/images/no-image.png';

  // Escapar comillas simples para CSS url()
  const cssImgPath = imgPath ? imgPath.replace(/'/g, "\\'") : '';

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
        ${imgPath ? 
          `<img src="${imgPath}" alt="Producto" style="max-width:120px; max-height:120px; object-fit:contain; margin-bottom:10px; border-radius: 8px; background: rgba(255,255,255,0.9); padding: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1);" onerror="this.style.display='none'">` : 
          `<div style="width: 120px; height: 120px; margin: 0 auto 10px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.9); border-radius: 8px; color: var(--text-muted); font-size: 3rem;"><i class="fas fa-box"></i></div>`
        }
        <div class="scanned-info">
          <h3 style="margin:0 0 5px; font-size:1.1rem; color:var(--text-color); font-weight: 700; text-shadow: 0 1px 1px rgba(255,255,255,0.8);">${escapeHtml(product.product_name)}</h3>
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
  // Usar el módulo térmico (thermal-print.js) si está cargado;
  // si no, mantener el comportamiento anterior.
  if (typeof window.printThermalTicket === 'function') {
    window.printThermalTicket(data);
    return;
  }

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
        .powered-by { font-size: 8px; color: var(--text-muted); margin-top: 5px; }
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
      indicator.style.cssText = 'margin: 5px; padding: 5px 10px; background: var(--warning-color); color: white; border: none; border-radius: 4px; cursor: pointer; display: none; font-size: 0.8rem;';
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
        <div style="background: var(--bg-light); padding: 10px; margin-bottom: 10px; border-radius: 5px; display: flex; justify-content: space-between; align-items: center;">
            <div>
                <strong>${s.timestamp}</strong><br>
                ${s.items.length} items - Total: ${formatCurrency(s.total)}
            </div>
            <button onclick="restoreParkedSale(${s.id}); document.getElementById('${modalId}').style.display='none';" style="background: var(--success-color); color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer;">Recuperar</button>
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
            border: 1px solid var(--border-color);
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            border-radius: 8px;
            padding: 15px;
            z-index: 10001;
        }
        
        .money-panel-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 10000;
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
                z-index: 10001;
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
        .money-section-title { font-size: 0.75rem; color: var(--text-muted); margin-bottom: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
        .money-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        
        .money-btn {
            position: relative;
            border: 1px solid var(--border-color);
            background: var(--bg-card);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            color: var(--text-color);
            transition: all 0.1s;
            user-select: none;
            box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        }
        .money-btn:active { transform: scale(0.96); }
        .money-btn:hover { background: var(--bg-lightest); border-color: var(--text-muted); }
        
        /* Billetes */
        .money-btn.bill {
            height: 45px;
            border-radius: 4px;
            background: linear-gradient(135deg, var(--bg-card) 0%, var(--bg-light) 100%);
            color: var(--success-color);
            border-color: #c8e6c9;
            font-family: 'Courier New', monospace;
            font-size: 1.1rem;
        }
        .money-btn.bill::before {
            content: '';
            position: absolute;
            left: 3px; top: 3px; bottom: 3px; right: 3px;
            border: 1px dashed var(--success-color);
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
            color: var(--text-medium);
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
            background: var(--danger-color);
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
            color: var(--text-light);
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
            border-top: 1px solid var(--border-color);
        }
        .btn-money-action {
            font-size: 0.8rem;
            padding: 6px 12px;
            background: var(--bg-light);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            cursor: pointer;
            color: var(--text-medium);
        }
        .btn-money-action:hover { background: var(--bg-light); }
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
        <div class="money-panel-header" style="text-align: center; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid var(--border-color);">
            <div style="font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Total Acumulado</div>
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
            stock_quantity: product.stock_quantity !== undefined ? parseInt(product.stock_quantity) : null,
            is_bulk: product.is_bulk || 0,
            bulk_unit: product.bulk_unit || 'kg'
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

// =============================================
// INTEGRACIÓN DE BALANZAS/PESAS
// =============================================

// Inicializar ScaleManager cuando la página cargue
function initScaleManager() {
  if (!window.ScaleManager) {
    console.warn('ScaleManager no disponible');
    return;
  }

  // Crear instancia global
  window.scaleManager = new ScaleManager();

  // Elementos del DOM
  const toggleScaleBtn = document.getElementById('toggleScaleBtn');
  const scaleStatusIndicator = document.getElementById('scaleStatusIndicator');
  const scaleStatus = document.getElementById('scaleStatus');
  const scaleWeight = document.getElementById('scaleWeight');
  const scaleWeightValue = document.getElementById('scaleWeightValue');
  const scaleWeightUnit = document.getElementById('scaleWeightUnit');

  if (!toggleScaleBtn) return;

  // Evento: Conectar balanza
  toggleScaleBtn.addEventListener('click', async () => {
    if (window.scaleManager.isConnected) {
      await window.scaleManager.disconnect();
    } else {
      try {
        if (!navigator.serial) {
          showNotification('WebSerial API no soportada. Usa Chrome 89+ o Edge 89+', 'error');
          return;
        }
        
        // Mostrar selector de protocolo
        const protocol = await showScaleProtocolDialog();
        if (protocol) {
          window.scaleManager.setProtocol(protocol);
          await window.scaleManager.requestPort();
        }
      } catch (error) {
        if (error.name !== 'NotFoundError') {
          showNotification(`Error: ${error.message}`, 'error');
        }
      }
    }
  });

  // Callback: Conexión exitosa
  window.scaleManager.on('onConnect', (data) => {
    toggleScaleBtn.classList.add('connected');
    scaleStatusIndicator.classList.add('connected');
    scaleStatus.textContent = 'Conectada';
    showNotification('Balanza conectada', 'success');
  });

  // Callback: Desconexión
  window.scaleManager.on('onDisconnect', (data) => {
    toggleScaleBtn.classList.remove('connected');
    scaleStatusIndicator.classList.remove('connected');
    scaleStatus.textContent = 'Desconectada';
    scaleWeight.style.display = 'none';
    showNotification('Balanza desconectada', 'info');
  });

  // Callback: Peso recibido
  window.scaleManager.on('onWeight', (data) => {
    scaleWeightValue.textContent = data.weight.toFixed(3);
    scaleWeightUnit.textContent = data.unit;
    scaleWeight.style.display = 'inline';
  });

  // Callback: Error
  window.scaleManager.on('onError', (data) => {
    console.error('Scale error:', data);
  });
}

// Mostrar diálogo para seleccionar protocolo
async function showScaleProtocolDialog() {
  return new Promise((resolve) => {
    const html = `
      <div id="protocolModal" class="modal-overlay active">
        <div class="modal-content" style="max-width: 400px;">
          <div class="modal-header">
            <h3><i class="fas fa-balance-scale"></i> Seleccionar Protocolo</h3>
          </div>
          <div class="modal-body">
            <p style="color: var(--text-light); margin-bottom: 15px;">
              Selecciona el protocolo compatible con tu balanza:
            </p>
            <div class="form-group">
              <label style="display: flex; align-items: center; padding: 10px; border: 2px solid var(--border-color); border-radius: 6px; cursor: pointer; margin-bottom: 10px; transition: all 0.2s;">
                <input type="radio" name="protocol" value="generic" checked style="margin-right: 10px;">
                <span>
                  <strong>Genérico</strong><br>
                  <small style="color: var(--text-muted);">9600 baud, 8N1</small>
                </span>
              </label>
              <label style="display: flex; align-items: center; padding: 10px; border: 2px solid var(--border-color); border-radius: 6px; cursor: pointer; margin-bottom: 10px; transition: all 0.2s;">
                <input type="radio" name="protocol" value="datalogic" style="margin-right: 10px;">
                <span>
                  <strong>Datalogic</strong><br>
                  <small style="color: var(--text-muted);">9600 baud, 8O2</small>
                </span>
              </label>
              <label style="display: flex; align-items: center; padding: 10px; border: 2px solid var(--border-color); border-radius: 6px; cursor: pointer; transition: all 0.2s;">
                <input type="radio" name="protocol" value="excell" style="margin-right: 10px;">
                <span>
                  <strong>Excell</strong><br>
                  <small style="color: var(--text-muted);">1200 baud, 8N1</small>
                </span>
              </label>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-cancel" onclick="closeProtocolModal()">Cancelar</button>
            <button class="btn-primary" onclick="confirmProtocol()">Conectar</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    window._protocolModalResolve = resolve;
    window.closeProtocolModal = () => {
      document.getElementById('protocolModal')?.remove();
      resolve(null);
      window._protocolModalResolve = null;
    };

    window.confirmProtocol = () => {
      const selected = document.querySelector('input[name="protocol"]:checked');
      const protocol = selected?.value || 'generic';
      document.getElementById('protocolModal')?.remove();
      resolve(protocol);
      window._protocolModalResolve = null;
    };
  });
}

// Cargar script de ScaleManager si no existe
function loadScaleManagerScript() {
  if (window.ScaleManager) {
    initScaleManager();
    return;
  }

  const script = document.createElement('script');
  script.src = 'js/scale-manager.js';
  script.onload = () => {
    setTimeout(() => initScaleManager(), 100);
  };
  script.onerror = () => {
    console.warn('No se pudo cargar scale-manager.js');
  };
  document.head.appendChild(script);
}

// Iniciar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadScaleManagerScript);
} else {
  loadScaleManagerScript();
}

// =============================================
// PANTALLA DE CLIENTE (CUSTOMER DISPLAY)
// =============================================

let customerDisplayWindow = null;
let customerDisplayChannel = null;
let displaySessionUUID = null;

// Restaurar UUID de sesión guardado
try {
  const saved = localStorage.getItem('tomodachi_display_session');
  if (saved) displaySessionUUID = saved;
} catch (_) {};

// Inicializar sistema de pantalla de cliente
function initCustomerDisplay() {
  const toggleBtn = document.getElementById('toggleCustomerDisplayBtn');
  if (!toggleBtn) return;

  // Inicializar BroadcastChannel
  try {
    customerDisplayChannel = new BroadcastChannel('tomodachi_pos_sync');
    
    // Escuchar solicitudes de datos desde la pantalla
    customerDisplayChannel.onmessage = (event) => {
      if (event.data.type === 'request_data') {
        sendCartToCustomerDisplay();
      }
    };
  } catch (error) {
    console.warn('BroadcastChannel no disponible, usando localStorage');
  }

  // Evento: Abrir/Cerrar pantalla de cliente
  toggleBtn.addEventListener('click', () => {
    if (customerDisplayWindow && !customerDisplayWindow.closed) {
      // Cerrar ventana existente
      customerDisplayWindow.close();
      customerDisplayWindow = null;
      toggleBtn.classList.remove('active');
    } else {
      // Abrir nueva ventana
      openCustomerDisplay();
    }
  });

  // Verificar si la ventana sigue abierta
  setInterval(() => {
    if (customerDisplayWindow && customerDisplayWindow.closed) {
      customerDisplayWindow = null;
      toggleBtn.classList.remove('active');
    }
  }, 1000);
}

// Abrir ventana de pantalla de cliente
function openCustomerDisplay() {
  const toggleBtn = document.getElementById('toggleCustomerDisplayBtn');
  
  // Configuración de ventana
  const width = 1024;
  const height = 768;
  const left = window.screenX + window.outerWidth;
  const top = window.screenY;

  const features = `
    width=${width},
    height=${height},
    left=${left},
    top=${top},
    toolbar=no,
    menubar=no,
    location=no,
    status=no,
    scrollbars=no,
    resizable=yes
  `.replace(/\s/g, '');

  try {
    customerDisplayWindow = window.open(
      'customer-display.html',
      'TomodachiCustomerDisplay',
      features
    );

    if (customerDisplayWindow) {
      toggleBtn.classList.add('active');
      
      // Enviar datos iniciales cuando cargue
      customerDisplayWindow.addEventListener('load', () => {
        setTimeout(() => sendCartToCustomerDisplay(), 500);
      });

      showNotification('Pantalla de cliente abierta', 'success');
    } else {
      showNotification('No se pudo abrir la ventana. Verifica los permisos del navegador.', 'error');
    }
  } catch (error) {
    console.error('Error al abrir pantalla de cliente:', error);
    showNotification('Error al abrir pantalla de cliente', 'error');
  }
}

// Combinar todos los carritos para enviar al display
function getCombinedCartForDisplay() {
  const allItems = [];
  Object.keys(MULTI_CARTS).forEach(tabId => {
    const items = MULTI_CARTS[tabId] || [];
    if (items.length > 0) {
      items.forEach(item => {
        allItems.push({
          ...item,
          cart_tab: parseInt(tabId),
          is_active: tabId === CURRENT_TAB
        });
      });
    }
  });
  return allItems;
}

function calculateTotalsForDisplay() {
  let allSubtotal = 0;
  Object.keys(MULTI_CARTS).forEach(tabId => {
    const items = MULTI_CARTS[tabId] || [];
    items.forEach(item => {
      allSubtotal += (item.subtotal || item.quantity * item.unit_price);
    });
  });
  return {
    subtotal: allSubtotal,
    discount: parseFloat(discountInput?.value) || 0,
    tax: parseFloat(taxInput?.value) || 0,
    total: Math.max(0, allSubtotal - (parseFloat(discountInput?.value) || 0) + (parseFloat(taxInput?.value) || 0))
  };
}

// Enviar datos del carrito a la pantalla de cliente
function sendCartToCustomerDisplay() {
  const allItems = getCombinedCartForDisplay();
  const totals = calculateTotalsForDisplay();
  const storeName = localStorage.getItem('tomodachi_store_name') || document.querySelector('.sidebar-header h2')?.textContent || 'Tomodachi';

  const data = {
    type: 'cart_update',
    cart: allItems,
    totals: totals,
    storeInfo: { name: storeName, logo: '' },
    activeTab: parseInt(CURRENT_TAB),
    timestamp: Date.now()
  };

  // Enviar por BroadcastChannel
  if (customerDisplayChannel) {
    try {
      customerDisplayChannel.postMessage(data);
    } catch (error) {
      console.error('Error enviando por BroadcastChannel:', error);
    }
  }

  // localStorage fallback (same-browser cross-tab)
  try {
    localStorage.setItem('tomodachi_customer_display', JSON.stringify(data));
  } catch (error) {
    console.error('Error guardando en localStorage:', error);
  }

  // Servidor con UUID de sesión
  if (displaySessionUUID) {
    fetch('../api/sales/cart_sync.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        session: displaySessionUUID,
        cart: data.cart,
        totals: data.totals,
        storeInfo: data.storeInfo,
        activeTab: data.activeTab
      })
    }).catch(err => console.warn('cart_sync error:', err));
  }
}

// Calcular totales del carrito
function calculateTotals() {
  const cart = CART; // Usar carrito activo
  
  let subtotal = 0;
  cart.forEach(item => {
    // Asegurar que los valores sean numéricos
    const price = parseFloat(item.unit_price) || 0;
    const qty = parseFloat(item.quantity) || 0;
    const itemSubtotal = parseFloat(item.subtotal) || (price * qty);
    
    subtotal += itemSubtotal;
  });

  const discountValue = parseFloat(discountInput?.value) || 0;
  const taxValue = parseFloat(taxInput?.value) || 0;

  const total = subtotal - discountValue + taxValue;

  return {
    subtotal: subtotal,
    discount: discountValue,
    tax: taxValue,
    total: Math.max(0, total)
  };
}

// Sincronización periódica: cada 2s si hay sesión activa
let syncInterval = null;
function startSyncInterval() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(() => {
    if (displaySessionUUID) {
      sendCartToCustomerDisplay();
    }
  }, 2000);
}

// Llamar también al cambiar el carrito (además del intervalo)
const originalRenderCart = renderCart;
renderCart = function() {
  originalRenderCart.apply(this, arguments);
  if ((customerDisplayWindow && !customerDisplayWindow.closed) || displaySessionUUID) {
    sendCartToCustomerDisplay();
  }
};

const originalRecalcTotals = recalcTotals;
recalcTotals = function() {
  originalRecalcTotals.apply(this, arguments);
  if ((customerDisplayWindow && !customerDisplayWindow.closed) || displaySessionUUID) {
    sendCartToCustomerDisplay();
  }
};

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCustomerDisplay);
} else {
  initCustomerDisplay();
}

// Limpiar al cerrar página
window.addEventListener('beforeunload', () => {
  if (customerDisplayChannel) {
    customerDisplayChannel.close();
  }
  if (customerDisplayWindow && !customerDisplayWindow.closed) {
    customerDisplayWindow.close();
  }
});

// ==========================================
// SISTEMA DE PROMOCIONES
// ==========================================

let ACTIVE_PROMOTIONS = [];
let CURRENT_BILL_DISCOUNT = 0;

async function loadActivePromotions() {
    try {
        const res = await fetch('../api/promotions/read.php?active=true');
        const data = await res.json();
        if (data.success) {
            ACTIVE_PROMOTIONS = data.data;
            console.log('Promociones cargadas:', ACTIVE_PROMOTIONS.length);
        }
    } catch (e) {
        console.error('Error loading promotions', e);
    }
}

function applyPromotions() {
    if (!ACTIVE_PROMOTIONS.length) return;

    // Reset item prices to original (unless manually edited)
    CART.forEach(item => {
        if (!item.manual_edit) {
             item.unit_price = item.original_price;
             item.subtotal = item.quantity * item.unit_price;
             item.promo_applied = null;
             item.bundle_data = null;
        }
    });

    CURRENT_BILL_DISCOUNT = 0;
    let totalBillDiscount = 0;

    // 1. Apply Item-level promotions (Simple, Bulk)
    ACTIVE_PROMOTIONS.forEach(promo => {
        if (promo.type === 'simple_discount') {
            applySimpleDiscount(promo);
        } else if (promo.type === 'bulk_discount') {
            applyBulkDiscount(promo);
        } else if (promo.type === 'bundle') {
            applyBundleDiscount(promo);
        }
    });

    // Recalcular subtotals después de aplicar promos
    CART.forEach(item => {
        item.subtotal = item.quantity * item.unit_price;
    });

    // 2. Apply Bill-level promotions
    let subtotal = CART.reduce((sum, item) => sum + item.subtotal, 0);
    
    ACTIVE_PROMOTIONS.forEach(promo => {
        if (promo.type === 'bill_discount') {
            if (subtotal >= parseFloat(promo.min_purchase_amount)) {
                if (promo.discount_type === 'percentage') {
                    totalBillDiscount += subtotal * (parseFloat(promo.discount_value) / 100);
                } else {
                    totalBillDiscount += parseFloat(promo.discount_value);
                }
            }
        }
    });
    
    CURRENT_BILL_DISCOUNT = totalBillDiscount;
}

function applySimpleDiscount(promo) {
    CART.forEach(item => {
        if (isTarget(item, promo)) {
            let discount = 0;
            if (promo.discount_type === 'percentage') {
                discount = item.original_price * (parseFloat(promo.discount_value) / 100);
            } else {
                discount = parseFloat(promo.discount_value);
            }
            
            let newPrice = item.original_price - discount;
            if (newPrice < 0) newPrice = 0;
            
            if (!item.manual_edit && newPrice < item.unit_price) {
                item.unit_price = newPrice;
                item.promo_applied = promo.name;
            }
        }
    });
}

function applyBulkDiscount(promo) {
    let eligibleItems = CART.filter(item => isTarget(item, promo));
    let totalQty = eligibleItems.reduce((sum, item) => sum + item.quantity, 0);
    
    if (totalQty >= parseInt(promo.min_quantity)) {
        eligibleItems.forEach(item => {
             let discount = 0;
            if (promo.discount_type === 'percentage') {
                discount = item.original_price * (parseFloat(promo.discount_value) / 100);
            } else {
                discount = parseFloat(promo.discount_value);
            }
            
            let newPrice = item.original_price - discount;
            if (newPrice < 0) newPrice = 0;
            
            if (!item.manual_edit && newPrice < item.unit_price) {
                item.unit_price = newPrice;
                item.promo_applied = promo.name;
            }
        });
    }
}

function applyBundleDiscount(promo) {
    const requiredTargets = promo.targets; 
    if (!requiredTargets || requiredTargets.length === 0) return;

    // Lógica STRICT SET (Conjunto Completo):
    // El bundle solo aplica si están presentes TODOS los items definidos en los targets.
    // Asumimos que se requiere 1 unidad de cada target para formar 1 bundle.
    
    // 1. Calcular cuántos "Sets" completos podemos formar
    let potentialBundles = Number.MAX_SAFE_INTEGER;
    
    // Mapa para saber qué items del carrito cumplen qué target
    // target_index -> [ { item_ref, qty_available } ]
    let usageMap = [];

    // Verificación de cobertura de targets
    for (let i = 0; i < requiredTargets.length; i++) {
        let t = requiredTargets[i];
        
        // Encontrar items en el carrito que coincidan con este target
        let matches = CART.filter(item => {
            if (t.product_id && item.product_id == t.product_id) return true;
            if (t.category_id && item.category_id == t.category_id) return true;
            return false;
        });
        
        let totalQtyForTarget = matches.reduce((sum, item) => sum + item.quantity, 0);
        
        if (totalQtyForTarget === 0) {
            potentialBundles = 0; // Faltan componentes del bundle
            break;
        }
        
        potentialBundles = Math.min(potentialBundles, totalQtyForTarget);
        usageMap[i] = matches; 
    }

    let numBundles = potentialBundles;
    
    // Si no se puede formar ningún paquete completo, salir
    if (numBundles === 0 || numBundles === Number.MAX_SAFE_INTEGER) return;

    // 2. Calcular costos
    let bundlePrice = parseFloat(promo.discount_value);
    let totalBundleCost = numBundles * bundlePrice;

    // 3. Identificar las unidades físicas que participan en los bundles
    // Para calcular el precio original de esas unidades y determinar el ratio de descuento.
    let participatingUnits = []; // { item: ref, qty: number, originalAmount: number }

    for (let i = 0; i < requiredTargets.length; i++) {
        let matches = usageMap[i]; // Items del carrito que sirven para este target
        let countNeeded = numBundles; // Necesitamos 'numBundles' unidades de este target

        // Ordenamos por precio para maximizar el descuento (o estandarizar).
        // En este caso, tomamos simplemente las disponibles.
        for (let item of matches) {
            if (countNeeded <= 0) break;
            
            let taking = Math.min(item.quantity, countNeeded);
            
            participatingUnits.push({
                item: item,
                qty: taking,
                originalAmount: taking * item.original_price
            });
            
            countNeeded -= taking;
        }
    }

    // 4. Calcular Ratio de Descuento
    let totalOriginalPrice = participatingUnits.reduce((sum, u) => sum + u.originalAmount, 0);
    // Evitar target > original protecciones si el usuario quiere bundle fijo.
    // Simplemente distribuimos el precio del bundle entre los items.
    let ratio = totalOriginalPrice > 0 ? totalBundleCost / totalOriginalPrice : 1;

    // 5. Aplicar precios al Carrito (Weighted Average)
    // Un item puede tener 5 unidades, pero solo 2 son parte de bundles. 
    // Precio Final = ((2 * PrecioDescuento) + (3 * PrecioOriginal)) / 5
    
    // Agrupar impacto por item
    let itemImpact = new Map(); // item -> { bundledQty: 0, bundledRevenue: 0 }

    participatingUnits.forEach(u => {
        if (!itemImpact.has(u.item)) {
            itemImpact.set(u.item, { bundledQty: 0, bundledRevenue: 0 });
        }
        let info = itemImpact.get(u.item);
        info.bundledQty += u.qty;
        info.bundledRevenue += (u.originalAmount * ratio);
    });

    itemImpact.forEach((info, item) => {
        if (item.manual_edit) return;

        let remainingQty = item.quantity - info.bundledQty;
        // El resto se cobra a precio original (u original_price puede ya tener desc. simple? 
        // Asumimos prioridad bundle > simple. applyPromotions resetea a original_price siempre al inicio).
        let remainingRevenue = remainingQty * item.original_price;
        
        let totalRevenue = info.bundledRevenue + remainingRevenue;
        let avgPrice = totalRevenue / item.quantity;
        
        // Aplicar
        item.unit_price = avgPrice;
        item.subtotal = totalRevenue;
        item.promo_applied = `${promo.name} (${numBundles} packs)`;

        // Guardar metadatos para visualización agrupada
        item.bundle_data = {
            name: promo.name,
            count: numBundles,
            in_bundle_qty: info.bundledQty,
            in_bundle_subtotal: info.bundledRevenue,
            out_bundle_qty: remainingQty, 
            out_bundle_subtotal: remainingRevenue
        };
    });
}

function isTarget(item, promo) {
    if (!promo.targets || promo.targets.length === 0) return false;
    return promo.targets.some(t => 
        (t.product_id && t.product_id == item.product_id) || 
        (t.category_id && t.category_id == item.category_id)
    );
}

// ==========================================
// Fiado: cargar clientes en el selector del POS
// ==========================================
async function loadCustomersIntoSelect() {
  const custSel = document.getElementById('customerSelect');
  if (!custSel) return;
  try {
    const res = await fetch('../api/customers/customers.php');
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    const prev = custSel.value;
    custSel.innerHTML = '<option value="">— Seleccionar cliente —</option>' +
      (data.data || []).map(c =>
        `<option value="${c.customer_id}" ${Number(c.balance) > 0 ? 'data-balance="' + c.balance + '"' : ''}>${c.full_name}${Number(c.balance) > 0 ? ' (adeuda ' + new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(c.balance) + ')' : ''}</option>`
      ).join('');
    if (prev) custSel.value = prev;
  } catch (e) {
    console.error('Error cargando clientes:', e);
  }
}

