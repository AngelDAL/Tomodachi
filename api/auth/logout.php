<?php
/**
 * API: Logout de usuario
 * POST /api/auth/logout.php (también acepta GET por compatibilidad con clientes simples)
 *
 * Idempotente: si no hay sesión activa responde success igual — cerrar sesión
 * cuando ya se está fuera no es un error, es un no-op.
 */

require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';

header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

try {
    $db = new Database();
    $auth = new Auth($db);

    // Cerrar sesión si existe (no-op si no hay)
    $auth->logout();

    Response::success(null, 'Sesión cerrada correctamente');

} catch (Exception $e) {
    Response::error('Error en el servidor: ' . $e->getMessage(), 500);
}
