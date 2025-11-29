<?php

/**
 * Subir imagen de producto (base64 o multipart)
 * POST /api/inventory/upload_image.php
 * JSON base64 ejemplo:
 * {
 *   "product_id": 10,
 *   "image_base64": "data:image/png;base64,iVBORw0KG..."
 * }
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
if (!in_array($auth->getCurrentUser()['role'], [ROLE_ADMIN, ROLE_MANAGER])) {
    Response::error('Permisos insuficientes', 403);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

try {
    $db = new Database();
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    if (!$data) {
        Response::validationError(['body' => 'JSON inválido']);
    }
    $product_id = isset($data['product_id']) ? (int)$data['product_id'] : 0;
    $img64 = isset($data['image_base64']) ? $data['image_base64'] : '';
    if ($product_id <= 0) {
        Response::validationError(['product_id' => 'Requerido']);
    }
    if (!$img64) {
        Response::validationError(['image_base64' => 'Requerida']);
    }
    $product = $db->selectOne('SELECT product_id FROM products WHERE product_id = ?', [$product_id]);
    if (!$product) {
        Response::notFound('Producto no existe');
    }

    // Parse base64
    if (!preg_match('/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/', $img64, $matches)) {
        Response::validationError(['image_base64' => 'Formato inválido']);
    }
    $mime = $matches[1];
    $ext = $matches[2] === 'jpeg' ? 'jpg' : $matches[2];
    $data_bin = base64_decode($matches[3]);
    if ($data_bin === false) {
        Response::validationError(['image_base64' => 'Base64 corrupto']);
    }
    if (strlen($data_bin) > 2 * 1024 * 1024) {
        Response::validationError(['image_base64' => 'Máximo 2MB']);
    }

    $filename = 'p_' . $product_id . '_' . time() . '.' . $ext;
    
    // Definir ruta objetivo
    $targetPath = __DIR__ . '/../../public/assets/images/products';
    
    // Verificar si existe, si no, intentar crearla
    if (!is_dir($targetPath)) {
        if (!mkdir($targetPath, 0777, true)) {
            Response::error('No se pudo crear el directorio de imágenes en: ' . $targetPath, 500);
        }
    }

    $targetDir = realpath($targetPath);
    if (!$targetDir) {
        Response::error('Error al resolver la ruta del directorio: ' . $targetPath, 500);
    }
    $path = $targetDir . DIRECTORY_SEPARATOR . $filename;
    if (!file_put_contents($path, $data_bin)) {
        Response::error('No se pudo guardar archivo', 500);
    }

    // Guardar ruta relativa
    $relative = 'public/assets/images/products/' . $filename;
    $db->update('UPDATE products SET image_path = ?, updated_at = NOW() WHERE product_id = ?', [$relative, $product_id]);
    $updated = $db->selectOne('SELECT product_id, product_name, image_path FROM products WHERE product_id = ?', [$product_id]);
    Response::success($updated, 'Imagen actualizada');
} catch (Exception $e) {
    Response::error('Error servidor: ' . $e->getMessage(), 500);
}
