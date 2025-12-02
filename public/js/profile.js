document.addEventListener('DOMContentLoaded', async () => {
    const session = await checkSession();
    if (!session) {
        window.location.href = 'login.html';
        return;
    }

    // Cargar datos del perfil
    loadProfile();

    // Si es admin, mostrar pestañas extra
    if (session.role === 'admin') {
        document.getElementById('companyTabBtn').style.display = 'inline-block';
        document.getElementById('usersTabBtn').style.display = 'inline-block';
        loadCompanySettings();
        loadUsers();
    }

    // Color picker sync & Real-time preview
    const themeControls = document.getElementById('themeControls');
    if (themeControls) {
        const inputs = themeControls.querySelectorAll('input[type="color"]');
        inputs.forEach(input => {
            const textInput = input.nextElementSibling;
            const cssVar = input.getAttribute('data-var');

            // Sync color -> text & preview
            input.addEventListener('input', (e) => {
                const val = e.target.value;
                textInput.value = val;
                if (cssVar) {
                    document.documentElement.style.setProperty(cssVar, val);
                }
            });

            // Sync text -> color & preview
            textInput.addEventListener('input', (e) => {
                const val = e.target.value;
                if (/^#[0-9A-F]{6}$/i.test(val)) {
                    input.value = val;
                    if (cssVar) {
                        document.documentElement.style.setProperty(cssVar, val);
                    }
                }
            });

            // Inicializar valor de texto si está vacío
            if (!textInput.value) {
                textInput.value = input.value;
            }
        });
    }

    // Logo upload
    const logoInput = document.getElementById('companyLogoInput');
    if (logoInput) {
        logoInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('logo', file);

            // try {
            const res = await fetch('../api/stores/upload_logo.php', {
                method: 'POST',
                body: formData
            });
            const result = await res.json();
            if (result.success) {
                document.getElementById('companyLogoPreview').src = result.data.logo_url;
                // Actualizar también el logo del navbar
                const navLogo = document.getElementById('navStoreLogo');
                if (navLogo) navLogo.src = result.data.logo_url;
                showNotification('Logo actualizado correctamente', 'success');
            } else {
                showNotification(result.message || 'Error al subir logo', 'error');
            }
            // } catch (error) {
            //     console.error(error);
            //     showNotification('Error de conexión al subir logo', 'error');
            // }
        });
    }

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', async (e) => {
        e.preventDefault();
        await logout();
    });

    // Excel Import
    // const btnImport = document.getElementById('btnImportExcel'); // Removed old button logic
    // if (btnImport) {
    //    btnImport.addEventListener('click', handleImportExcel);
    // }

    // Auto-open import modal on file selection
    const fileInput = document.getElementById('importExcelInput');
    if (fileInput) {
        fileInput.addEventListener('change', handleImportExcel);
    }

    // Close guide modal when clicking outside
    const guideModal = document.getElementById('importGuideModal');
    if (guideModal) {
        guideModal.addEventListener('click', (e) => {
            if (e.target === guideModal) {
                closeImportGuide();
            }
        });
    }
});

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

    document.getElementById(tabId).classList.add('active');
    // Encontrar el botón correspondiente (un poco hacky pero funciona)
    const btn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick').includes(tabId));
    if (btn) btn.classList.add('active');
}

async function loadProfile() {
    try {
        const res = await fetch('../api/users/profile.php');
        const data = await res.json();
        if (data.success) {
            const user = data.data;
            const form = document.getElementById('profileForm');
            form.full_name.value = user.full_name;
            form.email.value = user.email || '';
            form.phone.value = user.phone || '';
            document.getElementById('userRoleDisplay').value = user.role.toUpperCase();

            // Onboarding setting
            const onboardingCheck = document.getElementById('showOnboarding');
            if (onboardingCheck) {
                onboardingCheck.checked = user.show_onboarding !== undefined ? !!Number(user.show_onboarding) : true;
            }
        }
    } catch (error) {
        console.error('Error loading profile:', error);
    }
}

document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());

    // Handle checkbox explicitly
    data.show_onboarding = document.getElementById('showOnboarding').checked;

    try {
        const res = await fetch('../api/users/profile.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.success) {
            showNotification('Perfil actualizado correctamente', 'success');
            e.target.password.value = '';
            e.target.current_password.value = '';
        } else {
            showNotification(result.message || 'Error al actualizar', 'error');
        }
    } catch (error) {
        showNotification('Error de conexión', 'error');
    }
});

