/**
 * Gestión de Inventario
 */

let products = [];
let categories = [];
let currentFilter = '';
let selectedFile = null;
let storeId = 1;
let currentEditingProduct = null;
let currentViewMode = 'grid'; // 'grid' or 'list'
let showRetiredProducts = false; // Ocultar productos retirados por defecto
let activePromotions = []; // Promociones activas para indicators

// Estado del editor de composiciones (BOM)
let recipeEditingIngredients = [];
let recipeEditingProductId = null;
let addCompositionDraft = [];      // componentes pendientes al crear un producto 'recipe'
let addStagedComponents = [];      // componentes exprés aún no creados en BD
let addCompositionProductId = null;

// Helpers numéricos para el costo en vivo
const NUM = (v) => { const n = (v === undefined || v === null || v === '') ? 0 : (typeof v === 'number' ? v : parseFloat(v)); return isNaN(n) ? 0 : n; };
function fmtMoney(n) {
    n = NUM(n);
    return (window.FormatUtils && window.FormatUtils.currency) ? window.FormatUtils.currency(n) : '$' + n.toFixed(2);
}
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
    if (!session) { requireSession(); return; }
    storeId = session.store_id || 1;
    initInventory();
});

function initInventory() {
    bindEvents();
    loadCategories();
    loadProducts();
    loadActivePromotions();

    // Actualizar símbolo de moneda de los inputs según formato regional
    const sym = window.FormatUtils ? (window.FormatUtils.getConfig().currency_symbol || '$') : '$';
    document.querySelectorAll('.input-prefix .prefix').forEach(el => { el.textContent = sym; });

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
    const addImageZone = document.getElementById('addImageZone');
    const addImagePlaceholder = document.getElementById('addImagePlaceholder');
    const addImagePreview = document.getElementById('addProductImagePreview');
    const addImageRemoveBtn = document.getElementById('addImageRemoveBtn');

    if (addProductImageInput) {
        addProductImageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = addImagePreview.querySelector('img');
                    img.src = e.target.result;
                    addImagePlaceholder.classList.add('hidden');
                    addImagePreview.classList.remove('hidden');
                    if (addImageZone) addImageZone.classList.add('has-image');
                };
                reader.readAsDataURL(file);
            }
        });
    }

    if (addImageRemoveBtn) {
        addImageRemoveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            addProductImageInput.value = '';
            addImagePreview.classList.add('hidden');
            addImagePlaceholder.classList.remove('hidden');
            if (addImageZone) addImageZone.classList.remove('has-image');
        });
    }

    // Tab switching for add product modal
    document.querySelectorAll('.add-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.add-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.add-tab-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const panel = document.getElementById(tab.dataset.ptab);
            if (panel) panel.classList.add('active');
        });
    });

    // Mini scanner for barcode/QR in add product modal
    let miniScannerInstance = null;
    let miniScanTarget = null;
    const scanBarcodeBtn = document.getElementById('scanBarcodeBtn');
    const scanQRBtn = document.getElementById('scanQRBtn');
    const miniScannerContainer = document.getElementById('miniScannerContainer');
    const miniScannerClose = document.getElementById('miniScannerClose');
    const miniScannerCancel = document.getElementById('miniScannerCancel');
    const miniScannerLabel = document.getElementById('miniScannerLabel');
    const barcodeInput = document.getElementById('productBarcodeInput');
    const qrInput = document.getElementById('productQRInput');

    function stopMiniScanner() {
        if (miniScannerInstance) {
            try {
                miniScannerInstance.stop().then(() => {
                    miniScannerInstance.clear();
                    miniScannerInstance = null;
                }).catch(() => { miniScannerInstance = null; });
            } catch (e) { miniScannerInstance = null; }
        }
        miniScannerContainer.classList.add('hidden');
        if (scanBarcodeBtn) scanBarcodeBtn.classList.remove('scanning');
        if (scanQRBtn) scanQRBtn.classList.remove('scanning');
        miniScanTarget = null;
    }

    function startMiniScanner(target) {
        // En la app nativa: cámara del sistema (fuera del HTML)
        if (window.TomodachiNative && window.TomodachiNative.isNative) {
            const input = target === scanBarcodeBtn ? barcodeInput : qrInput;
            window.TomodachiNative.scanBarcode()
                .then(code => {
                    if (code && input) {
                        input.value = code;
                        input.style.backgroundColor = 'var(--primary-light)';
                        setTimeout(() => input.style.backgroundColor = '', 1500);
                    }
                })
                .catch(err => {
                    console.error('Error escáner nativo:', err);
                    if (window.showNotification) showNotification('No se pudo leer el código. Intente de nuevo.', 'error');
                });
            return;
        }
        if (miniScannerInstance) stopMiniScanner();
        miniScanTarget = target;
        miniScannerContainer.classList.remove('hidden');
        target.classList.add('scanning');
        miniScannerLabel.textContent = target === scanBarcodeBtn ? 'Escanea código de barras' : 'Escanea código QR';

        setTimeout(() => {
            try {
                const formats = target === scanBarcodeBtn
                    ? [Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.EAN_13,
                       Html5QrcodeSupportedFormats.EAN_8, Html5QrcodeSupportedFormats.CODE_39,
                       Html5QrcodeSupportedFormats.CODE_93, Html5QrcodeSupportedFormats.UPC_A,
                       Html5QrcodeSupportedFormats.UPC_E, Html5QrcodeSupportedFormats.CODABAR,
                       Html5QrcodeSupportedFormats.ITF]
                    : [Html5QrcodeSupportedFormats.QR_CODE];

                miniScannerInstance = new Html5Qrcode('miniQrReader', { formatsToSupport: formats, verbose: false });
                miniScannerInstance.start(
                    { facingMode: 'environment' },
                    { fps: 10, qrbox: { width: 200, height: 200 } },
                    (decodedText) => {
                        const input = target === scanBarcodeBtn ? barcodeInput : qrInput;
                        if (input) {
                            input.value = decodedText;
                            input.style.backgroundColor = 'var(--primary-light)';
                            setTimeout(() => input.style.backgroundColor = '', 1500);
                        }
                        stopMiniScanner();
                    },
                    () => {}
                ).catch((err) => {
                    console.error('Mini scanner error:', err);
                    showNotification('No se pudo acceder a la cámara', 'error');
                    stopMiniScanner();
                });
            } catch (e) {
                console.error('Mini scanner init error:', e);
                showNotification('Error al iniciar escáner', 'error');
                stopMiniScanner();
            }
        }, 300);
    }

    if (scanBarcodeBtn && miniScannerContainer) {
        scanBarcodeBtn.addEventListener('click', () => startMiniScanner(scanBarcodeBtn));
    }
    if (scanQRBtn && miniScannerContainer) {
        scanQRBtn.addEventListener('click', () => startMiniScanner(scanQRBtn));
    }
    if (miniScannerClose) miniScannerClose.addEventListener('click', stopMiniScanner);
    if (miniScannerCancel) miniScannerCancel.addEventListener('click', stopMiniScanner);

    // Stop scanner if modal closes
    const closeModalBtnExisting = document.getElementById('closeModalBtn');
    const cancelProductBtnExisting = document.getElementById('cancelProductBtn');
    if (closeModalBtnExisting) closeModalBtnExisting.addEventListener('click', stopMiniScanner);
    if (cancelProductBtnExisting) cancelProductBtnExisting.addEventListener('click', stopMiniScanner);

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
                            showNotification('Imagen actualizada correctamente', 'success');
                            // Actualizar lista de productos en segundo plano
                            loadProducts();
                        } else {
                            showNotification('Error al actualizar imagen: ' + (data.message || 'Desconocido'), 'error');
                        }
                    };
                    base64Reader.readAsDataURL(file);
                } catch (error) {
                    console.error('Error subiendo imagen:', error);
                    showNotification('Error de conexión al subir imagen', 'error');
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
    // if (addProductModal) {
    //     addProductModal.addEventListener('click', (e) => {
    //         if (e.target === addProductModal) {
    //             closeAddProductModal();
    //         }
    //     });
    // }

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

    // Toggle de venta a granel
    const isBulkCheckbox = document.getElementById('editProductIsBulk');
    const bulkUnitGroup = document.getElementById('bulkUnitGroup');
    if (isBulkCheckbox && bulkUnitGroup) {
        isBulkCheckbox.addEventListener('change', function() {
            bulkUnitGroup.style.display = this.checked ? 'block' : 'none';
        });
    }

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

    // Cerrar con tecla Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && detailsModal?.classList.contains('show')) {
            closeProductDetails();
        }
    });

    // Tab switching for drawer
    document.querySelectorAll('.drawer-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.drawer-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const panel = document.getElementById(tab.dataset.tab);
            if (panel) panel.classList.add('active');
        });
    });

    // Configuración de vista
    const viewSettingsBtn = document.getElementById('viewSettingsBtn');
    const viewSettingsDropdown = document.getElementById('viewSettingsDropdown');
    const toggleViewModeBtn = document.getElementById('toggleViewModeBtn');

    if (viewSettingsBtn && viewSettingsDropdown) {
        viewSettingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            viewSettingsDropdown.classList.toggle('hidden');
        });

        // Cerrar dropdown al hacer clic fuera
        document.addEventListener('click', (e) => {
            if (!viewSettingsBtn.contains(e.target) && !viewSettingsDropdown.contains(e.target)) {
                viewSettingsDropdown.classList.add('hidden');
            }
        });
    }

    if (toggleViewModeBtn) {
        toggleViewModeBtn.addEventListener('click', () => {
            currentViewMode = currentViewMode === 'grid' ? 'list' : 'grid';

            // Actualizar texto del botón y cerrar dropdown
            if (currentViewMode === 'grid') {
                 toggleViewModeBtn.innerHTML = '<i class="fas fa-list"></i> Vista de Lista';
            } else {
                 toggleViewModeBtn.innerHTML = '<i class="fas fa-th"></i> Vista Cuadrícula';
            }

            if (viewSettingsDropdown) viewSettingsDropdown.classList.add('hidden');

            // Re-render products
            performSearch();
        });
    }

    const toggleRetiredBtn = document.getElementById('toggleRetiredBtn');
    if (toggleRetiredBtn) {
        toggleRetiredBtn.addEventListener('click', () => {
            showRetiredProducts = !showRetiredProducts;
            toggleRetiredBtn.innerHTML = showRetiredProducts
                ? '<i class="fas fa-eye-slash"></i> Ocultar Retirados'
                : '<i class="fas fa-eye"></i> Mostrar Retirados';
            if (viewSettingsDropdown) viewSettingsDropdown.classList.add('hidden');
            performSearch();
        });
    }

    // Tipo de inventario en modal de alta
    const addTrackingSelect = document.getElementById('productTrackingType');
    if (addTrackingSelect) addTrackingSelect.addEventListener('change', updateAddTrackingUI);

    // Tipo de inventario en edición
    const editTrackingSelect = document.getElementById('editProductTrackingType');
    if (editTrackingSelect) editTrackingSelect.addEventListener('change', updateEditTrackingUI);

    // Tarjetas de tipo de inventario (4 opciones grandes)
    document.querySelectorAll('#addTypeCards .inv-type-card').forEach(card => {
        card.addEventListener('click', () => {
            const sel = document.getElementById('productTrackingType');
            if (sel) sel.value = card.dataset.type;
            updateAddTrackingUI();
        });
    });
    document.querySelectorAll('#editTypeCards .inv-type-card').forEach(card => {
        card.addEventListener('click', () => {
            const sel = document.getElementById('editProductTrackingType');
            if (sel) sel.value = card.dataset.type;
            updateEditTrackingUI();
        });
    });

    // Añadir presentación (alta y edición)
    const addPresentBtn = document.getElementById('addPresentAddBtn');
    if (addPresentBtn) addPresentBtn.addEventListener('click', addAddPresentation);
    const editPresentBtn = document.getElementById('editPresentAddBtn');
    if (editPresentBtn) editPresentBtn.addEventListener('click', addEditPresentation);

    // Alta exprés de componente (composición y servicio)
    const wireExpress = (pre) => {
        const openBtn = document.getElementById(pre + 'ExpressCompBtn');
        const saveBtn = document.getElementById(pre + 'ExpressCompSave');
        const cancelBtn = document.getElementById(pre + 'ExpressCompCancel');
        if (openBtn) openBtn.addEventListener('click', () => toggleExpressComp(pre));
        if (saveBtn) saveBtn.addEventListener('click', () => expressCreateComponent(pre));
        if (cancelBtn) cancelBtn.addEventListener('click', () => {
            const f = document.getElementById(pre + 'ExpressCompForm');
            if (f) f.style.display = 'none';
        });
    };
    wireExpress('add');
    wireExpress('edit');

    // Inline component creation from search no-results
    const addInlinePresentBtn = document.getElementById('addInlinePresentBtn');
    if (addInlinePresentBtn) addInlinePresentBtn.addEventListener('click', addInlinePresentation);
    const inlineCompSaveBtn = document.getElementById('inlineCompSaveBtn');
    if (inlineCompSaveBtn) inlineCompSaveBtn.addEventListener('click', inlineCreateComponent);

    // Delegation for remove buttons on inline presentations
    const inlineCompPresentations = document.getElementById('inlineCompPresentations');
    if (inlineCompPresentations) {
        inlineCompPresentations.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('.comp-present-remove');
            if (removeBtn) {
                e.preventDefault();
                const idx = parseInt(removeBtn.getAttribute('data-idx'), 10);
                if (!isNaN(idx)) removeInlinePresentation(idx);
            }
        });
        // Sync draft state on input changes
        inlineCompPresentations.addEventListener('input', (e) => {
            const row = e.target.closest('.comp-present-row');
            if (!row) return;
            const idx = parseInt(row.getAttribute('data-idx'), 10);
            if (isNaN(idx) || !inlinePresentationsDraft[idx]) return;
            if (e.target.classList.contains('present-label')) inlinePresentationsDraft[idx].label = e.target.value;
            if (e.target.classList.contains('present-qty')) inlinePresentationsDraft[idx].quantity = e.target.value;
            if (e.target.classList.contains('present-cost')) inlinePresentationsDraft[idx].total_cost = e.target.value;
        });
    }

    // Asistente: PASO 1 → PASO 2 (Continuar) y volver a cambiar el tipo.
    const addContinueBtn = document.getElementById('addContinueBtn');
    if (addContinueBtn) addContinueBtn.addEventListener('click', beginAddForm);
    const addTypeChangeBtn = document.getElementById('addTypeChangeBtn');
    if (addTypeChangeBtn) addTypeChangeBtn.addEventListener('click', () => {
        const ts = document.getElementById('addTypeScreen');
        const fa = document.getElementById('addFormArea');
        if (ts) ts.style.display = '';
        if (fa) fa.style.display = 'none';
        const first = document.querySelector('#addTypeScreen .inv-type-card');
        const act = document.querySelector('#addTypeCards .inv-type-card.active');
        if (act && typeof act.focus === 'function') act.focus();
        else if (first && typeof first.focus === 'function') first.focus();
    });

    // Editor de receta (BOM)
    const editRecipeBtn = document.getElementById('editRecipeBtn');
    if (editRecipeBtn) editRecipeBtn.addEventListener('click', toggleRecipeEditor);

    const addRecipeIngredientBtn = document.getElementById('addRecipeIngredientBtn');
    if (addRecipeIngredientBtn) addRecipeIngredientBtn.addEventListener('click', addRecipeIngredient);

    const saveRecipeBtn = document.getElementById('saveRecipeBtn');
    if (saveRecipeBtn) saveRecipeBtn.addEventListener('click', saveRecipe);

    const recipeIngredientsList = document.getElementById('recipeIngredientsList');
    if (recipeIngredientsList) {
        recipeIngredientsList.addEventListener('click', (e) => {
            const btn = e.target.closest('.recipe-ing-remove');
            if (btn) {
                e.preventDefault();
                const componentId = btn.getAttribute('data-component-id');
                if (componentId) removeRecipeIngredient(componentId);
            }
        });
        // 'change' guarda el valor; 'input' recalcula el costo en vivo sin perder foco.
        recipeIngredientsList.addEventListener('change', (e) => {
            if (e.target.classList.contains('recipe-ing-qty')) {
                const componentId = e.target.getAttribute('data-component-id');
                const ing = recipeEditingIngredients.find(i => String(i.component_id) === String(componentId));
                if (ing) ing.quantity = e.target.value;
            }
        });
        recipeIngredientsList.addEventListener('input', (e) => {
            if (e.target.classList.contains('recipe-ing-qty')) {
                const componentId = e.target.getAttribute('data-component-id');
                const ing = recipeEditingIngredients.find(i => String(i.component_id) === String(componentId));
                if (ing) {
                    ing.quantity = e.target.value;
                    updateEditCompositionCost();
                }
            }
        });
    }

    // Editor de composición en el modal de ALTA (buscador + fichas con pasos)
    const addCompositionList = document.getElementById('addCompositionList');
    if (addCompositionList) {
        addCompositionList.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('.recipe-ing-remove');
            if (removeBtn) {
                e.preventDefault();
                const componentId = removeBtn.getAttribute('data-component-id');
                if (componentId) removeAddComposition(componentId);
                return;
            }
            const minus = e.target.closest('.comp-qty-minus');
            const plus = e.target.closest('.comp-qty-plus');
            if (minus || plus) {
                e.preventDefault();
                const cid = (minus || plus).getAttribute('data-component-id');
                bumpCompQty(cid, plus ? 0.1 : -0.1);
            }
        });
        addCompositionList.addEventListener('input', (e) => {
            if (e.target.classList.contains('comp-qty')) {
                const componentId = e.target.getAttribute('data-component-id');
                const ing = addCompositionDraft.find(i => String(i.component_id) === String(componentId));
                if (ing) {
                    ing.quantity = e.target.value;
                    updateAddCompositionCost();
                }
            }
        });
        // Evaluar expresiones matemáticas (ej: "1/8") al presionar Enter o perder foco
        addCompositionList.addEventListener('keydown', (e) => {
            if (e.target.classList.contains('comp-qty') && e.key === 'Enter') {
                e.preventDefault();
                evalMathExpression(e.target);
            }
        });
        addCompositionList.addEventListener('focusout', (e) => {
            if (e.target.classList.contains('comp-qty')) {
                evalMathExpression(e.target);
            }
        });
    }

    // Búsqueda de componentes: escribe el nombre, sale la lista y se elige para añadir.
    const compSearchInput = document.getElementById('compSearchInput');
    const compSearchResults = document.getElementById('compSearchResults');
    if (compSearchInput) {
        compSearchInput.addEventListener('input', filterCompSearch);
        compSearchInput.addEventListener('focus', filterCompSearch);
        compSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && compSearchResults) compSearchResults.style.display = 'none';
            if (e.key === 'Enter') e.preventDefault();
        });
    }
    if (compSearchResults) {
        compSearchResults.addEventListener('click', (e) => {
            const item = e.target.closest('.comp-search-item');
            if (item && item.getAttribute('data-pid')) addComponentFromPicker(item.getAttribute('data-pid'));
        });
    }
    document.addEventListener('click', (e) => {
        if (compSearchResults && !e.target.closest('.comp-search')) compSearchResults.style.display = 'none';
    });

    // Selector de modo de consumo (3 botones resaltables).
    document.querySelectorAll('.consume-opts').forEach(grp => {
        grp.addEventListener('click', (e) => {
            const opt = e.target.closest('.consume-opt');
            if (!opt) return;
            const group = grp.closest('.form-group');
            if (group && group.id) consumeModeSet(group.id, opt.dataset.value);
        });
    });
}

