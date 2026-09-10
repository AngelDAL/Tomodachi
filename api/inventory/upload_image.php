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
require_once '../../includes/ImageUpload.class.php';

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
    // Seguridad: el usuario solo puede subir imágenes de productos de su propia tienda
    $currentUser = $auth->getCurrentUser();
    $store_id = (int)$currentUser['store_id'];
    $product = $db->selectOne('SELECT product_id FROM products WHERE product_id = ? AND store_id = ?', [$product_id, $store_id]);
    if (!$product) {
        Response::notFound('Producto no encontrado en esta tienda');
    }

    // Parse base64
    if (!preg_match('/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/', $img64, $matches)) {
        Response::validationError(['image_base64' => 'Formato inválido']);
    }
    $data_bin = base64_decode($matches[3]);
    if ($data_bin === false) {
        Response::validationError(['image_base64' => 'Base64 corrupto']);
    }

    // Validación de contenido real + re-encode obligatorio con GD: nunca se
    // guarda el archivo tal cual llegó del cliente (descarta payloads
    // embebidos), se limita a 40MP (anti "image bomb") y se redimensiona a
    // 1920px comprimiendo a ≤2MB. El nombre lo genera el servidor.
    try {
        $saved = ImageUpload::save(
            $data_bin,
            __DIR__ . '/../../public/assets/images/products',
            'p_' . $product_id,
            2 * 1024 * 1024,
            1920
        );
    } catch (Exception $e) {
        Response::validationError(['image_base64' => $e->getMessage()]);
    }

    // Guardar ruta relativa
    $relative = 'public/assets/images/products/' . $saved['filename'];
    $db->update('UPDATE products SET image_path = ?, updated_at = NOW() WHERE product_id = ?', [$relative, $product_id]);
    $updated = $db->selectOne('SELECT product_id, product_name, image_path FROM products WHERE product_id = ?', [$product_id]);
    Response::success($updated, 'Imagen actualizada');
} catch (Exception $e) {
    error_log('Error en upload_image: ' . $e->getMessage());
    Response::error('Error interno del servidor', 500);
}
