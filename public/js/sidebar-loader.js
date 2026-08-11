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

    const sidebarNav = document.querySelector('.sidebar-nav');
    if (!sidebarNav) return;

    // Define menu items
    // roles: opcional — si existe, solo esos roles ven el item (permisos granulares B4)
    const menuItems = [
        { href: 'dashboard.html', icon: 'fa-chart-line', text: 'Dashboard' },
        { href: 'sales.html', icon: 'fa-cash-register', text: 'Punto de Venta' },
        { href: 'inventory.html', icon: 'fa-box', text: 'Inventario' },
        { href: 'customers.html', icon: 'fa-users', text: 'Clientes' },
        { href: 'promotions.html', icon: 'fa-tags', text: 'Promociones' },
        { href: 'finance.html', icon: 'fa-wallet', text: 'Finanzas', roles: ['admin', 'manager', 'super_admin'] },
        { href: 'reports.html', icon: 'fa-chart-bar', text: 'Reportes', roles: ['admin', 'manager', 'super_admin'], className: 'desktop-only-nav' } // Keeping reports desktop-only for now as per original
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
                <a href="#" class="tooltip-item js-support-btn">
                    <i class="fas fa-headset"></i> Soporte
                </a>
                <a href="#" class="tooltip-item" id="logoutTooltipBtn">
                    <i class="fas fa-sign-out-alt"></i> Cerrar Sesión
                </a>
            </div>
        </div>
    `;

    // Bottom group: pushed to the bottom on desktop
    const bottomGroupHTML = `
        <div class="nav-bottom-group">
            <a href="#" class="nav-item" id="logoutBtn">
                <span><i class="fas fa-sign-out-alt"></i></span> <span class="nav-text">Cerrar Sesión</span>
            </a>

            <div class="nav-separator" style="margin: 10px 0; border-top: 1px solid rgba(255,255,255,0.1);"></div>

            <a href="#" class="nav-item desktop-only-nav js-support-btn" id="supportBtn" style="color: #aaa; font-size: 0.9em;">
                <span><i class="fas fa-headset"></i></span> <span class="nav-text">Soporte/Sugerencias</span>
            </a>
        </div>
    `;

    sidebarNav.innerHTML = menuHTML + profileHTML + bottomGroupHTML;

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
    fetch('../api/stores/settings.php')
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
        profileMenuBtn.addEventListener('click', (e) => {
            // Check if we are in mobile/tablet mode (< 1025px)
            if (window.innerWidth < 1025) {
                // Prevent navigation FIRST
                e.preventDefault();
                e.stopImmediatePropagation(); // Ensure no other listener runs
                
                // Toggle
                const isShown = profileTooltipMenu.classList.contains('show');
                if (isShown) {
                    profileTooltipMenu.classList.remove('show');
                    profileMenuBtn.classList.remove('active');
                } else {
                    profileTooltipMenu.classList.add('show');
                    profileMenuBtn.classList.add('active');
                }
                
                // Close if clicking outside
                const closeHandler = (ev) => {
                    // If click is NOT inside menu AND NOT on the button
                    if (!profileTooltipMenu.contains(ev.target) && !profileMenuBtn.contains(ev.target)) {
                        profileTooltipMenu.classList.remove('show');
                        profileMenuBtn.classList.remove('active');
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
