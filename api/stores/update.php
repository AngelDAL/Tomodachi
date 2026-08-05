<?php
/**
 * Actualizar tienda
 * PUT /api/stores/update.php
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';

header('Content-Type: application/json; charset=utf-8');

$db = new Database();
$auth = new Auth($db);
if (!$auth->isLoggedIn()) { Response::unauthorized(); }
if (!$auth->hasRole(ROLE_ADMIN)) { Response::error('Solo admin puede actualizar tiendas',403); }

if ($_SERVER['REQUEST_METHOD'] !== 'PUT') { Response::error('Método no permitido',405); }

try {
    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { Response::validationError(['body'=>'JSON inválido']); }

    $store_id = isset($data['store_id']) ? (int)$data['store_id'] : 0;
    if ($store_id <= 0) { Response::validationError(['store_id'=>'Requerido']); }

    // Seguridad: el admin solo puede actualizar su propia tienda
    $currentUser = $auth->getCurrentUser();
    $session_store_id = isset($currentUser['store_id']) ? (int)$currentUser['store_id'] : 0;
    if ($store_id !== $session_store_id) {
        Response::error('No autorizado para actualizar otra tienda', 403);
    }

    $store = $db->selectOne('SELECT store_id FROM stores WHERE store_id = ?',[$store_id]);
    if (!$store) { Response::notFound('Tienda no existe'); }

    $fields = [];$params=[];
    if (isset($data['store_name'])) { $fields[]='store_name = ?'; $params[] = Validator::sanitizeString($data['store_name']); }
    if (isset($data['address'])) { $fields[]='address = ?'; $params[] = Validator::sanitizeString($data['address']); }
    if (isset($data['phone'])) { $fields[]='phone = ?'; $params[] = Validator::sanitizeString($data['phone']); }
    if (isset($data['status'])) { if (!in_array($data['status'],[STATUS_ACTIVE,STATUS_INACTIVE])) { Response::validationError(['status'=>'Estado inválido']); } $fields[]='status = ?'; $params[]=$data['status']; }

    if (!$fields) { Response::error('Nada para actualizar',400); }

    $params[] = $store_id;
    $sql = 'UPDATE stores SET '.implode(', ',$fields).', updated_at = NOW() WHERE store_id = ?';
    $db->update($sql,$params);

    $updated = $db->selectOne('SELECT store_id, store_name, address, phone, status FROM stores WHERE store_id = ?',[$store_id]);
    Response::success($updated,'Tienda actualizada');
} catch (Exception $e) { Response::error('Error servidor: '.$e->getMessage(),500); }
