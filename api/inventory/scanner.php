<?php
/**
 * Scanner búsqueda por código
 * GET /api/inventory/scanner.php?code=XXXXXXXX&store_id=1
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';

session_start();
if (!isset($_SESSION['user_id'])) { Response::unauthorized(); }

if ($_SERVER['REQUEST_METHOD'] !== 'GET') { Response::error('Método no permitido',405); }

try {
    $code = isset($_GET['code']) ? trim($_GET['code']) : '';
    $store_id = isset($_GET['store_id']) ? (int)$_GET['store_id'] : 0;
    if ($code==='') { Response::validationError(['code'=>'Requerido']); }

    $db = new Database();
    $params=[$code,$code];
    $sql='SELECT p.product_id, p.product_name, p.barcode, p.qr_code, p.price, p.min_stock, p.status';
    if ($store_id>0) { $sql.=', i.current_stock'; }
    $sql.=' FROM products p';
    if ($store_id>0) { $sql.=' LEFT JOIN inventory i ON i.product_id = p.product_id AND i.store_id = ?'; $params[]=$store_id; }
    $sql.=' WHERE p.barcode = ? OR p.qr_code = ? LIMIT 1';

    // Reordenar params si store
    if ($store_id>0) {
        $params = [$store_id,$code,$code];
    }

    $product=$db->selectOne($sql,$params);
    if (!$product) { Response::notFound('Producto no encontrado'); }
    Response::success($product,'Producto encontrado');
} catch (Exception $e) {
    Response::error('Error servidor: '.$e->getMessage(),500);
}
