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
 * Esperar a que un elemento exista en el DOM (polling ligero).
 * sidebar-loader.js inyecta el sidebar de forma asíncrona, así que
 * elementos como #navStoreLogo pueden aparecer después de que otras
 * promesas (fetch de settings) ya resolvieron. Sin esta espera se
 * produce una race condition: el logo del navbar nunca se aplica
 * en algunas páginas (reportes, finanzas, etc.).
 */
function waitForElement(selector, timeoutMs = 5000, intervalMs = 100) {
    return new Promise((resolve) => {
        const el = document.querySelector(selector);
        if (el) return resolve(el);
        const start = Date.now();
        const timer = setInterval(() => {
            const found = document.querySelector(selector);
            if (found || Date.now() - start > timeoutMs) {
                clearInterval(timer);
                resolve(found || null);
            }
        }, intervalMs);
    });
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
        // pos_theme_config NO se borra — es preferencia persistente del dispositivo
        window.location.href = 'login.html';
    } catch (error) {
        console.error('Error al cerrar sesión:', error);
        // Aún con error de red, salimos localmente
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
    const cleanMessage = message.replace(/^[\u2713\u2715\u2139\u26a0]\s?/, '');
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
 * Formatear moneda — delega en FormatUtils (formato regional por tienda).
 * Fallback: es-MX / MXN si FormatUtils no está inicializado.
 */
function formatCurrency(amount) {
    if (window.FormatUtils) return window.FormatUtils.currency(amount);
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN'
    }).format(amount);
}

/**
 * Formatear fecha — delega en FormatUtils (formato regional por tienda).
 */
function formatDate(date) {
    if (window.FormatUtils) return window.FormatUtils.date(date);
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
            // El sidebar lo inyecta sidebar-loader.js de forma ASYNC (primero
            // espera verify_session.php y luego hace innerHTML), así que
            // #navStoreLogo puede no existir todavía cuando settings.php
            // responde. Si lo buscamos una sola vez y no está, el logo nunca
            // se aplica y el navbar queda con el estado por defecto (o con
            // una versión vieja del service worker). Esperamos a que exista
            // (máx. 5s) antes de aplicarlo.
            const logoImg = await waitForElement('#navStoreLogo', 5000);
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

            // 2. Aplicar Tema (Variables CSS) — AHORA guarda TODAS las
            // variables (marcas + superficies) del tema claro Y el tema
            // oscuro personalizado si el usuario lo definió.
            if (store.theme_config) {
                applyTheme(store.theme_config, store.theme_config_dark);
                // Caché para carga rápida: tema claro en pos_theme_config y
                // tema oscuro (si existe) en pos_theme_config_dark. La
                // preferencia local de MODO (theme_mode/dark_mode) se respeta;
                // los colores y superficies vienen de la BD.
                const localTheme = JSON.parse(localStorage.getItem('pos_theme_config') || '{}');
                if (!localTheme.theme_mode && localTheme.dark_mode === undefined) {
                    // Primera vez o sin preferencia local → usar config de la BD
                    localStorage.setItem('pos_theme_config', JSON.stringify(store.theme_config));
                } else {
                    // El usuario tiene preferencia local de modo → fusionar:
                    // los COLORES/Superficies vienen de la BD, el modo del local.
                    const merged = { ...localTheme, ...store.theme_config };
                    if (localTheme.theme_mode) merged.theme_mode = localTheme.theme_mode;
                    else if (localTheme.dark_mode !== undefined) merged.dark_mode = localTheme.dark_mode;
                    localStorage.setItem('pos_theme_config', JSON.stringify(merged));
                }
                // Tema oscuro personalizado (si existe en BD)
                if (store.theme_config_dark) {
                    localStorage.setItem('pos_theme_config_dark', JSON.stringify(store.theme_config_dark));
                }
            }

            // 3. Guardar nombre de la tienda para uso global (ej. tickets)
            if (store.store_name) {
                localStorage.setItem('tomodachi_store_name', store.store_name);
            }

            // 4. Inicializar formato regional (números, moneda, fechas).
            //    Si la tienda no tiene config, usa los defaults (es-MX/MXN).
            if (window.FormatUtils && store.settings && store.settings.format) {
                window.FormatUtils.init(store.settings.format);
            } else if (window.FormatUtils) {
                window.FormatUtils.init(null);
            }
        }
    } catch (error) {
        console.error('Error cargando configuración de tienda:', error);
    }
}

function applyTheme(themeConfig, themeConfigDark) {
    if (!themeConfig) return;
    // Guardar la config activa para que ThemeSystem pueda re-derivar las
    // superficies oscuras al cambiar de modo claro/oscuro
    window.__activeThemeConfig = themeConfig;
    window.__activeThemeConfigDark = themeConfigDark || null;

    // Usar ThemeColorUtils (definido en theme-init.js, corre en el head)
    // para aplicar marcas + variantes + superficies (claro u oscuro
    // personalizado; si no hay oscuro, sugerencia derivada) + contraste
    // de texto calculado por luminancia.
    if (window.ThemeColorUtils) {
        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
        window.ThemeColorUtils.apply(themeConfig, dark, themeConfigDark);
        return;
    }

    // Fallback (mismo comportamiento que antes)
    const varMap = {
        'primary_color': '--primary-color',
        'secondary_color': '--secondary-color',
        'success_color': '--success-color',
        'danger_color': '--danger-color',
        'warning_color': '--warning-color',
        'info_color': '--info-color'
    };

    for (const [key, value] of Object.entries(themeConfig)) {
        if (varMap[key] && value) {
            document.documentElement.style.setProperty(varMap[key], value);
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
            // Community Edition: abrir el centro de soporte local, sin correo externo preconfigurado.
            window.location.href = 'support.html';
        });
    });
}

