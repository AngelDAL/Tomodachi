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
header('Access-Control-Allow-Methods: DELETE');

session_start();
if (!isset($_SESSION['user_id'])) { Response::unauthorized(); }
if ($_SESSION['role'] !== ROLE_ADMIN) { Response::error('Solo admin puede eliminar',403); }

if ($_SERVER['REQUEST_METHOD'] !== 'DELETE') { Response::error('Método no permitido',405); }

try {
    $db = new Database();
    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { Response::validationError(['body'=>'JSON inválido']); }
    $user_id = isset($data['user_id']) ? (int)$data['user_id'] : 0;
    if ($user_id <= 0) { Response::validationError(['user_id'=>'Requerido']); }
    if ($user_id == $_SESSION['user_id']) { Response::error('No puede eliminarse a sí mismo',400); }

    $user = $db->selectOne('SELECT user_id FROM users WHERE user_id = ?',[$user_id]);
    if (!$user) { Response::notFound('Usuario no existe'); }

    $db->update('UPDATE users SET status = ? WHERE user_id = ?',[STATUS_INACTIVE,$user_id]);
    Response::success(['user_id'=>$user_id],'Usuario desactivado');
} catch (Exception $e) {
    Response::error('Error servidor: '.$e->getMessage(),500);
}
