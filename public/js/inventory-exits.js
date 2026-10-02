/* ============================================================
   EGRESOS DE INVENTARIO (salidas que NO son ventas)
   ------------------------------------------------------------
   El espejo de «Próximas Compras»: la compra mete mercancía y saca dinero; el egreso
   SOLO saca mercancía — traspaso a otra empresa, pérdida, siniestro, caducidad, consumo
   interno. Por eso aquí no hay precios, no hay estados y no hay «ejecutar»: al confirmar,
   el stock ya bajó (lo hace el API en una sola transacción).

   Vive en la pestaña «Movimientos y Compras» del inventario, junto a las compras: es una
   subsección del módulo, no una página aparte.

   Reusa a propósito las clases del módulo de compras (composer-layout, purchase-product-card,
   selected-purchase-row…): el mismo problema se ve igual en toda la pantalla, y el móvil ya
   está resuelto en ese CSS.
   ============================================================ */

const EXIT_REASON_LABELS = {
    transfer: 'Traspaso',
    loss: 'Pérdida',
    damage: 'Siniestro',
    expiry: 'Caducidad',
    internal: 'Consumo interno',
    other: 'Otro'
};
// El motivo NO es obligatorio: si no se elige, el egreso se registra sin motivo.
const EXIT_REASON_ICONS = {
    transfer: 'fa-truck-arrow-right',
    loss: 'fa-arrow-trend-down',
    damage: 'fa-triangle-exclamation',
    expiry: 'fa-hourglass-end',
    internal: 'fa-utensils',
    other: 'fa-ellipsis'
};
const EXIT_REASON_COLORS = {
    transfer: '#3b82f6',
    loss: '#dc2626',
    damage: '#ef4444',
    expiry: '#f59e0b',
    internal: '#8b5cf6',
    other: '#6b7280'
};

let exitProducts = [];          // catálogo para el composer
let exitSelection = new Map();  // product_id -> {producto, quantity}
let exitFilter = '';            // motivo filtrado ('' = todos)
let exitRows = [];              // último listado traído del API
let exitDestinos = [];          // otras empresas, para el traspaso
let exitStoreId = null;

const exitNum = v => {
    const n = Number(v) || 0;
    return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
};

async function exitMiEmpresa() {
    if (exitStoreId) return exitStoreId;
    try {
        const s = await checkSession();
        exitStoreId = Number(s && s.store_id) || null;
    } catch (e) { exitStoreId = null; }
    return exitStoreId;
}

// ── Lista ───────────────────────────────────────────────────────────────

async function loadExits() {
    const list = document.getElementById('exitsList');
    if (!list) return;
    try {
        // Se traen TODOS (hasta el tope del API) y se filtra en el cliente: así los chips de
        // motivo pueden decir cuántos hay de cada uno y no aparecen motivos vacíos.
        const data = await api('../api/inventory/exits.php?limit=200');
        exitRows = (data.data && data.data.exits) || [];
        renderExitFilters();
        renderExitList();
    } catch (e) {
        list.innerHTML = `<div class="empty-state"><i class="fas fa-triangle-exclamation"></i><br>${esc(e.message)}</div>`;
    }
}

/**
 * Los chips de filtro se construyen con los motivos que REALMENTE hay: siete chips fijos
 * (uno por motivo) llenan la pantalla de opciones que casi nunca tienen nada detrás.
 */
function renderExitFilters() {
    const caja = document.getElementById('exitFilterChips');
    if (!caja) return;
    const cuenta = {};
    exitRows.forEach(r => { const k = r.reason || ''; cuenta[k] = (cuenta[k] || 0) + 1; });
    const motivos = Object.keys(cuenta).filter(k => k !== '').sort((a, b) => cuenta[b] - cuenta[a]);
    const piezas = [''].concat(motivos).map(m => {
        const label = m === '' ? 'Todas' : (EXIT_REASON_LABELS[m] || m);
        const icon = m === '' ? 'fa-list' : (EXIT_REASON_ICONS[m] || 'fa-ellipsis');
        const total = m === '' ? exitRows.length : cuenta[m];
        return `<button type="button" class="filter-chip${(exitFilter === m) ? ' active' : ''}" data-reason="${m}" aria-pressed="${exitFilter === m}">
            <i class="fas ${icon}"></i> ${label} <span class="chip-count">${total}</span>
        </button>`;
    });
    if (cuenta['']) { piezas.push(`<button type="button" class="filter-chip${(exitFilter === 'sin') ? ' active' : ''}" data-reason="sin" aria-pressed="${exitFilter === 'sin'}"><i class="fas fa-circle-question"></i> Sin especificar <span class="chip-count">${cuenta['']}</span></button>`); }
    caja.innerHTML = piezas.join('');
    caja.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            exitFilter = chip.dataset.reason || '';
            renderExitFilters();
            renderExitList();
        });
    });
}

