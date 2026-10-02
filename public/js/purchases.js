/**
 * Compras y movimientos de inventario.
 * Todo el flujo usa modales propios: nunca usa alert, confirm ni prompt.
 */
const PURCHASE_STATUS_LABELS = { draft:'Borrador', pending:'Pendiente', executed:'Ejecutada', cancelled:'Cancelada' };
const PURCHASE_STATUS_COLORS = { draft:'#6b7280', pending:'#f59e0b', executed:'#10b981', cancelled:'#ef4444' };
const MOVEMENT_TYPE_LABELS = { entry:'Entrada', exit:'Salida', adjustment:'Ajuste', sale:'Venta', return:'Devolución', purchase:'Compra', loss:'Pérdida', transfer:'Traspaso' };
const MOVEMENT_TYPE_COLORS = { entry:'#10b981', exit:'#ef4444', adjustment:'#6b7280', sale:'#3b82f6', return:'#f59e0b', purchase:'#8b5cf6', loss:'#dc2626', transfer:'#0ea5e9' };
let purchaseProducts = [];
let currentPurchaseId = null;

const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const money = value => (window.FormatUtils?.currency ? window.FormatUtils.currency(Number(value)||0) : `$${(Number(value)||0).toFixed(2)}`);
const dateText = value => value ? new Date(String(value).replace(' ','T')).toLocaleString('es-MX',{dateStyle:'medium',timeStyle:'short'}) : '—';
// Corta, para el historial: con siete columnas, la fecha larga se partía en tres renglones
// y sacaba la tabla del ancho de su tarjeta.
const dateTextCorto = value => value ? new Date(String(value).replace(' ','T')).toLocaleString('es-MX',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : '—';
const notify = (message, type='info') => window.showNotification ? window.showNotification(message,type) : undefined;

/**
 * La miniatura del producto en un detalle.
 *
 * Las rutas se guardan con el prefijo `public/` y estas páginas viven dentro de `public/`:
 * sin `getRelativeImagePath()` el navegador busca `public/public/...`, no encuentra nada y
 * queda el hueco gris (el mismo defecto que tenían las tarjetas del compositor).
 */
function fotoMov(item) {
    const cruda = item && item.image_path;
    const limpia = typeof getRelativeImagePath === 'function' ? getRelativeImagePath(cruda) : cruda;
    if (!limpia) return '<span class="mov-foto mov-foto-vacia" aria-hidden="true"><i class="fas fa-box"></i></span>';
    return `<span class="mov-foto"><img src="${esc(limpia)}" alt="Foto de ${esc(item.product_name || 'producto')}" loading="lazy" decoding="async" onerror="this.parentElement.classList.add('mov-foto-vacia');this.remove()"></span>`;
}

function modalFrame(id, title, body, actions='') {
    document.getElementById(id)?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="modal purchase-modal" id="${id}" style="display:flex" role="dialog" aria-modal="true"><div class="modal-content purchase-modal-content"><div class="modal-header"><h2>${title}</h2><button type="button" class="modal-close" data-close-modal="${id}" aria-label="Cerrar"><i class="fas fa-times"></i></button></div><div class="modal-body">${body}</div>${actions ? `<div class="modal-footer purchase-modal-footer">${actions}</div>` : ''}</div></div>`);
    document.getElementById(id).querySelector('[data-close-modal]')?.addEventListener('click', () => document.getElementById(id)?.remove());
    document.getElementById(id).addEventListener('click', e => { if (e.target.id === id) document.getElementById(id)?.remove(); });
    return document.getElementById(id);
}
function decisionModal(title, message, confirmText, onConfirm, danger=false) {
    const id='purchaseDecisionModal';
    const modal=modalFrame(id, `<i class="fas ${danger?'fa-triangle-exclamation':'fa-circle-question'}"></i> ${esc(title)}`, `<p class="decision-message">${esc(message)}</p>`, `<button type="button" class="btn-secondary" data-decision-cancel>Volver</button><button type="button" class="${danger?'btn-danger':'btn-primary'}" data-decision-confirm>${esc(confirmText)}</button>`);
    modal.querySelector('[data-decision-cancel]').addEventListener('click',()=>modal.remove());
    modal.querySelector('[data-decision-confirm]').addEventListener('click',()=>{ modal.remove(); onConfirm(); });
}

async function api(url, options={}) {
    const response=await fetch(url,{credentials:'include',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
    const data=await response.json();
    if (!data.success) throw new Error(data.error || data.message || 'No se pudo completar la operación');
    return data;
}

function setTab(target) {
    document.querySelectorAll('.inv-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===target));
    document.querySelectorAll('.inv-tab-content').forEach(c=>{ const active=c.dataset.tab===target; c.classList.toggle('active',active); c.style.display=active?'':'none'; });
    if (target==='inventory') { loadCategories(); loadProducts(); }
    if (target==='movements') { loadPurchases(); loadMovements(); }
}

document.addEventListener('DOMContentLoaded',()=>{
    document.querySelectorAll('.inv-tab').forEach(t=>t.addEventListener('click',()=>setTab(t.dataset.tab)));
    document.getElementById('newPurchaseBtn')?.addEventListener('click',()=>openPurchaseComposer());
    document.querySelectorAll('#purchaseFilterChips .filter-chip').forEach(c => {
        c.addEventListener('click', () => setPurchaseFilter(c.dataset.filter));
    });
    document.getElementById('filterMovementsBtn')?.addEventListener('click',loadMovements);
    document.getElementById('lossForm')?.addEventListener('submit',e=>{e.preventDefault();submitLoss();});
    document.getElementById('lossModal')?.addEventListener('click',e=>{if(e.target.id==='lossModal')closeLossModal();});
});

let currentPurchaseFilter = 'pending'; // Por defecto: solo pendientes
let allPurchasesCache = []; // Cache para contadores

function setPurchaseFilter(filter) {
    currentPurchaseFilter = filter;
    document.querySelectorAll('#purchaseFilterChips .filter-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.filter === filter);
    });
    loadPurchases();
}

async function loadPurchases() {
    const list = document.getElementById('purchasesList'); if (!list) return;
    list.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i> Cargando compras…</div>';
    try {
        // Siempre cargar todas para contadores, luego filtrar en cliente
        const data = await api('../api/purchases/purchases.php');
        allPurchasesCache = data.data || [];
        updateFilterCounts();
        const filtered = currentPurchaseFilter
            ? allPurchasesCache.filter(p => p.status === currentPurchaseFilter)
            : allPurchasesCache;
        renderPurchaseList(filtered);
    } catch (e) {
        list.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
    }
}

function updateFilterCounts() {
    const counts = { pending: 0, executed: 0, draft: 0, cancelled: 0 };
    allPurchasesCache.forEach(p => { if (counts[p.status] !== undefined) counts[p.status]++; });
    const elPending = document.getElementById('countPending');
    const elExecuted = document.getElementById('countExecuted');
    const elDraft = document.getElementById('countDraft');
    const elCancelled = document.getElementById('countCancelled');
    const elAll = document.getElementById('countAll');
    if (elPending) elPending.textContent = counts.pending;
    if (elExecuted) elExecuted.textContent = counts.executed;
    if (elDraft) elDraft.textContent = counts.draft;
    if (elCancelled) elCancelled.textContent = counts.cancelled;
    if (elAll) elAll.textContent = allPurchasesCache.length;
}

function renderPurchaseList(purchases) {
    const list = document.getElementById('purchasesList'); if (!list) return;
    if (!purchases.length) {
        list.innerHTML = '<div class="empty-state"><i class="fas fa-arrow-down-long"></i><br>No hay entradas</div>';
        return;
    }
    list.innerHTML = purchases.map(p => `
        <button type="button" class="purchase-card" data-purchase-id="${p.purchase_id}">
            <span class="purchase-card-header">
                <span class="purchase-id">#${p.purchase_id}</span>
                <span class="purchase-status" style="background:${PURCHASE_STATUS_COLORS[p.status]||'#6b7280'}">${esc(PURCHASE_STATUS_LABELS[p.status]||p.status)}</span>
            </span>
            <span class="purchase-supplier">${esc(p.supplier_name||'Sin proveedor')}</span>
            <span class="purchase-meta">
                <span><i class="fas fa-box"></i> ${p.item_count} ítem(s)</span>
                <span class="purchase-total">${money(p.total_cost)}</span>
            </span>
            <span class="purchase-date">${dateText(p.created_at)}</span>
        </button>`).join('');
    list.querySelectorAll('[data-purchase-id]').forEach(card => {
        card.addEventListener('click', () => openPurchaseDetail(Number(card.dataset.purchaseId)));
    });
}

async function loadPurchaseProducts() {
    if (purchaseProducts.length) return purchaseProducts;
    const data=await api('../api/inventory/products.php?all=1');
    purchaseProducts=(data.data||[]).filter(p=>p.status==='active'&&(p.tracking_type==='stock'||p.tracking_type==='component'));
    return purchaseProducts;
}

function getLastUnitCost(product) {
    return Math.max(0, Number(product?.derived_cost ?? product?.cost ?? product?.unit_cost ?? 0) || 0);
}
/**
 * Alta express: dar de alta un producto sin salir de la entrada (mismo patrón que el
 * punto de venta: se crea y queda agregado, sin viajar a otro formulario).
 */
function panelAltaExpress(modal, alCrear) {
    if (modal.querySelector('#ciExpressPanel')) return;
    const panel = document.createElement('div');
    panel.id = 'ciExpressPanel';
    panel.className = 'ci-express-panel';
    panel.innerHTML = `
        <div class="ci-express-cab">
            <h4><i class="fas fa-wand-magic-sparkles"></i> Alta express</h4>
            <button type="button" class="ci-icono" id="ciExpressCerrar" aria-label="Cerrar el alta express"><i class="fas fa-xmark"></i></button>
        </div>
        <p class="ci-express-intro">Da de alta un producto o componente sin salir de esta entrada.</p>
        <div class="ci-express-campos">
            <label class="ci-campo">Nombre<input id="ciExNombre" type="text" maxlength="150" autocomplete="off"></label>
            <label class="ci-campo">Tipo
                <select id="ciExTipo">
                    <option value="stock">Producto final</option>
                    <option value="component">Componente</option>
                </select>
            </label>
            <label class="ci-campo">Precio de venta<input id="ciExPrecio" type="number" min="0" step="0.01" value="0" inputmode="decimal"></label>
            <label class="ci-campo">Costo unitario<input id="ciExCosto" type="number" min="0" step="0.01" value="0" inputmode="decimal"></label>
            <label class="ci-campo">Existencia inicial<input id="ciExStock" type="number" min="0" step="1" value="0" inputmode="numeric"></label>
        </div>
        <button type="button" class="btn-primary" id="ciExCrear"><i class="fas fa-plus"></i> Crear y agregar</button>`;
    // El panel se abre donde el usuario está parado: en el catálogo (en el teléfono la lista
    // es otro panel y el alta express aparecería fuera de la vista).
    (modal.querySelector('.ci-catalogo') || modal.querySelector('.ci-lista') || modal.querySelector('.modal-body')).prepend(panel);
    panel.querySelector('#ciExpressCerrar').addEventListener('click', () => panel.remove());
    panel.querySelector('#ciExNombre').addEventListener('focus', ev => ev.target.select());
    panel.querySelector('#ciExCrear').addEventListener('click', async () => {
        const nombre = panel.querySelector('#ciExNombre').value.trim();
        const tipo = panel.querySelector('#ciExTipo').value;
        const precio = Number(panel.querySelector('#ciExPrecio').value) || 0;
        const costo = Number(panel.querySelector('#ciExCosto').value) || 0;
        const existencia = Math.max(0, Math.round(Number(panel.querySelector('#ciExStock').value) || 0));
        if (!nombre) { notify('Escribe un nombre para el producto', 'error'); return; }
        try {
            const creado = await api('../api/inventory/products.php', {
                method: 'POST',
                body: JSON.stringify({ product_name: nombre, price: precio, cost: costo, stock: tipo === 'stock' ? existencia : 0, tracking_type: tipo })
            });
            const producto = {
                ...(creado.data || {}), product_id: Number(creado.data.product_id), product_name: nombre,
                tracking_type: tipo, cost: costo, current_stock: existencia, available: existencia, status: 'active'
            };
            if (tipo === 'component' && existencia > 0) {
                await api('../api/inventory/lots.php', { method: 'POST', body: JSON.stringify({ product_id: producto.product_id, label: 'Existencia inicial', quantity: existencia, total_cost: existencia * costo }) });
            }
            panel.remove();
            alCrear(producto);
            notify('Producto creado y agregado a la lista', 'success');
        } catch (e) { notify(e.message, 'error'); }
    });
}

/**
 * El compositor de ENTRADA. Es el MISMO de la salida (`compositor-inventario.js`) con lo
 * que la entrada tiene de propio: proveedor, notas y presupuesto estimado; y el catálogo
 * de compra, que solo ofrece productos finales y componentes (un preparado no se compra:
 * se arma con sus ingredientes).
 */
async function openPurchaseComposer(existingPurchaseId = null) {
    try {
        await loadPurchaseProducts();
        let existente = null;
        const seleccion = new Map();
        if (existingPurchaseId) {
            existente = (await api(`../api/purchases/purchases.php?purchase_id=${existingPurchaseId}`)).data;
            (existente.items || []).filter(i => !i.actual_quantity).forEach(i => {
                const p = purchaseProducts.find(x => Number(x.product_id) === Number(i.product_id));
                if (p) seleccion.set(Number(i.product_id), { producto: { ...p, item_id: i.item_id }, cantidad: Math.max(1, Math.round(Number(i.planned_quantity) || 1)) });
            });
        }
        const modal = CompositorInv.abrir({
            modo: 'entrada',
            titulo: existente ? `Editar entrada #${existingPurchaseId}` : 'Nueva entrada',
            icono: 'fa-arrow-down-long',
            textoLista: 'Lista de entradas',
            textoAccion: 'Guardar la entrada',
            productos: purchaseProducts,
            campos: { proveedor: true, notas: true, presupuesto: true, express: true },
            seleccionInicial: seleccion,
            alCrearProducto: panelAltaExpress,
            alGuardar: (items, campos) => guardarEntrada(items, campos, existingPurchaseId),
        });
        if (existente) {
            const prov = modal.querySelector('#ciProveedor');
            const notas = modal.querySelector('#ciNotas');
            if (prov) prov.value = existente.supplier_name || '';
            if (notas) notas.value = existente.notes || '';
        }
    } catch (e) { notify(e.message, 'error'); }
}

