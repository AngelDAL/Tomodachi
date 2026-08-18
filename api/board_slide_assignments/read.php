<?php
/**
 * Listar la secuencia reutilizable asignada a un board.
 * GET /api/board_slide_assignments/read.php?board_id=X
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
    $apiAuth->requireScope($actor, 'read');
    $storeId = (int)$actor['store_id'];
    $boardId = (int)($_GET['board_id'] ?? 0);
    if ($boardId <= 0) Response::validationError(['board_id' => 'Requerido']);

    $board = $db->selectOne('SELECT board_id FROM digital_boards WHERE board_id = ? AND store_id = ?', [$boardId, $storeId]);
    if (!$board) Response::notFound('Board no encontrado');

    $items = $db->select(
        'SELECT a.assignment_id, a.position, a.custom_duration,
                bs.slide_id, bs.title, bs.grid_cols, bs.grid_rows, bs.enter_animation,
                bs.exit_animation, bs.background_color, bs.background_image,
                source.board_id AS source_board_id,
                COUNT(se.element_id) AS element_count
         FROM digital_board_slide_assignments a
         INNER JOIN board_slides bs ON bs.slide_id = a.source_slide_id
         INNER JOIN digital_boards source ON source.board_id = bs.board_id
         LEFT JOIN slide_elements se ON se.slide_id = bs.slide_id
         WHERE a.board_id = ?
         GROUP BY a.assignment_id
         ORDER BY a.position ASC, a.assignment_id ASC',
        [$boardId]
    );
    Response::success($items, 'Secuencia de diapositivas obtenida');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
