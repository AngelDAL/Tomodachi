/**
 * Gestión de Inventario
 */

let products = [];
let categories = [];
let currentFilter = '';
let selectedFile = null;
let storeId = 1;
let currentEditingProduct = null;
const ICON_CATALOG = [
    { class: 'fa-tag', es: 'Etiqueta', en: 'Tag' },
    { class: 'fa-tags', es: 'Etiquetas', en: 'Tags' },
    { class: 'fa-box', es: 'Caja', en: 'Box' },
    { class: 'fa-box-open', es: 'Caja abierta', en: 'Box open' },
    { class: 'fa-bag-shopping', es: 'Bolsa de compras', en: 'Shopping bag' },
    { class: 'fa-basket-shopping', es: 'Canasta', en: 'Basket' },
    { class: 'fa-mug-hot', es: 'Bebida caliente', en: 'Hot drink' },
    { class: 'fa-wine-bottle', es: 'Vino', en: 'Wine bottle' },
    { class: 'fa-beer-mug-empty', es: 'Cerveza', en: 'Beer' },
    { class: 'fa-bottle-water', es: 'Botella de agua', en: 'Water bottle' },
    { class: 'fa-cookie-bite', es: 'Galleta', en: 'Cookie' },
    { class: 'fa-ice-cream', es: 'Helado', en: 'Ice cream' },
    { class: 'fa-apple-whole', es: 'Fruta', en: 'Fruit' },
    { class: 'fa-bread-slice', es: 'Pan', en: 'Bread' },
    { class: 'fa-cheese', es: 'Queso', en: 'Cheese' },
    { class: 'fa-drumstick-bite', es: 'Pollo', en: 'Chicken' },
    { class: 'fa-fish', es: 'Pescado', en: 'Fish' },
    { class: 'fa-cow', es: 'Lácteos', en: 'Dairy' },
    { class: 'fa-seedling', es: 'Orgánico', en: 'Organic' },
    { class: 'fa-carrot', es: 'Verdura', en: 'Vegetable' },
    { class: 'fa-pepper-hot', es: 'Picante', en: 'Spicy' },
    { class: 'fa-burger', es: 'Hamburguesa', en: 'Burger' },
    { class: 'fa-pizza-slice', es: 'Pizza', en: 'Pizza' },
    { class: 'fa-bowl-food', es: 'Comida', en: 'Food bowl' },
    { class: 'fa-mitten', es: 'Ropa', en: 'Clothing' },
    { class: 'fa-shirt', es: 'Camiseta', en: 'Shirt' },
    { class: 'fa-hat-cowboy', es: 'Sombrero', en: 'Hat' },
    { class: 'fa-shoe-prints', es: 'Zapatos', en: 'Shoes' },
    { class: 'fa-laptop', es: 'Tecnología', en: 'Laptop' },
    { class: 'fa-mobile-screen', es: 'Celular', en: 'Phone' },
    { class: 'fa-plug', es: 'Electrónica', en: 'Electronics' },
    { class: 'fa-tv', es: 'Televisión', en: 'TV' },
    { class: 'fa-lightbulb', es: 'Hogar', en: 'Home' },
    { class: 'fa-soap', es: 'Limpieza', en: 'Cleaning' },
    { class: 'fa-screwdriver-wrench', es: 'Ferretería', en: 'Hardware' },
    { class: 'fa-car', es: 'Auto', en: 'Car' },
    { class: 'fa-paw', es: 'Mascotas', en: 'Pets' },
    { class: 'fa-book', es: 'Libros', en: 'Books' },
    { class: 'fa-gamepad', es: 'Juegos', en: 'Games' },
    { class: 'fa-gift', es: 'Regalos', en: 'Gifts' },
    { class: 'fa-leaf', es: 'Verde', en: 'Green' },
    { class: 'fa-cube', es: 'Genérico', en: 'Generic' }
];

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

    // Inicializar picker de iconos para creación de categoría
        setupIconPicker({
            hiddenInput: document.getElementById('newCategoryIcon'),
            searchInput: document.getElementById('newCategoryIconSearch'),
            list: document.getElementById('newCategoryIconList'),
            selectedLabel: document.getElementById('newCategoryIconSelected'),
            previewContainer: document.getElementById('iconPreviewContainer'),
            previewIcon: document.getElementById('iconPreviewIcon')
        });
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
        <li style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #eee; gap: 15px;">
            <div style="display: flex; align-items: center; gap: 15px; flex: 1;">
                <div style="width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: #f8f9fa; border-radius: 8px; color: var(--primary-color); flex-shrink: 0;">
                    <i class="fas ${cat.icon_class || 'fa-tag'}" style="font-size: 1.2rem;"></i>
                </div>
                <div style="font-weight: 600; font-size: 1rem;">${escapeHtml(cat.category_name)}</div>
            </div>
            <div class="actions-container" style="display: flex; align-items: center;">
                <button type="button" id="btn-del-${cat.category_id}" class="btn-danger" style="padding: 6px 10px; font-size: 0.9em;" onclick="showDeleteConfirm(${cat.category_id})" title="Eliminar categoría">
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
    const iconInput = document.getElementById('newCategoryIcon');
    const name = nameInput.value.trim();
    const icon = iconInput ? iconInput.value.trim() : '';
    
    if (!name) return;
    
    try {
        const response = await fetch('../api/inventory/categories.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category_name: name, icon_class: icon || null })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Categoría agregada', 'success');
            nameInput.value = '';
            if (iconInput) iconInput.value = '';
            await loadCategories(); // Recargar categorías del servidor
            renderCategoriesList(); // Actualizar lista en modal
            // Reiniciar sugerencias
            setupIconPicker({
                hiddenInput: iconInput,
                searchInput: document.getElementById('newCategoryIconSearch'),
                list: document.getElementById('newCategoryIconList'),
                selectedLabel: document.getElementById('newCategoryIconSelected')
            });
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

function playSound(filename) {
    const audio = new Audio('assets/sound/' + filename);
    audio.play().catch(e => console.warn('Error playing sound:', e));
}

function setupIconPicker({ hiddenInput, searchInput, list, selectedLabel, previewContainer, previewIcon }) {
    if (!hiddenInput || !list) return;

    const updatePreview = (iconClass) => {
        if (previewContainer && previewIcon && iconClass) {
            previewIcon.className = `fas ${iconClass}`;
            previewContainer.classList.remove('hidden');
        } else if (previewContainer) {
            previewContainer.classList.add('hidden');
        }
    };

    const renderList = (term = '') => {
        const q = term.toLowerCase().trim();
        const filtered = ICON_CATALOG.filter(icon =>
            icon.class.toLowerCase().includes(q) ||
            (icon.es && icon.es.toLowerCase().includes(q)) ||
            (icon.en && icon.en.toLowerCase().includes(q))
        );

        if (!filtered.length) {
            list.innerHTML = '<div class="icon-empty">Sin coincidencias</div>';
            list.style.display = 'grid';
            return;
        }

        list.innerHTML = filtered.map(icon => `
            <button type="button" class="icon-card" data-class="${icon.class}">
                <i class="fas ${icon.class}"></i>
                <span class="icon-es">${icon.es}</span>
            </button>
        `).join('');
        list.style.display = 'grid';

        list.querySelectorAll('.icon-card').forEach(btn => {
            btn.addEventListener('click', () => {
                const val = btn.getAttribute('data-class');
                hiddenInput.value = val;
                if (selectedLabel) {
                    selectedLabel.textContent = 'Icono seleccionado: ' + ICON_CATALOG.find(i => i.class === val)?.es;
                }
                list.querySelectorAll('.icon-card').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                updatePreview(val);
            });
        });

        // resaltar seleccionado actual
        if (hiddenInput.value) {
            const current = list.querySelector(`[data-class="${hiddenInput.value}"]`);
            if (current) current.classList.add('selected');
            updatePreview(hiddenInput.value);
        } else {
            updatePreview(null);
        }
    };

    const initialTerm = searchInput ? searchInput.value : '';
    renderList(initialTerm);

    if (searchInput) {
        searchInput.addEventListener('input', () => renderList(searchInput.value));
    }
}

// Función global para el escáner (requerida por scanner.js)
window.fetchByCode = function(code) {
    if (!code) return;
    
    // Normalizar código para búsqueda
    const searchCode = String(code).trim().toLowerCase();
    
    console.log('Escáner detectó:', code);
    
    // Buscar en productos cargados
    // Aseguramos conversión a string para evitar fallos de tipo
    const product = products.find(p => {
        const barcode = p.barcode ? String(p.barcode).trim().toLowerCase() : '';
        const sku = p.sku ? String(p.sku).trim().toLowerCase() : '';
        const qr = p.qr_code ? String(p.qr_code).trim().toLowerCase() : '';
        
        return barcode === searchCode || sku === searchCode || qr === searchCode;
    });
    
    if (product) {
        // Producto encontrado
        playSound('Sound2.mp3');
        showNotification('Producto encontrado: ' + product.product_name, 'success');
        
        // Detener escáner si está activo
        if (window.stopScanner) window.stopScanner();
        
        // Abrir detalles
        openProductDetails(product.product_id);
    } else {
        // Producto no encontrado -> Crear nuevo
        playSound('Sound3.mp3'); // Sonido de alerta
        showNotification('Producto no encontrado. Creando nuevo...', 'info');
        
        // Detener escáner
        if (window.stopScanner) window.stopScanner();
        
        // Abrir modal de agregar
        openAddProductModal();
        
        // Prellenar código de barras
        setTimeout(() => {
            const barcodeInput = document.getElementById('productBarcodeInput');
            if (barcodeInput) {
                barcodeInput.value = code; // Usar código original
                // Resaltar que se llenó automáticamente
                barcodeInput.style.backgroundColor = '#e8f0fe';
                setTimeout(() => barcodeInput.style.backgroundColor = '', 2000);
                
                // Enfocar nombre
                const nameInput = document.getElementById('productNameInput');
                if (nameInput) nameInput.focus();
            }
        }, 300);
    }
};

/* ==========================================
   AI IMAGE STUDIO
   ========================================== */
let currentAIMode = 'add'; // 'add' or 'edit'

function openAIModal(mode) {
    currentAIMode = mode;
    document.getElementById('aiModal').style.display = 'flex';
    resetAIWorkspace();
}

function closeAIModal() {
    document.getElementById('aiModal').style.display = 'none';
}

function resetAIWorkspace() {
    document.getElementById('aiOriginalPreview').style.display = 'none';
    document.getElementById('aiUploadPlaceholder').style.display = 'block';
    document.getElementById('aiImageInput').value = '';
    
    const statusEl = document.getElementById('aiAnalysisStatus');
    if(statusEl) {
        statusEl.className = 'status-badge status-waiting';
        statusEl.innerText = 'Esperando imagen...';
    }
    
    document.getElementById('aiPrompt').value = '';
    document.getElementById('btnGenerateAI').disabled = true;
    
    // Reset Result Area
    document.getElementById('aiComparison').style.display = 'none';
    document.getElementById('aiEmptyResult').style.display = 'block';
    document.getElementById('aiActions').style.display = 'none';
    
    // Reset Comparison
    document.getElementById('compOriginal').src = '';
    document.getElementById('compResult').src = '';
    document.querySelector('.fade-slider').value = 0;
    updateComparison(0);

    // Reset Studio Mode
    switchAIMode('enhance');
    document.getElementById('studioBgType').value = 'generate';
    toggleStudioOptions();
    document.getElementById('studioPrompt').value = '';
    clearBackgroundPreview();
    document.getElementById('btnGenerateStudio').disabled = false;
}

function selectStrength(btn) {
    // Remover clase active de todos
    document.querySelectorAll('.btn-strength').forEach(b => b.classList.remove('active'));
    // Agregar a este
    btn.classList.add('active');
    // Actualizar valor oculto
    document.getElementById('aiStrength').value = btn.dataset.value;
    
    // Actualizar descripción
    const descEl = document.getElementById('strengthDesc');
    const val = parseFloat(btn.dataset.value);
    if (val > 0.6) descEl.innerText = "Mejora sutil: Mantiene casi intacta la forma original.";
    else if (val > 0.4) descEl.innerText = "Balanceado: Mejora texturas e iluminación notablemente.";
    else descEl.innerText = "Creativo: Puede alterar detalles para maximizar la estética.";
}

function updateComparison(val) {
    const opacity = val / 100;
    const resultImg = document.getElementById('compResult');
    if(resultImg) resultImg.style.opacity = opacity;
}

// Event Listener para subida de imagen en AI Modal
const aiImageInput = document.getElementById('aiImageInput');
if (aiImageInput) {
    aiImageInput.addEventListener('change', async function(e) {
        if (this.files && this.files[0]) {
            const file = this.files[0];
            
            // Mostrar preview
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = document.getElementById('aiOriginalPreview');
                img.src = e.target.result;
                img.style.display = 'block';
                document.getElementById('aiUploadPlaceholder').style.display = 'none';
            }
            reader.readAsDataURL(file);

            // Iniciar an�lisis con Gemini
            analyzeImageWithGemini(file);
        }
    });
}

