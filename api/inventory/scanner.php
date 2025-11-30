<?php
/**
 * Scanner búsqueda por código
 * GET /api/inventory/scanner.php?code=XXXXXXXX&store_id=1
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'GET') { Response::error('Método no permitido',405); }

try {
    $db = new Database();
    $auth = new Auth($db);

    if (!$auth->isLoggedIn()) { Response::unauthorized(); }
    $currentUser = $auth->getCurrentUser();

    // Aceptar 'barcode' (enviado por JS) o 'code'
    $code = isset($_GET['barcode']) ? trim($_GET['barcode']) : (isset($_GET['code']) ? trim($_GET['code']) : '');
    
    $requested_store_id = isset($_GET['store_id']) ? (int)$_GET['store_id'] : 0;
    $session_store_id = (int)$currentUser['store_id'];

    // Seguridad: Validar que el usuario solo acceda a su propia tienda
    if ($requested_store_id > 0 && $requested_store_id !== $session_store_id) {
        Response::error('No autorizado para consultar en esta tienda', 403);
    }
    $store_id = ($requested_store_id > 0) ? $requested_store_id : $session_store_id;
    
    if ($code==='') { Response::validationError(['barcode'=>'Requerido']); }

    $params=[];
    $sql='SELECT p.product_id, p.product_name, p.image_path, p.barcode, p.qr_code, p.price, p.min_stock, p.status';
    if ($store_id>0) { $sql.=', i.current_stock'; }
    $sql.=' FROM products p';
    if ($store_id>0) { $sql.=' LEFT JOIN inventory i ON i.product_id = p.product_id AND i.store_id = ?'; $params[]=$store_id; }
    
    // FILTRO POR TIENDA (CRÍTICO)
    $sql.=' WHERE (p.barcode = ? OR p.qr_code = ?)';
    if ($store_id > 0) {
        $sql .= ' AND p.store_id = ?';
        // params se llenan en orden de aparición en query
    }
    $sql .= ' LIMIT 1';

    // Reconstruir params en orden correcto
    // 1. store_id para JOIN (si existe)
    // 2. barcode
    // 3. qr_code (mismo valor)
    // 4. store_id para WHERE (si existe)
    
    $finalParams = [];
    if ($store_id > 0) {
        $finalParams[] = $store_id; // JOIN
    }
    $finalParams[] = $code; // barcode
    $finalParams[] = $code; // qr_code
    if ($store_id > 0) {
        $finalParams[] = $store_id; // WHERE
    }

    $product=$db->selectOne($sql,$finalParams);
    if (!$product) { Response::notFound('Producto no encontrado'); }
    Response::success($product,'Producto encontrado');
} catch (Exception $e) {
    Response::error('Error servidor: '.$e->getMessage(),500);
}
