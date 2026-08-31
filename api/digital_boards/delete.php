<?php
/**
 * Eliminar digital board
 * DELETE /api/digital_boards/delete.php
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';

try {
    $db = new Database();
    $auth = new Auth($db);
    $apiAuth = new ApiAuth($db);
    
    $actor = $apiAuth->requireActor($auth);
    $apiAuth->requireScope($actor, 'write');
    
    // Solo admin puede eliminar
    if ($actor['via'] === 'session' && $auth->getCurrentUser()['role'] !== ROLE_ADMIN) {
        Response::error('Permisos insuficientes', 403);
    }
    
    $store_id = (int)$actor['store_id'];
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!$input || empty($input['board_id'])) {
        Response::validationError(['board_id' => 'Requerido']);
    }
    
    $board_id = (int)$input['board_id'];
    
    // Verificar que el board pertenece a esta tienda
    $existing = $db->selectOne(
        'SELECT board_id, name FROM digital_boards WHERE board_id = ? AND store_id = ?',
        [$board_id, $store_id]
    );
    if (!$existing) {
        Response::notFound('Board no encontrado');
    }
    
    // Eliminar board (CASCADE eliminará slides y elements)
    $db->delete('DELETE FROM digital_boards WHERE board_id = ?', [$board_id]);
    
    Response::success(['board_id' => $board_id, 'name' => $existing['name']], 'Board eliminado');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
