/**
 * Funciones globales de la aplicación
 * Tomodachi POS System
 */

/**
 * Obtener ruta relativa de imagen
 * Convierte rutas absolutas o de sistema de archivos a relativas web
 */
function getRelativeImagePath(path) {
    if (!path) return null;
    // Si es base64, retornar tal cual
    if (path.startsWith('data:image')) return path;
    // Si es http/https, retornar tal cual
    if (path.startsWith('http')) return path;
    
    // Normalizar slashes
    let cleanPath = path.replace(/\\/g, '/');
    
    // Si contiene 'public/', tomar lo que sigue
    if (cleanPath.includes('public/')) {
        cleanPath = cleanPath.split('public/')[1];
    }
    
    // Eliminar slash inicial si existe para hacerlo relativo
    if (cleanPath.startsWith('/')) {
        cleanPath = cleanPath.substring(1);
    }
    
    return cleanPath;
}

/**
 * Verificar sesión activa
 */
async function checkSession() {
    try {
        const response = await fetch('../api/auth/verify_session.php');
        const dataResponse = await response.json();
        if (dataResponse.success && dataResponse.data.logged_in) {
            console.log('Sesión activa para el usuario:', dataResponse.data.user);
            return dataResponse.data.user;
        }
        console.log('No hay sesión activa.');
        return null;
    } catch (error) {
        console.error('Error al verificar sesión:', error);
        return null;
    }
}

/**
 * Cerrar sesión
 */
async function logout() {
    try {
        const response = await fetch('../api/auth/logout.php', {
            method: 'POST',
            credentials: 'include'
        });
        const dataResponse = await response.json();
        // Aunque el servidor diga "no hay sesión", el objetivo es salir:
        // se limpia todo local y se va al login.
        if (!dataResponse.success) {
            console.warn('Logout sin sesión activa (no-op):', dataResponse.message);
        }
        // Limpiar configuración de tema cacheada
        localStorage.removeItem('pos_theme_config');
        window.location.href = 'login.html';
    } catch (error) {
        console.error('Error al cerrar sesión:', error);
        // Aún con error de red, salimos localmente
        localStorage.removeItem('pos_theme_config');
        window.location.href = 'login.html';
    }
}

/**
 * Mostrar notificación
 */
function showNotification(message, type = 'info') {
    // Eliminar notificaciones previas para evitar acumulación excesiva en móvil
    const existing = document.querySelectorAll('.notification');
    existing.forEach(n => {
        n.classList.remove('show');
        setTimeout(() => n.remove(), 300);
    });

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    // Limpiar mensaje de prefijos si ya vienen con iconos del CSS
    const cleanMessage = message.replace(/^[✓✕ℹ⚠]\s?/, '');
    notification.textContent = cleanMessage;

    document.body.appendChild(notification);

    // Forzar reflow
    notification.offsetHeight;

    setTimeout(() => {
        notification.classList.add('show');
    }, 10);

    // Ocultar al pasar el mouse (hover)
    notification.addEventListener('mouseenter', () => {
        notification.classList.remove('show');
        setTimeout(() => {
            if (notification.parentNode) notification.parentNode.removeChild(notification);
        }, 300);
    });

    // Auto ocultar
    setTimeout(() => {
        if (notification.parentNode) {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification.parentNode) document.body.removeChild(notification);
            }, 300);
        }
    }, 3500);
}

