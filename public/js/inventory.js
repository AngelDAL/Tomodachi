/**
 * Gestión de Inventario
 */

let products = [];
let categories = [];
let currentFilter = '';
let selectedFile = null;
let storeId = 1;
let currentEditingProduct = null;

// Sistema de debouncing para búsqueda
let searchTimeout = null;
const SEARCH_DEBOUNCE_DELAY = 500; // 500ms de espera después de dejar de escribir

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', async function () {
    const session = await checkSession();
    if (!session) {
        window.location.href = 'login.html';
        return;
    }
    storeId = session.store_id || 1;
    initInventory();
});

function initInventory() {
    bindEvents();
    loadCategories();
    loadProducts();
}

function bindEvents() {
    // Búsqueda con debouncing
    const searchInput = document.getElementById('searchInput');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            // Mostrar indicador de búsqueda
            const loadingEl = document.getElementById('searchLoading');
            if (loadingEl) loadingEl.style.display = 'inline-block';

            // Cancelar búsqueda anterior
            if (searchTimeout) {
                clearTimeout(searchTimeout);
            }

            // Ejecutar búsqueda después de 500ms sin escribir
            searchTimeout = setTimeout(() => {
                currentFilter = e.target.value.trim();
                performSearch();

                // Ocultar indicador de búsqueda
                if (loadingEl) loadingEl.style.display = 'none';
            }, SEARCH_DEBOUNCE_DELAY);
        });

        // Permitir buscar inmediatamente con Enter
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (searchTimeout) clearTimeout(searchTimeout);

                currentFilter = searchInput.value.trim();
                performSearch();

                const loadingEl = document.getElementById('searchLoading');
                if (loadingEl) loadingEl.style.display = 'none';
            }
        });
    }

    // Carga de imagen - Auto upload al seleccionar
    const fileInput = document.getElementById('productImage');

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            selectedFile = e.target.files[0];
            if (selectedFile) {
                uploadImageAuto(selectedFile);
            }
        });
    }

    // Preview de imagen en modal Agregar Producto
    const addProductImageInput = document.getElementById('addProductImage');
    if (addProductImageInput) {
        addProductImageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            const preview = document.getElementById('addProductImagePreview');
            const nameSpan = document.getElementById('addProductImageName');
            
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = preview.querySelector('img');
                    img.src = e.target.result;
                    
                    // Ocultar el nombre del archivo
                    if (nameSpan) nameSpan.style.display = 'none';

                    // Mostrar y estilizar la vista previa
                    preview.style.display = 'block';
                    preview.style.width = '100%';
                    preview.style.maxWidth = '250px';
                    preview.style.height = '250px';
                    preview.style.objectFit = 'contain';
                    preview.style.border = '2px dashed #ccc';
                    preview.style.borderRadius = '8px';
                    preview.style.margin = '15px auto'; // Centrado
                    preview.style.padding = '5px';
                    preview.style.background = '#f9f9f9';
                    
                    // Asegurar que el contenedor padre permita el centrado
                    preview.parentElement.style.flexDirection = 'column';
                    preview.parentElement.style.alignItems = 'center';
                };
                reader.readAsDataURL(file);
            } else {
                preview.style.display = 'none';
                if (nameSpan) {
                    nameSpan.textContent = '';
                    nameSpan.style.display = 'inline';
                }
                // Restaurar estilos del padre si se cancela
                preview.parentElement.style.flexDirection = 'row';
            }
        });
    }

    // Subida automática de imagen en Detalle de Producto
    const detailImageInput = document.getElementById('detailImageInput');
    if (detailImageInput) {
        detailImageInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            const productId = document.getElementById('editProductId').value;
            
            if (file && productId) {
                // Mostrar preview inmediato
                const img = document.getElementById('detailImage');
                const reader = new FileReader();
                reader.onload = (e) => {
                    img.src = e.target.result;
                    img.style.display = 'block';
                };
                reader.readAsDataURL(file);

                // Subir al servidor
                try {
                    // Convertir a base64 para enviar
                    const base64Reader = new FileReader();
                    base64Reader.onload = async (e) => {
                        const base64Data = e.target.result;
                        
                        const response = await fetch('../api/inventory/upload_image.php', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                product_id: productId,
                                image_base64: base64Data
                            })
                        });
                        
                        const data = await response.json();
                        if (data.success) {
                            showNotification('✓ Imagen actualizada correctamente', 'success');
                            // Actualizar lista de productos en segundo plano
                            loadProducts();
                        } else {
                            showNotification('✗ Error al actualizar imagen: ' + (data.message || 'Desconocido'), 'error');
                        }
                    };
                    base64Reader.readAsDataURL(file);
                } catch (error) {
                    console.error('Error subiendo imagen:', error);
                    showNotification('✗ Error de conexión al subir imagen', 'error');
                }
            }
        });
    }

    // Modal para gestionar categorías
    const manageCategoriesBtn = document.getElementById('manageCategoriesBtn');
    const closeCategoriesModalBtn = document.getElementById('closeCategoriesModalBtn');
    const addCategoryForm = document.getElementById('addCategoryForm');
    const categoriesModal = document.getElementById('categoriesModal');

    if (manageCategoriesBtn) {
        manageCategoriesBtn.addEventListener('click', openCategoriesModal);
    }

    if (closeCategoriesModalBtn) {
        closeCategoriesModalBtn.addEventListener('click', closeCategoriesModal);
    }

    if (addCategoryForm) {
        addCategoryForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await submitAddCategory();
        });
    }

    if (categoriesModal) {
        categoriesModal.addEventListener('click', (e) => {
            if (e.target === categoriesModal) closeCategoriesModal();
        });
    }

    // Modal para agregar producto
    const addProductBtn = document.getElementById('addProductBtn');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const cancelProductBtn = document.getElementById('cancelProductBtn');
    const addProductForm = document.getElementById('addProductForm');
    const addProductModal = document.getElementById('addProductModal');

    if (addProductBtn) {
        addProductBtn.addEventListener('click', () => {
            openAddProductModal();
        });
    }

    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            closeAddProductModal();
        });
    }

    if (cancelProductBtn) {
        cancelProductBtn.addEventListener('click', () => {
            closeAddProductModal();
        });
    }

    if (addProductForm) {
        addProductForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await submitAddProduct();
        });
    }

    // Cerrar modal al hacer clic fuera
    if (addProductModal) {
        addProductModal.addEventListener('click', (e) => {
            if (e.target === addProductModal) {
                closeAddProductModal();
            }
        });
    }

    // Modal de detalles
    const closeDetailsBtn = document.getElementById('closeDetailsModalBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    const editForm = document.getElementById('editProductForm');
    // detailImageInput ya declarado arriba
    const editCostInput = document.getElementById('editProductCost');
    const editPriceInput = document.getElementById('editProductPrice');

    if (closeDetailsBtn) closeDetailsBtn.addEventListener('click', closeProductDetails);
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', closeProductDetails);

    if (editForm) {
        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await submitEditProduct();
        });
    }

    // Listener de imagen eliminado (ya manejado arriba)

    // Recalcular ganancia en tiempo real
    if (editCostInput && editPriceInput) {
        const updateProfit = () => {
            const cost = parseFloat(editCostInput.value) || 0;
            const price = parseFloat(editPriceInput.value) || 0;
            updateProfitDisplay(price, cost);
        };
        editCostInput.addEventListener('input', updateProfit);
        editPriceInput.addEventListener('input', updateProfit);
    }

    // Cerrar modal detalles al hacer clic fuera
    const detailsModal = document.getElementById('productDetailsModal');
    if (detailsModal) {
        detailsModal.addEventListener('click', (e) => {
            if (e.target === detailsModal) closeProductDetails();
        });
    }
}

