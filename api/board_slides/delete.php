<?php
/**
 * Eliminar slide
 * DELETE /api/board_slides/delete.php
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
    
    if ($actor['via'] === 'session' && !in_array($auth->getCurrentUser()['role'], [ROLE_ADMIN, ROLE_MANAGER])) {
        Response::error('Permisos insuficientes', 403);
    }
    
    $store_id = (int)$actor['store_id'];
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!$input || empty($input['slide_id'])) {
        Response::validationError(['slide_id' => 'Requerido']);
    }
    
    $slide_id = (int)$input['slide_id'];
    
    // Verificar que el slide pertenece a un board de esta tienda
    $existing = $db->selectOne(
        'SELECT bs.slide_id, bs.title, bs.board_id, bs.position
         FROM board_slides bs
         INNER JOIN digital_boards db ON bs.board_id = db.board_id
         WHERE bs.slide_id = ? AND db.store_id = ?',
        [$slide_id, $store_id]
    );
    if (!$existing) {
        Response::notFound('Slide no encontrado');
    }
    
    // Eliminar slide (CASCADE eliminará elements)
    $db->delete('DELETE FROM board_slides WHERE slide_id = ?', [$slide_id]);
    
    // Reordenar slides restantes
    $db->update(
        'UPDATE board_slides SET position = position - 1 
         WHERE board_id = ? AND position > ?',
        [$existing['board_id'], $existing['position']]
    );
    
    Response::success(['slide_id' => $slide_id, 'title' => $existing['title']], 'Slide eliminado');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
