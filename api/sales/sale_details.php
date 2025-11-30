<?php
/**
 * Detalle de venta (placeholder)
 * GET /api/sales/sale_details.php?sale_id=123
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

    $sale_id = isset($_GET['sale_id']) ? (int)$_GET['sale_id'] : 0;
    if ($sale_id<=0) { Response::validationError(['sale_id'=>'Requerido']); }
    
    $sale = $db->selectOne('SELECT sale_id, store_id, user_id, register_id, sale_date, subtotal, tax, discount, total, payment_method, status FROM sales WHERE sale_id = ?',[$sale_id]);
    if (!$sale) { Response::notFound('Venta no existe'); }
    $items = $db->select('SELECT detail_id, product_id, quantity, unit_price, subtotal, discount, total FROM sale_details WHERE sale_id = ?',[$sale_id]);
    $sale['items']=$items;
    Response::success($sale,'Detalle de venta');
} catch (Exception $e) { Response::error('Error servidor: '.$e->getMessage(),500); }