function performSearch() {
    // Mostrar información de búsqueda
    const searchInfoEl = document.getElementById('searchInfo');
    const resultCountEl = document.getElementById('searchResultCount');

    let filtered = products;

    // Filtrar productos retirados por defecto (a menos que se active "Mostrar Retirados")
    if (!showRetiredProducts) {
        filtered = filtered.filter(p => !p.discontinued_at);
    }

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
    resetAddComposition();
    consumeModeSet('addConsumeModeGroup', 'fifo');
    // Asistente: mostrar el PASO 1 (selección de tipo) ocultando el formulario.
    const sel = document.getElementById('productTrackingType');
    if (sel) sel.value = 'stock';
    document.querySelectorAll('#addTypeCards .inv-type-card').forEach(c => c.classList.toggle('active', c.dataset.type === 'stock'));
    document.querySelectorAll('.add-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.add-tab-panel').forEach(p => p.classList.remove('active'));
    const p1 = document.getElementById('ptab1'); if (p1) p1.classList.add('active');
    const p1t = document.querySelector('.add-tab[data-ptab="ptab1"]'); if (p1t) p1t.classList.add('active');
    syncAddTabs();
    const typeScreen = document.getElementById('addTypeScreen');
    const formArea = document.getElementById('addFormArea');
    if (typeScreen) typeScreen.style.display = '';
    if (formArea) formArea.style.display = 'none';
    const modal = document.getElementById('addProductModal');
    if (modal) {
        modal.classList.add('show');
        setTimeout(() => {
            const first = document.querySelector('#addTypeScreen .inv-type-card');
            if (first) first.focus();
        }, 100);
    }
}

