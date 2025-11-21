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

session_start();
if (!isset($_SESSION['user_id'])) { Response::unauthorized(); }
if (!in_array($_SESSION['role'],[ROLE_ADMIN,ROLE_MANAGER,ROLE_CASHIER])) { Response::unauthorized(); }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { Response::error('Método no permitido',405); }

try {
    $db = new Database();
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

    // Obtener register si se dio store_id
    if (!$register_id) {
        $reg = $db->selectOne('SELECT register_id FROM cash_registers WHERE store_id=? AND status=?',[ $store_id, REGISTER_OPEN ]);
        if (!$reg) { Response::error('No hay caja abierta para la tienda',404); }
        $register_id = (int)$reg['register_id'];
    }

    // Validar que la caja esté abierta
    $register = $db->selectOne('SELECT register_id, status FROM cash_registers WHERE register_id=?',[ $register_id ]);
    if (!$register) { Response::error('Caja no encontrada',404); }
    if ($register['status'] !== REGISTER_OPEN) { Response::error('La caja no está abierta',409); }

    $mid = $db->insert('INSERT INTO cash_movements (register_id, user_id, movement_type, amount, description) VALUES (?,?,?,?,?)',[
        $register_id, $_SESSION['user_id'], $movement_type, $amount, $description
    ]);

    Response::success(['movement_id'=>$mid,'register_id'=>$register_id,'movement_type'=>$movement_type,'amount'=>$amount],'Movimiento registrado');

} catch (Exception $e) {
    Response::error('Error servidor: '.$e->getMessage(),500);
}
