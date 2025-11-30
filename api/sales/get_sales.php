<?php
/**
 * Listado básico de ventas (placeholder)
 * GET /api/sales/get_sales.php?store_id=1&date=2025-11-21
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';

require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'GET') { Response::error('Método no permitido',405); }

try {
    $db = new Database();
    $auth = new Auth($db);

    if (!$auth->isLoggedIn()) { Response::unauthorized(); }

    $store_id = isset($_GET['store_id']) ? (int)$_GET['store_id'] : 0;
    $date = isset($_GET['date']) ? $_GET['date'] : date('Y-m-d');

    $params=[];
    $sql='SELECT sale_id, store_id, user_id, register_id, sale_date, total, status, payment_method FROM sales WHERE DATE(sale_date) = ?';
    $params[]=$date;
    if ($store_id>0) { $sql.=' AND store_id = ?'; $params[]=$store_id; }
    $sql.=' ORDER BY sale_date DESC LIMIT 200';

    $rows=$db->select($sql,$params);
    Response::success($rows,'Listado de ventas');
} catch (Exception $e) { Response::error('Error servidor: '.$e->getMessage(),500); }