function exitBadge(row) {
    if (!row.reason) {
        return '<span class="purchase-status" style="background:#6b7280">Sin especificar</span>';
    }
    const color = EXIT_REASON_COLORS[row.reason] || '#6b7280';
    const icon = EXIT_REASON_ICONS[row.reason] || 'fa-ellipsis';
    return `<span class="purchase-status" style="background:${color}"><i class="fas ${icon}"></i> ${esc(row.reason_label || EXIT_REASON_LABELS[row.reason] || row.reason)}</span>`;
}

function renderExitList() {
    const list = document.getElementById('exitsList');
    if (!list) return;
    const visibles = exitRows.filter(r => {
        if (exitFilter === '') return true;
        if (exitFilter === 'sin') return !r.reason;
        return r.reason === exitFilter;
    });
    if (!visibles.length) {
        list.innerHTML = `<div class="empty-state"><i class="fas fa-box-open"></i><br>${exitFilter ? 'No hay egresos con ese motivo' : 'Todavía no has registrado salidas de inventario'}</div>`;
        return;
    }
    list.innerHTML = visibles.map(r => {
        const destino = r.destination_store_name
            ? `<span><i class="fas fa-share-from-square"></i> A ${esc(r.destination_store_name)}</span>`
            : (r.destination_note ? `<span><i class="fas fa-share-from-square"></i> A ${esc(r.destination_note)}</span>` : '');
        return `
        <button type="button" class="purchase-card" data-exit-id="${r.exit_id}">
            <span class="purchase-card-header">
                <span class="purchase-id">#${r.exit_id}</span>
                ${exitBadge(r)}
            </span>
            <span class="purchase-supplier">${esc(r.products_text || 'Sin renglones')}${r.lines > 2 ? ' …' : ''}</span>
            <span class="purchase-meta">
                <span><i class="fas fa-box"></i> ${r.lines} renglón(es)</span>
                <span class="purchase-total">${exitNum(r.total_quantity)} pza(s)</span>
            </span>
            <span class="purchase-date">
                ${dateText(r.created_at)} · ${esc(r.user_name || '')}${destino ? ' · ' + destino : ''}
            </span>
        </button>`;
    }).join('');
    list.querySelectorAll('[data-exit-id]').forEach(card => {
        card.addEventListener('click', () => openExitDetail(Number(card.dataset.exitId)));
    });
}

// ── Composer ────────────────────────────────────────────────────────────

async function loadExitProducts() {
    if (exitProducts.length) return exitProducts;
    const data = await api('../api/inventory/products.php?all=1');
    // Fuera los que no llevan inventario: no hay nada que sacarles.
    exitProducts = (data.data || []).filter(p => p.status === 'active' && p.tracking_type && p.tracking_type !== 'none');
    return exitProducts;
}

async function loadExitDestinos() {
    if (exitDestinos.length) return exitDestinos;
    try {
        const mia = await exitMiEmpresa();
        const data = await api('../api/stores/read.php');
        exitDestinos = ((data.data && (data.data.stores || data.data)) || [])
            .filter(s => Number(s.store_id) !== Number(mia))
            .map(s => ({ id: Number(s.store_id), name: s.store_name }));
    } catch (e) { exitDestinos = []; }
    return exitDestinos;
}

function exitCard(p, selected) {
    const tipo = p.tracking_type === 'component' ? 'Componente' : (p.tracking_type === 'recipe' ? 'Preparado' : 'Producto final');
    const disp = Number(p.available ?? p.current_stock ?? 0);
    const cls = typeof stockClasses === 'function' ? stockClasses(disp, p.min_stock ?? 0) : '';
    const txt = typeof stockQty === 'function' ? stockQty(disp) : exitNum(disp);
    return `<button type="button" class="purchase-product-card ${selected ? 'selected' : ''}" data-product-id="${p.product_id}" aria-pressed="${selected}">
        <span class="product-check"><i class="fas ${selected ? 'fa-check' : 'fa-plus'}"></i></span>
        <img src="${esc(p.image_path || 'assets/images/products/default-product.svg')}" onerror="this.src='assets/images/products/default-product.svg'" alt="">
        <span class="product-card-name">${esc(p.product_name)}</span>
        <span class="product-card-type">${tipo} · <span class="product-card-stock ${cls}">Hay ${txt}</span></span>
    </button>`;
}

