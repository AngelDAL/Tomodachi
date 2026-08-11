<?php
/**
 * Cancelar venta
 * POST /api/sales/cancel_sale.php {"sale_id":123}
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';

require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'POST') { Response::error('Método no permitido',405); }

try {
    $db = new Database();
    $auth = new Auth($db);

    $apiAuth = new ApiAuth($db);
    $actor = $apiAuth->requireActor($auth);
    if ($actor['via'] === 'session') {
        if (!$auth->hasRole([ROLE_ADMIN,ROLE_MANAGER])) { Response::error('Permisos insuficientes',403); }
    } else {
        $apiAuth->requireScope($actor, 'write');
    }

    $currentUser = $actor;

    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { Response::validationError(['body'=>'JSON inválido']); }
    $sale_id = isset($data['sale_id']) ? (int)$data['sale_id'] : 0;
    if ($sale_id<=0) { Response::validationError(['sale_id'=>'Requerido']); }

    $sale = $db->selectOne('SELECT sale_id, store_id, register_id, payment_method, status, total, customer_id, amount_paid FROM sales WHERE sale_id = ?',[$sale_id]);
    if (!$sale) { Response::notFound('Venta no existe'); }
    if ($sale['status'] !== SALE_COMPLETED) { Response::error('Solo ventas completadas pueden cancelarse',409); }

    // Seguridad: el usuario solo puede cancelar ventas de su propia tienda
    if ((int)$sale['store_id'] !== (int)$currentUser['store_id']) {
        Response::error('No autorizado para cancelar ventas de otra tienda', 403);
    }

    $items = $db->select('SELECT product_id, quantity FROM sale_details WHERE sale_id = ?',[$sale_id]);
    if (!$items) { Response::error('Venta sin detalles',409); }

    $db->beginTransaction();
    try {
        // Devolver stock
        foreach ($items as $it) {
            $prod = $db->selectOne('SELECT product_id, current_stock FROM products WHERE product_id = ? AND store_id = ?',[$it['product_id'], $sale['store_id']]);
            if ($prod) {
                $new_stock = $prod['current_stock'] + $it['quantity'];
                $db->update('UPDATE products SET current_stock = ?, updated_at = NOW() WHERE product_id = ?',[$new_stock,$it['product_id']]);
                $db->insert('INSERT INTO inventory_movements (store_id, product_id, user_id, movement_type, quantity, previous_stock, new_stock, notes, created_at) VALUES (?,?,?,?,?,?,?,?,NOW())',[
                    $sale['store_id'],$it['product_id'],$currentUser['user_id'],MOVEMENT_RETURN,$it['quantity'],$prod['current_stock'],$new_stock,'Cancelación venta #'.$sale_id
                ]);
            }
        }
        // Actualizar estado venta
        $db->update('UPDATE sales SET status = ? WHERE sale_id = ?',[SALE_CANCELLED,$sale_id]);
        // Si la venta era apartado, revertir el balance del cliente
        if ($sale['payment_method'] === PAYMENT_CREDIT && $sale['customer_id'] > 0) {
            $debtAmount = (float)$sale['total'] - (float)$sale['amount_paid'];
            if ($debtAmount > 0) {
                $db->update('UPDATE customers SET balance = GREATEST(balance - ?, 0) WHERE customer_id = ?', [$debtAmount, $sale['customer_id']]);
            }
        }
        // Movimiento caja negativo si fue en efectivo
        if (in_array($sale['payment_method'],[PAYMENT_CASH,PAYMENT_MIXED])) {
            $db->insert('INSERT INTO cash_movements (register_id, user_id, movement_type, amount, description, created_at) VALUES (?,?,?,?,?,NOW())',[ $sale['register_id'], $currentUser['user_id'], 'withdrawal', $sale['total'], 'Cancelación Venta #'.$sale_id ]);
        }
        $db->commit();
    } catch (Exception $e) {
        $db->rollback();
        throw $e;
    }

    Response::success(['sale_id'=>$sale_id],'Venta cancelada');
} catch (Exception $e) { Response::error('Error servidor: '.$e->getMessage(),500); }
