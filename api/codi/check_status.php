<?php
/**
 * Consultar estado de un pago CoDi
 * GET /api/codi/check_status.php?payment_id=123
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';
require_once '../../codi/includes/CodiService.class.php';

$method = $_SERVER['REQUEST_METHOD'];
if ($method !== 'GET' && $method !== 'POST') {
    Response::error('Método no permitido', 405);
}

try {
    $db = new Database();
    $auth = new Auth($db);
    
    $apiAuth = new ApiAuth($db);
    $actor = $apiAuth->requireActor($auth);
    $apiAuth->requireScope($actor, 'read');
    
    $currentUser = $actor;
    $storeId = (int)$currentUser['store_id'];
    
    $paymentId = isset($_GET['payment_id']) ? (int)$_GET['payment_id'] : 0;
    if ($paymentId <= 0) {
        Response::validationError(['payment_id' => 'Requerido']);
    }
    
    $codi = new CodiService($db, $storeId);
    $payment = $codi->checkStatus($paymentId);
    
    if (!$payment) {
        Response::notFound('Pago no encontrado');
    }
    
    Response::success($payment, 'Estado del pago CoDi');
} catch (Exception $e) {
    Response::error('Error: ' . $e->getMessage(), 500);
}
