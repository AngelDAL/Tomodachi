/**
 * Compras y movimientos de inventario.
 * Todo el flujo usa modales propios: nunca usa alert, confirm ni prompt.
 */
const PURCHASE_STATUS_LABELS = { draft:'Borrador', pending:'Pendiente', executed:'Ejecutada', cancelled:'Cancelada' };
const PURCHASE_STATUS_COLORS = { draft:'#6b7280', pending:'#f59e0b', executed:'#10b981', cancelled:'#ef4444' };
const MOVEMENT_TYPE_LABELS = { entry:'Entrada', exit:'Salida', adjustment:'Ajuste', sale:'Venta', return:'Devolución', purchase:'Compra', loss:'Pérdida' };
const MOVEMENT_TYPE_COLORS = { entry:'#10b981', exit:'#ef4444', adjustment:'#6b7280', sale:'#3b82f6', return:'#f59e0b', purchase:'#8b5cf6', loss:'#dc2626' };
let purchaseProducts = [];
let selectedPurchaseProducts = new Map();
let currentPurchaseId = null;

const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const money = value => (window.FormatUtils?.currency ? window.FormatUtils.currency(Number(value)||0) : `$${(Number(value)||0).toFixed(2)}`);
const dateText = value => value ? new Date(String(value).replace(' ','T')).toLocaleString('es-MX',{dateStyle:'medium',timeStyle:'short'}) : '—';
const notify = (message, type='info') => window.showNotification ? window.showNotification(message,type) : undefined;

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
        list.innerHTML = '<div class="empty-state"><i class="fas fa-cart-shopping"></i><br>No hay órdenes de compra</div>';
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
function productCard(p, selected) {
    const type=p.tracking_type==='component'?'Componente':'Producto final';
    return `<button type="button" class="purchase-product-card ${selected?'selected':''}" data-product-id="${p.product_id}" aria-pressed="${selected}"><span class="product-check"><i class="fas ${selected?'fa-check':'fa-plus'}"></i></span><img src="${esc(p.image_path||'assets/images/products/default-product.svg')}" onerror="this.src='assets/images/products/default-product.svg'" alt=""><span class="product-card-name">${esc(p.product_name)}</span><span class="product-card-type">${type} · Stock ${p.available??p.current_stock??0}</span><span class="product-card-previous">Último costo: ${money(getLastUnitCost(p))} / unidad</span></button>`;
}

