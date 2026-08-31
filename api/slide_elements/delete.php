<?php
/**
 * Eliminar elemento
 * DELETE /api/slide_elements/delete.php
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
    
    if (!$input || empty($input['element_id'])) {
        Response::validationError(['element_id' => 'Requerido']);
    }
    
    $element_id = (int)$input['element_id'];
    
    // Verificar que el elemento pertenece a un slide de esta tienda
    $existing = $db->selectOne(
        'SELECT se.element_id, se.element_type
         FROM slide_elements se
         INNER JOIN board_slides bs ON se.slide_id = bs.slide_id
         INNER JOIN digital_boards db ON bs.board_id = db.board_id
         WHERE se.element_id = ? AND db.store_id = ?',
        [$element_id, $store_id]
    );
    if (!$existing) {
        Response::notFound('Elemento no encontrado');
    }
    
    $db->delete('DELETE FROM slide_elements WHERE element_id = ?', [$element_id]);
    
    Response::success(['element_id' => $element_id], 'Elemento eliminado');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
