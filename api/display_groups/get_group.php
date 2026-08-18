<?php
/**
 * Obtener un grupo de pantallas completo para el display (ENDPOINT PÚBLICO PARA TV)
 * GET /api/display_groups/get_group.php?group_id=X
 * Devuelve: grupo + screens (layout) + steps (secuencia) + los SLIDES completos
 * (con sus elementos) de cada paso, para que el display los renderice.
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

    $steps = $db->select(
        'SELECT st.id, st.step_order, st.screen_id, st.source_slide_id, st.custom_duration
         FROM display_group_steps st WHERE st.group_id = ? ORDER BY st.step_order ASC, st.screen_id ASC',
        [$group_id]
    );

    // Cargar el detalle de cada slide (elementos) referenciado en los steps
    $slideIds = [];
    foreach ($steps as $st) $slideIds[(int)$st['source_slide_id']] = true;
    $slidesData = [];
    foreach (array_keys($slideIds) as $sid) {
        $slide = $db->selectOne(
            'SELECT slide_id, title, orientation, layout_width, layout_height, background_color, background_image
             FROM board_slides WHERE slide_id = ?',
            [$sid]
        );
        if (!$slide) continue;
        $elements = $db->select(
            'SELECT element_id, element_type, z_index, content, animation, animation_delay
             FROM slide_elements WHERE slide_id = ? ORDER BY z_index ASC',
            [$sid]
        );
        foreach ($elements as &$el) { $el['content'] = json_decode($el['content'], true); }
        $slide['elements'] = $elements;
        $slidesData[$sid] = $slide;
    }

    $group['screens'] = $screens;
    $group['steps'] = $steps;
    $group['slides'] = $slidesData; // key = slide_id

    // Deducir el número total de pasadas (máx step_order + 1)
    $maxStep = 0;
    foreach ($steps as $st) $maxStep = max($maxStep, (int)$st['step_order']);
    $group['total_steps'] = $steps ? ($maxStep + 1) : 0;

    Response::success($group, 'Grupo obtenido');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
