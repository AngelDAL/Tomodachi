<?php
/**
 * Subir logo de la tienda (multipart/form-data)
 * POST /api/stores/upload_logo.php
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';

$db = new Database();
$auth = new Auth($db);

if (!$auth->isLoggedIn()) {
    Response::unauthorized();
}
if ($auth->getCurrentUser()['role'] !== ROLE_ADMIN) {
    Response::error('Permisos insuficientes', 403);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

try {
    if (!isset($_FILES['logo']) || $_FILES['logo']['error'] !== UPLOAD_ERR_OK) {
        Response::validationError(['logo' => 'No se recibió archivo o hubo un error']);
    }

    $file = $_FILES['logo'];
    $allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = $finfo->file($file['tmp_name']);

    if (!in_array($mime, $allowedTypes)) {
        Response::validationError(['logo' => 'Formato no permitido (JPG, PNG, WEBP)']);
    }

    if ($file['size'] > 2 * 1024 * 1024) {
        Response::validationError(['logo' => 'Máximo 2MB']);
    }

    $ext = pathinfo($file['name'], PATHINFO_EXTENSION);
    $store_id = $auth->getCurrentUser()['store_id'];
    $filename = 'store_' . $store_id . '_' . time() . '.' . $ext;
    
    $targetDir = __DIR__ . '/../../public/assets/images/logos';
    if (!is_dir($targetDir)) {
        mkdir($targetDir, 0777, true);
    }
    
    $targetPath = $targetDir . '/' . $filename;
    
    if (!move_uploaded_file($file['tmp_name'], $targetPath)) {
        Response::error('Error al guardar el archivo', 500);
    }

    $relativeUrl = 'assets/images/logos/' . $filename;
    
    $db->update('UPDATE stores SET logo_url = ?, updated_at = NOW() WHERE store_id = ?', [$relativeUrl, $store_id]);
    
    // Actualizar sesión
    $_SESSION['logo_url'] = $relativeUrl;

    Response::success(['logo_url' => $relativeUrl], 'Logo actualizado');

} catch (Exception $e) {
    Response::error('Error servidor: ' . $e->getMessage(), 500);
}
