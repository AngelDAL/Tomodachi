<?php
/**
 * Categorías API multipropósito
 * GET    /api/inventory/categories.php            (listar)
 * POST   /api/inventory/categories.php            (crear)
 * PUT    /api/inventory/categories.php            (actualizar)
 * DELETE /api/inventory/categories.php            (eliminar si no tiene productos)
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';

session_start();
if (!isset($_SESSION['user_id'])) { Response::unauthorized(); }

$method = $_SERVER['REQUEST_METHOD'];

try {
    $db = new Database();

    switch ($method) {
        case 'GET':
            $categories = $db->select('SELECT category_id, category_name, description, created_at FROM categories ORDER BY category_name ASC');
            Response::success($categories,'Listado de categorías');
            break;
        case 'POST':
            if (!in_array($_SESSION['role'],[ROLE_ADMIN,ROLE_MANAGER])) { Response::error('Permisos insuficientes',403); }
            $data = json_decode(file_get_contents('php://input'), true);
            if (!$data) { Response::validationError(['body'=>'JSON inválido']); }
            $name = isset($data['category_name']) ? Validator::sanitizeString($data['category_name']) : '';
            $desc = isset($data['description']) ? Validator::sanitizeString($data['description']) : '';
            $errors = [];
            if (!Validator::required($name)) { $errors['category_name']='Requerido'; }
            if ($errors) { Response::validationError($errors); }
            $id = $db->insert('INSERT INTO categories (category_name, description, created_at) VALUES (?,?,NOW())',[$name,$desc]);
            $cat = $db->selectOne('SELECT category_id, category_name, description, created_at FROM categories WHERE category_id = ?',[$id]);
            Response::success($cat,'Categoría creada');
            break;
        case 'PUT':
            if (!in_array($_SESSION['role'],[ROLE_ADMIN,ROLE_MANAGER])) { Response::error('Permisos insuficientes',403); }
            $data = json_decode(file_get_contents('php://input'), true);
            if (!$data) { Response::validationError(['body'=>'JSON inválido']); }
            $id = isset($data['category_id']) ? (int)$data['category_id'] : 0;
            if ($id<=0) { Response::validationError(['category_id'=>'Requerido']); }
            $exists = $db->selectOne('SELECT category_id FROM categories WHERE category_id = ?',[$id]);
            if (!$exists) { Response::notFound('Categoría no existe'); }
            $fields=[];$params=[];
            if (isset($data['category_name'])) { $fields[]='category_name = ?'; $params[]=Validator::sanitizeString($data['category_name']); }
            if (isset($data['description'])) { $fields[]='description = ?'; $params[]=Validator::sanitizeString($data['description']); }
            if (!$fields) { Response::error('Nada para actualizar',400); }
            $params[]=$id;
            $sql='UPDATE categories SET '.implode(', ',$fields).' WHERE category_id = ?';
            $db->update($sql,$params);
            $cat=$db->selectOne('SELECT category_id, category_name, description, created_at FROM categories WHERE category_id = ?',[$id]);
            Response::success($cat,'Categoría actualizada');
            break;
        case 'DELETE':
            if (!in_array($_SESSION['role'],[ROLE_ADMIN,ROLE_MANAGER])) { Response::error('Permisos insuficientes',403); }
            $data = json_decode(file_get_contents('php://input'), true);
            if (!$data) { Response::validationError(['body'=>'JSON inválido']); }
            $id = isset($data['category_id']) ? (int)$data['category_id'] : 0;
            if ($id<=0) { Response::validationError(['category_id'=>'Requerido']); }
            $used = $db->selectOne('SELECT product_id FROM products WHERE category_id = ? LIMIT 1',[$id]);
            if ($used) { Response::error('La categoría tiene productos asociados',409); }
            $deleted = $db->delete('DELETE FROM categories WHERE category_id = ?',[$id]);
            if ($deleted===0) { Response::notFound('Categoría no existe'); }
            Response::success(['category_id'=>$id],'Categoría eliminada');
            break;
        default:
            Response::error('Método no permitido',405);
    }
} catch (Exception $e) {
    Response::error('Error servidor: '.$e->getMessage(),500);
}
