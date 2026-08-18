<?php
/**
 * Asignar una slide de la biblioteca a un board.
 * POST /api/board_slide_assignments/assign.php
 * { board_id, source_slide_id, custom_duration? }
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
    if ($actor['via'] === 'session' && !in_array($auth->getCurrentUser()['role'], [ROLE_ADMIN, ROLE_MANAGER])) Response::error('Permisos insuficientes', 403);

    $data = json_decode(file_get_contents('php://input'), true);
    $boardId = (int)($data['board_id'] ?? 0);
    $sourceSlideId = (int)($data['source_slide_id'] ?? 0);
    if ($boardId <= 0 || $sourceSlideId <= 0) Response::validationError(['board_id' => 'Requerido', 'source_slide_id' => 'Requerido']);
    $storeId = (int)$actor['store_id'];

    $board = $db->selectOne('SELECT board_id FROM digital_boards WHERE board_id = ? AND store_id = ?', [$boardId, $storeId]);
    if (!$board) Response::notFound('Board no encontrado');
    $slide = $db->selectOne(
        'SELECT bs.slide_id FROM board_slides bs INNER JOIN digital_boards db ON db.board_id = bs.board_id WHERE bs.slide_id = ? AND db.store_id = ?',
        [$sourceSlideId, $storeId]
    );
    if (!$slide) Response::notFound('Diapositiva no encontrada');

    $exists = $db->selectOne('SELECT assignment_id FROM digital_board_slide_assignments WHERE board_id = ? AND source_slide_id = ?', [$boardId, $sourceSlideId]);
    if ($exists) Response::validationError(['source_slide_id' => 'La diapositiva ya está en esta pantalla']);

    $max = $db->selectOne('SELECT MAX(position) AS max_position FROM digital_board_slide_assignments WHERE board_id = ?', [$boardId]);
    $duration = isset($data['custom_duration']) && $data['custom_duration'] !== null ? (int)$data['custom_duration'] : null;
    if ($duration !== null && ($duration < 3 || $duration > 300)) Response::validationError(['custom_duration' => 'Debe estar entre 3 y 300 segundos']);
    $assignmentId = $db->insert(
        'INSERT INTO digital_board_slide_assignments (board_id, source_slide_id, position, custom_duration) VALUES (?, ?, ?, ?)',
        [$boardId, $sourceSlideId, ((int)($max['max_position'] ?? -1)) + 1, $duration]
    );
    Response::success(['assignment_id' => $assignmentId], 'Diapositiva agregada a la pantalla', 201);
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
