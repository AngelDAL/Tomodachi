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
require_once '../../includes/ApiAuth.class.php';
require_once '../../includes/BomHelper.class.php';

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

    // Usar store_id del usuario actual para seguridad
    $store_id = (int)$currentUser['store_id'];
    
    // Si el usuario es admin global (si existiera esa lógica) podría permitirse cambiar, 
    // pero por ahora forzamos la tienda del usuario como en products.php
    
    $product_id = isset($data['product_id']) ? (int)$data['product_id'] : 0;
    $movement_type = isset($data['movement_type']) ? Validator::sanitizeString($data['movement_type']) : '';
    $quantity = isset($data['quantity']) ? (float)$data['quantity'] : 0.0;
    $notes = isset($data['notes']) ? Validator::sanitizeString($data['notes']) : '';
    // Lotes/cajas: 'boxes' (unidades comerciales) y 'cost_amount' (valor de compra).
    $boxes = isset($data['boxes']) ? (int)$data['boxes'] : 0;
    $cost_amount = (isset($data['cost_amount']) && is_numeric($data['cost_amount'])) ? (float)$data['cost_amount'] : null;

    $errors=[];
    if ($store_id<=0) $errors['store_id']='Tienda no identificada';
    if ($product_id<=0) $errors['product_id']='Requerido';
    if (!in_array($movement_type,[MOVEMENT_ENTRY,MOVEMENT_EXIT,MOVEMENT_ADJUSTMENT,MOVEMENT_RETURN])) $errors['movement_type']='Tipo inválido';
    if ($quantity==0 && $boxes<=0) $errors['quantity']='Cantidad debe ser distinta de 0';
    if ($errors) { Response::validationError($errors); }

    $store = $db->selectOne('SELECT store_id FROM stores WHERE store_id = ? AND status = ?',[$store_id,STATUS_ACTIVE]);
    if (!$store) { Response::error('Tienda no válida',404); }
    
    // Verificar que el producto pertenezca a la tienda
    $product = $db->selectOne('SELECT product_id, current_stock, tracking_type, pieces_per_box, cost FROM products WHERE product_id = ? AND store_id = ? AND status = ?',[$product_id, $store_id, STATUS_ACTIVE]);
    
    if (!$product) { Response::error('Producto no válido o no pertenece a su tienda',404); }

    $bom = new BomHelper($db);
    $type = $bom->normalizeType($product['tracking_type'] ?? 'stock');
    if ($type === TRACKING_RECIPE) {
        Response::error('El inventario de un producto ensamblado se deriva de su receta; ajuste los ingredientes.',409);
    }
    if ($type === TRACKING_NONE) {
        Response::error('El producto es de tipo servicio y no lleva inventario.',409);
    }

    $ppb = (int)($product['pieces_per_box'] ?? 0);
    $previous = (float)$product['current_stock'];
    $new_stock = $previous;
    // Piezas a mover: si se dan cajas (y hay piezas_por_caja), total = cajas × piezas_por_caja.
    $moveQty = ($boxes > 0 && $ppb > 0) ? ($boxes * $ppb) : abs($quantity);

    switch ($movement_type) {
        case MOVEMENT_ENTRY:
        case MOVEMENT_RETURN:
            $new_stock = $previous + $moveQty;
            break;
        case MOVEMENT_EXIT:
            $new_stock = $previous - $moveQty;
            break;
        case MOVEMENT_ADJUSTMENT:
            $new_stock = ($boxes > 0 && $ppb > 0) ? ($boxes * $ppb) : $quantity;
            break;
    }

    if ($new_stock < 0) { Response::error('Resultado dejaría stock negativo',400); }

    // Cantidad que queda registrada en inventory_movements (piezas movidas para
    // entrada/salida; stock final para ajuste) — igual que el comportamiento previo.
    $logQty = in_array($movement_type, [MOVEMENT_ENTRY, MOVEMENT_EXIT]) ? $moveQty : $new_stock;

    // Recalcular costo por pieza si se informa el valor de compra de la caja/lote.
    //   - entrada/devolución: promedio ponderado (costo previo × previo + valor) / nuevo total.
    //   - ajuste: valor ÷ stock final (valoración absoluta del inventario resultante).
    $newCost = null;
    if ($cost_amount !== null) {
        if (in_array($movement_type, [MOVEMENT_ENTRY, MOVEMENT_RETURN]) && $moveQty > 0) {
            $newCost = (((float)$product['cost'] * $previous) + $cost_amount) / ($previous + $moveQty);
        } elseif ($movement_type === MOVEMENT_ADJUSTMENT && $new_stock > 0) {
            $newCost = $cost_amount / $new_stock;
        }
    }

    // Transacción
    $db->beginTransaction();
    try {
        if ($newCost !== null) {
            $db->update('UPDATE products SET current_stock = ?, cost = ?, updated_at = NOW() WHERE product_id = ?',[$new_stock,$newCost,$product_id]);
        } else {
            $db->update('UPDATE products SET current_stock = ?, updated_at = NOW() WHERE product_id = ?',[$new_stock,$product_id]);
        }
        $db->insert('INSERT INTO inventory_movements (store_id, product_id, user_id, movement_type, quantity, previous_stock, new_stock, notes, created_at) VALUES (?,?,?,?,?,?,?,?,NOW())',[
            $store_id,$product_id,$currentUser['user_id'],$movement_type,$logQty,$previous,$new_stock,$notes
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
