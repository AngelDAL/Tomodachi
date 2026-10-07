/**
 * Prueba del PAPEL TAPIZ de la tienda (imagen de fondo).
 *
 * Lo que pidió el dueño: "que el usuario pueda poner una imagen de fondo... con la
 * opción de opacidad... tipo cover o fill... se queda guardada en el servidor y
 * cuando acceda en todas las vistas debería estar esa imagen".
 *
 * Se prueban las reglas puras que corren en el navegador (theme-init.js, el archivo
 * REAL que se sirve en producción, cargado aquí con un DOM mínimo) y dos cosas que
 * no pueden fallar en silencio:
 *   1. La ruta se pinta dentro de un `url()` del tema: solo entran imágenes de la
 *      propia instalación (nada de http:, data:, javascript: ni `..`).
 *   2. Una configuración PARCIAL no borra el fondo puesto: solo una cadena vacía lo
 *      quita (varios llamadores aplican el tema con configs sin papel tapiz).
 *
 * Uso: node tests/theme_wallpaper_test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pasadas = 0;
function probar(nombre, fn) {
    try {
        fn();
        pasadas++;
        console.log('PASS: ' + nombre);
    } catch (e) {
        console.error('FAIL: ' + nombre + '\n  ' + e.message);
        process.exitCode = 1;
    }
}

// ─── Carga de theme-init.js con un DOM mínimo (el archivo real, sin copiarlo) ───
function cargarThemeInit() {
    const memoria = {};
    const clases = new Set();
    const atributos = {};
    const estilos = {};
    const root = {
        classList: {
            add: (c) => clases.add(c),
            remove: (c) => clases.delete(c),
            contains: (c) => clases.has(c),
        },
        style: {
            setProperty: (k, v) => { estilos[k] = String(v); },
            removeProperty: (k) => { delete estilos[k]; },
        },
        setAttribute: (k, v) => { atributos[k] = String(v); },
        removeAttribute: (k) => { delete atributos[k]; },
        getAttribute: (k) => (k in atributos ? atributos[k] : null),
        hasAttribute: (k) => k in atributos,
    };
    const sandbox = {
        console,
        localStorage: {
            getItem: (k) => (k in memoria ? memoria[k] : null),
            setItem: (k, v) => { memoria[k] = String(v); },
            removeItem: (k) => { delete memoria[k]; },
        },
        document: { documentElement: root, addEventListener: () => {}, readyState: 'complete',
                    baseURI: 'https://tomodachi.tabtap.dev/public/profile.html' },
        URL,
        requestAnimationFrame: (fn) => fn(),
        matchMedia: () => ({ matches: false }),
        addEventListener: () => {},
    };
    sandbox.window = sandbox;
    const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'theme-init.js'), 'utf8');
    vm.createContext(sandbox);
    vm.runInContext(codigo, sandbox);
    return { utils: sandbox.window.ThemeColorUtils, clases, estilos, atributos, memoria };
}

const { utils, clases, estilos, atributos } = cargarThemeInit();

probar('theme-init.js publica applyWallpaper y sus reglas', () => {
    assert.strictEqual(typeof utils.applyWallpaper, 'function');
    assert.strictEqual(typeof utils.normalizeWallpaperUrl, 'function');
    assert.strictEqual(typeof utils.normalizeWallpaperOpacity, 'function');
    assert.strictEqual(typeof utils.normalizeWallpaperSize, 'function');
});

// ─── 1. Qué rutas se aceptan ────────────────────────────────────────────────
probar('acepta una imagen subida por la propia instalación', () => {
    const url = 'assets/images/wallpapers/store_1_1764520695_ab12cd34.jpg';
    assert.strictEqual(utils.normalizeWallpaperUrl(url), url);
    assert.strictEqual(utils.normalizeWallpaperUrl('uploads/wallpapers/fondo.webp'), 'uploads/wallpapers/fondo.webp');
    assert.strictEqual(utils.normalizeWallpaperUrl('assets/images/backgrounds/Portada1.jpg'), 'assets/images/backgrounds/Portada1.jpg');
});

probar('rechaza esquemas, otros dominios y saltos de directorio', () => {
    const malas = [
        'http://otro-sitio.com/fondo.jpg',
        'https://otro-sitio.com/fondo.jpg',
        '//otro-sitio.com/fondo.jpg',
        'javascript:alert(1)',
        'data:image/png;base64,AAAA',
        '../../etc/passwd.jpg',
        'assets/images/wallpapers/../../../config/database.php',
        'assets/images/wallpapers/fondo.php',
        'assets/images/wallpapers/fondo.jpg?x=1',
        '/etc/passwd',
        '',
    ];
    malas.forEach(mala => {
        assert.strictEqual(utils.normalizeWallpaperUrl(mala), '', 'debió rechazar: ' + mala);
    });
});

probar('rechaza una ruta que no sea de imágenes del sistema', () => {
    assert.strictEqual(utils.normalizeWallpaperUrl('assets/images/logos/store_1.jpg'), '');
});

// ─── 2. Opacidad y ajuste ───────────────────────────────────────────────────
probar('la opacidad se guarda en % y se aplica en 0..1', () => {
    assert.strictEqual(utils.normalizeWallpaperOpacity(30), 0.3);
    assert.strictEqual(utils.normalizeWallpaperOpacity('45'), 0.45);
    assert.strictEqual(utils.normalizeWallpaperOpacity(0), 0);
    assert.strictEqual(utils.normalizeWallpaperOpacity(100), 1);
    assert.strictEqual(utils.normalizeWallpaperOpacity(-20), 0);
    assert.strictEqual(utils.normalizeWallpaperOpacity(999), 1);
    assert.strictEqual(utils.normalizeWallpaperOpacity('nonsense'), 0.3, 'sin dato, queda el 30% por defecto');
    assert.strictEqual(utils.normalizeWallpaperOpacity(undefined), 0.3);
});

probar('el ajuste solo puede ser cubrir o rellenar', () => {
    assert.strictEqual(utils.normalizeWallpaperSize('fill'), 'fill');
    assert.strictEqual(utils.normalizeWallpaperSize('FILL'), 'fill');
    assert.strictEqual(utils.normalizeWallpaperSize('cover'), 'cover');
    assert.strictEqual(utils.normalizeWallpaperSize(''), 'cover');
    assert.strictEqual(utils.normalizeWallpaperSize('stretch'), 'cover');
});

// ─── 3. Aplicar / quitar / no tocar ─────────────────────────────────────────
probar('aplica el fondo: clase, imagen, opacidad y ajuste', () => {
    utils.applyWallpaper({
        wallpaper_url: 'assets/images/wallpapers/fondo.jpg',
        wallpaper_opacity: 40,
        wallpaper_size: 'fill',
    }, false, null);
    assert.ok(clases.has('has-wallpaper'), 'debe marcar <html> con has-wallpaper');
    // ABSOLUTA a propósito: dentro de main.css un url() relativo se resuelve
    // contra /public/css/ y el fondo daba 404.
    assert.strictEqual(estilos['--wallpaper-image'],
        'url("https://tomodachi.tabtap.dev/public/assets/images/wallpapers/fondo.jpg")');
    assert.strictEqual(estilos['--wallpaper-opacity'], '0.4');
    assert.strictEqual(atributos['data-wallpaper-size'], 'fill');
});

probar('la opacidad por omisión es 30% y el ajuste cubrir', () => {
    utils.applyWallpaper({ wallpaper_url: 'assets/images/wallpapers/fondo.jpg' }, false, null);
    assert.strictEqual(estilos['--wallpaper-opacity'], '0.3');
    assert.strictEqual(atributos['data-wallpaper-size'], 'cover');
});

probar('una cadena vacía quita el fondo', () => {
    utils.applyWallpaper({ wallpaper_url: 'assets/images/wallpapers/fondo.jpg' }, false, null);
    assert.ok(clases.has('has-wallpaper'));
    utils.applyWallpaper({ wallpaper_url: '' }, false, null);
    assert.ok(!clases.has('has-wallpaper'), 'la clase debe desaparecer');
    assert.strictEqual(estilos['--wallpaper-image'], undefined);
    assert.strictEqual(estilos['--wallpaper-opacity'], undefined);
    assert.strictEqual(atributos['data-wallpaper-size'], undefined);
});

probar('una config SIN la clave no toca el fondo que ya estaba', () => {
    utils.applyWallpaper({ wallpaper_url: 'assets/images/wallpapers/fondo.jpg', wallpaper_opacity: 25 }, false, null);
    utils.applyWallpaper({ primary_color: '#39C5BB' }, false, null);   // config parcial (p. ej. sugerir oscuro)
    assert.ok(clases.has('has-wallpaper'), 'un config parcial no debe borrar el fondo');
    assert.strictEqual(estilos['--wallpaper-image'],
        'url("https://tomodachi.tabtap.dev/public/assets/images/wallpapers/fondo.jpg")');
});

probar('una ruta inválida no se pinta (se trata como sin fondo)', () => {
    utils.applyWallpaper({ wallpaper_url: 'assets/images/wallpapers/fondo.jpg' }, false, null);
    utils.applyWallpaper({ wallpaper_url: 'javascript:alert(1)' }, false, null);
    assert.ok(!clases.has('has-wallpaper'));
    assert.strictEqual(estilos['--wallpaper-image'], undefined);
});

probar('la ruta se aplica absoluta (dentro de main.css un url() relativo se resuelve contra el CSS)', () => {
    assert.strictEqual(utils.absolutizeWallpaperUrl('assets/images/wallpapers/fondo.jpg'),
        'https://tomodachi.tabtap.dev/public/assets/images/wallpapers/fondo.jpg');
    assert.strictEqual(utils.absolutizeWallpaperUrl(''), '');
});

probar('en modo oscuro manda el papel tapiz del tema oscuro si lo define', () => {
    utils.applyWallpaper(
        { wallpaper_url: 'assets/images/wallpapers/claro.jpg', wallpaper_opacity: 20 },
        true,
        { wallpaper_url: 'assets/images/wallpapers/oscuro.jpg', wallpaper_opacity: 60 }
    );
    assert.strictEqual(estilos['--wallpaper-image'],
        'url("https://tomodachi.tabtap.dev/public/assets/images/wallpapers/oscuro.jpg")');
    assert.strictEqual(estilos['--wallpaper-opacity'], '0.6');
});

// ─── 4. Contrato: se aplica desde el tema, y el tema lo carga cada vista ────
probar('apply() del tema aplica también el papel tapiz', () => {
    clases.delete('has-wallpaper');
    utils.apply({ primary_color: '#39C5BB', wallpaper_url: 'assets/images/wallpapers/fondo.jpg', wallpaper_opacity: 50 }, false, null);
    assert.ok(clases.has('has-wallpaper'), 'apply() debe dejar el fondo puesto');
    assert.strictEqual(estilos['--wallpaper-opacity'], '0.5');
});

probar('todas las vistas de la app cargan theme-init.js (el fondo va con el tema)', () => {
    const vistas = ['dashboard.html', 'sales.html', 'inventory.html', 'customers.html', 'promotions.html',
                    'finance.html', 'reports.html', 'profile.html', 'tables.html', 'integrations.html'];
    vistas.forEach(vista => {
        const html = fs.readFileSync(path.join(__dirname, '..', 'public', vista), 'utf8');
        assert.ok(/js\/theme-init\.js\?v=\d+/.test(html), vista + ' no carga theme-init.js');
    });
});

probar('las pastillas del papel tapiz NO usan la clase del modo de tema', () => {
    // Regresión real (7-oct-2026): al prestarse la clase `theme-mode-btn`, el guardado
    // leía el ajuste del fondo como si fuera el modo de tema y la tienda perdía su
    // "oscuro" guardado. Cada grupo de pastillas usa SU clase.
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'profile.html'), 'utf8');
    const bloque = html.slice(html.indexOf('wallpaperSizeGroup'), html.indexOf('wallpaperSizeGroup') + 900);
    assert.ok(/wallpaper-size-btn/.test(bloque), 'el grupo de ajuste debe usar su propia clase');
    assert.ok(!/theme-mode-btn/.test(bloque), 'no puede reutilizar la clase del modo de tema');

    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'profile.js'), 'utf8');
    assert.ok(/\.theme-mode-btn\[data-mode\]\.active/.test(js),
        'el modo activo se busca por [data-mode] y no por la clase suelta');
});

probar('el papel tapiz no se imprime (reportes en blanco)', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'main.css'), 'utf8');
    assert.ok(/@media print[\s\S]*html\.has-wallpaper body::before,\s*html\.has-wallpaper body::after\s*\{\s*display: none !important;/.test(css),
        'falta la excepción de impresión del papel tapiz');
});

console.log('\ntema/papel tapiz: ' + pasadas + ' comprobaciones pasadas' +
    (process.exitCode ? ' — CON FALLAS' : ' — todo en verde'));