function closeAddProductModal() {
    const modal = document.getElementById('addProductModal');
    if (modal) {
        modal.classList.remove('show');
        document.getElementById('addProductForm')?.reset();
        // Reset image preview
        const preview = document.getElementById('addProductImagePreview');
        const placeholder = document.getElementById('addImagePlaceholder');
        const zone = document.getElementById('addImageZone');
        const input = document.getElementById('addProductImage');
        if (preview) preview.classList.add('hidden');
        if (placeholder) placeholder.classList.remove('hidden');
        if (zone) zone.classList.remove('has-image');
        if (input) input.value = '';
    }
    resetAddComposition();
    addPresentationDraft = [];
    renderAddPresentations();
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
        min_stock: parseInt(formData.get('min_stock')) || 0,
        tracking_type: document.getElementById('productTrackingType')?.value || 'stock',
        is_ingredient: (document.getElementById('productTrackingType')?.value === 'component') ? 1 : 0,
        consume_mode: consumeModeGet('addConsumeModeGroup'),
        pieces_per_box: parseFloat(document.getElementById('productPiecesPerBox')?.value) || null,
        cost_per_box: parseFloat(document.getElementById('productCostPerBox')?.value) || null
        // store_id eliminado, el backend lo toma de la sesión
    };

    // Limpiar errores previos
    document.querySelectorAll('#addProductForm .error').forEach(el => el.classList.remove('error'));

    // Validar datos requeridos con feedback visual
    let hasError = false;
    const nameInput = document.getElementById('productNameInput');
    if (!productData.product_name) {
        nameInput.classList.add('error');
        nameInput.focus();
        hasError = true;
    }

    if (isNaN(productData.price) || productData.price < 0) {
        document.getElementById('productPriceInput')?.classList.add('error');
        if (!hasError) document.getElementById('productPriceInput')?.focus();
        hasError = true;
    }

    if (hasError) {
        showNotification('Completa los campos marcados en rojo', 'error');
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
            const newProductId = data.data.product_id;

            // Si hay imagen seleccionada, subirla ahora
            const imageInput = document.getElementById('addProductImage');
            if (imageInput && imageInput.files[0]) {
                await uploadImageForNewProduct(newProductId, imageInput.files[0]);
            }

            // Persistir la composición si el producto es ensamblado y hay componentes definidos
            const addType = document.getElementById('productTrackingType')?.value;
            if ((addType === 'recipe' || addType === 'none') && addCompositionDraft.length) {
                // 1. Crear componentes exprés staged primero
                const stagedIdMap = {};
                for (const staged of addStagedComponents) {
                    try {
                        const cRes = await fetch('../api/inventory/products.php', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                product_name: staged.product_name, price: 0, cost: staged.cost,
                                stock: 0, min_stock: 0, tracking_type: 'component',
                                consume_mode: 'fifo', is_ingredient: 1, status: 'active'
                            })
                        });
                        const cData = await cRes.json();
                        if (cData.success) {
                            stagedIdMap[staged.staged_id] = cData.data.product_id;
                            // Crear presentación inicial con stock
                            if (staged.stock > 0) {
                                await fetch('../api/inventory/lots.php', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ product_id: cData.data.product_id, label: 'Stock inicial', quantity: staged.stock, total_cost: staged.cost * staged.stock })
                                });
                            }
                        }
                    } catch (e) { console.error('Error creando componente staged:', e); }
                }
                // 2. Mapear IDs staged a IDs reales y guardar receta
                const compDraft = addCompositionDraft
                    .map(i => ({
                        component_id: i.is_staged ? (stagedIdMap[i.component_id] || i.component_id) : i.component_id,
                        quantity: NUM(i.quantity)
                    }))
                    .filter(i => i.component_id && i.quantity > 0 && !String(i.component_id).startsWith('staged_'));
                if (compDraft.length) {
                    try {
                        const compRes = await fetch('../api/inventory/recipe.php', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ product_id: newProductId, ingredients: compDraft })
                        });
                        const compData = await compRes.json();
                        if (!compData.success) {
                            console.warn('No se pudo guardar la composición del producto nuevo:', compData.message);
                        }
                    } catch (e) {
                        console.error('Error guardando composición del producto nuevo:', e);
                    }
                }
                addStagedComponents = [];
            }

            // Persistir presentaciones si el producto es un componente
            if (addType === 'component' && addPresentationDraft.length) {
                for (const p of addPresentationDraft) {
                    try {
                        await fetch('../api/inventory/lots.php', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                product_id: newProductId,
                                label: p.label,
                                quantity: p.quantity,
                                total_cost: p.total_cost || 0
                            })
                        });
                    } catch (e2) {
                        console.error('Error guardando presentación del producto nuevo:', e2);
                    }
                }
            }

            showNotification('Producto agregado correctamente', 'success');
            closeAddProductModal();

            // Recargar productos
            setTimeout(() => {
                loadProducts();
            }, 500);
        } else {
            showNotification('Error: ' + (data.message || 'No se pudo agregar el producto'), 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showNotification('Error al agregar el producto', 'error');
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
                showNotification('Imagen subida correctamente', 'success');
                // Limpiar
                document.getElementById('productImage').value = '';
                selectedFile = null;
                currentEditingProduct = null;
                // Recargar productos
                setTimeout(() => loadProducts(), 800);
            } else {
                showNotification('Error: ' + (data.error?.image_base64 || data.message || 'No se pudo subir la imagen'), 'error');
            }
        } catch (error) {
            console.error('Error:', error);
            showNotification('Error al subir la imagen', 'error');
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
    // Reintento: el SW o la red pueden fallar la primera vez al navegar.
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            // Eliminado store_id de los parámetros, el backend usa la sesión
            const response = await fetch(`../api/inventory/products.php`, { credentials: 'include' });
            if (!response.ok) {
                if (attempt < 3) { await new Promise(r => setTimeout(r, 600 * attempt)); continue; }
                return;
            }
            const data = await response.json();

            if (data.success) {
                products = data.data || [];
                performSearch(); // Aplica filtro de retirados y búsqueda
            } else {
                console.error('Error:', data.error);
            }
            return;
        } catch (error) {
            console.error('Error cargando productos (intento ' + attempt + '):', error);
            if (attempt < 3) { await new Promise(r => setTimeout(r, 600 * attempt)); continue; }
        }
    }
}

async function loadActivePromotions() {
    try {
        const res = await fetch('../api/promotions/read.php', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && data.data) {
            const now = new Date();
            activePromotions = (data.data || []).filter(p => {
                if (!p.is_active) return false;
                const start = p.start_date ? new Date(p.start_date) : null;
                const end = p.end_date ? new Date(p.end_date) : null;
                if (start && start > now) return false;
                if (end && end < now) return false;
                return true;
            });
        }
    } catch (e) { /* silent */ }
}

function getProductPromoInfo(productId, categoryId) {
    for (const promo of activePromotions) {
        if (!promo.targets || !promo.targets.length) continue;
        for (const t of promo.targets) {
            if (t.product_id && parseInt(t.product_id) === parseInt(productId)) {
                return { name: promo.name, type: promo.type };
            }
            if (t.category_id && parseInt(t.category_id) === parseInt(categoryId)) {
                return { name: promo.name, type: promo.type };
            }
        }
    }
    return null;
}