/** Guarda la entrada: nueva (POST) o agregando renglones a una existente (PUT). */
async function guardarEntrada(items, campos, existingId) {
    const lista = items.map(i => ({
        item_id: i.item_id || null,
        product_id: i.product_id,
        planned_quantity: i.planned_quantity,
        total_cost: CompositorInv.ultimoCosto(i.producto) * i.planned_quantity,
    }));
    if (!lista.length) throw new Error('Elige al menos un producto');
    let id = existingId;
    if (!id) {
        const r = await api('../api/purchases/purchases.php', {
            method: 'POST',
            body: JSON.stringify({ supplier_name: campos.proveedor, notes: campos.notas, items: lista })
        });
        id = Number(r.data.purchase_id);
        notify('Entrada guardada', 'success');
    } else {
        for (const item of lista) {
            if (item.item_id) {
                await api('../api/purchases/purchases.php', { method: 'PUT', body: JSON.stringify({ purchase_id: id, action: 'update_item', item_id: Number(item.item_id), planned_quantity: item.planned_quantity, total_cost: item.total_cost }) });
            } else {
                await api('../api/purchases/purchases.php', { method: 'PUT', body: JSON.stringify({ purchase_id: id, action: 'add_item', product_id: item.product_id, planned_quantity: item.planned_quantity, total_cost: item.total_cost }) });
            }
        }
        notify('Entrada actualizada', 'success');
    }
    loadPurchases();
    openPurchaseDetail(id);
}

