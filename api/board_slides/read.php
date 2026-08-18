<?php
/**
 * Listar slides de un board
 * GET /api/board_slides/read.php?board_id=X
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
    $apiAuth->requireScope($actor, 'read');
    
    $store_id = (int)$actor['store_id'];
    $board_id = isset($_GET['board_id']) ? (int)$_GET['board_id'] : 0;
    
    if ($board_id <= 0) {
        Response::validationError(['board_id' => 'Requerido']);
    }
    
    // Verificar que el board pertenece a esta tienda
    $board = $db->selectOne(
        'SELECT board_id FROM digital_boards WHERE board_id = ? AND store_id = ?',
        [$board_id, $store_id]
    );
    if (!$board) {
        Response::notFound('Board no encontrado');
    }
    
    $slides = $db->select(
        'SELECT slide_id, position, orientation, layout_width, layout_height, title, grid_cols, grid_rows, 
                enter_animation, exit_animation, custom_duration, 
                background_color, background_image, created_at
         FROM board_slides 
         WHERE board_id = ? 
         ORDER BY position ASC',
        [$board_id]
    );
    
    Response::success($slides, 'Slides obtenidos');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
