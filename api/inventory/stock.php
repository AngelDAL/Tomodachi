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

    // Usar store_id del usuario actual para seguridad
    $store_id = (int)$currentUser['store_id'];
    
    // Si el usuario es admin global (si existiera esa lógica) podría permitirse cambiar, 
    // pero por ahora forzamos la tienda del usuario como en products.php
    
    $product_id = isset($data['product_id']) ? (int)$data['product_id'] : 0;
    $movement_type = isset($data['movement_type']) ? Validator::sanitizeString($data['movement_type']) : '';
    $quantity = isset($data['quantity']) ? (int)$data['quantity'] : 0;
    $notes = isset($data['notes']) ? Validator::sanitizeString($data['notes']) : '';

    $errors=[];
    if ($store_id<=0) $errors['store_id']='Tienda no identificada';
    if ($product_id<=0) $errors['product_id']='Requerido';
    if (!in_array($movement_type,[MOVEMENT_ENTRY,MOVEMENT_EXIT,MOVEMENT_ADJUSTMENT,MOVEMENT_RETURN])) $errors['movement_type']='Tipo inválido';
    if ($quantity===0) $errors['quantity']='Cantidad debe ser distinta de 0';
    if ($errors) { Response::validationError($errors); }

    $store = $db->selectOne('SELECT store_id FROM stores WHERE store_id = ? AND status = ?',[$store_id,STATUS_ACTIVE]);
    if (!$store) { Response::error('Tienda no válida',404); }
    
    // Verificar que el producto pertenezca a la tienda (o sea global pero accesible)
    // En products.php se verifica: product_id = ? AND store_id = ?
    // Pero los productos pueden ser globales? El esquema dice products tiene store_id.
    // Así que debemos verificar que el producto sea de la tienda.
    $product = $db->selectOne('SELECT product_id FROM products WHERE product_id = ? AND store_id = ? AND status = ?',[$product_id, $store_id, STATUS_ACTIVE]);
    
    if (!$product) { Response::error('Producto no válido o no pertenece a su tienda',404); }

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
            $store_id,$product_id,$currentUser['user_id'],$movement_type,$quantity,$previous,$new_stock,$notes
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
