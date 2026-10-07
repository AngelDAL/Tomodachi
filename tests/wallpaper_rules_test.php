<?php
/**
 * Reglas del PAPEL TAPIZ (imagen de fondo de la tienda) — lado servidor.
 *
 * La URL del fondo la manda el cliente y se guarda en el tema de la tienda; luego
 * se pinta dentro de un `url()` de CSS. Antes de guardarla hay que comprobar que
 * sea una imagen de la propia instalación y nada más: ni otro dominio, ni un
 * esquema (http:, data:, javascript:), ni saltos de directorio.
 *
 * Uso: php tests/wallpaper_rules_test.php
 */
require_once __DIR__ . '/../includes/Validator.class.php';

$fallos = 0;
function expectSame($esperado, $obtenido, $mensaje) {
    global $fallos;
    if ($esperado !== $obtenido) {
        $fallos++;
        fwrite(STDERR, "FAIL: $mensaje\n  esperado: " . var_export($esperado, true) . "\n  obtenido: " . var_export($obtenido, true) . "\n");
    } else {
        fwrite(STDOUT, "PASS: $mensaje\n");
    }
}

// --- Rutas válidas (las que devuelve api/stores/upload_wallpaper.php) --------
expectSame('assets/images/wallpapers/store_1_1764520695_ab12.jpg',
    Validator::wallpaperUrl('assets/images/wallpapers/store_1_1764520695_ab12.jpg'),
    'acepta una imagen subida por la tienda');
expectSame('uploads/wallpapers/fondo.webp',
    Validator::wallpaperUrl('  uploads/wallpapers/fondo.webp  '),
    'acepta la ruta del volumen persistente y recorta espacios');
expectSame('assets/images/backgrounds/Portada1.jpg',
    Validator::wallpaperUrl('assets/images/backgrounds/Portada1.jpg'),
    'acepta un fondo de la biblioteca incluida en la instalación');
expectSame('', Validator::wallpaperUrl(''), 'la cadena vacía es válida: significa quitar el fondo');

// --- Rutas prohibidas -------------------------------------------------------
$malas = [
    'http://otro-sitio.com/fondo.jpg',
    'https://otro-sitio.com/fondo.jpg',
    '//otro-sitio.com/fondo.jpg',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    '../../config/database.php',
    'assets/images/wallpapers/../../../config/database.php',
    'assets/images/wallpapers/fondo.php',
    'assets/images/wallpapers/fondo.jpg?x=1',
    '/etc/passwd',
    'assets\\images\\wallpapers\\fondo.jpg',
    'assets/images/logos/store_1.jpg',
];
foreach ($malas as $mala) {
    expectSame(null, Validator::wallpaperUrl($mala), 'rechaza: ' . $mala);
}
expectSame(null, Validator::wallpaperUrl(['arreglo']), 'rechaza lo que no sea cadena');
expectSame(null, Validator::wallpaperUrl(null), 'rechaza nulo');

// --- Normalización del bloque completo en el theme_config --------------------
$cfg = Validator::wallpaperConfig([
    'primary_color' => '#39C5BB',
    'wallpaper_url' => 'assets/images/wallpapers/fondo.jpg',
    'wallpaper_opacity' => 37,
    'wallpaper_size' => 'fill',
]);
expectSame('assets/images/wallpapers/fondo.jpg', $cfg['wallpaper_url'], 'conserva la ruta válida');
expectSame(37, $cfg['wallpaper_opacity'], 'conserva la opacidad');
expectSame('fill', $cfg['wallpaper_size'], 'conserva el ajuste');
expectSame('#39C5BB', $cfg['primary_color'], 'no toca el resto del tema');

$cfg = Validator::wallpaperConfig([
    'wallpaper_url' => 'javascript:alert(1)',
    'wallpaper_opacity' => 900,
    'wallpaper_size' => 'lo-que-sea',
]);
expectSame(false, array_key_exists('wallpaper_url', $cfg), 'descarta una URL inválida en vez de guardarla');
expectSame(100, $cfg['wallpaper_opacity'], 'acota la opacidad a 100');
expectSame('cover', $cfg['wallpaper_size'], 'ajuste desconocido = cubrir');

$cfg = Validator::wallpaperConfig(['wallpaper_opacity' => -5]);
expectSame(0, $cfg['wallpaper_opacity'], 'acota la opacidad a 0');
$cfg = Validator::wallpaperConfig(['wallpaper_opacity' => 'no es número']);
expectSame(false, array_key_exists('wallpaper_opacity', $cfg), 'descarta una opacidad que no es número');

// Las claves ausentes se quedan ausentes: un tema sin papel tapiz no debe
// estrenar claves al guardarlo (si no, el fondo aparecería o desaparecería solo).
$cfg = Validator::wallpaperConfig(['primary_color' => '#39C5BB']);
expectSame(false, array_key_exists('wallpaper_url', $cfg), 'sin papel tapiz no se inventa la clave');

if ($fallos > 0) {
    fwrite(STDERR, "\n$fallos fallo(s)\n");
    exit(1);
}
fwrite(STDOUT, "\nTodo en verde\n");
