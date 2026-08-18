<?php
/**
 * Obtener un escenario de pantallas completo para el display (ENDPOINT PÚBLICO PARA TV)
 * GET /api/display_groups/get_group.php?group_id=X
 * Devuelve: escenario + pantallas (layout) + POR CADA PANTALLA su lista de
 * diapositivas (con elementos), para rotación INDEPENDIENTE por pantalla.
 */
require_once '../../config/database.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';

header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=utf-8');

try {
    $db = new Database();
    $group_id = isset($_GET['group_id']) ? (int)$_GET['group_id'] : 0;
    if ($group_id <= 0) Response::validationError(['group_id' => 'Requerido']);

    $group = $db->selectOne(
        'SELECT group_id, store_id, name, is_active, bg_color FROM display_groups WHERE group_id = ? AND is_active = 1',
        [$group_id]
    );
    if (!$group) Response::notFound('Grupo no encontrado o inactivo');

    $screens = $db->select(
        'SELECT id, label, pos_x, pos_y, w_pct, h_pct, orientation FROM display_group_screens WHERE group_id = ? ORDER BY pos_y ASC, pos_x ASC, id ASC',
        [$group_id]
    );

    // Por cada pantalla, obtener su lista de slides (diap. maestras) y sus elementos
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
        $screen['duration'] = $screen['slides'] && $screen['slides'][0]['custom_duration'];
    }
    unset($screen);

    $group['screens'] = $screens;

    Response::success($group, 'Escenario obtenido');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
