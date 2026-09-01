<?php
/**
 * Devolución / reembolso parcial de una venta
 * POST /api/sales/refund_sale.php
 *
 * Body:
 * {
 *   "sale_id": 123,
 *   "reason": "Cliente devolvió 1 capuchino",        // opcional
 *   "items": [
 *     {"product_id": 9, "quantity": 1}               // cantidad a devolver
 *   ]
 * }
 *
 * Comportamiento:
 * - Valida que la venta exista, esté completada y sea de la tienda.
 * - Valida que la cantidad devuelta no exceda lo vendido menos lo ya devuelto.
 * - Reingresa stock al inventario, registra movimiento 'return'.
 * - Acumula refunded_amount en la venta.
 * - Registra un movimiento de caja negativo (efectivo devuelto).
 * - Si se devuelve TODO, marca la venta como 'refunded'.
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';
require_once '../../includes/BomHelper.class.php';

$method = $_SERVER['REQUEST_METHOD'];
if ($method !== 'POST') { Response::error('Método no permitido', 405); }

try {
    $db = new Database();
    $auth = new Auth($db);

    $apiAuth = new ApiAuth($db);
    $actor = $apiAuth->requireActor($auth);
    if ($actor['via'] === 'session') {
        if (!$auth->hasRole([ROLE_ADMIN, ROLE_MANAGER])) { Response::error('Permisos insuficientes', 403); }
    } else {
        $apiAuth->requireScope($actor, 'write');
    }

    $currentUser = $actor;

    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { Response::validationError(['body' => 'JSON inválido']); }

    $sale_id = isset($data['sale_id']) ? (int)$data['sale_id'] : 0;
    $reason = isset($data['reason']) ? Validator::sanitizeString($data['reason']) : '';
    $items = isset($data['items']) ? $data['items'] : [];

    if ($sale_id <= 0) { Response::validationError(['sale_id' => 'Requerido']); }
    if (!$items || !is_array($items)) { Response::validationError(['items' => 'Lista vacía']); }

    // Venta
    $sale = $db->selectOne('SELECT sale_id, store_id, register_id, payment_method, status, total, refunded_amount, customer_id FROM sales WHERE sale_id = ?', [$sale_id]);
    if (!$sale) { Response::notFound('Venta no existe'); }
    if ($sale['status'] !== SALE_COMPLETED) { Response::error('Solo ventas completadas admiten devoluciones', 409); }

    // Seguridad: solo su propia tienda
    if ((int)$sale['store_id'] !== (int)$currentUser['store_id']) {
        Response::error('No autorizado para devolver ventas de otra tienda', 403);
    }

    $store_id = (int)$sale['store_id'];
    $register_id = (int)$sale['register_id'];

    // Detalles originales de la venta
    $details = $db->select('SELECT detail_id, product_id, quantity, unit_price, total FROM sale_details WHERE sale_id = ?', [$sale_id]);

    // Ya devuelto por producto
    $alreadyRefunded = [];
    $refundedRows = $db->select('SELECT product_id, SUM(quantity) as qty FROM sale_refund_items WHERE sale_id = ? GROUP BY product_id', [$sale_id]);
    foreach ($refundedRows as $r) {
        $alreadyRefunded[(int)$r['product_id']] = (float)$r['qty'];
    }

    // Mapa de lo vendido
    $soldMap = [];
    $priceMap = [];
    foreach ($details as $d) {
        $pid = (int)$d['product_id'];
        $soldMap[$pid] = (float)$d['quantity'];
        $priceMap[$pid] = (float)$d['unit_price'];
    }

    // Validar y construir devolución
    $refundItems = [];
    $totalRefund = 0.0;
    foreach ($items as $it) {
        $pid = (int)($it['product_id'] ?? 0);
        $qty = (float)($it['quantity'] ?? 0);
        if ($pid <= 0 || $qty <= 0) { Response::validationError(['items' => 'Producto o cantidad inválida']); }
        if (!isset($soldMap[$pid])) { Response::error("El producto $pid no está en la venta", 409); }

        $available = $soldMap[$pid] - ($alreadyRefunded[$pid] ?? 0);
        if ($qty > $available) {
            Response::error("No se pueden devolver $qty del producto (disponible para devolución: $available)", 409);
        }

        $unitPrice = $priceMap[$pid];
        $lineTotal = round($qty * $unitPrice, 2);
        $totalRefund += $lineTotal;
        $refundItems[] = [
            'product_id' => $pid,
            'quantity' => $qty,
            'unit_price' => $unitPrice,
            'total' => $lineTotal
        ];
    }

    $totalRefund = round($totalRefund, 2);
    $maxRefund = round((float)$sale['total'] - (float)$sale['refunded_amount'], 2);
    if ($totalRefund > $maxRefund + 0.01) {
        Response::error("El monto a devolver ($totalRefund) excede el saldo devoluble de la venta ($maxRefund)", 409);
    }

    $db->beginTransaction();
    try {
        // Registrar devolución
        $refund_id = $db->insert(
            'INSERT INTO sale_refunds (sale_id, store_id, user_id, reason, total_refunded, created_at) VALUES (?,?,?,?,?,NOW())',
            [$sale_id, $store_id, $currentUser['user_id'], $reason, $totalRefund]
        );

        $bom = new BomHelper($db);

        foreach ($refundItems as $ri) {
            $db->insert(
                'INSERT INTO sale_refund_items (refund_id, sale_id, product_id, quantity, unit_price, total) VALUES (?,?,?,?,?,?)',
                [$refund_id, $sale_id, $ri['product_id'], $ri['quantity'], $ri['unit_price'], $ri['total']]
            );

            // Reingresar stock según el tipo de inventario
            $prod = $db->selectOne('SELECT product_id, current_stock, tracking_type FROM products WHERE product_id = ? AND store_id = ?', [$ri['product_id'], $store_id]);
            if (!$prod) { continue; }
            $type = $bom->normalizeType($prod['tracking_type'] ?? 'stock');
            // Ensamblado: restituir ingredientes-hoja
            if ($type === TRACKING_RECIPE) {
                $bom->restoreForSale($db, $store_id, $currentUser['user_id'], $sale_id, $ri['product_id'], $ri['quantity'], 'Devolución');
                continue;
            }
            if ($type === TRACKING_NONE) {
                // Servicio: restituye sus componentes si tiene composición (no-op si es puro).
                $bom->restoreForSale($db, $store_id, $currentUser['user_id'], $sale_id, $ri['product_id'], $ri['quantity'], 'Devolución');
                continue;
            }
            $new_stock = (float)$prod['current_stock'] + $ri['quantity'];
            $db->update('UPDATE products SET current_stock = ?, updated_at = NOW() WHERE product_id = ?', [$new_stock, $ri['product_id']]);
            $db->insert(
                'INSERT INTO inventory_movements (store_id, product_id, user_id, movement_type, quantity, previous_stock, new_stock, notes, created_at) VALUES (?,?,?,?,?,?,?,?,NOW())',
                [$store_id, $ri['product_id'], $currentUser['user_id'], MOVEMENT_RETURN, $ri['quantity'], $prod['current_stock'], $new_stock, 'Devolución venta #' . $sale_id]
            );
        }

        // Acumular refunded_amount
        $newRefunded = round((float)$sale['refunded_amount'] + $totalRefund, 2);
        $newStatus = (abs($newRefunded - (float)$sale['total']) < 0.01) ? 'refunded' : $sale['status'];
        $db->update('UPDATE sales SET refunded_amount = ?, status = ? WHERE sale_id = ?', [$newRefunded, $newStatus, $sale_id]);

        // Movimiento de caja negativo (efectivo devuelto) si la venta fue en efectivo/mixta
        if (in_array($sale['payment_method'], [PAYMENT_CASH, PAYMENT_MIXED]) && $totalRefund > 0) {
            $db->insert(
                'INSERT INTO cash_movements (register_id, user_id, movement_type, amount, description, created_at) VALUES (?,?,?,?,?,NOW())',
                [$register_id, $currentUser['user_id'], 'withdrawal', $totalRefund, 'Devolución venta #' . $sale_id]
            );
        }

        // Si la venta era apartado, la devolución reduce el saldo pendiente del cliente
        if ($sale['payment_method'] === PAYMENT_CREDIT && !empty($sale['customer_id']) && $totalRefund > 0) {
            $db->update('UPDATE customers SET balance = GREATEST(balance - ?, 0) WHERE customer_id = ?', [$totalRefund, $sale['customer_id']]);
        }

        $db->commit();
    } catch (Exception $e) {
        $db->rollback();
        throw $e;
    }

    Response::success([
        'refund_id' => $refund_id,
        'total_refunded' => $totalRefund,
        'sale_status' => $newStatus,
        'sale_refunded_amount' => $newRefunded
    ], 'Devolución registrada');
} catch (Exception $e) {
    Response::error('Error servidor: ' . $e->getMessage(), 500);
}
