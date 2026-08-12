/**
 * theme-init.js — Tema por tienda con derivación de superficies y contraste.
 *
 * Aplica ANTES del pintado (head) para evitar flash. Expone
 * window.ThemeColorUtils (reutilizado por app.js/ThemeSystem):
 *   - helpers: hexToRgb, mix, rgbaOf, luminance, contrastText
 *   - brandVariants(cfg): variantes de marca (--primary-dark/light/shadow,
 *     --secondary-light) derivadas del primary/secondary
 *   - darkSurfaces(cfg): superficies del MODO OSCURO teñidas con el color
 *     del negocio (negro azulado, negro cyan...) en vez de negro puro fijo
 *   - apply(cfg, darkMode): aplica marcas + variantes + superficies (solo
 *     si dark) + contraste de texto calculado por luminancia
 *   - clearDerived(): quita superficies inline (para que el CSS base mande)
 */
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

    // ============================================================
    // ThemeColorUtils — utilidades compartidas
    // ============================================================
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
    // Luminancia relativa WCAG (0..1) — "filtro gris" para comparar intensidad
    const luminance = (hex) => {
        const c = hexToRgb(hex);
        if (!c) return 0.5;
        const lin = (v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    };
    // Texto legible sobre un color: oscuro si el fondo es claro, blanco si es oscuro
    const contrastText = (hex) => (luminance(hex) > 0.45 ? '#1a1a1e' : '#ffffff');

    const varMap = {
        'primary_color': '--primary-color',
        'secondary_color': '--secondary-color',
        'success_color': '--success-color',
        'danger_color': '--danger-color',
        'warning_color': '--warning-color',
        'info_color': '--info-color'
    };

    // Variantes de marca derivadas del primary/secondary configurados
    function brandVariants(cfg) {
        const out = {};
        const p = cfg.primary_color, s = cfg.secondary_color;
        if (p) {
            out['--primary-dark'] = mix(p, '#000000', 0.22);
            out['--primary-darker'] = mix(p, '#000000', 0.42);
            out['--primary-light'] = mix(p, '#ffffff', 0.85);
            out['--primary-lighter'] = mix(p, '#ffffff', 0.93);
            out['--primary-shadow'] = rgbaOf(p, 0.22);
            out['--primary-hover'] = mix(p, '#000000', 0.15);
            out['--primary-active'] = mix(p, '#000000', 0.35);
        }
        if (s) out['--secondary-light'] = mix(s, '#ffffff', 0.85);
        return out;
    }

    // Superficies del MODO OSCURO teñidas con el color del negocio.
    // En vez de negro puro (#121212), el fondo es un negro "inspirado" en
    // el tema: negro azulado, negro cyan, etc. Tint = el color con más
    // saturación entre primary y secondary (si el secondary es negro/gris,
    // usa el primary).
    function darkSurfaces(cfg) {
        const p = cfg.primary_color, s = cfg.secondary_color;
        const sat = (hex) => {
            const c = hexToRgb(hex);
            if (!c) return 0;
            return (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255;
        };
        const tint = (s && sat(s) > 0.25) ? s : (p || s || '#1976D2');
        return {
            '--bg-body': mix('#0d0d0f', tint, 0.08),
            '--bg-card': mix('#16161a', tint, 0.12),
            '--bg-light': mix('#1e1e23', tint, 0.10),
            '--bg-lightest': mix('#26262c', tint, 0.10),
            '--dark-color': mix('#0b0b0d', tint, 0.16),
            '--border-color': mix('#2b2b31', tint, 0.14),
            '--text-color': '#e9e9ec',
            '--text-medium': '#c2c2c7',
            '--text-light': '#9a9aa0',
            '--text-muted': '#7a7a80'
        };
    }

    // Aplica TODO al root: marcas + variantes + superficies (solo dark) +
    // contraste de texto sobre colores de marca
    function apply(cfg, darkMode) {
        const root = document.documentElement;
        if (!cfg) return;
        for (const [key, value] of Object.entries(cfg)) {
            if (varMap[key] && value) root.style.setProperty(varMap[key], value);
        }
        const variants = brandVariants(cfg);
        for (const [v, val] of Object.entries(variants)) {
            if (val) root.style.setProperty(v, val);
        }
        // Contraste de texto sobre colores de marca (siempre, claro u oscuro)
        const p = cfg.primary_color, s = cfg.secondary_color;
        if (p) {
            root.style.setProperty('--text-on-primary', contrastText(p));
            root.style.setProperty('--primary-contrast', contrastText(p));
        }
        if (s) root.style.setProperty('--secondary-contrast', contrastText(s));
        // Superficies: SOLO en modo oscuro (en claro manda el CSS de [data-theme])
        if (darkMode) {
            const surfaces = darkSurfaces(cfg);
            for (const [v, val] of Object.entries(surfaces)) {
                if (val) root.style.setProperty(v, val);
            }
        } else {
            clearDerived();
        }
    }

    function clearDerived() {
        const root = document.documentElement;
        ['--bg-body', '--bg-card', '--bg-light', '--bg-lightest', '--dark-color',
         '--border-color', '--text-color', '--text-medium', '--text-light', '--text-muted'
        ].forEach(v => root.style.removeProperty(v));
    }

    window.ThemeColorUtils = { hexToRgb, mix, rgbaOf, luminance, contrastText, brandVariants, darkSurfaces, apply, clearDerived };

    // ============================================================
    // Aplicación inicial (pre-paint)
    // ============================================================
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

            // 2) Marca + variantes + superficies oscuras teñidas + contraste
            window.ThemeColorUtils.apply(themeConfig, darkMode);
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
                window.ThemeColorUtils.apply(cfg, dark);
            } catch (err) { /* noop */ }
        }
    });
})();
