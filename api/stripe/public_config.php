<?php
/**
 * Configuración pública de Stripe para el POS
 * GET /api/stripe/public_config.php
 * Devuelve SOLO datos públicos (publishable_key, moneda) para que Stripe.js
 * pueda montar el cobro. Nunca expone la clave secreta.
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
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
    if ($actor['via'] !== 'session') {
        $apiAuth->requireScope($actor, 'read');
    }

    $stripe = new StripeService($db, (int)$actor['store_id']);

    Response::success($stripe->getPublicConfig(), 'Configuración pública Stripe');
} catch (Exception $e) {
    Response::error('Error: ' . $e->getMessage(), 500);
}
