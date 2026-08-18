<?php
/**
 * Duplicar un grupo de pantallas como plantilla/variante.
 * Copia el layout (screens) y la secuencia (steps) a un grupo nuevo.
 * POST /api/display_groups/duplicate.php  { group_id, name? }
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
    if (empty($input['group_id'])) Response::validationError(['group_id' => 'Requerido']);

    $src = $db->selectOne('SELECT * FROM display_groups WHERE group_id = ? AND store_id = ?', [(int)$input['group_id'], $store_id]);
    if (!$src) Response::notFound('Grupo origen no encontrado');

    $newName = !empty($input['name']) ? trim($input['name']) : ($src['name'] . ' (copia)');
    $newGroupId = $db->insert(
        'INSERT INTO display_groups (store_id, name, bg_color) VALUES (?,?,?)',
        [$store_id, $newName, $src['bg_color']]
    );

    // Copiar screens, guardando el mapeo viejo->nuevo id
    $screens = $db->select('SELECT label, pos_x, pos_y, w_pct, h_pct, orientation FROM display_group_screens WHERE group_id = ? ORDER BY id ASC', [(int)$input['group_id']]);
    $map = [];
    foreach ($screens as $s) {
        $newId = $db->insert('INSERT INTO display_group_screens (group_id,label,pos_x,pos_y,w_pct,h_pct,orientation) VALUES (?,?,?,?,?,?,?)',
            [$newGroupId, $s['label'], $s['pos_x'], $s['pos_y'], $s['w_pct'], $s['h_pct'], $s['orientation']]);
        // no hay mapeo directo porque los ids de screen se duplican en orden; usamos indice
        $map[] = $newId;
    }

    // Copiar steps (referencias a slide maestros se mantienen)
    $steps = $db->select(
        'SELECT st.step_order, st.screen_id, st.source_slide_id, st.custom_duration
         FROM display_group_steps st WHERE st.group_id = ? ORDER BY st.id ASC',
        [(int)$input['group_id']]
    );
    // Mapa screen_id (viejos) -> indice
    $srcScreens = $db->select('SELECT id FROM display_group_screens WHERE group_id = ? ORDER BY id ASC', [(int)$input['group_id']]);
    $idxOf = [];
    foreach ($srcScreens as $i => $sc) $idxOf[(int)$sc['id']] = $i;

    foreach ($steps as $st) {
        $oldScreenId = (int)$st['screen_id'];
        $newScreenId = isset($idxOf[$oldScreenId]) ? $map[$idxOf[$oldScreenId]] : null;
        if (!$newScreenId) continue;
        $db->insert('INSERT INTO display_group_steps (group_id, step_order, screen_id, source_slide_id, custom_duration) VALUES (?,?,?,?,?)',
            [$newGroupId, (int)$st['step_order'], $newScreenId, (int)$st['source_slide_id'], $st['custom_duration']]);
    }

    Response::success(['group_id' => $newGroupId, 'name' => $newName], 'Grupo duplicado como plantilla', 201);
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