function toggleFullScreenGlobal() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(e => {
            console.log(e);
            showNotification('No se pudo activar pantalla completa', 'warning');
        });
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}
document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('sidebar');
    const sidebarClose = document.querySelector('.sidebar-close');
    const overlay = document.getElementById('sidebarOverlay');
    const body = document.body;

    const closeSidebar = () => {
        sidebar && sidebar.classList.remove('open');
        overlay && overlay.classList.remove('show');
        body.classList.remove('no-scroll');
    };

    // Botón de cerrar en el sidebar
    if (sidebarClose) {
        sidebarClose.addEventListener('click', closeSidebar);
    }

    if (overlay) {
        overlay.addEventListener('click', closeSidebar);
    }

    // Inyectar opción de Pantalla Completa en el menú de perfil
    const profileMenu = document.getElementById('profileTooltipMenu');
    if (profileMenu && !document.getElementById('fullscreenToggleBtn')) {
        const fsLink = document.createElement('a');
        fsLink.href = '#';
        fsLink.className = 'tooltip-item';
        fsLink.id = 'fullscreenToggleBtn';
        fsLink.innerHTML = '<i class="fas fa-expand"></i> Pantalla Completa';
        fsLink.onclick = (e) => {
            e.preventDefault();
            toggleFullScreenGlobal();
        };
        
        // Insertar antes de "Cerrar Sesión" (último elemento)
        if (profileMenu.lastElementChild) {
            profileMenu.insertBefore(fsLink, profileMenu.lastElementChild);
        } else {
            profileMenu.appendChild(fsLink);
        }
    }

    // Cerrar sidebar al hacer clic en un nav-item
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 860) {
                closeSidebar();
            }
        });
    });

    // Auto reset on resize
    window.addEventListener('resize', () => {
        if (window.innerWidth > 860) {
            overlay && overlay.classList.remove('show');
            body.classList.remove('no-scroll');
            sidebar && sidebar.classList.remove('open');
        }
    });
});

/**
 * Formatear moneda
 */
function formatCurrency(amount) {
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN'
    }).format(amount);
}

/**
 * Formatear fecha
 */
function formatDate(date) {
    return new Intl.DateTimeFormat('es-MX', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(new Date(date));
}

/**
 * Validar formulario
 */
function validateForm(formElement) {
    const inputs = formElement.querySelectorAll('[required]');
    let isValid = true;

    inputs.forEach(input => {
        if (!input.value.trim()) {
            input.classList.add('error');
            isValid = false;
        } else {
            input.classList.remove('error');
        }
    });

    return isValid;
}

// User Dropdown Toggle
document.addEventListener('DOMContentLoaded', () => {
    const userMenuToggle = document.getElementById('userMenuToggle');
    const userDropdown = document.getElementById('userDropdown');
    const logoutBtnMobile = document.getElementById('logoutBtnMobile');

    if (userMenuToggle && userDropdown) {
        userMenuToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            userDropdown.classList.toggle('show');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!userMenuToggle.contains(e.target) && !userDropdown.contains(e.target)) {
                userDropdown.classList.remove('show');
            }
        });
    }

    if (logoutBtnMobile) {
        logoutBtnMobile.addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
    }
});

// Lógica para el menú tooltip de usuario (Perfil)
document.addEventListener('DOMContentLoaded', () => {
    const profileMenuBtn = document.getElementById('profileMenuBtn');
    const profileTooltipMenu = document.getElementById('profileTooltipMenu');

    if (profileMenuBtn && profileTooltipMenu) {
        profileMenuBtn.addEventListener('click', (e) => {
            // Solo activar el menú en vista móvil (<= 768px)
            if (window.innerWidth <= 768) {
                e.preventDefault();
                e.stopPropagation();
                profileTooltipMenu.classList.toggle('show');
                profileMenuBtn.classList.toggle('active');
            }
            // En escritorio, el enlace funciona normalmente (va a profile.html)
        });

        // Cerrar al hacer clic fuera
        document.addEventListener('click', (e) => {
            if (!profileMenuBtn.contains(e.target) && !profileTooltipMenu.contains(e.target)) {
                profileTooltipMenu.classList.remove('show');
                profileMenuBtn.classList.remove('active');
            }
        });
    }
    
    // Cargar configuración de la tienda (Logo y Tema)
    loadStoreSettings();
});

