// Función mejorada para obtener ruta relativa de imagen (Match sales.js/app.js)
function getRelativeImagePath(path) {
    if (!path || typeof path !== 'string' || path.trim() === '') return null;

    // Si es base64, retornar tal cual
    if (path.startsWith('data:image')) return path;
    // Si es http/https, retornar tal cual
    if (path.startsWith('http')) return path;

    // Normalizar slashes
    let cleanPath = path.replace(/\\/g, '/');

    // Si contiene 'public/', tomar lo que sigue
    if (cleanPath.includes('public/')) {
        cleanPath = cleanPath.split('public/')[1];
    }

    // Eliminar slash inicial si existe para hacerlo relativo al root de public
    if (cleanPath.startsWith('/')) {
        cleanPath = cleanPath.substring(1);
    }

    return cleanPath;
}

// ------ SYSTEM NOTIFICATIONS (TOASTS) ------
function showNotification(message, type = 'info') {
    // Eliminar notificaciones previas
    const existing = document.querySelectorAll('.notification');
    existing.forEach(n => {
        n.classList.remove('show');
        setTimeout(() => n.remove(), 300);
    });

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;

    // Iconos automáticos según tipo
    let icon = '';
    if (type === 'success') icon = '<i class="fas fa-check-circle"></i> ';
    if (type === 'error') icon = '<i class="fas fa-exclamation-circle"></i> ';
    if (type === 'warning') icon = '<i class="fas fa-exclamation-triangle"></i> ';
    if (type === 'info') icon = '<i class="fas fa-info-circle"></i> ';

    notification.innerHTML = `${icon}${message}`;
    document.body.appendChild(notification);

    // Show
    requestAnimationFrame(() => notification.classList.add('show'));

    // Auto close
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 4000);
}

// ------ SYSTEM CONFIRM MODAL ------
let confirmCallback = null;
function showConfirmModal(title, message, onConfirm) {
    const modal = document.getElementById('confirmModal');
    if (!modal) {
        if (confirm(message)) onConfirm(); // Fallback
        return;
    }

    document.getElementById('confirmTitle').innerText = title;
    document.getElementById('confirmMessage').innerText = message;

    confirmCallback = onConfirm;
    const btn = document.getElementById('confirmBtnAction');

    // Reset listener to avoid duplicates
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener('click', () => {
        if (confirmCallback) confirmCallback();
        closeConfirmModal();
    });

    if (typeof modal.showModal === 'function') { modal.showModal(); }
    document.body.classList.add('modal-open');
}

function closeConfirmModal() {
    const modal = document.getElementById('confirmModal');
    if (modal && typeof modal.close === 'function') modal.close();
    document.body.classList.remove('modal-open');
    confirmCallback = null;
}

let selectedTargets = [];
let allProducts = [];
let promoModal;
let editingPromotionId = null;
let loadedPromotionsData = [];

function openPromoModal(promoId = null, isReadOnly = false) {
    const form = document.getElementById("promoForm");
    
    // Reset basic state
    if (form) form.reset();
    selectedTargets = [];
    editingPromotionId = promoId;
    
    // UI Elements
    const titleEl = document.querySelector("#promoModal h2");
    const submitBtn = document.querySelector("#promoForm button[type='submit']");
    const container = document.getElementById("conditionFields");
    
    // Reset read-only state
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(i => i.disabled = isReadOnly);
    if (submitBtn) submitBtn.style.display = isReadOnly ? 'none' : 'block';

    if (promoId) {
        // EDIT / VIEW MODE
        const promo = loadedPromotionsData.find(p => p.promotion_id == promoId);
        if (!promo) return;

        if (titleEl) titleEl.innerText = isReadOnly ? "Detalles de Promoción" : "Editar Promoción";
        if (submitBtn) submitBtn.innerText = "Actualizar Promoción";

        // Fill Fields
        form.querySelector('[name="name"]').value = promo.name;
        // Dates: PHP sends 'Y-m-d H:i:s', input datetime-local needs 'Y-m-dTH:i'
        const fmtDate = (d) => d ? d.replace(' ', 'T').substring(0, 16) : '';
        form.querySelector('[name="start_date"]').value = fmtDate(promo.start_date);
        form.querySelector('[name="end_date"]').value = fmtDate(promo.end_date);
        
        const typeSelect = form.querySelector('[name="type"]');
        typeSelect.value = promo.type;
        // Trigger generic UI updates (hide/show sections)
        updateFormFields();

        // Fill specific values based on type
        if (promo.type === 'bundle') {
            const bp = form.querySelector('[name="bundle_price"]');
            if (bp) bp.value = promo.discount_value; // In bundles, value is price
        } else {
            const dv = form.querySelector('[name="discount_value"]');
            const dt = form.querySelector('[name="discount_type"]');
            if (dv) dv.value = promo.discount_value;
            if (dt) dt.value = promo.discount_type;
        }

        const minQ = form.querySelector('[name="min_quantity"]');
        if (minQ) minQ.value = promo.min_quantity;
        
        const minP = form.querySelector('[name="min_purchase_amount"]');
        if (minP) minP.value = promo.min_purchase_amount;

        // Fill Targets AND reconstruct proper objects for logic
        if (promo.targets && promo.targets.length > 0) {
            selectedTargets = promo.targets.map(t => {
                // Try to find more info if product exists in allProducts (for images/costs)
                let fullInfo = {};
                if (t.product_id) {
                     const p = allProducts.find(prod => prod.product_id == t.product_id);
                     if (p) {
                         fullInfo = {
                             name: p.product_name,
                             price: p.price,
                             cost: p.cost,
                             image: p.image_path
                         };
                     } else {
                         fullInfo = { name: t.product_name, price: 0, cost: 0 };
                     }
                     return {
                         type: "product",
                         id: t.product_id,
                         ...fullInfo
                     };
                } else {
                    return {
                        type: "category",
                        id: t.category_id, 
                        name: t.category_name
                    };
                }
            });
        }

    } else {
        // CREATE MODE
        editingPromotionId = null;
        if (titleEl) titleEl.innerText = "Nueva Promoción";
        if (submitBtn) submitBtn.innerText = "Guardar Promoción";

        // Fechas por defecto (Local Time fix)
        const now = new Date();
        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1);

        // Correct timezone offset for datetime-local input
        const toLocalISOString = (date) => {
            const offset = date.getTimezoneOffset() * 60000; // offset in milliseconds
            const localISOTime = (new Date(date - offset)).toISOString().slice(0, 16);
            return localISOTime;
        };

        const startEl = document.querySelector('input[name="start_date"]');
        const endEl = document.querySelector('input[name="end_date"]');
        if (startEl) startEl.value = toLocalISOString(now); // now
        if (endEl) endEl.value = toLocalISOString(nextMonth);
        
        updateFormFields(); // Reset logic UI
    }

    if (promoModal) {
        if (typeof promoModal.showModal === 'function') { promoModal.showModal(); }
        document.body.classList.add("modal-open");
        // Ensure products are loaded (sometimes loadedPromotions happens before loadProductsForGrid is ready)
        if (allProducts.length === 0) {
             loadProductsForGrid().then(() => {
                 renderProductsGrid(allProducts);
                 renderSelectedProductsList(); // Do this after knowing products
                 calculateProfit();
             });
        } else {
            renderProductsGrid(allProducts); // Refresh checks based on selectedTargets
            renderSelectedProductsList();
            calculateProfit();
        }
        
        setTimeout(() => document.querySelector('#promoForm input[name="name"]')?.focus(), 100);
    }
}

