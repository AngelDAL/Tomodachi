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

function initPOS() {
  // Inicializar referencias a elementos DOM
  searchInput = document.getElementById('searchInput');
  searchResults = document.getElementById('searchResults');
  cartBody = document.getElementById('cartBody');
  emptyCartMsg = document.getElementById('emptyCartMsg');
  totalBadge = document.getElementById('totalBadge');
  cartBadge = document.getElementById('cartBadge');
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

  // Obtener store_id del atributo de datos en el body
  CURRENT_STORE_ID = document.body.getAttribute('data-store-id') || 1;

  // Ahora vinculamos eventos
  bindEvents();
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
      cartPanel.setAttribute('aria-hidden','true');
    });
  }

  if (cartHandleBtn) {
    cartHandleBtn.addEventListener('click', () => toggleCartPanel());
    // Drag para abrir/cerrar
    let startX = null, dragging = false;
    const onDown = (e) => { startX = (e.touches? e.touches[0].clientX : e.clientX); dragging = true; };
    const onMove = (e) => {
      if (!dragging) return;
      const x = (e.touches? e.touches[0].clientX : e.clientX);
      const dx = startX - x; // positivo al arrastrar hacia la izquierda
      if (!cartPanel.classList.contains('open') && dx > 40) { toggleCartPanel(true); dragging=false; }
      if (cartPanel.classList.contains('open') && dx < -40) { toggleCartPanel(false); dragging=false; }
    };
    const onUp = () => { dragging=false; };
    cartHandleBtn.addEventListener('mousedown', onDown);
    cartHandleBtn.addEventListener('touchstart', onDown, {passive:true});
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, {passive:true});
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
    const res = await API.get('/api/inventory/products.php', { search: term });
    if (!res.success) { return; }
    const list = res.data || [];
    
    if (!list.length) { 
      searchResults.innerHTML = '<div class="empty-cart">Sin resultados</div>';
      productGallery.style.display = 'none';
      searchResults.classList.remove('hidden');
      return; 
    }
    
    searchResults.innerHTML = list.map(p => `
      <div class="search-result-item" data-id="${p.product_id}" data-price="${p.price}" data-name="${escapeHtml(p.product_name)}">
        <span class="search-result-name">${escapeHtml(p.product_name)}</span>
        <span class="search-result-price">${formatCurrency(p.price)}</span>
      </div>
    `).join('');
    
    productGallery.style.display = 'none';
    searchResults.classList.remove('hidden');
    
    Array.from(searchResults.querySelectorAll('.search-result-item')).forEach(el => {
      el.addEventListener('click', () => {
        addProductToCart({
          product_id: parseInt(el.getAttribute('data-id')), 
          product_name: el.getAttribute('data-name'),
          unit_price: parseFloat(el.getAttribute('data-price'))
        });
        searchInput.value = '';
        searchResults.classList.add('hidden');
        productGallery.style.display = 'grid';
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
    existing.subtotal = existing.quantity * existing.unit_price;
  } else {
    CART.push({ product_id: prod.product_id, product_name: prod.product_name, unit_price: prod.unit_price, quantity: 1, subtotal: prod.unit_price });
  }
  renderCart();
  showNotification('Producto añadido', 'success');
}

function renderCart() {
  if (!cartBody || !emptyCartMsg) return;
  
  if (!CART.length) {
    cartBody.innerHTML = '';
    emptyCartMsg.style.display='block';
    if (finalizeSaleBtn) finalizeSaleBtn.disabled = true;
    if (cartBadge) cartBadge.textContent = '0';
  } else {
    emptyCartMsg.style.display='none';
    if (finalizeSaleBtn) finalizeSaleBtn.disabled = false;
    if (cartBadge) cartBadge.textContent = CART.length;
    
    cartBody.innerHTML = CART.map(item => `<tr>
      <td>${escapeHtml(item.product_name)}</td>
      <td>${formatCurrency(item.unit_price)}</td>
      <td><input type="number" min="1" value="${item.quantity}" data-id="${item.product_id}" class="qty-input"></td>
      <td><button class="remove-btn" data-id="${item.product_id}">✕</button></td>
    </tr>`).join('');
    
    // Bind qty changes
    Array.from(cartBody.querySelectorAll('.qty-input')).forEach(inp => {
      inp.addEventListener('input', () => {
        let q = parseInt(inp.value); if (!q || q<1) q=1; inp.value=q;
        const id = parseInt(inp.getAttribute('data-id'));
        const it = CART.find(i=>i.product_id===id); it.quantity=q; it.subtotal=it.quantity*it.unit_price; renderCart();
      });
    });
    
    // Bind remove
    Array.from(cartBody.querySelectorAll('.remove-btn')).forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.getAttribute('data-id'));
        CART = CART.filter(i=>i.product_id!==id);
        renderCart();
        // showNotification('Producto removido', 'info');
      });
    });
  }
  recalcTotals();
}

