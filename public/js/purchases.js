/**
 * Purchases & Movements Tab — Gestión de compras y historial de movimientos
 * Se carga en inventory.html junto con inventory.js
 */

/* ═══════════════════════════════════════════════════════════
   TAB SWITCHING
   ═══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.inv-tab');
    const contents = document.querySelectorAll('.inv-tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => { c.classList.remove('active'); c.style.display = 'none'; });
            tab.classList.add('active');
            const panel = document.querySelector(`.inv-tab-content[data-tab="${target}"]`);
            if (panel) { panel.classList.add('active'); panel.style.display = ''; }

            // Load both sections on first visit to Movimientos
            if (target === 'movements' && !window._movementsLoaded) {
                loadPurchases();
                loadMovements();
                window._purchasesLoaded = true;
                window._movementsLoaded = true;
            }
        });
    });
});

/* ═══════════════════════════════════════════════════════════
   PURCHASES
   ═══════════════════════════════════════════════════════════ */
const PURCHASE_STATUS_LABELS = { draft: 'Borrador', pending: 'Pendiente', executed: 'Ejecutada', cancelled: 'Cancelada' };
const PURCHASE_STATUS_COLORS = { draft: '#6b7280', pending: '#f59e0b', executed: '#10b981', cancelled: '#ef4444' };
const MOVEMENT_TYPE_LABELS = { entry: 'Entrada', exit: 'Salida', adjustment: 'Ajuste', sale: 'Venta', return: 'Devolución', purchase: 'Compra', loss: 'Pérdida' };
const MOVEMENT_TYPE_COLORS = { entry: '#10b981', exit: '#ef4444', adjustment: '#6b7280', sale: '#3b82f6', return: '#f59e0b', purchase: '#8b5cf6', loss: '#dc2626' };

let currentPurchaseId = null;