function closePromoModal() {
    if (promoModal) {
        if (typeof promoModal.close === 'function') { promoModal.close(); }
    }
    document.body.classList.remove("modal-open");
    const form = document.getElementById("promoForm");
    if (form) form.reset();
    selectedTargets = [];
}

document.addEventListener("DOMContentLoaded", () => {
    promoModal = document.getElementById("promoModal");
    const openBtn = document.getElementById("newPromoBtn");
    const closeBtn = document.getElementById("closePromoModalBtn");

    loadPromotions();
    setupEventListeners();

    if (closeBtn) closeBtn.addEventListener("click", (e) => { e.preventDefault(); closePromoModal(); });
    if (promoModal) promoModal.addEventListener("click", (e) => { if (e.target === promoModal) closePromoModal(); });

    // Drawer init
    promoDrawer = document.getElementById("promoDrawer");
    const closeDrawerBtn = document.getElementById("closePromoDrawerBtn");
    const cancelDrawerBtn = document.getElementById("cancelDrawerBtn");
    const saveDrawerBtn = document.getElementById("saveDrawerBtn");
    const drawerProductSearch = document.getElementById("drawerProductSearch");

    if (closeDrawerBtn) closeDrawerBtn.addEventListener("click", closePromoDrawer);
    if (cancelDrawerBtn) cancelDrawerBtn.addEventListener("click", closePromoDrawer);
    if (saveDrawerBtn) saveDrawerBtn.addEventListener("click", saveDrawerPromotion);
    if (promoDrawer) promoDrawer.addEventListener("click", (e) => {
        if (e.target === promoDrawer) closePromoDrawer();
    });

    document.querySelectorAll('#promoDrawer .drawer-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#promoDrawer .drawer-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('#promoDrawer .tab-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const panel = document.getElementById(tab.dataset.dtab);
            if (panel) panel.classList.add('active');
        });
    });

    if (drawerProductSearch) {
        drawerProductSearch.addEventListener("input", (e) => {
            const term = e.target.value.toLowerCase();
            const filtered = allProducts.filter(p =>
                p.product_name.toLowerCase().includes(term) ||
                (p.barcode && p.barcode.includes(term))
            );
            renderDrawerProducts(filtered);
        });
    }

    document.querySelector('#promoFormDrawer [name="type"]')?.addEventListener('change', updateDrawerFields);

    // Open modal or drawer based on viewport
    if (openBtn) {
        openBtn.addEventListener("click", (e) => {
            e.preventDefault();
            if (window.innerWidth <= 768) {
                openPromoDrawer();
            } else {
                openPromoModal();
            }
        });
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            if (promoModal?.classList.contains("show")) closePromoModal();
            if (promoDrawer?.classList.contains("show")) closePromoDrawer();
        }
    });
});

function setupEventListeners() {
    const gridSearch = document.getElementById("productGridSearch");
    if (gridSearch) gridSearch.addEventListener("input", (e) => filterProductsGrid(e.target.value));

    const promoForm = document.getElementById("promoForm");
    if (promoForm) promoForm.addEventListener("submit", savePromotion);
}

async function loadProductsForGrid() {
    const grid = document.getElementById("productsGrid");
    grid.innerHTML = "<div style='grid-column: 1/-1; text-align:center; padding: 20px;'>Cargando productos...</div>";

    try {
        const res = await fetch("../api/inventory/products.php");
        const data = await res.json();
        if (data.success) {
            allProducts = data.data;
            renderProductsGrid(allProducts);
        }
    } catch (e) {
        grid.innerHTML = "Error al cargar productos";
    }
}

