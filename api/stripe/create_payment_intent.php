<?php
/**
 * Crear un cobro con tarjeta (PaymentIntent)
 * POST /api/stripe/create_payment_intent.php
 * Body: {amount, concept?, sale_id?}
 * Respuesta: {payment_id, payment_intent_id, client_secret, publishable_key, amount, currency}
 *
 * El client_secret lo usa Stripe.js en el navegador para cobrar la tarjeta;
 * los datos de la tarjeta jamás pasan por este servidor.
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';
require_once '../../stripe/includes/StripeService.class.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

try {
    $db = new Database();
    $auth = new Auth($db);

    $apiAuth = new ApiAuth($db);
    $actor = $apiAuth->requireActor($auth);

    if ($actor['via'] === 'session') {
        if (!$auth->hasRole([ROLE_ADMIN, ROLE_MANAGER, ROLE_CASHIER])) {
            Response::error('Permisos insuficientes', 403);
        }
    } else {
        $apiAuth->requireScope($actor, 'write');
    }

    $storeId = (int)$actor['store_id'];
    $userId = (int)$actor['user_id'];

    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) {
        Response::validationError(['body' => 'JSON inválido']);
    }

    $amount = isset($data['amount']) ? (float)$data['amount'] : 0;
    $concept = isset($data['concept']) ? Validator::sanitizeString($data['concept']) : 'Cobro en tienda';
    $saleId = isset($data['sale_id']) ? (int)$data['sale_id'] : null;

    if ($amount <= 0 || $amount > 999999.99) {
        Response::validationError(['amount' => 'Monto inválido']);
    }

    $stripe = new StripeService($db, $storeId);
    if (!$stripe->isEnabled()) {
        Response::error('Stripe no está habilitado para esta tienda', 403);
    }

    $result = $stripe->createPaymentIntent($amount, $concept, $userId, $saleId);

    Response::success($result, 'Cobro creado, listo para capturar tarjeta');
} catch (Exception $e) {
    Response::error('Error: ' . $e->getMessage(), 500);
}