function renderExitCatalog() {
    const modal = document.getElementById('exitComposerModal');
    if (!modal) return;
    const q = (modal.querySelector('#exitCatalogSearch').value || '').toLowerCase().trim();
    const tipo = modal.querySelector('#exitCatalogType').value || '';
    const filtrados = exitProducts.filter(p =>
        (!q || `${p.product_name} ${p.barcode || ''} ${p.qr_code || ''}`.toLowerCase().includes(q)) &&
        (!tipo || p.tracking_type === tipo)
    );
    modal.querySelector('#exitProductCatalog').innerHTML = filtrados.length
        ? filtrados.map(p => exitCard(p, exitSelection.has(Number(p.product_id)))).join('')
        : '<div class="empty-state">No hay productos con estos filtros</div>';
    modal.querySelectorAll('#exitProductCatalog [data-product-id]').forEach(card => {
        card.addEventListener('click', () => toggleExitProduct(Number(card.dataset.productId)));
    });
    renderExitSelection();
}

function toggleExitProduct(id) {
    const p = exitProducts.find(x => Number(x.product_id) === Number(id));
    if (!p) return;
    if (exitSelection.has(Number(id))) exitSelection.delete(Number(id));
    else exitSelection.set(Number(id), { product: p, quantity: 1 });
    renderExitCatalog();
}

function renderExitSelection() {
    const modal = document.getElementById('exitComposerModal');
    if (!modal) return;
    const target = modal.querySelector('#exitSelectedItems');
    if (!exitSelection.size) {
        target.innerHTML = '<div class="selected-empty">Elige del catálogo lo que sale del inventario</div>';
    } else {
        target.innerHTML = [...exitSelection.values()].map(({ product, quantity }) => {
            const disp = Number(product.available ?? product.current_stock ?? 0);
            const excede = quantity > disp + 0.0001;
            return `<div class="selected-purchase-row" data-selected-id="${product.product_id}">
                <button type="button" class="selected-item-remove" data-exit-remove="${product.product_id}" aria-label="Quitar ${esc(product.product_name)}" title="Quitar producto"><i class="fas fa-times"></i></button>
                <div class="selected-purchase-name">
                    <i class="fas ${product.tracking_type === 'component' ? 'fa-cubes' : 'fa-box'}"></i>
                    <strong>${esc(product.product_name)}</strong>
                    <small>Hay ${exitNum(disp)}${excede ? ' — pides sacar más de lo que hay' : ''}</small>
                </div>
                <label>Cantidad a sacar
                    <input type="number" min="0.001" step="0.001" inputmode="decimal" data-exit-qty="${product.product_id}" value="${exitNum(quantity)}">
                </label>
            </div>`;
        }).join('');
    }
    target.querySelectorAll('[data-exit-remove]').forEach(b => {
        b.addEventListener('click', () => { exitSelection.delete(Number(b.dataset.exitRemove)); renderExitCatalog(); });
    });
    target.querySelectorAll('[data-exit-qty]').forEach(i => {
        i.addEventListener('input', () => {
            const sel = exitSelection.get(Number(i.dataset.exitQty));
            if (!sel) return;
            sel.quantity = Number(i.value) || 0;
            const fila = i.closest('.selected-purchase-row');
            const aviso = fila && fila.querySelector('small');
            const disp = Number(sel.product.available ?? sel.product.current_stock ?? 0);
            if (aviso) aviso.textContent = `Hay ${exitNum(disp)}${sel.quantity > disp + 0.0001 ? ' — pides sacar más de lo que hay' : ''}`;
            actualizarExitContador();
        });
    });
    actualizarExitContador();
}

function actualizarExitContador() {
    const cont = document.querySelector('#exitCartCount');
    if (!cont) return;
    const piezas = [...exitSelection.values()].reduce((s, x) => s + (Number(x.quantity) || 0), 0);
    cont.textContent = `${exitSelection.size} producto(s) · ${exitNum(piezas)} pieza(s)`;
}

function elegirExitMotivo(motivo) {
    const modal = document.getElementById('exitComposerModal');
    if (!modal) return;
    modal.querySelectorAll('#exitReasonChips .filter-chip').forEach(c => {
        const activo = (c.dataset.reason || '') === (motivo || '');
        c.classList.toggle('active', activo);
        c.setAttribute('aria-pressed', activo ? 'true' : 'false');
    });
    // El destino solo tiene sentido cuando la salida es un traspaso.
    const caja = modal.querySelector('#exitDestinationBox');
    if (caja) caja.hidden = (motivo !== 'transfer');
}

