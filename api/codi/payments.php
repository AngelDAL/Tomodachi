<?php
/**
 * Listar pagos CoDi de la tienda
 * GET /api/codi/payments.php?status=paid&page=1&per_page=20
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';
require_once '../../codi/includes/CodiService.class.php';

$method = $_SERVER['REQUEST_METHOD'];
if ($method !== 'GET') {
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
    
    $filters = [];
    
    // Filtros
    if (isset($_GET['status'])) {
        $filters['status'] = $_GET['status'];
    }
    if (isset($_GET['payment_method'])) {
        $filters['payment_method'] = $_GET['payment_method'];
    }
    if (isset($_GET['date_from'])) {
        $filters['date_from'] = $_GET['date_from'];
    }
    if (isset($_GET['date_to'])) {
        $filters['date_to'] = $_GET['date_to'];
    }
    if (isset($_GET['search'])) {
        $filters['search'] = $_GET['search'];
    }
    
    $page = isset($_GET['page']) ? max(1, (int)$_GET['page']) : 1;
    $perPage = isset($_GET['per_page']) ? min(100, max(1, (int)$_GET['per_page'])) : 20;
    
    $codi = new CodiService($db, $storeId);
    $result = $codi->getPayments($filters, $page, $perPage);
    
    Response::success($result, 'Pagos CoDi');
} catch (Exception $e) {
    Response::error('Error: ' . $e->getMessage(), 500);
}
