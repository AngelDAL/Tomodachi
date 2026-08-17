<?php
/**
 * Crear elemento de slide
 * POST /api/slide_elements/create.php
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
    $slide = $db->selectOne(
        'SELECT bs.slide_id, bs.grid_cols, bs.grid_rows
         FROM board_slides bs
         INNER JOIN digital_boards db ON bs.board_id = db.board_id
         WHERE bs.slide_id = ? AND db.store_id = ?',
        [$slide_id, $store_id]
    );
    if (!$slide) {
        Response::notFound('Slide no encontrado');
    }
    
    // Validaciones
    if (empty($input['element_type'])) {
        Response::validationError(['element_type' => 'Requerido']);
    }
    $valid_types = ['product_card', 'image', 'text', 'category_grid', 'banner', 'clock'];
    if (!in_array($input['element_type'], $valid_types)) {
        Response::validationError(['element_type' => 'Tipo inválido']);
    }
    
    $grid_col = (int)($input['grid_col'] ?? 1);
    $grid_row = (int)($input['grid_row'] ?? 1);
    $col_span = (int)($input['col_span'] ?? 1);
    $row_span = (int)($input['row_span'] ?? 1);
    
    if ($grid_col < 1 || $grid_col > $slide['grid_cols']) {
        Response::validationError(['grid_col' => 'Fuera de rango del grid']);
    }
    if ($grid_row < 1 || $grid_row > $slide['grid_rows']) {
        Response::validationError(['grid_row' => 'Fuera de rango del grid']);
    }
    if ($col_span < 1 || ($grid_col + $col_span - 1) > $slide['grid_cols']) {
        Response::validationError(['col_span' => 'Excede el ancho del grid']);
    }
    if ($row_span < 1 || ($grid_row + $row_span - 1) > $slide['grid_rows']) {
        Response::validationError(['row_span' => 'Excede el alto del grid']);
    }
    
    if (!isset($input['content']) || !is_array($input['content'])) {
        Response::validationError(['content' => 'Objeto requerido']);
    }
    
    $animation = $input['animation'] ?? 'fade_in';
    if (!in_array($animation, ['fade_in', 'slide_up', 'scale_in', 'stagger', 'none'])) {
        Response::validationError(['animation' => 'Valor inválido']);
    }
    
    $animation_delay = (float)($input['animation_delay'] ?? 0);
    if ($animation_delay < 0 || $animation_delay > 10) {
        Response::validationError(['animation_delay' => 'Debe estar entre 0 y 10 segundos']);
    }
    
    $z_index = (int)($input['z_index'] ?? 1);
    
    $db->insert(
        'INSERT INTO slide_elements 
         (slide_id, element_type, grid_col, grid_row, col_span, row_span, 
          z_index, content, animation, animation_delay)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            $slide_id,
            $input['element_type'],
            $grid_col,
            $grid_row,
            $col_span,
            $row_span,
            $z_index,
            json_encode($input['content']),
            $animation,
            $animation_delay
        ]
    );
    
    $element_id = $db->lastInsertId();
    
    $element = $db->selectOne(
        'SELECT * FROM slide_elements WHERE element_id = ?',
        [$element_id]
    );
    $element['content'] = json_decode($element['content'], true);
    
    Response::success($element, 'Elemento creado exitosamente', 201);
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
