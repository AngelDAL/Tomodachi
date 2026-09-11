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
    function brandVariants(cfg, darkMode) {
        const out = {};
        const p = cfg.primary_color, s = cfg.secondary_color;
        if (p) {
            out['--primary-dark'] = mix(p, '#000000', 0.22);
            out['--primary-darker'] = mix(p, '#000000', 0.42);
            // Las variantes "claras" se usan como FONDO de tarjetas/badges
            // (profit-item.highlight, drawer-tab.active, summary-chip, etc.).
            // En modo claro se derivan hacia blanco (fondo suave); en modo
            // oscuro hay que derivarlas hacia el OSCURO, o esas tarjetas
            // quedan con fondo casi blanco sobre el tema dark.
            if (darkMode) {
                // Se derivan hacia el oscuro BASE del tema (azul-teal), no hacia
                // un negro grisáceo, para que las tarjetas y badges con fondo
                // "claro" de marca sigan la misma familia que el resto.
                out['--primary-light'] = mix(p, '#162022', 0.84);
                out['--primary-lighter'] = mix(p, '#1D282B', 0.90);
            } else {
                out['--primary-light'] = mix(p, '#ffffff', 0.85);
                out['--primary-lighter'] = mix(p, '#ffffff', 0.93);
            }
            out['--primary-shadow'] = rgbaOf(p, 0.22);
            out['--primary-hover'] = mix(p, '#000000', 0.15);
            out['--primary-active'] = mix(p, '#000000', 0.35);
        }
        if (s) out['--secondary-light'] = darkMode ? mix(s, '#1D282B', 0.86) : mix(s, '#ffffff', 0.85);
        return out;
    }

    // Superficies del MODO OSCURO teñidas con el color del negocio.
    // La base NO es gris neutro: es un azul-teal muy oscuro (la misma familia
    // que el #f4f7f6 del tema claro, del lado oscuro), y encima se tiñe con el
    // color de marca. Así el modo oscuro se siente de la casa y no un gris frío.
    // Tint = el color con más saturación entre primary y secondary (si el
    // secondary es negro/gris, usa el primary).
    function darkSurfaces(cfg) {
        const p = cfg.primary_color, s = cfg.secondary_color;
        const sat = (hex) => {
            const c = hexToRgb(hex);
            if (!c) return 0;
            return (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255;
        };
        const tint = (s && sat(s) > 0.25) ? s : (p || s || '#0E86A6');
        // Rampa base (tono 192) — espejo del tema claro
        const base = {
            body: mix('#0D1516', tint, 0.10),
            card: mix('#162022', tint, 0.10),
            light: mix('#1D282B', tint, 0.10),
            lighter: mix('#212D30', tint, 0.10),
            lightest: mix('#273235', tint, 0.10),
            input: mix('#182325', tint, 0.10),
            dark: mix('#0A1012', tint, 0.14),
            border: mix('#2D3B3E', tint, 0.12),
            borderLight: mix('#252F31', tint, 0.12),
            borderLighter: mix('#1F2728', tint, 0.12),
            hover: mix('#1F2B2E', tint, 0.10)
        };
        return {
            '--bg-body': base.body,
            '--bg-card': base.card,
            '--bg-light': base.light,
            '--bg-lighter': base.lighter,
            '--bg-lightest': base.lightest,
            '--bg-input': base.input,
            '--bg-hover': base.hover,
            '--dark-color': base.dark,
            '--border-color': base.border,
            '--border-light': base.borderLight,
            '--border-lighter': base.borderLighter,
            '--text-color': '#E4F0EF',
            // Jerarquía escalonada verificada: cada tono pasa 4.5:1 incluso en la
            // superficie más clara del tema (el pie del carrito, #253A40).
            '--text-medium': '#BCCED0',
            '--text-light': '#A8BABC',
            '--text-muted': '#93A7A9',
            // El difuminado de las imágenes de producto va del color del fondo,
            // así que se deriva del mismo valor (antes quedaba en gris #121212)
            '--overlay-fade': rgbaOf(base.body, 0),
            '--overlay-fade-mid': rgbaOf(base.body, 0.35),
            '--overlay-fade-solid': rgbaOf(base.body, 0.55)
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
        const variants = brandVariants(merged, darkMode);
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
        // IMPORTANTE: aquí va TODO lo que darkSurfaces() llega a escribir inline.
        // Si algo se queda fuera, al volver al tema claro esa superficie se
        // quedaba con el valor del oscuro (contaminaba el tema claro).
        ['--bg-body', '--bg-card', '--bg-light', '--bg-lighter', '--bg-lightest',
         '--bg-input', '--bg-hover', '--dark-color',
         '--border-color', '--border-light', '--border-lighter',
         '--overlay-fade', '--overlay-fade-mid', '--overlay-fade-solid',
         '--text-color', '--text-medium', '--text-light', '--text-muted'
        ].forEach(v => root.style.removeProperty(v));
    }

    window.ThemeColorUtils = { hexToRgb, mix, rgbaOf, luminance, contrastText, brandVariants, darkSurfaces, apply, applySurfaces, clearDerived, DARK_CONFIG_VERSION: 2 };

    // Versión del modo oscuro. Los temas oscuros guardados por el usuario
    // (localStorage 'pos_theme_config_dark' / stores.theme_config_dark) que NO
    // traigan esta marca son de antes de rediseñar el oscuro, cuando usaba
    // grises fríos (#121212, #1E1E1E) desconectados del tema claro. Se ignoran
    // para que entre el oscuro derivado del tema claro actual.
    // Al subir de versión aquí, los personalizados viejos se descartan solos.
    const DARK_CONFIG_VERSION = 2;

    // ============================================================
    // Aplicación inicial (pre-paint)
    // ============================================================
    let appliedDark = false;
    try {
        const savedTheme = localStorage.getItem('pos_theme_config');
        const savedDark = localStorage.getItem('pos_theme_config_dark');
        if (savedTheme) {
            const themeConfig = JSON.parse(savedTheme);
            let themeConfigDark = savedDark ? JSON.parse(savedDark) : null;
            if (themeConfigDark && themeConfigDark._v !== DARK_CONFIG_VERSION) {
                // Oscuro personalizado obsoleto (de antes del rediseño): se borra
                // del navegador, no solo se ignora, para que el resto de lectores
                // (app.js, sales.js, el cambio de modo del menú) tampoco lo vean.
                themeConfigDark = null;
                try { localStorage.removeItem('pos_theme_config_dark'); } catch (e) { /* noop */ }
            }

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
