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
require_once '../../includes/ImageUpload.class.php';

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

    $store_id = $auth->getCurrentUser()['store_id'];

    try {
        // Validación del contenido real + re-encode obligatorio: el archivo
        // del cliente jamás se guarda tal cual (evita payloads embebidos).
        $saved = ImageUpload::saveUploadedFile(
            $_FILES['logo'],
            __DIR__ . '/../../public/assets/images/logos',
            'store_' . $store_id,
            2 * 1024 * 1024,   // resultado máx. 2MB
            20 * 1024 * 1024,  // entrada máx. 20MB
            1920
        );
    } catch (Exception $e) {
        Response::validationError(['logo' => $e->getMessage()]);
    }

    $relativeUrl = 'assets/images/logos/' . $saved['filename'];

    $db->update('UPDATE stores SET logo_url = ?, updated_at = NOW() WHERE store_id = ?', [$relativeUrl, $store_id]);

    // Actualizar sesión
    $_SESSION['logo_url'] = $relativeUrl;

    Response::success(['logo_url' => $relativeUrl], 'Logo actualizado');

} catch (Exception $e) {
    error_log('Error al subir logo: ' . $e->getMessage());
    Response::error('Error interno del servidor', 500);
}
