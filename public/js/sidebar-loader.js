async function initSidebar() {
    // 0. Load Modern Sidebar CSS only if not already present in the head
    if (!document.querySelector('link[href="css/sidebar-modern.css"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'css/sidebar-modern.css';
        document.head.appendChild(link);
    }

    if (!document.querySelector('link[href="css/mobile-nav.css"]')) {
        // Load Mobile Bottom Nav CSS
        const mobileLink = document.createElement('link');
        mobileLink.rel = 'stylesheet';
        mobileLink.href = 'css/mobile-nav.css';
        document.head.appendChild(mobileLink);
    }

    // Cargar el puente con la app nativa (si existe) en todas las vistas
    if (!document.querySelector('script[src="js/capacitor-bridge.js"]')) {
        const bridgeScript = document.createElement('script');
        bridgeScript.src = 'js/capacitor-bridge.js';
        document.head.appendChild(bridgeScript);
    }

    // Cargar navegación por teclado (atajos Alt+1..7 y modo POS) en todas las vistas
    if (!document.querySelector('script[src^="js/keyboard-nav.js"]')) {
        const kbScript = document.createElement('script');
        kbScript.src = 'js/keyboard-nav.js?v=2';
        document.head.appendChild(kbScript);
    }

    // Cargar el arreglo de etiquetas largas en móvil (un botón con icono cuya etiqueta no
    // cabe se queda solo con el icono) en todas las vistas
    if (!document.querySelector('script[src^="js/ui-movil.js"]')) {
        const compactoScript = document.createElement('script');
        compactoScript.src = 'js/ui-movil.js?v=1';
        document.head.appendChild(compactoScript);
    }

    const sidebarNav = document.querySelector('.sidebar-nav');
    if (!sidebarNav) return;

    // Define menu items
    // roles: opcional — si existe, solo esos roles ven el item (permisos granulares B4)
    const menuItems = [
        { href: 'dashboard.html', icon: 'fa-chart-line', text: 'Dashboard' },
        { href: 'tables.html', icon: 'fa-chair', text: 'Puntos de servicio', roles: ['super_admin', 'admin', 'manager', 'waiter'] },
        { href: 'sales.html', icon: 'fa-cash-register', text: 'Punto de Venta' },
        { href: 'inventory.html', icon: 'fa-box', text: 'Inventario' },
        { href: 'customers.html', icon: 'fa-users', text: 'Clientes' },
        { href: 'promotions.html', icon: 'fa-tags', text: 'Promociones' },
        { href: 'finance.html', icon: 'fa-wallet', text: 'Finanzas', roles: ['admin', 'manager', 'super_admin'] },
        { href: 'reports.html', icon: 'fa-chart-bar', text: 'Reportes', roles: ['admin', 'manager', 'super_admin'], className: 'desktop-only-nav' }
    ];

    // Current page detection
    const path = window.location.pathname;
    const page = path.split("/").pop() || 'index.html'; // Default to index.html if empty

    // Helper to generate menu HTML
    let menuHTML = '';
    
    // Obtener rol del usuario para permisos granulares (B4)
    let currentRole = null;
    try {
        const sessRes = await fetch('../api/auth/verify_session.php');
        const sessData = await sessRes.json();
        if (sessData.success && sessData.data && sessData.data.user) {
            currentRole = sessData.data.user.role || null;
        }
    } catch (e) { console.warn('No se pudo obtener el rol:', e); }

    menuItems.forEach(item => {
        // Permisos granulares: ocultar items restringidos según rol
        if (item.roles && currentRole && !item.roles.includes(currentRole)) {
            return; // no renderizar
        }
        // Active state logic
        // Simple check: active if href matches current page
        // Handling special cases if needed (e.g. index.html -> dashboard.html mapping?)
        // Assuming dashboard.html is the main one.
        
        let isActive = (page === item.href);
        const activeClass = isActive ? ' active' : '';
        const extraClass = item.className ? ` ${item.className}` : '';
        
        menuHTML += `
            <a href="${item.href}" class="nav-item${activeClass}${extraClass}">
                <span class="nav-icon"><i class="fas ${item.icon}"></i></span> <span class="nav-text">${item.text}</span>
            </a>
        `;
    });

    // Profile Section HTML (Replicating original structure)
    const isProfileActive = (page === 'profile.html') ? ' active' : '';

    const profileHTML = `
        <div class="nav-group profile-nav-group">
            <a href="profile.html" class="nav-item${isProfileActive}" id="profileMenuBtn">
                <span class="profile-icon-container">
                    <img src="assets/images/default-logo.png" alt="Store" class="nav-profile-img" id="navStoreLogo" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-block'">
                    <i class="fas fa-circle-user" style="display:none; font-size: 1.5rem;"></i>
                </span>
                <span class="nav-text">Mi Perfil</span>
            </a>

            <div class="user-tooltip-menu" id="profileTooltipMenu">
                <a href="profile.html" class="tooltip-item">
                    <i class="fas fa-cog"></i> Configuración
                </a>
                <a href="promotions.html" class="tooltip-item">
                    <i class="fas fa-tags"></i> Promociones
                </a>
                <a href="reports.html" class="tooltip-item">
                    <i class="fas fa-chart-bar"></i> Reportes
                </a>
                <a href="#" class="tooltip-item" id="fullscreenToggleBtn">
                    <i class="fas fa-expand"></i> Pantalla completa
                </a>
                <a href="#" class="tooltip-item" id="themeToggleTooltipBtn">
                    <i class="fas ${isDarkChecked() ? 'fa-moon' : 'fa-sun'}"></i> <span id="themeToggleTooltipLabel">Tema ${isDarkChecked() ? 'oscuro' : 'claro'}</span>
                </a>
                <a href="#" class="tooltip-item" id="logoutTooltipBtn">
                    <i class="fas fa-sign-out-alt"></i> Cerrar Sesión
                </a>
            </div>
        </div>
    `;

    // Bottom group: pushed to the bottom on desktop
    // (El selector de tema se movió a Configuración → Interfaz en profile.html;
    //  aquí queda el toggle rápido de tema + logout)
    const bottomGroupHTML = `
        <div class="nav-bottom-group">
            <a href="#" class="nav-item" id="fullscreenBottomBtn" aria-label="Pantalla completa">
                <span class="nav-icon"><i class="fas fa-expand"></i></span>
                <span class="nav-text" id="fullscreenBottomLabel">Pantalla completa</span>
            </a>
            <a href="#" class="nav-item" id="tempThemeToggle" aria-label="Alternar tema">
                <span class="nav-icon"><i class="fas ${isDarkChecked() ? 'fa-moon' : 'fa-sun'}"></i></span>
                <span class="nav-text" id="tempThemeLabel">Tema ${isDarkChecked() ? 'oscuro' : 'claro'}</span>
            </a>
            <a href="#" class="nav-item" id="logoutBtn">
                <span><i class="fas fa-sign-out-alt"></i></span> <span class="nav-text">Cerrar Sesión</span>
            </a>
        </div>
    `;

    function isDarkChecked() {
        return document.documentElement.getAttribute('data-theme') === 'dark';
    }

    sidebarNav.innerHTML = menuHTML + profileHTML + bottomGroupHTML;

    /**
     * En el teléfono la barra inferior reparte el ancho entre siete u ocho items, y las
     * etiquetas largas no caben: "Puntos de servicio" salía como "Puntos…", que no se
     * entiende y además se encimaba con la de al lado. Aquí se MIDE cada etiqueta con el
     * ancho real que tiene y, si no cabe, el item se queda SOLO con su icono.
     *
     * El texto no se borra: queda oculto visualmente pero presente para los lectores de
     * pantalla, y el nombre completo se guarda en el `title` (útil al pasar el cursor o en
     * una tablet). Se recalcula al girar el teléfono o al cambiar el tamaño de la ventana.
     */
    function ajustarEtiquetasDeLaBarra() {
        const textos = sidebarNav.querySelectorAll('.nav-item .nav-text');
        if (!textos.length) return;

        // Primero todo visible, para poder medir de verdad (una etiqueta ya escondida
        // siempre "cabe" y nunca volvería a mostrarse al ensanchar la pantalla).
        textos.forEach(t => {
            t.classList.remove('nav-solo-icono');
            const item = t.closest('.nav-item');
            if (item) { item.classList.remove('nav-compacto'); item.removeAttribute('title'); }
        });

        // Dos pasadas: al esconder unas etiquetas, las demás ganan espacio y algunas que
        // antes no cabían ya caben.
        for (let pasada = 0; pasada < 2; pasada++) {
            textos.forEach(t => {
                if (t.classList.contains('nav-solo-icono')) return;
                const item = t.closest('.nav-item');
                if (!item) return;
                const disponible = item.clientWidth - 6; // menos el relleno del item
                if (disponible > 0 && t.scrollWidth > disponible) {
                    t.classList.add('nav-solo-icono');
                    item.classList.add('nav-compacto');
                    item.setAttribute('title', t.textContent.trim());
                }
            });
        }
    }
    ajustarEtiquetasDeLaBarra();
    window.addEventListener('resize', ajustarEtiquetasDeLaBarra);
    window.addEventListener('orientationchange', ajustarEtiquetasDeLaBarra);

    // Pantalla completa: disponible tanto en el menú móvil como encima del tema en escritorio.
    const updateFullscreenLabels = () => {
        const active = !!document.fullscreenElement;
        const text = active ? 'Salir de pantalla completa' : 'Pantalla completa';
        const icon = active ? 'fa-compress' : 'fa-expand';
        const mobileBtn = document.getElementById('fullscreenToggleBtn');
        const desktopBtn = document.getElementById('fullscreenBottomBtn');
        if (mobileBtn) { mobileBtn.lastChild.textContent = ` ${text}`; const i = mobileBtn.querySelector('i'); if (i) i.className = `fas ${icon}`; }
        if (desktopBtn) { const label = document.getElementById('fullscreenBottomLabel'); if (label) label.textContent = text; const i = desktopBtn.querySelector('i'); if (i) i.className = `fas ${icon}`; }
    };
    /* ------------------------------------------------------------
     * LA PANTALLA COMPLETA SE RECUERDA ENTRE PÁGINAS
     *
     * Antes había que activarla otra vez en cada pantalla: al navegar, el navegador la pierde.
     * Ahora se guarda la intención y, al abrir la siguiente página, se vuelve a entrar sola. Si
     * el navegador exige un toque para concederla (no todos la dan sin gesto), se aplica en
     * cuanto el usuario toca la pantalla: él no debe buscar el botón ni volver a pensarlo.
     * ------------------------------------------------------------ */
    const CLAVE_PANTALLA_COMPLETA = 'tomodachi_pantalla_completa';
    let entrandoSola = false;   // distingue "entró por nosotros" de "el usuario la apagó"

    function pantallaCompletaPedida() {
        try { return localStorage.getItem(CLAVE_PANTALLA_COMPLETA) === '1'; } catch (error) { return false; }
    }

    function recordarPantallaCompleta(activa) {
        try { localStorage.setItem(CLAVE_PANTALLA_COMPLETA, activa ? '1' : '0'); } catch (error) {}
    }

    async function entrarEnPantallaCompleta() {
        entrandoSola = true;
        try {
            if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
                await document.documentElement.requestFullscreen();
            }
            return true;
        } catch (error) {
            return false;   // el navegador pidió un gesto: se reintenta al primer toque
        } finally {
            entrandoSola = false;
            updateFullscreenLabels();
        }
    }

    function retomarPantallaCompleta() {
        if (!pantallaCompletaPedida() || document.fullscreenElement) return;
        entrarEnPantallaCompleta().then((entro) => {
            if (entro) return;
            const alPrimerGesto = () => {
                ['pointerdown', 'touchstart', 'keydown'].forEach((ev) =>
                    document.removeEventListener(ev, alPrimerGesto));
                entrarEnPantallaCompleta();
            };
            ['pointerdown', 'touchstart', 'keydown'].forEach((ev) =>
                document.addEventListener(ev, alPrimerGesto, { once: true, passive: true }));
        });
    }

    /** Cierra el menú del perfil (el de abajo a la derecha en el teléfono). */
    function cerrarMenuDePerfil() {
        const menu = document.getElementById('profileTooltipMenu');
        const boton = document.getElementById('profileMenuBtn');
        if (menu) menu.classList.remove('show');
        if (boton) boton.classList.remove('active');
    }

    const toggleFullscreen = async (event) => {
        event.preventDefault();
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
                recordarPantallaCompleta(false);
            } else if (document.documentElement.requestFullscreen) {
                await document.documentElement.requestFullscreen();
                recordarPantallaCompleta(true);
            } else {
                throw new Error('Fullscreen API no disponible');
            }
        } catch (error) { console.warn('No se pudo cambiar a pantalla completa:', error); }
        updateFullscreenLabels();
        cerrarMenuDePerfil();
    };
    document.getElementById('fullscreenToggleBtn')?.addEventListener('click', toggleFullscreen);
    document.getElementById('fullscreenBottomBtn')?.addEventListener('click', toggleFullscreen);

    document.addEventListener('fullscreenchange', () => {
        updateFullscreenLabels();
        // Si se salió sin que lo pidiéramos nosotros, fue el usuario: se olvida la preferencia.
        if (!document.fullscreenElement && !entrandoSola && pantallaCompletaPedida()) recordarPantallaCompleta(false);
    });
    updateFullscreenLabels();
    retomarPantallaCompleta();

    // --- Enhanced Sidebar Logic (Floating & Dynamic Store Name) ---

    // 1. Inject Desktop Toggle Button
    const sidebarHeader = document.querySelector('.sidebar-header');
    if (sidebarHeader) {
        // Create toggle button if not exists
        if (!document.getElementById('sidebarDesktopToggle')) {
            const toggleBtn = document.createElement('button');
            toggleBtn.id = 'sidebarDesktopToggle';
            toggleBtn.className = 'sidebar-desktop-toggle';
            toggleBtn.innerHTML = '<i class="fas fa-bars"></i>';
            toggleBtn.ariaLabel = 'Colapsar menú';
            
            // Insert before H2 or append
            const h2 = sidebarHeader.querySelector('h2');
            if (h2) {
                sidebarHeader.insertBefore(toggleBtn, h2);
            } else {
                sidebarHeader.appendChild(toggleBtn);
            }

            // Toggle functionality
            toggleBtn.addEventListener('click', function() {
                document.documentElement.classList.toggle('sidebar-collapsed');
                const isCollapsed = document.documentElement.classList.contains('sidebar-collapsed');
                localStorage.setItem('sidebarCollapsed', isCollapsed);
            });
        }
    }

    // 2. Fetch Store Settings for Dynamic Name
    fetch('../api/stores/settings.php', { credentials: 'include' })
        .then(response => response.json())
        .then(data => {
            if (data.success && data.data) {
                const storeName = data.data.store_name;
                const headerTitle = document.querySelector('.sidebar-header h2');
                if (headerTitle && storeName) {
                    headerTitle.textContent = storeName;
                }
            }
        })
        .catch(err => console.error('Error fetching store settings:', err));

    // 4. Mobile Profile Menu Logic (Override for Bottom Nav)
    const profileMenuBtn = document.getElementById('profileMenuBtn');
    const profileTooltipMenu = document.getElementById('profileTooltipMenu');

    if (profileMenuBtn && profileTooltipMenu) {
        /**
         * Al abrirlo, cada opción recibe su turno de entrada.
         *
         * El menú tiene seis o más opciones y la hoja de estilos solo escalonaba las tres
         * primeras: de la cuarta en adelante aparecían todas de golpe (justo lo que se veía en
         * el teléfono). Aquí el turno se cuenta SOLO sobre lo que se ve — algunas opciones se
         * ocultan según el usuario — para que la cascada salga sin huecos.
         */
        const ordenarEntradaDelMenu = () => {
            let turno = 0;
            profileTooltipMenu.querySelectorAll('.tooltip-item').forEach((item) => {
                if (item.offsetParent === null) return;   // oculto: no gasta turno
                item.style.setProperty('--orden', ++turno);
            });
        };

        /**
         * Elegir una opción CIERRA el menú.
         *
         * Antes se quedaba abierto tapando media pantalla: después de poner pantalla completa o
         * cambiar el tema había que cerrarlo a mano para poder seguir trabajando.
         */
        profileTooltipMenu.addEventListener('click', (e) => {
            if (e.target.closest && e.target.closest('.tooltip-item')) cerrarMenuDePerfil();
        });

        profileMenuBtn.addEventListener('click', (e) => {
            // Check if we are in mobile/tablet mode (< 1025px)
            if (window.innerWidth < 1025) {
                // Prevent navigation FIRST
                e.preventDefault();
                e.stopImmediatePropagation(); // Ensure no other listener runs
                
                // Toggle
                const isShown = profileTooltipMenu.classList.contains('show');
                if (isShown) {
                    cerrarMenuDePerfil();
                } else {
                    ordenarEntradaDelMenu();
                    profileTooltipMenu.classList.add('show');
                    profileMenuBtn.classList.add('active');
                }
                
                // Close if clicking outside
                const closeHandler = (ev) => {
                    // If click is NOT inside menu AND NOT on the button
                    if (!profileTooltipMenu.contains(ev.target) && !profileMenuBtn.contains(ev.target)) {
                        cerrarMenuDePerfil();
                        document.removeEventListener('click', closeHandler);
                    }
                };
                
                // Remove previous listener if any to avoid duplicates (though minimal risk here)
                document.removeEventListener('click', closeHandler);
                // Add new
                setTimeout(() => {
                    document.addEventListener('click', closeHandler);
                }, 50);
            }
        });
    }

    // Attach Logout Listeners
    const handleLogout = async (e) => {
        e.preventDefault();
        if (typeof logout === 'function') {
            await logout();
        } else {
            console.error('Logout function not found. Redirecting...');
            window.location.href = 'login.html';
        }
    };

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    const logoutTooltipBtn = document.getElementById('logoutTooltipBtn');
    if (logoutTooltipBtn) logoutTooltipBtn.addEventListener('click', handleLogout);

    // Botón temporal de tema (claro/oscuro) — usa ThemeSystem si existe
    const tempThemeBtn = document.getElementById('tempThemeToggle');
    const tempThemeLbl = document.getElementById('tempThemeLabel');
    const syncThemeBtn = () => {
        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
        if (tempThemeBtn) {
            const icon = tempThemeBtn.querySelector('.nav-icon i');
            if (icon) icon.className = `fas ${dark ? 'fa-moon' : 'fa-sun'}`;
        }
        if (tempThemeLbl) tempThemeLbl.textContent = `Tema ${dark ? 'oscuro' : 'claro'}`;
    };
    if (tempThemeBtn) {
        tempThemeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            if (window.ThemeSystem && ThemeSystem.setMode) {
                ThemeSystem.setMode(isDark ? 'light' : 'dark');
            } else {
                document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
            }
            setTimeout(syncThemeBtn, 40);
        });
    }
    document.addEventListener('tomodachi:themechange', syncThemeBtn);
    syncThemeBtn();

    // Toggle tema desde el tooltip del perfil (móvil)
    const themeToggleTooltip = document.getElementById('themeToggleTooltipBtn');
    const themeToggleTooltipLabel = document.getElementById('themeToggleTooltipLabel');
    const syncThemeTooltip = () => {
        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
        if (themeToggleTooltip) {
            const icon = themeToggleTooltip.querySelector('i');
            if (icon) icon.className = `fas ${dark ? 'fa-moon' : 'fa-sun'}`;
        }
        if (themeToggleTooltipLabel) themeToggleTooltipLabel.textContent = `Tema ${dark ? 'oscuro' : 'claro'}`;
    };
    if (themeToggleTooltip) {
        themeToggleTooltip.addEventListener('click', (e) => {
            e.preventDefault();
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            if (window.ThemeSystem && ThemeSystem.setMode) {
                ThemeSystem.setMode(isDark ? 'light' : 'dark');
            } else {
                document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
            }
            setTimeout(syncThemeTooltip, 40);
        });
    }
    document.addEventListener('tomodachi:themechange', syncThemeTooltip);

    // Profile Menu Toggle Logic (Consolidated from app.js)
    // If app.js handles this, we might have duplicate listeners if we add it here too.
    // However, since we are replacing the HTML, the listeners from app.js might not attach 
    // if app.js runs BEFORE this script (but we plan to run this first).
    // If this runs FIRST, app.js listeners will attach fine.
    // So we don't strictly need to add profile logic here IF app.js does it.
    // But to be safe and self-contained, ensuring it works:
    
    // Check if app.js logic is sufficient. app.js:
    // const profileMenuBtn = document.getElementById('profileMenuBtn');
    // ... adds listener.
    // We will let app.js handle the UI toggle for profile to avoid conflicts.
}

// Run immediately if the DOM is already parsed, otherwise wait for DOMContentLoaded.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSidebar);
} else {
    initSidebar();
}