async function loadCompanySettings() {
    try {
        const res = await fetch('../api/stores/settings.php');
        const data = await res.json();
        if (data.success) {
            const store = data.data;
            const form = document.getElementById('companyForm');
            form.store_name.value = store.store_name;
            form.phone.value = store.phone || '';
            form.address.value = store.address || '';

            if (store.logo_url) {
                document.getElementById('companyLogoPreview').src = store.logo_url;
            }

            // Cargar configuración de negocio
            if (store.settings) {
                document.getElementById('allowNegativeStock').checked = !!store.settings.allow_negative_stock;
            }

            // Cargar configuración de tema
            if (store.theme_config) {
                const themeControls = document.getElementById('themeControls');
                const inputs = themeControls.querySelectorAll('input[type="color"]');

                inputs.forEach(input => {
                    const cssVar = input.getAttribute('data-var');
                    // Quitamos '--' para buscar en el objeto JSON (ej: primary-color)
                    // O asumimos que guardamos con el nombre de la variable completo o una clave mapeada.
                    // Vamos a usar el 'name' del input como clave en el JSON.
                    const key = input.name;

                    if (store.theme_config[key]) {
                        const color = store.theme_config[key];
                        input.value = color;
                        if (input.nextElementSibling) {
                            input.nextElementSibling.value = color;
                        }
                        // Aplicar al cargar (preview inicial)
                        if (cssVar) {
                            document.documentElement.style.setProperty(cssVar, color);
                        }
                    } else {
                        // Si no hay config guardada, poner el valor por defecto del input (que ya viene del HTML o CSS)
                        if (input.nextElementSibling) {
                            input.nextElementSibling.value = input.value;
                        }
                    }
                });
            }
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

document.getElementById('companyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);

    // Recolectar configuración de tema
    const themeConfig = {};
    const themeControls = document.getElementById('themeControls');
    const inputs = themeControls.querySelectorAll('input[type="color"]');
    inputs.forEach(input => {
        themeConfig[input.name] = input.value;
    });

    // Recolectar configuración de negocio
    const settings = {
        allow_negative_stock: document.getElementById('allowNegativeStock').checked
    };

    const data = {
        store_name: formData.get('store_name'),
        phone: formData.get('phone'),
        address: formData.get('address'),
        theme_config: themeConfig,
        settings: settings
    };

    try {
        const res = await fetch('../api/stores/settings.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.success) {
            showNotification('Configuración guardada', 'success');
            // Recargar para asegurar persistencia o simplemente dejarlo así ya que el preview ya lo aplicó
        } else {
            showNotification(result.message, 'error');
        }
    } catch (error) {
        showNotification('Error de conexión', 'error');
    }
});

async function loadUsers() {
    try {
        // Obtener store_id de la sesión actual (o del perfil cargado)
        // Como es admin, read.php sin params devuelve todos, pero queremos filtrar por store si el backend lo requiere
        // El backend de read.php usa session store_id si no es admin global.
        // Asumimos que el admin logueado es admin de SU tienda.
        const session = await checkSession();
        const res = await fetch(`../api/users/read.php?store_id=${session.store_id}`);
        const data = await res.json();

        if (data.success) {
            const tbody = document.getElementById('usersList');
            tbody.innerHTML = '';
            data.data.forEach(user => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td data-label="Usuario">${user.username}</td>
                    <td data-label="Nombre">${user.full_name}</td>
                    <td data-label="Email">${user.email || '-'}</td>
                    <td data-label="Rol"><span class="badge badge-${user.role}">${user.role}</span></td>
                    <td data-label="Estado"><span class="badge badge-${user.status === 'active' ? 'success' : 'danger'}">${user.status === 'active' ? 'Activo' : 'Inactivo'}</span></td>
                    <td data-label="Acciones">
                        ${user.role !== 'admin' ? 
                            (user.status === 'active' 
                                ? `<button class="btn-icon" onclick="confirmToggleUserStatus(${user.user_id}, 'inactive')" title="Desactivar"><i class="fas fa-trash"></i></button>`
                                : `<button class="btn-icon" onclick="confirmToggleUserStatus(${user.user_id}, 'active')" title="Activar" style="color: var(--success-color);"><i class="fas fa-check-circle"></i></button>`
                            ) 
                        : ''}
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

function showCreateUserModal() {
    document.getElementById('userModal').style.display = 'block';
}

function closeUserModal() {
    document.getElementById('userModal').style.display = 'none';
}

document.getElementById('createUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());

    // Necesitamos store_id
    const session = await checkSession();
    data.store_id = session.store_id;

    try {
        const res = await fetch('../api/users/create.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.success) {
            showNotification('Usuario creado', 'success');
            closeUserModal();
            e.target.reset();
            loadUsers();
        } else {
            showNotification(result.message || 'Error al crear usuario', 'error');
        }
    } catch (error) {
        showNotification('Error de conexión', 'error');
    }
});

let userToToggleId = null;
let newStatusToSet = null;

function confirmToggleUserStatus(userId, newStatus) {
    userToToggleId = userId;
    newStatusToSet = newStatus;
    
    const modal = document.getElementById('toggleUserStatusModal');
    const title = document.getElementById('toggleUserTitle');
    const msg = document.getElementById('toggleUserMsg');
    const iconContainer = document.getElementById('toggleUserIconContainer');
    const icon = document.getElementById('toggleUserIcon');
    const confirmBtn = document.getElementById('confirmToggleUserBtn');

    if (newStatus === 'inactive') {
        title.textContent = '¿Desactivar usuario?';
        msg.textContent = 'El usuario perderá acceso al sistema.';
        iconContainer.style.background = '#fee2e2';
        icon.className = 'fas fa-exclamation-triangle';
        icon.style.color = '#dc2626';
        confirmBtn.className = 'btn-danger';
        confirmBtn.textContent = 'Sí, desactivar';
    } else {
        title.textContent = '¿Activar usuario?';
        msg.textContent = 'El usuario recuperará acceso al sistema.';
        iconContainer.style.background = '#dcfce7';
        icon.className = 'fas fa-check-circle';
        icon.style.color = '#16a34a';
        confirmBtn.className = 'btn-save'; // o btn-primary
        confirmBtn.textContent = 'Sí, activar';
    }

    if (modal) modal.style.display = 'block';
}

function closeToggleUserStatusModal() {
    const modal = document.getElementById('toggleUserStatusModal');
    if (modal) modal.style.display = 'none';
    userToToggleId = null;
    newStatusToSet = null;
}

// Event listener para confirmar cambio de estado
const confirmToggleBtn = document.getElementById('confirmToggleUserBtn');
if (confirmToggleBtn) {
    confirmToggleBtn.addEventListener('click', async () => {
        if (!userToToggleId || !newStatusToSet) return;
        
        try {
            // Usamos update.php para cambiar el estado
            const res = await fetch('../api/users/update.php', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    user_id: userToToggleId,
                    status: newStatusToSet
                })
            });
            const result = await res.json();
            if (result.success) {
                loadUsers();
                showNotification(newStatusToSet === 'active' ? 'Usuario activado' : 'Usuario desactivado', 'success');
                closeToggleUserStatusModal();
            } else {
                showNotification(result.message || 'Error al cambiar estado', 'error');
            }
        } catch (error) {
            console.error(error);
            showNotification('Error de conexión', 'error');
        }
    });
}

// Cerrar modal al hacer clic fuera
const toggleUserStatusModal = document.getElementById('toggleUserStatusModal');
if (toggleUserStatusModal) {
    toggleUserStatusModal.addEventListener('click', (e) => {
        if (e.target === toggleUserStatusModal) closeToggleUserStatusModal();
    });
}

// Funciones para el Asistente de Importación
function openImportGuide() {
    document.getElementById('importGuideModal').style.display = 'block';
}

function closeImportGuide() {
    document.getElementById('importGuideModal').style.display = 'none';
}

function triggerFileInput() {
    document.getElementById('importExcelInput').click();
}

let importedData = [];
let excelHeaders = [];

async function handleImportExcel() {
    // Cerrar la guía si está abierta
    closeImportGuide();

    const fileInput = document.getElementById('importExcelInput');
    const statusDiv = document.getElementById('importStatus');

    if (!fileInput.files || fileInput.files.length === 0) {
        showNotification('Por favor selecciona un archivo Excel', 'error');
        return;
    }

    const file = fileInput.files[0];
    // Mostrar estado en el modal de guía si está visible, o en el panel principal
    const guideStatus = document.getElementById('guideStatus');
    if (guideStatus && document.getElementById('importGuideModal').style.display === 'block') {
        guideStatus.innerHTML = '<span style="color: blue;">Leyendo archivo...</span>';
    } else {
        statusDiv.innerHTML = '<span style="color: blue;">Leyendo archivo...</span>';
    }

    const reader = new FileReader();

    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];

            // Convertir a JSON (array de arrays)
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            if (jsonData.length < 2) {
                showNotification('El archivo parece estar vacío o sin datos.', 'error');
                return;
            }

            // Guardar headers y datos
            excelHeaders = jsonData[0].map(h => String(h).trim());
            importedData = jsonData.slice(1); // Remove header row

            // Abrir modal y configurar mapeo
            setupImportModal();
            statusDiv.innerHTML = ''; // Clear status
            if (guideStatus) guideStatus.innerHTML = '';

        } catch (error) {
            console.error(error);
            showNotification('Error al procesar el archivo.', 'error');
        }
    };

    reader.readAsArrayBuffer(file);
}

