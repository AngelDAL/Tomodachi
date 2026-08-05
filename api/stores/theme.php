<?php
/**
 * API: Personalización de tema (autenticado por API Token O sesión)
 *
 * Permite que un agente de IA (con API key scope "custom") lea y modifique
 * el tema de la tienda: colores, logo, etc.
 *
 * GET  /api/stores/theme.php            -> lee el theme_config actual (scope read)
 * POST /api/stores/theme.php            -> guarda theme_config (scope custom)
 *   Body: { "theme_config": { "primary_color": "#E3057A", ... } }
 *
 * Autenticación:
 *   - Sesión de admin: permisos completos.
 *   - API token: requiere scope 'read' para GET, 'custom' (o 'write') para POST.
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';

header('Content-Type: application/json; charset=utf-8');

try {
    $db = new Database();
    $auth = new Auth($db);
    $apiAuth = new ApiAuth($db);

    $actor = $apiAuth->getActor($auth);
    if (!$actor) {
        Response::unauthorized();
    }
    $store_id = $actor['store_id'];

    $method = $_SERVER['REQUEST_METHOD'];

    if ($method === 'GET') {
        // Leer tema: sesión o token con scope read
        if (!$apiAuth->hasScope($actor, 'read')) {
            Response::error('El token no tiene permiso: read', 403);
        }

        $store = $db->selectOne('SELECT store_id, store_name, logo_url, theme_config FROM stores WHERE store_id = ?', [$store_id]);
        if (!$store) { Response::notFound('Tienda no existe'); }

        $store['theme_config'] = $store['theme_config'] ? json_decode($store['theme_config'], true) : null;

        Response::success([
            'store_id'     => (int)$store['store_id'],
            'store_name'   => $store['store_name'],
            'logo_url'     => $store['logo_url'],
            'theme_config' => $store['theme_config'],
            'via'          => $actor['via'],
        ], 'Tema de la tienda');
    } elseif ($method === 'POST') {
        // Escribir tema: requiere scope custom (o write)
        if (!$apiAuth->hasScope($actor, 'custom') && !$apiAuth->hasScope($actor, 'write')) {
            Response::error('El token no tiene permiso: custom/write', 403);
        }

        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true);
        if (!$data) { Response::validationError(['body' => 'JSON inválido']); }

        $theme_config = isset($data['theme_config']) ? $data['theme_config'] : null;
        if ($theme_config === null) {
            Response::validationError(['theme_config' => 'Requerido']);
        }
        if (!is_array($theme_config)) {
            Response::validationError(['theme_config' => 'Debe ser un objeto JSON']);
        }

        // Validar que los valores sean colores hexadecimales válidos (básico)
        foreach ($theme_config as $key => $value) {
            if (!is_string($value) || !preg_match('/^#[0-9a-fA-F]{3,8}$/', $value)) {
                Response::validationError(['theme_config.' . $key => 'Valor de color inválido (usa #RRGGBB)']);
            }
        }

        $theme_json = json_encode($theme_config);
        $db->update(
            'UPDATE stores SET theme_config = ?, updated_at = NOW() WHERE store_id = ?',
            [$theme_json, $store_id]
        );

        Response::success([
            'store_id'     => $store_id,
            'theme_config' => $theme_config,
            'via'          => $actor['via'],
        ], 'Tema actualizado');
    } else {
        Response::error('Método no permitido', 405);
    }
} catch (Exception $e) {
    Response::error('Error en el servidor: ' . $e->getMessage(), 500);
}