async function loadPurchases() {
    const list = document.getElementById('purchasesList');
    if (!list) return;
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>';

    const statusFilter = document.getElementById('purchaseStatusFilter')?.value || '';
    const url = '../api/purchases/purchases.php' + (statusFilter ? `?status=${statusFilter}` : '');

    try {
        const res = await fetch(url, { credentials: 'include' });
        const data = await res.json();
        if (!data.success) { list.innerHTML = `<div class="empty-state">${data.error || 'Error al cargar'}</div>`; return; }

        const purchases = data.data || [];
        if (!purchases.length) {
            list.innerHTML = '<div class="empty-state"><i class="fas fa-cart-shopping" style="font-size:2rem;margin-bottom:10px;opacity:.3"></i><br>No hay órdenes de compra</div>';
            return;
        }

        list.innerHTML = purchases.map(p => `
            <div class="purchase-card" onclick="openPurchaseDetail(${p.purchase_id})">
                <div class="purchase-card-header">
                    <span class="purchase-id">#${p.purchase_id}</span>
                    <span class="purchase-status" style="background:${PURCHASE_STATUS_COLORS[p.status] || '#6b7280'}">${PURCHASE_STATUS_LABELS[p.status] || p.status}</span>
                </div>
                <div class="purchase-card-body">
                    <div class="purchase-supplier">${p.supplier_name || 'Sin proveedor'}</div>
                    <div class="purchase-meta">
                        <span><i class="fas fa-box"></i> ${p.item_count} ítem(s)</span>
                        <span><i class="fas fa-dollar-sign"></i> ${fmtMoney(p.total_cost)}</span>
                    </div>
                    <div class="purchase-date">${formatDate(p.created_at)}</div>
                </div>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = '<div class="empty-state">Error de conexión</div>';
    }
}

async function openPurchaseDetail(purchaseId) {
    currentPurchaseId = purchaseId;
    try {
        const res = await fetch(`../api/purchases/purchases.php?purchase_id=${purchaseId}`, { credentials: 'include' });
        const data = await res.json();
        if (!data.success) { showNotification(data.error, 'error'); return; }
        renderPurchaseModal(data.data);
    } catch (e) {
        showNotification('Error de conexión', 'error');
    }
}

function renderPurchaseModal(purchase) {
    const isEditable = ['draft', 'pending'].includes(purchase.status);
    const isPending = purchase.status === 'pending';

    let html = `
    <div class="modal" id="purchaseDetailModal" style="display:flex">
        <div class="modal-content" style="max-width:750px;width:95%;max-height:85vh;overflow-y:auto">
            <div class="modal-header">
                <h2><i class="fas fa-receipt"></i> Compra #${purchase.purchase_id}
                    <span class="purchase-status" style="background:${PURCHASE_STATUS_COLORS[purchase.status]}">${PURCHASE_STATUS_LABELS[purchase.status]}</span>
                </h2>
                <button class="modal-close" onclick="closePurchaseModal()"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
                <div class="purchase-detail-meta">
                    <div><strong>Proveedor:</strong> ${purchase.supplier_name || '—'}</div>
                    <div><strong>Creado por:</strong> ${purchase.creator_name}</div>
                    <div><strong>Fecha:</strong> ${formatDate(purchase.created_at)}</div>
                    ${purchase.executed_at ? `<div><strong>Ejecutado:</strong> ${formatDate(purchase.executed_at)}</div>` : ''}
                    ${purchase.notes ? `<div><strong>Notas:</strong> ${purchase.notes}</div>` : ''}
                </div>

                <h4 style="margin:16px 0 8px">Ítems</h4>
                <div class="purchase-items-list">
    `;

    if (!purchase.items.length) {
        html += '<div class="empty-state" style="padding:16px">No hay ítems en esta orden</div>';
    } else {
        purchase.items.forEach(item => {
            const typeIcon = item.tracking_type === 'component' ? 'fa-cubes' : 'fa-box';
            const planned = parseFloat(item.planned_quantity);
            const actual = item.actual_quantity !== null ? parseFloat(item.actual_quantity) : null;
            const cost = parseFloat(item.unit_cost);
            const total = parseFloat(item.total_cost);

            html += `
            <div class="purchase-item-row" data-item-id="${item.item_id}">
                <div class="purchase-item-info">
                    <img src="${item.image_path || 'assets/images/logos/default-logo.png'}" class="purchase-item-thumb" onerror="this.src='assets/images/logos/default-logo.png'">
                    <div>
                        <div class="purchase-item-name"><i class="fas ${typeIcon}"></i> ${item.product_name}</div>
                        <div class="purchase-item-type">${item.tracking_type === 'component' ? 'Componente' : 'Producto'}</div>
                    </div>
                </div>
                <div class="purchase-item-qty">
                    ${isEditable && !item.actual_quantity ? `
                        <label>Plan:</label> <span>${planned}</span>
                    ` : `
                        <label>Real:</label> <strong>${actual !== null ? actual : '—'}</strong>
                    `}
                </div>
                <div class="purchase-item-cost">
                    ${cost > 0 ? `<div>${fmtMoney(cost)}/uni</div><div class="total">${fmtMoney(total)}</div>` : '<span style="color:var(--text-muted)">—</span>'}
                </div>
                ${isEditable && !item.actual_quantity ? `
                <div class="purchase-item-actions">
                    <button class="btn-sm btn-danger" onclick="removePurchaseItem(${purchase.purchase_id}, ${item.item_id})" title="Quitar">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                ` : ''}
            </div>`;
        });
    }

    html += '</div>';

    // Action buttons
    if (isEditable) {
        html += `
        <div class="purchase-actions">
            <button class="btn-secondary" onclick="showAddItemPicker(${purchase.purchase_id})">
                <i class="fas fa-plus"></i> Agregar Producto
            </button>
            ${isPending ? `
            <button class="btn-primary" onclick="startExecutePurchase(${purchase.purchase_id})">
                <i class="fas fa-play"></i> Ejecutar Compra
            </button>
            ` : ''}
            <button class="btn-danger-outline" onclick="cancelPurchase(${purchase.purchase_id})">
                <i class="fas fa-ban"></i> Cancelar
            </button>
        </div>`;
    }

    html += '</div></div></div>';
    document.body.insertAdjacentHTML('beforeend', html);
}

function closePurchaseModal() {
    const modal = document.getElementById('purchaseDetailModal');
    if (modal) modal.remove();
    currentPurchaseId = null;
}

/* ── New Purchase ── */
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('newPurchaseBtn');
    if (btn) btn.addEventListener('click', createNewPurchase);
});

async function createNewPurchase() {
    const supplier = prompt('Nombre del proveedor (opcional):');
    try {
        const res = await fetch('../api/purchases/purchases.php', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ supplier_name: supplier || null })
        });
        const data = await res.json();
        if (data.success) {
            showNotification('Orden creada', 'success');
            loadPurchases();
            openPurchaseDetail(data.data.purchase_id);
        } else {
            showNotification(data.error, 'error');
        }
    } catch (e) {
        showNotification('Error de conexión', 'error');
    }
}

/* ── Add Item ── */
function showAddItemPicker(purchaseId) {
    closePurchaseModal();
    // Create a simple product picker modal
    const html = `
    <div class="modal" id="addItemModal" style="display:flex">
        <div class="modal-content" style="max-width:500px;width:95%">
            <div class="modal-header">
                <h2><i class="fas fa-search"></i> Agregar Producto</h2>
                <button class="modal-close" onclick="document.getElementById('addItemModal').remove()"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
                <input type="text" id="itemSearchInput" class="search-input" placeholder="Buscar producto..." style="width:100%;margin-bottom:12px">
                <div id="itemSearchResults" class="item-search-results"></div>
                <div id="itemQtySection" style="display:none;margin-top:12px">
                    <label>Cantidad a comprar:</label>
                    <input type="text" inputmode="decimal" id="itemQtyInput" class="search-input" value="1" style="width:100px;margin-left:8px">
                    <button class="btn-primary" style="margin-left:8px" onclick="confirmAddItem(${purchaseId})">
                        <i class="fas fa-check"></i> Agregar
                    </button>
                </div>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);

    const searchInput = document.getElementById('itemSearchInput');
    const resultsDiv = document.getElementById('itemSearchResults');
    let searchTimeout;

    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async () => {
            const q = searchInput.value.trim();
            if (q.length < 2) { resultsDiv.innerHTML = ''; return; }
            try {
                const res = await fetch(`../api/inventory/products.php?search=${encodeURIComponent(q)}&context=pos`, { credentials: 'include' });
                const data = await res.json();
                if (!data.success || !data.data) { resultsDiv.innerHTML = '<div class="empty-state">No encontrado</div>'; return; }
                const products = data.data.filter(p => p.tracking_type === 'stock' || p.tracking_type === 'component');
                if (!products.length) { resultsDiv.innerHTML = '<div class="empty-state">No hay productos stock/componente</div>'; return; }
                resultsDiv.innerHTML = products.map(p => `
                    <div class="item-search-row" onclick="selectItemForPurchase(${p.product_id}, '${p.product_name.replace(/'/g, "\\'")}', '${p.tracking_type}')">
                        <img src="${p.image_path || 'assets/images/logos/default-logo.png'}" class="item-thumb" onerror="this.src='assets/images/logos/default-logo.png'">
                        <div>
                            <div class="item-name">${p.product_name}</div>
                            <div class="item-type">${p.tracking_type === 'component' ? 'Componente' : 'Producto'} — Stock: ${p.current_stock || 0}</div>
                        </div>
                    </div>
                `).join('');
            } catch (e) { resultsDiv.innerHTML = '<div class="empty-state">Error</div>'; }
        }, 300);
    });
    searchInput.focus();
}

