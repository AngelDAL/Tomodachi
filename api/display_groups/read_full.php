<?php
/**
 * Obtener un grupo de pantallas completo (screens + secuencia de pasadas)
 * GET /api/display_groups/read_full.php?group_id=X  (autenticado)
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
    $store_id = (int)$actor['store_id'];
    $group_id = isset($_GET['group_id']) ? (int)$_GET['group_id'] : 0;
    if ($group_id <= 0) Response::validationError(['group_id' => 'Requerido']);

    $group = $db->selectOne(
        'SELECT * FROM display_groups WHERE group_id = ? AND store_id = ?',
        [$group_id, $store_id]
    );
    if (!$group) Response::notFound('Grupo no encontrado');

    $screens = $db->select(
        'SELECT id, group_id, label, pos_x, pos_y, w_pct, h_pct, orientation FROM display_group_screens WHERE group_id = ? ORDER BY pos_x ASC, pos_y ASC, id ASC',
        [$group_id]
    );

    // Secuencia: todas las pasadas. Se agrupan por step_order en el cliente.
    $steps = $db->select(
        'SELECT st.id, st.step_order, st.screen_id, st.source_slide_id, st.custom_duration,
                bs.title AS slide_title, bs.orientation AS slide_orientation
         FROM display_group_steps st
         LEFT JOIN board_slides bs ON bs.slide_id = st.source_slide_id
         WHERE st.group_id = ?
         ORDER BY st.step_order ASC, st.screen_id ASC',
        [$group_id]
    );

    $group['screens'] = $screens;
    $group['steps'] = $steps;

    Response::success($group, 'Grupo obtenido');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
