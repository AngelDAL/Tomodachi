<?php
/**
 * Cancelar un pago CoDi
 * POST /api/codi/cancel.php
 * Body: {payment_id}
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';
require_once '../../codi/includes/CodiService.class.php';

$method = $_SERVER['REQUEST_METHOD'];
if ($method !== 'POST') {
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
    
    $currentUser = $actor;
    $storeId = (int)$currentUser['store_id'];
    $userId = (int)$currentUser['user_id'];
    
    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) {
        Response::validationError(['body' => 'JSON inválido']);
    }
    
    $paymentId = isset($data['payment_id']) ? (int)$data['payment_id'] : 0;
    if ($paymentId <= 0) {
        Response::validationError(['payment_id' => 'Requerido']);
    }
    
    $codi = new CodiService($db, $storeId);
    $codi->cancelPayment($paymentId, $userId);
    
    Response::success(['payment_id' => $paymentId, 'status' => 'cancelled'], 'Pago CoDi cancelado');
} catch (Exception $e) {
    Response::error('Error: ' . $e->getMessage(), 500);
}
