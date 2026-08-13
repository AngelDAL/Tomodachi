document.addEventListener('DOMContentLoaded', async () => {
    const session = await checkSession();
    if (!session) { requireSession(); return; }

    // Cargar datos del perfil
    loadProfile();

    // Si es admin, mostrar pestañas extra
    if (session.role === 'admin') {
        document.getElementById('companyTabBtn').style.display = 'inline-block';
        document.getElementById('usersTabBtn').style.display = 'inline-block';
        loadCompanySettings();
        loadUsers();
    }

    // Color picker sync & Real-time preview (CLARO y OSCURO)
    attachThemeLivePreview('themeControls');
    attachThemeLivePreview('themeControlsDark');

    // Logo upload
    const logoInput = document.getElementById('companyLogoInput');
    if (logoInput) {
        logoInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('logo', file);

            // try {
            const res = await fetch('../api/stores/upload_logo.php', {
                method: 'POST',
                body: formData
            });
            const result = await res.json();
            if (result.success) {
                document.getElementById('companyLogoPreview').src = result.data.logo_url;
                // Actualizar también el logo del navbar
                const navLogo = document.getElementById('navStoreLogo');
                if (navLogo) navLogo.src = result.data.logo_url;
                showNotification('Logo actualizado correctamente', 'success');
            } else {
                showNotification(result.message || 'Error al subir logo', 'error');
            }
            // } catch (error) {
            //     console.error(error);
            //     showNotification('Error de conexión al subir logo', 'error');
            // }
        });
    }

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', async (e) => {
        e.preventDefault();
        await logout();
    });

    // Excel Import
    // const btnImport = document.getElementById('btnImportExcel'); // Removed old button logic
    // if (btnImport) {
    //    btnImport.addEventListener('click', handleImportExcel);
    // }

    // Auto-open import modal on file selection
    const fileInput = document.getElementById('importExcelInput');
    if (fileInput) {
        fileInput.addEventListener('change', handleImportExcel);
    }

    // Close guide modal when clicking outside
    const guideModal = document.getElementById('importGuideModal');
    if (guideModal) {
        guideModal.addEventListener('click', (e) => {
            if (e.target === guideModal) {
                closeImportGuide();
            }
        });
    }
});

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

    document.getElementById(tabId).classList.add('active');
    // Encontrar el botón correspondiente (un poco hacky pero funciona)
    const btn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick').includes(tabId));
    if (btn) btn.classList.add('active');
}

async function loadProfile() {
    try {
        const res = await fetch('../api/users/profile.php');
        const data = await res.json();
        if (data.success) {
            const user = data.data;
            const form = document.getElementById('profileForm');
            form.full_name.value = user.full_name;
            form.email.value = user.email || '';
            form.phone.value = user.phone || '';
            document.getElementById('userRoleDisplay').value = user.role.toUpperCase();

            // Onboarding setting
            const onboardingCheck = document.getElementById('showOnboarding');
            if (onboardingCheck) {
                onboardingCheck.checked = user.show_onboarding !== undefined ? !!Number(user.show_onboarding) : true;
            }
        }
    } catch (error) {
        console.error('Error loading profile:', error);
    }
}

document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());

    // Handle checkbox explicitly
    data.show_onboarding = document.getElementById('showOnboarding').checked;

    try {
        const res = await fetch('../api/users/profile.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.success) {
            showNotification('Perfil actualizado correctamente', 'success');
            e.target.password.value = '';
            e.target.current_password.value = '';
        } else {
            showNotification(result.message || 'Error al actualizar', 'error');
        }
    } catch (error) {
        showNotification('Error de conexión', 'error');
    }
});