function renderProductsGrid(products) {
    const grid = document.getElementById("productsGrid");
    if (products.length === 0) {
        grid.innerHTML = "<div style='grid-column: 1/-1; text-align:center; padding: 20px; color:var(--text-light);'>No se encontraron productos</div>";
        return;
    }
    grid.innerHTML = products.map(p => {
        const isSelected = selectedTargets.some(t => t.id == p.product_id);

        let imgSrc = getRelativeImagePath(p.image_path);
        if (!imgSrc) {
            // Fallback default
            imgSrc = 'assets/images/products/default-product.svg';
        }

        // Manejar error de carga con onerror
        const onErrorParams = "this.onerror=null;this.src='assets/images/products/default-product.svg';";

        return `
            <div class="product-item-card ${isSelected ? "selected" : ""}" onclick="toggleProductSelection(${p.product_id})" title="${p.product_name}">
                <div class="product-item-img-wrapper">
                    <img src="${imgSrc}" alt="${p.product_name}" onerror="${onErrorParams}">
                    ${isSelected ? '<div class="selected-indicator"><i class="fas fa-check"></i></div>' : ''}
                </div>
                <div class="product-item-content">
                    <div class="product-item-name">${p.product_name}</div>
                    <div class="product-item-price">$${parseFloat(p.price).toFixed(2)}</div>
                </div>
            </div>
        `;
    }).join("");
    if (typeof renderSelectedProductsList === 'function') renderSelectedProductsList();
}

function renderSelectedProductsList() {
    const section = document.getElementById('selectedProductsSection');
    const list = document.getElementById('selectedProductsList');
    const countSpan = document.getElementById('selectedCountNum');

    if (!section || !list) return; // Not in DOM

    if (countSpan) countSpan.innerText = selectedTargets.length;

    if (selectedTargets.length === 0) {
        section.style.display = 'none';
        list.innerHTML = '';
        return;
    }

    section.style.display = 'block';

    list.innerHTML = selectedTargets.map(t => {
        let imgTag = '';
        if (t.image_path) {
            const imgPath = getRelativeImagePath(t.image_path);
            imgTag = `<img src="${imgPath}" alt="img">`;
        } else {
            imgTag = `<div style="width:24px;height:24px;background:var(--dark-color);border-radius:50%;margin-right:8px;display:flex;align-items:center;justify-content:center;"><i class="fas fa-box" style="font-size:10px;color:#cbd5e1;"></i></div>`;
        }

        return `
            <div class="selected-chip">
                ${imgTag}
                <span>${t.name}</span>
                <i class="fas fa-times remove-chip" onclick="toggleProductSelection(${t.id})"></i>
            </div>
        `;
    }).join('');
}

function filterProductsGrid(term) {
    const filtered = allProducts.filter(p =>
        p.product_name.toLowerCase().includes(term.toLowerCase()) ||
        (p.barcode && p.barcode.includes(term))
    );
    renderProductsGrid(filtered);
}

function toggleProductSelection(productId) {
    const index = selectedTargets.findIndex(t => t.id == productId);
    if (index > -1) {
        selectedTargets.splice(index, 1);
    } else {
        const product = allProducts.find(p => p.product_id == productId);
        selectedTargets.push({
            type: "product",
            id: productId,
            name: product.product_name,
            price: product.price,
            cost: product.cost,
            image: product.image_path
        });
    }
    renderProductsGrid(allProducts);
    calculateProfit();
}

function updateSelectedCount() {
    const el = document.getElementById("selectedCount");
    if (el) el.innerText = `${selectedTargets.length} productos seleccionados`;
}

function updateFormFields() {
    const type = document.getElementById("promoType").value;
    const container = document.getElementById("conditionFields");
    const discountFields = document.getElementById("discountFields");
    const bundlePriceField = document.getElementById("bundlePriceField");

    container.innerHTML = "";

    // Inputs inside sections
    const discountInputs = discountFields.querySelectorAll('input, select');
    const bundleInputs = bundlePriceField.querySelectorAll('input, select');

    if (type === "bundle") {
        discountFields.style.display = "none";
        bundlePriceField.style.display = "block";

        container.innerHTML = `
            <div class="form-group">
                <label>Cantidad Total de Artículos</label>
                <div class="input-icon-wrapper">
                    <i class="fas fa-cubes"></i>
                    <input type="number" name="min_quantity" class="form-control" value="2" min="1" required oninput="calculateProfit()">
                </div>
                <small class="form-text text-muted" style="font-size:0.8rem;">Suma total de productos necesarios para armar el paquete.</small>
            </div>
        `;

        discountInputs.forEach(el => el.removeAttribute('required'));
        bundleInputs.forEach(el => el.setAttribute('required', 'true'));
    } else {
        discountFields.style.display = "flex";
        bundlePriceField.style.display = "none";

        const dVal = discountFields.querySelector('[name="discount_value"]');
        if (dVal) dVal.setAttribute('required', 'true');

        bundleInputs.forEach(el => el.removeAttribute('required'));

        if (type === "bill_discount") {
            container.innerHTML = `
                <div class="form-group">
                    <label>Monto Mínimo de Compra</label>
                    <input type="number" name="min_purchase_amount" class="form-control" value="0" oninput="calculateProfit()">
                </div>
            `;
        } else if (type === "bulk_discount") {
            container.innerHTML = `
                <div class="form-group">
                    <label>Cantidad Mínima (ej. 3 para 3x2)</label>
                    <input type="number" name="min_quantity" class="form-control" value="2" oninput="calculateProfit()">
                </div>
            `;
        }
    }
    calculateProfit();
}

