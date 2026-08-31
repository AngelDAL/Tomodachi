<?php
/**
 * Crear slide
 * POST /api/board_slides/create.php
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
    
    if (!$input || empty($input['board_id'])) {
        Response::validationError(['board_id' => 'Requerido']);
    }
    
    $board_id = (int)$input['board_id'];
    
    // Verificar que el board pertenece a esta tienda
    $board = $db->selectOne(
        'SELECT board_id FROM digital_boards WHERE board_id = ? AND store_id = ?',
        [$board_id, $store_id]
    );
    if (!$board) {
        Response::notFound('Board no encontrado');
    }
    
    // Validaciones
    $grid_cols = (int)($input['grid_cols'] ?? 3);
    $grid_rows = (int)($input['grid_rows'] ?? 2);
    if ($grid_cols < 1 || $grid_cols > 10) {
        Response::validationError(['grid_cols' => 'Debe estar entre 1 y 10']);
    }
    if ($grid_rows < 1 || $grid_rows > 10) {
        Response::validationError(['grid_rows' => 'Debe estar entre 1 y 10']);
    }
    
    $enter_animation = $input['enter_animation'] ?? 'fade';
    if (!in_array($enter_animation, ['fade', 'slide_up', 'scale_in', 'none'])) {
        Response::validationError(['enter_animation' => 'Valor inválido']);
    }
    
    $exit_animation = $input['exit_animation'] ?? 'fade';
    if (!in_array($exit_animation, ['fade', 'slide_up', 'scale_out', 'none'])) {
        Response::validationError(['exit_animation' => 'Valor inválido']);
    }
    
    $custom_duration = isset($input['custom_duration']) ? (int)$input['custom_duration'] : null;
    if ($custom_duration !== null && ($custom_duration < 3 || $custom_duration > 300)) {
        Response::validationError(['custom_duration' => 'Debe estar entre 3 y 300 segundos']);
    }
    
    // Calcular position (al final)
    $max_position = $db->selectOne(
        'SELECT MAX(position) as max_pos FROM board_slides WHERE board_id = ?',
        [$board_id]
    );
    $position = ($max_position['max_pos'] ?? -1) + 1;
    
    $slide_id = $db->insert(
        'INSERT INTO board_slides 
         (board_id, position, title, grid_cols, grid_rows, enter_animation, exit_animation, 
          custom_duration, background_color, background_image)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            $board_id,
            $position,
            $input['title'] ?? null,
            $grid_cols,
            $grid_rows,
            $enter_animation,
            $exit_animation,
            $custom_duration,
            $input['background_color'] ?? null,
            $input['background_image'] ?? null
        ]
    );
    
    $slide = $db->selectOne(
        'SELECT * FROM board_slides WHERE slide_id = ?',
        [$slide_id]
    );
    
    Response::success($slide, 'Slide creado exitosamente', 201);
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