function performSearch() {
    // Mostrar información de búsqueda
    const searchInfoEl = document.getElementById('searchInfo');
    const resultCountEl = document.getElementById('searchResultCount');

    let filtered = products;
    if (currentFilter) {
        const term = currentFilter.toLowerCase();
        filtered = products.filter(p =>
            (p.product_name && p.product_name.toLowerCase().includes(term)) ||
            (p.sku && p.sku.toLowerCase().includes(term)) ||
            (p.barcode && p.barcode.toLowerCase().includes(term))
        );
    }

    // Mostrar información de resultados
    if (searchInfoEl && resultCountEl) {
        if (currentFilter) {
            resultCountEl.textContent = `${filtered.length} resultado${filtered.length !== 1 ? 's' : ''} encontrado${filtered.length !== 1 ? 's' : ''}`;
            searchInfoEl.style.display = 'flex';
        } else {
            searchInfoEl.style.display = 'none';
        }
    }

    renderProducts(filtered);
}

// Funciones del modal de agregar producto
function openAddProductModal() {
    const modal = document.getElementById('addProductModal');
    if (modal) {
        modal.classList.add('show');
        // Focus en el primer input
        setTimeout(() => {
            document.getElementById('productNameInput')?.focus();
        }, 100);
    }
}

function closeAddProductModal() {
    const modal = document.getElementById('addProductModal');
    if (modal) {
        modal.classList.remove('show');
        // Limpiar formulario
        document.getElementById('addProductForm')?.reset();
        // Limpiar preview de imagen
        const preview = document.getElementById('addProductImagePreview');
        const nameSpan = document.getElementById('addProductImageName');
        if (preview) preview.style.display = 'none';
        if (nameSpan) nameSpan.textContent = '';
    }
}