function calculateProfit() {
    const type = document.getElementById("promoType").value;
    const form = document.getElementById("promoForm");
    const formData = new FormData(form);

    let currentTotalRevenue = 0;
    let currentTotalCost = 0;
    let newTotalRevenue = 0;

    selectedTargets.forEach(t => {
        const price = parseFloat(t.price) || 0;
        const cost = parseFloat(t.cost) || 0;
        currentTotalRevenue += price;
        currentTotalCost += cost;
    });

    if (type === "bundle") {
        newTotalRevenue = parseFloat(formData.get("bundle_price")) || 0;
    } else if (type === "simple_discount" || type === "bulk_discount") {
        const discType = formData.get("discount_type");
        const discVal = parseFloat(formData.get("discount_value")) || 0;

        selectedTargets.forEach(t => {
            const price = parseFloat(t.price) || 0;
            let discountedPrice = price;
            if (discType === "percentage") {
                discountedPrice = price * (1 - discVal / 100);
            } else {
                discountedPrice = price - discVal;
            }
            newTotalRevenue += Math.max(0, discountedPrice);
        });
    } else {
        // bill_discount is harder to estimate without a real ticket, 
        // but we can show it based on current selection if any
        const discType = formData.get("discount_type");
        const discVal = parseFloat(formData.get("discount_value")) || 0;
        if (discType === "percentage") {
            newTotalRevenue = currentTotalRevenue * (1 - discVal / 100);
        } else {
            newTotalRevenue = currentTotalRevenue - discVal;
        }
    }

    const currentProfit = currentTotalRevenue - currentTotalCost;
    const newProfit = newTotalRevenue - currentTotalCost;
    const diff = newProfit - currentProfit;

    document.getElementById("currentProfit").innerText = `$${currentProfit.toFixed(2)}`;
    document.getElementById("newProfit").innerText = `$${newProfit.toFixed(2)}`;

    const diffEl = document.getElementById("profitDiff");
    diffEl.innerText = `${diff >= 0 ? "+" : ""}$${diff.toFixed(2)}`;

    const diffRow = document.getElementById("profitDiffRow");
    diffRow.className = `profit-row profit-diff ${diff >= 0 ? "positive" : "negative"}`;
}

async function loadPromotions() {
    const list = document.getElementById("promotionsList");
    if (!list) return;
    try {
        const res = await fetch("../api/promotions/read.php");
        const data = await res.json();
        if (data && data.success) {
            loadedPromotionsData = data.data; // Store global
            renderPromotions(loadedPromotionsData);
        }
    } catch (e) {
        list.innerHTML = "Error de conexión";
    }
}

async function savePromotion(e) {
    e.preventDefault();

    // Get raw form elements to access disabled/hidden inputs easily
    const form = e.target;
    const type = form.querySelector('[name="type"]').value;

    if (selectedTargets.length === 0 && type !== "bill_discount") {
        showNotification("Selecciona al menos un producto para la promoción", "warning");
        return;
    }

    // Construct Clean Payload (Manual mapping to ensure stability matching successful tests)
    const payload = {
        name: form.querySelector('[name="name"]').value,
        description: "",
        start_date: form.querySelector('[name="start_date"]').value,
        end_date: form.querySelector('[name="end_date"]').value,
        type: type,
        discount_type: form.querySelector('[name="discount_type"]')?.value || 'percentage',
        discount_value: form.querySelector('[name="discount_value"]')?.value || '',
        targets: selectedTargets
    };

    // Specific field logic
    if (type === 'bundle') {
        const bp = form.querySelector('[name="bundle_price"]')?.value;
        payload.bundle_price = bp ? bp.toString() : "";
        payload.discount_value = "";
    } else {
        const dv = form.querySelector('[name="discount_value"]')?.value;
        payload.discount_value = dv ? dv.toString() : "0";
    }

    // Optional fields with defaults
    const minQty = form.querySelector('[name="min_quantity"]');
    const minPurch = form.querySelector('[name="min_purchase_amount"]');

    payload.min_quantity = minQty ? (parseInt(minQty.value) || 1) : 1;
    payload.min_purchase_amount = minPurch ? (parseFloat(minPurch.value) || 0) : 0;
    
    // Add Edit Mode Data
    let endpoint = "../api/promotions/create.php";
    if (editingPromotionId) {
        endpoint = "../api/promotions/update.php";
        payload.promotion_id = editingPromotionId;
        // Assume active if updating via this modal, unless we add a checkbox for active state later
        payload.is_active = 1; 
    }

    console.log("Sending Payload:", payload);

    try {
        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const text = await res.text();
        let result;
        try {
            result = JSON.parse(text);
        } catch (err) {
            console.error("Server Raw Response:", text);
            throw new Error("Respuesta inválida del servidor: " + text.substring(0, 50));
        }

        if (result.success) {
            closePromoModal();
            showNotification("Promoción guardada exitosamente", "success");
            setTimeout(() => loadPromotions(), 100);
        } else {
            showNotification(result.message || "Error al guardar la promoción", "error");
            console.warn("API Error:", result);
        }
    } catch (e) {
        console.error(e);
        showNotification(e.message || "Error de conexión con el servidor", "error");
    }
}


async function deletePromotion(id) {
    showConfirmModal("Eliminar Promoción", "¿Estás seguro que deseas eliminar esta promoción? Esta acción no se puede deshacer.", async () => {
        try {
            const res = await fetch("../api/promotions/delete.php", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ promotion_id: id })
            });
            const result = await res.json();
            if (result.success) {
                showNotification("Promoción eliminada", "success");
                loadPromotions();
            } else {
                showNotification(result.message || "No se pudo eliminar", "error");
            }
        } catch (e) {
            showNotification("Error de conexión al eliminar", "error");
        }
    });
}

function formatType(type) {
    const types = { "simple_discount": "Simple", "bulk_discount": "Volumen", "bill_discount": "Total", "bundle": "Paquete" };
    return types[type] || type;
}

// ============================================================
// PAGINATION
// ============================================================
const PROMO_PER_PAGE = 9;
let currentPage = 1;

function formatCurrency(amount) {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount || 0);
}

