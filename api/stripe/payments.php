<?php
/**
 * Listar cobros Stripe de la tienda
 * GET /api/stripe/payments.php?status=succeeded&from=2026-01-01&to=2026-12-31&limit=50
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';
require_once '../../stripe/includes/StripeService.class.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
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
        $apiAuth->requireScope($actor, 'read');
    }

    $filters = [];
    if (!empty($_GET['status'])) {
        $status = Validator::sanitizeString($_GET['status']);
        $valid = ['requires_payment_method','requires_confirmation','requires_action','processing','succeeded','canceled','failed'];
        if (in_array($status, $valid, true)) {
            $filters['status'] = $status;
        }
    }
    foreach (['from', 'to'] as $dateParam) {
        if (!empty($_GET[$dateParam]) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET[$dateParam])) {
            $filters[$dateParam] = $_GET[$dateParam];
        }
    }
    if (!empty($_GET['limit'])) {
        $filters['limit'] = (int)$_GET['limit'];
    }

    $stripe = new StripeService($db, (int)$actor['store_id']);
    $payments = $stripe->listPayments($filters);

    Response::success($payments, 'Cobros Stripe');
} catch (Exception $e) {
    Response::error('Error: ' . $e->getMessage(), 500);
}