async function submitAddProduct() {
    const form = document.getElementById('addProductForm');
    if (!form) return;

    const formData = new FormData(form);
    const productData = {
        product_name: formData.get('product_name'),
        description: formData.get('description'),
        category_id: formData.get('category_id'),
        sku: formData.get('sku'),
        barcode: formData.get('barcode'),
        qr_code: formData.get('qr_code'),
        price: parseFloat(formData.get('price')),
        cost: parseFloat(formData.get('cost')) || 0,
        stock: parseInt(formData.get('stock')),
        min_stock: parseInt(formData.get('min_stock')) || 0
        // store_id eliminado, el backend lo toma de la sesión
    };

    // Validar datos requeridos
    if (!productData.product_name) {
        showNotification('El nombre del producto es requerido', 'error');
        return;
    }

    if (isNaN(productData.price) || productData.price < 0) {
        showNotification('El precio debe ser un número válido', 'error');
        return;
    }

    try {
        showNotification('Guardando producto...', 'info');

        const response = await fetch('../api/inventory/products.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(productData)
        });

        const data = await response.json();

        if (data.success) {
            // Si hay imagen seleccionada, subirla ahora
            const imageInput = document.getElementById('addProductImage');
            if (imageInput && imageInput.files[0]) {
                const newProductId = data.data.product_id;
                await uploadImageForNewProduct(newProductId, imageInput.files[0]);
            }

            showNotification('✓ Producto agregado correctamente', 'success');
            closeAddProductModal();

            // Recargar productos
            setTimeout(() => {
                loadProducts();
            }, 500);
        } else {
            showNotification('✗ Error: ' + (data.message || 'No se pudo agregar el producto'), 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showNotification('✗ Error al agregar el producto', 'error');
    }
}

async function uploadImageForNewProduct(productId, file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const response = await fetch('../api/inventory/upload_image.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        product_id: productId,
                        image_base64: e.target.result
                    })
                });
                resolve(true);
            } catch (error) {
                console.error('Error subiendo imagen inicial:', error);
                resolve(false);
            }
        };
        reader.readAsDataURL(file);
    });
}

function showPreview(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const previewDiv = document.getElementById('uploadPreview');
        if (previewDiv) {
            previewDiv.innerHTML = `
                <div class="upload-preview show">
                    <img src="${e.target.result}" alt="Preview">
                    <p class="upload-preview-text">Listo para subir</p>
                </div>
            `;
        }
    };
    reader.readAsDataURL(file);
}