async function loadCompanySettings() {
    try {
        const res = await fetch('../api/stores/settings.php');
        const data = await res.json();
        if (data.success) {
            const store = data.data;
            const form = document.getElementById('companyForm');
            form.store_name.value = store.store_name;
            form.phone.value = store.phone || '';
            form.address.value = store.address || '';

            if (store.logo_url) {
                document.getElementById('companyLogoPreview').src = store.logo_url;
            }

            // Cargar configuración de negocio
            if (store.settings) {
                document.getElementById('allowNegativeStock').checked = !!store.settings.allow_negative_stock;
                document.getElementById('requireOpenRegister').checked = !!store.settings.require_open_register;
                // Cargar formato regional
                loadFormatConfig(store.settings.format || null);
            }

            // Cargar configuración de tema (claro + oscuro personalizado)
            const themeConfig = store.theme_config || {};
            const themeConfigDark = store.theme_config_dark || null;
            const savedDark = !!themeConfigDark;
            // Si la BD ya tiene un oscuro personalizado, se preserva al
            // guardar (el usuario lo personalizó en otra sesión).
            if (savedDark) darkThemeTouched = true;
            // Mantener el config activo para que ThemeSystem.apply() pueda
            // re-aplicar marcas + superficies al cambiar de modo claro/oscuro
            // (en tiendas SIN theme_config en BD, loadStoreSettings no llama
            // applyTheme y __activeThemeConfig quedaría undefined → al pulsar
            // el botón de modo solo cambiaba data-theme sin re-aplicar nada).
            window.__activeThemeConfig = themeConfig;
            window.__activeThemeConfigDark = themeConfigDark;

            // Modo de tema: respetar preferencia local del usuario (ThemeSystem)
            // Si el usuario ya eligió un modo en el sidebar, ese tiene prioridad.
            // Si no, usar la config de la BD.
            const localMode = window.ThemeSystem ? window.ThemeSystem.getMode() : null;
            const savedMode = localMode || themeConfig.theme_mode
                || (themeConfig.dark_mode === true || themeConfig.dark_mode === 'true' ? 'dark'
                    : themeConfig.dark_mode === false || themeConfig.dark_mode === 'false' ? 'light' : 'auto');
            if (window.ThemeSystem) {
                window.ThemeSystem.setMode(savedMode);
            }
            updateThemeModeButtons(savedMode);
            updateThemeModeLabel(savedMode === 'dark' ? 'Oscuro' : savedMode === 'light' ? 'Claro' : 'Automático');

            // Cargar valores en los controles del tema CLARO
            const themeControls = document.getElementById('themeControls');
            const inputs = themeControls.querySelectorAll('input[type="color"]');
            const liveVars = ['--primary-color', '--secondary-color', '--success-color', '--danger-color',
                             '--warning-color', '--info-color', '--dark-color', '--bg-body', '--text-color',
                             '--bg-card', '--border-color'];
            // Leer los valores "vivos" del modo CLARO puro (no del estado
            // actual del documento, que puede estar en modo oscuro — si no,
            // los inputs claros se rellenarían con superficies del dark y al
            // volver a la pestaña Claro el sistema "se quedaría con el tema
            // oscuro cargado").
            const liveMap = {};
            liveVars.forEach(v => {
                liveMap[v] = readThemeVarInMode(v, 'light');
            });

            inputs.forEach(input => {
                const cssVar = input.getAttribute('data-var');
                const key = input.name;
                if (themeConfig[key]) {
                    const color = themeConfig[key];
                    input.value = color;
                    if (input.nextElementSibling) input.nextElementSibling.value = color;
                } else {
                    const live = liveMap[cssVar];
                    if (live && /^#[0-9a-fA-F]{6}$/.test(live)) {
                        input.value = live;
                        if (input.nextElementSibling) input.nextElementSibling.value = live;
                    } else if (input.nextElementSibling) {
                        input.nextElementSibling.value = input.value;
                    }
                }
            });

            // Cargar valores en los controles del tema OSCURO (si el usuario
            // definió uno); si no, dejar los valores por defecto del CSS oscuro
            // para que "Sugerir oscuro" los rellene desde el claro.
            const darkControls = document.getElementById('themeControlsDark');
            if (darkControls) {
                const darkInputs = darkControls.querySelectorAll('input[type="color"]');
                const darkLiveVars = ['--bg-body', '--bg-card', '--dark-color', '--text-color', '--border-color'];
                const darkLiveMap = {};
                darkLiveVars.forEach(v => {
                    darkLiveMap[v] = readThemeVarInMode(v, 'dark');
                });
                darkInputs.forEach(input => {
                    const cssVar = input.getAttribute('data-var');
                    const key = input.name.replace(/_dark$/, '');
                    if (themeConfigDark && themeConfigDark[key]) {
                        const color = themeConfigDark[key];
                        input.value = color;
                        if (input.nextElementSibling) input.nextElementSibling.value = color;
                    } else if (savedDark) {
                        // El usuario definió un oscuro pero sin esta clave → derivar
                        const base = themeConfig.primary_color || '#1976D2';
                        if (key === 'primary_color') { input.value = base; if (input.nextElementSibling) input.nextElementSibling.value = base; }
                        else if (input.nextElementSibling) { input.nextElementSibling.value = input.value; }
                    } else {
                        // Sin oscuro definido: por defecto, sugerencia derivada del claro
                        if (window.ThemeColorUtils) {
                            const sug = window.ThemeColorUtils.darkSurfaces(themeConfig);
                            const sugMap = { dark_color: '--dark-color', bg_body: '--bg-body', bg_card: '--bg-card', text_color: '--text-color', border_color: '--border-color' };
                            const v = sugMap[key];
                            if (v && sug[v]) {
                                input.value = sug[v];
                                if (input.nextElementSibling) input.nextElementSibling.value = sug[v];
                            } else if (themeConfig[key]) {
                                // Marcas: la sugerencia oscura hereda las del claro
                                input.value = themeConfig[key];
                                if (input.nextElementSibling) input.nextElementSibling.value = themeConfig[key];
                            } else {
                                const live = darkLiveMap[cssVar];
                                if (live && /^#[0-9a-fA-F]{6}$/.test(live)) {
                                    input.value = live;
                                    if (input.nextElementSibling) input.nextElementSibling.value = live;
                                }
                            }
                        } else if (input.nextElementSibling) {
                            input.nextElementSibling.value = input.value;
                        }
                    }
                });
            }

            // Pestañas Claro/Oscuro
            initThemeTabs();

            // Sincronizar la pestaña del editor con el modo real guardado:
            // si el modo es oscuro, activar la pestaña Oscuro para que el
            // preview muestre el oscuro desde el inicio (y no contamine el
            // claro al volver). Si es claro/auto, dejar la pestaña Claro y
            // aplicar el preview del tema claro limpiando residuos.
            if (savedMode === 'dark') {
                const darkTabBtn = document.querySelector('.theme-tab-btn[data-theme-tab="dark"]');
                if (darkTabBtn) darkTabBtn.click();
                else applyActiveThemePreview();
            } else {
                applyActiveThemePreview();
            }
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

// ==========================================
// Preview en vivo del editor de temas (claro Y oscuro)
// ==========================================

// El usuario tocó/personalizó el tema oscuro (flag global). Se usa al
// guardar para NO persistir la sugerencia derivada automáticamente.
let darkThemeTouched = false;

// Lee el valor CSS que tendría una variable en el MODO indicado ('light' o
// 'dark'), aunque el documento esté en el otro modo con superficies inline
// aplicadas (ThemeColorUtils). Limpia temporalmente las superficies inline
// del modo activo, fuerza data-theme, lee y restaura — así los inputs del
// claro nunca se rellenan con valores del oscuro (y viceversa).
function readThemeVarInMode(cssVar, mode) {
    const root = document.documentElement;
    const prevTheme = root.getAttribute('data-theme');
    const surfaceVars = ['--bg-body', '--bg-card', '--bg-light', '--bg-lightest', '--dark-color',
                         '--border-color', '--text-color', '--text-medium', '--text-light', '--text-muted'];
    const saved = {};
    surfaceVars.forEach(v => {
        const val = root.style.getPropertyValue(v);
        if (val) saved[v] = val;
        root.style.removeProperty(v);
    });
    root.setAttribute('data-theme', mode);
    let val = '';
    try { val = getComputedStyle(root).getPropertyValue(cssVar).trim(); } catch (e) {}
    root.setAttribute('data-theme', prevTheme || 'light');
    surfaceVars.forEach(v => {
        if (saved[v]) root.style.setProperty(v, saved[v]);
    });
    return val;
}

// Pestaña activa del editor: 'light' | 'dark' (la que el usuario está editando)
function getActiveThemeTab() {
    const tab = document.querySelector('.theme-tab-btn.active');
    return tab ? tab.getAttribute('data-theme-tab') : 'light';
}

// Sincroniza la pestaña del editor (Claro/Oscuro) con el modo indicado
function syncEditorTab(which) {
    const tabs = document.querySelectorAll('.theme-tab-btn');
    const light = document.getElementById('themeControls');
    const dark = document.getElementById('themeControlsDark');
    if (!tabs.length || !light || !dark) return;
    tabs.forEach(t => {
        const active = t.getAttribute('data-theme-tab') === which;
        t.classList.toggle('active', active);
        t.style.background = active ? 'var(--primary-color)' : 'transparent';
        t.style.color = active ? '#fff' : 'inherit';
    });
    light.style.display = which === 'light' ? 'grid' : 'none';
    dark.style.display = which === 'dark' ? 'grid' : 'none';
}

// Aplica el config del tema del MODO GLOBAL (ThemeSystem) al preview real.
// SIEMPRE se deriva de los inputs del editor (claro Y oscuro por separado) —
// nunca de window.__activeThemeConfig (BD), para que las ediciones sin
// guardar se respeten al alternar modos y un tema nunca contamine al otro.
// "Primero cargar el tema destino completo, luego modificar solo ese."
function applyActiveThemePreview() {
    if (!window.ThemeColorUtils) return;
    const mode = window.ThemeSystem ? window.ThemeSystem.getMode() : 'light';
    const dark = mode === 'dark' || (mode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const cfg = collectThemeConfig(false);
    const cfgDark = collectThemeConfig(true);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    window.ThemeColorUtils.apply(cfg, dark, cfgDark);
}

// Hook para ThemeSystem: al cambiar el modo global (botones Claro/Oscuro/
// Auto), aplicar el tema desde los INPUTS del editor y sincronizar la
// pestaña — así el preview refleja lo que el usuario está editando y la
// pestaña/botones de modo nunca quedan desincronizados.
function applyEditorTheme(mode) {
    if (!window.ThemeColorUtils) return;
    const dark = mode === 'dark' || (mode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    const cfg = collectThemeConfig(false);
    const cfgDark = collectThemeConfig(true);
    window.ThemeColorUtils.apply(cfg, dark, cfgDark);
    syncEditorTab(dark ? 'dark' : 'light');
}
window.__editorThemeApply = applyEditorTheme;

// Conecta los color-pickers de un contenedor (claro u oscuro) al preview en vivo
function attachThemeLivePreview(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const isDarkContainer = containerId === 'themeControlsDark';
    container.querySelectorAll('input[type="color"]').forEach(input => {
        const textInput = input.nextElementSibling;

        input.addEventListener('input', (e) => {
            const val = e.target.value;
            if (isDarkContainer) darkThemeTouched = true;
            if (textInput) textInput.value = val;
            applyActiveThemePreview();
        });

        textInput.addEventListener('input', (e) => {
            const val = e.target.value;
            if (/^#[0-9A-F]{6}$/i.test(val)) {
                if (isDarkContainer) darkThemeTouched = true;
                input.value = val;
                applyActiveThemePreview();
            }
        });

        if (!textInput.value) textInput.value = input.value;
    });
}

// Pestañas Claro/Oscuro de Personalización + botón "Sugerir oscuro"
function initThemeTabs() {
    const tabs = document.querySelectorAll('.theme-tab-btn');
    const light = document.getElementById('themeControls');
    const dark = document.getElementById('themeControlsDark');
    if (!tabs.length || !light || !dark) return;

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const which = tab.getAttribute('data-theme-tab');
            syncEditorTab(which);
            // Sincronizar el modo global con la pestaña: editar el tema
            // Oscuro carga/visualiza el oscuro, y viceversa (el usuario
            // modifica solo el tema que está visualizando).
            if (window.ThemeSystem) {
                window.ThemeSystem.setMode(which); // 'light' | 'dark'
            } else {
                applyActiveThemePreview();
            }
        });
    });

    const suggestBtn = document.getElementById('suggestDarkBtn');
    if (suggestBtn) {
        suggestBtn.addEventListener('click', () => {
            const cfg = collectThemeConfig();
            if (!window.ThemeColorUtils) return;
            const sug = window.ThemeColorUtils.darkSurfaces(cfg);
            const brandVars = ['primary_color', 'secondary_color', 'success_color', 'danger_color', 'warning_color', 'info_color'];
            const sugMap = { dark_color: '--dark-color', bg_body: '--bg-body', bg_card: '--bg-card', text_color: '--text-color', border_color: '--border-color' };
            const darkInputs = dark.querySelectorAll('input[type="color"]');
            darkInputs.forEach(input => {
                const key = input.name.replace(/_dark$/, '');
                let val = null;
                if (brandVars.includes(key)) {
                    val = cfg[key] || null;
                } else {
                    const v = sugMap[key];
                    if (v && sug[v]) val = sug[v];
                }
                if (val) {
                    input.value = val;
                    if (input.nextElementSibling) input.nextElementSibling.value = val;
                }
            });
            const cfgDark = collectThemeConfig(true);
            // Marcar que el usuario personalizó el oscuro (usa la sugerencia
            // como base editable) — se persistirá al guardar.
            darkThemeTouched = true;
            // Cambiar a la pestaña Oscuro para que el preview muestre la
            // sugerencia en modo oscuro (sin contaminar el tema claro).
            const darkTabBtn = document.querySelector('.theme-tab-btn[data-theme-tab="dark"]');
            if (darkTabBtn) darkTabBtn.click();
            else applyActiveThemePreview();
            showNotification('Sugerencia de tema oscuro generada desde el claro', 'info');
        });
    }
}

// Recolecta el config del tema claro (dark=false) u oscuro (dark=true)
function collectThemeConfig(dark) {
    const id = dark ? 'themeControlsDark' : 'themeControls';
    const container = document.getElementById(id);
    if (!container) return {};
    const cfg = {};
    container.querySelectorAll('input[type="color"]').forEach(inp => {
        const key = inp.name.replace(/_dark$/, '');
        cfg[key] = inp.value;
    });
    return cfg;
}

// ============================================================
// Formato Regional (números, moneda, fechas)
// ============================================================

const FORMAT_PRESETS = {
    MX: { currency_code: 'MXN', currency_symbol: '$', symbol_position: 'before', thousands_sep: ',', decimal_sep: '.', decimals: 2, date_format: 'DD/MM/YYYY', time_format: '24h', locale: 'es-MX' },
    CO: { currency_code: 'COP', currency_symbol: '$', symbol_position: 'before', thousands_sep: '.', decimal_sep: ',', decimals: 0, date_format: 'DD/MM/YYYY', time_format: '24h', locale: 'es-CO' },
    US: { currency_code: 'USD', currency_symbol: '$', symbol_position: 'before', thousands_sep: ',', decimal_sep: '.', decimals: 2, date_format: 'MM/DD/YYYY', time_format: '12h', locale: 'en-US' },
    ES: { currency_code: 'EUR', currency_symbol: '€', symbol_position: 'before', thousands_sep: '.', decimal_sep: ',', decimals: 2, date_format: 'DD/MM/YYYY', time_format: '24h', locale: 'es-ES' },
    AR: { currency_code: 'ARS', currency_symbol: '$', symbol_position: 'before', thousands_sep: '.', decimal_sep: ',', decimals: 2, date_format: 'DD/MM/YYYY', time_format: '24h', locale: 'es-AR' },
    JP: { currency_code: 'JPY', currency_symbol: '¥', symbol_position: 'before', thousands_sep: ',', decimal_sep: '.', decimals: 0, date_format: 'YYYY-MM-DD', time_format: '24h', locale: 'ja-JP' },
    BR: { currency_code: 'BRL', currency_symbol: 'R$', symbol_position: 'before', thousands_sep: '.', decimal_sep: ',', decimals: 2, date_format: 'DD/MM/YYYY', time_format: '24h', locale: 'pt-BR' }
};

function readFormatForm() {
    return {
        currency_code: (document.getElementById('formatCurrencyCode').value || 'MXN').toUpperCase(),
        currency_symbol: document.getElementById('formatCurrencySymbol').value || '$',
        symbol_position: document.getElementById('formatSymbolPosition').value,
        thousands_sep: document.getElementById('formatThousandsSep').value,
        decimal_sep: document.getElementById('formatDecimalSep').value,
        decimals: (() => { const v = parseInt(document.getElementById('formatDecimals').value, 10); return isNaN(v) ? 2 : v; })(),
        date_format: document.getElementById('formatDateFormat').value,
        time_format: document.getElementById('formatTimeFormat').value,
        locale: FORMAT_PRESETS[document.getElementById('formatPreset').value] ? FORMAT_PRESETS[document.getElementById('formatPreset').value].locale : 'es-MX'
    };
}

function applyFormatForm(cfg) {
    if (!cfg) cfg = {};
    document.getElementById('formatCurrencyCode').value = cfg.currency_code || 'MXN';
    document.getElementById('formatCurrencySymbol').value = cfg.currency_symbol || '$';
    document.getElementById('formatSymbolPosition').value = cfg.symbol_position || 'before';
    document.getElementById('formatThousandsSep').value = cfg.thousands_sep || ',';
    document.getElementById('formatDecimalSep').value = cfg.decimal_sep || '.';
    document.getElementById('formatDecimals').value = String(cfg.decimals === undefined ? 2 : cfg.decimals);
    document.getElementById('formatDateFormat').value = cfg.date_format || 'DD/MM/YYYY';
    document.getElementById('formatTimeFormat').value = cfg.time_format || '24h';
    // Detectar preset que coincida (si aplica)
    let preset = '';
    for (const [key, p] of Object.entries(FORMAT_PRESETS)) {
        if (JSON.stringify(p) === JSON.stringify({
            currency_code: cfg.currency_code || 'MXN',
            currency_symbol: cfg.currency_symbol || '$',
            symbol_position: cfg.symbol_position || 'before',
            thousands_sep: cfg.thousands_sep || ',',
            decimal_sep: cfg.decimal_sep || '.',
            decimals: cfg.decimals === undefined ? 2 : cfg.decimals,
            date_format: cfg.date_format || 'DD/MM/YYYY',
            time_format: cfg.time_format || '24h',
            locale: cfg.locale || 'es-MX'
        })) { preset = key; break; }
    }
    document.getElementById('formatPreset').value = preset;
    updateFormatPreview();
}

function updateFormatPreview() {
    const preview = document.getElementById('formatPreview');
    if (!preview) return;
    const cfg = readFormatForm();
    if (window.FormatUtils) {
        window.FormatUtils.init(cfg);
        const sampleDate = new Date(2026, 7, 13, 14, 30);
        preview.innerHTML = `
            <div style="display:flex; flex-wrap:wrap; gap:1rem; align-items:center;">
                <span><strong>Moneda:</strong> ${window.FormatUtils.currency(1234567.89)}</span>
                <span><strong>Número:</strong> ${window.FormatUtils.number(1234567.89)}</span>
                <span><strong>Fecha:</strong> ${window.FormatUtils.date(sampleDate)}</span>
            </div>`;
    } else {
        preview.textContent = 'Formato: ' + cfg.currency_symbol + ' 1,234.56 · ' + cfg.date_format;
    }
}

function loadFormatConfig(cfg) {
    applyFormatForm(cfg);
}

// Preset al cambiar el select
const formatPresetSel = document.getElementById('formatPreset');
if (formatPresetSel) {
    formatPresetSel.addEventListener('change', () => {
        const preset = FORMAT_PRESETS[formatPresetSel.value];
        if (preset) {
            document.getElementById('formatCurrencyCode').value = preset.currency_code;
            document.getElementById('formatCurrencySymbol').value = preset.currency_symbol;
            document.getElementById('formatSymbolPosition').value = preset.symbol_position;
            document.getElementById('formatThousandsSep').value = preset.thousands_sep;
            document.getElementById('formatDecimalSep').value = preset.decimal_sep;
            document.getElementById('formatDecimals').value = String(preset.decimals);
            document.getElementById('formatDateFormat').value = preset.date_format;
            document.getElementById('formatTimeFormat').value = preset.time_format;
        }
        updateFormatPreview();
    });
    // Preview en vivo al cambiar cualquier campo
    ['formatCurrencyCode', 'formatCurrencySymbol', 'formatSymbolPosition',
     'formatThousandsSep', 'formatDecimalSep', 'formatDecimals',
     'formatDateFormat', 'formatTimeFormat'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', updateFormatPreview);
    });
}