function setupImportModal() {
    const modal = document.getElementById('importModal');
    const selects = document.querySelectorAll('.column-select');

    // Llenar selects con headers del Excel
    selects.forEach(select => {
        select.innerHTML = '<option value="-1">-- Ignorar --</option>';
        excelHeaders.forEach((header, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = header;
            select.appendChild(option);
        });

        // Auto-detectar
        const field = select.id.replace('map_', '');
        const headerIndex = detectColumn(field, excelHeaders);
        if (headerIndex !== -1) {
            select.value = headerIndex;
        }

        // Event listener para actualizar preview
        select.onchange = updateImportPreview;
    });

    modal.style.display = 'block';
    updateImportPreview();
}

function detectColumn(field, headers) {
    const lowerHeaders = headers.map(h => h.toLowerCase());
    let index = -1;

    if (field === 'name') {
        index = lowerHeaders.findIndex(h => h.includes('nombre') || h.includes('producto') || h.includes('name') || h.includes('descrip'));
    } else if (field === 'barcode') {
        index = lowerHeaders.findIndex(h => h.includes('cod') || h.includes('bar') || h.includes('sku'));
    } else if (field === 'price') {
        index = lowerHeaders.findIndex(h => h.includes('precio') || h.includes('venta') || h.includes('price'));
    } else if (field === 'cost') {
        index = lowerHeaders.findIndex(h => h.includes('costo') || h.includes('compra') || h.includes('cost'));
    } else if (field === 'stock') {
        index = lowerHeaders.findIndex(h => h.includes('stock') || h.includes('cant') || h.includes('exist'));
    } else if (field === 'description') {
        index = lowerHeaders.findIndex(h => h.includes('detal') || h.includes('nota'));
    }

    return index;
}

