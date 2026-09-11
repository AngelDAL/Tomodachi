<?php
/**
 * Movimientos manuales de caja (entrada / retiro)
 * POST /api/cash_register/cash_movements.php {"store_id":1, "movement_type":"entry", "amount":100, "description":"Cambio inicial"}
 * También puede usar register_id directamente.
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';

require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';
require_once '../../includes/CashRegister.class.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'POST') { Response::error('Método no permitido',405); }

try {
    $db = new Database();
    $auth = new Auth($db);

    $apiAuth = new ApiAuth($db);
    $actor = $apiAuth->requireActor($auth);
    if ($actor['via'] === 'session') {
        if (!$auth->hasRole([ROLE_ADMIN,ROLE_MANAGER,ROLE_CASHIER])) { Response::error('Permisos insuficientes',403); }
    } else {
        $apiAuth->requireScope($actor, 'write');
    }

    $currentUser = $actor;

    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { Response::validationError(['body'=>'JSON inválido']); }

    $register_id = isset($data['register_id']) ? (int)$data['register_id'] : 0;
    $store_id = isset($data['store_id']) ? (int)$data['store_id'] : 0;
    $movement_type = isset($data['movement_type']) ? trim($data['movement_type']) : '';
    $amount = isset($data['amount']) ? (float)$data['amount'] : 0.0;
    $description = isset($data['description']) ? substr(trim($data['description']),0,255) : null;

    $errors = [];
    if (!$register_id && !$store_id) { $errors['register_or_store'] = 'Proporcione register_id o store_id'; }
    if (!in_array($movement_type,['entry','withdrawal'])) { $errors['movement_type'] = 'Debe ser entry o withdrawal'; }
    if ($amount <= 0) { $errors['amount'] = 'Debe ser mayor a 0'; }
    if ($errors) { Response::validationError($errors); }

    $session_store_id = (int)$currentUser['store_id'];

    // Seguridad: si se envía store_id, debe ser el de la sesión
    if ($store_id > 0 && $store_id !== $session_store_id) {
        Response::error('No autorizado para operar cajas de otra tienda', 403);
    }

    // Resolver la caja del movimiento: si viene register_id se valida (existe,
    // es de la tienda y está abierta); si no viene, se usa la única abierta o se
    // pide elegir cuando hay varias. Antes se tomaba la primera abierta sin
    // preguntar, así que el movimiento caía en una caja cualquiera.
    $reg_result = CashRegister::resolve($db, $session_store_id, $register_id);
    if (!$reg_result['ok']) {
        Response::error($reg_result['error'], CashRegister::errorCode($reg_result), [
            'multiple' => $reg_result['multiple'],
            'cajas'    => $reg_result['options'],
        ]);
    }
    $register_id = $reg_result['register_id'];

    $mid = $db->insert('INSERT INTO cash_movements (register_id, user_id, movement_type, amount, description) VALUES (?,?,?,?,?)',[
        $register_id, $currentUser['user_id'], $movement_type, $amount, $description
    ]);

    Response::success(['movement_id'=>$mid,'register_id'=>$register_id,'movement_type'=>$movement_type,'amount'=>$amount],'Movimiento registrado');

} catch (Exception $e) {
    Response::error('Error servidor: '.$e->getMessage(),500);
}