document.getElementById('companyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);

    // Recolectar configuración de tema — AHORA se guardan TODAS las
    // variables (marcas + superficies) del tema claro y del tema oscuro.
    // El modo oscuro puede definirse por separado por el usuario; si no lo
    // define, el frontend deriva una sugerencia (theme_config_dark null).
    const themeConfig = collectThemeConfig(false);
    const themeConfigDark = collectThemeConfig(true);

    // Modo de tema (light/dark/auto)
    const activeModeBtn = document.querySelector('.theme-mode-btn.active');
    const themeMode = activeModeBtn ? activeModeBtn.getAttribute('data-mode') : (window.ThemeSystem ? window.ThemeSystem.getMode() : 'auto');
    if (themeMode) {
        themeConfig.theme_mode = themeMode;
        if (themeMode === 'dark') themeConfig.dark_mode = true;
        else if (themeMode === 'light') themeConfig.dark_mode = false;
        else delete themeConfig.dark_mode;
    }

    // Si el usuario NO personalizó el tema oscuro (no tocó sus inputs ni
    // usó "Sugerir oscuro"), NO lo guardamos — el frontend deriva la
    // sugerencia en vivo desde el claro. Solo se persiste si realmente lo
    // personalizó (o ya había uno guardado de antes).
    let persistDark = null;
    if (darkThemeTouched && themeConfigDark && Object.keys(themeConfigDark).length) {
        persistDark = themeConfigDark;
    }

    // Recolectar configuración de negocio
    const settings = {
        allow_negative_stock: document.getElementById('allowNegativeStock').checked,
        require_open_register: document.getElementById('requireOpenRegister').checked,
        format: readFormatForm()
    };

    const data = {
        store_name: formData.get('store_name'),
        phone: formData.get('phone'),
        address: formData.get('address'),
        theme_config: themeConfig,
        theme_config_dark: persistDark,
        settings: settings
    };

    try {
        const res = await fetch('../api/stores/settings.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.success) {
            showNotification('Configuración guardada', 'success');
            // Aplicar en vivo el tema guardado (modo actual) y refrescar caché
            if (window.__activeThemeConfig) {
                window.__activeThemeConfig = themeConfig;
                window.__activeThemeConfigDark = persistDark;
                applyActiveThemePreview();
            }
            localStorage.setItem('pos_theme_config', JSON.stringify(themeConfig));
            if (persistDark) localStorage.setItem('pos_theme_config_dark', JSON.stringify(persistDark));
            else localStorage.removeItem('pos_theme_config_dark');
        } else {
            showNotification(result.message, 'error');
        }
    } catch (error) {
        showNotification('Error de conexión', 'error');
    }
});

