<?php
/**
 * Listar grupos de pantallas de la tienda
 * GET /api/display_groups/read.php
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

    $groups = $db->select(
        'SELECT g.group_id, g.name, g.is_active, g.bg_color, g.created_at, g.updated_at,
                (SELECT COUNT(*) FROM display_group_screens s WHERE s.group_id = g.group_id) AS screen_count,
                (SELECT COUNT(DISTINCT st.step_order) FROM display_group_steps st WHERE st.group_id = g.group_id) AS step_count
         FROM display_groups g
         WHERE g.store_id = ?
         ORDER BY g.updated_at DESC, g.group_id DESC',
        [$store_id]
    );

    Response::success($groups, 'Grupos obtenidos');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
