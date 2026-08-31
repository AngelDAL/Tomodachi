<?php
/**
 * API: Revocar API Token (inmediatamente inválido)
 * POST /api/api_tokens/revoke.php
 * Body: { "token_id": 3 }
 * Requiere: sesión de administrador de la tienda (solo puede revocar tokens de su tienda).
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') { Response::error('Método no permitido', 405); }

try {
    $db = new Database();
    $auth = new Auth($db);
    if (!$auth->isLoggedIn()) { Response::unauthorized(); }
    if (!$auth->hasRole([ROLE_ADMIN, ROLE_SUPER_ADMIN])) { Response::error('Solo admin puede revocar tokens', 403); }

    $currentUser = $auth->getCurrentUser();
    $store_id = (int)$currentUser['store_id'];
    if ($store_id <= 0) { Response::error('Tienda no identificada', 400); }

    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { Response::validationError(['body' => 'JSON inválido']); }

    $token_id = isset($data['token_id']) ? (int)$data['token_id'] : 0;
    if ($token_id <= 0) { Response::validationError(['token_id' => 'Requerido']); }

    // Solo puede revocar tokens de su propia tienda
    $token = $db->selectOne('SELECT token_id, store_id FROM api_tokens WHERE token_id = ?', [$token_id]);
    if (!$token) { Response::notFound('Token no existe'); }
    if ((int)$token['store_id'] !== $store_id) {
        Response::error('No autorizado para revocar tokens de otra tienda', 403);
    }

    $db->update('UPDATE api_tokens SET revoked = 1 WHERE token_id = ?', [$token_id]);

    Response::success(['token_id' => $token_id], 'Token revocado');
} catch (Exception $e) {
    Response::error('Error en el servidor: ' . $e->getMessage(), 500);
}
