<?php
/**
 * Eliminar usuario (soft: cambiar estado a inactive)
 * DELETE /api/users/delete.php
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, DELETE');

$db = new Database();
$auth = new Auth($db);

if (!$auth->isLoggedIn()) { Response::unauthorized(); }
if (!$auth->hasRole([ROLE_ADMIN])) { Response::error('Solo admin puede eliminar',403); }

if ($_SERVER['REQUEST_METHOD'] !== 'POST' && $_SERVER['REQUEST_METHOD'] !== 'DELETE') { Response::error('Método no permitido',405); }

try {
    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { Response::validationError(['body'=>'JSON inválido']); }
    $user_id = isset($data['user_id']) ? (int)$data['user_id'] : 0;
    if ($user_id <= 0) { Response::validationError(['user_id'=>'Requerido']); }
    
    $currentUser = $auth->getCurrentUser();
    if ($user_id == $currentUser['user_id']) { Response::error('No puede eliminarse a sí mismo',400); }

    // Verificar que el usuario a eliminar pertenezca a la misma tienda
    $user = $db->selectOne('SELECT user_id, store_id FROM users WHERE user_id = ?',[$user_id]);
    if (!$user) { Response::notFound('Usuario no existe'); }
    
    if ($user['store_id'] != $currentUser['store_id']) {
        Response::error('No tiene permiso para eliminar usuarios de otra tienda', 403);
    }

    $db->update('UPDATE users SET status = ? WHERE user_id = ?',[STATUS_INACTIVE,$user_id]);
    Response::success(['user_id'=>$user_id],'Usuario desactivado');
} catch (Exception $e) {
    Response::error('Error servidor: '.$e->getMessage(),500);
}
