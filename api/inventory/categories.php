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
require_once '../../includes/Auth.class.php';

$method = $_SERVER['REQUEST_METHOD'];

try {
    $db = new Database();
    $auth = new Auth($db);

    if (!$auth->isLoggedIn()) { Response::unauthorized(); }
    $currentUser = $auth->getCurrentUser();

    $store_id = $currentUser['store_id'];

    switch ($method) {
        case 'GET':
            $categories = $db->select('SELECT category_id, category_name, description, icon_class, created_at FROM categories WHERE store_id = ? ORDER BY category_name ASC', [$store_id]);
            Response::success($categories,'Listado de categorías');
            break;
        case 'POST':
            if (!$auth->hasRole([ROLE_ADMIN,ROLE_MANAGER])) { Response::error('Permisos insuficientes',403); }
            $data = json_decode(file_get_contents('php://input'), true);
            if (!$data) { Response::validationError(['body'=>'JSON inválido']); }
            $name = isset($data['category_name']) ? Validator::sanitizeString($data['category_name']) : '';
            $desc = isset($data['description']) ? Validator::sanitizeString($data['description']) : '';
            $icon = isset($data['icon_class']) ? Validator::sanitizeString($data['icon_class']) : null;

            $errors = [];
            if (!Validator::required($name)) { $errors['category_name']='Requerido'; }
            if ($errors) { Response::validationError($errors); }
            
            $id = $db->insert('INSERT INTO categories (store_id, category_name, description, icon_class, created_at) VALUES (?,?,?,?,NOW())',[$store_id, $name, $desc, $icon]);
            $cat = $db->selectOne('SELECT category_id, category_name, description, icon_class, created_at FROM categories WHERE category_id = ?',[$id]);
            Response::success($cat,'Categoría creada');
            break;
        case 'PUT':
            if (!$auth->hasRole([ROLE_ADMIN,ROLE_MANAGER])) { Response::error('Permisos insuficientes',403); }
            $data = json_decode(file_get_contents('php://input'), true);
            if (!$data) { Response::validationError(['body'=>'JSON inválido']); }
            $id = isset($data['category_id']) ? (int)$data['category_id'] : 0;
            if ($id<=0) { Response::validationError(['category_id'=>'Requerido']); }
            
            // Verificar que pertenezca a la tienda
            $exists = $db->selectOne('SELECT category_id FROM categories WHERE category_id = ? AND store_id = ?',[$id, $store_id]);
            if (!$exists) { Response::notFound('Categoría no existe o no pertenece a su tienda'); }
            
            $fields=[];$params=[];
            if (isset($data['category_name'])) { $fields[]='category_name = ?'; $params[]=Validator::sanitizeString($data['category_name']); }
            if (isset($data['description'])) { $fields[]='description = ?'; $params[]=Validator::sanitizeString($data['description']); }
            if (array_key_exists('icon_class', $data)) { $fields[]='icon_class = ?'; $params[]=$data['icon_class'] ? Validator::sanitizeString($data['icon_class']) : null; }
            if (!$fields) { Response::error('Nada para actualizar',400); }
            $params[]=$id;
            $sql='UPDATE categories SET '.implode(', ',$fields).' WHERE category_id = ?';
            $db->update($sql,$params);
            $cat=$db->selectOne('SELECT category_id, category_name, description, icon_class, created_at FROM categories WHERE category_id = ?',[$id]);
            Response::success($cat,'Categoría actualizada');
            break;
        case 'DELETE':
            if (!$auth->hasRole([ROLE_ADMIN,ROLE_MANAGER])) { Response::error('Permisos insuficientes',403); }
            $data = json_decode(file_get_contents('php://input'), true);
            if (!$data) { Response::validationError(['body'=>'JSON inválido']); }
            $id = isset($data['category_id']) ? (int)$data['category_id'] : 0;
            if ($id<=0) { Response::validationError(['category_id'=>'Requerido']); }
            
            // Verificar que pertenezca a la tienda
            $exists = $db->selectOne('SELECT category_id FROM categories WHERE category_id = ? AND store_id = ?',[$id, $store_id]);
            if (!$exists) { Response::notFound('Categoría no existe o no pertenece a su tienda'); }

            // Desvincular productos (set category_id = NULL)
            $db->update('UPDATE products SET category_id = NULL WHERE category_id = ? AND store_id = ?', [$id, $store_id]);
            
            $deleted = $db->delete('DELETE FROM categories WHERE category_id = ?',[$id]);
            Response::success(['category_id'=>$id],'Categoría eliminada');
            break;
        default:
            Response::error('Método no permitido',405);
    }
} catch (Exception $e) {
    Response::error('Error servidor: '.$e->getMessage(),500);
}
