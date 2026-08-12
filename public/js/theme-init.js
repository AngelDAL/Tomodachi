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

            // 1) Tema oscuro/claro/auto
            const themeMode = themeConfig.theme_mode;
            let darkMode;
            if (themeMode === 'light') darkMode = false;
            else if (themeMode === 'dark') darkMode = true;
            else if (themeMode === 'auto') darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
            else darkMode = themeConfig.dark_mode === true || themeConfig.dark_mode === 'true';
            appliedDark = darkMode;
            document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');

            // 2) Variables de color personalizadas (opcional)
            // Solo colores de MARCA (no cambian con claro/oscuro). Las superficies
            // (bg-body, text-card, etc.) las controla el CSS de [data-theme].
            const varMap = {
                'primary_color': '--primary-color',
                'secondary_color': '--secondary-color',
                'success_color': '--success-color',
                'danger_color': '--danger-color',
                'warning_color': '--warning-color',
                'info_color': '--info-color'
            };

            // Derivar variantes de marca (--primary-dark/light/shadow,
            // --secondary-light) del primary/secondary configurados — sin esto
            // un tema personalizado deja las variantes con el CSS base.
            const hexToRgb = (hex) => {
                const h = String(hex || '').replace('#', '');
                if (h.length < 6) return null;
                return { r: parseInt(h.substring(0, 2), 16), g: parseInt(h.substring(2, 4), 16), b: parseInt(h.substring(4, 6), 16) };
            };
            const mix = (hex, targetHex, ratio) => {
                const c = hexToRgb(hex), t = hexToRgb(targetHex);
                if (!c || !t) return null;
                const ch = (v) => Math.round(v).toString(16).padStart(2, '0');
                return '#' + ch(c.r + (t.r - c.r) * ratio) + ch(c.g + (t.g - c.g) * ratio) + ch(c.b + (t.b - c.b) * ratio);
            };
            const rgbaOf = (hex, alpha) => {
                const c = hexToRgb(hex);
                return c ? `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})` : null;
            };

            const root = document.documentElement;
            for (const [key, value] of Object.entries(themeConfig)) {
                if (varMap[key] && value) {
                    root.style.setProperty(varMap[key], value);
                }
            }
            // Variantes derivadas del primary/secondary si vienen en la config
            const p = themeConfig.primary_color, s = themeConfig.secondary_color;
            const variants = {};
            if (p) {
                variants['--primary-dark'] = mix(p, '#000000', 0.22);
                variants['--primary-darker'] = mix(p, '#000000', 0.42);
                variants['--primary-light'] = mix(p, '#ffffff', 0.85);
                variants['--primary-lighter'] = mix(p, '#ffffff', 0.93);
                variants['--primary-shadow'] = rgbaOf(p, 0.22);
            }
            if (s) variants['--secondary-light'] = mix(s, '#ffffff', 0.85);
            for (const [v, val] of Object.entries(variants)) {
                if (val) root.style.setProperty(v, val);
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
                const m = cfg.theme_mode;
                let dark;
                if (m === 'light') dark = false;
                else if (m === 'dark') dark = true;
                else if (m === 'auto') dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                else dark = cfg.dark_mode === true || cfg.dark_mode === 'true';
                document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
            } catch (err) { /* noop */ }
        }
    });
})();
