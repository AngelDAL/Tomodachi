/**
 * Lógica de Punto de Venta (Carrito y Venta) - Versión Simplificada
 */
let CART = [];
let CURRENT_STORE_ID = null;

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
  
  // Persistencia: Cargar carrito guardado
  const savedCart = localStorage.getItem('tomodachi_cart');
  if (savedCart) {
    try {
      CART = JSON.parse(savedCart);
      renderCart();
    } catch (e) {
      console.error('Error cargando carrito guardado', e);
      localStorage.removeItem('tomodachi_cart');
    }
  }

  loadGallery();
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

  // Pestañas del carrito
  document.querySelectorAll('.cart-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabName = btn.getAttribute('data-tab');
      switchCartTab(tabName);
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

  // Eliminado auto-cierre al hacer click fuera: el usuario controla con botones
}

function switchCartTab(tabName) {
  // Cambiar botones activos
  document.querySelectorAll('.cart-tab-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('data-tab') === tabName) {
      btn.classList.add('active');
    }
  });

  // Cambiar contenido visible
  document.querySelectorAll('.cart-tab-content').forEach(content => {
    content.classList.remove('active');
  });
  const tabContent = document.getElementById(`tab-${tabName}`);
  if (tabContent) {
    tabContent.classList.add('active');
  }
}

async function searchProducts(term) {
  try {
    // Eliminado store_id de los parámetros, el backend usa la sesión
    const res = await fetch('../api/inventory/products.php?search=' + term, { method: 'GET', headers: { 'Content-Type': 'application/json' }, credentials: 'include' });
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
      <div class="gallery-item" data-id="${p.product_id}" data-price="${p.price}" data-image="${p.image_path || ''}" title="${escapeHtml(p.product_name)}" style="animation-delay: ${Math.min(index * 0.05, 0.5)}s">
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
          image_path: el.getAttribute('data-image')
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
      nxn_pay: 0
    });
  }
  playSound('Sound2.mp3');
  renderCart();
  showNotification('Producto añadido', 'success');
}

function renderCart() {
  // Persistencia: Guardar carrito
  localStorage.setItem('tomodachi_cart', JSON.stringify(CART));

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
    const resData = await res.json();
    if (resData.success) {
      playSound('Sound7.mp3');
      showNotification('Venta registrada', 'success');
      
      // Imprimir ticket si está habilitado
      const printEnabled = document.getElementById('printTicketCheckbox') && document.getElementById('printTicketCheckbox').checked;
      if (printEnabled) {
        printTicket({
          items: [...CART],
          total: CART.reduce((s, i) => s + i.subtotal, 0), // Usar subtotal calculado
          date: new Date().toLocaleString(),
          sale_id: resData.sale_id || '---'
        });
      }

      CART = [];
      localStorage.removeItem('tomodachi_cart'); // Limpiar persistencia
      renderCart();
      if (discountInput) discountInput.value = '0';
      if (taxInput) taxInput.value = '0';
      if (checkoutReceivedInput) checkoutReceivedInput.value = '0';
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

// Galería de productos
async function loadGallery() {
  try {
    // Eliminado store_id de los parámetros, el backend usa la sesión
    const res = await fetch('../api/inventory/products.php');
    const resData = await res.json();
    if (resData.success) {
      const list = resData.data || [];
      productGallery.innerHTML = list.map(p => `<div class="gallery-item" data-id="${p.product_id}" data-price="${p.price}" data-image="${p.image_path || ''}" title="${escapeHtml(p.product_name)}">
        <div class="img-wrap">${p.image_path ? `<img src="/${p.image_path}" alt="img">` : '<span class="no-img">Sin imagen</span>'}</div>
        <div class="g-name">${escapeHtml(p.product_name)}</div>
        <div class="g-price">${formatCurrency(p.price)}</div>
      </div>`).join('');

      Array.from(productGallery.querySelectorAll('.gallery-item')).forEach(el => {
        el.addEventListener('click', () => {
          // Feedback visual
          el.classList.add('item-added-feedback');
          setTimeout(() => el.classList.remove('item-added-feedback'), 500);

          addProductToCart({
            product_id: parseInt(el.getAttribute('data-id')),
            product_name: el.querySelector('.g-name').textContent,
            unit_price: parseFloat(el.getAttribute('data-price')),
            image_path: el.getAttribute('data-image')
          });
        });
      });
    }
  } catch (e) { console.error(e); }
}

// Funcionalidad de escáner
async function fetchByCode(code) {
  try {
    // Eliminado store_id de los parámetros, el backend usa la sesión
    const res = await fetch('../api/inventory/scanner.php?barcode=' + code, { method: 'GET', headers: { 'Content-Type': 'application/json' }, credentials: 'include' });
    const resData = await res.json();
    if (resData.success && resData.data) {
      const p = resData.data;
      addProductToCart({ 
        product_id: p.product_id, 
        product_name: p.product_name, 
        unit_price: parseFloat(p.price),
        image_path: p.image_path 
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