async function openPurchaseDetail(id) {
    try { const data=await api(`../api/purchases/purchases.php?purchase_id=${id}`); renderPurchaseDetail(data.data); } catch(e){notify(e.message,'error');}
}

// Cajas abiertas: todo movimiento de dinero tiene que decir de qué caja sale.
async function loadOpenRegisters() {
    try {
        const data = await api('../api/terminals/read.php');
        const terms = (data.data && data.data.terminals) || [];
        return terms
            .filter(t => t.current_register_id)
            .map(t => ({ register_id: Number(t.current_register_id), name: t.terminal_name || ('Caja ' + t.current_register_id) }));
    } catch (e) {
        return [];
    }
}

// Rellena el select de caja del detalle de compra
async function fillPurchaseRegisterSelect(modal) {
    const sel = modal.querySelector('#purchaseRegisterSelect');
    if (!sel) return;
    const cajas = await loadOpenRegisters();
    if (!cajas.length) {
        sel.innerHTML = '<option value="">No hay cajas abiertas</option>';
        return;
    }
    sel.innerHTML = cajas.map(c => `<option value="${c.register_id}">${esc(c.name)}</option>`).join('');
    // Con una sola caja no hay nada que elegir, pero se muestra igual para que
    // quede claro de dónde va a salir el dinero.
    sel.dataset.cajasCount = String(cajas.length);
}
function renderPurchaseDetail(p) {
    const editable=['draft','pending'].includes(p.status);
    const hasItems=p.items.length>0;
    const rows=p.items.map(i=>{
        const plannedTotal=Number(i.planned_total_cost||((Number(i.unit_cost)||0)*Number(i.planned_quantity)||0));
        const isEditable=editable&&!i.actual_quantity;
        const typeName=i.tracking_type==='component'?'Componente':'Producto final';
        const lastUnitCost=Number(i.last_unit_cost||0);
        if(isEditable){
            return `<div class="detail-item-row editable" data-item-id="${i.item_id}"><div class="detail-item-header"><div class="detail-item-name">${fotoMov(i)}<strong>${esc(i.product_name)}</strong><small>${typeName}</small></div><button type="button" class="icon-button danger" data-remove-detail="${i.item_id}" aria-label="Quitar"><i class="fas fa-trash"></i></button></div><div class="detail-item-cost-ref"><small>Último costo: ${money(lastUnitCost)}/ud</small></div><div class="detail-item-fields"><label class="detail-field"><span class="detail-field-label">Cantidad recibida</span><input type="number" min="0.001" step="0.001" data-detail-qty="${i.item_id}" value="${i.planned_quantity}"></label><label class="detail-field"><span class="detail-field-label">Costo total real</span><input type="number" min="0" step="0.01" data-detail-total="${i.item_id}" value="${plannedTotal}"></label></div></div>`;
        }
        // De lectura: la misma piel que las demás listas —foto, nombre, cantidades y dinero—
        // para que un detalle de entrada se lea igual que la lista del compositor.
        return `<div class="detail-item-row read-only" data-item-id="${i.item_id}">
            <div class="detail-item-header">
                <div class="detail-item-name">${fotoMov(i)}<strong>${esc(i.product_name)}</strong><small>${typeName}</small></div>
            </div>
            <div class="mov-nums">
                <span class="mov-num"><span class="mov-num-etiqueta">Pedido</span><strong>${i.planned_quantity ?? '—'}</strong></span>
                <span class="mov-num"><span class="mov-num-etiqueta">Recibido</span><strong>${i.actual_quantity ?? '—'}</strong></span>
                <span class="mov-num"><span class="mov-num-etiqueta">Costo</span><strong>${money(i.total_cost)}</strong></span>
            </div>
        </div>`;
    }).join('');
    const plannedGrandTotal=p.items.reduce((sum,i)=>sum+Number(i.planned_total_cost||((Number(i.unit_cost)||0)*Number(i.planned_quantity)||0)),0);
    const visibleTotal=p.status==='executed'?Number(p.total_cost||0):plannedGrandTotal;
    const totalLabel=p.status==='executed'?'Total pagado':'Presupuesto aproximado';
    const body=`<div class="purchase-detail-meta"><div class="detail-meta-row"><i class="fas fa-store"></i><div><strong>Proveedor</strong><span>${esc(p.supplier_name||'Sin proveedor')}</span></div></div><div class="detail-meta-row"><i class="fas fa-calendar"></i><div><strong>Creada</strong><span>${dateText(p.created_at)}</span></div></div><div class="detail-meta-row"><i class="fas fa-circle"></i><div><strong>Estado</strong><span class="purchase-status" style="background:${PURCHASE_STATUS_COLORS[p.status]}">${esc(PURCHASE_STATUS_LABELS[p.status])}</span></div></div><div class="detail-meta-row total"><i class="fas fa-dollar-sign"></i><div><strong>${totalLabel}</strong><strong class="detail-grand-total" id="detailGrandTotal">${money(visibleTotal)}</strong></div></div></div>${p.status==='pending'?'<p class="execution-intro"><i class="fas fa-circle-info"></i> Captura la cantidad recibida y el costo total real pagado por cada producto. La diferencia se ajustará al confirmar.</p><div class="detail-field detail-register-field"><span class="detail-field-label">Caja que paga esta compra</span><select id="purchaseRegisterSelect" class="form-select"><option value="">Cargando cajas…</option></select><small class="detail-register-hint">El dinero sale de esta caja, para que puedas separar tus gastos.</small></div>':''}<div class="detail-list-heading"><h3><i class="fas fa-list"></i> Productos</h3>${editable?'<button type="button" class="btn-secondary" id="detailAddProducts"><i class="fas fa-plus"></i> Agregar productos</button>':''}</div><div class="purchase-detail-items">${hasItems?rows:'<div class="empty-state">Esta entrada no tiene productos</div>'}</div>`;
    let actions='';
    if(p.status==='pending')actions+='<button type="button" class="btn-primary" id="detailExecute"><i class="fas fa-check"></i> Confirmar</button>';
    if(editable)actions='<button type="button" class="btn-danger-outline" id="detailCancel"><i class="fas fa-ban"></i> Cancelar</button>'+actions;
    const modal=modalFrame('purchaseDetailModal',`<i class="fas fa-arrow-down-long"></i> Entrada #${p.purchase_id}`,body,actions);
    if(p.status==='pending') {
        const refreshDetailTotal=()=>{const total=[...modal.querySelectorAll('[data-detail-total]')].reduce((sum,input)=>sum+(Number(input.value)||0),0);const label=modal.querySelector('#detailGrandTotal');if(label)label.textContent=money(total);};
        modal.querySelectorAll('[data-detail-total]').forEach(input=>input.addEventListener('input',refreshDetailTotal));
        refreshDetailTotal();
    }
    modal.querySelector('#detailAddProducts')?.addEventListener('click',()=>{modal.remove();openPurchaseComposer(p.purchase_id);});
    modal.querySelector('#detailExecute')?.addEventListener('click',()=>confirmPurchaseFromDetail(p));
    if(p.status==='pending')fillPurchaseRegisterSelect(modal);
    modal.querySelector('#detailCancel')?.addEventListener('click',()=>decisionModal('Cancelar orden','La orden se conservará en el historial como cancelada.','Cancelar orden',async()=>{try{await api('../api/purchases/purchases.php',{method:'PUT',body:JSON.stringify({purchase_id:p.purchase_id,action:'cancel'})});modal.remove();loadPurchases();notify('Orden cancelada','success');}catch(e){notify(e.message,'error');}},true));
    modal.querySelectorAll('[data-remove-detail]').forEach(b=>b.addEventListener('click',()=>decisionModal('Quitar producto','¿Deseas quitar este producto de la lista?','Quitar',async()=>{try{await api('../api/purchases/purchases.php',{method:'PUT',body:JSON.stringify({purchase_id:p.purchase_id,action:'remove_item',item_id:Number(b.dataset.removeDetail)})});modal.remove();openPurchaseDetail(p.purchase_id);loadPurchases();}catch(e){notify(e.message,'error');}},true)));
}

