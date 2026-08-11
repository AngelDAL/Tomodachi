<?php
/**
 * Cierre Z / Auditoría diaria de caja
 * GET /api/reports/close_z.php?date=YYYY-MM-DD
 *
 * Consolida por día (o por caja/turno si se pasa register_id):
 * - Resumen: ventas totales, transacciones, ticket promedio, ganancia (costo histórico)
 * - Ventas por método de pago (efectivo, tarjeta, transferencia, mixto)
 * - Cancelaciones y devoluciones (monto y cantidad)
 * - Movimientos de caja: retiros (withdrawal), entradas (entry), saldo de ventas en efectivo
 * - Arqueo esperado de la caja (apertura + ventas efectivo - retiros + entradas - devoluciones)
 *
 * Auth: sesión admin/manager o token con scope read.
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
    $apiAuth->requireScope($actor, 'read');

    // Cierre Z: solo admin/manager (es información sensible de caja)
    if ($actor['via'] === 'session' && !$auth->hasRole([ROLE_ADMIN, ROLE_MANAGER])) {
        Response::error('Permisos insuficientes', 403);
    }

    $currentUser = $actor;
    $store_id = (int)$currentUser['store_id'];

    $date = isset($_GET['date']) ? $_GET['date'] : date('Y-m-d');
    $register_id = isset($_GET['register_id']) ? (int)$_GET['register_id'] : 0;

    // Validar formato fecha
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        Response::validationError(['date' => 'Formato YYYY-MM-DD']);
    }

    $conn = $db->getConnection();

    $registerFilter = '';
    $params = [$store_id, $date];
    if ($register_id > 0) {
        $registerFilter = ' AND s.register_id = ?';
        $params[] = $register_id;
    }

    // 1. Resumen de ventas completadas
    $stmt = $conn->prepare("
        SELECT
            COUNT(*) as total_transactions,
            COALESCE(SUM(s.total), 0) as total_sales,
            COALESCE(SUM(s.refunded_amount), 0) as total_refunded,
            COALESCE(AVG(s.total), 0) as avg_ticket,
            COALESCE(SUM(s.total - (
                SELECT COALESCE(SUM(sd.quantity * COALESCE(sd.unit_cost, p.cost, 0)), 0)
                FROM sale_details sd
                LEFT JOIN products p ON sd.product_id = p.product_id
                WHERE sd.sale_id = s.sale_id
            )), 0) as total_profit
        FROM sales s
        WHERE s.store_id = ? AND DATE(s.sale_date) = ? AND s.status = 'completed' $registerFilter
    ");
    $stmt->execute($params);
    $summary = $stmt->fetch(PDO::FETCH_ASSOC);

    // 2. Ventas por método de pago
    $stmt = $conn->prepare("
        SELECT s.payment_method, COUNT(*) as count, COALESCE(SUM(s.total), 0) as total
        FROM sales s
        WHERE s.store_id = ? AND DATE(s.sale_date) = ? AND s.status = 'completed' $registerFilter
        GROUP BY s.payment_method
    ");
    $stmt->execute($params);
    $byMethod = $stmt->fetchAll(PDO::FETCH_ASSOC);
    foreach ($byMethod as &$m) {
        $m['total'] = (float)$m['total'];
        $m['count'] = (int)$m['count'];
    }

    // 3. Cancelaciones (ventas canceladas del día)
    $stmt = $conn->prepare("
        SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
        FROM sales
        WHERE store_id = ? AND DATE(sale_date) = ? AND status = 'cancelled' $registerFilter
    ");
    $stmt->execute($params);
    $cancelled = $stmt->fetch(PDO::FETCH_ASSOC);

    // 4. Devoluciones del día (sobre ventas de cualquier día, registradas hoy)
    $refundParams = [$store_id, $date];
    $refundRegisterFilter = '';
    if ($register_id > 0) {
        $refundRegisterFilter = ' AND sr.register_id = ?';
        // Las devoluciones se asocian a la caja de la venta original
        $refundParams = [$store_id, $date, $register_id];
        $refundRegisterFilter = ' AND s.register_id = ?';
    }
    $stmt = $conn->prepare("
        SELECT COUNT(*) as count, COALESCE(SUM(sr.total_refunded), 0) as total
        FROM sale_refunds sr
        JOIN sales s ON sr.sale_id = s.sale_id
        WHERE sr.store_id = ? AND DATE(sr.created_at) = ? $refundRegisterFilter
    ");
    $stmt->execute($refundParams);
    $refunds = $stmt->fetch(PDO::FETCH_ASSOC);

    // 5. Movimientos de caja del día (solo cajas de la tienda; opcional filtrar register)
    $moveParams = [$store_id, $date];
    $moveFilter = '';
    if ($register_id > 0) {
        $moveFilter = ' AND cr.register_id = ?';
        $moveParams[] = $register_id;
    }
    $stmt = $conn->prepare("
        SELECT
            COALESCE(SUM(CASE WHEN cm.movement_type = 'withdrawal' THEN cm.amount ELSE 0 END), 0) as withdrawals,
            COALESCE(SUM(CASE WHEN cm.movement_type = 'entry' THEN cm.amount ELSE 0 END), 0) as entries,
            COALESCE(SUM(CASE WHEN cm.movement_type = 'sale' THEN cm.amount ELSE 0 END), 0) as cash_sales
        FROM cash_movements cm
        JOIN cash_registers cr ON cm.register_id = cr.register_id
        WHERE cr.store_id = ? AND DATE(cm.created_at) = ? $moveFilter
    ");
    $stmt->execute($moveParams);
    $movements = $stmt->fetch(PDO::FETCH_ASSOC);

    // 6. Caja abierta / inicial del día
    $openParams = [$store_id, $date];
    $openFilter = '';
    if ($register_id > 0) {
        $openFilter = ' AND register_id = ?';
        $openParams[] = $register_id;
    }
    $stmt = $conn->prepare("
        SELECT register_id, opening_date, closing_date, initial_amount, final_amount, expected_amount, difference, status, notes
        FROM cash_registers
        WHERE store_id = ? AND DATE(opening_date) = ? $openFilter
        ORDER BY opening_date DESC LIMIT 5
    ");
    $stmt->execute($openParams);
    $registers = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Arqueo esperado = inicial + ventas efectivo - retiros + entradas - devoluciones efectivo
    $cashSales = (float)$movements['cash_sales'];
    $expectedCash = (float)($registers[0]['initial_amount'] ?? 0)
        + $cashSales
        - (float)$movements['withdrawals']
        + (float)$movements['entries']
        - (float)$refunds['total'];

    Response::success([
        'date' => $date,
        'register_id' => $register_id ?: null,
        'summary' => [
            'total_transactions' => (int)$summary['total_transactions'],
            'total_sales' => round((float)$summary['total_sales'], 2),
            'total_refunded' => round((float)$summary['total_refunded'], 2),
            'avg_ticket' => round((float)$summary['avg_ticket'], 2),
            'total_profit' => round((float)$summary['total_profit'], 2),
            'net_sales' => round((float)$summary['total_sales'] - (float)$summary['total_refunded'], 2)
        ],
        'by_payment_method' => $byMethod,
        'cancelled' => ['count' => (int)$cancelled['count'], 'total' => round((float)$cancelled['total'], 2)],
        'refunds' => ['count' => (int)$refunds['count'], 'total' => round((float)$refunds['total'], 2)],
        'cash_movements' => [
            'withdrawals' => round((float)$movements['withdrawals'], 2),
            'entries' => round((float)$movements['entries'], 2),
            'cash_sales' => round($cashSales, 2)
        ],
        'expected_cash' => round($expectedCash, 2),
        'registers' => $registers
    ], 'Cierre Z');
} catch (Exception $e) {
    Response::error('Error servidor: ' . $e->getMessage(), 500);
}