async function uploadImageAuto(file) {
    const productId = currentEditingProduct;

    if (!productId) {
        showNotification('Selecciona un producto primero', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            // Mostrar notificación de carga
            showNotification('Subiendo imagen...', 'info');

            const response = await fetch('../api/inventory/upload_image.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_id: productId,
                    image_base64: e.target.result
                })
            });

            const data = await response.json();

            if (data.success) {
                showNotification('✓ Imagen subida correctamente', 'success');
                // Limpiar
                document.getElementById('productImage').value = '';
                selectedFile = null;
                currentEditingProduct = null;
                // Recargar productos
                setTimeout(() => loadProducts(), 800);
            } else {
                showNotification('✗ Error: ' + (data.error?.image_base64 || data.message || 'No se pudo subir la imagen'), 'error');
            }
        } catch (error) {
            console.error('Error:', error);
            showNotification('✗ Error al subir la imagen', 'error');
        }
    };
    reader.readAsDataURL(file);
}

// Sistema de notificaciones eliminado para usar el global de app.js (consistencia con sales.js)


async function uploadImage() {
    const productId = document.getElementById('productId')?.value;

    if (!productId || !selectedFile) {
        alert('Selecciona producto e imagen');
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const response = await fetch('../api/inventory/upload_image.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_id: productId,
                    image_data: e.target.result.split(',')[1]
                })
            });

            const data = await response.json();

            if (data.success) {
                alert('Imagen subida correctamente');
                document.getElementById('uploadPreview').innerHTML = '';
                document.getElementById('productId').value = '';
                document.getElementById('productImage').value = '';
                selectedFile = null;
                loadProducts();
            } else {
                alert('Error: ' + (data.error || 'No se pudo subir la imagen'));
            }
        } catch (error) {
            console.error('Error:', error);
            alert('Error al subir la imagen');
        }
    };
    reader.readAsDataURL(selectedFile);
}

async function loadProducts() {
    try {
        // Eliminado store_id de los parámetros, el backend usa la sesión
        const response = await fetch(`../api/inventory/products.php`);
        const data = await response.json();

        if (data.success) {
            products = data.data || [];
            renderProducts(products);
        } else {
            console.error('Error:', data.error);
        }
    } catch (error) {
        console.error('Error cargando productos:', error);
    }
}

async function loadCategories() {
    try {
        const response = await fetch('../api/inventory/categories.php');
        const data = await response.json();
        if (data.success) {
            categories = data.data || [];
            populateCategorySelects();
        }
    } catch (error) {
        console.error('Error cargando categorías:', error);
    }
}

function populateCategorySelects() {
    const addSelect = document.getElementById('productCategoryInput');
    const editSelect = document.getElementById('editProductCategory');

    const options = categories.map(c => `<option value="${c.category_id}">${escapeHtml(c.category_name)}</option>`).join('');

    if (addSelect) addSelect.innerHTML = '<option value="">Seleccionar categoría...</option>' + options;
    if (editSelect) editSelect.innerHTML = '<option value="">Sin categoría</option>' + options;
}

function renderProducts(items) {
    const container = document.getElementById('invResults');
    if (!container) return;

    if (items.length === 0) {
        const emptyMessage = currentFilter
            ? '<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;"><i class="fas fa-search"></i><br><br>No se encontraron productos con "<strong>' + escapeHtml(currentFilter) + '</strong>"</p>'
            : '<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;"><i class="fas fa-inbox"></i><br><br>No hay productos en el inventario</p>';
        container.innerHTML = emptyMessage;
        return;
    }

    container.innerHTML = items.map(product => {
        const imgHtml = product.image_path
            ? `<img src="/${product.image_path}" alt="${product.product_name}" onerror="this.parentElement.innerHTML='<span class=&quot;no-image&quot;><i class=&quot;fas fa-image&quot;></i></span>'">`
            : '<span class="no-image"><i class="fas fa-image"></i></span>';

        const stockClass = (product.current_stock <= product.min_stock) ? 'stock-low' : 'stock-ok';
        const formattedPrice = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(product.price);

        return `
        <div class="product-card" onclick="openProductDetails(${product.product_id})" title="Ver detalles de ${escapeHtml(product.product_name)}">
            <div class="product-image">
                ${imgHtml}
            </div>
            <div class="product-info">
                <div class="product-name">${escapeHtml(product.product_name)}</div>
                <div class="product-meta">
                    <div class="meta-price">${formattedPrice}</div>
                    <div class="meta-stock ${stockClass}">
                        <i class="fas fa-cubes"></i> ${product.current_stock !== null ? product.current_stock : 0}
                    </div>
                </div>
            </div>
        </div>
    `;
    }).join('');
}