async function analyzeImageWithGemini(file) {
    const statusEl = document.getElementById('aiAnalysisStatus');
    const promptEl = document.getElementById('aiPrompt');
    
    statusEl.className = 'status-badge status-analyzing';
    statusEl.innerHTML = '<i class=\'fas fa-spinner fa-spin\'></i> Analizando con Google Gemini...';
    promptEl.value = 'Analizando imagen...';
    promptEl.disabled = true;

    const formData = new FormData();
    formData.append('image', file);

    try {
        const response = await fetch('../api/ai/analyze_image.php', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();

        if (data.ai_prompt) {
            statusEl.className = 'status-badge status-success';
            statusEl.innerText = 'An�lisis Completado';
            
            promptEl.value = data.ai_prompt;
            
            // Guardar sugerencias para uso posterior
            const descEl = document.getElementById('aiDescriptionSuggestion');
            if(descEl) {
                descEl.innerText = data.menu_description || 'Sin descripci�n disponible';
                descEl.dataset.productName = data.product_name || '';
            }
            
            document.getElementById('btnGenerateAI').disabled = false;
        } else {
            console.warn('Respuesta IA:', data);
            // Priorizar data.message si existe, luego data.error (si es string), luego stringify si es objeto
            let msg = data.message;
            if (!msg && data.error) {
                msg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
            }
            throw new Error(msg || 'Error desconocido');
        }
    } catch (error) {
        console.error('Error AI:', error);
        statusEl.className = 'status-badge status-error';
        statusEl.innerText = 'Error en an�lisis';
        promptEl.value = 'Describe aqu� c�mo quieres que se vea la imagen...';
        document.getElementById('btnGenerateAI').disabled = false; // Permitir intentar aunque falle el an�lisis
    } finally {
        promptEl.disabled = false;
    }
}

async function generateAIImage() {
    const fileInput = document.getElementById('aiImageInput');
    const prompt = document.getElementById('aiPrompt').value;
    const strength = document.getElementById('aiStrength').value; // Ya es decimal (0.75, 0.55, 0.25)
    
    if (!fileInput.files[0]) return alert('Sube una imagen primero');
    if (!prompt) return alert('Escribe un prompt');

    // UI Loading
    document.getElementById('aiEmptyResult').style.display = 'none';
    document.getElementById('aiComparison').style.display = 'none';
    document.getElementById('aiLoading').style.display = 'block';
    document.getElementById('aiActions').style.display = 'none';
    document.getElementById('btnGenerateAI').disabled = true;

    const formData = new FormData();
    formData.append('image', fileInput.files[0]);
    formData.append('prompt', prompt);
    formData.append('strength', strength);

    try {
        const response = await fetch('../api/ai/generate_image.php', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();

        if (data.status === 'success') {
            const resultUrl = data.image_url + '?t=' + new Date().getTime();
            
            // Configurar Comparador
            const compOriginal = document.getElementById('compOriginal');
            const compResult = document.getElementById('compResult');
            
            // Leer imagen original para el comparador
            const reader = new FileReader();
            reader.onload = function(e) {
                compOriginal.src = e.target.result;
            }
            reader.readAsDataURL(fileInput.files[0]);
            
            compResult.src = resultUrl;
            
            // Mostrar Comparador
            document.getElementById('aiComparison').style.display = 'flex';
            
            // Resetear slider de comparación
            const slider = document.querySelector('.fade-slider');
            slider.value = 0;
            updateComparison(0);
            
            // Animación automática de revelado
            setTimeout(() => {
                let val = 0;
                const interval = setInterval(() => {
                    val += 2;
                    slider.value = val;
                    updateComparison(val);
                    if (val >= 100) clearInterval(interval);
                }, 20);
            }, 500);

            // Guardar URL para aplicar
            compResult.dataset.serverUrl = data.image_url;
            
            document.getElementById('aiActions').style.display = 'block';
        } else {
            alert('Error: ' + (data.message || 'Error generando imagen'));
            document.getElementById('aiEmptyResult').style.display = 'block';
        }
    } catch (error) {
        console.error(error);
        alert('Error de conexi�n con el servidor de IA');
        document.getElementById('aiEmptyResult').style.display = 'block';
    } finally {
        document.getElementById('aiLoading').style.display = 'none';
        document.getElementById('btnGenerateAI').disabled = false;
    }
}

async function applyAIImage() {
    const resultImg = document.getElementById('compResult');
    const serverUrl = resultImg.dataset.serverUrl;
    
    if (!serverUrl) return;

    // Convertir la imagen del servidor a Blob para simular un archivo seleccionado
    try {
        const response = await fetch(serverUrl);
        const blob = await response.blob();
        const file = new File([blob], 'ai_generated_product.png', { type: 'image/png' });

        // Crear un DataTransfer para asignar al input file
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        if (currentAIMode === 'add') {
            const input = document.getElementById('addProductImage');
            input.files = dataTransfer.files;
            
            // Disparar evento change manualmente para actualizar preview
            const event = new Event('change', { bubbles: true });
            input.dispatchEvent(event);
            
            // Rellenar nombre y descripci�n si est�n vac�os
            const nameInput = document.getElementById('productNameInput');
            const descInput = document.getElementById('productDescInput');
            const suggestedName = document.getElementById('aiDescriptionSuggestion').dataset.productName;
            const suggestedDesc = document.getElementById('aiDescriptionSuggestion').innerText;
            
            if (nameInput && nameInput.value === '' && suggestedName) nameInput.value = suggestedName;
            if (descInput && descInput.value === '' && suggestedDesc) descInput.value = suggestedDesc;

        } else {
            const input = document.getElementById('detailImageInput');
            input.files = dataTransfer.files;
            
            // Disparar evento change
            const event = new Event('change', { bubbles: true });
            input.dispatchEvent(event);
        }
        
        closeAIModal();
        // Asumiendo que existe showToast, si no, usar alert
        if (typeof showToast === 'function') {
            showToast('Imagen IA aplicada correctamente', 'success');
        } else {
            alert('Imagen IA aplicada correctamente');
        }

    } catch (e) {
        console.error('Error aplicando imagen', e);
        alert('Error aplicando la imagen al formulario');
    }
}

function copyAIDescription() {
    const text = document.getElementById('aiDescriptionSuggestion').innerText;
    navigator.clipboard.writeText(text).then(() => {
        if (typeof showToast === 'function') {
            showToast('Descripción copiada al portapapeles');
        } else {
            alert('Descripción copiada');
        }
    });
}

/* ==========================================
   AI STUDIO MODE FUNCTIONS
   ========================================== */

function switchAIMode(mode) {
    // Update Tabs
    document.querySelectorAll('.ai-tab').forEach(t => t.classList.remove('active'));
    if (mode === 'enhance') document.querySelector('.ai-tab:nth-child(1)').classList.add('active');
    else document.querySelector('.ai-tab:nth-child(2)').classList.add('active');

    // Show Content
    document.getElementById('modeEnhance').style.display = mode === 'enhance' ? 'block' : 'none';
    document.getElementById('modeStudio').style.display = mode === 'studio' ? 'block' : 'none';
}

function toggleStudioOptions() {
    const type = document.getElementById('studioBgType').value;
    const genOptions = document.getElementById('studioGenerateOptions');
    
    if (type === 'generate') {
        genOptions.style.display = 'block';
        document.getElementById('btnGenerateStudio').innerHTML = '<i class="fas fa-layer-group"></i> Aplicar Fondo';
    } else if (type === 'white') {
        genOptions.style.display = 'none';
        document.getElementById('btnGenerateStudio').innerHTML = '<i class="fas fa-eraser"></i> Eliminar Fondo';
    }
}

async function generateBackgroundPreview() {
    const prompt = document.getElementById('studioPrompt').value;
    if (!prompt) return alert('Escribe una descripción para el fondo');

    const btn = document.querySelector('#studioGenerateOptions .btn-secondary');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando...';

    const formData = new FormData();
    formData.append('prompt', prompt);

    try {
        const response = await fetch('../api/ai/generate_background.php', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();

        if (data.status === 'success') {
            const img = document.getElementById('bgPreviewImg');
            img.src = data.image_url;
            img.dataset.fullPath = data.image_url; // Store for later use
            document.getElementById('bgPreviewArea').style.display = 'block';
        } else {
            alert('Error: ' + (data.message || 'No se pudo generar el fondo'));
        }
    } catch (e) {
        console.error(e);
        alert('Error de conexión');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

function clearBackgroundPreview() {
    document.getElementById('bgPreviewArea').style.display = 'none';
    document.getElementById('bgPreviewImg').src = '';
    delete document.getElementById('bgPreviewImg').dataset.fullPath;
}

async function saveBackgroundToLibrary() {
    const img = document.getElementById('bgPreviewImg');
    if (!img.src) return;

    const btn = document.querySelector('#bgPreviewArea .btn-success');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    const formData = new FormData();
    formData.append('image_url', img.dataset.fullPath);

    try {
        const response = await fetch('../api/stores/save_background.php', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        
        if (data.status === 'success') {
            alert('Fondo guardado en la biblioteca de la tienda');
            // Update the preview source to the new permanent location
            img.src = data.new_url;
            img.dataset.fullPath = data.new_url;
        } else {
            alert('Error: ' + data.message);
        }
    } catch (e) {
        console.error(e);
        alert('Error al guardar');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Guardar';
    }
}

async function generateStudioImage() {
    const fileInput = document.getElementById('aiImageInput');
    if (!fileInput.files[0]) return alert('Sube una imagen del producto primero');

    const type = document.getElementById('studioBgType').value;
    const btn = document.getElementById('btnGenerateStudio');
    
    // UI Loading
    document.getElementById('aiEmptyResult').style.display = 'none';
    document.getElementById('aiComparison').style.display = 'none';
    document.getElementById('aiLoading').style.display = 'block';
    document.getElementById('aiActions').style.display = 'none';
    btn.disabled = true;

    const formData = new FormData();
    formData.append('image', fileInput.files[0]);

    let endpoint = '';

    if (type === 'white') {
        endpoint = '../api/ai/remove_background.php';
    } else if (type === 'generate') {
        endpoint = '../api/ai/replace_background.php';
        
        // Check if we have a generated background preview
        const bgPreview = document.getElementById('bgPreviewImg');
        if (bgPreview.src && bgPreview.dataset.fullPath && document.getElementById('bgPreviewArea').style.display !== 'none') {
            formData.append('background_image_url', bgPreview.dataset.fullPath);
        } else {
            // Fallback to prompt
            const prompt = document.getElementById('studioPrompt').value;
            if (prompt) formData.append('prompt', prompt);
        }
    }

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();

        if (data.status === 'success') {
            const resultUrl = data.image_url + '?t=' + new Date().getTime();
            
            // Configurar Comparador
            const compOriginal = document.getElementById('compOriginal');
            const compResult = document.getElementById('compResult');
            
            // Leer imagen original
            const reader = new FileReader();
            reader.onload = function(e) {
                compOriginal.src = e.target.result;
            }
            reader.readAsDataURL(fileInput.files[0]);
            
            compResult.src = resultUrl;
            
            // Mostrar Comparador
            document.getElementById('aiComparison').style.display = 'flex';
            
            // Resetear slider
            const slider = document.querySelector('.fade-slider');
            slider.value = 0;
            updateComparison(0);
            
            // Animación
            setTimeout(() => {
                let val = 0;
                const interval = setInterval(() => {
                    val += 2;
                    slider.value = val;
                    updateComparison(val);
                    if (val >= 100) clearInterval(interval);
                }, 20);
            }, 500);

            // Guardar URL
            compResult.dataset.serverUrl = data.image_url;
            
            document.getElementById('aiActions').style.display = 'block';
        } else {
            alert('Error: ' + (data.message || 'Error procesando imagen'));
            document.getElementById('aiEmptyResult').style.display = 'block';
        }
    } catch (error) {
        console.error(error);
        alert('Error de conexión con el servidor de IA');
        document.getElementById('aiEmptyResult').style.display = 'block';
    } finally {
        document.getElementById('aiLoading').style.display = 'none';
        btn.disabled = false;
    }
}
