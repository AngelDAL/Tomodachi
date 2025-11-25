/**
 * Gestión de Inventario
 */

let products = [];
let currentFilter = '';
let selectedFile = null;
let storeId = 1;
let currentEditingProduct = null;

// Sistema de debouncing para búsqueda
let searchTimeout = null;
const SEARCH_DEBOUNCE_DELAY = 500; // 500ms de espera después de dejar de escribir

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', async function() {
    const session = await checkSession();
    if (!session) {
        window.location.href = '/Tomodachi/public/login.html';
        return;
    }
    storeId = session.store_id || 1;
    initInventory();
});

function initInventory() {
    bindEvents();
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
    }
}

async function submitAddProduct() {
    const form = document.getElementById('addProductForm');
    if (!form) return;
    
    const formData = new FormData(form);
    const productData = {
        product_name: formData.get('product_name'),
        description: formData.get('description'),
        sku: formData.get('sku'),
        barcode: formData.get('barcode'),
        price: parseFloat(formData.get('price')),
        current_stock: parseInt(formData.get('stock')),
        store_id: storeId
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
    
    if (isNaN(productData.current_stock) || productData.current_stock < 0) {
        showNotification('El stock debe ser un número válido', 'error');
        return;
    }
    
    try {
        showNotification('Guardando producto...', 'info');
        
        const response = await fetch('/Tomodachi/api/inventory/products.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(productData)
        });
        
        const data = await response.json();
        
        if (data.success) {
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
            
            const response = await fetch('/Tomodachi/api/inventory/upload_image.php', {
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

// Sistema simple y robusto de notificaciones
const toastSystem = {
    container: null,
    activeToasts: new Map(),
    queue: [],
    isProcessing: false,
    maxVisible: 3,
    
    init() {
        if (this.container) return;
        
        this.container = document.createElement('div');
        this.container.id = 'toast-container';
        this.container.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 10000;
            display: flex;
            flex-direction: column;
            gap: 10px;
            pointer-events: none;
            width: 95%;
            max-width: 500px;
        `;
        document.body.appendChild(this.container);
    },
    
    show(message, type = 'info') {
        this.init();
        this.queue.push({ message, type, id: Date.now() + Math.random() });
        this.processQueue();
    },
    
    processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;
        
        if (this.activeToasts.size >= this.maxVisible && this.queue.length > 0) {
            // Remover el toast más antiguo
            const firstId = this.activeToasts.keys().next().value;
            this.removeToast(firstId, true);
            return;
        }
        
        this.isProcessing = true;
        const toastData = this.queue.shift();
        
        setTimeout(() => {
            this.displayToast(toastData);
            this.isProcessing = false;
            if (this.queue.length > 0) {
                this.processQueue();
            }
        }, 100);
    },
    
    displayToast(toastData) {
        const { message, type, id } = toastData;
        
        const toast = document.createElement('div');
        toast.id = `toast-${id}`;
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            padding: 12px 16px;
            background: ${this.getColor(type)};
            color: white;
            border-radius: 6px;
            font-size: 0.9rem;
            box-shadow: 0 3px 8px rgba(0, 0, 0, 0.2);
            cursor: pointer;
            user-select: none;
            animation: toastSlideDown 0.3s ease-out;
            opacity: 1;
            pointer-events: auto;
        `;
        
        this.container.appendChild(toast);
        this.activeToasts.set(id, { element: toast, timeout: null });
        
        // Click para cerrar
        toast.addEventListener('click', () => {
            this.removeToast(id);
        });
        
        // Auto-cerrar después de 4 segundos
        const timeout = setTimeout(() => {
            this.removeToast(id);
        }, 4000);
        
        const toastInfo = this.activeToasts.get(id);
        if (toastInfo) toastInfo.timeout = timeout;
        
        // Pausar al pasar mouse
        toast.addEventListener('mouseenter', () => {
            if (toastInfo && toastInfo.timeout) {
                clearTimeout(toastInfo.timeout);
                toastInfo.timeout = null;
            }
        });
        
        // Reanudar al salir
        toast.addEventListener('mouseleave', () => {
            if (toastInfo && !toastInfo.timeout) {
                toastInfo.timeout = setTimeout(() => {
                    this.removeToast(id);
                }, 2000);
            }
        });
    },
    
    removeToast(id, immediate = false) {
        const toastInfo = this.activeToasts.get(id);
        if (!toastInfo) return;
        
        // Limpiar timeout
        if (toastInfo.timeout) {
            clearTimeout(toastInfo.timeout);
        }
        
        const element = toastInfo.element;
        
        if (immediate) {
            // Remover inmediatamente
            if (element.parentElement) {
                element.remove();
            }
            this.activeToasts.delete(id);
        } else {
            // Animar salida
            element.style.animation = 'toastSlideUp 0.3s ease-out';
            element.style.opacity = '0';
            
            setTimeout(() => {
                if (element.parentElement) {
                    element.remove();
                }
                this.activeToasts.delete(id);
                
                // Procesar siguiente en la cola si hay
                if (this.queue.length > 0) {
                    this.isProcessing = false;
                    this.processQueue();
                }
            }, 300);
        }
    },
    
    getColor(type) {
        switch(type) {
            case 'success':
                return 'rgba(76, 175, 80, 0.95)';
            case 'error':
                return 'rgba(244, 67, 54, 0.95)';
            case 'warning':
                return 'rgba(255, 193, 7, 0.95)';
            default:
                return 'rgba(33, 150, 243, 0.95)';
        }
    }
};

function showNotification(message, type = 'info') {
    toastSystem.show(message, type);
}

async function uploadImage() {
    const productId = document.getElementById('productId')?.value;
    
    if (!productId || !selectedFile) {
        alert('Selecciona producto e imagen');
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const response = await fetch('/Tomodachi/api/inventory/upload_image.php', {
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
        const response = await fetch(`/Tomodachi/api/inventory/products.php?store_id=${storeId}`);
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

function renderProducts(items) {
    const container = document.getElementById('invResults');
    if (!container) return;

    if (items.length === 0) {
        const emptyMessage = currentFilter 
            ? '<p style="grid-column: 1/-1; text-align: center; color: #999; padding: 40px;"><i class="fas fa-search"></i><br><br>No se encontraron productos con "<strong>' + escapeHtml(currentFilter) + '</strong>"</p>'
            : '<p style="grid-column: 1/-1; text-align: center; color: #999; padding: 40px;"><i class="fas fa-inbox"></i><br><br>No hay productos en el inventario</p>';
        container.innerHTML = emptyMessage;
        return;
    }

    container.innerHTML = items.map(product => {
        const imgHtml = product.image_path 
            ? `<img src="/${product.image_path}" alt="${product.product_name}" onerror="this.parentElement.innerHTML='<span class=&quot;no-image&quot;><i class=&quot;fas fa-image&quot;></i></span>'">`
            : '<span class="no-image"><i class="fas fa-image"></i></span>';
        
        return `
        <div class="product-card" data-product-id="${product.product_id}" title="${escapeHtml(product.product_name)}">
            <div class="product-image" onclick="openImageUpload(${product.product_id})">
                ${imgHtml}
            </div>
            <div class="product-info">
                <div class="product-name">${escapeHtml(product.product_name)}</div>
                <div class="product-details">
                    <div class="product-detail-row">
                        <span class="detail-icon"><i class="fas fa-tag"></i></span>
                        <input type="number" class="product-price-input" value="${parseFloat(product.price).toFixed(2)}" data-product-id="${product.product_id}" placeholder="0.00" step="0.01" onchange="savePrice(this)">
                    </div>
                    <div class="product-detail-row">
                        <span class="detail-icon"><i class="fas fa-cubes"></i></span>
                        <input type="number" class="product-qty" value="${product.current_stock !== null ? product.current_stock : 0}" data-product-id="${product.product_id}" min="0" placeholder="0" onchange="saveStock(this)">
                    </div>
                </div>
            </div>
        </div>
    `;
    }).join('');
}

function openImageUpload(productId) {
    currentEditingProduct = productId;
    document.getElementById('productId').value = productId;
    document.getElementById('productImage').click();
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
        const response = await fetch('/Tomodachi/api/inventory/products.php', {
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
    const stock = parseInt(input.value);

    if (isNaN(stock) || stock < 0) {
        alert('Stock inválido');
        const product = products.find(p => p.product_id == productId);
        if (product) input.value = product.current_stock || 0;
        return;
    }

    try {
        const response = await fetch('/Tomodachi/api/inventory/products.php', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                product_id: productId,
                min_stock: stock
            })
        });

        const data = await response.json();
        
        if (data.success) {
            // Actualizar el producto en el array local
            const product = products.find(p => p.product_id == productId);
            if (product) product.current_stock = stock;
        } else {
            alert('Error: ' + (data.message || 'No se pudo actualizar stock'));
            const product = products.find(p => p.product_id == productId);
            if (product) input.value = product.current_stock || 0;
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error al actualizar stock');
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
