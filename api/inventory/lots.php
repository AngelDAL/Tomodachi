<?php
/**
 * Presentaciones API — gestiona los lotes/presentaciones de un componente.
 *
 * GET    /api/inventory/lots.php?product_id=N
 * POST   /api/inventory/lots.php  { product_id, label, quantity, total_cost }
 *        Crea una presentación (costo unitario = total_cost / quantity).
 * PUT    /api/inventory/lots.php  { lot_id, label?, quantity?, total_cost? | unit_cost? }
 * DELETE /api/inventory/lots.php  { lot_id }
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';

$method = $_SERVER['REQUEST_METHOD'];

try {
    $db = new Database();
    $auth = new Auth($db);
    $apiAuth = new ApiAuth($db);
    $actor = $apiAuth->requireActor($auth);
    $currentUser = $actor;
    $store_id = (int)$currentUser['store_id'];

    // READ: cualquier autenticado
    if ($method === 'GET') {
        $apiAuth->requireScope($actor, 'read');
        $product_id = isset($_GET['product_id']) ? (int)$_GET['product_id'] : 0;
        if ($product_id <= 0) { Response::validationError(['product_id' => 'Requerido']); }
        $p = $db->selectOne('SELECT product_id FROM products WHERE product_id=? AND store_id=?', [$product_id, $store_id]);
        if (!$p) { Response::notFound('Producto no existe en su tienda'); }
        $lots = $db->select(
            'SELECT lot_id, label, quantity, unit_cost, created_at FROM product_lots
             WHERE product_id=? AND store_id=? ORDER BY lot_id ASC',
            [$product_id, $store_id]
        );
        $total = 0.0; $weighted = 0.0;
        foreach ($lots as &$L) { $L['quantity'] = (float)$L['quantity']; $L['unit_cost'] = (float)$L['unit_cost'];
            $total += $L['quantity']; $weighted += $L['quantity'] * $L['unit_cost']; }
        unset($L);
        Response::success([
            'lots' => $lots,
            'total' => $total,
            'unit_cost' => ($total > 0) ? round($weighted / $total, 4) : 0,
        ], 'Presentaciones del componente');
    }

    // WRITE: admin/manager (sesión) o token con scope write
    if (in_array($method, ['POST', 'PUT', 'DELETE'], true)) {
        if ($currentUser['via'] === 'session') {
            if (!$auth->hasRole([ROLE_ADMIN, ROLE_MANAGER])) { Response::error('Permisos insuficientes', 403); }
        } else {
            $apiAuth->requireScope($actor, 'write');
        }
        $data = json_decode(file_get_contents('php://input'), true);
        if (!$data) { Response::validationError(['body' => 'JSON inválido']); }

        if ($method === 'POST') {
            $product_id = isset($data['product_id']) ? (int)$data['product_id'] : 0;
            $label = isset($data['label']) ? Validator::sanitizeString($data['label']) : '';
            $quantity = isset($data['quantity']) ? (float)$data['quantity'] : 0;
            if ($product_id <= 0) { Response::validationError(['product_id' => 'Requerido']); }
            if ($quantity <= 0) { Response::validationError(['quantity' => 'Cantidad debe ser mayor a 0']); }
            $p = $db->selectOne('SELECT product_id FROM products WHERE product_id=? AND store_id=?', [$product_id, $store_id]);
            if (!$p) { Response::notFound('Producto no existe en su tienda'); }
            // Se acepta unit_cost directo O total_cost (valor pagado por todo el lote).
            if (isset($data['unit_cost']) && is_numeric($data['unit_cost'])) {
                $unit_cost = (float)$data['unit_cost'];
            } else {
                $total_cost = isset($data['total_cost']) ? (float)$data['total_cost'] : 0;
                $unit_cost = $total_cost / $quantity;
            }
            $db->insert(
                'INSERT INTO product_lots (store_id, product_id, label, quantity, unit_cost) VALUES (?,?,?,?,?)',
                [$store_id, $product_id, $label !== '' ? $label : null, $quantity, $unit_cost]
            );
            Response::success([], 'Presentación registrada');
        }

        if ($method === 'PUT') {
            $lot_id = isset($data['lot_id']) ? (int)$data['lot_id'] : 0;
            if ($lot_id <= 0) { Response::validationError(['lot_id' => 'Requerido']); }
            $lot = $db->selectOne('SELECT lot_id FROM product_lots WHERE lot_id=? AND store_id=?', [$lot_id, $store_id]);
            if (!$lot) { Response::notFound('Presentación no existe'); }
            $fields = []; $params = [];
            if (isset($data['label'])) { $v = Validator::sanitizeString($data['label']); $fields[]='label=?'; $params[]= $v !== '' ? $v : null; }
            if (isset($data['quantity'])) { $fields[]='quantity=?'; $params[]=(float)$data['quantity']; }
            if (isset($data['unit_cost']) && is_numeric($data['unit_cost'])) { $fields[]='unit_cost=?'; $params[]=(float)$data['unit_cost']; }
            elseif (isset($data['total_cost']) && is_numeric($data['total_cost'])) {
                $qty = isset($data['quantity']) ? (float)$data['quantity'] : (float)$db->selectOne('SELECT quantity FROM product_lots WHERE lot_id=?', [$lot_id])['quantity'];
                if ($qty > 0) { $fields[]='unit_cost=?'; $params[]=(float)$data['total_cost']/$qty; }
            }
            if (!$fields) { Response::error('Nada para actualizar', 400); }
            $db->update('UPDATE product_lots SET '.implode(', ', $fields).' WHERE lot_id=? AND store_id=?', array_merge($params, [$lot_id, $store_id]));
            Response::success([], 'Presentación actualizada');
        }

        if ($method === 'DELETE') {
            $lot_id = isset($data['lot_id']) ? (int)$data['lot_id'] : 0;
            if ($lot_id <= 0) { Response::validationError(['lot_id' => 'Requerido']); }
            $db->delete('DELETE FROM product_lots WHERE lot_id=? AND store_id=?', [$lot_id, $store_id]);
            Response::success([], 'Presentación eliminada');
        }
        exit;
    }

    Response::error('Método no permitido', 405);
} catch (Exception $e) {
    Response::error('Error servidor: ' . $e->getMessage(), 500);
}