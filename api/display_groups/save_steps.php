<?php
/**
 * Guardar la SECUENCIA de pasadas de un grupo (qué slide muestra cada pantalla
 * en cada paso). Body: { group_id, steps: [{step_order, screen_id, source_slide_id, custom_duration?}] }
 * Reemplaza el set completo de steps del grupo.
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
    if (empty($input['group_id']) || !isset($input['steps'])) Response::validationError(['group_id y steps requeridos']);

    $group_id = (int)$input['group_id'];
    $existing = $db->selectOne('SELECT group_id FROM display_groups WHERE group_id = ? AND store_id = ?', [$group_id, $store_id]);
    if (!$existing) Response::notFound('Grupo no encontrado');

    // Borrar steps existentes del grupo
    $db->update('DELETE FROM display_group_steps WHERE group_id = ?', [$group_id]);

    $steps = $input['steps'];
    $count = 0;
    foreach ($steps as $st) {
        $screen_id = (int)($st['screen_id'] ?? 0);
        $slide_id = (int)($st['source_slide_id'] ?? 0);
        $step_order = (int)($st['step_order'] ?? 0);
        if ($screen_id <= 0 || $slide_id <= 0) continue;
        // validar que la pantalla pertenezca al grupo
        $scr = $db->selectOne('SELECT id FROM display_group_screens WHERE id = ? AND group_id = ?', [$screen_id, $group_id]);
        if (!$scr) continue;
        // validar que el slide pertenezca a la tienda
        $okSlide = $db->selectOne(
            'SELECT bs.slide_id FROM board_slides bs INNER JOIN digital_boards db ON db.board_id=bs.board_id WHERE bs.slide_id=? AND db.store_id=?',
            [$slide_id, $store_id]
        );
        if (!$okSlide) continue;
        $dur = isset($st['custom_duration']) && !empty($st['custom_duration']) ? (int)$st['custom_duration'] : null;
        $db->insert('INSERT INTO display_group_steps (group_id, step_order, screen_id, source_slide_id, custom_duration) VALUES (?,?,?,?,?)',
            [$group_id, $step_order, $screen_id, $slide_id, $dur]);
        $count++;
    }

    Response::success(['group_id' => $group_id, 'saved' => $count], 'Secuencia guardada');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