function renderComposerCatalog() {
    const modal=document.getElementById('purchaseComposerModal'); if(!modal)return;
    const query=(modal.querySelector('#purchaseCatalogSearch')?.value||'').toLowerCase().trim();
    const type=modal.querySelector('#purchaseCatalogType')?.value||'';
    const category=modal.querySelector('#purchaseCatalogCategory')?.value||'';
    const filtered=purchaseProducts.filter(p=>(!query||`${p.product_name} ${p.barcode||''} ${p.qr_code||''}`.toLowerCase().includes(query))&&(!type||p.tracking_type===type)&&(!category||String(p.category_id||'')===category));
    modal.querySelector('#purchaseProductCatalog').innerHTML=filtered.length?filtered.map(p=>productCard(p,selectedPurchaseProducts.has(p.product_id))).join(''):'<div class="empty-state">No hay productos con estos filtros</div>';
    modal.querySelectorAll('[data-product-id]').forEach(card=>card.addEventListener('click',()=>togglePurchaseProduct(Number(card.dataset.productId))));
    renderSelectedPurchaseItems();
}
function renderSelectedPurchaseItems() {
    const modal=document.getElementById('purchaseComposerModal'); if(!modal)return;
    const target=modal.querySelector('#selectedPurchaseItems');
    target.innerHTML=selectedPurchaseProducts.size?[...selectedPurchaseProducts.values()].map(p=>{const qty=Math.max(1,Math.round(Number(p.planned_quantity)||1));const estimate=Number.isFinite(Number(p.planned_total_cost))?Math.max(0,Number(p.planned_total_cost)):getLastUnitCost(p)*qty;p.planned_quantity=qty;p.planned_total_cost=estimate;return `<div class="selected-purchase-row" data-selected-id="${p.product_id}"><button type="button" class="selected-item-remove" data-remove-selected="${p.product_id}" aria-label="Quitar ${esc(p.product_name)}" title="Quitar producto"><i class="fas fa-times"></i></button><div class="selected-purchase-name"><i class="fas ${p.tracking_type==='component'?'fa-cubes':'fa-box'}"></i><strong>${esc(p.product_name)}</strong><small>${p.tracking_type==='component'?'Componente':'Producto final'} · Último costo: ${money(getLastUnitCost(p))} / unidad</small></div><label>Cantidad a comprar<input type="number" min="1" step="1" inputmode="numeric" data-plan-qty="${p.product_id}" value="${qty}"></label><div class="purchase-estimate-field"><span>Presupuesto estimado</span><strong data-line-estimate="${p.product_id}">${money(estimate)}</strong><small>Se ajustará al recibir</small></div></div>`;}).join(''):'<div class="selected-empty">Selecciona uno o varios productos del catálogo</div>';
    target.querySelectorAll('[data-remove-selected]').forEach(b=>b.addEventListener('click',()=>{selectedPurchaseProducts.delete(Number(b.dataset.removeSelected));renderComposerCatalog();}));
    target.querySelectorAll('[data-plan-qty]').forEach(i=>i.addEventListener('input',()=>{const p=selectedPurchaseProducts.get(Number(i.dataset.planQty));if(p){p.planned_quantity=Math.max(1,Math.round(Number(i.value)||1));p.planned_total_cost=getLastUnitCost(p)*p.planned_quantity;i.value=p.planned_quantity;const line=document.querySelector(`[data-line-estimate="${p.product_id}"]`);if(line)line.textContent=money(p.planned_total_cost);updateComposerCartTotal();}}));
    updateComposerCartTotal();
}
function togglePurchaseProduct(id) {
    const p=purchaseProducts.find(x=>Number(x.product_id)===Number(id)); if(!p)return;
    if(selectedPurchaseProducts.has(Number(id)))selectedPurchaseProducts.delete(Number(id)); else { const qty=1; selectedPurchaseProducts.set(Number(id),{...p,planned_quantity:qty,planned_total_cost:getLastUnitCost(p)*qty}); }
    renderComposerCatalog();
}
function updateComposerCartTotal() {
    const total=[...selectedPurchaseProducts.values()].reduce((sum,p)=>sum+(Number(p.planned_total_cost)||0),0);
    const label=document.querySelector('#composerCartTotal');
    if(label)label.textContent=money(total);
}
function toggleDiscardPurchaseSelection() {
    const button=document.querySelector('#discardPurchaseSelection');
    if(!button)return;
    if(button.dataset.confirming==='1') {
        selectedPurchaseProducts.clear();
        button.dataset.confirming='0';
        document.querySelector('#discardPurchaseHint')?.remove();
        renderComposerCatalog();
        return;
    }
    button.dataset.confirming='1';
    const hint=document.createElement('span'); hint.id='discardPurchaseHint'; hint.className='discard-purchase-hint'; hint.textContent='¿Vaciar Carrito?';
    button.parentElement?.appendChild(hint);
}
async function openPurchaseComposer(existingPurchaseId=null) {
    try {
        await loadPurchaseProducts();
        selectedPurchaseProducts=new Map();
        let existing=null;
        if(existingPurchaseId){existing=(await api(`../api/purchases/purchases.php?purchase_id=${existingPurchaseId}`)).data;(existing.items||[]).filter(i=>!i.actual_quantity).forEach(i=>selectedPurchaseProducts.set(Number(i.product_id),{...i,product_id:Number(i.product_id),planned_quantity:i.planned_quantity,planned_total_cost:Number(i.planned_total_cost||((Number(i.unit_cost)||0)*Number(i.planned_quantity)||0))}));}
        const categories=[...new Map(purchaseProducts.filter(p=>p.category_id).map(p=>[p.category_id,p.category_name])).entries()];
        const body=`<div class="composer-layout"><section class="composer-catalog"><div class="composer-intro"><p>${existing?'Agrega productos a esta lista de compra.':'Selecciona todo lo que deseas comprar.'}</p><button type="button" class="btn-secondary btn-express" id="openExpressProduct"><i class="fas fa-wand-magic-sparkles"></i> Alta express</button></div><div class="catalog-filters"><input type="search" id="purchaseCatalogSearch" placeholder="Buscar por nombre o código" aria-label="Buscar productos"><select id="purchaseCatalogType"><option value="">Producto o componente</option><option value="stock">Productos finales</option><option value="component">Componentes</option></select><select id="purchaseCatalogCategory"><option value="">Todas las categorías</option>${categories.map(([id,name])=>`<option value="${id}">${esc(name)}</option>`).join('')}</select></div><div id="purchaseProductCatalog" class="purchase-product-catalog"></div></section><aside class="composer-order"><div class="composer-order-heading"><h3><i class="fas fa-list-check"></i> Lista de compra</h3><div class="composer-order-tools"><button type="button" class="icon-button danger discard-purchase-list" id="discardPurchaseSelection" title="Vaciar carrito" aria-label="Vaciar carrito"><i class="fas fa-trash"></i></button></div></div><div class="composer-fields"><label>Proveedor<input type="text" id="composerSupplier" maxlength="150" value="${esc(existing?.supplier_name||'')}" placeholder="Opcional"></label><label>Notas<textarea id="composerNotes" rows="2" maxlength="1000" placeholder="Notas de la compra">${esc(existing?.notes||'')}</textarea></label></div><div id="selectedPurchaseItems" class="selected-purchase-items"></div><div class="composer-cart-total"><span>Presupuesto aproximado</span><strong id="composerCartTotal">$0.00</strong></div></aside></div>`;
        const actions=`<button type="button" class="btn-secondary" data-close-modal="purchaseComposerModal">Cerrar</button><button type="button" class="btn-primary" id="savePurchaseComposer"><i class="fas fa-check"></i> Confirmar</button>`;
        const modal=modalFrame('purchaseComposerModal',`<i class="fas fa-cart-shopping"></i> ${existing?'Editar compra':'Nueva próxima compra'}`,body,actions);
        modal.querySelector('[data-close-modal]')?.addEventListener('click',()=>modal.remove());
        ['purchaseCatalogSearch','purchaseCatalogType','purchaseCatalogCategory'].forEach(id=>modal.querySelector('#'+id).addEventListener(id==='purchaseCatalogSearch'?'input':'change',renderComposerCatalog));
        modal.querySelector('#openExpressProduct').addEventListener('click',openExpressProductPanel);
        modal.querySelector('#discardPurchaseSelection').addEventListener('click',toggleDiscardPurchaseSelection);
        modal.querySelector('#savePurchaseComposer').addEventListener('click',()=>savePurchaseComposer(existingPurchaseId));
        renderComposerCatalog();
    } catch(e){notify(e.message,'error');}
}