async function loadUsers() {
    try {
        // Obtener store_id de la sesión actual (o del perfil cargado)
        // Como es admin, read.php sin params devuelve todos, pero queremos filtrar por store si el backend lo requiere
        // El backend de read.php usa session store_id si no es admin global.
        // Asumimos que el admin logueado es admin de SU tienda.
        const session = await checkSession();
        const res = await fetch(`../api/users/read.php?store_id=${session.store_id}`);
        const data = await res.json();

        if (data.success) {
            const tbody = document.getElementById('usersList');
            tbody.innerHTML = '';
            data.data.forEach(user => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td data-label="Usuario">${user.username}</td>
                    <td data-label="Nombre">${user.full_name}</td>
                    <td data-label="Email">${user.email || '-'}</td>
                    <td data-label="Rol"><span class="badge badge-${user.role}">${user.role}</span></td>
                    <td data-label="Estado"><span class="badge badge-${user.status === 'active' ? 'success' : 'danger'}">${user.status === 'active' ? 'Activo' : 'Inactivo'}</span></td>
                    <td data-label="Acciones">
                        ${user.role !== 'admin' ? 
                            (user.status === 'active' 
                                ? `<button class="btn-icon" onclick="confirmToggleUserStatus(${user.user_id}, 'inactive')" title="Desactivar"><i class="fas fa-trash"></i></button>`
                                : `<button class="btn-icon" onclick="confirmToggleUserStatus(${user.user_id}, 'active')" title="Activar" style="color: var(--success-color);"><i class="fas fa-check-circle"></i></button>`
                            ) 
                        : ''}
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

function showCreateUserModal() {
    document.getElementById('userModal').style.display = 'block';
}

function closeUserModal() {
    document.getElementById('userModal').style.display = 'none';
}

document.getElementById('createUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());

    // Necesitamos store_id
    const session = await checkSession();
    data.store_id = session.store_id;

    try {
        const res = await fetch('../api/users/create.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.success) {
            showNotification('Usuario creado', 'success');
            closeUserModal();
            e.target.reset();
            loadUsers();
        } else {
            showNotification(result.message || 'Error al crear usuario', 'error');
        }
    } catch (error) {
        showNotification('Error de conexión', 'error');
    }
});

let userToToggleId = null;
let newStatusToSet = null;

function confirmToggleUserStatus(userId, newStatus) {
    userToToggleId = userId;
    newStatusToSet = newStatus;
    
    const modal = document.getElementById('toggleUserStatusModal');
    const title = document.getElementById('toggleUserTitle');
    const msg = document.getElementById('toggleUserMsg');
    const iconContainer = document.getElementById('toggleUserIconContainer');
    const icon = document.getElementById('toggleUserIcon');
    const confirmBtn = document.getElementById('confirmToggleUserBtn');

    if (newStatus === 'inactive') {
        title.textContent = '¿Desactivar usuario?';
        msg.textContent = 'El usuario perderá acceso al sistema.';
        iconContainer.style.background = 'var(--danger-color)';
        icon.className = 'fas fa-exclamation-triangle';
        icon.style.color = 'var(--danger-dark)';
        confirmBtn.className = 'btn-danger';
        confirmBtn.textContent = 'Sí, desactivar';
    } else {
        title.textContent = '¿Activar usuario?';
        msg.textContent = 'El usuario recuperará acceso al sistema.';
        iconContainer.style.background = 'var(--success-color)';
        icon.className = 'fas fa-check-circle';
        icon.style.color = 'var(--success-dark)';
        confirmBtn.className = 'btn-save'; // o btn-primary
        confirmBtn.textContent = 'Sí, activar';
    }

    if (modal) modal.style.display = 'block';
}

function closeToggleUserStatusModal() {
    const modal = document.getElementById('toggleUserStatusModal');
    if (modal) modal.style.display = 'none';
    userToToggleId = null;
    newStatusToSet = null;
}

// Event listener para confirmar cambio de estado
const confirmToggleBtn = document.getElementById('confirmToggleUserBtn');
if (confirmToggleBtn) {
    confirmToggleBtn.addEventListener('click', async () => {
        if (!userToToggleId || !newStatusToSet) return;
        
        try {
            // Usamos update.php para cambiar el estado
            const res = await fetch('../api/users/update.php', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    user_id: userToToggleId,
                    status: newStatusToSet
                })
            });
            const result = await res.json();
            if (result.success) {
                loadUsers();
                showNotification(newStatusToSet === 'active' ? 'Usuario activado' : 'Usuario desactivado', 'success');
                closeToggleUserStatusModal();
            } else {
                showNotification(result.message || 'Error al cambiar estado', 'error');
            }
        } catch (error) {
            console.error(error);
            showNotification('Error de conexión', 'error');
        }
    });
}

