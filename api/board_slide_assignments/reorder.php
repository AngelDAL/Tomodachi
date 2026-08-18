<?php
/**
 * Reordenar la secuencia reutilizable de un board.
 * PUT /api/board_slide_assignments/reorder.php
 * { board_id, assignment_ids: [] }
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';

try {
    $db = new Database(); $auth = new Auth($db); $apiAuth = new ApiAuth($db);
    $actor = $apiAuth->requireActor($auth); $apiAuth->requireScope($actor, 'write');
    if ($actor['via'] === 'session' && !in_array($auth->getCurrentUser()['role'], [ROLE_ADMIN, ROLE_MANAGER])) Response::error('Permisos insuficientes', 403);
    $data = json_decode(file_get_contents('php://input'), true);
    $boardId = (int)($data['board_id'] ?? 0); $ids = $data['assignment_ids'] ?? [];
    if ($boardId <= 0 || !is_array($ids)) Response::validationError(['board_id' => 'Requerido', 'assignment_ids' => 'Array requerido']);
    $storeId = (int)$actor['store_id'];
    if (!$db->selectOne('SELECT board_id FROM digital_boards WHERE board_id = ? AND store_id = ?', [$boardId, $storeId])) Response::notFound('Board no encontrado');
    $ids = array_values(array_unique(array_map('intval', $ids)));
    $existing = $db->select('SELECT assignment_id FROM digital_board_slide_assignments WHERE board_id = ?', [$boardId]);
    $existingIds = array_map('intval', array_column($existing, 'assignment_id'));
    sort($ids); sort($existingIds);
    if ($ids !== $existingIds) Response::validationError(['assignment_ids' => 'La secuencia no coincide con las diapositivas de esta pantalla']);
    foreach ($data['assignment_ids'] as $position => $id) $db->update('UPDATE digital_board_slide_assignments SET position = ? WHERE assignment_id = ? AND board_id = ?', [$position, (int)$id, $boardId]);
    Response::success(['board_id' => $boardId], 'Secuencia actualizada');
} catch (Exception $e) { Response::error('Error del servidor: ' . $e->getMessage(), 500); }
