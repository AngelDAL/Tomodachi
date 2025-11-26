<?php
/**
 * Scanner búsqueda por código
 * GET /api/inventory/scanner.php?code=XXXXXXXX&store_id=1
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';

// Inicializar sesión con parámetros consistentes (Igual que en products.php)
if (session_status() === PHP_SESSION_NONE) {
    session_name(SESSION_NAME);
    session_set_cookie_params([
        'lifetime' => SESSION_LIFETIME,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax'
    ]);
    session_start();
}

if (!isset($_SESSION['user_id'])) { Response::unauthorized(); }

if ($_SERVER['REQUEST_METHOD'] !== 'GET') { Response::error('Método no permitido',405); }

try {
    // Aceptar 'barcode' (enviado por JS) o 'code'
    $code = isset($_GET['barcode']) ? trim($_GET['barcode']) : (isset($_GET['code']) ? trim($_GET['code']) : '');
    
    $requested_store_id = isset($_GET['store_id']) ? (int)$_GET['store_id'] : 0;
    $session_store_id = isset($_SESSION['store_id']) ? (int)$_SESSION['store_id'] : 0;

    // Seguridad: Validar que el usuario solo acceda a su propia tienda
    if ($requested_store_id > 0 && $requested_store_id !== $session_store_id) {
        Response::error('No autorizado para consultar en esta tienda', 403);
    }
    $store_id = ($requested_store_id > 0) ? $requested_store_id : $session_store_id;
    
    if ($code==='') { Response::validationError(['barcode'=>'Requerido']); }

    $db = new Database();
    $params=[$code,$code];
    $sql='SELECT p.product_id, p.product_name, p.image_path, p.barcode, p.qr_code, p.price, p.min_stock, p.status';
    if ($store_id>0) { $sql.=', i.current_stock'; }
    $sql.=' FROM products p';
    if ($store_id>0) { $sql.=' LEFT JOIN inventory i ON i.product_id = p.product_id AND i.store_id = ?'; $params[]=$store_id; }
    
    // FILTRO POR TIENDA (CRÍTICO)
    $sql.=' WHERE (p.barcode = ? OR p.qr_code = ?)';
    if ($store_id > 0) {
        $sql .= ' AND p.store_id = ?';
        $params[] = $store_id;
    }
    $sql .= ' LIMIT 1';

    // Reordenar params si store
    // Orden esperado en params: [code, code, store_id (para join), store_id (para where)]
    // Pero el array $params se fue llenando en orden:
    // 1. code (inicial)
    // 2. code (inicial)
    // 3. store_id (si store_id > 0, para el JOIN)
    // 4. store_id (si store_id > 0, para el WHERE)
    // El orden en SQL es: JOIN ... ? ... WHERE (barcode=? OR qr=?) AND store_id=?
    // Entonces el orden de params debe ser: [store_id (join), code, code, store_id (where)]
    
    $finalParams = [];
    if ($store_id > 0) {
        $finalParams[] = $store_id; // Para el JOIN
    }
    $finalParams[] = $code;
    $finalParams[] = $code;
    if ($store_id > 0) {
        $finalParams[] = $store_id; // Para el WHERE
    }

    $product=$db->selectOne($sql,$finalParams);
    if (!$product) { Response::notFound('Producto no encontrado'); }
    Response::success($product,'Producto encontrado');
} catch (Exception $e) {
    Response::error('Error servidor: '.$e->getMessage(),500);
}