/* ============================================================
 * Sistema de temas: claro / oscuro / automático
 * (usado por el sidebar rápido y el panel de configuración)
 * ============================================================ */
const ThemeSystem = (function () {
    // Modo actual: 'light' | 'dark' | 'auto' (persistido en localStorage)
    let mode = 'auto';
    let mediaQuery = null;

    function readStored() {
        try {
            const saved = JSON.parse(localStorage.getItem('pos_theme_config') || '{}');
            // theme_mode tiene prioridad: light | dark | auto
            if (saved.theme_mode === 'light' || saved.theme_mode === 'dark' || saved.theme_mode === 'auto') {
                return saved.theme_mode;
            }
            if (saved.dark_mode === true || saved.dark_mode === 'true') return 'dark';
            if (saved.dark_mode === false || saved.dark_mode === 'false') return 'light';
            return 'auto';
        } catch (e) { return 'auto'; }
    }

    function saveMode(m) {
        try {
            const saved = JSON.parse(localStorage.getItem('pos_theme_config') || '{}');
            saved.theme_mode = m;
            if (m === 'dark') saved.dark_mode = true;
            else if (m === 'light') saved.dark_mode = false;
            else delete saved.dark_mode;
            localStorage.setItem('pos_theme_config', JSON.stringify(saved));
        } catch (e) { /* noop */ }
    }

    function systemPrefersDark() {
        return mediaQuery ? mediaQuery.matches : false;
    }

    function apply() {
        const dark = mode === 'dark' || (mode === 'auto' && systemPrefersDark());
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        // En la página de Personalización (profile.html), el editor define un
        // hook (window.__editorThemeApply) que aplica el tema desde los INPUTS
        // (claro/oscuro por separado) y sincroniza la pestaña — así el modo
        // global y el preview del editor nunca se contradicen y las ediciones
        // sin guardar se respetan al alternar. Fuera de esa página se usa el
        // config activo (BD o localStorage).
        if (typeof window.__editorThemeApply === 'function') {
            window.__editorThemeApply(mode);
        } else {
            // Re-aplicar marcas + superficies del negocio (claro u oscuro
            // personalizado; si no hay oscuro, sugerencia derivada) para que el
            // modo oscuro se sienta como una inspiración del tema.
            let cfg = window.__activeThemeConfig;
            let cfgDark = window.__activeThemeConfigDark;
            if (!cfg && window.ThemeColorUtils) {
                // Fallback: si loadStoreSettings no pudo setear el config activo
                // (tienda sin theme_config en BD o página sin carga de tienda),
                // usar el tema cacheado en localStorage (el mismo que usa
                // theme-init.js pre-paint). Evita que al cambiar de modo solo
                // cambie data-theme sin re-aplicar superficies/marcas.
                try {
                    cfg = JSON.parse(localStorage.getItem('pos_theme_config') || 'null');
                    cfgDark = JSON.parse(localStorage.getItem('pos_theme_config_dark') || 'null');
                } catch (e) { cfg = null; cfgDark = null; }
            }
            if (cfg && window.ThemeColorUtils) {
                window.ThemeColorUtils.apply(cfg, dark, cfgDark);
            }
        }
        // Actualizar botones activos del sidebar
        document.querySelectorAll('.theme-quick-btn').forEach(btn => {
            const active = btn.getAttribute('data-theme-mode') === mode;
            btn.style.background = active ? 'var(--primary-color)' : 'transparent';
            btn.style.color = active ? '#fff' : 'inherit';
            btn.style.borderColor = active ? 'var(--primary-color)' : 'rgba(255,255,255,0.2)';
        });
        // Actualizar botones de modo de la página de Personalización si existen
        document.querySelectorAll('.theme-mode-btn').forEach(btn => {
            const active = btn.getAttribute('data-mode') === mode;
            btn.classList.toggle('active', active);
            btn.style.background = active ? 'var(--primary-color)' : 'transparent';
            btn.style.color = active ? '#fff' : 'var(--text-color)';
            btn.style.borderColor = active ? 'var(--primary-color)' : 'var(--border-color)';
        });
        document.dispatchEvent(new CustomEvent('tomodachi:themechange', { detail: { mode, dark } }));
    }

    function init() {
        mode = readStored();
        mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', () => { if (mode === 'auto') apply(); });
        }
        apply();

        // Delegar clics en los botones rápidos (funcionan aunque el sidebar
        // se inyecte después)
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.theme-quick-btn');
            if (!btn) return;
            setMode(btn.getAttribute('data-theme-mode'));
        });
    }

    function setMode(m) {
        if (!['light', 'dark', 'auto'].includes(m)) return;
        mode = m;
        saveMode(m);
        apply();
    }

    function getMode() { return mode; }

    return { init, setMode, getMode, apply };
})();

// Inicializar al cargar (después de theme-init.js que corre en el head)
document.addEventListener('DOMContentLoaded', () => ThemeSystem.init());

// Exponer global
window.ThemeSystem = ThemeSystem;

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
                // NOTA: pos_theme_config NO se borra — es preferencia persistente del usuario
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
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 1rem; background: var(--bg-light); border-radius: 10px; padding: 0.9rem 1rem; margin-bottom: 1rem;">
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