function recalcTotals() {
  const subtotal = CART.reduce((s,i)=>s+i.subtotal,0);
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
  const subtotal = CART.reduce((s,i)=>s+i.subtotal,0);
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
    cartPanel.setAttribute('aria-hidden','false');
  } else {
    cartPanel.classList.remove('open');
    cartPanel.setAttribute('aria-hidden','true');
  }
}

async function finalizeSale() {
  if (!CART.length) return;
  finalizeSaleBtn.disabled = true;
  
  const method = paymentMethodSelect ? paymentMethodSelect.value : 'cash';
  const payload = {
    store_id: CURRENT_STORE_ID,
    items: CART.map(i=>({ product_id: i.product_id, quantity: i.quantity, price: i.unit_price })),
    payment_method: method,
    discount: (discountInput && discountInput.value) ? parseFloat(discountInput.value) : 0,
    tax: (taxInput && taxInput.value) ? parseFloat(taxInput.value) : 0
  };
  
  // Añadir cash_amount si es necesario
  if ((method === 'cash' || method === 'mixed') && checkoutReceivedInput) {
    payload.cash_amount = parseFloat(checkoutReceivedInput.value) || 0;
  }
  
  try {
    const res = await API.post('/api/sales/create_sale.php', payload);
    if (res.success) {
      showNotification('Venta registrada', 'success');
      CART=[]; 
      renderCart();
      if (discountInput) discountInput.value='0'; 
      if (taxInput) taxInput.value='0'; 
      if (checkoutReceivedInput) checkoutReceivedInput.value='0';
      // Mantener panel abierto; solo se cierra manualmente
    } else {
      showNotification(res.message||'Error venta', 'error');
    }
  } catch (e) {
    showNotification('Error al procesar venta', 'error');
  } finally {
    finalizeSaleBtn.disabled = false;
  }
}

// Ajuste: ya no existe barra de resumen separada; recalcTotals gestiona todo

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, function(m) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m]); });
}

// Galería de productos
async function loadGallery(){
  try {
    // Eliminado store_id de los parámetros, el backend usa la sesión
    const res = await API.get('/api/inventory/products.php', {});
    if(res.success){
      const list = res.data || [];
      productGallery.innerHTML = list.map(p => `<div class="gallery-item" data-id="${p.product_id}" data-price="${p.price}" title="${escapeHtml(p.product_name)}">
        <div class="img-wrap">${p.image_path?`<img src="/${p.image_path}" alt="img">`:'<span class="no-img">Sin imagen</span>'}</div>
        <div class="g-name">${escapeHtml(p.product_name)}</div>
        <div class="g-price">${formatCurrency(p.price)}</div>
      </div>`).join('');
      
      Array.from(productGallery.querySelectorAll('.gallery-item')).forEach(el => {
        el.addEventListener('click', () => {
          addProductToCart({ 
            product_id: parseInt(el.getAttribute('data-id')), 
            product_name: el.querySelector('.g-name').textContent, 
            unit_price: parseFloat(el.getAttribute('data-price')) 
          });
        });
      });
    }
  } catch(e){ console.error(e); }
}

// Funcionalidad de escáner
async function fetchByCode(code) {
  try {
    // Eliminado store_id de los parámetros, el backend usa la sesión
    const res = await API.get('/api/inventory/scanner.php', { barcode: code });
    if (res.success && res.data) {
      const p = res.data;
      addProductToCart({ product_id: p.product_id, product_name: p.product_name, unit_price: parseFloat(p.price) });
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