function openExpressProductPanel() {
    const modal=document.getElementById('purchaseComposerModal'); if(!modal)return;
    if(modal.querySelector('#expressProductPanel'))return;
    const panel=document.createElement('div'); panel.id='expressProductPanel'; panel.className='express-product-panel'; panel.innerHTML=`<div class="express-header"><h3><i class="fas fa-wand-magic-sparkles"></i> Alta express</h3><button type="button" class="icon-button" id="closeExpressPanel" aria-label="Cerrar"><i class="fas fa-times"></i></button></div><p>Da de alta un producto o componente sin salir de esta compra.</p><div class="express-grid"><label>Nombre<input id="expressName" type="text" maxlength="150"></label><label>Tipo<select id="expressType"><option value="stock">Producto final</option><option value="component">Componente</option></select></label><label>Precio de venta<input id="expressPrice" type="number" min="0" step="0.01" value="0"></label><label>Costo unitario<input id="expressCost" type="number" min="0" step="0.01" value="0"></label><label>Stock inicial<input id="expressStock" type="number" min="0" step="0.001" value="0"></label></div><button type="button" class="btn-primary" id="createExpressProduct"><i class="fas fa-plus"></i> Crear y seleccionar</button>`;
    modal.querySelector('.composer-order').prepend(panel);
    panel.querySelector('#closeExpressPanel').addEventListener('click',()=>panel.remove());
    panel.querySelector('#createExpressProduct').addEventListener('click',createExpressProduct);
}
async function createExpressProduct() {
    const modal=document.getElementById('purchaseComposerModal');
    const name=modal.querySelector('#expressName').value.trim(), type=modal.querySelector('#expressType').value;
    const price=Number(modal.querySelector('#expressPrice').value)||0, cost=Number(modal.querySelector('#expressCost').value)||0, stock=Number(modal.querySelector('#expressStock').value)||0;
    if(!name){notify('Escribe un nombre para el producto','error');return;}
    try {
        const created=await api('../api/inventory/products.php',{method:'POST',body:JSON.stringify({product_name:name,price,cost,stock:type==='stock'?stock:0,tracking_type:type})});
        const product={...(created.data||{}),product_id:Number(created.data.product_id),product_name:name,tracking_type:type,cost,current_stock:stock,status:'active'};
        purchaseProducts.push(product); selectedPurchaseProducts.set(product.product_id,{...product,planned_quantity:stock>0?stock:1,planned_total_cost:cost*(stock>0?stock:1)});
        if(type==='component'&&stock>0) await api('../api/inventory/lots.php',{method:'POST',body:JSON.stringify({product_id:product.product_id,label:'Stock inicial',quantity:stock,total_cost:stock*cost})});
        modal.querySelector('#expressProductPanel')?.remove(); renderComposerCatalog(); notify('Producto creado y agregado a la lista','success');
    } catch(e){notify(e.message,'error');}
}
async function savePurchaseComposer(existingId) {
    const modal=document.getElementById('purchaseComposerModal');
    const items=[...selectedPurchaseProducts.values()].map(p=>({item_id:p.item_id?Number(p.item_id):null,product_id:Number(p.product_id),planned_quantity:Number(p.planned_quantity),total_cost:Number(p.planned_total_cost)||0}));
    if(!items.length){notify('Selecciona al menos un producto','error');return;}
    if(items.some(i=>!Number.isFinite(i.planned_quantity)||i.planned_quantity<=0)){notify('Revisa las cantidades de la lista','error');return;}
    try {
        let id=existingId;
        if(!id){const result=await api('../api/purchases/purchases.php',{method:'POST',body:JSON.stringify({supplier_name:modal.querySelector('#composerSupplier').value.trim()||null,notes:modal.querySelector('#composerNotes').value.trim()||null,items})});id=Number(result.data.purchase_id);}
        else { for(const item of items) { if(item.item_id) await api('../api/purchases/purchases.php',{method:'PUT',body:JSON.stringify({purchase_id:id,action:'update_item',item_id:Number(item.item_id),planned_quantity:item.planned_quantity,total_cost:item.total_cost})}); else await api('../api/purchases/purchases.php',{method:'PUT',body:JSON.stringify({purchase_id:id,action:'add_item',product_id:item.product_id,planned_quantity:item.planned_quantity,total_cost:item.total_cost})}); } }
        modal.remove(); loadPurchases(); openPurchaseDetail(id); notify('Lista de compra guardada','success');
    } catch(e){notify(e.message,'error');}
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
            return `<div class="detail-item-row editable" data-item-id="${i.item_id}"><div class="detail-item-header"><div class="detail-item-name"><i class="fas ${i.tracking_type==='component'?'fa-cubes':'fa-box'}"></i><strong>${esc(i.product_name)}</strong><small>${typeName}</small></div><button type="button" class="icon-button danger" data-remove-detail="${i.item_id}" aria-label="Quitar"><i class="fas fa-trash"></i></button></div><div class="detail-item-cost-ref"><small>Último costo: ${money(lastUnitCost)}/ud</small></div><div class="detail-item-fields"><label class="detail-field"><span class="detail-field-label">Cantidad recibida</span><input type="number" min="0.001" step="0.001" data-detail-qty="${i.item_id}" value="${i.planned_quantity}"></label><label class="detail-field"><span class="detail-field-label">Costo total real</span><input type="number" min="0" step="0.01" data-detail-total="${i.item_id}" value="${plannedTotal}"></label></div></div>`;
        }
        return `<div class="detail-item-row read-only" data-item-id="${i.item_id}"><div class="detail-item-header"><div class="detail-item-name"><i class="fas ${i.tracking_type==='component'?'fa-cubes':'fa-box'}"></i><strong>${esc(i.product_name)}</strong><small>${typeName}</small></div></div><div class="detail-item-read-grid"><span class="detail-read-item"><span class="detail-read-label">Recibido</span><strong>${i.actual_quantity??'—'}</strong></span><span class="detail-read-item"><span class="detail-read-label">Costo</span><strong>${money(i.total_cost)}</strong></span></div></div>`;
    }).join('');
    const plannedGrandTotal=p.items.reduce((sum,i)=>sum+Number(i.planned_total_cost||((Number(i.unit_cost)||0)*Number(i.planned_quantity)||0)),0);
    const visibleTotal=p.status==='executed'?Number(p.total_cost||0):plannedGrandTotal;
    const totalLabel=p.status==='executed'?'Total pagado':'Presupuesto aproximado';
    const body=`<div class="purchase-detail-meta"><div class="detail-meta-row"><i class="fas fa-store"></i><div><strong>Proveedor</strong><span>${esc(p.supplier_name||'Sin proveedor')}</span></div></div><div class="detail-meta-row"><i class="fas fa-calendar"></i><div><strong>Creada</strong><span>${dateText(p.created_at)}</span></div></div><div class="detail-meta-row"><i class="fas fa-circle"></i><div><strong>Estado</strong><span class="purchase-status" style="background:${PURCHASE_STATUS_COLORS[p.status]}">${esc(PURCHASE_STATUS_LABELS[p.status])}</span></div></div><div class="detail-meta-row total"><i class="fas fa-dollar-sign"></i><div><strong>${totalLabel}</strong><strong class="detail-grand-total" id="detailGrandTotal">${money(visibleTotal)}</strong></div></div></div>${p.status==='pending'?'<p class="execution-intro"><i class="fas fa-circle-info"></i> Captura la cantidad recibida y el costo total real pagado por cada producto. La diferencia se ajustará al confirmar.</p><div class="detail-field detail-register-field"><span class="detail-field-label">Caja que paga esta compra</span><select id="purchaseRegisterSelect" class="form-select"><option value="">Cargando cajas…</option></select><small class="detail-register-hint">El dinero sale de esta caja, para que puedas separar tus gastos.</small></div>':''}<div class="detail-list-heading"><h3><i class="fas fa-list"></i> Productos</h3>${editable?'<button type="button" class="btn-secondary" id="detailAddProducts"><i class="fas fa-plus"></i> Agregar productos</button>':''}</div><div class="purchase-detail-items">${hasItems?rows:'<div class="empty-state">Esta orden no tiene productos</div>'}</div>`;
    let actions='';
    if(p.status==='pending')actions+='<button type="button" class="btn-primary" id="detailExecute"><i class="fas fa-check"></i> Confirmar</button>';
    if(editable)actions='<button type="button" class="btn-danger-outline" id="detailCancel"><i class="fas fa-ban"></i> Cancelar</button>'+actions;
    const modal=modalFrame('purchaseDetailModal',`<i class="fas fa-receipt"></i> Compra #${p.purchase_id}`,body,actions);
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

