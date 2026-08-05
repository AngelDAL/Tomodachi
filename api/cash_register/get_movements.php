<?php
/**
 * Obtener historial de movimientos de una caja
 * GET /api/cash_register/get_movements.php?register_id=1
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';

$method = $_SERVER['REQUEST_METHOD'];
if ($method !== 'GET') { Response::error('Método no permitido', 405); }

try {
    $db = new Database();
    $auth = new Auth($db);

    if (!$auth->isLoggedIn()) { Response::unauthorized(); }

    $register_id = isset($_GET['register_id']) ? (int)$_GET['register_id'] : 0;
    if (!$register_id) { Response::validationError(['register_id' => 'Requerido']); }

    // Seguridad: el usuario solo puede ver movimientos de cajas de su propia tienda
    $currentUser = $auth->getCurrentUser();
    $register = $db->selectOne('SELECT register_id, store_id FROM cash_registers WHERE register_id = ?', [$register_id]);
    if (!$register) { Response::notFound('Caja no existe'); }
    if ((int)$register['store_id'] !== (int)$currentUser['store_id']) {
        Response::error('No autorizado para ver cajas de otra tienda', 403);
    }

    // Obtener movimientos
    $sql = "SELECT 
                cm.movement_id, 
                cm.movement_type, 
                cm.amount, 
                cm.description, 
                cm.created_at, 
                u.full_name as user_name
            FROM cash_movements cm
            JOIN users u ON cm.user_id = u.user_id
            WHERE cm.register_id = ?
            ORDER BY cm.created_at ASC"; // Orden ASC para calcular acumulados fácilmente
    
    $movements = $db->select($sql, [$register_id]);

    Response::success([
        'movements' => $movements,
        'initial_amount' => (float)$register['initial_amount'],
        'opening_date' => $register['opening_date']
    ]);

} catch (Exception $e) {
    Response::error('Error servidor: ' . $e->getMessage(), 500);
}
