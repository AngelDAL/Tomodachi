<?php
/**
 * Historial de Movimientos de Inventario (enriquecido)
 *
 * GET /api/purchases/inventory_log.php?product_id=N&type=entry&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';

$method = $_SERVER['REQUEST_METHOD'];
if ($method !== 'GET') { Response::error('Método no permitido', 405); }

try {
    $db = new Database();
    $auth = new Auth($db);
    $apiAuth = new ApiAuth($db);
    $actor = $apiAuth->requireActor($auth);
    $store_id = (int)$actor['store_id'];

    $product_id = isset($_GET['product_id']) ? (int)$_GET['product_id'] : 0;
    $type = isset($_GET['type']) ? trim($_GET['type']) : '';
    $date_from = isset($_GET['date_from']) ? trim($_GET['date_from']) : '';
    $date_to = isset($_GET['date_to']) ? trim($_GET['date_to']) : '';

    $conditions = ['im.store_id = ?'];
    $params = [$store_id];

    if ($product_id > 0) {
        $conditions[] = 'im.product_id = ?';
        $params[] = $product_id;
    }
    if ($type !== '' && in_array($type, ['entry','exit','adjustment','sale','return','purchase','loss'], true)) {
        $conditions[] = 'im.movement_type = ?';
        $params[] = $type;
    }
    if ($date_from !== '') {
        $conditions[] = 'im.created_at >= ?';
        $params[] = $date_from . ' 00:00:00';
    }
    if ($date_to !== '') {
        $conditions[] = 'im.created_at <= ?';
        $params[] = $date_to . ' 23:59:59';
    }

    $sql = 'SELECT im.movement_id, im.product_id, im.movement_type, im.quantity,
                   im.previous_stock, im.new_stock, im.notes, im.reference_id, im.reference_type,
                   im.created_at,
                   p.product_name, p.tracking_type, p.image_path,
                   u.full_name AS user_name
            FROM inventory_movements im
            JOIN products p ON im.product_id = p.product_id
            JOIN users u ON im.user_id = u.user_id
            WHERE ' . implode(' AND ', $conditions) . '
            ORDER BY im.created_at DESC
            LIMIT 200';

    $movements = $db->select($sql, $params);
    foreach ($movements as &$m) {
        $m['quantity'] = (float)$m['quantity'];
        $m['previous_stock'] = (float)$m['previous_stock'];
        $m['new_stock'] = (float)$m['new_stock'];
    }
    unset($m);

    Response::success($movements, 'Historial de movimientos');
} catch (Exception $e) {
    Response::error('Error servidor: ' . $e->getMessage(), 500);
}
