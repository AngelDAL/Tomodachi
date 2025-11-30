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

            try {
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
            } catch (error) {
                console.error(error);
                showNotification('Error de conexión al subir logo', 'error');
            }
        });
    }

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', async (e) => {
        e.preventDefault();
        await logout();
    });
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
        }
    } catch (error) {
        console.error('Error loading profile:', error);
    }
}

document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    
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
                    <td>${user.username}</td>
                    <td>${user.full_name}</td>
                    <td>${user.email || '-'}</td>
                    <td><span class="badge badge-${user.role}">${user.role}</span></td>
                    <td>${user.status}</td>
                    <td>
                        ${user.role !== 'admin' ? `<button class="btn-icon" onclick="deleteUser(${user.user_id})"><i class="fas fa-trash"></i></button>` : ''}
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

async function deleteUser(userId) {
    if (!confirm('¿Estás seguro de eliminar este usuario?')) return;
    
    try {
        const res = await fetch('../api/users/delete.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId })
        });
        const result = await res.json();
        if (result.success) {
            loadUsers();
            showNotification('Usuario eliminado', 'success');
        } else {
            showNotification(result.message, 'error');
        }
    } catch (error) {
        showNotification('Error al eliminar', 'error');
    }
}
