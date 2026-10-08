<?php
/**
 * Subir contenido al carrusel del kiosko (imágenes o videos).
 * POST /api/kiosk/upload.php  (multipart/form-data, campo "file")
 *
 * Imágenes: se validan por magic bytes y se comprimen/re-dimensionan en servidor (GD),
 * igual que la cartelería digital, para no saturar disco ni memoria.
 * Videos:   se validan por MIME real y se guardan tal cual (mp4/webm).
 * Se guardan bajo /uploads/kiosko/ (mismo mecanismo que ya sirve la cartelería).
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';

const MAX_UPLOAD = 110 * 1024 * 1024; // 110 MB
const MAX_EDGE = 2400;
const JPEG_QUALITY = 82;

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
    if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        Response::validationError(['file' => 'Archivo inválido']);
    }

    $store_id = (int)$actor['store_id'];
    $file = $_FILES['file'];
    $original = basename($file['name']);
    if ($file['size'] > MAX_UPLOAD) {
        Response::validationError(['file' => 'Tamaño máximo: 110 MB']);
    }

    $upload_dir = __DIR__ . '/../../uploads/kiosko/';
    if (!is_dir($upload_dir)) {
        mkdir($upload_dir, 0755, true);
    }

    $bin = file_get_contents($file['tmp_name']);
    if ($bin === false) {
        Response::error('No se pudo leer el archivo', 500);
    }

    $mime = mime_content_type($file['tmp_name']);
    $info = @getimagesizefromstring($bin);

    // ── VIDEO ──
    if ($info === false) {
        $vid = ['video/mp4' => 'mp4', 'video/webm' => 'webm', 'video/quicktime' => 'mov'];
        if (!isset($vid[$mime])) {
            Response::validationError(['file' => 'Formato no admitido: sube una imagen (JPG/PNG/WebP/GIF) o un video MP4/WebM']);
        }
        $ext = $vid[$mime];
        $filename = 'ks_' . $store_id . '_' . time() . '_' . uniqid() . '.' . $ext;
        $filepath = $upload_dir . $filename;
        if (file_put_contents($filepath, $bin) === false) {
            Response::error('No se pudo guardar el video', 500);
        }
        Response::success([
            'url' => '/uploads/kiosko/' . $filename,
            'type' => 'video',
            'mime_type' => $mime,
            'file_size' => filesize($filepath),
            'original_name' => $original,
        ], 'Video subido', 201);
    }

    // ── IMAGEN ──
    if ($info[0] * $info[1] > 40000000) {
        Response::validationError(['file' => 'La imagen es demasiado grande (máximo 40 megapíxeles)']);
    }
    $gd_type = $info[2];
    if (!in_array($gd_type, [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP, IMAGETYPE_GIF])) {
        Response::validationError(['file' => 'Formato de imagen no soportado']);
    }
    $src = @imagecreatefromstring($bin);
    if ($src === false) {
        Response::validationError(['file' => 'No se pudo procesar la imagen']);
    }
    $origW = imagesx($src);
    $origH = imagesy($src);
    $scale = min(1.0, MAX_EDGE / max($origW, $origH));
    $newW = (int)round($origW * $scale);
    $newH = (int)round($origH * $scale);
    $dst = imagecreatetruecolor($newW ?: 1, $newH ?: 1);
    if (in_array($gd_type, [IMAGETYPE_PNG, IMAGETYPE_WEBP, IMAGETYPE_GIF])) {
        imagealphablending($dst, false);
        imagesavealpha($dst, true);
        $transparent = imagecolorallocatealpha($dst, 0, 0, 0, 127);
        imagefill($dst, 0, 0, $transparent);
    }
    imagecopyresampled($dst, $src, 0, 0, 0, 0, $newW, $newH, $origW, $origH);
    $ext = 'webp';
    if (!function_exists('imagewebp')) {
        $ext = 'jpg';
    }
    $filename = 'ks_' . $store_id . '_' . time() . '_' . uniqid() . '.' . $ext;
    $filepath = $upload_dir . $filename;
    $encoded = false;
    if ($ext === 'webp') {
        $encoded = imagewebp($dst, $filepath, JPEG_QUALITY);
    } else {
        if (in_array($gd_type, [IMAGETYPE_PNG, IMAGETYPE_WEBP, IMAGETYPE_GIF])) {
            $bg = imagecreatetruecolor($newW ?: 1, $newH ?: 1);
            $white = imagecolorallocate($bg, 255, 255, 255);
            imagefill($bg, 0, 0, $white);
            imagecopy($bg, $dst, 0, 0, 0, 0, $newW, $newH);
            imagejpeg($bg, $filepath, JPEG_QUALITY);
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
    Response::success([
        'url' => '/uploads/kiosko/' . $filename,
        'type' => 'image',
        'mime_type' => ($ext === 'webp') ? 'image/webp' : 'image/jpeg',
        'file_size' => filesize($filepath),
        'width' => $newW,
        'height' => $newH,
        'original_name' => $original,
    ], 'Imagen subida y optimizada', 201);

} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}