function formatNumber(num) {
    return new Intl.NumberFormat('es-MX').format(num || 0);
}

function getPromotionStatus(promo) {
    const now = new Date();
    const start = new Date(promo.start_date.replace(' ', 'T'));
    const end = new Date(promo.end_date.replace(' ', 'T'));
    const isFlagActive = promo.is_active == 1;

    if (!isFlagActive) {
        return { label: 'Inactiva', class: 'inactive', icon: 'fa-toggle-off' };
    }
    if (now < start) {
        const daysToStart = Math.max(1, Math.ceil((start - now) / (1000 * 60 * 60 * 24)));
        return { label: 'Próxima', class: 'upcoming', icon: 'fa-clock', daysToStart };
    }
    if (now > end) {
        return { label: 'Expirada', class: 'expired', icon: 'fa-calendar-times' };
    }
    return { label: 'Activa', class: 'active', icon: 'fa-check-circle' };
}

function getPromotionDateInfo(promo) {
    const now = new Date();
    const start = new Date(promo.start_date.replace(' ', 'T'));
    const end = new Date(promo.end_date.replace(' ', 'T'));

    let daysActive = 0;
    let daysLeft = 0;
    let daysToStart = 0;

    if (now >= start) {
        daysActive = Math.max(0, Math.floor((Math.min(now, end) - start) / (1000 * 60 * 60 * 24)));
    }
    if (now <= end) {
        daysLeft = Math.max(0, Math.ceil((end - Math.max(now, start)) / (1000 * 60 * 60 * 24)));
    }
    if (now < start) {
        daysToStart = Math.max(0, Math.ceil((start - now) / (1000 * 60 * 60 * 24)));
    }

    return { daysActive, daysLeft, daysToStart };
}

function getPromotionProgress(promo) {
    const now = new Date();
    const start = new Date(promo.start_date.replace(' ', 'T'));
    const end = new Date(promo.end_date.replace(' ', 'T'));
    const total = end - start;

    if (total <= 0) return { percent: 100, label: 'Finalizada' };
    if (now < start) return { percent: 0, label: 'Por iniciar' };
    if (now > end) return { percent: 100, label: 'Finalizada' };

    const elapsed = now - start;
    const percent = Math.min(100, Math.max(0, (elapsed / total) * 100));
    return { percent: Math.round(percent), label: `${percent.toFixed(0)}% transcurrido` };
}

function renderPromotions(promotions) {
    const list = document.getElementById("promotionsList");
    if (!list) return;

    list.className = "promotions-grid";

    if (!promotions || promotions.length === 0) {
        list.innerHTML = "<p style='text-align:center; color:var(--text-muted); padding:40px 0; grid-column: 1 / -1;'><i class='fas fa-tags' style='font-size:2rem; color:var(--text-muted); margin-bottom:10px; display:block;'></i>No hay promociones activas.<br><small style='color:var(--text-muted);'>Crea una nueva para empezar</small></p>";
        document.getElementById('promoPagination').style.display = 'none';
        return;
    }

    const totalPages = Math.ceil(promotions.length / PROMO_PER_PAGE);
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const start = (currentPage - 1) * PROMO_PER_PAGE;
    const pageItems = promotions.slice(start, start + PROMO_PER_PAGE);

    list.innerHTML = pageItems.map(p => {
        const status = getPromotionStatus(p);
        const dateInfo = getPromotionDateInfo(p);
        const progress = getPromotionProgress(p);
        const targetCount = p.targets ? p.targets.length : 0;
        const stats = p.stats || { units_sold: 0, sales_count: 0, revenue: 0 };
        const isDone = status.class === 'expired' || status.class === 'inactive';

        const targetImages = (p.targets || []).slice(0, 4).map(t => {
            let img = getRelativeImagePath(t.image_path) || 'assets/images/products/default-product.svg';
            return `<img src="${img}" alt="" onerror="this.src='assets/images/products/default-product.svg'">`;
        }).join('');
        const moreTargets = targetCount > 4 ? `<span class="promo-more-targets">+${targetCount - 4}</span>` : '';

        let dateBadgeText = '';
        if (status.class === 'expired') {
            dateBadgeText = 'Finalizada';
        } else if (status.class === 'inactive') {
            dateBadgeText = 'Inactiva';
        } else if (status.daysToStart) {
            dateBadgeText = `Inicia en ${status.daysToStart} día${status.daysToStart !== 1 ? 's' : ''}`;
        } else if (dateInfo.daysLeft > 0) {
            dateBadgeText = `${dateInfo.daysLeft} día${dateInfo.daysLeft !== 1 ? 's' : ''} restantes`;
        } else if (dateInfo.daysLeft === 0 && status.class === 'active') {
            dateBadgeText = 'Finaliza hoy';
        }

        const discountValue = p.type === "bundle"
            ? "$" + parseFloat(p.discount_value).toFixed(2)
            : parseFloat(p.discount_value) + (p.discount_type === "percentage" ? "%" : "$");

        return `
            <div class="promo-card-v2 ${status.class} ${isDone ? 'promo-done' : ''}">
                <div class="promo-card-top">
                    <div class="promo-title-row">
                        <h3 class="promo-name" title="${p.name}">${p.name}</h3>
                        <div class="promo-status-badge ${status.class}">
                            <i class="fas ${status.icon}"></i> ${status.label}
                        </div>
                    </div>
                    <div class="promo-discount-row">
                        <div class="promo-discount-big">${discountValue}</div>
                        <div class="promo-discount-meta">
                            <span class="promo-discount-label">${p.type === "bundle" ? "Precio fijo" : "Descuento"}</span>
                            <span class="promo-type-pill">${formatType(p.type)}</span>
                        </div>
                    </div>
                </div>

                <div class="promo-timeline">
                    <div class="promo-timeline-bar">
                        <div class="promo-timeline-progress ${status.class}" style="width: ${progress.percent}%"></div>
                    </div>
                    <div class="promo-timeline-labels">
                        <span><i class="fas fa-play"></i> ${new Date(p.start_date).toLocaleDateString()}</span>
                        <span class="promo-timeline-center">${progress.label}</span>
                        <span>${new Date(p.end_date).toLocaleDateString()} <i class="fas fa-flag-checkered"></i></span>
                    </div>
                    ${dateBadgeText ? `<div class="promo-date-badge ${status.class}">${dateBadgeText}</div>` : ''}
                </div>

                <div class="promo-stats">
                    <div class="promo-stat">
                        <i class="fas fa-shopping-cart"></i>
                        <div>
                            <span class="promo-stat-value">${formatNumber(stats.sales_count)}</span>
                            <span class="promo-stat-label">Ventas</span>
                        </div>
                    </div>
                    <div class="promo-stat">
                        <i class="fas fa-box-open"></i>
                        <div>
                            <span class="promo-stat-value">${formatNumber(stats.units_sold)}</span>
                            <span class="promo-stat-label">Unidades</span>
                        </div>
                    </div>
                    <div class="promo-stat">
                        <i class="fas fa-dollar-sign"></i>
                        <div>
                            <span class="promo-stat-value">${formatCurrency(stats.revenue)}</span>
                            <span class="promo-stat-label">Ingresos</span>
                        </div>
                    </div>
                </div>

                <div class="promo-card-footer">
                    <div class="promo-targets-preview">
                        ${targetImages}
                        ${moreTargets}
                        <span class="promo-targets-label">${targetCount} producto${targetCount !== 1 ? 's' : ''}</span>
                    </div>
                    <div class="promo-actions">
                        <button class="btn btn-info" onclick="openPromoModal(${p.promotion_id}, true)" title="Ver"><i class="fas fa-eye"></i></button>
                        <button class="btn btn-primary" onclick="openPromoModal(${p.promotion_id}, false)" title="Editar"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-danger" onclick="deletePromotion(${p.promotion_id})" title="Eliminar"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            </div>
        `;
    }).join("");

    renderPagination(totalPages);
}

