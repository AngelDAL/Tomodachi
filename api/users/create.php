<?php
/**
 * Crear usuario
 * POST /api/users/create.php
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST');

session_start();
if (!isset($_SESSION['user_id'])) { Response::unauthorized(); }
if ($_SESSION['role'] !== ROLE_ADMIN && $_SESSION['role'] !== ROLE_MANAGER) { Response::error('Permisos insuficientes',403); }

if ($_SERVER['REQUEST_METHOD'] !== 'POST') { Response::error('Método no permitido',405); }

try {
    $db = new Database();
    $auth = new Auth($db);
    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { Response::validationError(['body'=>'JSON inválido']); }

    $errors = [];
    $username = isset($data['username']) ? Validator::sanitizeString($data['username']) : '';
    $password = isset($data['password']) ? $data['password'] : '';
    $full_name = isset($data['full_name']) ? Validator::sanitizeString($data['full_name']) : '';
    $email = isset($data['email']) ? Validator::sanitizeString($data['email']) : '';
    $role = isset($data['role']) ? Validator::sanitizeString($data['role']) : '';
    $store_id = isset($data['store_id']) ? (int)$data['store_id'] : 0;

    if (!Validator::required($username)) { $errors['username']='Requerido'; }
    if (!Validator::required($password)) { $errors['password']='Requerido'; }
    if (!Validator::required($full_name)) { $errors['full_name']='Requerido'; }
    if ($email && !Validator::validateEmail($email)) { $errors['email']='Email inválido'; }
    if (!in_array($role,[ROLE_ADMIN,ROLE_MANAGER,ROLE_CASHIER])) { $errors['role']='Rol inválido'; }
    if ($store_id <= 0) { $errors['store_id']='Store inválida'; }

    if ($errors) { Response::validationError($errors); }

    // Verificar usuario existente
    $exists = $db->selectOne('SELECT user_id FROM users WHERE username = ?',[$username]);
    if ($exists) { Response::error('Usuario ya existe',409); }

    // Verificar store
    $store = $db->selectOne('SELECT store_id FROM stores WHERE store_id = ? AND status = ?',[$store_id,STATUS_ACTIVE]);
    if (!$store) { Response::error('Tienda no encontrada',404); }

    $hash = Auth::hashPassword($password);

    $sql = 'INSERT INTO users (store_id, username, password_hash, full_name, email, role, status, created_at) VALUES (?,?,?,?,?,?,?,NOW())';
    $id = $db->insert($sql,[$store_id,$username,$hash,$full_name,$email,$role,STATUS_ACTIVE]);

    $user = $db->selectOne('SELECT user_id, username, full_name, email, role, store_id, status FROM users WHERE user_id = ?',[ $id ]);
    Response::success($user,'Usuario creado');
} catch (Exception $e) {
    Response::error('Error servidor: '.$e->getMessage(),500);
}