async function loadCategories() {
    // Reintento: el SW o la red pueden fallar la primera vez al navegar.
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await fetch('../api/inventory/categories.php', { credentials: 'include' });
            if (!response.ok) {
                if (attempt < 3) { await new Promise(r => setTimeout(r, 600 * attempt)); continue; }
                return;
            }
            const data = await response.json();
            if (data.success) {
                categories = data.data || [];
                populateCategorySelects();
            }
            return;
        } catch (error) {
            console.error('Error cargando categorías (intento ' + attempt + '):', error);
            if (attempt < 3) { await new Promise(r => setTimeout(r, 600 * attempt)); continue; }
        }
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

    if (currentViewMode === 'list') {
        container.classList.remove('products-grid');
        container.classList.add('products-list');
    } else {
        container.classList.remove('products-list');
        container.classList.add('products-grid');
    }

    if (items.length === 0) {
        const emptyMessage = currentFilter
            ? '<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;"><i class="fas fa-search"></i><br><br>No se encontraron productos con "<strong>' + escapeHtml(currentFilter) + '</strong>"</p>'
            : '<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;"><i class="fas fa-inbox"></i><br><br>No hay productos en el inventario</p>';
        container.innerHTML = emptyMessage;
        return;
    }

    container.innerHTML = items.map(product => {
        const imagePath = getRelativeImagePath(product.image_path);
        const imgHtml = imagePath
            ? `<img src="${imagePath}" alt="${product.product_name}" onerror="this.parentElement.innerHTML='<span class=&quot;no-image&quot;><i class=&quot;fas fa-image&quot;></i></span>'">`
            : '<span class="no-image"><i class="fas fa-image"></i></span>';

        // Indicadores de visibilidad
        const isRetired = !!product.discontinued_at;
        const isHidden = product.hidden_in_pos == 1 && !isRetired;
        let visibilityBadge = '';
        if (isRetired) {
            visibilityBadge = '<span class="visibility-badge retired"><i class="fas fa-archive"></i> Retirado</span>';
        } else if (isHidden) {
            visibilityBadge = '<span class="visibility-badge hidden"><i class="fas fa-eye-slash"></i> Oculto en caja</span>';
        }

        // Indicador de promoción activa
        const promoInfo = getProductPromoInfo(product.product_id, product.category_id);
        let promoBadge = '';
        if (promoInfo && !isRetired) {
            const promoIcon = promoInfo.type === 'bundle' ? 'fa-box' : promoInfo.type === 'bulk_discount' ? 'fa-layer-group' : 'fa-percent';
            promoBadge = `<span class="promo-indicator" title="${promoInfo.name}"><i class="fas ${promoIcon}"></i></span>`;
        }

        const stockInfo = buildStockMarkup(product);
        const formattedPrice = window.FormatUtils ? window.FormatUtils.currency(product.price) : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(product.price);

        if (currentViewMode === 'list') {
             return `
            <div class="product-list-item" onclick="openProductDetails(${product.product_id})" title="Ver detalles de ${escapeHtml(product.product_name)}">
                <div class="product-list-image">
                    ${imgHtml}
                </div>
                <div class="product-list-info">
                    <div class="product-list-name">${escapeHtml(product.product_name)}</div>
                     <div class="product-list-details">
                        <div class="product-list-price">${formattedPrice}</div>
                        <div class="product-list-stock ${stockInfo.cls}">
                            ${stockInfo.html}
                        </div>
                    </div>
                </div>
                <div style="margin-left: auto; color: var(--text-muted);">
                   <i class="fas fa-chevron-right"></i>
                </div>
            </div>`;
        } else {
            return `
            <div class="product-card ${isRetired ? 'retired-card' : ''}" onclick="openProductDetails(${product.product_id})" title="Ver detalles de ${escapeHtml(product.product_name)}">
                <div class="product-image">
                    ${imgHtml}
                    ${visibilityBadge}
                    ${promoBadge}
                </div>
                <div class="product-info">
                    <div class="product-name">${escapeHtml(product.product_name)}</div>
                    <div class="product-meta">
                        <div class="meta-price">${formattedPrice}</div>
                        <div class="meta-stock ${stockInfo.cls}">
                            ${stockInfo.html}
                        </div>
                    </div>
                </div>
            </div>
            `;
        }
    }).join('');
}

// Construye el marcado de stock/disponibilidad para una tarjeta de producto.
// Solo muestra la cantidad y su color (sin palabras que desborden el espacio).
function buildStockMarkup(product) {
    const fmt = v => window.FormatUtils ? window.FormatUtils.qty(v) : v;
    const lowCls = (qty, min) => (qty <= (min || 0)) ? 'stock-low' : 'stock-ok';

    // Ensamblado (receta): disponibilidad derivada en un número.
    if (product.tracking_type === 'recipe') {
        if (product.available == null) {
            return { cls: 'stock-muted', html: '<i class="fas fa-cubes"></i> —' };
        }
        return { cls: lowCls(product.available, product.min_stock), html: '<i class="fas fa-cubes"></i> ' + fmt(product.available) };
    }

    // Componente: la cantidad es la suma de sus presentaciones.
    if (product.tracking_type === 'component') {
        const qty = (product.available != null) ? product.available
            : (Array.isArray(product.presentations)
                ? product.presentations.reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0)
                : (product.current_stock != null ? product.current_stock : 0));
        return { cls: lowCls(qty, product.min_stock), html: '<i class="fas fa-cubes"></i> ' + fmt(qty) };
    }

    // Productos por lotes/cajas: si hay cajas completas "N caja(s) + M"; si no, solo el total.
    if (product.lots && (parseInt(product.lots.full_boxes) > 0 || parseInt(product.lots.opened) > 0)) {
        const fb = parseInt(product.lots.full_boxes) || 0;
        const op = parseInt(product.lots.opened) || 0;
        const total = (product.lots.total != null) ? parseInt(product.lots.total) : (fb * (parseInt(product.lots.pieces_per_box) || 0) + op);
        const cls = lowCls(total, product.min_stock);
        if (fb > 0) {
            const label = fb + ' caja' + (fb === 1 ? '' : 's') + (op > 0 ? ' + ' + op : '');
            return { cls: cls, html: '<i class="fas fa-boxes-stacked"></i> ' + label };
        }
        return { cls: cls, html: '<i class="fas fa-cubes"></i> ' + fmt(op) };
    }

    // Stock clásico.
    const qty = (product.current_stock != null) ? parseFloat(product.current_stock) : 0;
    return { cls: lowCls(qty, product.min_stock), html: '<i class="fas fa-cubes"></i> ' + fmt(qty) };
}

// Controla visibilidad de campos en el modal de edición según el tipo de inventario.
function updateEditTrackingUI() {
    const tracking = document.getElementById('editProductTrackingType')?.value || 'stock';
    const lotGroup = document.getElementById('editProductLotGroup');
    const stockGroup = document.getElementById('editStockGroup');
    const minStockGroup = document.getElementById('editMinStockGroup');
    const barcodeGroup = document.getElementById('editBarcodeGroup');
    const vis = (el, show) => { if (el) el.style.display = show ? '' : 'none'; };
    vis(lotGroup, tracking === 'stock');
    vis(stockGroup, tracking !== 'recipe' && tracking !== 'component' && tracking !== 'none');
    vis(minStockGroup, tracking !== 'none');
    vis(barcodeGroup, tracking !== 'none');
    document.querySelectorAll('#editTypeCards .inv-type-card').forEach(c => {
        c.classList.toggle('active', c.dataset.type === tracking);
    });
    syncEditTabs();
    if (tracking === 'recipe' || tracking === 'none') openRecipePanel();
    else closeRecipePanel();
    if (tracking === 'component') loadEditPresentations();
}

// Muestra/oculta las pestañas del editor según el tipo: Ensamblado/Servicio → "Componentes",
// Componente → "Presentaciones". Si la pestaña activa quedó oculta, vuelve a "Precio & Stock".
function syncEditTabs() {
    const tracking = document.getElementById('editProductTrackingType')?.value || 'stock';
    const compTab = document.querySelector('.drawer-tab[data-tab="tabComp"]');
    const presentTab = document.querySelector('.drawer-tab[data-tab="tabPresent"]');
    const showComp = (tracking === 'recipe' || tracking === 'none');
    const showPresent = (tracking === 'component');
    if (compTab) compTab.style.display = showComp ? '' : 'none';
    if (presentTab) presentTab.style.display = showPresent ? '' : 'none';
    const activePanel = document.querySelector('.tab-panel.active');
    const activeId = activePanel ? activePanel.id : 'tab1';
    if ((activeId === 'tabComp' && !showComp) || (activeId === 'tabPresent' && !showPresent)) {
        switchDrawerTab('tab1');
    }
}

