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

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'POST') { Response::error('Método no permitido',405); }

try {
    $db = new Database();
    $auth = new Auth($db);

    if (!$auth->isLoggedIn()) { Response::unauthorized(); }
    if (!$auth->hasRole([ROLE_ADMIN,ROLE_MANAGER])) { Response::error('Permisos insuficientes',403); }

    $currentUser = $auth->getCurrentUser();

    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { Response::validationError(['body'=>'JSON inválido']); }
    $sale_id = isset($data['sale_id']) ? (int)$data['sale_id'] : 0;
    if ($sale_id<=0) { Response::validationError(['sale_id'=>'Requerido']); }

    $sale = $db->selectOne('SELECT sale_id, store_id, register_id, payment_method, status, total FROM sales WHERE sale_id = ?',[$sale_id]);
    if (!$sale) { Response::notFound('Venta no existe'); }
    if ($sale['status'] !== SALE_COMPLETED) { Response::error('Solo ventas completadas pueden cancelarse',409); }

    $items = $db->select('SELECT product_id, quantity FROM sale_details WHERE sale_id = ?',[$sale_id]);
    if (!$items) { Response::error('Venta sin detalles',409); }

    $db->beginTransaction();
    try {
        // Devolver stock
        foreach ($items as $it) {
            $inv = $db->selectOne('SELECT inventory_id, current_stock FROM inventory WHERE store_id = ? AND product_id = ?',[$sale['store_id'],$it['product_id']]);
            if ($inv) {
                $new_stock = $inv['current_stock'] + $it['quantity'];
                $db->update('UPDATE inventory SET current_stock = ?, last_updated = NOW() WHERE inventory_id = ?',[$new_stock,$inv['inventory_id']]);
                $db->insert('INSERT INTO inventory_movements (store_id, product_id, user_id, movement_type, quantity, previous_stock, new_stock, notes, created_at) VALUES (?,?,?,?,?,?,?,?,NOW())',[
                    $sale['store_id'],$it['product_id'],$currentUser['user_id'],MOVEMENT_RETURN,$it['quantity'],$inv['current_stock'],$new_stock,'Cancelación venta #'.$sale_id
                ]);
            }
        }
        // Actualizar estado venta
        $db->update('UPDATE sales SET status = ? WHERE sale_id = ?',[SALE_CANCELLED,$sale_id]);
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
