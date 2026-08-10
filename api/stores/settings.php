<?php
/**
 * Configuración de la tienda (Tema, Logo, Datos)
 * GET /api/stores/settings.php
 * POST /api/stores/settings.php
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';

header('Content-Type: application/json; charset=utf-8');

$db = new Database();
$auth = new Auth($db);

$apiAuth = new ApiAuth($db);
$actor = $apiAuth->requireActor($auth);

$store_id = $actor['store_id'];

// Solo admin (sesión) o token con scope write puede editar configuración global
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if ($actor['via'] === 'session') {
        if ($actor['role'] !== ROLE_ADMIN) {
            Response::error('Permisos insuficientes', 403);
        }
    } else {
        $apiAuth->requireScope($actor, 'write');
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $apiAuth->requireScope($actor, 'read');
    try {
        $store = $db->selectOne(
            'SELECT store_id, store_name, address, phone, theme_config, settings, logo_url, status 
             FROM stores WHERE store_id = ?', 
            [$store_id]
        );
        if (!$store) {
            Response::notFound('Tienda no encontrada');
        }
        // Decodificar JSON si existe
        if ($store['theme_config']) {
            $store['theme_config'] = json_decode($store['theme_config'], true);
        }
        if ($store['settings']) {
            $store['settings'] = json_decode($store['settings'], true);
        }
        Response::success($store, 'Configuración de tienda');
    } catch (Exception $e) {
        Response::error('Error servidor: ' . $e->getMessage(), 500);
    }
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true);
        if (!$data) {
            Response::validationError(['body' => 'JSON inválido']);
        }

        $store_name = isset($data['store_name']) ? Validator::sanitizeString($data['store_name']) : '';
        $address = isset($data['address']) ? Validator::sanitizeString($data['address']) : '';
        $phone = isset($data['phone']) ? Validator::sanitizeString($data['phone']) : '';
        $theme_config = isset($data['theme_config']) ? $data['theme_config'] : null;
        $settings = isset($data['settings']) ? $data['settings'] : null;

        if (!Validator::required($store_name)) {
            Response::validationError(['store_name' => 'Requerido']);
        }

        $theme_json = $theme_config ? json_encode($theme_config) : null;
        $settings_json = $settings ? json_encode($settings) : null;

        $db->update(
            'UPDATE stores SET store_name = ?, address = ?, phone = ?, theme_config = ?, settings = ?, updated_at = NOW() WHERE store_id = ?',
            [$store_name, $address, $phone, $theme_json, $settings_json, $store_id]
        );

        Response::success(null, 'Configuración actualizada');

    } catch (Exception $e) {
        Response::error('Error servidor: ' . $e->getMessage(), 500);
    }
} else {
    Response::error('Método no permitido', 405);
}