window._selectedItemId = null;
window._selectedItemName = '';

function selectItemForPurchase(productId, name, type) {
    window._selectedItemId = productId;
    window._selectedItemName = name;
    document.getElementById('itemSearchResults').innerHTML = `<div class="item-selected"><i class="fas fa-check-circle"></i> ${name} (${type})</div>`;
    document.getElementById('itemQtySection').style.display = '';
    document.getElementById('itemQtyInput').focus();
}

async function confirmAddItem(purchaseId) {
    const qty = parseFloat(document.getElementById('itemQtyInput').value);
    if (!window._selectedItemId || isNaN(qty) || qty <= 0) {
        showNotification('Selecciona un producto y cantidad válida', 'error');
        return;
    }
    try {
        const res = await fetch('../api/purchases/purchases.php', {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ purchase_id: purchaseId, action: 'add_item', product_id: window._selectedItemId, planned_quantity: qty })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('addItemModal')?.remove();
            showNotification('Ítem agregado', 'success');
            openPurchaseDetail(purchaseId);
            loadPurchases();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (e) { showNotification('Error', 'error'); }
}

async function removePurchaseItem(purchaseId, itemId) {
    if (!confirm('¿Quitar este ítem de la orden?')) return;
    try {
        const res = await fetch('../api/purchases/purchases.php', {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ purchase_id: purchaseId, action: 'remove_item', item_id: itemId })
        });
        const data = await res.json();
        if (data.success) {
            showNotification('Ítem eliminado', 'success');
            openPurchaseDetail(purchaseId);
            loadPurchases();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (e) { showNotification('Error', 'error'); }
}

/* ── Execute Purchase ── */
async function startExecutePurchase(purchaseId) {
    // Reload detail to get items
    try {
        const res = await fetch(`../api/purchases/purchases.php?purchase_id=${purchaseId}`, { credentials: 'include' });
        const data = await res.json();
        if (!data.success) { showNotification(data.error, 'error'); return; }
        renderExecuteModal(data.data);
    } catch (e) { showNotification('Error', 'error'); }
}

function renderExecuteModal(purchase) {
    closePurchaseModal();
    let html = `
    <div class="modal" id="executeModal" style="display:flex">
        <div class="modal-content" style="max-width:700px;width:95%;max-height:85vh;overflow-y:auto">
            <div class="modal-header">
                <h2><i class="fas fa-play-circle"></i> Ejecutar Compra #${purchase.purchase_id}</h2>
                <button class="modal-close" onclick="document.getElementById('executeModal').remove()"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
                <p style="color:var(--text-muted);margin-bottom:16px">Ingresa las cantidades reales recibidas y el costo unitario pagado.</p>
                <div class="execute-items">
    `;

    purchase.items.forEach(item => {
        const planned = parseFloat(item.planned_quantity);
        html += `
        <div class="execute-item-row" data-item-id="${item.item_id}">
            <div class="execute-item-name">${item.product_name} <small>(${item.tracking_type})</small></div>
            <div class="execute-item-fields">
                <div class="execute-field">
                    <label>Cantidad real</label>
                    <input type="text" inputmode="decimal" class="execute-qty" data-item-id="${item.item_id}" value="${planned}" placeholder="${planned}">
                </div>
                <div class="execute-field">
                    <label>Costo unitario</label>
                    <input type="text" inputmode="decimal" class="execute-cost" data-item-id="${item.item_id}" value="0.00" placeholder="0.00">
                </div>
                <div class="execute-field execute-subtotal">
                    <label>Subtotal</label>
                    <span class="execute-total" data-item-id="${item.item_id}">$0.00</span>
                </div>
            </div>
        </div>`;
    });

    html += `
                </div>
                <div class="execute-summary">
                    <strong>Total: <span id="executeGrandTotal">$0.00</span></strong>
                </div>
                <div class="purchase-actions" style="margin-top:16px">
                    <button class="btn-primary" onclick="confirmExecute(${purchase.purchase_id})">
                        <i class="fas fa-check"></i> Confirmar Ejecución
                    </button>
                </div>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);

    // Live total calculation
    document.querySelectorAll('.execute-qty, .execute-cost').forEach(input => {
        input.addEventListener('input', () => {
            const itemId = input.dataset.itemId;
            const qty = parseFloat(document.querySelector(`.execute-qty[data-item-id="${itemId}"]`)?.value) || 0;
            const cost = parseFloat(document.querySelector(`.execute-cost[data-item-id="${itemId}"]`)?.value) || 0;
            const sub = qty * cost;
            document.querySelector(`.execute-total[data-item-id="${itemId}"]`).textContent = fmtMoney(sub);
            recalcExecuteTotal();
        });
    });
}

function recalcExecuteTotal() {
    let total = 0;
    document.querySelectorAll('.execute-total').forEach(el => {
        total += parseFloat(el.textContent.replace(/[^0-9.]/g, '')) || 0;
    });
    const el = document.getElementById('executeGrandTotal');
    if (el) el.textContent = fmtMoney(total);
}

async function confirmExecute(purchaseId) {
    const items = [];
    document.querySelectorAll('.execute-item-row').forEach(row => {
        const itemId = parseInt(row.dataset.itemId);
        const qty = parseFloat(row.querySelector('.execute-qty')?.value) || 0;
        const cost = parseFloat(row.querySelector('.execute-cost')?.value) || 0;
        if (qty > 0) items.push({ item_id: itemId, actual_quantity: qty, unit_cost: cost });
    });

    if (!items.length) { showNotification('Ingresa cantidades para al menos un ítem', 'error'); return; }
    if (!confirm('¿Confirmar ejecución? Se actualizará el inventario y la caja.')) return;

    try {
        const res = await fetch('../api/purchases/purchases.php', {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ purchase_id: purchaseId, action: 'execute', items })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('executeModal')?.remove();
            showNotification(`Compra ejecutada — Total: ${fmtMoney(data.data.total_cost)}`, 'success');
            loadPurchases();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (e) { showNotification('Error de conexión', 'error'); }
}

/* ── Cancel Purchase ── */
async function cancelPurchase(purchaseId) {
    if (!confirm('¿Cancelar esta orden de compra?')) return;
    try {
        const res = await fetch('../api/purchases/purchases.php', {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ purchase_id: purchaseId, action: 'cancel' })
        });
        const data = await res.json();
        if (data.success) {
            closePurchaseModal();
            showNotification('Compra cancelada', 'success');
            loadPurchases();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (e) { showNotification('Error', 'error'); }
}

/* ═══════════════════════════════════════════════════════════
   MOVEMENTS TAB
   ═══════════════════════════════════════════════════════════ */
async function loadMovements() {
    const list = document.getElementById('movementsList');
    if (!list) return;
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>';

    const type = document.getElementById('movementTypeFilter')?.value || '';
    const dateFrom = document.getElementById('movementDateFrom')?.value || '';
    const dateTo = document.getElementById('movementDateTo')?.value || '';

    let params = new URLSearchParams();
    if (type) params.set('type', type);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);

    try {
        const res = await fetch(`../api/purchases/inventory_log.php?${params}`, { credentials: 'include' });
        const data = await res.json();
        if (!data.success) { list.innerHTML = `<div class="empty-state">${data.error || 'Error'}</div>`; return; }

        const movements = data.data || [];
        if (!movements.length) {
            list.innerHTML = '<div class="empty-state"><i class="fas fa-arrows-spin" style="font-size:2rem;margin-bottom:10px;opacity:.3"></i><br>No hay movimientos registrados</div>';
            return;
        }

        let html = '<div class="movements-table-wrap"><table class="movements-table"><thead><tr>';
        html += '<th>Fecha</th><th>Producto</th><th>Tipo</th><th>Cantidad</th><th>Stock</th><th>Notas</th><th>Usuario</th>';
        html += '</tr></thead><tbody>';

        movements.forEach(m => {
            const color = MOVEMENT_TYPE_COLORS[m.movement_type] || '#6b7280';
            const label = MOVEMENT_TYPE_LABELS[m.movement_type] || m.movement_type;
            const sign = ['exit', 'sale', 'loss'].includes(m.movement_type) ? '-' : '+';
            const qtyColor = sign === '-' ? 'var(--danger-color, #ef4444)' : 'var(--success-color, #10b981)';

            html += `<tr>
                <td class="mov-date">${formatDate(m.created_at)}</td>
                <td class="mov-product">
                    <img src="${m.image_path || 'assets/images/logos/default-logo.png'}" class="mov-thumb" onerror="this.style.display='none'">
                    ${m.product_name}
                </td>
                <td><span class="mov-type-badge" style="background:${color}">${label}</span></td>
                <td style="color:${qtyColor};font-weight:600">${sign}${m.quantity}</td>
                <td>${m.previous_stock} → ${m.new_stock}</td>
                <td class="mov-notes">${m.notes || '—'}</td>
                <td>${m.user_name}</td>
            </tr>`;
        });

        html += '</tbody></table></div>';
        list.innerHTML = html;
    } catch (e) {
        list.innerHTML = '<div class="empty-state">Error de conexión</div>';
    }
}

// Filter button
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('filterMovementsBtn');
    if (btn) btn.addEventListener('click', () => { window._movementsLoaded = false; loadMovements(); window._movementsLoaded = true; });

    const statusFilter = document.getElementById('purchaseStatusFilter');
    if (statusFilter) statusFilter.addEventListener('change', () => { window._purchasesLoaded = false; loadPurchases(); window._purchasesLoaded = true; });
});

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */
function formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return dateStr; }
}
/* ── Inventory loss modal (opened from inventory product drawer) ── */
function openLossModal() {
    if (!currentEditingProduct) return;
    const product = products.find(p => p.product_id == currentEditingProduct);
    if (!product) return;
    const modal = document.getElementById('lossModal');
    const name = document.getElementById('lossProductName');
    const available = document.getElementById('lossAvailable');
    const qty = document.getElementById('lossQuantity');
    if (name) name.textContent = product.product_name;
    const stock = product.available !== undefined ? product.available : product.current_stock;
    if (available) available.textContent = `Disponible: ${stock ?? 0}`;
    if (qty) { qty.value = ''; qty.focus(); }
    if (modal) modal.classList.add('show');
}

function closeLossModal() {
    document.getElementById('lossModal')?.classList.remove('show');
}

async function submitLoss() {
    if (!currentEditingProduct) return;
    const quantity = parseFloat(document.getElementById('lossQuantity')?.value || '0');
    const reason = document.getElementById('lossReason')?.value?.trim() || 'Pérdida';
    if (!Number.isFinite(quantity) || quantity <= 0) {
        showNotification('Ingresa una cantidad válida', 'error');
        return;
    }
    try {
        const res = await fetch('../api/purchases/losses.php', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product_id: Number(currentEditingProduct), quantity, reason })
        });
        const data = await res.json();
        if (!data.success) {
            showNotification(data.error || data.message || 'No se pudo registrar la pérdida', 'error');
            return;
        }
        closeLossModal();
        closeProductDetails();
        showNotification('Pérdida registrada', 'success');
        await loadProducts();
        if (window._movementsLoaded) loadMovements();
    } catch (e) {
        showNotification('Error de conexión', 'error');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const lossForm = document.getElementById('lossForm');
    if (lossForm) lossForm.addEventListener('submit', e => { e.preventDefault(); submitLoss(); });
    const lossModal = document.getElementById('lossModal');
    if (lossModal) lossModal.addEventListener('click', e => { if (e.target === lossModal) closeLossModal(); });
});