async function confirmPurchaseFromDetail(p) {
    const modal=document.getElementById('purchaseDetailModal');
    const items=[...modal.querySelectorAll('.detail-item-row')].map(row=>{const qty=Number(row.querySelector('[data-detail-qty]')?.value)||0;const total=Number(row.querySelector('[data-detail-total]')?.value)||0;return {item_id:Number(row.dataset.itemId),actual_quantity:qty,unit_cost:qty>0?total/qty:0};}).filter(i=>i.actual_quantity>0);
    if(!items.length){notify('Captura al menos un producto recibido','error');return;}
    if(items.some(i=>i.unit_cost<0)){notify('Los costos no pueden ser negativos','error');return;}
    // De qué caja sale el dinero: la compra es un gasto y hay que decir de cuál.
    const regSel=modal.querySelector('#purchaseRegisterSelect');
    const register_id=regSel?(Number(regSel.value)||0):0;
    if(!register_id){notify('Elige la caja que paga esta compra','error');if(regSel)regSel.focus();return;}
    const executeBtn=modal.querySelector('#detailExecute');
    if(executeBtn)executeBtn.disabled=true;
    try{const data=await api('../api/purchases/purchases.php',{method:'PUT',body:JSON.stringify({purchase_id:p.purchase_id,action:'execute',items,register_id})});modal.remove();loadPurchases();loadMovements();notify(`Compra confirmada por ${money(data.data.total_cost)}`,'success');}catch(e){notify(e.message,'error');if(executeBtn)executeBtn.disabled=false;}
}