// Cerrar modal al hacer clic fuera
const toggleUserStatusModal = document.getElementById('toggleUserStatusModal');
if (toggleUserStatusModal) {
    toggleUserStatusModal.addEventListener('click', (e) => {
        if (e.target === toggleUserStatusModal) closeToggleUserStatusModal();
    });
}

// Funciones para el Asistente de Importación
function openImportGuide() {
    document.getElementById('importGuideModal').style.display = 'block';
}

function closeImportGuide() {
    document.getElementById('importGuideModal').style.display = 'none';
}

function triggerFileInput() {
    document.getElementById('importExcelInput').click();
}

let importedData = [];
let excelHeaders = [];

async function handleImportExcel() {
    // Cerrar la guía si está abierta
    closeImportGuide();

    const fileInput = document.getElementById('importExcelInput');
    const statusDiv = document.getElementById('importStatus');

    if (!fileInput.files || fileInput.files.length === 0) {
        showNotification('Por favor selecciona un archivo Excel', 'error');
        return;
    }

    const file = fileInput.files[0];
    // Mostrar estado en el modal de guía si está visible, o en el panel principal
    const guideStatus = document.getElementById('guideStatus');
    if (guideStatus && document.getElementById('importGuideModal').style.display === 'block') {
        guideStatus.innerHTML = '<span style="color: blue;">Leyendo archivo...</span>';
    } else {
        statusDiv.innerHTML = '<span style="color: blue;">Leyendo archivo...</span>';
    }

    const reader = new FileReader();

    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];

            // Convertir a JSON (array de arrays)
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            if (jsonData.length < 2) {
                showNotification('El archivo parece estar vacío o sin datos.', 'error');
                return;
            }

            // Guardar headers y datos
            excelHeaders = jsonData[0].map(h => String(h).trim());
            importedData = jsonData.slice(1); // Remove header row

            // Abrir modal y configurar mapeo
            setupImportModal();
            statusDiv.innerHTML = ''; // Clear status
            if (guideStatus) guideStatus.innerHTML = '';

        } catch (error) {
            console.error(error);
            showNotification('Error al procesar el archivo.', 'error');
        }
    };

    reader.readAsArrayBuffer(file);
}

