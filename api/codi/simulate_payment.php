<?php
/**
 * Simular confirmacion de pago CoDi (SOLO MODO SANDBOX)
 * POST /api/codi/simulate_payment.php
 * Body: {payment_id: 123}
 * 
 * Este endpoint es SOLO para testing en modo sandbox.
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';
require_once '../../codi/includes/CodiService.class.php';

$method = $_SERVER['REQUEST_METHOD'];
if ($method !== 'POST') {
    Response::error('Metodo no permitido', 405);
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
    
    $currentUser = $actor;
    $storeId = (int)$currentUser['store_id'];
    
    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) {
        Response::validationError(['body' => 'JSON invalido']);
    }
    
    $paymentId = isset($data['payment_id']) ? (int)$data['payment_id'] : 0;
    if ($paymentId <= 0) {
        Response::validationError(['payment_id' => 'Requerido']);
    }
    
    // Verificar que el pago existe y pertenece a la tienda
    $payment = $db->selectOne(
        'SELECT payment_id, status, store_id FROM codi_payments WHERE payment_id = ? AND store_id = ?',
        [$paymentId, $storeId]
    );
    
    if (!$payment) {
        Response::notFound('Pago no encontrado');
    }
    
    if ($payment['status'] !== 'generated' && $payment['status'] !== 'pending') {
        Response::error('El pago no esta en un estado que pueda ser simulado: ' . $payment['status'], 400);
    }
    
    // Verificar que el modulo CoDi esta en sandbox
    $settings = $db->selectOne(
        'SELECT environment FROM codi_settings WHERE store_id = ?',
        [$storeId]
    );
    
    if (!$settings || $settings['environment'] !== 'sandbox') {
        Response::error('Este endpoint solo funciona en modo sandbox', 403);
    }
    
    // Simular confirmacion de pago
    $codi = new CodiService($db, $storeId);
    $result = $codi->confirmPayment($paymentId, [
        'event_type' => 'paid',
        'folio_codi' => $payment['folio_codi'] ?? 'SANDBOX-' . $paymentId,
        'monto' => $payment['amount'] ?? 0,
        'store_id' => $storeId,
        'sandbox' => true,
    ]);
    
    if ($result) {
        Response::success([
            'payment_id' => $paymentId,
            'status' => 'paid',
            'sandbox' => true,
        ], 'Pago simulado exitosamente (sandbox)');
    } else {
        Response::error('No se pudo simular el pago', 500);
    }
    
} catch (Exception $e) {
    Response::error('Error: ' . $e->getMessage(), 500);
}
