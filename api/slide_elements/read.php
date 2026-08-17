<?php
/**
 * Listar elementos de un slide
 * GET /api/slide_elements/read.php?slide_id=X
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
    $slide_id = isset($_GET['slide_id']) ? (int)$_GET['slide_id'] : 0;
    
    if ($slide_id <= 0) {
        Response::validationError(['slide_id' => 'Requerido']);
    }
    
    // Verificar que el slide pertenece a un board de esta tienda
    $slide = $db->selectOne(
        'SELECT bs.slide_id 
         FROM board_slides bs
         INNER JOIN digital_boards db ON bs.board_id = db.board_id
         WHERE bs.slide_id = ? AND db.store_id = ?',
        [$slide_id, $store_id]
    );
    if (!$slide) {
        Response::notFound('Slide no encontrado');
    }
    
    $elements = $db->select(
        'SELECT element_id, element_type, grid_col, grid_row, col_span, row_span,
                z_index, content, animation, animation_delay
         FROM slide_elements 
         WHERE slide_id = ? 
         ORDER BY z_index ASC, grid_row ASC, grid_col ASC',
        [$slide_id]
    );
    
    // Parsear content JSON
    foreach ($elements as &$element) {
        $element['content'] = json_decode($element['content'], true);
    }
    
    Response::success($elements, 'Elementos obtenidos');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
