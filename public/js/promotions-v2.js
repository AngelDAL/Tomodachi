/* Promotions v2 form behavior: clear NxM and per-target bundle quantities. */
(function () {
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  window.updateFormFields = function () {
    const type = document.getElementById('promoType')?.value;
    const box = document.getElementById('conditionFields');
    const discount = document.getElementById('discountFields');
    const bundle = document.getElementById('bundlePriceField');
    if (!box || !discount || !bundle) return;
    box.innerHTML = '';
    discount.style.display = type === 'bundle' || type === 'bulk_discount' ? 'none' : 'flex';
    bundle.style.display = type === 'bundle' ? 'block' : 'none';
    if (type === 'bulk_discount') {
      box.innerHTML = `<div class="promo-help"><b>Ejemplo:</b> Lleva 3 y paga 2. Por cada grupo completo de 3, se cobra solo 2; una unidad extra conserva su precio normal.</div><div class="form-row"><div class="form-group"><label>Lleva</label><input type="number" name="min_quantity" min="2" step="1" value="3" required class="form-control"></div><div class="form-group"><label>Paga</label><input type="number" name="bulk_pay_quantity" min="1" step="1" value="2" required class="form-control"></div></div>`;
    } else if (type === 'bundle') {
      box.innerHTML = `<div class="promo-help"><b>Ejemplo:</b> 2 Cocas + 3 Papas + 1 Salsa por $100. Define la cantidad junto a cada artículo seleccionado.</div>`;
    } else if (type === 'bill_discount') {
      box.innerHTML = `<div class="promo-help"><b>Ejemplo:</b> 10% al llegar a $300. Si eliges productos, categorías o etiquetas, el descuento se aplica únicamente a esa parte de la cuenta.</div><div class="form-group"><label>Monto mínimo de la cuenta</label><input type="number" name="min_purchase_amount" min="0" step="0.01" value="0" class="form-control"></div>`;
    } else {
      box.innerHTML = `<div class="promo-help"><b>Ejemplo:</b> 10% o $20 menos por cada producto, categoría o etiqueta seleccionada.</div>`;
    }
    window.renderSelectedProductsList?.();
  };
  window.renderSelectedProductsList = function () {
    const section = document.getElementById('selectedProductsSection'), list = document.getElementById('selectedProductsList'), count = document.getElementById('selectedCountNum');
    if (!section || !list) return;
    count.textContent = selectedTargets.length;
    section.style.display = selectedTargets.length ? 'block' : 'none';
    const bundle = document.getElementById('promoType')?.value === 'bundle';
    list.innerHTML = selectedTargets.map((t, i) => `<div class="selected-chip"><span>${esc(t.name)}</span>${bundle ? `<label class="bundle-qty">Cantidad <input data-target-qty="${i}" type="number" min="1" value="${Math.max(1, +t.required_quantity || 1)}"></label>` : ''}<button type="button" class="remove-chip" data-remove-target="${i}" aria-label="Quitar">×</button></div>`).join('');
    list.querySelectorAll('[data-target-qty]').forEach(el => el.addEventListener('input', () => { selectedTargets[+el.dataset.targetQty].required_quantity = Math.max(1, +el.value || 1); }));
    list.querySelectorAll('[data-remove-target]').forEach(el => el.addEventListener('click', () => { selectedTargets.splice(+el.dataset.removeTarget,1); renderProductsGrid(allProducts); }));
  };
  window.savePromotion = async function (e) {
    e.preventDefault(); const form = e.target, type = form.querySelector('[name=type]').value;
    if (!selectedTargets.length && type !== 'bill_discount') return showNotification('Selecciona al menos un objetivo.', 'warning');
    const payload = { name: form.name.value, description:'', start_date:form.start_date.value, end_date:form.end_date.value, type, targets:selectedTargets.map(t => ({type:t.type,id:t.id,required_quantity:Math.max(1,+t.required_quantity||1)})), min_quantity:+(form.querySelector('[name=min_quantity]')?.value||1), bulk_pay_quantity:+(form.querySelector('[name=bulk_pay_quantity]')?.value||0), min_purchase_amount:+(form.querySelector('[name=min_purchase_amount]')?.value||0) };
    if (type === 'bundle') { payload.bundle_price = form.bundle_price.value; payload.discount_type='fixed_price'; payload.discount_value=0; }
    else if (type === 'bulk_discount') { payload.discount_type='fixed_amount'; payload.discount_value=0; }
    else { payload.discount_type=form.discount_type.value; payload.discount_value=form.discount_value.value; }
    if (type === 'bulk_discount' && !(payload.min_quantity > payload.bulk_pay_quantity && payload.bulk_pay_quantity > 0)) return showNotification('“Paga” debe ser menor que “Lleva”.', 'warning');
    if (editingPromotionId) { payload.promotion_id=editingPromotionId; payload.is_active=1; }
    const endpoint = editingPromotionId ? '../api/promotions/update.php' : '../api/promotions/create.php';
    try { const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}), data=await r.json(); if(!data.success) throw Error(data.message||'No se pudo guardar'); closePromoModal(); showNotification('Promoción guardada exitosamente','success'); loadPromotions(); } catch(err) { showNotification(err.message,'error'); }
  };
  document.addEventListener('DOMContentLoaded', async () => {
    const tagSelect = document.getElementById('promoTagSelect'), newTag = document.getElementById('newPromoTagBtn');
    if (!tagSelect) return;
    const loadTags = async () => { const r = await fetch('../api/promotions/tags.php'); const d = await r.json(); if (d.success) tagSelect.innerHTML = '<option value="">Agregar etiqueta…</option>' + d.data.map(t => `<option value="${t.tag_id}" data-name="${esc(t.name)}">${esc(t.name)}</option>`).join(''); };
    await loadTags();
    tagSelect.addEventListener('change', () => { const o=tagSelect.selectedOptions[0]; if (!o?.value) return; if (!selectedTargets.some(t=>t.type==='tag' && +t.id===+o.value)) selectedTargets.push({type:'tag',id:+o.value,name:o.dataset.name,required_quantity:1}); renderSelectedProductsList(); tagSelect.value=''; });
    newTag?.addEventListener('click', async () => { const name = window.prompt('Nombre de la etiqueta'); if (!name?.trim()) return; const r=await fetch('../api/promotions/tags.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create',name:name.trim()})}); const d=await r.json(); if(!d.success) return showNotification(d.message||'No se pudo crear la etiqueta','error'); await loadTags(); selectedTargets.push({type:'tag',id:d.data.tag_id,name:d.data.name,required_quantity:1}); renderSelectedProductsList(); });
  });
})();
