<?php
/**
 * Crear un grupo de pantallas (escena)
 * POST /api/display_groups/create.php
 * Body: { name, bg_color?, screens?: [{label,pos_x,pos_y,w_pct,h_pct,orientation}] }
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
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') Response::error('Método no permitido', 405);

    $store_id = (int)$actor['store_id'];
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    if (empty($input['name'])) Response::validationError(['name' => 'Requerido']);

    $name = trim($input['name']);
    $bg = isset($input['bg_color']) ? trim($input['bg_color']) : '';

    $group_id = $db->insert(
        'INSERT INTO display_groups (store_id, name, bg_color) VALUES (?, ?, ?)',
        [$store_id, $name, $bg ?: null]
    );

    // Screens iniciales (si se proveen)
    $screens = isset($input['screens']) && is_array($input['screens']) ? $input['screens'] : [];
    // Por defecto, 1 pantalla a todo el lienzo
    if (empty($screens)) {
        $db->insert('INSERT INTO display_group_screens (group_id, label, pos_x, pos_y, w_pct, h_pct, orientation) VALUES (?,?,?,?,?,?,?)',
            [$group_id, 'Pantalla 1', 0, 0, 100, 100, 'horizontal']);
    } else {
        foreach ($screens as $s) {
            $db->insert('INSERT INTO display_group_screens (group_id, label, pos_x, pos_y, w_pct, h_pct, orientation) VALUES (?,?,?,?,?,?,?)',
                [$group_id,
                 $s['label'] ?? 'Pantalla',
                 (float)($s['pos_x'] ?? 0),
                 (float)($s['pos_y'] ?? 0),
                 (float)($s['w_pct'] ?? 33.33),
                 (float)($s['h_pct'] ?? 100),
                 $s['orientation'] ?? 'horizontal']);
        }
    }

    Response::success(['group_id' => $group_id, 'name' => $name], 'Grupo creado', 201);
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
