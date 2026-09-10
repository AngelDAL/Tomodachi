<?php
/**
 * Consultar/confirmar el estado de un cobro Stripe
 * POST /api/stripe/confirm_payment.php
 * Body: {payment_intent_id}
 *
 * El POS lo llama después de que Stripe.js confirma la tarjeta en el
 * navegador, para sincronizar el estado local consultando Stripe en vivo
 * (útil también cuando el webhook no es alcanzable, p. ej. localhost).
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

    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) {
        Response::validationError(['body' => 'JSON inválido']);
    }

    $paymentIntentId = isset($data['payment_intent_id']) ? Validator::sanitizeString($data['payment_intent_id']) : '';
    if (strpos($paymentIntentId, 'pi_') !== 0) {
        Response::validationError(['payment_intent_id' => 'Identificador inválido']);
    }

    $stripe = new StripeService($db, (int)$actor['store_id']);
    if (!$stripe->isEnabled()) {
        Response::error('Stripe no está habilitado para esta tienda', 403);
    }

    $payment = $stripe->syncPayment($paymentIntentId);

    Response::success($payment, $payment['status'] === 'succeeded' ? 'Pago confirmado' : 'Estado del cobro actualizado');
} catch (Exception $e) {
    Response::error('Error: ' . $e->getMessage(), 500);
}
