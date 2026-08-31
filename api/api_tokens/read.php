<?php
/**
 * API: Listar API Tokens de la tienda (sin revelar el token plano)
 * GET /api/api_tokens/read.php
 * Requiere: sesión de administrador de la tienda.
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') { Response::error('Método no permitido', 405); }

try {
    $db = new Database();
    $auth = new Auth($db);
    if (!$auth->isLoggedIn()) { Response::unauthorized(); }
    if (!$auth->hasRole([ROLE_ADMIN, ROLE_SUPER_ADMIN])) { Response::error('Solo admin puede ver tokens', 403); }

    $currentUser = $auth->getCurrentUser();
    $store_id = (int)$currentUser['store_id'];
    if ($store_id <= 0) { Response::error('Tienda no identificada', 400); }

    $tokens = $db->select(
        'SELECT token_id, name, token_prefix, scopes, last_used_at, expires_at, revoked, created_at
         FROM api_tokens WHERE store_id = ? ORDER BY created_at DESC',
        [$store_id]
    );

    // Marcar expirados para el frontend (sin modificar BD)
    foreach ($tokens as &$t) {
        $t['is_expired'] = false;
        if ($t['expires_at'] !== null) {
            $exp = strtotime($t['expires_at']);
            $t['is_expired'] = ($exp !== false && $exp < time());
        }
    }

    Response::success($tokens, 'Tokens de la tienda');
} catch (Exception $e) {
    Response::error('Error en el servidor: ' . $e->getMessage(), 500);
}
