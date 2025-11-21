<?php
/**
 * Productos API
 * GET  /api/inventory/products.php?store_id=1&search=texto
 * POST /api/inventory/products.php
 * PUT  /api/inventory/products.php
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
            $store_id = isset($_GET['store_id']) ? (int)$_GET['store_id'] : 0;
            $search = isset($_GET['search']) ? trim($_GET['search']) : '';
            $params=[];
            $sql = 'SELECT p.product_id, p.product_name, p.description, p.barcode, p.qr_code, p.price, p.cost, p.min_stock, p.status, p.category_id, c.category_name';
            if ($store_id>0) {
                $sql .= ', i.current_stock';
            }
            $sql .= ' FROM products p LEFT JOIN categories c ON p.category_id = c.category_id';
            if ($store_id>0) { $sql .= ' LEFT JOIN inventory i ON i.product_id = p.product_id AND i.store_id = ?'; $params[]=$store_id; }
            $conditions=[];
            if ($search !== '') {
                $conditions[]='(p.product_name LIKE ? OR p.barcode LIKE ? OR p.qr_code LIKE ?)';
                $params[]='%'.$search.'%';
                $params[]='%'.$search+'%';
                $params[]='%'.$search+'%';
            }
            if ($conditions) { $sql .= ' WHERE '.implode(' AND ',$conditions); }
            $sql .= ' ORDER BY p.product_name ASC LIMIT 200';
            $products = $db->select($sql,$params);
            Response::success($products,'Listado productos');
            break;
        case 'POST':
            if (!in_array($_SESSION['role'],[ROLE_ADMIN,ROLE_MANAGER])) { Response::error('Permisos insuficientes',403); }
            $data=json_decode(file_get_contents('php://input'),true);
            if(!$data){ Response::validationError(['body'=>'JSON inválido']); }
            $errors=[];
            $product_name=isset($data['product_name'])?Validator::sanitizeString($data['product_name']):'';
            $category_id=isset($data['category_id'])?(int)$data['category_id']:null;
            $barcode=isset($data['barcode'])?Validator::sanitizeString($data['barcode']):'';
            $qr_code=isset($data['qr_code'])?Validator::sanitizeString($data['qr_code']):'';
            $price=isset($data['price'])?$data['price']:null;
            $cost=isset($data['cost'])?$data['cost']:0;
            $min_stock=isset($data['min_stock'])?(int)$data['min_stock']:0;
            $description=isset($data['description'])?Validator::sanitizeString($data['description']):'';
            if(!Validator::required($product_name)){$errors['product_name']='Requerido';}
            if($category_id && !$db->selectOne('SELECT category_id FROM categories WHERE category_id = ?',[$category_id])){$errors['category_id']='No existe';}
            if($barcode && $db->selectOne('SELECT product_id FROM products WHERE barcode = ?',[$barcode])){$errors['barcode']='Duplicado';}
            if($qr_code && $db->selectOne('SELECT product_id FROM products WHERE qr_code = ?',[$qr_code])){$errors['qr_code']='Duplicado';}
            if(!Validator::validatePrice($price)){$errors['price']='Precio inválido';}
            if(!Validator::validatePrice($cost)){$errors['cost']='Costo inválido';}
            if($errors){ Response::validationError($errors); }
            $id=$db->insert('INSERT INTO products (category_id, product_name, description, barcode, qr_code, price, cost, min_stock, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,NOW(),NOW())',[
                $category_id,$product_name,$description,$barcode,$qr_code,$price,$cost,$min_stock,STATUS_ACTIVE
            ]);
            $product=$db->selectOne('SELECT product_id, product_name, barcode, qr_code, price, cost, min_stock, status FROM products WHERE product_id = ?',[$id]);
            Response::success($product,'Producto creado');
            break;
        case 'PUT':
            if (!in_array($_SESSION['role'],[ROLE_ADMIN,ROLE_MANAGER])) { Response::error('Permisos insuficientes',403); }
            $data=json_decode(file_get_contents('php://input'),true);
            if(!$data){ Response::validationError(['body'=>'JSON inválido']); }
            $product_id=isset($data['product_id'])?(int)$data['product_id']:0;
            if($product_id<=0){ Response::validationError(['product_id'=>'Requerido']); }
            $exists=$db->selectOne('SELECT product_id FROM products WHERE product_id = ?',[$product_id]);
            if(!$exists){ Response::notFound('Producto no existe'); }
            $fields=[];$params=[];
            if(isset($data['product_name'])){ $fields[]='product_name = ?'; $params[]=Validator::sanitizeString($data['product_name']); }
            if(isset($data['description'])){ $fields[]='description = ?'; $params[]=Validator::sanitizeString($data['description']); }
            if(isset($data['barcode'])){ $barcode=Validator::sanitizeString($data['barcode']); if($barcode && $db->selectOne('SELECT product_id FROM products WHERE barcode = ? AND product_id <> ?',[$barcode,$product_id])){ Response::validationError(['barcode'=>'Duplicado']); } $fields[]='barcode = ?'; $params[]=$barcode; }
            if(isset($data['qr_code'])){ $qr=Validator::sanitizeString($data['qr_code']); if($qr && $db->selectOne('SELECT product_id FROM products WHERE qr_code = ? AND product_id <> ?',[$qr,$product_id])){ Response::validationError(['qr_code'=>'Duplicado']); } $fields[]='qr_code = ?'; $params[]=$qr; }
            if(isset($data['price'])){ if(!Validator::validatePrice($data['price'])){ Response::validationError(['price'=>'Inválido']); } $fields[]='price = ?'; $params[]=$data['price']; }
            if(isset($data['cost'])){ if(!Validator::validatePrice($data['cost'])){ Response::validationError(['cost'=>'Inválido']); } $fields[]='cost = ?'; $params[]=$data['cost']; }
            if(isset($data['min_stock'])){ $fields[]='min_stock = ?'; $params[]=(int)$data['min_stock']; }
            if(isset($data['status'])){ if(!in_array($data['status'],[STATUS_ACTIVE,STATUS_INACTIVE])){ Response::validationError(['status'=>'Inválido']); } $fields[]='status = ?'; $params[]=$data['status']; }
            if(isset($data['category_id'])){ $cid=(int)$data['category_id']; if($cid && !$db->selectOne('SELECT category_id FROM categories WHERE category_id = ?',[$cid])){ Response::validationError(['category_id'=>'No existe']); } $fields[]='category_id = ?'; $params[]=$cid; }
            if(!$fields){ Response::error('Nada para actualizar',400); }
            $fields[]='updated_at = NOW()';
            $params[]=$product_id;
            $sql='UPDATE products SET '.implode(', ',$fields).' WHERE product_id = ?';
            $db->update($sql,$params);
            $product=$db->selectOne('SELECT product_id, product_name, barcode, qr_code, price, cost, min_stock, status FROM products WHERE product_id = ?',[$product_id]);
            Response::success($product,'Producto actualizado');
            break;
        default:
            Response::error('Método no permitido',405);
    }
} catch (Exception $e) {
    Response::error('Error servidor: '.$e->getMessage(),500);
}
