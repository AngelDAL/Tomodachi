<?php
/**
 * API de Compras / Reabastecimiento
 *
 * GET    /api/purchases/purchases.php                     — listar compras
 * GET    /api/purchases/purchases.php?purchase_id=N       — detalle con items
 * POST   /api/purchases/purchases.php                     — crear orden (draft)
 * PUT    /api/purchases/purchases.php                     — actualizar / agregar item / ejecutar
 * DELETE /api/purchases/purchases.php                     — cancelar orden
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';
require_once '../../includes/BomHelper.class.php';
require_once '../../includes/CashRegister.class.php';

$method = $_SERVER['REQUEST_METHOD'];

try {
    $db = new Database();
    $auth = new Auth($db);
    $apiAuth = new ApiAuth($db);
    $actor = $apiAuth->requireActor($auth);
    $currentUser = $actor;
    $store_id = (int)$currentUser['store_id'];

    // ── READ ──────────────────────────────────────────────
    if ($method === 'GET') {
        $apiAuth->requireScope($actor, 'read');

        $purchase_id = isset($_GET['purchase_id']) ? (int)$_GET['purchase_id'] : 0;

        // Detalle de una compra
        if ($purchase_id > 0) {
            $purchase = $db->selectOne(
                'SELECT p.*, u.full_name AS creator_name
                 FROM purchases p
                 JOIN users u ON p.user_id = u.user_id
                 WHERE p.purchase_id = ? AND p.store_id = ?',
                [$purchase_id, $store_id]
            );
            if (!$purchase) { Response::notFound('Compra no encontrada'); }

            $items = $db->select(
                'SELECT pi.*, pr.product_name, pr.tracking_type, pr.image_path,
                         COALESCE((SELECT SUM(pl.quantity * pl.unit_cost) / NULLIF(SUM(pl.quantity), 0)
                                   FROM product_lots pl WHERE pl.product_id = pr.product_id AND pl.store_id = pr.store_id), pr.cost, 0) AS last_unit_cost
                 FROM purchase_items pi
                 JOIN products pr ON pi.product_id = pr.product_id
                 WHERE pi.purchase_id = ?
                 ORDER BY pi.item_id ASC',
                [$purchase_id]
            );
            foreach ($items as &$it) {
                $it['planned_quantity'] = (float)$it['planned_quantity'];
                $it['planned_total_cost'] = (float)$it['planned_total_cost'];
                $it['actual_quantity'] = $it['actual_quantity'] !== null ? (float)$it['actual_quantity'] : null;
                $it['unit_cost'] = (float)$it['unit_cost'];
                $it['total_cost'] = (float)$it['total_cost'];
            }
            unset($it);

            $purchase['total_cost'] = (float)$purchase['total_cost'];
            $purchase['items'] = $items;
            Response::success($purchase, 'Detalle de compra');
        }

        // Listado
        $status = isset($_GET['status']) ? trim($_GET['status']) : '';
        $date_from = isset($_GET['date_from']) ? trim($_GET['date_from']) : '';
        $date_to = isset($_GET['date_to']) ? trim($_GET['date_to']) : '';

        $conditions = ['p.store_id = ?'];
        $params = [$store_id];

        if ($status !== '' && in_array($status, ['draft','pending','executed','cancelled'], true)) {
            $conditions[] = 'p.status = ?';
            $params[] = $status;
        }
        if ($date_from !== '') {
            $conditions[] = 'p.created_at >= ?';
            $params[] = $date_from . ' 00:00:00';
        }
        if ($date_to !== '') {
            $conditions[] = 'p.created_at <= ?';
            $params[] = $date_to . ' 23:59:59';
        }

        $sql = 'SELECT p.purchase_id, p.supplier_name, p.status, p.total_cost, p.created_at, p.executed_at,
                       u.full_name AS creator_name,
                       (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.purchase_id) AS item_count
                FROM purchases p
                JOIN users u ON p.user_id = u.user_id
                WHERE ' . implode(' AND ', $conditions) . '
                ORDER BY p.created_at DESC
                LIMIT 100';
        $purchases = $db->select($sql, $params);
        foreach ($purchases as &$p) {
            $p['total_cost'] = (float)$p['total_cost'];
        }
        unset($p);
        Response::success($purchases, 'Listado de compras');
    }

    // ── CREATE ────────────────────────────────────────────
    if ($method === 'POST') {
        if ($currentUser['via'] === 'session') {
            if (!$auth->hasRole([ROLE_ADMIN, ROLE_MANAGER])) { Response::error('Permisos insuficientes', 403); }
        } else {
            $apiAuth->requireScope($actor, 'write');
        }

        $data = json_decode(file_get_contents('php://input'), true);
        if (!$data) { Response::validationError(['body' => 'JSON inválido']); }

        $supplier_name = isset($data['supplier_name']) ? Validator::sanitizeString($data['supplier_name']) : null;
        $notes = isset($data['notes']) ? Validator::sanitizeString($data['notes']) : null;
        $items = isset($data['items']) && is_array($data['items']) ? $data['items'] : [];

        $db->beginTransaction();
        try {
            $id = $db->insert(
                'INSERT INTO purchases (store_id, user_id, supplier_name, status, notes) VALUES (?,?,?,?,?)',
                [$store_id, $currentUser['user_id'], $supplier_name, PURCHASE_DRAFT, $notes]
            );
            foreach ($items as $item) {
                $product_id = isset($item['product_id']) ? (int)$item['product_id'] : 0;
                $planned_quantity = isset($item['planned_quantity']) ? (float)$item['planned_quantity'] : 0;
                $planned_total_cost = isset($item['total_cost']) ? (float)$item['total_cost'] : 0;
                if ($planned_total_cost < 0) $planned_total_cost = 0;
                $unit_cost = $planned_quantity > 0 ? ($planned_total_cost / $planned_quantity) : 0;
                if ($product_id <= 0 || $planned_quantity <= 0) {
                    throw new Exception('Cada producto debe tener una cantidad válida y un costo no negativo');
                }
                $product = $db->selectOne(
                    'SELECT product_id, tracking_type FROM products WHERE product_id=? AND store_id=? AND status=?',
                    [$product_id, $store_id, STATUS_ACTIVE]
                );
                if (!$product || !in_array($product['tracking_type'], ['stock', 'component'], true)) {
                    throw new Exception('Solo se pueden comprar productos activos de inventario o componentes');
                }
                $db->insert(
                    'INSERT INTO purchase_items (purchase_id, product_id, planned_quantity, planned_total_cost, unit_cost) VALUES (?,?,?,?,?)',
                    [$id, $product_id, $planned_quantity, $planned_total_cost, $unit_cost]
                );
            }
            if ($items) {
                $db->update('UPDATE purchases SET status=? WHERE purchase_id=?', [PURCHASE_PENDING, $id]);
            }
            $db->commit();
        } catch (Exception $e) {
            $db->rollback();
            throw $e;
        }

        Response::success(['purchase_id' => $id, 'status' => $items ? PURCHASE_PENDING : PURCHASE_DRAFT], 'Orden creada');
    }

    // ── UPDATE ────────────────────────────────────────────
    if ($method === 'PUT') {
        if ($currentUser['via'] === 'session') {
            if (!$auth->hasRole([ROLE_ADMIN, ROLE_MANAGER])) { Response::error('Permisos insuficientes', 403); }
        } else {
            $apiAuth->requireScope($actor, 'write');
        }

        $data = json_decode(file_get_contents('php://input'), true);
        if (!$data) { Response::validationError(['body' => 'JSON inválido']); }

        $purchase_id = isset($data['purchase_id']) ? (int)$data['purchase_id'] : 0;
        if ($purchase_id <= 0) { Response::validationError(['purchase_id' => 'Requerido']); }

        $purchase = $db->selectOne(
            'SELECT * FROM purchases WHERE purchase_id = ? AND store_id = ?',
            [$purchase_id, $store_id]
        );
        if (!$purchase) { Response::notFound('Compra no encontrada'); }

        $action = isset($data['action']) ? trim($data['action']) : '';

        // ── Action: add_item ──
        if ($action === 'add_item') {
            if (!in_array($purchase['status'], [PURCHASE_DRAFT, PURCHASE_PENDING])) {
                Response::error('No se pueden agregar ítems a una orden ' . $purchase['status'], 409);
            }
            $product_id = isset($data['product_id']) ? (int)$data['product_id'] : 0;
            $planned_quantity = isset($data['planned_quantity']) ? (float)$data['planned_quantity'] : 0;
            $planned_total_cost = isset($data['total_cost']) ? (float)$data['total_cost'] : 0;
            if ($planned_total_cost < 0) { Response::validationError(['total_cost' => 'No puede ser negativo']); }
            if ($product_id <= 0) { Response::validationError(['product_id' => 'Requerido']); }
            if ($planned_quantity <= 0) { Response::validationError(['planned_quantity' => 'Debe ser mayor a 0']); }

            $product = $db->selectOne(
                'SELECT product_id, tracking_type, product_name FROM products WHERE product_id = ? AND store_id = ? AND status = ?',
                [$product_id, $store_id, STATUS_ACTIVE]
            );
            if (!$product) { Response::notFound('Producto no encontrado o inactivo'); }
            $type = $product['tracking_type'];
            if (!in_array($type, ['stock', 'component'], true)) {
                Response::error('Solo se pueden comprar productos de tipo stock o componente', 409);
            }

            // Verificar que no esté duplicado en la misma orden
            $exists = $db->selectOne(
                'SELECT item_id FROM purchase_items WHERE purchase_id = ? AND product_id = ?',
                [$purchase_id, $product_id]
            );
            if ($exists) { Response::error('Este producto ya está en la orden', 409); }

            $item_id = $db->insert(
                'INSERT INTO purchase_items (purchase_id, product_id, planned_quantity, planned_total_cost, unit_cost) VALUES (?,?,?,?,?)',
                [$purchase_id, $product_id, $planned_quantity, $planned_total_cost, $planned_quantity > 0 ? $planned_total_cost / $planned_quantity : 0]
            );

            // Auto-cambiar a pending si estaba draft
            if ($purchase['status'] === PURCHASE_DRAFT) {
                $db->update('UPDATE purchases SET status = ?, updated_at = NOW() WHERE purchase_id = ?',
                    [PURCHASE_PENDING, $purchase_id]);
            }

            Response::success(['item_id' => $item_id], 'Ítem agregado');
        }

        // ── Action: update_item ──
        if ($action === 'update_item') {
            if (!in_array($purchase['status'], [PURCHASE_DRAFT, PURCHASE_PENDING])) {
                Response::error('No se pueden modificar ítems de una orden ' . $purchase['status'], 409);
            }
            $item_id = isset($data['item_id']) ? (int)$data['item_id'] : 0;
            $planned_quantity = isset($data['planned_quantity']) ? (float)$data['planned_quantity'] : null;
            $unit_cost = isset($data['unit_cost']) ? (float)$data['unit_cost'] : null;
            $planned_total_cost = isset($data['total_cost']) ? (float)$data['total_cost'] : null;
            if ($item_id <= 0) { Response::validationError(['item_id' => 'Requerido']); }
            if ($planned_total_cost !== null && $planned_total_cost < 0) { Response::validationError(['total_cost' => 'No puede ser negativo']); }
            if ($unit_cost !== null && $unit_cost < 0) { Response::validationError(['unit_cost' => 'No puede ser negativo']); }

            $item = $db->selectOne('SELECT item_id FROM purchase_items WHERE item_id = ? AND purchase_id = ?', [$item_id, $purchase_id]);
            if (!$item) { Response::notFound('Ítem no encontrado'); }

            if ($planned_quantity !== null && $planned_quantity > 0) {
                $db->update('UPDATE purchase_items SET planned_quantity = ? WHERE item_id = ?', [$planned_quantity, $item_id]);
            }
            if ($unit_cost !== null) {
                $db->update('UPDATE purchase_items SET unit_cost = ? WHERE item_id = ?', [$unit_cost, $item_id]);
            }
            if ($planned_total_cost !== null) {
                $db->update('UPDATE purchase_items SET planned_total_cost = ? WHERE item_id = ?', [$planned_total_cost, $item_id]);
                $qtyForCost = $planned_quantity;
                if ($qtyForCost === null) {
                    $existingQty = $db->selectOne('SELECT planned_quantity FROM purchase_items WHERE item_id = ?', [$item_id]);
                    $qtyForCost = $existingQty ? (float)$existingQty['planned_quantity'] : 0;
                }
                if ($qtyForCost > 0) {
                    $db->update('UPDATE purchase_items SET unit_cost = ? WHERE item_id = ?', [$planned_total_cost / $qtyForCost, $item_id]);
                }
            }
            Response::success([], 'Ítem actualizado');
        }

        // ── Action: remove_item ──
        if ($action === 'remove_item') {
            if (!in_array($purchase['status'], [PURCHASE_DRAFT, PURCHASE_PENDING])) {
                Response::error('No se pueden quitar ítems de una orden ' . $purchase['status'], 409);
            }
            $item_id = isset($data['item_id']) ? (int)$data['item_id'] : 0;
            if ($item_id <= 0) { Response::validationError(['item_id' => 'Requerido']); }

            $db->delete('DELETE FROM purchase_items WHERE item_id = ? AND purchase_id = ?', [$item_id, $purchase_id]);

            // Si no quedan ítems, volver a draft
            $count = $db->selectOne('SELECT COUNT(*) AS c FROM purchase_items WHERE purchase_id = ?', [$purchase_id]);
            if ((int)$count['c'] === 0 && $purchase['status'] === PURCHASE_PENDING) {
                $db->update('UPDATE purchases SET status = ?, updated_at = NOW() WHERE purchase_id = ?',
                    [PURCHASE_DRAFT, $purchase_id]);
            }
            Response::success([], 'Ítem eliminado');
        }

        // ── Action: execute ──
        if ($action === 'execute') {
            if ($purchase['status'] !== PURCHASE_PENDING) {
                Response::error('Solo se pueden ejecutar órdenes en estado pending', 409);
            }

            // Obtener items con cantidades reales del body
            $items_data = isset($data['items']) ? $data['items'] : [];
            if (empty($items_data)) {
                Response::validationError(['items' => 'Debe proporcionar las cantidades y costos reales']);
            }

            // La compra saca dinero de una caja concreta: hay que saber DE CUÁL.
            // Antes se tomaba la primera caja abierta sin preguntar, así que con
            // varias cajas abiertas el gasto caía en una cualquiera y el
            // administrador perdía el control de qué salió de dónde.
            $reg_result = CashRegister::resolve(
                $db,
                $store_id,
                isset($data['register_id']) ? (int)$data['register_id'] : 0
            );
            if (!$reg_result['ok']) {
                Response::error($reg_result['error'], CashRegister::errorCode($reg_result), [
                    'multiple' => $reg_result['multiple'],
                    'cajas'    => $reg_result['options'],
                ]);
            }
            $register_id = $reg_result['register_id'];

            $bom = new BomHelper($db);
            $total_cost = 0.0;

            $db->beginTransaction();
            try {
                foreach ($items_data as $idx => $idata) {
                    $item_id = isset($idata['item_id']) ? (int)$idata['item_id'] : 0;
                    $actual_qty = isset($idata['actual_quantity']) ? (float)$idata['actual_quantity'] : 0;
                    $unit_cost = isset($idata['unit_cost']) ? (float)$idata['unit_cost'] : 0;

                    if ($item_id <= 0 || $actual_qty <= 0) { continue; }
                    if ($unit_cost < 0) { throw new Exception('El costo unitario no puede ser negativo'); }

                    $item = $db->selectOne(
                        'SELECT pi.*, pr.tracking_type, pr.current_stock, pr.pieces_per_box, pr.cost
                         FROM purchase_items pi
                         JOIN products pr ON pi.product_id = pr.product_id
                         WHERE pi.item_id = ? AND pi.purchase_id = ?',
                        [$item_id, $purchase_id]
                    );
                    if (!$item) { continue; }

                    $line_total = $actual_qty * $unit_cost;
                    $total_cost += $line_total;

                    // Actualizar el ítem
                    $db->update(
                        'UPDATE purchase_items SET actual_quantity = ?, unit_cost = ?, total_cost = ? WHERE item_id = ?',
                        [$actual_qty, $unit_cost, $line_total, $item_id]
                    );

                    $product_id = (int)$item['product_id'];
                    $type = $item['tracking_type'];
                    $prev_stock = (float)$item['current_stock'];
                    $user_id = (int)$currentUser['user_id'];

                    if ($type === 'stock') {
                        // Producto final: sumar stock
                        $new_stock = $prev_stock + $actual_qty;
                        // Calcular nuevo costo promedio ponderado
                        $prev_cost = (float)$item['cost'];
                        $new_cost = (($prev_cost * $prev_stock) + $line_total) / $new_stock;

                        $db->update(
                            'UPDATE products SET current_stock = ?, cost = ?, updated_at = NOW() WHERE product_id = ?',
                            [$new_stock, $new_cost, $product_id]
                        );
                        $db->insert(
                            'INSERT INTO inventory_movements (store_id, product_id, user_id, movement_type, quantity, previous_stock, new_stock, notes, reference_id, reference_type, created_at)
                             VALUES (?,?,?,?,?,?,?,?,?,?,NOW())',
                            [$store_id, $product_id, $user_id, MOVEMENT_PURCHASE, $actual_qty, $prev_stock, $new_stock,
                             'Compra #' . $purchase_id, $purchase_id, 'purchase']
                        );
                    } elseif ($type === 'component') {
                        // Componente: crear lote nuevo
                        $supplier = $purchase['supplier_name'] ?: 'Compra #' . $purchase_id;
                        $lot_id = $db->insert(
                            'INSERT INTO product_lots (store_id, product_id, label, quantity, unit_cost) VALUES (?,?,?,?,?)',
                            [$store_id, $product_id, $supplier, $actual_qty, $unit_cost]
                        );
                        // Guardar lot_id en el item
                        $db->update('UPDATE purchase_items SET lot_id = ? WHERE item_id = ?', [$lot_id, $item_id]);

                        // Registrar movimiento
                        $blend = $bom->blend($store_id, $product_id);
                        $db->insert(
                            'INSERT INTO inventory_movements (store_id, product_id, user_id, movement_type, quantity, previous_stock, new_stock, notes, reference_id, reference_type, created_at)
                             VALUES (?,?,?,?,?,?,?,?,?,?,NOW())',
                            [$store_id, $product_id, $user_id, MOVEMENT_PURCHASE, $actual_qty, $blend['total'] - $actual_qty, $blend['total'],
                             'Compra #' . $purchase_id . ' - Lote #' . $lot_id, $purchase_id, 'purchase']
                        );
                    }
                }

                if ($total_cost <= 0) {
                    throw new Exception('Debe recibirse al menos un producto con costo mayor a cero');
                }

                // Registrar movimiento de caja (retiro)
                $db->insert(
                    'INSERT INTO cash_movements (register_id, user_id, movement_type, amount, description, reference_id, reference_type, created_at)
                     VALUES (?,?,?,?,?,?,?,NOW())',
                    [$register_id, $currentUser['user_id'], 'withdrawal', $total_cost,
                     'Compra #' . $purchase_id . ($purchase['supplier_name'] ? ' - ' . $purchase['supplier_name'] : ''),
                     $purchase_id, 'purchase']
                );

                // Actualizar compra
                $db->update(
                    'UPDATE purchases SET status = ?, total_cost = ?, executed_at = NOW(), updated_at = NOW() WHERE purchase_id = ?',
                    [PURCHASE_EXECUTED, $total_cost, $purchase_id]
                );

                $db->commit();
            } catch (Exception $e) {
                $db->rollback();
                throw $e;
            }

            Response::success([
                'purchase_id' => $purchase_id,
                'status' => PURCHASE_EXECUTED,
                'total_cost' => $total_cost,
            ], 'Compra ejecutada exitosamente');
        }

        // ── Action: cancel ──
        if ($action === 'cancel') {
            if (!in_array($purchase['status'], [PURCHASE_DRAFT, PURCHASE_PENDING])) {
                Response::error('No se puede cancelar una orden en estado ' . $purchase['status'], 409);
            }
            $db->update(
                'UPDATE purchases SET status = ?, updated_at = NOW() WHERE purchase_id = ?',
                [PURCHASE_CANCELLED, $purchase_id]
            );
            Response::success([], 'Compra cancelada');
        }

        Response::error('Acción no válida', 400);
    }

    // ── DELETE (cancel) ───────────────────────────────────
    if ($method === 'DELETE') {
        if ($currentUser['via'] === 'session') {
            if (!$auth->hasRole([ROLE_ADMIN, ROLE_MANAGER])) { Response::error('Permisos insuficientes', 403); }
        } else {
            $apiAuth->requireScope($actor, 'write');
        }

        $data = json_decode(file_get_contents('php://input'), true);
        $purchase_id = isset($data['purchase_id']) ? (int)$data['purchase_id'] : 0;
        if ($purchase_id <= 0) { Response::validationError(['purchase_id' => 'Requerido']); }

        $purchase = $db->selectOne(
            'SELECT * FROM purchases WHERE purchase_id = ? AND store_id = ?',
            [$purchase_id, $store_id]
        );
        if (!$purchase) { Response::notFound('Compra no encontrada'); }
        if (!in_array($purchase['status'], [PURCHASE_DRAFT, PURCHASE_PENDING])) {
            Response::error('Solo se pueden cancelar órdenes draft/pending', 409);
        }

        $db->update(
            'UPDATE purchases SET status = ?, updated_at = NOW() WHERE purchase_id = ?',
            [PURCHASE_CANCELLED, $purchase_id]
        );
        Response::success([], 'Compra cancelada');
    }

    Response::error('Método no permitido', 405);
} catch (Exception $e) {
    Response::error('Error servidor: ' . $e->getMessage(), 500);
}
