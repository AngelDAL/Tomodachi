<?php
/**
 * Configurar módulo Stripe para la tienda
 * GET  /api/stripe/config.php  - Obtener configuración (secret_key enmascarada)
 * POST /api/stripe/config.php  - Guardar credenciales
 * Body: {enabled, currency, publishable_key?, secret_key?, webhook_secret?, auto_complete_sale?}
 *       Las claves que vengan vacías o no vengan NO pisan las guardadas.
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';
require_once '../../stripe/includes/StripeService.class.php';

$method = $_SERVER['REQUEST_METHOD'];

try {
    $db = new Database();
    $auth = new Auth($db);

    $apiAuth = new ApiAuth($db);
    $actor = $apiAuth->requireActor($auth);

    // Solo el administrador configura Stripe
    if ($actor['via'] === 'session') {
        if (!$auth->hasRole([ROLE_ADMIN])) {
            Response::error('Solo el administrador puede configurar Stripe', 403);
        }
    } else {
        $apiAuth->requireScope($actor, 'write');
    }

    $storeId = (int)$actor['store_id'];
    $stripe = new StripeService($db, $storeId);

    if ($method === 'GET') {
        $s = $stripe->getSettings();

        // Nunca exponer la clave secreta: solo una máscara para saber si existe
        $mask = function ($key) {
            if (empty($key)) { return null; }
            return substr($key, 0, 7) . '****' . substr($key, -4);
        };

        Response::success([
            'enabled' => (int)$s['enabled'] === 1,
            'currency' => $s['currency'] ?: 'mxn',
            'publishable_key' => $s['publishable_key'],
            'secret_key_masked' => $mask($s['secret_key']),
            'has_secret_key' => !empty($s['secret_key']),
            'webhook_secret_masked' => $mask($s['webhook_secret']),
            'has_webhook_secret' => !empty($s['webhook_secret']),
            'auto_complete_sale' => (int)($s['auto_complete_sale'] ?? 1) === 1,
            'ready' => $stripe->isEnabled(),
        ], 'Configuración Stripe');
        return;
    }

    if ($method === 'POST') {
        $data = json_decode(file_get_contents('php://input'), true);
        if (!$data) {
            Response::validationError(['body' => 'JSON inválido']);
        }

        try {
            $public = $stripe->saveConfig($data);
        } catch (Exception $e) {
            Response::validationError(['credentials' => $e->getMessage()]);
        }

        Response::success($public, 'Configuración Stripe actualizada');
        return;
    }

    Response::error('Método no permitido', 405);
} catch (Exception $e) {
    Response::error('Error: ' . $e->getMessage(), 500);
}
