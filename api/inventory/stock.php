<?php
/**
 * Ajuste de stock
 * POST /api/inventory/stock.php
 * Body: { store_id, product_id, movement_type, quantity, notes }
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';

session_start();
if (!isset($_SESSION['user_id'])) { Response::unauthorized(); }
if (!in_array($_SESSION['role'],[ROLE_ADMIN,ROLE_MANAGER])) { Response::error('Permisos insuficientes',403); }

if ($_SERVER['REQUEST_METHOD'] !== 'POST') { Response::error('Método no permitido',405); }

try {
    $db = new Database();
    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { Response::validationError(['body'=>'JSON inválido']); }

    $store_id = isset($data['store_id']) ? (int)$data['store_id'] : 0;
    $product_id = isset($data['product_id']) ? (int)$data['product_id'] : 0;
    $movement_type = isset($data['movement_type']) ? Validator::sanitizeString($data['movement_type']) : '';
    $quantity = isset($data['quantity']) ? (int)$data['quantity'] : 0;
    $notes = isset($data['notes']) ? Validator::sanitizeString($data['notes']) : '';

    $errors=[];
    if ($store_id<=0) $errors['store_id']='Requerido';
    if ($product_id<=0) $errors['product_id']='Requerido';
    if (!in_array($movement_type,[MOVEMENT_ENTRY,MOVEMENT_EXIT,MOVEMENT_ADJUSTMENT,MOVEMENT_RETURN])) $errors['movement_type']='Tipo inválido';
    if ($quantity===0) $errors['quantity']='Cantidad debe ser distinta de 0';
    if ($errors) { Response::validationError($errors); }

    $store = $db->selectOne('SELECT store_id FROM stores WHERE store_id = ? AND status = ?',[$store_id,STATUS_ACTIVE]);
    if (!$store) { Response::error('Tienda no válida',404); }
    $product = $db->selectOne('SELECT product_id FROM products WHERE product_id = ? AND status = ?',[$product_id,STATUS_ACTIVE]);
    if (!$product) { Response::error('Producto no válido',404); }

    // Obtener stock actual (crear si no existe)
    $inv = $db->selectOne('SELECT inventory_id, current_stock FROM inventory WHERE store_id = ? AND product_id = ?',[$store_id,$product_id]);
    if (!$inv) {
        $inv_id = $db->insert('INSERT INTO inventory (store_id, product_id, current_stock, last_updated) VALUES (?,?,0,NOW())',[$store_id,$product_id]);
        $inv = ['inventory_id'=>$inv_id,'current_stock'=>0];
    }

    $previous = (int)$inv['current_stock'];
    $new_stock = $previous;

    switch ($movement_type) {
        case MOVEMENT_ENTRY:
        case MOVEMENT_RETURN:
            $new_stock = $previous + abs($quantity);
            break;
        case MOVEMENT_EXIT:
            $new_stock = $previous - abs($quantity);
            break;
        case MOVEMENT_ADJUSTMENT:
            $new_stock = $quantity; // aquí quantity representa stock final
            break;
    }

    if ($new_stock < 0) { Response::error('Resultado dejaría stock negativo',400); }

    // Transacción
    $db->beginTransaction();
    try {
        $db->update('UPDATE inventory SET current_stock = ?, last_updated = NOW() WHERE inventory_id = ?',[$new_stock,$inv['inventory_id']]);
        $db->insert('INSERT INTO inventory_movements (store_id, product_id, user_id, movement_type, quantity, previous_stock, new_stock, notes, created_at) VALUES (?,?,?,?,?,?,?,?,NOW())',[
            $store_id,$product_id,$_SESSION['user_id'],$movement_type,$quantity,$previous,$new_stock,$notes
        ]);
        $db->commit();
    } catch (Exception $e) {
        $db->rollback();
        throw $e;
    }

    Response::success([
        'store_id'=>$store_id,
        'product_id'=>$product_id,
        'previous_stock'=>$previous,
        'new_stock'=>$new_stock,
        'movement_type'=>$movement_type
    ],'Stock actualizado');
} catch (Exception $e) {
    Response::error('Error servidor: '.$e->getMessage(),500);
}
