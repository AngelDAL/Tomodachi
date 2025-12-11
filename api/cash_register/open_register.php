<?php
/**
 * Abrir caja
 * POST /api/cash_register/open_register.php {"store_id":1,"initial_amount":500}
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
    if (!$auth->hasRole([ROLE_ADMIN,ROLE_MANAGER,ROLE_CASHIER])) { Response::error('Permisos insuficientes',403); }

    $currentUser = $auth->getCurrentUser();

    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { Response::validationError(['body'=>'JSON inválido']); }
    $store_id = isset($data['store_id']) ? (int)$data['store_id'] : 0;
    $initial = isset($data['initial_amount']) ? (float)$data['initial_amount'] : 0.0;
    $terminal_id = isset($data['terminal_id']) ? (int)$data['terminal_id'] : 0;

    if ($store_id<=0) { Response::validationError(['store_id'=>'Requerido']); }
    if ($initial<0) { Response::validationError(['initial_amount'=>'No negativo']); }

    // Verificar tienda
    $store = $db->selectOne('SELECT store_id FROM stores WHERE store_id = ? AND status = ?',[$store_id,STATUS_ACTIVE]);
    if (!$store) { Response::error('Tienda inválida',404); }

    // Si no se envió terminal_id, intentar asignar la principal o única
    if ($terminal_id <= 0) {
        $terminals = $db->select('SELECT terminal_id FROM terminals WHERE store_id = ? AND status = "active"', [$store_id]);
        if (count($terminals) === 1) {
            $terminal_id = $terminals[0]['terminal_id'];
        } else if (count($terminals) > 1) {
            Response::validationError(['terminal_id' => 'Debe seleccionar una terminal']);
        } else {
            // No hay terminales, crear una por defecto (fallback)
            $terminal_id = $db->insert('INSERT INTO terminals (store_id, terminal_name) VALUES (?, ?)', [$store_id, 'Caja Principal']);
        }
    } else {
        // Verificar que la terminal exista y sea de la tienda
        $term = $db->selectOne('SELECT terminal_id FROM terminals WHERE terminal_id = ? AND store_id = ? AND status = "active"', [$terminal_id, $store_id]);
        if (!$term) { Response::error('Terminal inválida', 404); }
    }

    // Verificar que no haya caja abierta EN ESTA TERMINAL
    $open = $db->selectOne('SELECT register_id FROM cash_registers WHERE terminal_id = ? AND status = ?',[$terminal_id,REGISTER_OPEN]);
    if ($open) { Response::error('Esta terminal ya tiene una caja abierta',409); }

    $rid = $db->insert('INSERT INTO cash_registers (store_id, terminal_id, user_id, opening_date, initial_amount, status) VALUES (?,?,?,NOW(),?,?)',[
        $store_id,$terminal_id,$currentUser['user_id'],$initial,REGISTER_OPEN
    ]);

    Response::success(['register_id'=>$rid,'store_id'=>$store_id, 'terminal_id'=>$terminal_id],'Caja abierta');
} catch (Exception $e) { Response::error('Error servidor: '.$e->getMessage(),500); }
