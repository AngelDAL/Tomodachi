<?php
/**
 * Abrir caja
 * POST /api/cash_register/open_register.php {"store_id":1,"initial_amount":500}
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';

session_start();
if (!isset($_SESSION['user_id'])) { Response::unauthorized(); }
if (!in_array($_SESSION['role'],[ROLE_ADMIN,ROLE_MANAGER,ROLE_CASHIER])) { /* rol no autorizado */ Response::unauthorized(); }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { Response::error('Método no permitido',405); }

try {
    $db = new Database();
    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { Response::validationError(['body'=>'JSON inválido']); }
    $store_id = isset($data['store_id']) ? (int)$data['store_id'] : 0;
    $initial = isset($data['initial_amount']) ? (float)$data['initial_amount'] : 0.0;
    if ($store_id<=0) { Response::validationError(['store_id'=>'Requerido']); }
    if ($initial<0) { Response::validationError(['initial_amount'=>'No negativo']); }

    // Verificar tienda
    $store = $db->selectOne('SELECT store_id FROM stores WHERE store_id = ? AND status = ?',[$store_id,STATUS_ACTIVE]);
    if (!$store) { Response::error('Tienda inválida',404); }

    // Verificar que no haya caja abierta
    $open = $db->selectOne('SELECT register_id FROM cash_registers WHERE store_id = ? AND status = ?',[$store_id,REGISTER_OPEN]);
    if ($open) { Response::error('Ya existe caja abierta',409); }

    $rid = $db->insert('INSERT INTO cash_registers (store_id, user_id, opening_date, initial_amount, status) VALUES (?,?,NOW(),?,?)',[
        $store_id,$_SESSION['user_id'],$initial,REGISTER_OPEN
    ]);

    Response::success(['register_id'=>$rid,'store_id'=>$store_id],'Caja abierta');
} catch (Exception $e) { Response::error('Error servidor: '.$e->getMessage(),500); }