/**
 * Un bloque del historial: ENTRADAS o SALIDAS.
 *
 * Van separados, cada uno con su tope de alto y su propio scroll. En una sola lista de
 * cientos de renglones, una pérdida se pierde entre las compras y el usuario termina
 * confundiendo lo que entró con lo que salió, que es justo lo que hay que evitar.
 */
function bloqueMovimientos(tipo, filas) {
    const esSalida = tipo === 'salida';
    const titulo = esSalida ? 'Salidas' : 'Entradas';
    const icono = esSalida ? 'fa-arrow-up-long' : 'fa-arrow-down-long';
    const cuerpo = filas.length
        ? `<div class="movements-table-wrap hist-scroll">
             <table class="movements-table">
               <thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th>Cantidad</th><th>Stock</th><th>Detalle</th><th>Usuario</th></tr></thead>
               <tbody>${filas.map(m => `<tr>
                   <td data-label="Fecha" class="mov-fecha">${dateTextCorto(m.created_at)}</td>
                   <td data-label="Producto" class="mov-product" title="${esc(m.product_name)}"><span class="mov-producto">${fotoMov({ image_path: m.image_path, product_name: m.product_name })}<span>${esc(m.product_name)}</span></span></td>
                   <td data-label="Tipo"><span class="mov-type-badge" style="background:${MOVEMENT_TYPE_COLORS[m.movement_type]||'#6b7280'}">${esc(MOVEMENT_TYPE_LABELS[m.movement_type]||m.movement_type)}</span></td>
                   <td data-label="Cantidad" class="movement-qty ${esSalida?'outgoing':'incoming'}">${esSalida?'-':'+'}${m.quantity}</td>
                   <td data-label="Stock">${m.previous_stock} → ${m.new_stock}</td>
                   <td data-label="Detalle" class="mov-notes" title="${esc(m.notes||'')}">${esc(m.notes||'—')}</td>
                   <td data-label="Usuario" title="${esc(m.user_name)}">${esc(m.user_name)}</td>
                 </tr>`).join('')}</tbody>
             </table>
           </div>`
        : `<div class="empty-state">${esSalida ? 'Sin salidas registradas' : 'Sin entradas registradas'}</div>`;
    return `<section class="hist-bloque hist-${tipo}">
        <h4 class="hist-titulo"><i class="fas ${icono}"></i> ${titulo} <span class="hist-cuenta">${filas.length}</span></h4>
        ${cuerpo}
      </section>`;
}