function renderPagination(totalPages) {
    const pageNumbers = document.getElementById('pageNumbers');
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    const pagination = document.getElementById('promoPagination');

    if (!pageNumbers) return;
    if (totalPages <= 1) {
        pagination.style.display = 'none';
        return;
    }
    pagination.style.display = 'flex';

    prevBtn.disabled = currentPage === 1;
    nextBtn.disabled = currentPage === totalPages;

    let html = '';
    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
        html += `<button type="button" class="page-num ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }

    pageNumbers.innerHTML = html;
    pageNumbers.querySelectorAll('.page-num').forEach(btn => {
        btn.addEventListener('click', () => {
            currentPage = parseInt(btn.dataset.page);
            renderPromotions(loadedPromotionsData);
        });
    });

    prevBtn.onclick = () => {
        if (currentPage > 1) { currentPage--; renderPromotions(loadedPromotionsData); }
    };
    nextBtn.onclick = () => {
        if (currentPage < totalPages) { currentPage++; renderPromotions(loadedPromotionsData); }
    };
}

// ============================================================
// DRAWER (mobile)
// ============================================================
let promoDrawer = null;
let drawerEditingId = null;

function isMobileView() {
    return window.innerWidth <= 768;
}

function openPromoDrawer(promoId = null) {
    const form = document.getElementById("promoFormDrawer");
    if (!form) return;

    form.reset();
    selectedTargets = [];
    drawerEditingId = promoId;

    const titleEl = document.getElementById("promoDrawerTitle");
    const saveBtn = document.getElementById("saveDrawerBtn");

    if (promoId) {
        const promo = loadedPromotionsData.find(p => p.promotion_id == promoId);
        if (!promo) return;
        titleEl.innerHTML = '<i class="fas fa-edit"></i> Editar Promoción';
        saveBtn.textContent = 'Actualizar';

        form.querySelector('[name="name"]').value = promo.name;
        const fmtDate = (d) => d ? d.replace(' ', 'T').substring(0, 16) : '';
        form.querySelector('[name="start_date"]').value = fmtDate(promo.start_date);
        form.querySelector('[name="end_date"]').value = fmtDate(promo.end_date);
        form.querySelector('[name="type"]').value = promo.type;
        updateDrawerFields();

        if (promo.type === 'bundle') {
            const bp = form.querySelector('[name="bundle_price"]');
            if (bp) bp.value = promo.discount_value;
        } else {
            const dv = form.querySelector('[name="discount_value"]');
            const dt = form.querySelector('[name="discount_type"]');
            if (dv) dv.value = promo.discount_value;
            if (dt) dt.value = promo.discount_type;
        }

        const minQ = form.querySelector('[name="min_quantity"]');
        if (minQ) minQ.value = promo.min_quantity;
        const minP = form.querySelector('[name="min_purchase_amount"]');
        if (minP) minP.value = promo.min_purchase_amount;

        if (promo.targets && promo.targets.length > 0) {
            selectedTargets = promo.targets.map(t => {
                let fullInfo = {};
                if (t.product_id) {
                    const p = allProducts.find(prod => prod.product_id == t.product_id);
                    if (p) {
                        fullInfo = { name: p.product_name, price: p.price, cost: p.cost, image: p.image_path };
                    } else {
                        fullInfo = { name: t.product_name, price: 0, cost: 0 };
                    }
                    return { type: "product", id: t.product_id, ...fullInfo };
                }
                return { type: "category", id: t.category_id, name: t.category_name };
            });
        }
    } else {
        titleEl.innerHTML = '<i class="fas fa-tags"></i> Nueva Promoción';
        saveBtn.textContent = 'Guardar Promoción';

        const now = new Date();
        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        const toLocalISOString = (date) => {
            const offset = date.getTimezoneOffset() * 60000;
            return (new Date(date - offset)).toISOString().slice(0, 16);
        };
        const startEl = form.querySelector('[name="start_date"]');
        const endEl = form.querySelector('[name="end_date"]');
        if (startEl) startEl.value = toLocalISOString(now);
        if (endEl) endEl.value = toLocalISOString(nextMonth);
        updateDrawerFields();
    }

    if (promoDrawer) {
        promoDrawer.classList.add("show");
        document.body.classList.add("modal-open");
        // Reset to first tab
        document.querySelectorAll('#promoDrawer .drawer-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('#promoDrawer .tab-panel').forEach(p => p.classList.remove('active'));
        const firstTab = document.querySelector('#promoDrawer .drawer-tab');
        const firstPanel = document.getElementById(firstTab?.dataset?.dtab);
        if (firstTab) firstTab.classList.add('active');
        if (firstPanel) firstPanel.classList.add('active');

        if (allProducts.length === 0) {
            loadProductsForDrawer();
        } else {
            renderDrawerProducts(allProducts);
            renderDrawerSelected();
        }
    }
}

function closePromoDrawer() {
    if (promoDrawer) {
        promoDrawer.classList.remove("show");
    }
    document.body.classList.remove("modal-open");
    const form = document.getElementById("promoFormDrawer");
    if (form) form.reset();
    selectedTargets = [];
    drawerEditingId = null;
}

function updateDrawerFields() {
    const type = document.querySelector('#promoFormDrawer [name="type"]').value;
    const container = document.getElementById("drawerConditionFields");
    const discountFields = document.getElementById("drawerDiscountFields");
    const bundlePriceField = document.getElementById("drawerBundlePriceField");

    container.innerHTML = "";

    if (type === "bundle") {
        discountFields.style.display = "none";
        bundlePriceField.style.display = "block";
        container.innerHTML = `
            <div class="form-group">
                <label>Cantidad Total de Artículos</label>
                <div class="input-icon-wrapper">
                    <i class="fas fa-cubes"></i>
                    <input type="number" name="min_quantity" class="form-control" value="2" min="1" required>
                </div>
                <small style="font-size:0.75rem; color:var(--text-muted);">Suma total de productos para el paquete.</small>
            </div>
        `;
    } else {
        discountFields.style.display = "flex";
        bundlePriceField.style.display = "none";

        if (type === "bill_discount") {
            container.innerHTML = `
                <div class="form-group">
                    <label>Monto Mínimo de Compra</label>
                    <div class="input-icon-wrapper">
                        <i class="fas fa-dollar-sign"></i>
                        <input type="number" name="min_purchase_amount" class="form-control" value="0">
                    </div>
                </div>
            `;
        } else if (type === "bulk_discount") {
            container.innerHTML = `
                <div class="form-group">
                    <label>Cantidad Mínima (ej. 3 para 3x2)</label>
                    <div class="input-icon-wrapper">
                        <i class="fas fa-cubes"></i>
                        <input type="number" name="min_quantity" class="form-control" value="2">
                    </div>
                </div>
            `;
        }
    }
    calculateDrawerProfit();
}

function calculateDrawerProfit() {
    const type = document.querySelector('#promoFormDrawer [name="type"]').value;
    const form = document.getElementById("promoFormDrawer");
    const formData = new FormData(form);

    let currentTotalRevenue = 0;
    let currentTotalCost = 0;
    let newTotalRevenue = 0;

    selectedTargets.forEach(t => {
        const price = parseFloat(t.price) || 0;
        const cost = parseFloat(t.cost) || 0;
        currentTotalRevenue += price;
        currentTotalCost += cost;
    });

    if (type === "bundle") {
        newTotalRevenue = parseFloat(formData.get("bundle_price")) || 0;
    } else if (type === "simple_discount" || type === "bulk_discount") {
        const discType = formData.get("discount_type");
        const discVal = parseFloat(formData.get("discount_value")) || 0;
        selectedTargets.forEach(t => {
            const price = parseFloat(t.price) || 0;
            let discountedPrice = price;
            if (discType === "percentage") {
                discountedPrice = price * (1 - discVal / 100);
            } else {
                discountedPrice = price - discVal;
            }
            newTotalRevenue += Math.max(0, discountedPrice);
        });
    } else {
        const discType = formData.get("discount_type");
        const discVal = parseFloat(formData.get("discount_value")) || 0;
        if (discType === "percentage") {
            newTotalRevenue = currentTotalRevenue * (1 - discVal / 100);
        } else {
            newTotalRevenue = currentTotalRevenue - discVal;
        }
    }

    const currentProfit = currentTotalRevenue - currentTotalCost;
    const newProfit = newTotalRevenue - currentTotalCost;
    const diff = newProfit - currentProfit;

    document.getElementById("drawerCurrentProfit").innerText = "$" + currentProfit.toFixed(2);
    document.getElementById("drawerNewProfit").innerText = "$" + newProfit.toFixed(2);
    const diffEl = document.getElementById("drawerProfitDiff");
    diffEl.innerText = (diff >= 0 ? "+" : "") + "$" + diff.toFixed(2);
    const diffRow = document.getElementById("drawerProfitDiffRow");
    diffRow.className = "profit-row profit-diff " + (diff >= 0 ? "positive" : "negative");
}

async function loadProductsForDrawer() {
    const grid = document.getElementById("drawerProductsGrid");
    grid.innerHTML = "<div style='grid-column:1/-1; text-align:center; padding:20px;'>Cargando productos...</div>";
    try {
        const res = await fetch("../api/inventory/products.php");
        const data = await res.json();
        if (data.success) {
            allProducts = data.data;
            renderDrawerProducts(allProducts);
        }
    } catch (e) {
        grid.innerHTML = "Error al cargar productos";
    }
}

function renderDrawerProducts(products) {
    const grid = document.getElementById("drawerProductsGrid");
    if (products.length === 0) {
        grid.innerHTML = "<div style='grid-column:1/-1; text-align:center; padding:20px; color:var(--text-light);'>No se encontraron productos</div>";
        return;
    }
    grid.innerHTML = products.map(p => {
        const isSelected = selectedTargets.some(t => t.id == p.product_id);
        let imgSrc = getRelativeImagePath(p.image_path);
        if (!imgSrc) imgSrc = 'assets/images/products/default-product.svg';
        const onErrorParams = "this.onerror=null;this.src='assets/images/products/default-product.svg';";
        return `
            <div class="product-item-card ${isSelected ? 'selected' : ''}" onclick="toggleDrawerProduct(${p.product_id})" title="${p.product_name}">
                <div class="product-item-img-wrapper">
                    <img src="${imgSrc}" alt="${p.product_name}" onerror="${onErrorParams}">
                    ${isSelected ? '<div class="selected-indicator"><i class="fas fa-check"></i></div>' : ''}
                </div>
                <div class="product-item-content">
                    <div class="product-item-name">${p.product_name}</div>
                    <div class="product-item-price">$${parseFloat(p.price).toFixed(2)}</div>
                </div>
            </div>
        `;
    }).join("");
    renderDrawerSelected();
}

function toggleDrawerProduct(productId) {
    const index = selectedTargets.findIndex(t => t.id == productId);
    if (index > -1) {
        selectedTargets.splice(index, 1);
    } else {
        const product = allProducts.find(p => p.product_id == productId);
        selectedTargets.push({
            type: "product",
            id: productId,
            name: product.product_name,
            price: product.price,
            cost: product.cost,
            image: product.image_path
        });
    }
    renderDrawerProducts(allProducts);
    calculateDrawerProfit();
}

function renderDrawerSelected() {
    const section = document.getElementById("drawerSelectedSection");
    const list = document.getElementById("drawerSelectedList");
    const countSpan = document.getElementById("drawerSelectedCount");
    if (!section || !list) return;

    if (countSpan) countSpan.innerText = selectedTargets.length;

    if (selectedTargets.length === 0) {
        section.style.display = 'none';
        list.innerHTML = '';
        return;
    }
    section.style.display = 'block';
    list.innerHTML = selectedTargets.map(t => {
        let imgTag = '';
        if (t.image_path) {
            const imgPath = getRelativeImagePath(t.image_path);
            imgTag = `<img src="${imgPath}" alt="img">`;
        } else {
            imgTag = `<div style="width:24px;height:24px;background:var(--dark-color);border-radius:50%;margin-right:8px;display:flex;align-items:center;justify-content:center;"><i class="fas fa-box" style="font-size:10px;color:#cbd5e1;"></i></div>`;
        }
        return `
            <div class="selected-chip">
                ${imgTag}
                <span>${t.name}</span>
                <i class="fas fa-times remove-chip" onclick="toggleDrawerProduct(${t.id})"></i>
            </div>
        `;
    }).join('');
}

async function saveDrawerPromotion() {
    const form = document.getElementById("promoFormDrawer");
    const type = form.querySelector('[name="type"]').value;

    if (selectedTargets.length === 0 && type !== "bill_discount") {
        showNotification("Selecciona al menos un producto", "warning");
        return;
    }

    const payload = {
        name: form.querySelector('[name="name"]').value,
        description: "",
        start_date: form.querySelector('[name="start_date"]').value,
        end_date: form.querySelector('[name="end_date"]').value,
        type: type,
        discount_type: form.querySelector('[name="discount_type"]')?.value || 'percentage',
        discount_value: form.querySelector('[name="discount_value"]')?.value || '',
        targets: selectedTargets
    };

    if (type === 'bundle') {
        const bp = form.querySelector('[name="bundle_price"]')?.value;
        payload.bundle_price = bp ? bp.toString() : "";
        payload.discount_value = "";
    } else {
        const dv = form.querySelector('[name="discount_value"]')?.value;
        payload.discount_value = dv ? dv.toString() : "0";
    }

    const minQty = form.querySelector('[name="min_quantity"]');
    const minPurch = form.querySelector('[name="min_purchase_amount"]');
    payload.min_quantity = minQty ? (parseInt(minQty.value) || 1) : 1;
    payload.min_purchase_amount = minPurch ? (parseFloat(minPurch.value) || 0) : 0;

    let endpoint = "../api/promotions/create.php";
    if (drawerEditingId) {
        endpoint = "../api/promotions/update.php";
        payload.promotion_id = drawerEditingId;
        payload.is_active = 1;
    }

    try {
        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const text = await res.text();
        let result;
        try { result = JSON.parse(text); } catch (err) {
            throw new Error("Respuesta inválida del servidor");
        }

        if (result.success) {
            closePromoDrawer();
            showNotification("Promoción guardada exitosamente", "success");
            setTimeout(() => loadPromotions(), 100);
        } else {
            showNotification(result.message || "Error al guardar", "error");
        }
    } catch (e) {
        console.error(e);
        showNotification(e.message || "Error de conexión", "error");
    }
}

// Override openPromoModal calls in promo cards to use drawer on mobile
const origOpen = window.openPromoModal;
window.openPromoModal = function(promoId, isReadOnly) {
    if (window.innerWidth <= 768) {
        openPromoDrawer(promoId);
    } else {
        origOpen(promoId, isReadOnly);
    }
};
