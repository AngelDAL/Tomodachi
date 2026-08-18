<?php
/**
 * Obtener un grupo/escenario de pantallas completo (screens + sus diapositivas)
 * GET /api/display_groups/read_full.php?group_id=X  (autenticado, para el editor)
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

    // Por cada pantalla, su lista de diapositivas (con slide completo)
    $slideCache = [];
    foreach ($screens as &$screen) {
        $srows = $db->select(
            'SELECT id, position, source_slide_id, custom_duration, transition
             FROM display_group_screen_slides WHERE screen_id = ?
             ORDER BY position ASC, id ASC',
            [$screen['id']]
        );
        $slidesOut = [];
        foreach ($srows as $r) {
            $sid = (int)$r['source_slide_id'];
            if (!isset($slideCache[$sid])) {
                $slide = $db->selectOne(
                    'SELECT slide_id, title, orientation, layout_width, layout_height, background_color, background_image
                     FROM board_slides WHERE slide_id = ?',
                    [$sid]
                );
                if (!$slide) { continue; }
                $elements = $db->select(
                    'SELECT element_id, element_type, z_index, content, animation, animation_delay
                     FROM slide_elements WHERE slide_id = ? ORDER BY z_index ASC',
                    [$sid]
                );
                foreach ($elements as &$el) { $el['content'] = json_decode($el['content'], true); }
                $slide['elements'] = $elements;
                $slideCache[$sid] = $slide;
            }
            $slidesOut[] = [
                'position' => (int)$r['position'],
                'source_slide_id' => $sid,
                'custom_duration' => $r['custom_duration'],
                'transition' => $r['transition'] ?? 'fade',
                'slide' => $slideCache[$sid],
            ];
        }
        $screen['slides'] = $slidesOut;
    }
    unset($screen);

    $group['screens'] = $screens;

    Response::success($group, 'Escenario obtenido');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
