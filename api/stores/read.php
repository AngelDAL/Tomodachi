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

session_start();
if (!isset($_SESSION['user_id'])) { Response::unauthorized(); }

try {
    $db = new Database();
    $stores = $db->select('SELECT store_id, store_name, address, phone, status FROM stores',[]);
    Response::success($stores,'Listado tiendas');
} catch (Exception $e) { Response::error('Error servidor: '.$e->getMessage(),500); }