function openProductDetails(productId) {
    const product = products.find(p => p.product_id == productId);
    if (!product) return;

    currentEditingProduct = productId;

    // Llenar formulario
    document.getElementById('editProductId').value = product.product_id;
    document.getElementById('editProductName').value = product.product_name;
    document.getElementById('editProductDesc').value = product.description || '';
    document.getElementById('editProductCategory').value = product.category_id || '';
    document.getElementById('editProductStatus').value = product.status || 'active';
    document.getElementById('editProductBarcode').value = product.barcode || '';
    document.getElementById('editProductQR').value = product.qr_code || '';
    document.getElementById('editProductCost').value = product.cost || 0;
    document.getElementById('editProductPrice').value = product.price;
    document.getElementById('editProductStock').value = product.current_stock || 0;
    document.getElementById('editProductMinStock').value = product.min_stock || 0;

    // Imagen
    const img = document.getElementById('detailImage');
    if (product.image_path) {
        img.src = '/' + product.image_path;
        img.style.display = 'block';
    } else {
        img.src = ''; // O una imagen placeholder
        img.style.display = 'none';
    }

    // Calcular ganancia inicial
    updateProfitDisplay(parseFloat(product.price) || 0, parseFloat(product.cost) || 0);

    // Mostrar modal
    const modal = document.getElementById('productDetailsModal');
    if (modal) modal.classList.add('show');
}

function closeProductDetails() {
    const modal = document.getElementById('productDetailsModal');
    if (modal) modal.classList.remove('show');
    currentEditingProduct = null;
    // Limpiar formulario
    document.getElementById('editProductForm')?.reset();
}

function updateProfitDisplay(price, cost) {
    // Asegurar que sean números
    price = parseFloat(price) || 0;
    cost = parseFloat(cost) || 0;

    const profit = price - cost;
    const margin = price > 0 ? (profit / price) * 100 : 0;

    const profitEl = document.getElementById('detailProfitDisplay');

    document.getElementById('detailPriceDisplay').textContent = '$' + price.toFixed(2);
    document.getElementById('detailCostDisplay').textContent = '$' + cost.toFixed(2);

    profitEl.textContent = '$' + profit.toFixed(2);
    profitEl.className = profit >= 0 ? 'profit-positive' : 'profit-negative';

    document.getElementById('detailMarginDisplay').textContent = margin.toFixed(1) + '%';
}

async function submitEditProduct() {
    const form = document.getElementById('editProductForm');
    if (!form) return;

    const formData = new FormData(form);
    const newStock = parseInt(formData.get('current_stock'));

    const productData = {
        product_id: currentEditingProduct,
        product_name: formData.get('product_name'),
        description: formData.get('description'),
        category_id: formData.get('category_id'),
        status: formData.get('status'),
        barcode: formData.get('barcode'),
        qr_code: formData.get('qr_code'),
        price: parseFloat(formData.get('price')),
        cost: parseFloat(formData.get('cost')),
        min_stock: parseInt(formData.get('min_stock'))
    };

    try {
        showNotification('Guardando cambios...', 'info');

        // 1. Actualizar datos del producto
        const response = await fetch('../api/inventory/products.php', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(productData)
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.message || 'No se pudo actualizar el producto');
        }

        // 2. Verificar si hay cambio de stock
        const currentProduct = products.find(p => p.product_id == currentEditingProduct);
        const oldStock = currentProduct ? (currentProduct.current_stock || 0) : 0;

        if (!isNaN(newStock) && newStock !== oldStock) {
            const stockResponse = await fetch('../api/inventory/stock.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    store_id: storeId,
                    product_id: currentEditingProduct,
                    movement_type: 'adjustment',
                    quantity: newStock,
                    notes: 'Ajuste desde edición de producto'
                })
            });

            const stockData = await stockResponse.json();
            if (!stockData.success) {
                showNotification('Producto guardado, pero error al actualizar stock: ' + stockData.message, 'warning');
            } else {
                showNotification('✓ Producto y stock actualizados', 'success');
            }
        } else {
            showNotification('✓ Cambios guardados', 'success');
        }

        closeProductDetails();
        loadProducts();

    } catch (error) {
        console.error('Error:', error);
        showNotification('✗ Error: ' + error.message, 'error');
    }
}

