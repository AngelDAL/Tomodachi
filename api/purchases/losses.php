<?php
/**
 * API de Pérdidas / Caducidades
 *
 * POST /api/purchases/losses.php  — registrar pérdida
 * GET  /api/purchases/losses.php  — historial de pérdidas
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

try {
    $db = new Database();
    $auth = new Auth($db);
    $apiAuth = new ApiAuth($db);
    $actor = $apiAuth->requireActor($auth);
    $currentUser = $actor;
    $store_id = (int)$currentUser['store_id'];

    // ── READ (historial) ──
    if ($method === 'GET') {
        $apiAuth->requireScope($actor, 'read');
        $product_id = isset($_GET['product_id']) ? (int)$_GET['product_id'] : 0;

        $conditions = ['im.store_id = ?', "im.movement_type = 'loss'"];
        $params = [$store_id];

        if ($product_id > 0) {
            $conditions[] = 'im.product_id = ?';
            $params[] = $product_id;
        }

        $sql = 'SELECT im.*, p.product_name, p.tracking_type, u.full_name AS user_name
                FROM inventory_movements im
                JOIN products p ON im.product_id = p.product_id
                JOIN users u ON im.user_id = u.user_id
                WHERE ' . implode(' AND ', $conditions) . '
                ORDER BY im.created_at DESC
                LIMIT 100';
        $losses = $db->select($sql, $params);
        foreach ($losses as &$l) {
            $l['quantity'] = (float)$l['quantity'];
            $l['previous_stock'] = (float)$l['previous_stock'];
            $l['new_stock'] = (float)$l['new_stock'];
        }
        unset($l);
        Response::success($losses, 'Historial de pérdidas');
    }

    // ── CREATE (registrar pérdida) ──
    if ($method === 'POST') {
        if ($currentUser['via'] === 'session') {
            if (!$auth->hasRole([ROLE_ADMIN, ROLE_MANAGER])) { Response::error('Permisos insuficientes', 403); }
        } else {
            $apiAuth->requireScope($actor, 'write');
        }

        $data = json_decode(file_get_contents('php://input'), true);
        if (!$data) { Response::validationError(['body' => 'JSON inválido']); }

        $product_id = isset($data['product_id']) ? (int)$data['product_id'] : 0;
        $quantity = isset($data['quantity']) ? (float)$data['quantity'] : 0;
        $lot_id = isset($data['lot_id']) ? (int)$data['lot_id'] : 0;
        $reason = isset($data['reason']) ? Validator::sanitizeString($data['reason']) : 'Pérdida';

        $errors = [];
        if ($product_id <= 0) $errors['product_id'] = 'Requerido';
        if ($quantity <= 0) $errors['quantity'] = 'Debe ser mayor a 0';
        if ($errors) { Response::validationError($errors); }

        $product = $db->selectOne(
            'SELECT product_id, tracking_type, current_stock FROM products WHERE product_id = ? AND store_id = ? AND status = ?',
            [$product_id, $store_id, STATUS_ACTIVE]
        );
        if (!$product) { Response::notFound('Producto no encontrado'); }

        $type = $product['tracking_type'];
        $bom = new BomHelper($db);
        $prev_stock = 0.0;
        $new_stock = 0.0;

        $db->beginTransaction();
        try {
            if ($type === 'component') {
                // Restar del lote específico o del más viejo
                if ($lot_id > 0) {
                    $lot = $db->selectOne('SELECT lot_id, quantity FROM product_lots WHERE lot_id = ? AND product_id = ? AND store_id = ?',
                        [$lot_id, $product_id, $store_id]);
                    if (!$lot) { throw new Exception('Lote no encontrado'); }
                    $prev_qty = (float)$lot['quantity'];
                    if ($quantity > $prev_qty) { throw new Exception('Cantidad excede el lote disponible'); }
                    $new_qty = $prev_qty - $quantity;
                    $db->update('UPDATE product_lots SET quantity = ? WHERE lot_id = ?', [$new_qty, $lot_id]);
                    // Si el lote quedó en 0, no lo borramos (histórico)
                } else {
                    // Consumir FIFO de uno o varios lotes, validando el total antes de mutar.
                    $available = $db->selectOne(
                        'SELECT COALESCE(SUM(quantity), 0) AS total FROM product_lots WHERE product_id = ? AND store_id = ? AND quantity > 0',
                        [$product_id, $store_id]
                    );
                    $available_total = (float)$available['total'];
                    if ($quantity > $available_total) { throw new Exception('Cantidad excede el inventario disponible'); }
                    $remaining = $quantity;
                    while ($remaining > 0.000001) {
                        $lot = $db->selectOne(
                            'SELECT lot_id, quantity FROM product_lots WHERE product_id = ? AND store_id = ? AND quantity > 0 ORDER BY lot_id ASC',
                            [$product_id, $store_id]
                        );
                        if (!$lot) { throw new Exception('No hay lotes disponibles para este componente'); }
                        $prev_qty = (float)$lot['quantity'];
                        $use = min($remaining, $prev_qty);
                        $db->update('UPDATE product_lots SET quantity = ? WHERE lot_id = ?', [$prev_qty - $use, (int)$lot['lot_id']]);
                        if ($lot_id <= 0) $lot_id = (int)$lot['lot_id'];
                        $remaining -= $use;
                    }
                }
                $blend = $bom->blend($store_id, $product_id);
                $prev_stock = $blend['total'] + $quantity; // Antes de restar
                $new_stock = $blend['total'];
            } else {
                // stock
                $prev_stock = (float)$product['current_stock'];
                if ($quantity > $prev_stock) { throw new Exception('Cantidad excede el stock disponible'); }
                $new_stock = $prev_stock - $quantity;
                $db->update('UPDATE products SET current_stock = ?, updated_at = NOW() WHERE product_id = ?',
                    [$new_stock, $product_id]);
            }

            $db->insert(
                'INSERT INTO inventory_movements (store_id, product_id, user_id, movement_type, quantity, previous_stock, new_stock, notes, reference_type, created_at)
                 VALUES (?,?,?,?,?,?,?,?,?,NOW())',
                [$store_id, $product_id, $currentUser['user_id'], MOVEMENT_LOSS, $quantity, $prev_stock, $new_stock,
                 $reason, 'loss']
            );

            $db->commit();
        } catch (Exception $e) {
            $db->rollback();
            throw $e;
        }

        Response::success([
            'product_id' => $product_id,
            'quantity' => $quantity,
            'previous_stock' => $prev_stock,
            'new_stock' => $new_stock,
            'lot_id' => $lot_id,
        ], 'Pérdida registrada');
    }

    Response::error('Método no permitido', 405);
} catch (Exception $e) {
    Response::error('Error servidor: ' . $e->getMessage(), 500);
}