async function openExitComposer() {
    try {
        await Promise.all([loadExitProducts(), loadExitDestinos()]);
        exitSelection = new Map();

        const tipos = [...new Set(exitProducts.map(p => p.tracking_type))];
        const destinos = exitDestinos.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('');

        const motivos = ['', 'transfer', 'loss', 'damage', 'expiry', 'internal', 'other'].map(m => {
            const label = m === '' ? 'Sin especificar' : EXIT_REASON_LABELS[m];
            const icon = m === '' ? 'fa-circle-question' : EXIT_REASON_ICONS[m];
            return `<button type="button" class="filter-chip" data-reason="${m}" aria-pressed="false"><i class="fas ${icon}"></i> ${label}</button>`;
        }).join('');

        const body = `<div class="composer-layout">
            <section class="composer-catalog">
                <div class="composer-intro"><p>Elige lo que sale del inventario. Aquí no se cobra ni se paga: solo se descuenta.</p></div>
                <div class="catalog-filters">
                    <input type="search" id="exitCatalogSearch" placeholder="Buscar por nombre o código" aria-label="Buscar productos">
                    <select id="exitCatalogType">
                        <option value="">Producto, componente o preparado</option>
                        ${tipos.includes('stock') ? '<option value="stock">Productos finales</option>' : ''}
                        ${tipos.includes('component') ? '<option value="component">Componentes</option>' : ''}
                        ${tipos.includes('recipe') ? '<option value="recipe">Preparados</option>' : ''}
                    </select>
                </div>
                <div id="exitProductCatalog" class="purchase-product-catalog"></div>
            </section>
            <aside class="composer-order">
                <div class="composer-order-heading"><h3><i class="fas fa-arrow-right-from-bracket"></i> Salida</h3></div>
                <div class="composer-fields">
                    <span class="exit-field-label">¿Por qué sale? <small>(opcional)</small></span>
                    <div class="filter-chips exit-reason-chips" id="exitReasonChips">${motivos}</div>
                    <div id="exitDestinationBox" class="exit-destino-caja" hidden>
                        ${destinos
                            ? `<label>¿A qué empresa se traspasa?
                                   <select id="exitDestination">${destinos}</select>
                               </label>`
                            : `<p class="exit-sin-destinos"><i class="fas fa-circle-info"></i> Este sistema no tiene otras empresas registradas: escribe a dónde va.</p>`}
                        <label>A dónde va
                            <input type="text" id="exitDestinationNote" maxlength="150" placeholder="Sucursal, proveedor, cliente…">
                        </label>
                    </div>
                    <label>Aclaración del motivo
                        <input type="text" id="exitReasonNote" maxlength="255" placeholder="Opcional: se cayó la charola, robo…">
                    </label>
                    <label>Notas de la salida
                        <textarea id="exitNotes" rows="2" maxlength="1000" placeholder="Opcional"></textarea>
                    </label>
                </div>
                <div id="exitSelectedItems" class="selected-purchase-items"></div>
                <div class="composer-cart-total"><span id="exitCartCount">0 producto(s)</span></div>
            </aside>
        </div>`;

        const acciones = `<button type="button" class="btn-secondary" data-close-modal="exitComposerModal">Cancelar</button>
            <button type="button" class="btn-primary" id="saveExitBtn"><i class="fas fa-arrow-right-from-bracket"></i> Registrar salida</button>`;

        const modal = modalFrame('exitComposerModal', '<i class="fas fa-arrow-up-long"></i> Nueva salida', body, acciones);
        modal.querySelector('[data-close-modal]').addEventListener('click', () => modal.remove());
        ['exitCatalogSearch', 'exitCatalogType'].forEach(id => {
            modal.querySelector('#' + id).addEventListener(id === 'exitCatalogSearch' ? 'input' : 'change', renderExitCatalog);
        });
        modal.querySelectorAll('#exitReasonChips .filter-chip').forEach(c => {
            c.addEventListener('click', () => elegirExitMotivo(c.dataset.reason));
        });
        modal.querySelector('#saveExitBtn').addEventListener('click', saveExit);
        elegirExitMotivo('');
        renderExitCatalog();
    } catch (e) { notify(e.message, 'error'); }
}

