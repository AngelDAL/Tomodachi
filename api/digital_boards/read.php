<?php
/**
 * Listar digital boards de la tienda
 * GET /api/digital_boards/read.php
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
    
    $boards = $db->select(
        'SELECT board_id, name, description, is_active, orientation, slide_duration, 
                transition_animation, template, scheduled_start, scheduled_end, 
                show_qr, created_at, updated_at
         FROM digital_boards 
         WHERE store_id = ? 
         ORDER BY created_at DESC',
        [$store_id]
    );
    
    Response::success($boards, 'Boards digitales obtenidos');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
