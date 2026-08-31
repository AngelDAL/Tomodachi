<?php
/**
 * Reordenar slides
 * PUT /api/board_slides/reorder.php
 * Body: { "board_id": 1, "slide_ids": [3, 1, 2] }
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
    
    if (!$input || empty($input['board_id']) || empty($input['slide_ids']) || !is_array($input['slide_ids'])) {
        Response::validationError(['board_id' => 'Requerido', 'slide_ids' => 'Array requerido']);
    }
    
    $board_id = (int)$input['board_id'];
    $slide_ids = array_map('intval', $input['slide_ids']);
    
    // Verificar que el board pertenece a esta tienda
    $board = $db->selectOne(
        'SELECT board_id FROM digital_boards WHERE board_id = ? AND store_id = ?',
        [$board_id, $store_id]
    );
    if (!$board) {
        Response::notFound('Board no encontrado');
    }
    
    // Verificar que todos los slides pertenecen a este board
    $placeholders = implode(',', array_fill(0, count($slide_ids), '?'));
    $existing = $db->select(
        "SELECT slide_id FROM board_slides WHERE board_id = ? AND slide_id IN ($placeholders)",
        array_merge([$board_id], $slide_ids)
    );
    
    if (count($existing) !== count($slide_ids)) {
        Response::validationError(['slide_ids' => 'Algunos slides no pertenecen a este board']);
    }
    
    // Actualizar posiciones
    foreach ($slide_ids as $position => $slide_id) {
        $db->update(
            'UPDATE board_slides SET position = ? WHERE slide_id = ? AND board_id = ?',
            [$position, $slide_id, $board_id]
        );
    }
    
    Response::success(['board_id' => $board_id, 'slide_ids' => $slide_ids], 'Slides reordenados');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
