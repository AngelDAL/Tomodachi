<?php
/**
 * API: Crear API Token (genera la key UNA vez)
 * POST /api/api_tokens/create.php
 * Body: { "name": "mi-agente", "scopes": ["read","write"], "expires_in_days": 30 }
 * scopes válidos: read, write, custom (o combinación)
 * expires_in_days: opcional; si se omite, el token no expira.
 * Requiere: sesión de administrador de la tienda.
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') { Response::error('Método no permitido', 405); }

try {
    $db = new Database();
    $auth = new Auth($db);
    if (!$auth->isLoggedIn()) { Response::unauthorized(); }
    if (!$auth->hasRole([ROLE_ADMIN, ROLE_SUPER_ADMIN])) { Response::error('Solo admin puede crear tokens', 403); }

    $currentUser = $auth->getCurrentUser();
    $store_id = (int)$currentUser['store_id'];
    if ($store_id <= 0) { Response::error('Tienda no identificada', 400); }

    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { Response::validationError(['body' => 'JSON inválido']); }

    $name = isset($data['name']) ? Validator::sanitizeString($data['name']) : '';
    $scopes = isset($data['scopes']) ? $data['scopes'] : ['read'];
    $expiresInDays = isset($data['expires_in_days']) ? (int)$data['expires_in_days'] : 0;

    $errors = [];
    if (!Validator::required($name)) { $errors['name'] = 'Nombre requerido'; }
    if (strlen($name) > 100) { $errors['name'] = 'Máximo 100 caracteres'; }

    if (!is_array($scopes) || empty($scopes)) {
        $errors['scopes'] = 'Debe indicar al menos un scope';
    } else {
        $validScopes = ['read', 'write', 'custom'];
        foreach ($scopes as $s) {
            if (!in_array($s, $validScopes, true)) {
                $errors['scopes'] = 'Scope inválido: ' . $s . ' (válidos: read, write, custom)';
                break;
            }
        }
    }

    if ($expiresInDays < 0 || $expiresInDays > 3650) {
        $errors['expires_in_days'] = 'Debe estar entre 0 (no expira) y 3650 días';
    }

    if ($errors) { Response::validationError($errors); }

    // Calcular expiración
    $expiresAt = null;
    if ($expiresInDays > 0) {
        $expiresAt = date('Y-m-d H:i:s', time() + ($expiresInDays * 86400));
    }

    $apiAuth = new ApiAuth($db);
    $result = $apiAuth->generateToken($store_id, $name, $scopes, $expiresAt);

    Response::success([
        'token_id'    => $result['token_id'],
        'name'        => $name,
        'prefix'      => $result['prefix'],
        'token'       => $result['token'], // SE MUESTRA UNA SOLA VEZ
        'scopes'      => $scopes,
        'expires_at'  => $expiresAt,
        'warning'     => 'Guarda este token ahora; no podrás verlo de nuevo.'
    ], 'Token creado');
} catch (Exception $e) {
    Response::error('Error en el servidor: ' . $e->getMessage(), 500);
}
