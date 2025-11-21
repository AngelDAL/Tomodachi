/**
 * Inventario - búsqueda y carga de imagen
 */
const invSearch = document.getElementById('invSearch');
const invResults = document.getElementById('invResults');
const productIdInput = document.getElementById('productIdInput');
const imageFileInput = document.getElementById('imageFileInput');
const uploadPreview = document.getElementById('uploadPreview');
const uploadBtn = document.getElementById('uploadImageBtn');
let CURRENT_STORE_ID = null;

(async function initInventory(){
  const session = await checkSession();
  if(!session){ window.location.href='/Tomodachi/public/login.html'; return; }
  CURRENT_STORE_ID = session.store_id || 1;
  document.getElementById('userName').textContent = session.full_name;
  document.getElementById('userRole').textContent = session.role.toUpperCase();
  bindInvEvents();
  loadProducts('');
})();

function bindInvEvents(){
  let timer;
  invSearch.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(()=>loadProducts(invSearch.value.trim()),300);
  });

  uploadBtn.addEventListener('click', async () => {
    if(!imageFileInput.files.length){ showNotification('Seleccione imagen','info'); return; }
    const pid = parseInt(productIdInput.value);
    if(!pid){ showNotification('ID inválido','error'); return; }
    const file = imageFileInput.files[0];
    if(file.size > 2*1024*1024){ showNotification('Máx 2MB','error'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result;
      const payload = { product_id: pid, image_base64: base64 };
      try {
        const res = await API.post('/api/inventory/upload_image.php', payload);
        if(res.success){
          showNotification('Imagen subida','success');
          uploadPreview.innerHTML = `<img src="/${res.data.image_path}" alt="preview">`;
          imageFileInput.value='';
        } else { showNotification(res.message||'Error','error'); }
      } catch(e){ showNotification('Error subida','error'); }
    };
    reader.readAsDataURL(file);
  });
}

async function loadProducts(term){
  try {
    const res = await API.get('/api/inventory/products.php', { store_id: CURRENT_STORE_ID, search: term });
    if(!res.success){ invResults.innerHTML='<div class="result-item error">Error</div>'; return; }
    const list = res.data || [];
    if(!list.length){ invResults.innerHTML='<div class="result-item empty">Sin productos</div>'; return; }
    invResults.innerHTML = list.map(p => `<div class="result-item" data-id="${p.product_id}">
      <strong>${escapeHtml(p.product_name)}</strong>
      <span>${p.barcode||''}</span>
      ${p.image_path?`<img src="/${p.image_path}" alt="img" style="height:40px;object-fit:cover;border-radius:4px;">`:''}
    </div>`).join('');
    Array.from(invResults.querySelectorAll('.result-item')).forEach(el => {
      el.addEventListener('click', () => {
        productIdInput.value = el.getAttribute('data-id');
        showNotification('ID producto seleccionado para imagen','info');
      });
    });
  } catch (e){ console.error(e); }
}

function escapeHtml(str){ return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m])); }
