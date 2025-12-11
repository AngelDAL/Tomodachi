<?php
/**
 * Eliminar (desactivar) terminal
 * POST /api/terminals/delete.php {"terminal_id": 1}
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

    $terminal_id = isset($data['terminal_id']) ? (int)$data['terminal_id'] : 0;
    if ($terminal_id <= 0) { Response::validationError(['terminal_id' => 'Requerido']); }

    // Verificar que la terminal pertenezca a la tienda
    $terminal = $db->selectOne('SELECT * FROM terminals WHERE terminal_id = ? AND store_id = ?', [$terminal_id, $store_id]);
    if (!$terminal) { Response::error('Terminal no encontrada', 404); }

    // Verificar si tiene caja abierta
    $open = $db->selectOne('SELECT register_id FROM cash_registers WHERE terminal_id = ? AND status = ?', [$terminal_id, REGISTER_OPEN]);
    if ($open) { Response::error('No se puede eliminar una terminal con caja abierta. Cierre la caja primero.', 409); }

    // Soft delete
    $db->update('UPDATE terminals SET status = ? WHERE terminal_id = ?', ['inactive', $terminal_id]);

    Response::success([], 'Terminal eliminada correctamente');

} catch (Exception $e) {
    Response::error('Error servidor: ' . $e->getMessage(), 500);
}
