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
require_once '../../includes/ApiAuth.class.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'GET') { Response::error('Método no permitido',405); }

try {
    $db = new Database();
    $auth = new Auth($db);

    $apiAuth = new ApiAuth($db);
    $actor = $apiAuth->requireActor($auth);
    $apiAuth->requireScope($actor, 'read');

    $currentUser = $actor;
    $session_store_id = (int)$currentUser['store_id'];

    $requested_store_id = isset($_GET['store_id']) ? (int)$_GET['store_id'] : 0;

    // Seguridad: el usuario solo puede consultar su propia tienda
    if ($requested_store_id > 0 && $requested_store_id !== $session_store_id) {
        Response::error('No autorizado para ver ventas de otra tienda', 403);
    }

    $store_id = ($requested_store_id > 0) ? $requested_store_id : $session_store_id;
    if ($store_id <= 0) {
        Response::success([], 'No se identificó tienda activa');
    }

    $date = isset($_GET['date']) ? $_GET['date'] : null;
    $limit = isset($_GET['limit']) ? min((int)$_GET['limit'], 200) : 50;

    $params = [$store_id];
    $sql = 'SELECT s.sale_id, s.store_id, s.user_id, s.customer_id, c.full_name AS customer_name, s.register_id, s.sale_date, s.total, s.amount_paid, s.refunded_amount, s.status, s.payment_method, s.created_via, (SELECT COALESCE(SUM(quantity), 0) FROM sale_details sd WHERE sd.sale_id = s.sale_id) as total_items FROM sales s LEFT JOIN customers c ON c.customer_id = s.customer_id WHERE s.store_id = ?';
    if ($date) { $sql .= ' AND DATE(s.sale_date) = ?'; $params[] = $date; }
    $sql .= ' ORDER BY sale_date DESC LIMIT ' . $limit;

    $rows = $db->select($sql, $params);
    Response::success($rows, 'Listado de ventas');
} catch (Exception $e) { Response::error('Error servidor: '.$e->getMessage(),500); }