async function loadMovements() {
    const list = document.getElementById('movementsList');
    if (!list) return;
    list.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i> Cargando movimientos…</div>';
    const q = new URLSearchParams();
    const type = document.getElementById('movementTypeFilter')?.value;
    const from = document.getElementById('movementDateFrom')?.value;
    const to = document.getElementById('movementDateTo')?.value;
    if (type) q.set('type', type);
    if (from) q.set('date_from', from);
    if (to) q.set('date_to', to);
    try {
        const data = await api(`../api/purchases/inventory_log.php?${q}`);
        const rows = data.data || [];
        const esSalida = t => ['exit', 'sale', 'loss', 'transfer'].includes(t);
        list.innerHTML = bloqueMovimientos('entrada', rows.filter(m => !esSalida(m.movement_type)))
                       + bloqueMovimientos('salida', rows.filter(m => esSalida(m.movement_type)));
    } catch (e) {
        list.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
    }
}

/* Pérdidas desde el drawer existente */
function openLossModal(){if(!currentEditingProduct)return;const p=products.find(x=>x.product_id==currentEditingProduct);if(!p)return;document.getElementById('lossProductName').textContent=p.product_name;document.getElementById('lossAvailable').textContent=`Disponible: ${p.available??p.current_stock??0}`;document.getElementById('lossQuantity').value='';document.getElementById('lossModal').classList.add('show');}
function closeLossModal(){document.getElementById('lossModal')?.classList.remove('show');}
async function submitLoss(){if(!currentEditingProduct)return;const quantity=Number(document.getElementById('lossQuantity').value),reason=document.getElementById('lossReason').value.trim()||'Pérdida';if(!Number.isFinite(quantity)||quantity<=0){notify('Ingresa una cantidad válida','error');return;}try{await api('../api/purchases/losses.php',{method:'POST',body:JSON.stringify({product_id:Number(currentEditingProduct),quantity,reason})});closeLossModal();closeProductDetails();await loadProducts();if(window._movementsLoaded)loadMovements();notify('Pérdida registrada','success');}catch(e){notify(e.message,'error');}}
