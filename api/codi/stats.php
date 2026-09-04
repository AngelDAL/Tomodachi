<?php
/**
 * Obtener estadísticas de pagos CoDi
 * GET /api/codi/stats.php?period=today
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
    
    $period = isset($_GET['period']) ? $_GET['period'] : 'today';
    if (!in_array($period, ['today', 'week', 'month'])) {
        $period = 'today';
    }
    
    $codi = new CodiService($db, $storeId);
    $stats = $codi->getStats($period);
    
    Response::success($stats, 'Estadísticas CoDi');
} catch (Exception $e) {
    Response::error('Error: ' . $e->getMessage(), 500);
}