function setupImportModal() {
    const modal = document.getElementById('importModal');
    const selects = document.querySelectorAll('.column-select');

    // Llenar selects con headers del Excel
    selects.forEach(select => {
        select.innerHTML = '<option value="-1">-- Ignorar --</option>';
        excelHeaders.forEach((header, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = header;
            select.appendChild(option);
        });

        // Auto-detectar
        const field = select.id.replace('map_', '');
        const headerIndex = detectColumn(field, excelHeaders);
        if (headerIndex !== -1) {
            select.value = headerIndex;
        }

        // Event listener para actualizar preview
        select.onchange = updateImportPreview;
    });

    modal.style.display = 'block';
    updateImportPreview();
}

function detectColumn(field, headers) {
    const lowerHeaders = headers.map(h => h.toLowerCase());
    let index = -1;

    if (field === 'name') {
        index = lowerHeaders.findIndex(h => h.includes('nombre') || h.includes('producto') || h.includes('name') || h.includes('descrip'));
    } else if (field === 'barcode') {
        index = lowerHeaders.findIndex(h => h.includes('cod') || h.includes('bar') || h.includes('sku'));
    } else if (field === 'price') {
        index = lowerHeaders.findIndex(h => h.includes('precio') || h.includes('venta') || h.includes('price'));
    } else if (field === 'cost') {
        index = lowerHeaders.findIndex(h => h.includes('costo') || h.includes('compra') || h.includes('cost'));
    } else if (field === 'stock') {
        index = lowerHeaders.findIndex(h => h.includes('stock') || h.includes('cant') || h.includes('exist'));
    } else if (field === 'description') {
        index = lowerHeaders.findIndex(h => h.includes('detal') || h.includes('nota'));
    }

    return index;
}

