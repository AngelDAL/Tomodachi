<?php
/**
 * Webhook de CoDi (Banxico/proveedor notifica pagos)
 * POST /api/codi/webhook.php
 * 
 * Este endpoint es llamado por el proveedor de CoDi (Banxico/portfedh)
 * cuando se confirma, expira o cancela un pago.
 * 
 * No requiere autenticación de sesión, valida por firma.
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../codi/includes/CodiService.class.php';

$method = $_SERVER['REQUEST_METHOD'];
if ($method !== 'POST') {
    Response::error('Método no permitido', 405);
}

try {
    $db = new Database();
    
    $payload = json_decode(file_get_contents('php://input'), true);
    if (!$payload) {
        Response::validationError(['body' => 'JSON inválido']);
    }
    
    // Obtener firma del webhook (puede venir en headers o en el payload)
    $signature = $_SERVER['HTTP_X_WEBHOOK_SIGNATURE'] 
        ?? $_SERVER['HTTP_X_SIGNATURE'] 
        ?? $payload['signature'] 
        ?? '';
    
    // Obtener store_id del payload (el proveedor lo incluye)
    $storeId = isset($payload['store_id']) ? (int)$payload['store_id'] : 0;
    
    if ($storeId <= 0) {
        // Intentar obtener store_id del folioCoDi
        $folioCodi = $payload['folio_codi'] ?? $payload['folioCoDi'] ?? null;
        if ($folioCodi) {
            $payment = $db->selectOne(
                'SELECT store_id FROM codi_payments WHERE folio_codi = ?',
                [$folioCodi]
            );
            if ($payment) {
                $storeId = (int)$payment['store_id'];
            }
        }
    }
    
    if ($storeId <= 0) {
        Response::validationError(['store_id' => 'No se pudo determinar la tienda']);
    }
    
    $codi = new CodiService($db, $storeId);
    $codi->handleWebhook($payload, $signature);
    
    Response::success(['processed' => true], 'Webhook procesado');
} catch (Exception $e) {
    // Para webhooks, siempre retornar 200 si es posible (para no provocar reintentos)
    // pero si es error de firma, sí retornar 401
    $code = (strpos($e->getMessage(), 'Firma') !== false) ? 401 : 200;
    if ($code === 200) {
        Response::success([
            'processed' => false,
            'warning' => $e->getMessage(),
        ], 'Webhook recibido con advertencia');
    } else {
        Response::error($e->getMessage(), 401);
    }
}
