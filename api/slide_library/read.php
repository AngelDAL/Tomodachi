<?php
/**
 * Biblioteca de diapositivas reutilizables de la tienda activa.
 * GET /api/slide_library/read.php
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

    $slides = $db->select(
        'SELECT bs.slide_id, bs.title, bs.grid_cols, bs.grid_rows, bs.enter_animation,
                bs.exit_animation, bs.custom_duration, bs.background_color, bs.background_image,
                db.board_id AS source_board_id, db.name AS source_board_name,
                COUNT(se.element_id) AS element_count
         FROM board_slides bs
         INNER JOIN digital_boards db ON db.board_id = bs.board_id
         LEFT JOIN slide_elements se ON se.slide_id = bs.slide_id
         WHERE db.store_id = ?
         GROUP BY bs.slide_id
         ORDER BY bs.updated_at DESC, bs.slide_id DESC',
        [$storeId]
    );
    Response::success($slides, 'Biblioteca de diapositivas obtenida');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
