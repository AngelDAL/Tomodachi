<?php
/**
 * API de clientes (CRUD + abonos al apartado)
 *
 * GET  /api/customers/customers.php          → listar (opcional ?search=)
 * GET  /api/customers/customers.php?id=5     → detalle + historial ventas
 * POST /api/customers/customers.php          → crear   {full_name, phone?, email?, address?, credit_limit?, notes?}
 * PUT  /api/customers/customers.php          → editar  {customer_id, ...}
 * DELETE /api/customers/customers.php        → eliminar {customer_id}
 *
 * POST /api/customers/payments.php           → abonar al apartado {customer_id, amount, payment_method?, notes?}
 *
 * Auth: sesión admin/manager/cashier o token con scope write (crear/editar/abonar) / read (listar).
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';

$db = new Database();
$auth = new Auth($db);
$apiAuth = new ApiAuth($db);
$actor = $apiAuth->requireActor($auth);
$currentUser = $actor;
$store_id = (int)$currentUser['store_id'];

$method = $_SERVER['REQUEST_METHOD'];

try {
    if ($method === 'GET') {
        $apiAuth->requireScope($actor, 'read');

        $id = isset($_GET['id']) ? (int)$_GET['id'] : 0;
        if ($id > 0) {
            // Detalle + historial de ventas + abonos
            $customer = $db->selectOne('SELECT c.*, (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.customer_id AND s.status = "completed") as total_purchases FROM customers c WHERE c.customer_id = ? AND c.store_id = ?', [$id, $store_id]);
            if (!$customer) { Response::notFound('Cliente no existe'); }
            $customer['balance'] = (float)$customer['balance'];

            $sales = $db->select('SELECT sale_id, sale_date, total, amount_paid, payment_method, status FROM sales WHERE customer_id = ? AND store_id = ? ORDER BY sale_date DESC LIMIT 20', [$id, $store_id]);
            $payments = $db->select('SELECT payment_id, amount, payment_method, notes, created_at FROM customer_payments WHERE customer_id = ? AND store_id = ? ORDER BY created_at DESC LIMIT 20', [$id, $store_id]);

            Response::success([
                'customer' => $customer,
                'sales' => $sales,
                'payments' => $payments
            ], 'Detalle de cliente');
        }

        // Listar con búsqueda opcional y filtros
        $search = isset($_GET['search']) ? Validator::sanitizeString($_GET['search']) : '';
        $statusFilter = isset($_GET['status']) ? Validator::sanitizeString($_GET['status']) : '';
        $balanceFilter = isset($_GET['balance']) ? Validator::sanitizeString($_GET['balance']) : ''; // 'with_balance' | 'no_balance'
        $params = [$store_id];
        $sql = 'SELECT customer_id, full_name, phone, email, balance, credit_limit, status, created_at FROM customers WHERE store_id = ?';
        if ($search !== '') {
            $sql .= ' AND (full_name LIKE ? OR phone LIKE ? OR email LIKE ?)';
            $params[] = "%$search%";
            $params[] = "%$search%";
            $params[] = "%$search%";
        }
        if ($statusFilter === 'active' || $statusFilter === 'inactive') {
            $sql .= ' AND status = ?';
            $params[] = $statusFilter;
        }
        if ($balanceFilter === 'with_balance') {
            $sql .= ' AND balance > 0';
        } elseif ($balanceFilter === 'no_balance') {
            $sql .= ' AND balance <= 0';
        }
        // Más recientes primero
        $sql .= ' ORDER BY created_at DESC, customer_id DESC LIMIT 300';
        $customers = $db->select($sql, $params);
        foreach ($customers as &$c) { $c['balance'] = (float)$c['balance']; }
        Response::success($customers, 'Clientes');

    } elseif ($method === 'POST') {
        if ($actor['via'] === 'session') {
            if (!$auth->hasRole([ROLE_ADMIN, ROLE_MANAGER, ROLE_CASHIER])) { Response::error('Permisos insuficientes', 403); }
        } else {
            $apiAuth->requireScope($actor, 'write');
        }

        $data = json_decode(file_get_contents('php://input'), true);
        if (!$data) { Response::validationError(['body' => 'JSON inválido']); }

        $full_name = isset($data['full_name']) ? Validator::sanitizeString($data['full_name']) : '';
        $phone = isset($data['phone']) ? Validator::sanitizeString($data['phone']) : '';
        $email = isset($data['email']) ? Validator::sanitizeString($data['email']) : '';
        $address = isset($data['address']) ? Validator::sanitizeString($data['address']) : '';
        $credit_limit = isset($data['credit_limit']) ? (float)$data['credit_limit'] : 0.0;
        $notes = isset($data['notes']) ? Validator::sanitizeString($data['notes']) : '';

        if (!Validator::required($full_name)) { Response::validationError(['full_name' => 'Requerido']); }
        if ($credit_limit < 0) { Response::validationError(['credit_limit' => 'No negativo']); }

        $customer_id = $db->insert(
            'INSERT INTO customers (store_id, full_name, phone, email, address, credit_limit, notes) VALUES (?,?,?,?,?,?,?)',
            [$store_id, $full_name, $phone, $email, $address, $credit_limit, $notes]
        );
        Response::success(['customer_id' => $customer_id], 'Cliente creado', 201);

    } elseif ($method === 'PUT') {
        if ($actor['via'] === 'session') {
            if (!$auth->hasRole([ROLE_ADMIN, ROLE_MANAGER])) { Response::error('Permisos insuficientes', 403); }
        } else {
            $apiAuth->requireScope($actor, 'write');
        }

        $data = json_decode(file_get_contents('php://input'), true);
        if (!$data) { Response::validationError(['body' => 'JSON inválido']); }

        $customer_id = isset($data['customer_id']) ? (int)$data['customer_id'] : 0;
        if ($customer_id <= 0) { Response::validationError(['customer_id' => 'Requerido']); }

        $customer = $db->selectOne('SELECT customer_id FROM customers WHERE customer_id = ? AND store_id = ?', [$customer_id, $store_id]);
        if (!$customer) { Response::notFound('Cliente no existe'); }

        $full_name = isset($data['full_name']) ? Validator::sanitizeString($data['full_name']) : '';
        $phone = isset($data['phone']) ? Validator::sanitizeString($data['phone']) : '';
        $email = isset($data['email']) ? Validator::sanitizeString($data['email']) : '';
        $address = isset($data['address']) ? Validator::sanitizeString($data['address']) : '';
        $credit_limit = isset($data['credit_limit']) ? (float)$data['credit_limit'] : 0.0;
        $notes = isset($data['notes']) ? Validator::sanitizeString($data['notes']) : '';
        $status = isset($data['status']) ? Validator::sanitizeString($data['status']) : 'active';

        if (!Validator::required($full_name)) { Response::validationError(['full_name' => 'Requerido']); }
        if (!in_array($status, ['active', 'inactive'])) { Response::validationError(['status' => 'Inválido']); }

        $db->update('UPDATE customers SET full_name = ?, phone = ?, email = ?, address = ?, credit_limit = ?, notes = ?, status = ? WHERE customer_id = ?', [
            $full_name, $phone, $email, $address, $credit_limit, $notes, $status, $customer_id
        ]);
        Response::success(null, 'Cliente actualizado');

    } elseif ($method === 'DELETE') {
        if ($actor['via'] === 'session') {
            if (!$auth->hasRole([ROLE_ADMIN, ROLE_MANAGER])) { Response::error('Permisos insuficientes', 403); }
        } else {
            $apiAuth->requireScope($actor, 'write');
        }

        $data = json_decode(file_get_contents('php://input'), true);
        if (!$data) { Response::validationError(['body' => 'JSON inválido']); }
        $customer_id = isset($data['customer_id']) ? (int)$data['customer_id'] : 0;
        if ($customer_id <= 0) { Response::validationError(['customer_id' => 'Requerido']); }

        $customer = $db->selectOne('SELECT customer_id, balance FROM customers WHERE customer_id = ? AND store_id = ?', [$customer_id, $store_id]);
        if (!$customer) { Response::notFound('Cliente no existe'); }
        if ((float)$customer['balance'] > 0) { Response::error('No se puede eliminar un cliente con saldo pendiente', 409); }

        $db->delete('DELETE FROM customers WHERE customer_id = ?', [$customer_id]);
        Response::success(null, 'Cliente eliminado');
    } else {
        Response::error('Método no permitido', 405);
    }
} catch (Exception $e) {
    Response::error('Error servidor: ' . $e->getMessage(), 500);
}