function switchDrawerTab(panelId) {
    document.querySelectorAll('.drawer-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    const b = document.querySelector('.drawer-tab[data-tab="' + panelId + '"]'); if (b) b.classList.add('active');
    const p = document.getElementById(panelId); if (p) p.classList.add('active');
}

// Controla visibilidad de campos en el modal de alta.
function updateAddTrackingUI() {
    const tracking = document.getElementById('productTrackingType')?.value || 'stock';
    const lotGroup = document.getElementById('addProductLotGroup');
    const stockGroup = document.getElementById('addStockGroup');
    const minStockGroup = document.getElementById('addMinStockGroup');
    const barcodeGroup = document.getElementById('addBarcodeGroup');
    const vis = (el, show) => { if (el) el.style.display = show ? '' : 'none'; };
    // Producto final → piezas por caja (lotes derivados).
    vis(lotGroup, tracking === 'stock');
    // Servicio (none) no es físico: sin cantidad inicial, sin mínimo, sin código de barras.
    vis(stockGroup, tracking === 'stock');
    vis(minStockGroup, tracking !== 'none');
    vis(barcodeGroup, tracking !== 'none');
    document.querySelectorAll('#addTypeCards .inv-type-card').forEach(c => {
        c.classList.toggle('active', c.dataset.type === tracking);
    });
    // El stock inicial escalar solo aplica al Producto final.
    const si = document.getElementById('productStockInput');
    if (si) {
        if (tracking === 'stock') { si.setAttribute('required', ''); }
        else { si.removeAttribute('required'); si.value = 0; }
    }
    syncAddTabs();
}

// Muestra/oculta las pestañas dinámicas según el tipo: Ensamblado/Servicio → "Componentes",
// Componente → "Presentaciones". Si la pestaña activa quedó oculta, vuelve a "Principal".
function syncAddTabs() {
    const tracking = document.getElementById('productTrackingType')?.value || 'stock';
    const compTab = document.querySelector('.add-tab[data-ptab="ptabComp"]');
    const presentTab = document.querySelector('.add-tab[data-ptab="ptabPresent"]');
    const showComp = (tracking === 'recipe' || tracking === 'none');
    const showPresent = (tracking === 'component');
    if (compTab) compTab.style.display = showComp ? '' : 'none';
    if (presentTab) presentTab.style.display = showPresent ? '' : 'none';
    const activePanel = document.querySelector('.add-tab-panel.active');
    const activeId = activePanel ? activePanel.id : 'ptab1';
    if ((activeId === 'ptabComp' && !showComp) || (activeId === 'ptabPresent' && !showPresent)) {
        switchAddTab('ptab1');
    }
}

function switchAddTab(panelId) {
    document.querySelectorAll('.add-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.add-tab-panel').forEach(p => p.classList.remove('active'));
    const b = document.querySelector('.add-tab[data-ptab="' + panelId + '"]'); if (b) b.classList.add('active');
    const p = document.getElementById(panelId); if (p) p.classList.add('active');
}

// PASO 1 → PASO 2: se seleccionó el tipo, se muestra el formulario con sus pestañas.
function beginAddForm() {
    const sel = document.getElementById('productTrackingType');
    if (sel) {
        const active = document.querySelector('#addTypeCards .inv-type-card.active');
        if (active) sel.value = active.dataset.type;
    }
    const typeScreen = document.getElementById('addTypeScreen');
    const formArea = document.getElementById('addFormArea');
    if (typeScreen) typeScreen.style.display = 'none';
    if (formArea) formArea.style.display = '';
    syncAddTabs();
    updateAddTrackingUI();
    switchAddTab('ptab1');
    // El buscador de componentes (compSearchInput) ya está listo; sin select previo.
    const nameEl = document.getElementById('productNameInput');
    setTimeout(() => { if (nameEl) nameEl.focus(); }, 100);
}

/* ===== Selector de modo de consumo (3 botones resaltables, sin select) ===== */
function consumeModeGet(groupId) {
    const g = document.getElementById(groupId);
    return g ? (g.dataset.value || 'fifo') : 'fifo';
}
function consumeModeSet(groupId, value) {
    const g = document.getElementById(groupId);
    if (!g) return;
    g.dataset.value = value;
    g.querySelectorAll('.consume-opt').forEach(b => b.classList.toggle('active', b.dataset.value === value));
    const hint = g.querySelector('.consume-hint');
    if (hint) {
        const d = {
            'fifo': 'Primero se consume la presentación más antigua.',
            'lifo': 'Primero se consume la presentación más reciente.',
            'manual': 'En cada venta eliges qué presentación usar.'
        }[value];
        if (d) hint.textContent = d;
    }
}

/* ===== Presentaciones (componente) en el ALTA ===== */
let addPresentationDraft = [];
function addAddPresentation() {
    const label = document.getElementById('addPresentLabel')?.value.trim();
    const qty = parseFloat(document.getElementById('addPresentQty')?.value);
    const totalCost = parseFloat(document.getElementById('addPresentCost')?.value);
    if (!label) { showNotification('Indica la presentación (ej. Bolsa 1 kg)', 'error'); return; }
    if (isNaN(qty) || qty <= 0) { showNotification('Cantidad válida requerida', 'error'); return; }
    addPresentationDraft.push({
        label: label,
        quantity: qty,
        total_cost: isNaN(totalCost) ? 0 : totalCost
    });
    renderAddPresentations();
    const l = document.getElementById('addPresentLabel'); if (l) l.value = '';
    const q = document.getElementById('addPresentQty'); if (q) q.value = '1';
    const c = document.getElementById('addPresentCost'); if (c) c.value = '';
}
function renderAddPresentations() {
    const list = document.getElementById('addPresentationsList');
    if (!list) return;
    const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    let total = 0, weighted = 0;
    list.innerHTML = addPresentationDraft.map((p, i) => {
        const uc = p.quantity > 0 ? p.total_cost / p.quantity : 0;
        total += p.quantity; weighted += p.quantity * uc;
        return '<div class="comp-row present-row">' +
            '<span class="present-label">' + esc(p.label) + '</span>' +
            '<span class="present-qty">' + NUM(p.quantity) + '</span>' +
            '<span class="present-cost">$' + uc.toFixed(2) + '/u</span>' +
            '<button type="button" class="comp-remove" data-idx="' + i + '" title="Quitar"><i class="fas fa-trash"></i></button>' +
            '</div>';
    }).join('') || '<div class="form-hint">Aún no has añadido presentaciones.</div>';
    list.querySelectorAll('.comp-remove').forEach(b => b.addEventListener('click', () => {
        addPresentationDraft.splice(parseInt(b.dataset.idx, 10), 1);
        renderAddPresentations();
    }));
    const t = document.getElementById('addPresentTotal'); if (t) t.textContent = NUM(total);
    const cp = document.getElementById('addPresentCostPond');
    if (cp) cp.textContent = window.FormatUtils ? window.FormatUtils.currency(weighted / (total || 1)) : '$' + (total > 0 ? (weighted / total).toFixed(2) : '0.00');
}

/* ===== Presentaciones (componente) en la EDICIÓN ===== */
async function loadEditPresentations() {
    const pid = currentEditingProduct;
    const list = document.getElementById('editPresentationsList');
    if (!pid || !list) return;
    try {
        const res = await fetch('../api/inventory/lots.php?product_id=' + pid);
        const data = await res.json();
        const lots = (data.success && data.data && data.data.lots) ? data.data.lots : [];
        const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        list.innerHTML = lots.map((l, i) => {
            return '<div class="comp-row present-row">' +
                '<span class="present-label">' + esc(l.label || ('Presentación ' + (i + 1))) + '</span>' +
                '<span class="present-qty">' + NUM(l.quantity) + '</span>' +
                '<span class="present-cost">$' + (parseFloat(l.unit_cost) || 0).toFixed(2) + '/u</span>' +
                '<button type="button" class="comp-remove" data-lot="' + l.lot_id + '" title="Eliminar"><i class="fas fa-trash"></i></button>' +
                '</div>';
        }).join('') || '<div class="form-hint">Sin presentaciones registradas.</div>';
        list.querySelectorAll('.comp-remove').forEach(b => b.addEventListener('click', async () => {
            if (!confirm('¿Eliminar esta presentación?')) return;
            await fetch('../api/inventory/lots.php', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lot_id: parseInt(b.dataset.lot, 10) })
            });
            loadEditPresentations();
        }));
        const t = document.getElementById('editPresentTotal'); if (t) t.textContent = NUM(data.data ? data.data.total : 0);
        const cp = document.getElementById('editPresentCostPond');
        if (cp) cp.textContent = window.FormatUtils ? window.FormatUtils.currency(data.data.unit_cost || 0) : '$' + (data.data.unit_cost || 0).toFixed(2);
    } catch (err) {
        console.error('Error cargando presentaciones:', err);
    }
}
async function addEditPresentation() {
    const pid = currentEditingProduct;
    const label = document.getElementById('editPresentLabel')?.value.trim();
    const qty = parseFloat(document.getElementById('editPresentQty')?.value);
    const totalCost = parseFloat(document.getElementById('editPresentCost')?.value);
    if (!pid) return;
    if (!label) { showNotification('Indica la presentación', 'error'); return; }
    if (isNaN(qty) || qty <= 0) { showNotification('Cantidad válida requerida', 'error'); return; }
    await fetch('../api/inventory/lots.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: pid, label: label, quantity: qty, total_cost: isNaN(totalCost) ? 0 : totalCost })
    });
    const l = document.getElementById('editPresentLabel'); if (l) l.value = '';
    const q = document.getElementById('editPresentQty'); if (q) q.value = '1';
    const c = document.getElementById('editPresentCost'); if (c) c.value = '';
    loadEditPresentations();
}

/* ===== Alta exprés de componente en el editor de composición ===== */
function toggleExpressComp(target) {
    const form = document.getElementById(target + 'ExpressCompForm');
    if (form) form.style.display = (form.style.display === 'none' || !form.style.display) ? 'grid' : 'none';
}
function expressCreateComponent(target) {
    if (target !== 'add') return; // Solo para alta nueva
    const name = (document.getElementById('addExpressName')?.value || '').trim();
    const cost = parseFloat(document.getElementById('addExpressCost')?.value) || 0;
    const stock = parseFloat(document.getElementById('addExpressStock')?.value) || 0;
    if (!name) { showNotification('Indica el nombre del componente', 'error'); return; }

    // Recopilar presentaciones del formulario exprés (legacy)
    const presentations = [];
    const presRows = document.querySelectorAll('#addExpressCompForm .comp-present-row');
    presRows.forEach(row => {
        const label = (row.querySelector('.present-label')?.value || '').trim();
        const qty = parseFloat(row.querySelector('.present-qty')?.value) || 0;
        const total = parseFloat(row.querySelector('.present-cost')?.value) || 0;
        if (label || qty || total) {
            presentations.push({ label, quantity: qty, total_cost: total });
        }
    });

    // Staged: se crea solo cuando el usuario guarda el producto
    const stagedId = 'staged_' + Date.now();
    addStagedComponents.push({
        staged_id: stagedId,
        product_name: name,
        cost: cost,
        stock: stock,
        presentations: presentations
    });
    // Añadir a la receta
    addCompositionDraft.push({
        component_id: stagedId,
        name: name,
        quantity: 1,
        unit_cost: cost,
        is_staged: true
    });
    renderAddComposition();
    const form = document.getElementById('addExpressCompForm');
    if (form) { form.style.display = 'none'; form.querySelectorAll('input').forEach(i => i.value = ''); }
    showNotification('Componente "' + name + '" añadido a la receta (se creará al guardar)', 'info');
}

/* ===== Inline component creation (from search no-results) ===== */
let inlinePresentationsDraft = []; // Presentaciones temporales del formulario inline

