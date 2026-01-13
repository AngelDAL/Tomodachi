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

    modal.classList.add('show');
    document.body.classList.add('modal-open');
}

function closeConfirmModal() {
    const modal = document.getElementById('confirmModal');
    if (modal) modal.classList.remove('show');
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
                             image: p.image_url || p.image_path || p.image
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
        promoModal.classList.add("show");
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
        promoModal.classList.remove("show");
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

    if (openBtn) openBtn.addEventListener("click", (e) => { e.preventDefault(); openPromoModal(); });
    if (closeBtn) closeBtn.addEventListener("click", (e) => { e.preventDefault(); closePromoModal(); });
    if (promoModal) promoModal.addEventListener("click", (e) => { if (e.target === promoModal) closePromoModal(); });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && promoModal?.classList.contains("show")) {
            closePromoModal();
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
        grid.innerHTML = "<div style='grid-column: 1/-1; text-align:center; padding: 20px; color:#64748b;'>No se encontraron productos</div>";
        return;
    }
    grid.innerHTML = products.map(p => {
        const isSelected = selectedTargets.some(t => t.id == p.product_id);

        let imgSrc = getRelativeImagePath(p.image_url || p.image_path || p.image);
        if (!imgSrc) {
            // Fallback default
            imgSrc = 'assets/images/products/default.png';
        }

        // Manejar error de carga con onerror
        const onErrorParams = "this.onerror=null;this.src='assets/images/products/default.png';";

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
        if (t.image) {
            const imgPath = getRelativeImagePath(t.image);
            imgTag = `<img src="${imgPath}" alt="img">`;
        } else {
            imgTag = `<div style="width:24px;height:24px;background:#334155;border-radius:50%;margin-right:8px;display:flex;align-items:center;justify-content:center;"><i class="fas fa-box" style="font-size:10px;color:#cbd5e1;"></i></div>`;
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
            image: product.image_url || product.image_path || product.image
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

function renderPromotions(promotions) {
    const list = document.getElementById("promotionsList");
    if (!promotions || promotions.length === 0) {
        list.innerHTML = "<p style='text-align:center; color:#888;'>No hay promociones activas.</p>";
        return;
    }
    list.innerHTML = promotions.map(p => `
        <div class="promo-card ${p.is_active == 1 ? "" : "inactive"}">
            <div class="promo-details">
                <h3><span class="status-indicator ${p.is_active == 1 ? 'active' : ''}"></span>${p.name}</h3>
                <div class="promo-meta">
                    <span><i class="fas fa-calendar"></i> ${new Date(p.start_date).toLocaleDateString()} - ${new Date(p.end_date).toLocaleDateString()}</span>
                    <span><i class="fas fa-tag"></i> ${formatType(p.type)}</span>
                    <span><i class="fas fa-percent"></i> ${p.type === "bundle" ? "$" + parseFloat(p.discount_value).toFixed(2) + " (Fijo)" : parseFloat(p.discount_value) + (p.discount_type === "percentage" ? "%" : "$") + " OFF"}</span>
                </div>
            </div>
            <div class="promo-actions">
                <button class="btn btn-sm btn-info" onclick="openPromoModal(${p.promotion_id}, true)" title="Ver Detalles"><i class="fas fa-eye"></i></button>
                <button class="btn btn-sm btn-primary" onclick="openPromoModal(${p.promotion_id}, false)" title="Editar"><i class="fas fa-edit"></i></button>
                <button class="btn btn-sm btn-danger" onclick="deletePromotion(${p.promotion_id})" title="Eliminar"><i class="fas fa-trash"></i></button>
            </div>
        </div>
    `).join("");
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
