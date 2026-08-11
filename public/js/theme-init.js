(function() {
    // Restore sidebar collapsed state as early as possible to avoid layout flash
    const savedSidebarState = localStorage.getItem('sidebarCollapsed');
    if (savedSidebarState === 'true') {
        document.documentElement.classList.add('sidebar-collapsed');
    }

    // Temporarily disable sidebar transitions during initial paint to prevent jumps
    document.documentElement.classList.add('sidebar-loading');
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            document.documentElement.classList.remove('sidebar-loading');
        });
    });

    // Sistema de temas: claro/oscuro controlado por theme_config.dark_mode.
    // Se aplica ANTES del pintado para evitar flash. Las variables de color
    // (primary, success, etc.) se sobrescriben desde theme_config si vienen.
    let appliedDark = false;
    try {
        const savedTheme = localStorage.getItem('pos_theme_config');
        if (savedTheme) {
            const themeConfig = JSON.parse(savedTheme);

            // 1) Tema oscuro/claro
            const darkMode = themeConfig.dark_mode === true || themeConfig.dark_mode === 'true';
            appliedDark = darkMode;
            document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');

            // 2) Variables de color personalizadas (opcional)
            const varMap = {
                'primary_color': '--primary-color',
                'secondary_color': '--secondary-color',
                'success_color': '--success-color',
                'danger_color': '--danger-color',
                'warning_color': '--warning-color',
                'info_color': '--info-color',
                'dark_color': '--dark-color',
                'bg_body': '--bg-body',
                'text_color': '--text-color',
                'bg_card': '--bg-card',
                'border_color': '--border-color'
            };

            const root = document.documentElement;
            for (const [key, value] of Object.entries(themeConfig)) {
                if (varMap[key] && value) {
                    root.style.setProperty(varMap[key], value);
                }
            }
        }
    } catch (e) {
        console.error('Error applying theme from cache:', e);
    }

    // Tema claro por defecto si no hay configuración guardada
    if (!document.documentElement.hasAttribute('data-theme')) {
        document.documentElement.setAttribute('data-theme', 'light');
    }

    // Escuchar cambios de tema en vivo (cuando el usuario guarda en Perfil)
    window.addEventListener('storage', (e) => {
        if (e.key === 'pos_theme_config') {
            try {
                const cfg = JSON.parse(e.newValue);
                const dark = cfg.dark_mode === true || cfg.dark_mode === 'true';
                document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
            } catch (err) { /* noop */ }
        }
    });
})();
