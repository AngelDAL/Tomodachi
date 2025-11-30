<?php
/**
 * Listar usuarios por tienda o todos (admin)
 * GET /api/users/read.php?store_id=1
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET');

try {
    $db = new Database();
    $auth = new Auth($db);

    if (!$auth->isLoggedIn()) { Response::unauthorized(); }
    $currentUser = $auth->getCurrentUser();

    $store_id = isset($_GET['store_id']) ? (int)$_GET['store_id'] : 0;

    if ($store_id > 0) {
        // Validar acceso: si no es admin debe coincidir con su store
        if ($currentUser['role'] !== ROLE_ADMIN && $currentUser['store_id'] != $store_id) {
            Response::error('Acceso restringido',403);
        }
        $users = $db->select('SELECT user_id, username, full_name, email, role, store_id, status FROM users WHERE store_id = ?',[$store_id]);
    } else {
        if ($currentUser['role'] !== ROLE_ADMIN) { Response::error('Solo admin puede ver todos',403); }
        $users = $db->select('SELECT user_id, username, full_name, email, role, store_id, status FROM users',[]);
    }

    Response::success($users,'Listado usuarios');
} catch (Exception $e) {
    Response::error('Error servidor: '.$e->getMessage(),500);
}
