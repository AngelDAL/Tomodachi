<?php
/**
 * Crear digital board
 * POST /api/digital_boards/create.php
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
    
    // Solo admin y manager pueden crear boards
    if ($actor['via'] === 'session' && !in_array($auth->getCurrentUser()['role'], [ROLE_ADMIN, ROLE_MANAGER])) {
        Response::error('Permisos insuficientes', 403);
    }
    
    $store_id = (int)$actor['store_id'];
    
    $input = json_decode(file_get_contents('php://input'), true);
    if (!$input) {
        Response::validationError(['body' => 'JSON inválido']);
    }
    
    // Validaciones
    if (empty($input['name'])) {
        Response::validationError(['name' => 'El nombre es requerido']);
    }
    if (strlen($input['name']) > 100) {
        Response::validationError(['name' => 'Máximo 100 caracteres']);
    }
    
    $orientation = $input['orientation'] ?? 'auto';
    if (!in_array($orientation, ['horizontal', 'vertical', 'auto'])) {
        Response::validationError(['orientation' => 'Valor inválido']);
    }
    
    $slide_duration = (int)($input['slide_duration'] ?? 10);
    if ($slide_duration < 3 || $slide_duration > 300) {
        Response::validationError(['slide_duration' => 'Debe estar entre 3 y 300 segundos']);
    }
    
    $transition = $input['transition_animation'] ?? 'fade';
    if (!in_array($transition, ['fade', 'slide_left', 'slide_up', 'zoom', 'none'])) {
        Response::validationError(['transition_animation' => 'Valor inválido']);
    }
    
    // Fechas programadas (opcionales)
    $scheduled_start = null;
    $scheduled_end = null;
    if (!empty($input['scheduled_start'])) {
        $scheduled_start = date('Y-m-d H:i:s', strtotime($input['scheduled_start']));
    }
    if (!empty($input['scheduled_end'])) {
        $scheduled_end = date('Y-m-d H:i:s', strtotime($input['scheduled_end']));
        if ($scheduled_start && $scheduled_end < $scheduled_start) {
            Response::validationError(['scheduled_end' => 'Debe ser posterior a scheduled_start']);
        }
    }
    
    $board_id = $db->insert(
        'INSERT INTO digital_boards 
         (store_id, name, description, is_active, orientation, slide_duration, 
          transition_animation, theme_config, template, scheduled_start, scheduled_end, show_qr)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            $store_id,
            $input['name'],
            $input['description'] ?? null,
            (int)($input['is_active'] ?? 0),
            $orientation,
            $slide_duration,
            $transition,
            isset($input['theme_config']) ? json_encode($input['theme_config']) : null,
            $input['template'] ?? null,
            $scheduled_start,
            $scheduled_end,
            (int)($input['show_qr'] ?? 1)
        ]
    );
    
    $board = $db->selectOne(
        'SELECT * FROM digital_boards WHERE board_id = ? AND store_id = ?',
        [$board_id, $store_id]
    );
    
    Response::success($board, 'Board creado exitosamente', 201);
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
