<?php
/**
 * Quitar una slide reutilizable de un board, sin borrar su maestra.
 * POST /api/board_slide_assignments/remove.php
 * { assignment_id }
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
    $data = json_decode(file_get_contents('php://input'), true); $id = (int)($data['assignment_id'] ?? 0);
    if ($id <= 0) Response::validationError(['assignment_id' => 'Requerido']);
    $item = $db->selectOne(
        'SELECT a.assignment_id FROM digital_board_slide_assignments a INNER JOIN digital_boards db ON db.board_id = a.board_id WHERE a.assignment_id = ? AND db.store_id = ?',
        [$id, (int)$actor['store_id']]
    );
    if (!$item) Response::notFound('Asignación no encontrada');
    $db->delete('DELETE FROM digital_board_slide_assignments WHERE assignment_id = ?', [$id]);
    Response::success(['assignment_id' => $id], 'Diapositiva retirada de la pantalla');
} catch (Exception $e) { Response::error('Error del servidor: ' . $e->getMessage(), 500); }