async function uploadImageFromDetails(file) {
    if (!currentEditingProduct) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            showNotification('Actualizando imagen...', 'info');
            const response = await fetch('../api/inventory/upload_image.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_id: currentEditingProduct,
                    image_base64: e.target.result
                })
            });

            const data = await response.json();

            if (data.success) {
                showNotification('✓ Imagen actualizada', 'success');
                // Actualizar vista previa en modal
                const img = document.getElementById('detailImage');
                img.src = e.target.result;
                img.style.display = 'block';
                // Recargar lista de fondo
                loadProducts();
            } else {
                showNotification('✗ Error al subir imagen', 'error');
            }
        } catch (error) {
            console.error('Error:', error);
            showNotification('✗ Error de conexión', 'error');
        }
    };
    reader.readAsDataURL(file);
}


async function savePrice(input) {
    const productId = input.getAttribute('data-product-id');
    const price = parseFloat(input.value);

    if (isNaN(price) || price < 0) {
        alert('Precio inválido');
        const product = products.find(p => p.product_id == productId);
        if (product) input.value = parseFloat(product.price).toFixed(2);
        return;
    }

    try {
        const response = await fetch('../api/inventory/products.php', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                product_id: productId,
                price: price
            })
        });

        const data = await response.json();

        if (data.success) {
            // Actualizar el producto en el array local
            const product = products.find(p => p.product_id == productId);
            if (product) product.price = price;
        } else {
            alert('Error: ' + (data.message || 'No se pudo actualizar precio'));
            const product = products.find(p => p.product_id == productId);
            if (product) input.value = parseFloat(product.price).toFixed(2);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error al actualizar precio');
        const product = products.find(p => p.product_id == productId);
        if (product) input.value = parseFloat(product.price).toFixed(2);
    }
}

async function saveStock(input) {
    const productId = input.getAttribute('data-product-id');
    const newStock = parseInt(input.value);

    if (isNaN(newStock) || newStock < 0) {
        alert('Stock inválido');
        const product = products.find(p => p.product_id == productId);
        if (product) input.value = product.current_stock || 0;
        return;
    }

    try {
        // Usar endpoint de ajuste de stock
        const response = await fetch('../api/inventory/stock.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                store_id: storeId,
                product_id: productId,
                movement_type: 'adjustment',
                quantity: newStock,
                notes: 'Ajuste rápido desde inventario'
            })
        });

        const data = await response.json();

        if (data.success) {
            showNotification('✓ Stock actualizado', 'success');
            // Actualizar el producto en el array local
            const product = products.find(p => p.product_id == productId);
            if (product) product.current_stock = newStock;
        } else {
            showNotification('✗ Error: ' + (data.message || 'No se pudo actualizar stock'), 'error');
            const product = products.find(p => p.product_id == productId);
            if (product) input.value = product.current_stock || 0;
        }
    } catch (error) {
        console.error('Error:', error);
        showNotification('✗ Error al actualizar stock', 'error');
        const product = products.find(p => p.product_id == productId);
        if (product) input.value = product.current_stock || 0;
    }
}