function renderStagedPresentations() {
    const container = document.getElementById('inlineCompPresentations');
    if (!container) return;
    if (!inlinePresentationsDraft.length) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = inlinePresentationsDraft.map((pres, idx) =>
        '<div class="comp-present-row" data-idx="' + idx + '">' +
            '<input type="text" class="comp-present-input present-label" placeholder="Etiqueta (ej. Bolsa 1kg)" value="' + escapeHtml(pres.label || '') + '">' +
            '<input type="number" class="comp-present-input present-qty" placeholder="Cantidad" min="0.001" step="0.001" value="' + (pres.quantity || '') + '">' +
            '<input type="number" class="comp-present-input present-cost" placeholder="Costo total ($)" min="0" step="0.01" value="' + (pres.total_cost || '') + '">' +
            '<button type="button" class="comp-present-remove" data-idx="' + idx + '" title="Quitar presentación"><i class="fas fa-times"></i></button>' +
        '</div>'
    ).join('');
}

function addInlinePresentation() {
    inlinePresentationsDraft.push({ label: '', quantity: '', total_cost: '' });
    renderStagedPresentations();
    // Focus the last label input
    const container = document.getElementById('inlineCompPresentations');
    if (container) {
        const lastRow = container.querySelector('.comp-present-row:last-child .present-label');
        if (lastRow) lastRow.focus();
    }
}

function removeInlinePresentation(idx) {
    inlinePresentationsDraft.splice(idx, 1);
    renderStagedPresentations();
}

function inlineCreateComponent() {
    const name = (document.getElementById('inlineCompName')?.value || '').trim();
    const cost = parseFloat(document.getElementById('inlineCompCost')?.value) || 0;
    if (!name) { showNotification('Indica el nombre del componente', 'error'); return; }

    // Recopilar presentaciones del formulario inline
    const presentations = [];
    const container = document.getElementById('inlineCompPresentations');
    if (container) {
        container.querySelectorAll('.comp-present-row').forEach(row => {
            const label = (row.querySelector('.present-label')?.value || '').trim();
            const qty = parseFloat(row.querySelector('.present-qty')?.value) || 0;
            const total = parseFloat(row.querySelector('.present-cost')?.value) || 0;
            if (label || qty || total) {
                presentations.push({ label, quantity: qty, total_cost: total });
            }
        });
    }

    // Staged: se crea solo cuando el usuario guarda el producto
    const stagedId = 'staged_' + Date.now();
    addStagedComponents.push({
        staged_id: stagedId,
        product_name: name,
        cost: cost,
        stock: 0,
        presentations: presentations
    });
    // Añadir a la receta
    addCompositionDraft.push({
        component_id: stagedId,
        name: name,
        quantity: 1,
        unit_cost: cost,
        is_staged: true
    });

    // Limpiar formulario inline
    inlinePresentationsDraft = [];
    renderStagedPresentations();
    const nameInput = document.getElementById('inlineCompName');
    const costInput = document.getElementById('inlineCompCost');
    if (nameInput) nameInput.value = '';
    if (costInput) costInput.value = '';

    renderAddComposition();
    filterCompSearch();
    showNotification('Componente "' + name + '" añadido a la receta (se creará al guardar)', 'info');
}

function openRecipePanel(load) {
    const panel = document.getElementById('recipePanel');
    if (!panel) return;
    panel.classList.remove('hidden');
    const btn = document.getElementById('editRecipeBtn');
    if (btn) btn.classList.add('active');
    if (load !== false) loadRecipeEditor();
}

function closeRecipePanel() {
    const panel = document.getElementById('recipePanel');
    if (panel) panel.classList.add('hidden');
    const btn = document.getElementById('editRecipeBtn');
    if (btn) btn.classList.remove('active');
}

function toggleRecipeEditor() {
    const panel = document.getElementById('recipePanel');
    if (panel && !panel.classList.contains('hidden')) {
        closeRecipePanel();
    } else {
        openRecipePanel();
    }
}

async function loadRecipeEditor() {
    const pid = currentEditingProduct;
    if (!pid) return;
    recipeEditingProductId = pid;
    const status = document.getElementById('recipeStatus');
    if (status) {
        status.textContent = 'Cargando composición...';
        status.className = 'status-badge status-analyzing';
    }
    try {
        const res = await fetch(`../api/inventory/recipe.php?product_id=${pid}`);
        const data = await res.json();
        if (data.success && data.data) {
            recipeEditingIngredients = (data.data.ingredients || []).map(i => ({
                component_id: i.component_id,
                name: i.name || ('Componente ' + i.component_id),
                quantity: NUM(i.quantity),
                unit_cost: NUM(i.unit_cost)
            }));
            const productData = data.data.product || {};
            updateRecipeSummary((productData.available != null) ? productData.available : (data.data.available != null ? data.data.available : null));
            if (status) {
                status.textContent = 'Composición cargada';
                status.className = 'status-badge status-success';
            }
        } else {
            recipeEditingIngredients = [];
            updateRecipeSummary(null);
            if (status) {
                status.textContent = data.message || 'Sin composición definida';
                status.className = 'status-badge status-waiting';
            }
        }
    } catch (e) {
        console.error('Error cargando composición:', e);
        if (status) {
            status.textContent = 'Error al cargar composición';
            status.className = 'status-badge status-error';
        }
    }
    renderRecipeIngredients();
}

function updateRecipeSummary(available) {
    const availEl = document.getElementById('recipeAvailableDisplay');
    if (availEl) availEl.textContent = (available != null) ? (window.FormatUtils ? window.FormatUtils.qty(available) : available) : '—';
    updateEditCompositionCost();
}

// Recalcula el costo de producción (Σ cantidad × costo unit) del editor de edición.
function updateEditCompositionCost() {
    const list = document.getElementById('recipeIngredientsList');
    const totalEl = document.getElementById('recipeCostDisplay');
    let total = 0;
    recipeEditingIngredients.forEach(ing => {
        const qty = NUM(ing.quantity);
        const sub = qty * NUM(ing.unit_cost);
        total += sub;
        if (list) {
            const subEl = list.querySelector(`.comp-subtotal[data-component-id="${ing.component_id}"]`);
            if (subEl) subEl.textContent = fmtMoney(sub);
        }
    });
    if (totalEl) totalEl.textContent = fmtMoney(total);
    return total;
}

function renderRecipeIngredients() {
    const list = document.getElementById('recipeIngredientsList');
    if (!list) return;
    if (!recipeEditingIngredients.length) {
        list.innerHTML = '<div class="recipe-empty">Sin componentes. Añade uno debajo.</div>';
    } else {
        const rows = recipeEditingIngredients.map(ing => `
            <div class="comp-row" data-component-id="${ing.component_id}">
                <span class="comp-name">${escapeHtml(ing.name)}</span>
                <input type="number" class="comp-qty recipe-ing-qty" data-component-id="${ing.component_id}" value="${NUM(ing.quantity)}" min="0" step="0.001" inputmode="decimal" title="Cantidad">
                <span class="comp-unit-cost" data-component-id="${ing.component_id}">${fmtMoney(ing.unit_cost)}</span>
                <span class="comp-subtotal" data-component-id="${ing.component_id}">${fmtMoney(NUM(ing.quantity) * NUM(ing.unit_cost))}</span>
                <button type="button" class="recipe-ing-remove" data-component-id="${ing.component_id}" title="Quitar componente">
                    <i class="fas fa-times"></i>
                </button>
            </div>`).join('');
        // Cabecera de columnas + filas
        list.innerHTML = `
            <div class="comp-head">
                <span>Componente</span><span>Cantidad</span><span>Costo unit</span><span>Subtotal</span><span></span>
            </div>
            ${rows}`;
    }
    updateEditCompositionCost();
    populateRecipeAddSelect();
}

function populateRecipeAddSelect() {
    const addSelect = document.getElementById('recipeIngredientSelect');
    if (!addSelect) return;
    const pid = String(recipeEditingProductId != null ? recipeEditingProductId : currentEditingProduct);
    const existing = new Set(recipeEditingIngredients.map(i => String(i.component_id)));
    const opts = products
        .filter(p => String(p.product_id) !== pid && !existing.has(String(p.product_id)))
        .map(p => `<option value="${p.product_id}">${escapeHtml(p.product_name)}</option>`)
        .join('');
    addSelect.innerHTML = '<option value="">Seleccionar componente...</option>' + opts;
}

function addRecipeIngredient() {
    const sel = document.getElementById('recipeIngredientSelect');
    const qtyInput = document.getElementById('recipeIngredientQty');
    if (!sel || !qtyInput) return;
    const id = sel.value;
    if (!id) {
        showNotification('Selecciona un componente', 'error');
        return;
    }
    if (recipeEditingIngredients.some(i => String(i.component_id) === String(id))) {
        showNotification('Ese componente ya está en la composición', 'error');
        return;
    }
    let qty = parseFloat(qtyInput.value);
    if (isNaN(qty) || qty <= 0) qty = 1;
    const prod = products.find(p => String(p.product_id) === String(id));
    recipeEditingIngredients.push({
        component_id: id,
        name: prod ? prod.product_name : ('Componente ' + id),
        quantity: qty,
        unit_cost: NUM(prod ? prod.cost : 0)
    });
    qtyInput.value = '';
    sel.value = '';
    renderRecipeIngredients();
}

function removeRecipeIngredient(componentId) {
    recipeEditingIngredients = recipeEditingIngredients.filter(i => String(i.component_id) !== String(componentId));
    renderRecipeIngredients();
}

