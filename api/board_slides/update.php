<?php
/**
 * Actualizar slide
 * PUT /api/board_slides/update.php
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
        'SELECT bs.slide_id, bs.board_id 
         FROM board_slides bs
         INNER JOIN digital_boards db ON bs.board_id = db.board_id
         WHERE bs.slide_id = ? AND db.store_id = ?',
        [$slide_id, $store_id]
    );
    if (!$existing) {
        Response::notFound('Slide no encontrado');
    }
    
    // Construir UPDATE dinámico
    $updates = [];
    $params = [];
    
    if (array_key_exists('title', $input)) {
        $updates[] = 'title = ?';
        $params[] = $input['title'];
    }
    
    if (isset($input['grid_cols'])) {
        $grid_cols = (int)$input['grid_cols'];
        if ($grid_cols < 1 || $grid_cols > 10) {
            Response::validationError(['grid_cols' => 'Debe estar entre 1 y 10']);
        }
        $updates[] = 'grid_cols = ?';
        $params[] = $grid_cols;
    }
    
    if (isset($input['grid_rows'])) {
        $grid_rows = (int)$input['grid_rows'];
        if ($grid_rows < 1 || $grid_rows > 10) {
            Response::validationError(['grid_rows' => 'Debe estar entre 1 y 10']);
        }
        $updates[] = 'grid_rows = ?';
        $params[] = $grid_rows;
    }
    
    if (isset($input['enter_animation'])) {
        if (!in_array($input['enter_animation'], ['fade', 'slide_up', 'scale_in', 'none'])) {
            Response::validationError(['enter_animation' => 'Valor inválido']);
        }
        $updates[] = 'enter_animation = ?';
        $params[] = $input['enter_animation'];
    }
    
    if (isset($input['exit_animation'])) {
        if (!in_array($input['exit_animation'], ['fade', 'slide_up', 'scale_out', 'none'])) {
            Response::validationError(['exit_animation' => 'Valor inválido']);
        }
        $updates[] = 'exit_animation = ?';
        $params[] = $input['exit_animation'];
    }
    
    if (array_key_exists('custom_duration', $input)) {
        $custom_duration = !empty($input['custom_duration']) ? (int)$input['custom_duration'] : null;
        if ($custom_duration !== null && ($custom_duration < 3 || $custom_duration > 300)) {
            Response::validationError(['custom_duration' => 'Debe estar entre 3 y 300 segundos']);
        }
        $updates[] = 'custom_duration = ?';
        $params[] = $custom_duration;
    }
    
    if (array_key_exists('background_color', $input)) {
        $updates[] = 'background_color = ?';
        $params[] = $input['background_color'];
    }
    
    if (array_key_exists('background_image', $input)) {
        $updates[] = 'background_image = ?';
        $params[] = $input['background_image'];
    }
    
    if (isset($input['orientation'])) {
        if (!in_array($input['orientation'], ['auto', 'horizontal', 'vertical'])) {
            Response::validationError(['orientation' => 'Valor inválido']);
        }
        $updates[] = 'orientation = ?';
        $params[] = $input['orientation'];
    }
    
    if (array_key_exists('layout_width', $input)) {
        $layout_width = !empty($input['layout_width']) ? (int)$input['layout_width'] : null;
        if ($layout_width !== null && ($layout_width < 300 || $layout_width > 4000)) {
            Response::validationError(['layout_width' => 'Debe estar entre 300 y 4000']);
        }
        $updates[] = 'layout_width = ?';
        $params[] = $layout_width;
    }
    
    if (array_key_exists('layout_height', $input)) {
        $layout_height = !empty($input['layout_height']) ? (int)$input['layout_height'] : null;
        if ($layout_height !== null && ($layout_height < 300 || $layout_height > 4000)) {
            Response::validationError(['layout_height' => 'Debe estar entre 300 y 4000']);
        }
        $updates[] = 'layout_height = ?';
        $params[] = $layout_height;
    }
    
    if (empty($updates)) {
        Response::validationError(['fields' => 'No hay campos para actualizar']);
    }
    
    $params[] = $slide_id;
    
    $db->update(
        'UPDATE board_slides SET ' . implode(', ', $updates) . ' WHERE slide_id = ?',
        $params
    );
    
    $slide = $db->selectOne(
        'SELECT * FROM board_slides WHERE slide_id = ?',
        [$slide_id]
    );
    
    Response::success($slide, 'Slide actualizado');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