function getStockClass(stock) {
    if (stock <= 10) return 'low';
    if (stock > 50) return 'good';
    return '';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Funciones para gestión de categorías
function openCategoriesModal() {
    const modal = document.getElementById('categoriesModal');
    if (modal) {
        modal.classList.add('show');
        renderCategoriesList();
        setTimeout(() => document.getElementById('newCategoryName')?.focus(), 100);
    }
}

function closeCategoriesModal() {
    const modal = document.getElementById('categoriesModal');
    if (modal) {
        modal.classList.remove('show');
        document.getElementById('addCategoryForm')?.reset();
    }
}

function renderCategoriesList() {
    const list = document.getElementById('categoriesList');
    if (!list) return;
    
    if (categories.length === 0) {
        list.innerHTML = '<li style="padding: 10px; text-align: center; color: #999;">No hay categorías registradas</li>';
        return;
    }
    
    list.innerHTML = categories.map(cat => `
        <li style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #eee;">
            <span>${escapeHtml(cat.category_name)}</span>
            <div class="actions-container" style="display: flex; align-items: center;">
                <button type="button" id="btn-del-${cat.category_id}" class="btn-danger" style="padding: 2px 8px; font-size: 0.8em;" onclick="showDeleteConfirm(${cat.category_id})">
                    <i class="fas fa-trash"></i>
                </button>
                <div id="confirm-del-${cat.category_id}" style="display: none; gap: 5px; align-items: center;">
                    <span style="font-size: 0.8em; color: #d9534f; margin-right: 5px;">¿Borrar?</span>
                    <button type="button" class="btn-danger" style="padding: 2px 6px; font-size: 0.8em; background: #d9534f;" onclick="executeDeleteCategory(${cat.category_id})" title="Sí, borrar">
                        <i class="fas fa-check"></i>
                    </button>
                    <button type="button" class="btn-secondary" style="padding: 2px 6px; font-size: 0.8em;" onclick="cancelDeleteCategory(${cat.category_id})" title="Cancelar">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
        </li>
    `).join('');
}

function showDeleteConfirm(id) {
    const btn = document.getElementById(`btn-del-${id}`);
    const confirmDiv = document.getElementById(`confirm-del-${id}`);
    if (btn && confirmDiv) {
        btn.style.display = 'none';
        confirmDiv.style.display = 'flex';
    }
}

function cancelDeleteCategory(id) {
    const btn = document.getElementById(`btn-del-${id}`);
    const confirmDiv = document.getElementById(`confirm-del-${id}`);
    if (btn && confirmDiv) {
        btn.style.display = 'inline-block';
        confirmDiv.style.display = 'none';
    }
}

async function submitAddCategory() {
    const nameInput = document.getElementById('newCategoryName');
    const name = nameInput.value.trim();
    
    if (!name) return;
    
    try {
        const response = await fetch('../api/inventory/categories.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category_name: name })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Categoría agregada', 'success');
            nameInput.value = '';
            await loadCategories(); // Recargar categorías del servidor
            renderCategoriesList(); // Actualizar lista en modal
        } else {
            showNotification(data.message || 'Error al agregar categoría', 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showNotification('Error de conexión', 'error');
    }
}

async function executeDeleteCategory(id) {
    try {
        const response = await fetch('../api/inventory/categories.php', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category_id: id })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Categoría eliminada', 'success');
            await loadCategories();
            renderCategoriesList();
        } else {
            showNotification(data.message || 'Error al eliminar', 'error');
            cancelDeleteCategory(id); // Restaurar botón si falla
        }
    } catch (error) {
        console.error('Error:', error);
        showNotification('Error de conexión', 'error');
        cancelDeleteCategory(id);
    }
}

// Función global para el escáner (requerida por scanner.js)
window.fetchByCode = function(code) {
    if (!code) return;
    
    // Normalizar código
    code = code.trim();
    
    // Buscar en productos cargados
    const product = products.find(p => 
        (p.barcode && p.barcode === code) || 
        (p.sku && p.sku === code) || 
        (p.qr_code && p.qr_code === code)
    );
    
    if (product) {
        // Producto encontrado
        showNotification('Producto encontrado: ' + product.product_name, 'success');
        
        // Detener escáner si está activo
        if (window.stopScanner) window.stopScanner();
        
        // Abrir detalles
        openProductDetails(product.product_id);
    } else {
        // Producto no encontrado -> Crear nuevo
        showNotification('Producto no encontrado. Creando nuevo...', 'info');
        
        // Detener escáner
        if (window.stopScanner) window.stopScanner();
        
        // Abrir modal de agregar
        openAddProductModal();
        
        // Prellenar código de barras
        setTimeout(() => {
            const barcodeInput = document.getElementById('productBarcodeInput');
            if (barcodeInput) {
                barcodeInput.value = code;
                // Resaltar que se llenó automáticamente
                barcodeInput.style.backgroundColor = '#e8f0fe';
                setTimeout(() => barcodeInput.style.backgroundColor = '', 2000);
            }
        }, 300);
    }
};