async function loadStoreSettings() {
    try {
        const response = await fetch('../api/stores/settings.php');
        const data = await response.json();
        
        if (data.success) {
            const store = data.data;

            // 1. Aplicar Logo
            const logoImg = document.getElementById('navStoreLogo');
            if (logoImg) {
                if (store.logo_url) {
                    logoImg.src = store.logo_url;
                    // Asegurar que se muestre si estaba oculto por error o fallback previo
                    logoImg.style.display = 'inline-block';
                    if (logoImg.nextElementSibling) {
                        logoImg.nextElementSibling.style.display = 'none';
                    }
                } else {
                    // Fallback si no hay logo
                    logoImg.style.display = 'none';
                    if (logoImg.nextElementSibling) {
                        logoImg.nextElementSibling.style.display = 'inline-block';
                    }
                }
            }

            // 2. Aplicar Tema (Variables CSS)
            if (store.theme_config) {
                applyTheme(store.theme_config);
                // Guardar en caché para carga rápida
                localStorage.setItem('pos_theme_config', JSON.stringify(store.theme_config));
            }

            // 3. Guardar nombre de la tienda para uso global (ej. tickets)
            if (store.store_name) {
                localStorage.setItem('tomodachi_store_name', store.store_name);
            }
        }
    } catch (error) {
        console.error('Error cargando configuración de tienda:', error);
    }
}

function applyTheme(themeConfig) {
    if (!themeConfig) return;
    
    // Mapeo de claves JSON a variables CSS (si usamos nombres directos en el JSON, es más fácil)
    // Asumimos que el JSON tiene claves como 'primary_color' o '--primary-color'
    // En profile.js usamos input.name que es 'primary_color', 'secondary_color', etc.
    // Pero en el HTML pusimos data-var="--primary-color".
    // Vamos a iterar sobre las claves del objeto y mapear si es necesario, o usar un mapa fijo.
    
    const varMap = {
        'primary_color': '--primary-color',
        'secondary_color': '--secondary-color',
        'success_color': '--success-color',
        'danger_color': '--danger-color',
        'warning_color': '--warning-color',
        'info_color': '--info-color',
        'dark_color': '--dark-color',
        'bg_body': '--bg-body',
        'text_color': '--text-color'
    };

    for (const [key, value] of Object.entries(themeConfig)) {
        if (varMap[key] && value) {
            document.documentElement.style.setProperty(varMap[key], value);
            
            // Calcular variantes oscuras/claras automáticamente si es necesario
            if (key === 'primary_color') {
                // Simple darken logic could go here if we wanted to generate --primary-dark automatically
                // But for now, let's stick to what the user picked.
            }
        }
    }
}

// Función para ir a ajustes de perfil
function showProfileSettings() {
    window.location.href = 'profile.html';
}

/**
 * Sistema de Soporte
 */
function initSupport() {
    // Seleccionar todos los botones de soporte (sidebar y móvil)
    const btns = document.querySelectorAll('#supportBtn, .js-support-btn');
    
    btns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            // Simplificación: Abrir cliente de correo directo
            window.location.href = 'mailto:contacto@baburu.shop?subject=Soporte Tomodachi POS';
        });
    });
}

// Inicializar soporte al cargar
document.addEventListener('DOMContentLoaded', () => {
    initSupport();
});

/* ============================================================
 * Sistema de sesión: verificación + modal de re-login
 * ============================================================ */

// Clave donde guardamos la preferencia "mantener sesión siempre"
const KEEP_SESSION_KEY = 'tomodachi_keep_session';

/**
 * Verificar sesión y, si caducó, decidir el flujo:
 * - Si el usuario pidió "mantener mi sesión activa siempre" → modal bonito
 *   de re-login (no expulsa de la página en la que está).
 * - Si no lo pidió (o es la primera visita) → login normal.
 * Devuelve el usuario si hay sesión.
 */
async function requireSession() {
    const session = await checkSession();
    if (session) {
        return session;
    }
    if (localStorage.getItem(KEEP_SESSION_KEY) === '1') {
        // El usuario quiere sesión permanente: en vez de expulsarlo,
        // le pedimos que vuelva a entrar en un modal.
        showReloginModal();
    } else {
        window.location.href = 'login.html';
    }
    return null;
}