async function loadMovements() {
    const list=document.getElementById('movementsList');if(!list)return;list.innerHTML='<div class="empty-state"><i class="fas fa-spinner fa-spin"></i> Cargando movimientos…</div>';
    const q=new URLSearchParams();const type=document.getElementById('movementTypeFilter')?.value,from=document.getElementById('movementDateFrom')?.value,to=document.getElementById('movementDateTo')?.value;if(type)q.set('type',type);if(from)q.set('date_from',from);if(to)q.set('date_to',to);
    try{const data=await api(`../api/purchases/inventory_log.php?${q}`);const rows=data.data||[];list.innerHTML=rows.length?`<div class="movements-table-wrap"><table class="movements-table"><thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th>Cantidad</th><th>Stock</th><th>Detalle</th><th>Usuario</th></tr></thead><tbody>${rows.map(m=>{const outgoing=['exit','sale','loss'].includes(m.movement_type);return `<tr><td data-label="Fecha">${dateText(m.created_at)}</td><td data-label="Producto" class="mov-product">${esc(m.product_name)}</td><td data-label="Tipo"><span class="mov-type-badge" style="background:${MOVEMENT_TYPE_COLORS[m.movement_type]||'#6b7280'}">${esc(MOVEMENT_TYPE_LABELS[m.movement_type]||m.movement_type)}</span></td><td data-label="Cantidad" class="movement-qty ${outgoing?'outgoing':'incoming'}">${outgoing?'-':'+'}${m.quantity}</td><td data-label="Stock">${m.previous_stock} → ${m.new_stock}</td><td data-label="Detalle" class="mov-notes">${esc(m.notes||'—')}</td><td data-label="Usuario">${esc(m.user_name)}</td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty-state">No hay movimientos registrados</div>';}catch(e){list.innerHTML=`<div class="empty-state">${esc(e.message)}</div>`;}
}

/* Pérdidas desde el drawer existente */
function openLossModal(){if(!currentEditingProduct)return;const p=products.find(x=>x.product_id==currentEditingProduct);if(!p)return;document.getElementById('lossProductName').textContent=p.product_name;document.getElementById('lossAvailable').textContent=`Disponible: ${p.available??p.current_stock??0}`;document.getElementById('lossQuantity').value='';document.getElementById('lossModal').classList.add('show');}
function closeLossModal(){document.getElementById('lossModal')?.classList.remove('show');}
async function submitLoss(){if(!currentEditingProduct)return;const quantity=Number(document.getElementById('lossQuantity').value),reason=document.getElementById('lossReason').value.trim()||'Pérdida';if(!Number.isFinite(quantity)||quantity<=0){notify('Ingresa una cantidad válida','error');return;}try{await api('../api/purchases/losses.php',{method:'POST',body:JSON.stringify({product_id:Number(currentEditingProduct),quantity,reason})});closeLossModal();closeProductDetails();await loadProducts();if(window._movementsLoaded)loadMovements();notify('Pérdida registrada','success');}catch(e){notify(e.message,'error');}}
