/* ============================================================
   SALIDAS DE INVENTARIO (egresos)
   ------------------------------------------------------------
   Lo que sale sin cobrarse: traspaso, pérdida, siniestro, caducidad, consumo
   interno. El listado, el detalle y el deshacer viven aquí; la CAPTURA
   (buscar, elegir cantidades, revisar la lista) la hace el compositor
   compartido `compositor-inventario.js`, el MISMO que usa la entrada: así las
   dos pantallas se sienten iguales y no se separan con el tiempo.
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

let exitProducts = [];          // catálogo para el compositor
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

// ── Captura ─────────────────────────────────────────────────────────────

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

async function openExitComposer() {
    try {
        await Promise.all([loadExitProducts(), loadExitDestinos()]);
        const modal = CompositorInv.abrir({
            modo: 'salida',
            titulo: 'Nueva salida',
            icono: 'fa-arrow-up-long',
            textoLista: 'Lista de salidas',
            textoAccion: 'Registrar salida',
            productos: exitProducts,
            campos: { motivo: true, notas: true },
            alGuardar: async (items, campos) => {
                const r = await api('../api/inventory/exits.php', {
                    method: 'POST',
                    body: JSON.stringify({
                        reason: campos.motivo || null,
                        reason_note: campos.motivoNota,
                        destination_store_id: campos.destinoId || null,
                        destination_note: campos.destinoNota,
                        notes: campos.notas,
                        items: items.map(i => ({ product_id: i.product_id, quantity: i.cantidad })),
                    })
                });
                notify(r.message || 'Egreso registrado: el inventario ya bajó', 'success');
                await loadExits();
                exitProducts = [];   // el inventario cambió: el catálogo queda viejo
            }
        });
        // El destino solo tiene sentido en un traspaso, y solo si hay otras empresas.
        const sel = modal.querySelector('#ciDestinoSelect');
        if (sel) {
            sel.innerHTML = exitDestinos.length
                ? exitDestinos.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')
                : '<option value="">No hay otras empresas registradas</option>';
            sel.disabled = !exitDestinos.length;
        }
    } catch (e) { notify(e.message, 'error'); }
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
        const modal = modalFrame('exitDetailModal', `<i class="fas fa-arrow-up-long"></i> Salida #${ex.exit_id}`, body, acciones);
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