function updateImportPreview() {
    const map = {
        name: parseInt(document.getElementById('map_name').value),
        barcode: parseInt(document.getElementById('map_barcode').value),
        price: parseInt(document.getElementById('map_price').value),
        cost: parseInt(document.getElementById('map_cost').value),
        stock: parseInt(document.getElementById('map_stock').value)
    };

    const tbody = document.getElementById('previewBody');
    tbody.innerHTML = '';

    // Validar si tenemos nombre (obligatorio)
    const btnConfirm = document.getElementById('btnConfirmImport');
    if (map.name === -1) {
        btnConfirm.disabled = true;
        document.getElementById('importSummary').textContent = 'Selecciona al menos la columna "Nombre" para continuar.';
    } else {
        btnConfirm.disabled = false;
        document.getElementById('importSummary').textContent = `Se importarán ${importedData.length} registros.`;
    }

    // Mostrar primeros 5
    const previewData = importedData.slice(0, 5);
    previewData.forEach(row => {
        const tr = document.createElement('tr');

        const name = map.name !== -1 ? (row[map.name] || '') : '-';
        const code = map.barcode !== -1 ? (row[map.barcode] || '') : '-';
        const price = map.price !== -1 ? (row[map.price] || '0') : '-';
        const stock = map.stock !== -1 ? (row[map.stock] || '0') : '-';

        tr.innerHTML = `
            <td style="padding: 8px;">${name}</td>
            <td style="padding: 8px;">${code}</td>
            <td style="padding: 8px; text-align: right;">${price}</td>
            <td style="padding: 8px; text-align: right;">${stock}</td>
        `;
        tbody.appendChild(tr);
    });
}

function closeImportModal() {
    document.getElementById('importModal').style.display = 'none';
    document.getElementById('importExcelInput').value = ''; // Reset input
}

// Event listener for confirm button
document.getElementById('btnConfirmImport').addEventListener('click', async () => {
    const map = {
        name: parseInt(document.getElementById('map_name').value),
        barcode: parseInt(document.getElementById('map_barcode').value),
        price: parseInt(document.getElementById('map_price').value),
        cost: parseInt(document.getElementById('map_cost').value),
        stock: parseInt(document.getElementById('map_stock').value),
        description: parseInt(document.getElementById('map_description').value)
    };

    if (map.name === -1) return;

    const btn = document.getElementById('btnConfirmImport');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';

    try {
        const products = importedData.map(row => ({
            name: map.name !== -1 ? row[map.name] : '',
            barcode: map.barcode !== -1 ? row[map.barcode] : '',
            price: map.price !== -1 ? row[map.price] : 0,
            cost: map.cost !== -1 ? row[map.cost] : 0,
            stock: map.stock !== -1 ? row[map.stock] : 0,
            description: map.description !== -1 ? row[map.description] : ''
        })).filter(p => p.name && String(p.name).trim() !== '');

        const res = await fetch('../api/stores/import_data.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ products })
        });

        const result = await res.json();

        if (result.success) {
            showNotification(`Importación exitosa: ${result.data.inserted} nuevos, ${result.data.updated} actualizados.`, 'success');
            closeImportModal();
        } else {
            showNotification(result.message, 'error');
        }
    } catch (error) {
        console.error(error);
        showNotification('Error al enviar datos', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
});

