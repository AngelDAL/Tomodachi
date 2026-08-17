<?php
/**
 * Obtener board completo con slides y elementos (ENDPOINT PÚBLICO PARA TV)
 * GET /api/digital_boards/get_board.php?board_id=X
 * NO REQUIERE AUTENTICACIÓN
 */
require_once '../../config/database.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';

header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=utf-8');

try {
    $db = new Database();
    
    $board_id = isset($_GET['board_id']) ? (int)$_GET['board_id'] : 0;
    if ($board_id <= 0) {
        Response::validationError(['board_id' => 'Requerido']);
    }
    
    // Obtener board (debe estar activo)
    $board = $db->selectOne(
        'SELECT board_id, store_id, name, orientation, slide_duration, 
                transition_animation, theme_config, show_qr
         FROM digital_boards 
         WHERE board_id = ? AND is_active = 1',
        [$board_id]
    );
    
    if (!$board) {
        Response::notFound('Board no encontrado o inactivo');
    }
    
    // Verificar activación automática por fecha
    $now = date('Y-m-d H:i:s');
    if ($board['scheduled_start'] && $now < $board['scheduled_start']) {
        Response::error('Board aún no activo', 403);
    }
    if ($board['scheduled_end'] && $now > $board['scheduled_end']) {
        Response::error('Board ya expiró', 403);
    }
    
    // Obtener slides del board
    $slides = $db->select(
        'SELECT slide_id, position, title, grid_cols, grid_rows, 
                enter_animation, exit_animation, custom_duration, 
                background_color, background_image
         FROM board_slides 
         WHERE board_id = ? 
         ORDER BY position ASC',
        [$board_id]
    );
    
    // Obtener elementos de cada slide
    foreach ($slides as &$slide) {
        $elements = $db->select(
            'SELECT element_id, element_type, grid_col, grid_row, col_span, row_span,
                    z_index, content, animation, animation_delay
             FROM slide_elements 
             WHERE slide_id = ? 
             ORDER BY z_index ASC, grid_row ASC, grid_col ASC',
            [$slide['slide_id']]
        );
        
        // Parsear content JSON
        foreach ($elements as &$element) {
            $element['content'] = json_decode($element['content'], true);
        }
        
        $slide['elements'] = $elements;
    }
    
    $board['slides'] = $slides;
    
    // Decodificar theme_config si existe
    if ($board['theme_config']) {
        $board['theme_config'] = json_decode($board['theme_config'], true);
    }
    
    Response::success($board, 'Board obtenido');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
