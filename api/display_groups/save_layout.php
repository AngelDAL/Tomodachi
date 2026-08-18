<?php
/**
 * Guardar el LAYOUT de pantallas de un grupo (posiciones y tamaños).
 * PUT /api/display_groups/save_layout.php
 * Body: { group_id, screens: [{id?, label, pos_x, pos_y, w_pct, h_pct, orientation}] }
 * Reemplaza el set completo de pantallas. Si se cambia una pantalla con id,
 * se actualiza; si no tiene id, se crea; se borran las que no vienen.
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
    if (empty($input['group_id']) || !isset($input['screens'])) Response::validationError(['group_id y screens requeridos']);

    $group_id = (int)$input['group_id'];
    $existing = $db->selectOne('SELECT group_id FROM display_groups WHERE group_id = ? AND store_id = ?', [$group_id, $store_id]);
    if (!$existing) Response::notFound('Grupo no encontrado');

    $screens = $input['screens'];
    $keptIds = [];

    foreach ($screens as $s) {
        $label = $s['label'] ?? 'Pantalla';
        $pos_x = (float)($s['pos_x'] ?? 0);
        $pos_y = (float)($s['pos_y'] ?? 0);
        $w = (float)($s['w_pct'] ?? 100);
        $h = (float)($s['h_pct'] ?? 100);
        $orient = in_array($s['orientation'] ?? '', ['horizontal','vertical']) ? $s['orientation'] : 'horizontal';
        if (isset($s['id']) && (int)$s['id'] > 0) {
            $db->update('UPDATE display_group_screens SET label=?, pos_x=?, pos_y=?, w_pct=?, h_pct=?, orientation=? WHERE id=? AND group_id=?',
                [$label, $pos_x, $pos_y, $w, $h, $orient, (int)$s['id'], $group_id]);
            $keptIds[] = (int)$s['id'];
        } else {
            $newId = $db->insert('INSERT INTO display_group_screens (group_id,label,pos_x,pos_y,w_pct,h_pct,orientation) VALUES (?,?,?,?,?,?,?)',
                [$group_id, $label, $pos_x, $pos_y, $w, $h, $orient]);
            $keptIds[] = (int)$newId;
        }
    }

    // Borrar pantallas que ya no están en el layout (y sus steps en cascada)
    if (!empty($keptIds)) {
        $ph = implode(',', array_fill(0, count($keptIds), '?'));
        $params = array_merge([$group_id], $keptIds);
        $db->update("DELETE FROM display_group_screens WHERE group_id = ? AND id NOT IN ($ph)", $params);
    } else {
        $db->update('DELETE FROM display_group_screens WHERE group_id = ?', [$group_id]);
    }

    Response::success(['group_id' => $group_id], 'Layout guardado');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
