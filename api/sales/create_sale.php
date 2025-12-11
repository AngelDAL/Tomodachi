<?php
/**
 * Crear venta
 * POST /api/sales/create_sale.php
 * Body ejemplo:
 * {
 *   "store_id":1,
 *   "register_id":2, // opcional si se obtiene automáticamente
 *   "items":[{"product_id":1,"quantity":2,"price":15.50}],
 *   "payment_method":"cash", // cash|card|transfer|mixed
 *   "cash_amount":31.00,       // si mixed indica parte en efectivo
 *   "discount":0,
 *   "tax":0
 * }
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';

$db = new Database();
$auth = new Auth($db);

if (!$auth->isLoggedIn()) { Response::unauthorized(); }
if (!in_array($auth->getCurrentUser()['role'],[ROLE_ADMIN,ROLE_MANAGER,ROLE_CASHIER])) { Response::error('Permisos insuficientes',403); }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { Response::error('Método no permitido',405); }

try {
    $db = new Database();
    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { Response::validationError(['body'=>'JSON inválido']); }

    $store_id = isset($data['store_id']) ? (int)$data['store_id'] : 0;
    $register_id = isset($data['register_id']) ? (int)$data['register_id'] : 0;
    $items = isset($data['items']) ? $data['items'] : [];
    $payment_method = isset($data['payment_method']) ? Validator::sanitizeString($data['payment_method']) : '';
    $discount = isset($data['discount']) ? (float)$data['discount'] : 0.0;
    $tax = isset($data['tax']) ? (float)$data['tax'] : 0.0;
    $cash_amount = isset($data['cash_amount']) ? (float)$data['cash_amount'] : null;

    $errors=[];
    if ($store_id<=0) $errors['store_id']='Requerido';
    if (!$items || !is_array($items)) $errors['items']='Lista vacía';
    if (!in_array($payment_method,[PAYMENT_CASH,PAYMENT_CARD,PAYMENT_TRANSFER,PAYMENT_MIXED])) $errors['payment_method']='Método inválido';
    if ($payment_method===PAYMENT_MIXED && ($cash_amount===null || $cash_amount<0)) $errors['cash_amount']='Requerido en pago mixto';
    if ($errors) { Response::validationError($errors); }

    // Validar store
    $storeInfo = $db->selectOne('SELECT store_id, settings FROM stores WHERE store_id = ? AND status = ?',[$store_id,STATUS_ACTIVE]);
    if (!$storeInfo) { Response::error('Tienda no válida',404); }
    
    // Configuración de stock negativo
    $storeSettings = $storeInfo['settings'] ? json_decode($storeInfo['settings'], true) : [];
    $allowNegativeStock = isset($storeSettings['allow_negative_stock']) && $storeSettings['allow_negative_stock'];

    // Obtener caja abierta
    // Prioridad: 1. register_id enviado, 2. Caja abierta por el usuario actual, 3. Única caja abierta en la tienda
    
    if ($register_id > 0) {
        $open = $db->selectOne('SELECT register_id FROM cash_registers WHERE register_id = ? AND status = ?',[$register_id,REGISTER_OPEN]);
        if (!$open) { Response::error('La caja especificada no está abierta',409); }
    } else {
        // Buscar caja del usuario actual
        $user = $auth->getCurrentUser();
        $open = $db->selectOne('SELECT register_id FROM cash_registers WHERE store_id = ? AND user_id = ? AND status = ?',[$store_id, $user['user_id'], REGISTER_OPEN]);
        
        if (!$open) {
            // Si no tiene caja propia, buscar si hay SOLO UNA caja abierta en la tienda (modo simple)
            $opens = $db->select('SELECT register_id FROM cash_registers WHERE store_id = ? AND status = ?',[$store_id, REGISTER_OPEN]);
            if (count($opens) === 1) {
                $open = $opens[0];
            } else if (count($opens) > 1) {
                Response::error('Hay múltiples cajas abiertas. Por favor seleccione una terminal o abra su propia caja.', 409);
            }
        }

        if (!$open) {
            // Si no hay caja abierta, intentar abrir una automáticamente (fallback)
            // Buscar terminal disponible o crear una
            $terminals = $db->select('SELECT terminal_id FROM terminals WHERE store_id = ? AND status = "active"', [$store_id]);
            $terminal_id = 0;
            
            if (count($terminals) > 0) {
                $terminal_id = $terminals[0]['terminal_id'];
            } else {
                $terminal_id = $db->insert('INSERT INTO terminals (store_id, terminal_name) VALUES (?, ?)', [$store_id, 'Caja Automática']);
            }

            // Crear registro de caja abierta
            $register_id = $db->insert('INSERT INTO cash_registers (store_id, user_id, terminal_id, opening_date, initial_amount, status) VALUES (?, ?, ?, NOW(), 0, ?)', [
                $store_id, $user['user_id'], $terminal_id, REGISTER_OPEN
            ]);
            
            // Marcar para notificación
            $autoOpenedRegister = true;
        } else {
            $register_id = (int)$open['register_id'];
        }
    }

    // Cálculo de totales y validaciones de stock
    $subtotal = 0.0;
    $productsToUpdate = [];
    foreach ($items as $idx=>$it) {
        $pid = isset($it['product_id']) ? (int)$it['product_id'] : 0;
        $qty = isset($it['quantity']) ? (int)$it['quantity'] : 0;
        // SEGURIDAD: Ignoramos el precio enviado por el frontend y usamos el de la BD
        // $price = isset($it['price']) ? (float)$it['price'] : 0.0; 
        
        if ($pid<=0 || $qty<=0) { Response::validationError(['items'=>'Datos inválidos en item índice '.$idx]); }
        
        // Obtenemos precio real de la base de datos y stock
        $prod = $db->selectOne('SELECT product_id, product_name, status, price, current_stock FROM products WHERE product_id = ? AND status = ?',[$pid,STATUS_ACTIVE]);
        
        if (!$prod) { Response::error('Producto inactivo o inexistente ID '.$pid,404); }
        
        $price = (float)$prod['price']; // Precio blindado
        $stockActual = (int)$prod['current_stock'];
        
        // Validar stock solo si NO se permite stock negativo
        if (!$allowNegativeStock && $stockActual < $qty) { 
            Response::error("Stock insuficiente para el producto '{$prod['product_name']}'. (Puede activar 'Stock negativo' en Configuración de Tienda si lo requiere)",409); 
        }
        
        $lineSubtotal = $qty * $price;
        $subtotal += $lineSubtotal;
        $productsToUpdate[] = [
            'product_id'=>$pid,
            'quantity'=>$qty,
            'price'=>$price,
            'previous_stock'=>$stockActual,
            'new_stock'=>$stockActual - $qty
        ];
    }

    $total = $subtotal - $discount + $tax;
    if ($total < 0) { Response::error('Total negativo',400); }

    // Transacción
    $db->beginTransaction();
    try {
        $user = $auth->getCurrentUser();
        $sale_id = $db->insert('INSERT INTO sales (store_id, user_id, register_id, sale_date, subtotal, tax, discount, total, payment_method, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,NOW())',[
            $store_id, $user['user_id'], $register_id, date('Y-m-d H:i:s'), $subtotal, $tax, $discount, $total, $payment_method, SALE_COMPLETED
        ]);

        foreach ($productsToUpdate as $p) {
            // Actualizar inventario en tabla products
            $db->update('UPDATE products SET current_stock = ?, updated_at = NOW() WHERE product_id = ?',[$p['new_stock'],$p['product_id']]);
            // Movimiento inventario tipo sale
            $db->insert('INSERT INTO inventory_movements (store_id, product_id, user_id, movement_type, quantity, previous_stock, new_stock, notes, created_at) VALUES (?,?,?,?,?,?,?,?,NOW())',[
                $store_id,$p['product_id'],$user['user_id'],MOVEMENT_SALE,$p['quantity'],$p['previous_stock'],$p['new_stock'],'Venta #'.$sale_id
            ]);
            // Detalle venta
            $lineSubtotal = $p['quantity'] * $p['price'];
            $db->insert('INSERT INTO sale_details (sale_id, product_id, quantity, unit_price, subtotal, discount, total) VALUES (?,?,?,?,?,?,?)',[
                $sale_id,$p['product_id'],$p['quantity'],$p['price'],$lineSubtotal,0,$lineSubtotal
            ]);
        }

        // Movimiento de caja si corresponde
        if (in_array($payment_method,[PAYMENT_CASH,PAYMENT_MIXED])) {
            $cashTotal = ($payment_method===PAYMENT_MIXED) ? $cash_amount : $total;
            if ($cashTotal>0) {
                $db->insert('INSERT INTO cash_movements (register_id, user_id, movement_type, amount, description, created_at) VALUES (?,?,?,?,?,NOW())',[ $register_id, $user['user_id'], 'sale', $cashTotal, 'Venta #'.$sale_id ]);
            }
        }

        $db->commit();
    } catch (Exception $e) {
        $db->rollback();
        throw $e;
    }

    Response::success([
        'sale_id'=>$sale_id,
        'total'=>$total,
        'register_opened' => isset($autoOpenedRegister) && $autoOpenedRegister
    ],'Venta registrada');
} catch (Exception $e) {
    Response::error('Error servidor: '.$e->getMessage(),500);
}
