<?php
/**
 * Caja abierta actual (por store o register)
 * GET /api/cash_register/current_register.php?store_id=1
 * GET /api/cash_register/current_register.php?register_id=10
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';

session_start();
if (!isset($_SESSION['user_id'])) { Response::unauthorized(); }
if (!in_array($_SESSION['role'],[ROLE_ADMIN,ROLE_MANAGER,ROLE_CASHIER])) { Response::unauthorized(); }
if ($_SERVER['REQUEST_METHOD'] !== 'GET') { Response::error('Método no permitido',405); }

try {
    $db = new Database();
    $register_id = isset($_GET['register_id']) ? (int)$_GET['register_id'] : 0;
    $store_id = isset($_GET['store_id']) ? (int)$_GET['store_id'] : 0;

    if (!$register_id && !$store_id) { Response::validationError(['params'=>'Proporcione store_id o register_id']); }

    if (!$register_id) {
        $reg = $db->selectOne('SELECT * FROM cash_registers WHERE store_id=? AND status=?',[ $store_id, REGISTER_OPEN ]);
        if (!$reg) { Response::error('No hay caja abierta',404); }
        $register_id = (int)$reg['register_id'];
        $register = $reg;
    } else {
        $register = $db->selectOne('SELECT * FROM cash_registers WHERE register_id=?',[ $register_id ]);
        if (!$register) { Response::error('Caja no encontrada',404); }
        if ($register['status'] !== REGISTER_OPEN) { Response::error('La caja no está abierta',409); }
    }

    $movs = $db->selectOne('SELECT 
        COALESCE(SUM(CASE WHEN movement_type="entry" THEN amount ELSE 0 END),0) AS total_entries,
        COALESCE(SUM(CASE WHEN movement_type="withdrawal" THEN amount ELSE 0 END),0) AS total_withdrawals,
        COALESCE(SUM(CASE WHEN movement_type="sale" THEN amount ELSE 0 END),0) AS total_sales
        FROM cash_movements WHERE register_id=?',[ $register_id ]);

    $expected = (float)$register['initial_amount'] + (float)$movs['total_entries'] - (float)$movs['total_withdrawals'] + (float)$movs['total_sales'];

    Response::success([
        'register'=>[
            'register_id'=>$register['register_id'],
            'store_id'=>$register['store_id'],
            'opening_date'=>$register['opening_date'],
            'initial_amount'=>$register['initial_amount'],
            'status'=>$register['status']
        ],
        'totals'=>[
            'entries'=>(float)$movs['total_entries'],
            'withdrawals'=>(float)$movs['total_withdrawals'],
            'sales'=>(float)$movs['total_sales'],
            'expected_amount'=>$expected
        ]
    ],'Caja abierta');

} catch (Exception $e) {
    Response::error('Error servidor: '.$e->getMessage(),500);
}