async function saveExit() {
    const modal = document.getElementById('exitComposerModal');
    if (!modal) return;
    const items = [...exitSelection.values()]
        .filter(x => Number(x.quantity) > 0 && Number.isFinite(Number(x.quantity)))
        .map(x => ({ product_id: Number(x.product.product_id), quantity: Number(x.quantity) }));
    if (!items.length) { notify('Elige al menos un producto y su cantidad', 'error'); return; }

    const motivo = (modal.querySelector('#exitReasonChips .filter-chip.active') || {}).dataset?.reason || '';
    const destino = motivo === 'transfer' ? (modal.querySelector('#exitDestination')?.value || '') : '';
    const destinoNota = motivo === 'transfer' ? (modal.querySelector('#exitDestinationNote')?.value.trim() || '') : '';

    const boton = modal.querySelector('#saveExitBtn');
    boton.disabled = true;
    try {
        const r = await api('../api/inventory/exits.php', {
            method: 'POST',
            body: JSON.stringify({
                reason: motivo || null,
                reason_note: modal.querySelector('#exitReasonNote').value.trim() || null,
                destination_store_id: destino || null,
                destination_note: destinoNota || null,
                notes: modal.querySelector('#exitNotes').value.trim() || null,
                items
            })
        });
        modal.remove();
        notify((r.message || 'Egreso registrado'), 'success');
        await loadExits();
        // El inventario cambió: la lista de productos de atrás quedó vieja.
        exitProducts = [];
    } catch (e) {
        notify(e.message, 'error');
        boton.disabled = false;
    }
}

// ── Detalle y deshacer ──────────────────────────────────────────────────

async function openExitDetail(id) {
    try {
        const data = await api(`../api/inventory/exits.php?exit_id=${id}`);
        const ex = data.data || {};
        const filas = (ex.items || []).map(i => `
            <tr>
                <td>${esc(i.product_name)}</td>
                <td class="exit-num">${exitNum(i.quantity)}</td>
                <td class="exit-num">${exitNum(i.previous_stock)}</td>
                <td class="exit-num">${exitNum(i.new_stock)}</td>
            </tr>`).join('');
        const destino = ex.destination_store_name ? `Se traspasa a ${esc(ex.destination_store_name)}.`
            : (ex.destination_note ? `Sale a ${esc(ex.destination_note)}.` : '');

        const body = `<div class="exit-detail">
            <p class="exit-detail-head">
                ${exitBadge(ex)}
                <span>${dateText(ex.created_at)} · ${esc(ex.user_name || '')}</span>
            </p>
            ${ex.reason_note ? `<p><strong>Motivo:</strong> ${esc(ex.reason_note)}</p>` : ''}
            ${destino ? `<p>${destino}</p>` : ''}
            ${ex.notes ? `<p><strong>Notas:</strong> ${esc(ex.notes)}</p>` : ''}
            <div class="movements-table-wrap">
                <table class="movements-table">
                    <thead><tr><th>Producto</th><th class="exit-num">Salió</th><th class="exit-num">Había</th><th class="exit-num">Queda</th></tr></thead>
                    <tbody>${filas}</tbody>
                </table>
            </div>
        </div>`;
        const acciones = `<button type="button" class="btn-secondary" data-close-modal="exitDetailModal">Cerrar</button>
            <button type="button" class="btn-danger" id="undoExitBtn"><i class="fas fa-rotate-left"></i> Deshacer</button>`;
        const modal = modalFrame('exitDetailModal', `<i class="fas fa-box-open"></i> Salida #${ex.exit_id}`, body, acciones);
        modal.querySelector('[data-close-modal]').addEventListener('click', () => modal.remove());
        modal.querySelector('#undoExitBtn').addEventListener('click', () => {
            decisionModal('Deshacer la salida', 'La mercancía vuelve al inventario y el egreso se borra. En el historial de movimientos queda la salida y su reintegro: nada se borra de la historia.', 'Deshacer', async () => {
                try {
                    const r = await api(`../api/inventory/exits.php?exit_id=${ex.exit_id}`, { method: 'DELETE' });
                    modal.remove();
                    notify(r.message || 'Egreso deshecho', 'success');
                    exitProducts = [];
                    await loadExits();
                } catch (e) { notify(e.message, 'error'); }
            }, true);
        });
    } catch (e) { notify(e.message, 'error'); }
}

// ── Enganches ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('newExitBtn')?.addEventListener('click', openExitComposer);
    // La pestaña del inventario arranca en «Productos»: el listado se pide cuando se abre.
    document.querySelectorAll('.inv-tab').forEach(t => t.addEventListener('click', () => {
        if (t.dataset.tab === 'movements') loadExits();
    }));
    loadExits();
});
