<?php
/**
 * Crear tienda
 * POST /api/stores/create.php
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';

header('Content-Type: application/json; charset=utf-8');

session_start();
if (!isset($_SESSION['user_id'])) { Response::unauthorized(); }
if ($_SESSION['role'] !== ROLE_ADMIN) { Response::error('Solo admin puede crear tiendas',403); }

if ($_SERVER['REQUEST_METHOD'] !== 'POST') { Response::error('Método no permitido',405); }

try {
    $db = new Database();
    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { Response::validationError(['body'=>'JSON inválido']); }

    $store_name = isset($data['store_name']) ? Validator::sanitizeString($data['store_name']) : '';
    $address = isset($data['address']) ? Validator::sanitizeString($data['address']) : '';
    $phone = isset($data['phone']) ? Validator::sanitizeString($data['phone']) : '';

    $errors = [];
    if (!Validator::required($store_name)) { $errors['store_name']='Requerido'; }
    if ($phone && !Validator::validateLength($phone,0,20)) { $errors['phone']='Teléfono demasiado largo'; }

    if ($errors) { Response::validationError($errors); }

    $id = $db->insert('INSERT INTO stores (store_name,address,phone,status,created_at) VALUES (?,?,?,?,NOW())',[
        $store_name,$address,$phone,STATUS_ACTIVE
    ]);

    $store = $db->selectOne('SELECT store_id, store_name, address, phone, status FROM stores WHERE store_id = ?',[$id]);
    Response::success($store,'Tienda creada');
} catch (Exception $e) { Response::error('Error servidor: '.$e->getMessage(),500); }
