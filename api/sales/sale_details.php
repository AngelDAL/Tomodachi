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

    $sale_id = isset($_GET['sale_id']) ? (int)$_GET['sale_id'] : 0;
    if ($sale_id<=0) { Response::validationError(['sale_id'=>'Requerido']); }
    
    $sale = $db->selectOne('SELECT s.sale_id, s.store_id, s.user_id, s.customer_id, c.full_name AS customer_name, s.register_id, s.sale_date, s.subtotal, s.tax, s.discount, s.total, s.amount_paid, s.refunded_amount, s.payment_method, s.status, s.created_via FROM sales s LEFT JOIN customers c ON c.customer_id = s.customer_id WHERE s.sale_id = ?',[$sale_id]);
    if (!$sale) { Response::notFound('Venta no existe'); }

    // Seguridad: el usuario solo puede ver detalles de ventas de su propia tienda
    if ((int)$sale['store_id'] !== $session_store_id) {
        Response::error('No autorizado para ver ventas de otra tienda', 403);
    }

    $items = $db->select('SELECT sd.detail_id, sd.product_id, p.product_name, p.category_id, c.category_name, sd.quantity, sd.unit_price, sd.unit_cost, sd.subtotal, sd.discount, sd.promotion_id, pr.name AS promotion_name, sd.total FROM sale_details sd LEFT JOIN products p ON p.product_id = sd.product_id LEFT JOIN categories c ON c.category_id = p.category_id LEFT JOIN promotions pr ON pr.promotion_id = sd.promotion_id WHERE sd.sale_id = ?',[$sale_id]);
    $sale['items']=$items;
    Response::success($sale,'Detalle de venta');
} catch (Exception $e) { Response::error('Error servidor: '.$e->getMessage(),500); }
