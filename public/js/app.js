/**
 * Funciones globales de la aplicación
 * Tomodachi POS System
 */

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
        const response = await fetch('../api/auth/logout.php');
        const dataResponse = await response.json();
        if (dataResponse.success) {
            // Limpiar configuración de tema cacheada
            localStorage.removeItem('pos_theme_config');
            window.location.href = 'login.html';
        }
    } catch (error) {
        console.error('Error al cerrar sesión:', error);
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
