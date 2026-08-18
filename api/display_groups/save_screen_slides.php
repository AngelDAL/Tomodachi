<?php
/**
 * Guardar la lista de diapositivas de UNA pantalla (rotación independiente).
 * PUT /api/display_groups/save_screen_slides.php
 * Body: { screen_id, slides: [{source_slide_id, custom_duration?}] }
 * Reemplaza el set de slides de esa pantalla (reordenando positions).
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
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    if (empty($input['screen_id']) || !isset($input['slides'])) Response::validationError(['screen_id y slides requeridos']);

    $screen_id = (int)$input['screen_id'];
    // verificar que la pantalla pertenece a un grupo de la tienda
    $scr = $db->selectOne(
        'SELECT s.id FROM display_group_screens s INNER JOIN display_groups g ON g.group_id=s.group_id
         WHERE s.id=? AND g.store_id=?',
        [$screen_id, $store_id]
    );
    if (!$scr) Response::notFound('Pantalla no encontrada');

    // borrar slides actuales de la pantalla
    $db->update('DELETE FROM display_group_screen_slides WHERE screen_id = ?', [$screen_id]);

    $slides = $input['slides'];
    $count = 0;
    $pos = 0;
    foreach ($slides as $sl) {
        $sid = (int)($sl['source_slide_id'] ?? 0);
        if ($sid <= 0) continue;
        // validar que el slide es de la tienda
        $ok = $db->selectOne(
            'SELECT bs.slide_id FROM board_slides bs INNER JOIN digital_boards db ON db.board_id=bs.board_id WHERE bs.slide_id=? AND db.store_id=?',
            [$sid, $store_id]
        );
        if (!$ok) continue;
        $dur = isset($sl['custom_duration']) && !empty($sl['custom_duration']) ? (int)$sl['custom_duration'] : null;
        $db->insert('INSERT INTO display_group_screen_slides (screen_id, position, source_slide_id, custom_duration) VALUES (?,?,?,?)',
            [$screen_id, $pos, $sid, $dur]);
        $pos++;
        $count++;
    }

    Response::success(['screen_id' => $screen_id, 'saved' => $count], 'Diapositivas de la pantalla guardadas');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
