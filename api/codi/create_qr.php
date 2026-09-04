<?php
/**
 * Crear pago QR CoDi
 * POST /api/codi/create_qr.php
 * Body: {amount, concept, reference?, sale_id?}
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
    
    // Validar campos
    $amount = isset($data['amount']) ? (float)$data['amount'] : 0;
    $concept = isset($data['concept']) ? Validator::sanitizeString($data['concept']) : '';
    $reference = isset($data['reference']) ? Validator::sanitizeString($data['reference']) : null;
    $saleId = isset($data['sale_id']) ? (int)$data['sale_id'] : null;
    
    if ($amount <= 0) {
        Response::validationError(['amount' => 'Monto inválido']);
    }
    if (strlen($concept) < 3) {
        Response::validationError(['concept' => 'Concepto muy corto (mín. 3 caracteres)']);
    }
    
    // Inicializar servicio CoDi
    $codi = new CodiService($db, $storeId);
    
    // Verificar que CoDi esté habilitado
    if (!$codi->isEnabled()) {
        Response::error('CoDi no está habilitado para esta tienda', 403);
    }
    
    // Crear pago QR
    $result = $codi->createQrPayment($amount, $concept, $reference, $userId, $saleId);
    
    Response::success($result, 'Código QR CoDi generado exitosamente');
} catch (Exception $e) {
    Response::error('Error: ' . $e->getMessage(), 500);
}