async function saveRecipe() {
    const pid = currentEditingProduct;
    if (!pid) {
        showNotification('Selecciona un producto', 'error');
        return;
    }
    const ingredients = recipeEditingIngredients
        .map(i => ({ component_id: i.component_id, quantity: NUM(i.quantity) }))
        .filter(i => i.component_id && i.quantity > 0);

    const btn = document.getElementById('saveRecipeBtn');
    const status = document.getElementById('recipeStatus');
    if (btn) btn.disabled = true;
    if (status) {
        status.textContent = 'Guardando composición...';
        status.className = 'status-badge status-analyzing';
    }
    try {
        const res = await fetch('../api/inventory/recipe.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product_id: pid, ingredients })
        });
        const data = await res.json();
        if (data.success) {
            showNotification('Composición guardada', 'success');
            await loadRecipeEditor();
            loadProducts();
        } else {
            showNotification('Error: ' + (data.message || 'No se pudo guardar la composición'), 'error');
            if (status) {
                status.textContent = data.message || 'Error al guardar composición';
                status.className = 'status-badge status-error';
            }
        }
    } catch (e) {
        console.error('Error guardando composición:', e);
        showNotification('Error de conexión al guardar la composición', 'error');
        if (status) {
            status.textContent = 'Error de conexión';
            status.className = 'status-badge status-error';
        }
    } finally {
        if (btn) btn.disabled = false;
    }
}

/* ===== Editor de composición en el modal de ALTA ===== */
function productImgSrc(p) {
    const rel = (p && p.image_path) ? getRelativeImagePath(p.image_path) : '';
    return rel || '';
}

function renderAddComposition() {
    const list = document.getElementById('addCompositionList');
    if (!list) return;
    if (!addCompositionDraft.length) {
        list.innerHTML = '<div class="recipe-empty">Aún no hay componentes. Búscalos en el campo de arriba y selecciónalos.</div>';
    } else {
        list.innerHTML = addCompositionDraft.map(ing => {
            const prod = products.find(p => String(p.product_id) === String(ing.component_id)) || {};
            const img = productImgSrc(prod);
            const qty = NUM(ing.quantity);
            const sub = qty * NUM(ing.unit_cost);
            return '<div class="comp-pick-row" data-component-id="' + ing.component_id + '">' +
                '<span class="comp-pick-thumb">' + (img ? '<img src="' + img + '" alt="">' : '<i class="fas fa-box"></i>') + '</span>' +
                '<div class="comp-pick-info">' +
                    '<span class="comp-pick-name">' + escapeHtml(ing.name) + (ing.is_staged ? ' <small style="color:var(--info-color)">(nuevo)</small>' : '') + '</span>' +
                    '<span class="comp-pick-meta">' + fmtMoney(ing.unit_cost) + ' / unidad</span>' +
                '</div>' +
                '<div class="comp-qty-stepper">' +
                    '<button type="button" class="comp-qty-btn comp-qty-minus" data-component-id="' + ing.component_id + '" title="Menos"><i class="fas fa-minus"></i></button>' +
                    '<input type="number" class="comp-qty" data-component-id="' + ing.component_id + '" value="' + qty + '" min="0" step="0.001" inputmode="decimal">' +
                    '<button type="button" class="comp-qty-btn comp-qty-plus" data-component-id="' + ing.component_id + '" title="Más"><i class="fas fa-plus"></i></button>' +
                '</div>' +
                '<span class="comp-pick-subtotal" data-component-id="' + ing.component_id + '">' + fmtMoney(sub) + '</span>' +
                '<button type="button" class="recipe-ing-remove" data-component-id="' + ing.component_id + '" title="Quitar"><i class="fas fa-trash"></i></button>' +
            '</div>';
        }).join('');
    }
    updateAddCompositionCost();
}

// Lista de resultados de la búsqueda de componentes (imagen, nombre, precio).
function filterCompSearch() {
    const input = document.getElementById('compSearchInput');
    const box = document.getElementById('compSearchResults');
    const availList = document.getElementById('compAvailableList');
    const inlineForm = document.getElementById('compCreateInline');
    if (!input) return;
    const q = (input.value || '').trim().toLowerCase();
    const existing = new Set(addCompositionDraft.map(i => String(i.component_id)));

    // Filtrar componentes del sistema
    const components = products.filter(p => p.tracking_type === 'component' || p.is_ingredient == 1);
    const matches = q
        ? components.filter(p => String(p.product_name || '').toLowerCase().includes(q))
        : components;

    // Mostrar formulario inline solo cuando se busca y no hay resultados
    const noResults = q && !matches.length;
    if (inlineForm) {
        inlineForm.style.display = noResults ? 'block' : 'none';
        if (noResults) {
            // Pre-llenar el nombre del componente con la búsqueda
            const nameInput = document.getElementById('inlineCompName');
            if (nameInput && !nameInput.value) nameInput.value = input.value.trim();
        }
    }

    // Renderizar en el panel izquierdo
    if (availList) {
        if (!matches.length) {
            availList.innerHTML = noResults ? '' : '<div class="recipe-empty">No se encontraron componentes.</div>';
        } else {
            availList.innerHTML = matches.map(p => {
                const inRecipe = existing.has(String(p.product_id));
                return '<div class="comp-available-item ' + (inRecipe ? 'in-recipe' : '') + '" data-pid="' + p.product_id + '">' +
                    '<span class="comp-avail-name">' + escapeHtml(p.product_name) + '</span>' +
                    '<span class="comp-avail-cost">' + fmtMoney(p.cost) + '/u</span>' +
                    (inRecipe
                        ? '<span class="comp-avail-add" title="Ya está en la receta"><i class="fas fa-check"></i></span>'
                        : '<button type="button" class="comp-avail-add" title="Añadir a la receta" onclick="addComponentFromPicker(' + p.product_id + ')"><i class="fas fa-plus"></i></button>') +
                    '</div>';
            }).join('');
        }
    }

    // Mantener el dropdown de resultados existente para compatibilidad
    if (box) {
        if (!q) { box.style.display = 'none'; box.innerHTML = ''; return; }
        const searchMatches = components
            .filter(p => !existing.has(String(p.product_id)) && String(p.product_name || '').toLowerCase().includes(q))
            .slice(0, 12);
        if (!searchMatches.length) {
            box.style.display = 'none'; // El formulario inline reemplaza este mensaje
            return;
        }
        box.innerHTML = searchMatches.map(p => {
            const img = productImgSrc(p);
            return '<button type="button" class="comp-search-item" data-pid="' + p.product_id + '">' +
                '<span class="comp-search-thumb">' + (img ? '<img src="' + img + '" alt="">' : '<i class="fas fa-box"></i>') + '</span>' +
                '<span class="comp-search-name">' + escapeHtml(p.product_name) + '</span>' +
                '<span class="comp-search-price">' + fmtMoney(p.cost) + '</span>' +
                '</button>';
        }).join('');
        box.style.display = 'block';
    }
}

// Al seleccionar un resultado se añade el componente a la receta al momento (qty = 1).
function addComponentFromPicker(pid) {
    const prod = products.find(p => String(p.product_id) === String(pid));
    if (!prod) return;
    if (addCompositionDraft.some(i => String(i.component_id) === String(pid))) {
        showNotification('Ese componente ya está en la receta', 'info');
    } else {
        addCompositionDraft.push({
            component_id: String(pid),
            name: prod.product_name || ('Componente ' + pid),
            quantity: 1,
            unit_cost: NUM(prod.cost)
        });
        renderAddComposition();
        filterCompSearch(); // Actualizar panel izquierdo
    }
    const input = document.getElementById('compSearchInput');
    const box = document.getElementById('compSearchResults');
    if (input) input.value = '';
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
}

