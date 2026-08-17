<?php
/**
 * Actualizar elemento
 * PUT /api/slide_elements/update.php
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
        'SELECT se.element_id, se.slide_id, bs.grid_cols, bs.grid_rows
         FROM slide_elements se
         INNER JOIN board_slides bs ON se.slide_id = bs.slide_id
         INNER JOIN digital_boards db ON bs.board_id = db.board_id
         WHERE se.element_id = ? AND db.store_id = ?',
        [$element_id, $store_id]
    );
    if (!$existing) {
        Response::notFound('Elemento no encontrado');
    }
    
    // Construir UPDATE dinámico
    $updates = [];
    $params = [];
    
    if (isset($input['element_type'])) {
        $valid_types = ['product_card', 'image', 'text', 'category_grid', 'banner', 'clock'];
        if (!in_array($input['element_type'], $valid_types)) {
            Response::validationError(['element_type' => 'Tipo inválido']);
        }
        $updates[] = 'element_type = ?';
        $params[] = $input['element_type'];
    }
    
    if (isset($input['grid_col'])) {
        $grid_col = (int)$input['grid_col'];
        if ($grid_col < 1 || $grid_col > $existing['grid_cols']) {
            Response::validationError(['grid_col' => 'Fuera de rango del grid']);
        }
        $updates[] = 'grid_col = ?';
        $params[] = $grid_col;
    }
    
    if (isset($input['grid_row'])) {
        $grid_row = (int)$input['grid_row'];
        if ($grid_row < 1 || $grid_row > $existing['grid_rows']) {
            Response::validationError(['grid_row' => 'Fuera de rango del grid']);
        }
        $updates[] = 'grid_row = ?';
        $params[] = $grid_row;
    }
    
    if (isset($input['col_span'])) {
        $col_span = (int)$input['col_span'];
        if ($col_span < 1) {
            Response::validationError(['col_span' => 'Debe ser mayor a 0']);
        }
        // Validar que no exceda el grid (considerando grid_col actual o nuevo)
        $current_col = isset($input['grid_col']) ? (int)$input['grid_col'] : $db->selectOne('SELECT grid_col FROM slide_elements WHERE element_id = ?', [$element_id])['grid_col'];
        if (($current_col + $col_span - 1) > $existing['grid_cols']) {
            Response::validationError(['col_span' => 'Excede el ancho del grid']);
        }
        $updates[] = 'col_span = ?';
        $params[] = $col_span;
    }
    
    if (isset($input['row_span'])) {
        $row_span = (int)$input['row_span'];
        if ($row_span < 1) {
            Response::validationError(['row_span' => 'Debe ser mayor a 0']);
        }
        $current_row = isset($input['grid_row']) ? (int)$input['grid_row'] : $db->selectOne('SELECT grid_row FROM slide_elements WHERE element_id = ?', [$element_id])['grid_row'];
        if (($current_row + $row_span - 1) > $existing['grid_rows']) {
            Response::validationError(['row_span' => 'Excede el alto del grid']);
        }
        $updates[] = 'row_span = ?';
        $params[] = $row_span;
    }
    
    if (isset($input['z_index'])) {
        $updates[] = 'z_index = ?';
        $params[] = (int)$input['z_index'];
    }
    
    if (isset($input['content'])) {
        if (!is_array($input['content'])) {
            Response::validationError(['content' => 'Debe ser un objeto']);
        }
        $updates[] = 'content = ?';
        $params[] = json_encode($input['content']);
    }
    
    if (isset($input['animation'])) {
        if (!in_array($input['animation'], ['fade_in', 'slide_up', 'scale_in', 'stagger', 'none'])) {
            Response::validationError(['animation' => 'Valor inválido']);
        }
        $updates[] = 'animation = ?';
        $params[] = $input['animation'];
    }
    
    if (isset($input['animation_delay'])) {
        $delay = (float)$input['animation_delay'];
        if ($delay < 0 || $delay > 10) {
            Response::validationError(['animation_delay' => 'Debe estar entre 0 y 10 segundos']);
        }
        $updates[] = 'animation_delay = ?';
        $params[] = $delay;
    }
    
    if (empty($updates)) {
        Response::validationError(['fields' => 'No hay campos para actualizar']);
    }
    
    $params[] = $element_id;
    
    $db->update(
        'UPDATE slide_elements SET ' . implode(', ', $updates) . ' WHERE element_id = ?',
        $params
    );
    
    $element = $db->selectOne(
        'SELECT * FROM slide_elements WHERE element_id = ?',
        [$element_id]
    );
    $element['content'] = json_decode($element['content'], true);
    
    Response::success($element, 'Elemento actualizado');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
