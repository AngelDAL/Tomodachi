<?php
/**
 * Cerrar caja
 * POST /api/cash_register/close_register.php {"register_id":10, "counted_amount":1520.50, "notes":"Cierre sin incidencias"}
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
    $counted_amount = isset($data['counted_amount']) ? (float)$data['counted_amount'] : null;
    $notes = isset($data['notes']) ? substr(trim($data['notes']),0,255) : null;

    $errors = [];
    if ($register_id <= 0) { $errors['register_id'] = 'Requerido'; }
    if ($counted_amount === null || $counted_amount < 0) { $errors['counted_amount'] = 'Monto contado inválido'; }
    if ($errors) { Response::validationError($errors); }

    $register = $db->selectOne('SELECT register_id, initial_amount, status FROM cash_registers WHERE register_id=?',[ $register_id ]);
    if (!$register) { Response::error('Caja no encontrada',404); }
    if ($register['status'] !== REGISTER_OPEN) { Response::error('La caja ya está cerrada',409); }

    // Calcular expected
    $row = $db->selectOne('SELECT 
        COALESCE(SUM(CASE WHEN movement_type="entry" THEN amount WHEN movement_type="withdrawal" THEN -amount ELSE 0 END),0) AS manual_total,
        COALESCE(SUM(CASE WHEN movement_type="sale" THEN amount ELSE 0 END),0) AS sales_total
        FROM cash_movements WHERE register_id=?',[ $register_id ]);
    $manual_total = (float)$row['manual_total'];
    $sales_total = (float)$row['sales_total'];
    $expected = (float)$register['initial_amount'] + $manual_total + $sales_total;
    $difference = $counted_amount - $expected;

    $db->update('UPDATE cash_registers SET closing_date=NOW(), final_amount=?, expected_amount=?, difference=?, status=?, notes=? WHERE register_id=?',[
        $counted_amount,$expected,$difference,REGISTER_CLOSED,$notes,$register_id
    ]);

    Response::success([
        'register_id'=>$register_id,
        'expected_amount'=>$expected,
        'counted_amount'=>$counted_amount,
        'difference'=>$difference
    ],'Caja cerrada');

} catch (Exception $e) {
    Response::error('Error servidor: '.$e->getMessage(),500);
}
