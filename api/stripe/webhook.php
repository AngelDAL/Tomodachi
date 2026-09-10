<?php
/**
 * Webhook de Stripe
 * POST /api/stripe/webhook.php
 *
 * Endpoint público llamado por Stripe cuando un PaymentIntent cambia de
 * estado (payment_intent.succeeded, payment_failed, canceled, ...).
 * No usa sesión: la autenticidad se valida con la firma Stripe-Signature
 * y el webhook_secret de la tienda.
 *
 * La tienda se localiza por metadata.store_id del PaymentIntent (dato que
 * solo se usa para buscar el secreto; el payload se VERIFICA antes de
 * procesarse). Los eventos sin esa metadata se ignoran con 200.
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../stripe/includes/StripeService.class.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

$rawBody = file_get_contents('php://input');
if (!$rawBody) {
    Response::error('Cuerpo vacío', 400);
}

$signature = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';
if ($signature === '') {
    Response::error('Falta firma del webhook', 401);
}

try {
    $db = new Database();

    // Localizar la tienda dueña del cobro (primero por registro local,
    // luego por la metadata del PaymentIntent).
    $decoded = json_decode($rawBody, true);
    $storeId = 0;
    $intentId = $decoded['data']['object']['id'] ?? null;

    if (is_string($intentId) && strpos($intentId, 'pi_') === 0) {
        $payment = $db->selectOne(
            'SELECT store_id FROM stripe_payments WHERE stripe_payment_intent_id = ?',
            [$intentId]
        );
        if ($payment) {
            $storeId = (int)$payment['store_id'];
        }
    }
    if ($storeId <= 0 && isset($decoded['data']['object']['metadata']['store_id'])) {
        $storeId = (int)$decoded['data']['object']['metadata']['store_id'];
    }

    if ($storeId <= 0) {
        // Evento ajeno a este Tomodachi: se acusa recibo y se ignora
        Response::success(['processed' => false], 'Evento ignorado');
        return;
    }

    $stripe = new StripeService($db, $storeId);
    $stripe->handleWebhook($rawBody, $signature);

    Response::success(['processed' => true], 'Webhook procesado');
} catch (Exception $e) {
    // Firma/payload inválido -> 4xx para que Stripe NO lo trate como entregado.
    // Cualquier otro error -> 200 con advertencia para evitar reintentos infinitos.
    $msg = $e->getMessage();
    if (strpos($msg, 'Firma') !== false || strpos($msg, 'Payload') !== false || strpos($msg, 'webhook') !== false) {
        Response::error($msg, 401);
    }
    Response::success(['processed' => false, 'warning' => $msg], 'Webhook recibido con advertencia');
}
