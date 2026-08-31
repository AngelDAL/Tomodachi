<?php
/**
 * Actualizar grupo de pantallas (nombre, activo, color de fondo)
 * PUT /api/display_groups/update.php
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

    $existing = $db->selectOne('SELECT group_id FROM display_groups WHERE group_id = ? AND store_id = ?', [(int)$input['group_id'], $store_id]);
    if (!$existing) Response::notFound('Grupo no encontrado');

    $updates = [];
    $params = [];
    if (array_key_exists('name', $input)) { $updates[] = 'name = ?'; $params[] = trim($input['name']); }
    if (array_key_exists('is_active', $input)) { $updates[] = 'is_active = ?'; $params[] = $input['is_active'] ? 1 : 0; }
    if (array_key_exists('bg_color', $input)) { $updates[] = 'bg_color = ?'; $params[] = $input['bg_color'] ?: null; }
    if (empty($updates)) Response::validationError(['fields' => 'No hay campos para actualizar']);
    $params[] = (int)$input['group_id'];

    $db->update('UPDATE display_groups SET ' . implode(', ', $updates) . ' WHERE group_id = ?', $params);
    Response::success(['group_id' => (int)$input['group_id']], 'Grupo actualizado');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
