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
require_once '../../includes/FormatHelper.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';
require_once '../../includes/Pricing.class.php';

$db = new Database();
$auth = new Auth($db);

$apiAuth = new ApiAuth($db);
$actor = $apiAuth->requireActor($auth);
if ($actor['via'] === 'session') {
    if (!in_array($actor['role'],[ROLE_ADMIN,ROLE_MANAGER,ROLE_CASHIER])) { Response::error('Permisos insuficientes',403); }
} else {
    $apiAuth->requireScope($actor, 'write');
}
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
    $customer_id = isset($data['customer_id']) ? (int)$data['customer_id'] : 0;
    // Para apartado: cuánto pagó el cliente AHORA (el resto queda como saldo).
    $amount_paid = isset($data['amount_paid']) ? (float)$data['amount_paid'] : 0.0;

    $errors=[];
    if ($store_id<=0) $errors['store_id']='Requerido';
    if (!$items || !is_array($items)) $errors['items']='Lista vacía';
    if (!in_array($payment_method,[PAYMENT_CASH,PAYMENT_CARD,PAYMENT_TRANSFER,PAYMENT_MIXED,PAYMENT_CREDIT])) $errors['payment_method']='Método inválido';
    if ($payment_method===PAYMENT_MIXED && ($cash_amount===null || $cash_amount<0)) $errors['cash_amount']='Requerido en pago mixto';
    if ($payment_method===PAYMENT_CREDIT && $customer_id<=0) $errors['customer_id']='Requerido para apartado';
    if ($errors) { Response::validationError($errors); }

    // Seguridad: el usuario solo puede facturar en su propia tienda
    $currentUser = $actor;
    $session_store_id = (int)$currentUser['store_id'];
    if ($store_id !== $session_store_id) {
        Response::error('No autorizado para facturar en otra tienda', 403);
    }

    // Validar store
    $storeInfo = $db->selectOne('SELECT store_id, settings FROM stores WHERE store_id = ? AND status = ?',[$store_id,STATUS_ACTIVE]);
    if (!$storeInfo) { Response::error('Tienda no válida',404); }
    
    // Configuración de stock negativo y control de caja
    $storeSettings = $storeInfo['settings'] ? json_decode($storeInfo['settings'], true) : [];
    $allowNegativeStock = isset($storeSettings['allow_negative_stock']) && $storeSettings['allow_negative_stock'];
    $requireOpenRegister = isset($storeSettings['require_open_register']) && $storeSettings['require_open_register'];

    // Obtener caja abierta
    // Prioridad: 1. register_id enviado, 2. Caja abierta por el usuario actual, 3. Única caja abierta en la tienda
    
    if ($register_id > 0) {
        $open = $db->selectOne('SELECT register_id FROM cash_registers WHERE register_id = ? AND store_id = ? AND status = ?',[$register_id,$store_id,REGISTER_OPEN]);
        if (!$open) { Response::error('La caja especificada no está abierta en esta tienda',409); }
    } else {
        // Buscar caja del usuario actual
        $user = $actor;
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
            // C2: si la tienda exige apertura formal de caja, NO abrir
            // automáticamente — pedir que un encargado abra la caja.
            if ($requireOpenRegister) {
                Response::error('No hay caja abierta. Abra la caja (Finanzas → Abrir caja) antes de vender.', 409);
            }
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

    // Cálculo de totales y validaciones de stock — FUENTE DE VERDAD DEL SERVIDOR.
    // El precio que mande el cliente/agente se IGNORA: se recalcula desde la BD
    // (products.price) + promociones activas mediante Pricing.class.php.
    $pricing = new Pricing($db);
    $pricingResult = $pricing->calculate($store_id, $items, $allowNegativeStock);

    // Descuento manual del cajero (opcional, validado): solo puede reducir,
    // nunca superar el subtotal ya calculado por el servidor.
    $manualDiscount = max(0.0, (float)$discount);
    if ($manualDiscount > $pricingResult['subtotal']) {
        Response::validationError(['discount' => 'El descuento no puede exceder el subtotal']);
    }

    $subtotal = $pricingResult['subtotal'];
    $total = $subtotal - $manualDiscount + $tax;
    if ($total < 0) { Response::error('Total negativo',400); }

    // Validación de apartado (después de conocer el total)
    if ($payment_method === PAYMENT_CREDIT && ($amount_paid < 0 || $amount_paid > $total)) {
        Response::validationError(['amount_paid' => 'Monto inválido para apartado']);
    }
    // Si no es apartado, amount_paid = total (pago completo)
    if ($payment_method !== PAYMENT_CREDIT) { $amount_paid = $total; }

    // Si hay cliente asociado, validar que exista en la tienda
    $customer = null;
    if ($customer_id > 0) {
        $customer = $db->selectOne('SELECT customer_id, full_name, balance, credit_limit, status FROM customers WHERE customer_id = ? AND store_id = ?', [$customer_id, $store_id]);
        if (!$customer || $customer['status'] !== 'active') { Response::error('Cliente inválido', 404); }
        if ($payment_method === PAYMENT_CREDIT) {
            // Validar límite de crédito (0 = sin límite)
            $newBalance = (float)$customer['balance'] + ($total - $amount_paid);
            if ((float)$customer['credit_limit'] > 0 && $newBalance > (float)$customer['credit_limit']) {
                $fmt = \FormatHelper::getFormat($db, $store_id);
                Response::error("El saldo del cliente excede su límite de crédito (" . \FormatHelper::currency($customer['credit_limit'], $fmt) . ")", 409);
            }
        }
    }

    $productsToUpdate = [];
    foreach ($pricingResult['lines'] as $line) {
        $productsToUpdate[] = [
            'product_id' => $line['product_id'],
            'quantity' => $line['quantity'],
            'price' => $line['unit_price'],
            'unit_cost' => $line['unit_cost'],
            'discount' => $line['discount'],
            'promotion_id' => $line['promotion_id'],
            'previous_stock' => $line['current_stock'],
            'new_stock' => $line['current_stock'] - $line['quantity']
        ];
    }

    // Transacción
    $db->beginTransaction();
    try {
        $user = $actor;
        $createdVia = ($user['via'] === 'token') ? 'token' : 'session';
        $sale_id = $db->insert('INSERT INTO sales (store_id, user_id, customer_id, register_id, sale_date, subtotal, tax, discount, total, amount_paid, payment_method, status, created_via, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())',[
            $store_id, $user['user_id'], ($customer_id > 0 ? $customer_id : null), $register_id, date('Y-m-d H:i:s'), $subtotal, $tax, $discount, $total, $amount_paid, $payment_method, SALE_COMPLETED, $createdVia
        ]);

        // Si es apartado, incrementar balance del cliente
        if ($payment_method === PAYMENT_CREDIT && $customer_id > 0) {
            $debtAmount = $total - $amount_paid;
            if ($debtAmount > 0) {
                $db->update('UPDATE customers SET balance = balance + ? WHERE customer_id = ?', [$debtAmount, $customer_id]);
            }
            // Si pagó parte en efectivo, registrar el movimiento de caja
            if ($amount_paid > 0) {
                $db->insert('INSERT INTO cash_movements (register_id, user_id, movement_type, amount, description, created_at) VALUES (?,?,?,?,?,NOW())', [ $register_id, $user['user_id'], 'sale', $amount_paid, 'Venta #'.$sale_id.' (apartado, pago parcial)' ]);
            }
        }

        foreach ($productsToUpdate as $p) {
            // Actualizar inventario en tabla products
            $db->update('UPDATE products SET current_stock = ?, updated_at = NOW() WHERE product_id = ?',[$p['new_stock'],$p['product_id']]);
            // Movimiento inventario tipo sale
            $db->insert('INSERT INTO inventory_movements (store_id, product_id, user_id, movement_type, quantity, previous_stock, new_stock, notes, created_at) VALUES (?,?,?,?,?,?,?,?,NOW())',[
                $store_id,$p['product_id'],$user['user_id'],MOVEMENT_SALE,$p['quantity'],$p['previous_stock'],$p['new_stock'],'Venta #'.$sale_id
            ]);
            // Detalle venta (con costo histórico y promoción aplicada)
            $lineSubtotal = $p['quantity'] * $p['price'];
            $lineDiscount = round($p['quantity'] * $p['discount'], 2);
            $db->insert('INSERT INTO sale_details (sale_id, product_id, quantity, unit_price, unit_cost, subtotal, discount, promotion_id, total) VALUES (?,?,?,?,?,?,?,?,?)',[
                $sale_id,$p['product_id'],$p['quantity'],$p['price'],$p['unit_cost'],$lineSubtotal,$lineDiscount,$p['promotion_id'],$lineSubtotal - $lineDiscount
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
