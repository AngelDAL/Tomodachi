<?php
/**
 * Crear nueva terminal (Caja)
 * POST /api/terminals/create.php {"terminal_name": "Caja 2"}
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';

$method = $_SERVER['REQUEST_METHOD'];
if ($method !== 'POST') { Response::error('Método no permitido', 405); }

try {
    $db = new Database();
    $auth = new Auth($db);

    if (!$auth->isLoggedIn()) { Response::unauthorized(); }
    if (!$auth->hasRole([ROLE_ADMIN, ROLE_MANAGER])) { Response::error('Permisos insuficientes', 403); }

    $currentUser = $auth->getCurrentUser();
    $store_id = $currentUser['store_id'];

    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { Response::validationError(['body' => 'JSON inválido']); }

    $terminal_name = isset($data['terminal_name']) ? trim($data['terminal_name']) : '';
    
    if (empty($terminal_name)) { Response::validationError(['terminal_name' => 'Requerido']); }

    // Verificar si ya existe una con ese nombre en la tienda
    $exists = $db->selectOne('SELECT terminal_id FROM terminals WHERE store_id = ? AND terminal_name = ?', [$store_id, $terminal_name]);
    if ($exists) { Response::error('Ya existe una terminal con ese nombre', 409); }

    $terminal_id = $db->insert('INSERT INTO terminals (store_id, terminal_name, status) VALUES (?, ?, ?)', [
        $store_id, $terminal_name, 'active'
    ]);

    Response::success(['terminal_id' => $terminal_id, 'terminal_name' => $terminal_name], 'Terminal creada exitosamente');

} catch (Exception $e) {
    Response::error('Error servidor: ' . $e->getMessage(), 500);
}
