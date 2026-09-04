<?php
/**
 * Configurar módulo CoDi para la tienda
 * POST /api/codi/configure.php
 * Body: {enabled, environment, auto_complete_sale?, notify_on_payment?}
 * 
 * GET /api/codi/configure.php - Obtener configuración actual
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

try {
    $db = new Database();
    $auth = new Auth($db);
    
    $apiAuth = new ApiAuth($db);
    $actor = $apiAuth->requireActor($auth);
    
    // Solo admin puede configurar CoDi
    if ($actor['via'] === 'session') {
        if (!$auth->hasRole([ROLE_ADMIN])) {
            Response::error('Solo el administrador puede configurar CoDi', 403);
        }
    } else {
        $apiAuth->requireScope($actor, 'write');
    }
    
    $currentUser = $actor;
    $storeId = (int)$currentUser['store_id'];
    
    if ($method === 'GET') {
        // Obtener configuración
        $config = $db->selectOne(
            'SELECT * FROM codi_settings WHERE store_id = ?',
            [$storeId]
        );
        
        if (!$config) {
            // Configuración por defecto
            $config = [
                'store_id' => $storeId,
                'enabled' => false,
                'environment' => 'sandbox',
                'auto_complete_sale' => false,
                'notify_on_payment' => true,
            ];
        }
        
        Response::success($config, 'Configuración CoDi');
        return;
    }
    
    if ($method === 'POST') {
        $data = json_decode(file_get_contents('php://input'), true);
        if (!$data) {
            Response::validationError(['body' => 'JSON inválido']);
        }
        
        // Verificar si ya existe configuración
        $existing = $db->selectOne(
            'SELECT setting_id FROM codi_settings WHERE store_id = ?',
            [$storeId]
        );
        
        $enabled = isset($data['enabled']) ? (int)(bool)$data['enabled'] : 0;
        $environment = isset($data['environment']) && in_array($data['environment'], ['sandbox', 'production']) 
            ? $data['environment'] 
            : 'sandbox';
        $autoCompleteSale = isset($data['auto_complete_sale']) ? (int)(bool)$data['auto_complete_sale'] : 0;
        $notifyOnPayment = isset($data['notify_on_payment']) ? (int)(bool)$data['notify_on_payment'] : 1;
        $webhookSecret = isset($data['webhook_secret']) ? Validator::sanitizeString($data['webhook_secret']) : null;
        
        if ($existing) {
            // Actualizar
            $db->update(
                'UPDATE codi_settings SET enabled = ?, environment = ?, auto_complete_sale = ?, notify_on_payment = ?, webhook_secret = COALESCE(?, webhook_secret), updated_at = NOW() WHERE store_id = ?',
                [$enabled, $environment, $autoCompleteSale, $notifyOnPayment, $webhookSecret, $storeId]
            );
        } else {
            // Crear
            $db->insert(
                'INSERT INTO codi_settings (store_id, enabled, environment, auto_complete_sale, notify_on_payment, webhook_secret) VALUES (?, ?, ?, ?, ?, ?)',
                [$storeId, $enabled, $environment, $autoCompleteSale, $notifyOnPayment, $webhookSecret]
            );
        }
        
        Response::success([
            'store_id' => $storeId,
            'enabled' => $enabled,
            'environment' => $environment,
            'auto_complete_sale' => $autoCompleteSale,
            'notify_on_payment' => $notifyOnPayment,
        ], 'Configuración CoDi actualizada');
        return;
    }
    
    Response::error('Método no permitido', 405);
} catch (Exception $e) {
    Response::error('Error: ' . $e->getMessage(), 500);
}