// Evalúa expresiones matemáticas simples en inputs de cantidad (ej: "1/8", "2*3", "100/12")
function evalMathExpression(input) {
    const raw = (input.value || '').trim();
    if (!raw) return;
    // Si es solo número, dejarlo
    if (/^-?\d+(\.\d+)?$/.test(raw)) return;
    // Evaluar expresión: soporta +, -, *, / y paréntesis
    if (/^[\d\s+\-*/().]+$/.test(raw)) {
        try {
            const result = Function('"use strict"; return (' + raw + ')')();
            if (typeof result === 'number' && isFinite(result) && result >= 0) {
                const rounded = Math.round(result * 1000) / 1000;
                input.value = rounded;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                input.value = 0;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        } catch (e) {
            input.value = 0;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }
}

// Ajusta la cantidad de un componente con los pasos + / -.
function bumpCompQty(componentId, delta) {
    const ing = addCompositionDraft.find(i => String(i.component_id) === String(componentId));
    if (!ing) return;
    let v = NUM(ing.quantity) + delta;
    if (v < 0) v = 0;
    ing.quantity = Math.round(v * 100) / 100; // Redondear a 2 decimales
    renderAddComposition();
    filterCompSearch(); // Actualizar panel izquierdo
}

function removeAddComposition(componentId) {
    addCompositionDraft = addCompositionDraft.filter(i => String(i.component_id) !== String(componentId));
    addStagedComponents = addStagedComponents.filter(i => i.staged_id !== componentId);
    // Also clean up inline presentations draft if this was an inline-created component
    const removedStaged = addStagedComponents.length; // Check if a staged was removed
    renderAddComposition();
    filterCompSearch(); // Actualizar panel izquierdo
}

// Recalcula el costo de producción en vivo del editor de alta.
function updateAddCompositionCost() {
    const list = document.getElementById('addCompositionList');
    const totalEl = document.getElementById('addCompositionCostTotal');
    let total = 0;
    addCompositionDraft.forEach(ing => {
        const qty = NUM(ing.quantity);
        const sub = qty * NUM(ing.unit_cost);
        total += sub;
        if (list) {
            const subEl = list.querySelector(`.comp-pick-subtotal[data-component-id="${ing.component_id}"]`);
            if (subEl) subEl.textContent = fmtMoney(sub);
        }
    });
    if (totalEl) totalEl.textContent = fmtMoney(total);
    return total;
}

function resetAddComposition() {
    addCompositionDraft = [];
    addStagedComponents = [];
    addCompositionProductId = null;
    const totalEl = document.getElementById('addCompositionCostTotal');
    if (totalEl) totalEl.textContent = '—';
    const list = document.getElementById('addCompositionList');
    if (list) list.innerHTML = '<div class="recipe-empty">Aún no hay componentes. Búscalos en el campo de arriba y selecciónalos.</div>';
    const searchInput = document.getElementById('compSearchInput');
    if (searchInput) searchInput.value = '';
    const results = document.getElementById('compSearchResults');
    if (results) { results.innerHTML = ''; results.style.display = 'none'; }
    // La visibilidad del panel de composición la controla su pestaña, no aquí.
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
    document.getElementById('editProductSku').value = product.sku || '';
    document.getElementById('editProductBarcode').value = product.barcode || '';
    document.getElementById('editProductQR').value = product.qr_code || '';
    document.getElementById('editProductCost').value = product.cost || 0;
    document.getElementById('editProductPrice').value = product.price;
    document.getElementById('editProductStock').value = product.current_stock || 0;
    document.getElementById('editProductMinStock').value = product.min_stock || 0;
    
    // Campos de venta a granel
    const isBulkCheckbox = document.getElementById('editProductIsBulk');
    const bulkUnitSelect = document.getElementById('editProductBulkUnit');
    const bulkUnitGroup = document.getElementById('bulkUnitGroup');
    
    if (isBulkCheckbox) {
        isBulkCheckbox.checked = product.is_bulk == 1;
        if (bulkUnitGroup) {
            bulkUnitGroup.style.display = product.is_bulk == 1 ? 'block' : 'none';
        }
    }
    if (bulkUnitSelect) {
        bulkUnitSelect.value = product.bulk_unit || 'kg';
    }

    // Campos de tipo de inventario (receta / lotes / ingrediente)
    const trackingSelect = document.getElementById('editProductTrackingType');
    const isIngredientCheckbox = document.getElementById('editProductIsIngredient');
    const piecesPerBoxInput = document.getElementById('editProductPiecesPerBox');
    const costPerBoxInput = document.getElementById('editProductCostPerBox');
    if (trackingSelect) trackingSelect.value = product.tracking_type || 'stock';
    consumeModeSet('editConsumeModeGroup', product.consume_mode || 'fifo');
    if (isIngredientCheckbox) isIngredientCheckbox.checked = product.is_ingredient == 1;
    if (piecesPerBoxInput) piecesPerBoxInput.value = product.pieces_per_box != null ? product.pieces_per_box : '';
    if (costPerBoxInput) costPerBoxInput.value = product.cost_per_box != null ? product.cost_per_box : '';
    updateEditTrackingUI();

    // Imagen
    const img = document.getElementById('detailImage');
    const imagePath = getRelativeImagePath(product.image_path);
    if (imagePath) {
        img.src = imagePath;
        img.style.display = 'block';
    } else {
        img.src = ''; // O una imagen placeholder
        img.style.display = 'none';
    }

    // Calcular ganancia inicial
    updateProfitDisplay(parseFloat(product.price) || 0, parseFloat(product.cost) || 0);

    // Visibilidad y estado de retirado
    const hiddenInPosCheckbox = document.getElementById('editHiddenInPos');
    const archiveBtn = document.getElementById('archiveProductBtn');
    const restoreBtn = document.getElementById('restoreProductBtn');
    const isRetired = !!product.discontinued_at;

    if (hiddenInPosCheckbox) {
        hiddenInPosCheckbox.checked = product.hidden_in_pos == 1 || isRetired;
    }
    if (archiveBtn) {
        archiveBtn.style.display = isRetired ? 'none' : 'inline-flex';
    }
    if (restoreBtn) {
        restoreBtn.style.display = isRetired ? 'inline-flex' : 'none';
    }

    // Mostrar modal
    const modal = document.getElementById('productDetailsModal');
    if (modal) modal.classList.add('show');
}

function closeProductDetails() {
    const modal = document.getElementById('productDetailsModal');
    if (modal) modal.classList.remove('show');
    currentEditingProduct = null;
    recipeEditingIngredients = [];
    recipeEditingProductId = null;
    // Cerrar panel de receta
    const recipePanelReset = document.getElementById('recipePanel');
    if (recipePanelReset) recipePanelReset.classList.add('hidden');
    const recipeBtnReset = document.getElementById('editRecipeBtn');
    if (recipeBtnReset) recipeBtnReset.classList.remove('active');
    // Limpiar formulario
    document.getElementById('editProductForm')?.reset();
    // Reset a primera pestaña
    document.querySelectorAll('.drawer-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    const firstTab = document.querySelector('.drawer-tab');
    const firstPanel = document.getElementById(firstTab?.dataset?.tab);
    if (firstTab) firstTab.classList.add('active');
    if (firstPanel) firstPanel.classList.add('active');
}

async function archiveProduct() {
    if (!currentEditingProduct) return;
    const ok = confirm('¿Retirar este producto? Se marcará como descontinuado y no aparecerá en el Punto de Venta. El historial e inventario se mantienen intactos.');
    if (!ok) return;
    try {
        const res = await fetch('../api/inventory/products.php', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ product_id: currentEditingProduct, archive: true })
        });
        const data = await res.json();
        if (data.success) {
            closeProductDetails();
            loadProducts();
        } else {
            alert('Error: ' + (data.message || 'No se pudo retirar'));
        }
    } catch (e) {
        console.error('Error archivando producto:', e);
        alert('Error de red al intentar retirar producto');
    }
}

async function restoreProduct() {
    if (!currentEditingProduct) return;
    const ok = confirm('¿Restaurar este producto? Volverá a estar disponible en el Punto de Venta.');
    if (!ok) return;
    try {
        const res = await fetch('../api/inventory/products.php', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ product_id: currentEditingProduct, restore: true, hidden_in_pos: 0 })
        });
        const data = await res.json();
        if (data.success) {
            closeProductDetails();
            loadProducts();
        } else {
            alert('Error: ' + (data.message || 'No se pudo restaurar'));
        }
    } catch (e) {
        console.error('Error restaurando producto:', e);
        alert('Error de red al intentar restaurar producto');
    }
}

function updateProfitDisplay(price, cost) {
    // Asegurar que sean números
    price = parseFloat(price) || 0;
    cost = parseFloat(cost) || 0;

    const profit = price - cost;
    const margin = price > 0 ? (profit / price) * 100 : 0;

    const profitEl = document.getElementById('detailProfitDisplay');

    document.getElementById('detailPriceDisplay').textContent = window.FormatUtils ? window.FormatUtils.currency(price) : '$' + price.toFixed(2);
    document.getElementById('detailCostDisplay').textContent = window.FormatUtils ? window.FormatUtils.currency(cost) : '$' + cost.toFixed(2);

    profitEl.textContent = window.FormatUtils ? window.FormatUtils.currency(profit) : '$' + profit.toFixed(2);
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
        min_stock: parseInt(formData.get('min_stock')),
        is_bulk: document.getElementById('editProductIsBulk')?.checked ? 1 : 0,
        bulk_unit: formData.get('bulk_unit') || 'kg',
        tracking_type: document.getElementById('editProductTrackingType')?.value,
        is_ingredient: (document.getElementById('editProductTrackingType')?.value === 'component') ? 1 : 0,
        consume_mode: consumeModeGet('editConsumeModeGroup'),
        pieces_per_box: parseFloat(document.getElementById('editProductPiecesPerBox')?.value) || null,
        cost_per_box: parseFloat(document.getElementById('editProductCostPerBox')?.value) || null,
        hidden_in_pos: document.getElementById('editHiddenInPos')?.checked ? 1 : 0
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
                showNotification('Producto y stock actualizados', 'success');
            }
        } else {
            showNotification('Cambios guardados', 'success');
        }

        closeProductDetails();
        loadProducts();

    } catch (error) {
        console.error('Error:', error);
        showNotification('Error: ' + error.message, 'error');
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
                showNotification('Imagen actualizada', 'success');
                // Actualizar vista previa en modal
                const img = document.getElementById('detailImage');
                img.src = e.target.result;
                img.style.display = 'block';
                // Recargar lista de fondo
                loadProducts();
            } else {
                showNotification('Error al subir imagen', 'error');
            }
        } catch (error) {
            console.error('Error:', error);
            showNotification('Error de conexión', 'error');
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
            showNotification('Stock actualizado', 'success');
            // Actualizar el producto en el array local
            const product = products.find(p => p.product_id == productId);
            if (product) product.current_stock = newStock;
        } else {
            showNotification('Error: ' + (data.message || 'No se pudo actualizar stock'), 'error');
            const product = products.find(p => p.product_id == productId);
            if (product) input.value = product.current_stock || 0;
        }
    } catch (error) {
        console.error('Error:', error);
        showNotification('Error al actualizar stock', 'error');
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
        list.innerHTML = '<li style="padding: 10px; text-align: center; color: var(--text-muted);">No hay categorías registradas</li>';
        return;
    }
    
    list.innerHTML = categories.map(cat => `
        <li style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid var(--border-color); gap: 15px;">
            <div style="display: flex; align-items: center; gap: 15px; flex: 1;">
                <div style="width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: var(--bg-light); border-radius: 8px; color: var(--primary-color); flex-shrink: 0;">
                    <i class="fas ${cat.icon_class || 'fa-tag'}" style="font-size: 1.2rem;"></i>
                </div>
                <div style="font-weight: 600; font-size: 1rem;">${escapeHtml(cat.category_name)}</div>
            </div>
            <div class="actions-container" style="display: flex; align-items: center;">
                <button type="button" id="btn-del-${cat.category_id}" class="btn-danger" style="padding: 6px 10px; font-size: 0.9em;" onclick="showDeleteConfirm(${cat.category_id})" title="Eliminar categoría">
                    <i class="fas fa-trash"></i>
                </button>
                <div id="confirm-del-${cat.category_id}" style="display: none; gap: 5px; align-items: center;">
                    <span style="font-size: 0.8em; color: var(--danger-color); margin-right: 5px;">¿Borrar?</span>
                    <button type="button" class="btn-danger" style="padding: 2px 6px; font-size: 0.8em; background: var(--danger-color);" onclick="executeDeleteCategory(${cat.category_id})" title="Sí, borrar">
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
                barcodeInput.style.backgroundColor = 'var(--primary-light)';
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
