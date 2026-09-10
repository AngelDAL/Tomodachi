<?php
/**
 * Listar tiendas
 * GET /api/stores/read.php
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';

header('Content-Type: application/json; charset=utf-8');

require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';

header('Content-Type: application/json; charset=utf-8');

try {
    $db = new Database();
    $auth = new Auth($db);

    $apiAuth = new ApiAuth($db);
    $actor = $apiAuth->requireActor($auth);
    $apiAuth->requireScope($actor, 'read');

    // Solo super_admin puede listar todas las tiendas; el resto de usuarios
    // (y tokens) únicamente pueden consultar la suya.
    if ($actor['via'] === 'session' && $auth->hasRole(ROLE_SUPER_ADMIN)) {
        $stores = $db->select('SELECT store_id, store_name, address, phone, status FROM stores', []);
    } else {
        $stores = $db->select('SELECT store_id, store_name, address, phone, status FROM stores WHERE store_id = ?', [$actor['store_id']]);
    }
    Response::success($stores,'Listado tiendas');
} catch (Exception $e) {
    error_log('Error al listar tiendas: '.$e->getMessage());
    Response::error('Error interno del servidor',500);
}