function updateImportPreview() {
    const map = {
        name: parseInt(document.getElementById('map_name').value),
        barcode: parseInt(document.getElementById('map_barcode').value),
        price: parseInt(document.getElementById('map_price').value),
        cost: parseInt(document.getElementById('map_cost').value),
        stock: parseInt(document.getElementById('map_stock').value)
    };

    const tbody = document.getElementById('previewBody');
    tbody.innerHTML = '';

    // Validar si tenemos nombre (obligatorio)
    const btnConfirm = document.getElementById('btnConfirmImport');
    if (map.name === -1) {
        btnConfirm.disabled = true;
        document.getElementById('importSummary').textContent = 'Selecciona al menos la columna "Nombre" para continuar.';
    } else {
        btnConfirm.disabled = false;
        document.getElementById('importSummary').textContent = `Se importarán ${importedData.length} registros.`;
    }

    // Mostrar primeros 5
    const previewData = importedData.slice(0, 5);
    previewData.forEach(row => {
        const tr = document.createElement('tr');

        const name = map.name !== -1 ? (row[map.name] || '') : '-';
        const code = map.barcode !== -1 ? (row[map.barcode] || '') : '-';
        const price = map.price !== -1 ? (row[map.price] || '0') : '-';
        const stock = map.stock !== -1 ? (row[map.stock] || '0') : '-';

        tr.innerHTML = `
            <td style="padding: 8px;">${name}</td>
            <td style="padding: 8px;">${code}</td>
            <td style="padding: 8px; text-align: right;">${price}</td>
            <td style="padding: 8px; text-align: right;">${stock}</td>
        `;
        tbody.appendChild(tr);
    });
}

function closeImportModal() {
    document.getElementById('importModal').style.display = 'none';
    document.getElementById('importExcelInput').value = ''; // Reset input
}