/**
 * Modal bonito de "tu sesión ha caducado".
 */
function showReloginModal() {
    // Evitar duplicados
    if (document.getElementById('reloginModal')) {
        document.getElementById('reloginModal').classList.add('show');
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal relogin-modal';
    modal.id = 'reloginModal';
    modal.innerHTML = `
        <div class="modal-content relogin-content">
            <div class="relogin-icon"><i class="fas fa-clock"></i></div>
            <h2>Tu sesión ha caducado</h2>
            <p>Por seguridad, vuelve a iniciar sesión para continuar.</p>
            <form id="reloginForm">
                <label for="reloginUsername">Usuario</label>
                <input type="text" id="reloginUsername" autocomplete="username" placeholder="Tu usuario" required>
                <label for="reloginPassword">Contraseña</label>
                <input type="password" id="reloginPassword" autocomplete="current-password" placeholder="Tu contraseña" required>
                <label class="relogin-remember">
                    <input type="checkbox" id="reloginRemember" checked>
                    Mantener mi sesión activa siempre
                </label>
                <button type="submit" class="relogin-btn">
                    <i class="fas fa-sign-in-alt"></i> Iniciar sesión
                </button>
                <div class="relogin-error" id="reloginError"></div>
            </form>
        </div>
    `;
    document.body.appendChild(modal);

    // Mostrar
    requestAnimationFrame(() => modal.classList.add('show'));

    // Enfocar usuario
    setTimeout(() => {
        const u = document.getElementById('reloginUsername');
        if (u) u.focus();
    }, 150);

    // Submit
    document.getElementById('reloginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.querySelector('.relogin-btn');
        const errEl = document.getElementById('reloginError');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Entrando...';
        errEl.textContent = '';

        const username = document.getElementById('reloginUsername').value.trim();
        const password = document.getElementById('reloginPassword').value;
        const remember = document.getElementById('reloginRemember').checked;

        try {
            const resp = await fetch('../api/auth/login.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ username, password, remember })
            });
            const data = await resp.json();
            if (data.success) {
                if (remember) {
                    localStorage.setItem(KEEP_SESSION_KEY, '1');
                } else {
                    localStorage.removeItem(KEEP_SESSION_KEY);
                }
                // Limpiar contenido antiguo en RAM al volver a entrar
                localStorage.removeItem('pos_theme_config');
                window.location.reload();
            } else {
                errEl.textContent = data.message || 'Usuario o contraseña incorrectos';
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Iniciar sesión';
            }
        } catch (error) {
            errEl.textContent = 'Error de conexión. Intenta de nuevo.';
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Iniciar sesión';
        }
    });
}

// Exponer para uso global
window.requireSession = requireSession;
window.showReloginModal = showReloginModal;

/* ============================================================
 * Skeleton loader para el modal de detalle de venta
 * Imita la estructura real (cabecera + tabla) para que no haya
 * salto de tamaño entre el estado de carga y el contenido.
 * ============================================================ */
function saleDetailSkeletonHTML() {
    return `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 1rem; background: #f8f9fa; border-radius: 10px; padding: 0.9rem 1rem; margin-bottom: 1rem;">
            <div class="skeleton" style="height: 16px; width: 80%;"></div>
            <div class="skeleton" style="height: 16px; width: 60%;"></div>
            <div class="skeleton" style="height: 16px; width: 55%;"></div>
            <div class="skeleton" style="height: 16px; width: 70%;"></div>
        </div>
        <div class="skeleton" style="height: 16px; width: 40%; margin-bottom: 0.8rem;"></div>
        <div class="skeleton-table-row"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
        <div class="skeleton-table-row"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
        <div class="skeleton-table-row"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
        <div class="skeleton-table-row"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
    `;
}
window.saleDetailSkeletonHTML = saleDetailSkeletonHTML;
