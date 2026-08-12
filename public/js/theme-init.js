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

    // Aplica TODO al root: marcas + variantes + superficies del config
    // correspondiente al modo + contraste de texto.
    //   cfg      = tema CLARO (marcas + superficies claras)
    //   cfgDark  = tema OSCURO personalizado (opcional; si es null, el
    //              modo oscuro se deriva como sugerencia del claro)
    //   darkMode = modo activo
    function apply(cfg, darkMode, cfgDark) {
        const root = document.documentElement;
        if (!cfg) return;
        const active = darkMode && cfgDark ? cfgDark : cfg;
        // Marca (si el config oscuro no define una marca, hereda del claro)
        const merged = { ...cfg, ...active };
        for (const [key, value] of Object.entries(merged)) {
            if (varMap[key] && value) root.style.setProperty(varMap[key], value);
        }
        const variants = brandVariants(merged);
        for (const [v, val] of Object.entries(variants)) {
            if (val) root.style.setProperty(v, val);
        }
        // Contraste de texto sobre colores de marca (siempre, claro u oscuro)
        const p = merged.primary_color, s = merged.secondary_color;
        if (p) {
            root.style.setProperty('--text-on-primary', contrastText(p));
            root.style.setProperty('--primary-contrast', contrastText(p));
        }
        if (s) root.style.setProperty('--secondary-contrast', contrastText(s));
        // Superficies: en modo oscuro aplica el config oscuro si existe, si no
        // deriva la sugerencia; en claro aplica el config claro (que ya puede
        // traer superficies del usuario) o limpia para que mande el CSS.
        if (darkMode) {
            if (cfgDark) {
                applySurfaces(cfgDark);
            } else {
                const surfaces = darkSurfaces(cfg);
                for (const [v, val] of Object.entries(surfaces)) {
                    if (val) root.style.setProperty(v, val);
                }
            }
        } else {
            // Modo claro: limpiar SIEMPRE las superficies inline (incluidas
            // las derivadas/teñidas del modo oscuro) para que no contaminen
            // el tema claro, y luego aplicar las superficies claras si el
            // config claro las define.
            clearDerived();
            if (cfg && (cfg.bg_body || cfg.bg_card || cfg.dark_color || cfg.text_color || cfg.border_color)) {
                applySurfaces(cfg);
            }
        }
    }

    // Aplica solo variables de superficie desde un config (claro u oscuro)
    function applySurfaces(cfg) {
        const root = document.documentElement;
        const surfaceMap = {
            'dark_color': '--dark-color',
            'bg_body': '--bg-body',
            'bg_card': '--bg-card',
            'bg_light': '--bg-light',
            'text_color': '--text-color',
            'border_color': '--border-color'
        };
        for (const [key, cssVar] of Object.entries(surfaceMap)) {
            if (cfg[key]) root.style.setProperty(cssVar, cfg[key]);
        }
    }

    function clearDerived() {
        const root = document.documentElement;
        ['--bg-body', '--bg-card', '--bg-light', '--bg-lightest', '--dark-color',
         '--border-color', '--text-color', '--text-medium', '--text-light', '--text-muted'
        ].forEach(v => root.style.removeProperty(v));
    }

    window.ThemeColorUtils = { hexToRgb, mix, rgbaOf, luminance, contrastText, brandVariants, darkSurfaces, apply, applySurfaces, clearDerived };

    // ============================================================
    // Aplicación inicial (pre-paint)
    // ============================================================
    let appliedDark = false;
    try {
        const savedTheme = localStorage.getItem('pos_theme_config');
        const savedDark = localStorage.getItem('pos_theme_config_dark');
        if (savedTheme) {
            const themeConfig = JSON.parse(savedTheme);
            const themeConfigDark = savedDark ? JSON.parse(savedDark) : null;

            // 1) Tema oscuro/claro/auto
            const themeMode = themeConfig.theme_mode;
            let darkMode;
            if (themeMode === 'light') darkMode = false;
            else if (themeMode === 'dark') darkMode = true;
            else if (themeMode === 'auto') darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
            else darkMode = themeConfig.dark_mode === true || themeConfig.dark_mode === 'true';
            appliedDark = darkMode;
            document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');

            // 2) Marca + variantes + superficies (claro u oscuro personalizado
            //    si existe; si no, sugerencia derivada) + contraste
            window.ThemeColorUtils.apply(themeConfig, darkMode, themeConfigDark);
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
        if (e.key === 'pos_theme_config' || e.key === 'pos_theme_config_dark') {
            try {
                const cfg = JSON.parse(localStorage.getItem('pos_theme_config') || 'null');
                const cfgDark = JSON.parse(localStorage.getItem('pos_theme_config_dark') || 'null');
                const m = cfg && cfg.theme_mode;
                let dark;
                if (m === 'light') dark = false;
                else if (m === 'dark') dark = true;
                else if (m === 'auto') dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                else dark = !!(cfg && (cfg.dark_mode === true || cfg.dark_mode === 'true'));
                document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
                window.ThemeColorUtils.apply(cfg || {}, dark, cfgDark);
            } catch (err) { /* noop */ }
        }
    });
})();
