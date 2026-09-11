<?php
/**
 * Abonar al apartado de un cliente
 * POST /api/customers/payments.php
 * Body: {customer_id, amount, payment_method?: 'cash'|'card'|'transfer', notes?}
 *
 * - Reduce el balance del cliente.
 * - Registra el abono en customer_payments.
 * - Registra movimiento de caja (entry) si el método es efectivo.
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';

$method = $_SERVER['REQUEST_METHOD'];
if ($method !== 'POST') { Response::error('Método no permitido', 405); }

try {
    $db = new Database();
    $auth = new Auth($db);

    $apiAuth = new ApiAuth($db);
    $actor = $apiAuth->requireActor($auth);
    if ($actor['via'] === 'session') {
        if (!$auth->hasRole([ROLE_ADMIN, ROLE_MANAGER, ROLE_CASHIER])) { Response::error('Permisos insuficientes', 403); }
    } else {
        $apiAuth->requireScope($actor, 'write');
    }
    $currentUser = $actor;
    $store_id = (int)$currentUser['store_id'];

    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { Response::validationError(['body' => 'JSON inválido']); }

    $customer_id = isset($data['customer_id']) ? (int)$data['customer_id'] : 0;
    $amount = isset($data['amount']) ? (float)$data['amount'] : 0.0;
    $payment_method = isset($data['payment_method']) ? Validator::sanitizeString($data['payment_method']) : PAYMENT_CASH;
    $notes = isset($data['notes']) ? Validator::sanitizeString($data['notes']) : '';

    if ($customer_id <= 0) { Response::validationError(['customer_id' => 'Requerido']); }
    if ($amount <= 0) { Response::validationError(['amount' => 'Debe ser mayor a 0']); }
    if (!in_array($payment_method, [PAYMENT_CASH, PAYMENT_CARD, PAYMENT_TRANSFER])) { Response::validationError(['payment_method' => 'Inválido']); }

    $customer = $db->selectOne('SELECT customer_id, full_name, balance FROM customers WHERE customer_id = ? AND store_id = ?', [$customer_id, $store_id]);
    if (!$customer) { Response::notFound('Cliente no existe'); }

    // Un abono no puede superar lo que el cliente debe.
    //
    // Antes se recortaba el saldo a 0 en silencio (`if ($newBalance < 0)`): el
    // abono quedaba registrado y el efectivo entraba a caja, pero el cliente no
    // recibía nada a cambio. Es decir, se cobraba dinero que no se aplicaba a
    // ninguna deuda y las cuentas dejaban de cuadrar (los abonos registrados no
    // explicaban el saldo).
    //
    // Se BLOQUEA en lugar de permitir saldo negativo a propósito: un saldo a
    // favor (monedero) tendría que poder GASTARSE en el punto de venta, y hoy
    // nada aplica el saldo de un cliente como pago. Dejarlo en negativo sería un
    // crédito invisible e inutilizable, y además restaría del "por cobrar"
    // (un saldo a favor es un PASIVO, no una cuenta por cobrar).
    $balance = round((float)$customer['balance'], 2);
    if ($amount > $balance) {
        if ($balance <= 0) {
            Response::error($customer['full_name'] . ' no tiene saldo pendiente: no hay nada que abonar.', 422);
        }
        Response::error(
            'El abono ($' . number_format($amount, 2) . ') supera el saldo pendiente de '
            . $customer['full_name'] . ' ($' . number_format($balance, 2) . ').',
            422
        );
    }

    $newBalance = round($balance - $amount, 2);

    $db->beginTransaction();
    try {
        $payment_id = $db->insert(
            'INSERT INTO customer_payments (customer_id, store_id, user_id, amount, payment_method, notes) VALUES (?,?,?,?,?,?)',
            [$customer_id, $store_id, $currentUser['user_id'], $amount, $payment_method, $notes]
        );

        $db->update('UPDATE customers SET balance = ? WHERE customer_id = ?', [$newBalance, $customer_id]);

        // Movimiento de caja si es efectivo
        if ($payment_method === PAYMENT_CASH) {
            $open = $db->selectOne('SELECT register_id FROM cash_registers WHERE store_id = ? AND status = ? ORDER BY opening_date DESC LIMIT 1', [$store_id, REGISTER_OPEN]);
            if ($open) {
                $db->insert(
                    'INSERT INTO cash_movements (register_id, user_id, movement_type, amount, description) VALUES (?,?,?,?,?)',
                    [$open['register_id'], $currentUser['user_id'], 'entry', $amount, 'Abono de ' . $customer['full_name'] . ' (apartado)']
                );
            }
        }

        $db->commit();
    } catch (Exception $e) {
        $db->rollback();
        throw $e;
    }

    Response::success([
        'payment_id' => $payment_id,
        'customer_id' => $customer_id,
        'amount' => $amount,
        'new_balance' => $newBalance
    ], 'Abono registrado');
} catch (Exception $e) {
    Response::error('Error servidor: ' . $e->getMessage(), 500);
}
