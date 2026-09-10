<?php
/**
 * Cancelar un cobro Stripe pendiente (no cobrado)
 * POST /api/stripe/cancel.php
 * Body: {payment_id}
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
        if (!$auth->hasRole([ROLE_ADMIN, ROLE_MANAGER])) {
            Response::error('Permisos insuficientes', 403);
        }
    } else {
        $apiAuth->requireScope($actor, 'write');
    }

    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) {
        Response::validationError(['body' => 'JSON inválido']);
    }

    $paymentId = isset($data['payment_id']) ? (int)$data['payment_id'] : 0;
    if ($paymentId <= 0) {
        Response::validationError(['payment_id' => 'Requerido']);
    }

    $stripe = new StripeService($db, (int)$actor['store_id']);
    if (!$stripe->isEnabled()) {
        Response::error('Stripe no está habilitado para esta tienda', 403);
    }

    $result = $stripe->cancelPayment($paymentId);

    Response::success($result, 'Cobro cancelado');
} catch (Exception $e) {
    Response::error('Error: ' . $e->getMessage(), 500);
}
