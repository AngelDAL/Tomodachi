<?php
/**
 * Actualizar digital board
 * PUT /api/digital_boards/update.php
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
    $existing = $db->selectOne(
        'SELECT board_id FROM digital_boards WHERE board_id = ? AND store_id = ?',
        [$board_id, $store_id]
    );
    if (!$existing) {
        Response::notFound('Board no encontrado');
    }
    
    // Construir UPDATE dinámico
    $updates = [];
    $params = [];
    
    if (isset($input['name'])) {
        if (empty($input['name']) || strlen($input['name']) > 100) {
            Response::validationError(['name' => 'Debe tener entre 1 y 100 caracteres']);
        }
        $updates[] = 'name = ?';
        $params[] = $input['name'];
    }
    
    if (array_key_exists('description', $input)) {
        $updates[] = 'description = ?';
        $params[] = $input['description'];
    }
    
    if (isset($input['is_active'])) {
        $updates[] = 'is_active = ?';
        $params[] = (int)$input['is_active'];
    }
    
    if (isset($input['orientation'])) {
        if (!in_array($input['orientation'], ['horizontal', 'vertical', 'auto'])) {
            Response::validationError(['orientation' => 'Valor inválido']);
        }
        $updates[] = 'orientation = ?';
        $params[] = $input['orientation'];
    }
    
    if (isset($input['slide_duration'])) {
        $duration = (int)$input['slide_duration'];
        if ($duration < 3 || $duration > 300) {
            Response::validationError(['slide_duration' => 'Debe estar entre 3 y 300 segundos']);
        }
        $updates[] = 'slide_duration = ?';
        $params[] = $duration;
    }
    
    if (isset($input['transition_animation'])) {
        if (!in_array($input['transition_animation'], ['fade', 'slide_left', 'slide_up', 'zoom', 'none'])) {
            Response::validationError(['transition_animation' => 'Valor inválido']);
        }
        $updates[] = 'transition_animation = ?';
        $params[] = $input['transition_animation'];
    }
    
    if (array_key_exists('theme_config', $input)) {
        $updates[] = 'theme_config = ?';
        $params[] = $input['theme_config'] ? json_encode($input['theme_config']) : null;
    }
    
    if (array_key_exists('template', $input)) {
        $updates[] = 'template = ?';
        $params[] = $input['template'];
    }
    
    if (array_key_exists('scheduled_start', $input)) {
        $scheduled_start = !empty($input['scheduled_start']) ? date('Y-m-d H:i:s', strtotime($input['scheduled_start'])) : null;
        $updates[] = 'scheduled_start = ?';
        $params[] = $scheduled_start;
    }
    
    if (array_key_exists('scheduled_end', $input)) {
        $scheduled_end = !empty($input['scheduled_end']) ? date('Y-m-d H:i:s', strtotime($input['scheduled_end'])) : null;
        $updates[] = 'scheduled_end = ?';
        $params[] = $scheduled_end;
    }
    
    if (isset($input['show_qr'])) {
        $updates[] = 'show_qr = ?';
        $params[] = (int)$input['show_qr'];
    }
    
    if (empty($updates)) {
        Response::validationError(['fields' => 'No hay campos para actualizar']);
    }
    
    $params[] = $board_id;
    $params[] = $store_id;
    
    $db->update(
        'UPDATE digital_boards SET ' . implode(', ', $updates) . ' WHERE board_id = ? AND store_id = ?',
        $params
    );
    
    $board = $db->selectOne(
        'SELECT * FROM digital_boards WHERE board_id = ?',
        [$board_id]
    );
    
    Response::success($board, 'Board actualizado');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