// Event listener for confirm button
document.getElementById('btnConfirmImport').addEventListener('click', async () => {
    const map = {
        name: parseInt(document.getElementById('map_name').value),
        barcode: parseInt(document.getElementById('map_barcode').value),
        price: parseInt(document.getElementById('map_price').value),
        cost: parseInt(document.getElementById('map_cost').value),
        stock: parseInt(document.getElementById('map_stock').value),
        description: parseInt(document.getElementById('map_description').value)
    };

    if (map.name === -1) return;

    const btn = document.getElementById('btnConfirmImport');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';

    try {
        const products = importedData.map(row => ({
            name: map.name !== -1 ? row[map.name] : '',
            barcode: map.barcode !== -1 ? row[map.barcode] : '',
            price: map.price !== -1 ? row[map.price] : 0,
            cost: map.cost !== -1 ? row[map.cost] : 0,
            stock: map.stock !== -1 ? row[map.stock] : 0,
            description: map.description !== -1 ? row[map.description] : ''
        })).filter(p => p.name && String(p.name).trim() !== '');

        const res = await fetch('../api/stores/import_data.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ products })
        });

        const result = await res.json();

        if (result.success) {
            showNotification(`Importación exitosa: ${result.data.inserted} nuevos, ${result.data.updated} actualizados.`, 'success');
            closeImportModal();
        } else {
            showNotification(result.message, 'error');
        }
    } catch (error) {
        console.error(error);
        showNotification('Error al enviar datos', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
});


// ==========================================
// Notificaciones push (Fase B)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('pushSubscribeBtn');
    if (!btn) return;

    const updateBtnState = async () => {
        try {
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
                btn.innerHTML = '<i class="fas fa-bell-slash"></i> Notificaciones no soportadas';
                btn.disabled = true;
                return;
            }
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
                btn.innerHTML = '<i class="fas fa-bell-slash"></i> Desactivar notificaciones';
                btn.style.background = 'var(--danger-color)';
            } else {
                btn.innerHTML = '<i class="fas fa-bell"></i> Activar notificaciones en este dispositivo';
                btn.style.background = 'var(--primary-color)';
            }
        } catch (e) {
            console.warn('Push check:', e);
        }
    };

    btn.addEventListener('click', async () => {
        try {
            const reg = await navigator.serviceWorker.ready;
            const existing = await reg.pushManager.getSubscription();
            if (existing) {
                // Desuscribir
                await existing.unsubscribe();
                await fetch('../api/push/unsubscribe.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint: existing.endpoint })
                });
                showNotification('Notificaciones desactivadas', 'info');
            } else {
                // Suscribir (vapid key viene del servidor; si no está configurada, falla el envío pero se guarda la sub)
                const keyResp = await fetch('../api/push/public_key.php').then(r => r.json()).catch(() => ({ key: null }));
                const sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: keyResp.key ? keyResp.key : urlBase64ToUint8Array('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkMcZ4-mSf9vJtUyWx0QFq0Q4wYf0E2YqQk9QF4Y1s')
                });
                await fetch('../api/push/subscribe.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        endpoint: sub.endpoint,
                        p256dh: arrayBufferToBase64(sub.getKey('p256dh')),
                        auth: arrayBufferToBase64(sub.getKey('auth')),
                        device_name: navigator.userAgent.slice(0, 80)
                    })
                });
                showNotification('Notificaciones activadas', 'success');
            }
            await updateBtnState();
        } catch (e) {
            console.error('Push subscribe error:', e);
            showNotification('No se pudo activar notificaciones: ' + e.message, 'error');
        }
    });

    updateBtnState();
});

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// ==========================================
// Modo de tema claro/oscuro/auto (en vivo)
// ==========================================
function updateThemeModeLabel(text) {
    const label = document.getElementById('themeModeLabel');
    if (label) label.textContent = text;
}

function updateThemeModeButtons(mode) {
    document.querySelectorAll('.theme-mode-btn').forEach(btn => {
        const active = btn.getAttribute('data-mode') === mode;
        btn.classList.toggle('active', active);
        btn.style.background = active ? 'var(--primary-color)' : 'transparent';
        btn.style.color = active ? '#fff' : 'var(--text-color)';
        btn.style.borderColor = active ? 'var(--primary-color)' : 'var(--border-color)';
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const modeBtns = document.querySelectorAll('.theme-mode-btn');
    if (!modeBtns.length) return;

    // Aplicar en vivo al elegir modo (sin guardar aún — el submit lo persiste)
    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.getAttribute('data-mode');
            updateThemeModeButtons(mode);
            updateThemeModeLabel(mode === 'dark' ? 'Oscuro' : mode === 'light' ? 'Claro' : 'Automático');
            if (window.ThemeSystem) {
                window.ThemeSystem.setMode(mode);
            } else {
                document.documentElement.setAttribute('data-theme', mode === 'dark' ? 'dark' : 'light');
            }
            // Guardar en localStorage para que theme-init.js lo aplique en todas las páginas
            try {
                const saved = JSON.parse(localStorage.getItem('pos_theme_config') || '{}');
                saved.theme_mode = mode;
                if (mode === 'dark') saved.dark_mode = true;
                else if (mode === 'light') saved.dark_mode = false;
                else delete saved.dark_mode;
                localStorage.setItem('pos_theme_config', JSON.stringify(saved));
            } catch (e) { /* noop */ }
        });
    });
});
