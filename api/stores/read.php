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

    $stores = $db->select('SELECT store_id, store_name, address, phone, status FROM stores',[]);
    Response::success($stores,'Listado tiendas');
} catch (Exception $e) { Response::error('Error servidor: '.$e->getMessage(),500); }
