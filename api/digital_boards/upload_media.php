<?php
/**
 * Subir imagen para digital signage
 * POST /api/digital_boards/upload_media.php
 * Acepta base64 o multipart/form-data.
 *
 * Soporta imágenes de hasta 100MB. Valida que el archivo sea una imagen REAL
 * (magic bytes vía getimagesize), y la COMPRIME/REDIMENSIONA en servidor (GD)
 * para que un archivo enorme no sature el disco ni la memoria del servidor.
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';

// Tamaño máximo admitido (coincide con upload_max_filesize / post_max_size)
const MAX_UPLOAD = 100 * 1024 * 1024; // 100 MB
const MAX_EDGE = 2400;                // lado máximo tras redimensionar (px)
const JPEG_QUALITY = 82;              // calidad de compresión

try {
    $db = new Database();
    $auth = new Auth($db);
    $apiAuth = new ApiAuth($db);

    $actor = $apiAuth->requireActor($auth);
    $apiAuth->requireScope($actor, 'write');

    if ($actor['via'] === 'session' && !in_array($auth->getCurrentUser()['role'], [ROLE_ADMIN, ROLE_MANAGER])) {
        Response::error('Permisos insuficientes', 403);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        Response::error('Método no permitido', 405);
    }

    $store_id = (int)$actor['store_id'];
    $data = [];

    // Crear directorio de uploads si no existe
    $upload_dir = __DIR__ . '/../../uploads/digital_signage/';
    if (!is_dir($upload_dir)) {
        mkdir($upload_dir, 0755, true);
    }

    // Verificar si es multipart o JSON base64
    $is_multipart = !empty($_FILES['file']);
    $data_bin = null;
    $original_name = '';
    $mime_type = '';

    if ($is_multipart) {
        if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
            Response::validationError(['file' => 'Error al subir archivo']);
        }
        $file = $_FILES['file'];
        $original_name = basename($file['name']);
        $file_size = $file['size'];

        if ($file_size > MAX_UPLOAD) {
            Response::validationError(['file' => 'Tamaño máximo: 100MB']);
        }
        $data_bin = file_get_contents($file['tmp_name']);
        if ($data_bin === false) {
            Response::error('No se pudo leer el archivo', 500);
        }
        $mime_type = mime_content_type($file['tmp_name']);
    } else {
        // JSON base64
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true);
        if (!$data || empty($data['image_base64'])) {
            Response::validationError(['image_base64' => 'Requerida']);
        }
        if (!preg_match('/^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/', $data['image_base64'], $matches)) {
            Response::validationError(['image_base64' => 'Formato inválido']);
        }
        $mime_type = $matches[1];
        $data_bin = base64_decode($matches[3]);
        if ($data_bin === false) {
            Response::validationError(['image_base64' => 'Base64 corrupto']);
        }
        $file_size = strlen($data_bin);
        if ($file_size > MAX_UPLOAD) {
            Response::validationError(['image_base64' => 'Tamaño máximo: 100MB']);
        }
        $original_name = $data['original_name'] ?? 'imagen';
    }

    // === Validar que sea una IMAGEN REAL (magic bytes, no solo extensión/MIME) ===
    if (!extension_loaded('gd')) {
        Response::error('El servidor no tiene soporte de imágenes (GD)', 500);
    }

    // getimagesizefromstring lee el header real del binario; devuelve false si NO es imagen
    $info = @getimagesizefromstring($data_bin);
    if ($info === false) {
        Response::validationError(['file' => 'El archivo no es una imagen válida']);
    }

    // Mapa de tipos GD a mimetypes que sí podemos re-encodear
    $gd_type = $info[2];
    $allowed_gd = [
        IMAGETYPE_JPEG => 'jpg',
        IMAGETYPE_PNG  => 'png',
        IMAGETYPE_WEBP => 'webp',
        IMAGETYPE_GIF  => 'gif',
    ];
    if (!isset($allowed_gd[$gd_type])) {
        Response::validationError(['file' => 'Formato de imagen no soportado']);
    }

    // Cargar la imagen
    $src = @imagecreatefromstring($data_bin);
    if ($src === false) {
        Response::validationError(['file' => 'No se pudo procesar la imagen (posible corrupción)']);
    }

    $origW = imagesx($src);
    $origH = imagesy($src);

    // === COMPRIMIR / REDIMENSIONAR ===
    // Si algún lado supera MAX_EDGE, escalamos manteniendo proporción.
    // Siempre re-encodeamos (JPEG o WebP) para reducir peso real en disco.
    $scale = min(1.0, MAX_EDGE / max($origW, $origH));
    $newW = (int)round($origW * $scale);
    $newH = (int)round($origH * $scale);

    $dst = imagecreatetruecolor($newW ?: 1, $newH ?: 1);

    // Preservar transparencia para PNG/GIF/WebP con canal alfa
    if (in_array($gd_type, [IMAGETYPE_PNG, IMAGETYPE_WEBP, IMAGETYPE_GIF])) {
        imagealphablending($dst, false);
        imagesavealpha($dst, true);
        $transparent = imagecolorallocatealpha($dst, 0, 0, 0, 127);
        imagefill($dst, 0, 0, $transparent);
    }
    imagecopyresampled($dst, $src, 0, 0, 0, 0, $newW, $newH, $origW, $origH);

    // Generar nombre y encodear. Preferimos WebP si está disponible; si no, JPEG.
    // Se guarda con extensión .webp o .jpg, aunque el original fuera PNG/GIF.
    $ext = 'webp';
    if (!function_exists('imagewebp')) {
        $ext = 'jpg';
    }
    $filename = 'ds_' . $store_id . '_' . time() . '_' . uniqid() . '.' . $ext;
    $filepath = $upload_dir . $filename;

    $encoded = false;
    if ($ext === 'webp') {
        $encoded = imagewebp($dst, $filepath, JPEG_QUALITY);
    } else {
        // JPEG no soporta transparencia: pintamos fondo blanco si hace falta
        if (in_array($gd_type, [IMAGETYPE_PNG, IMAGETYPE_WEBP, IMAGETYPE_GIF])) {
            $bg = imagecreatetruecolor($newW ?: 1, $newH ?: 1);
            $white = imagecolorallocate($bg, 255, 255, 255);
            imagefill($bg, 0, 0, $white);
            imagecopy($bg, $dst, 0, 0, 0, 0, $newW, $newH);
            imagejpeg($bg, $filepath, JPEG_QUALITY);
            imagedestroy($bg);
            $encoded = true;
        } else {
            $encoded = imagejpeg($dst, $filepath, JPEG_QUALITY);
        }
    }

    imagedestroy($src);
    imagedestroy($dst);

    if (!$encoded || !file_exists($filepath)) {
        Response::error('No se pudo comprimir la imagen', 500);
    }

    // Tamaño REAL en disco de la versión comprimida
    $stored_size = filesize($filepath);
    $saved_ext = $ext;

    // Forzar Content-Type coherente con la extensión guardada
    if ($saved_ext === 'webp') {
        $mime_type = 'image/webp';
    } else {
        $mime_type = 'image/jpeg';
    }

    // Tags opcionales
    $tags = isset($data['tags']) ? $data['tags'] : (isset($_POST['tags']) ? $_POST['tags'] : null);

    // Guardar en BD (con dimensiones y tamaño de la versión COMPRIMIDA)
    $media_id = $db->insert(
        'INSERT INTO digital_signage_media 
         (store_id, filename, original_name, mime_type, file_size, width, height, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
            $store_id,
            $filename,
            $original_name,
            $mime_type,
            $stored_size,
            $newW,
            $newH,
            $tags
        ]
    );

    // URL relativa para acceder a la imagen
    $relative_url = '/uploads/digital_signage/' . $filename;

    Response::success([
        'media_id' => $media_id,
        'filename' => $filename,
        'original_name' => $original_name,
        'url' => $relative_url,
        'mime_type' => $mime_type,
        'file_size' => $stored_size,
        'width' => $newW,
        'height' => $newH,
        'original' => [
            'width' => $origW,
            'height' => $origH,
            'size' => $file_size,
        ],
        'optimized' => true,
    ], 'Imagen subida y optimizada', 201);

} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
