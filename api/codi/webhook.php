<?php
/**
 * Webhook de CoDi (Banxico/proveedor notifica pagos)
 * POST /api/codi/webhook.php
 * 
 * Este endpoint es llamado por el proveedor de CoDi (Banxico/portfedh)
 * cuando se confirma, expira o cancela un pago.
 * 
 * No requiere autenticación de sesión: la petición se autentica con la FIRMA
 * HMAC-SHA256 del CUERPO CRUDO, calculada con el `webhook_secret` de la tienda
 * (`codi_settings.webhook_secret`):
 * 
 *   X-Webhook-Signature: <hex hmac-sha256 del cuerpo tal cual llegó>
 *   Respaldo: X-Signature (se acepta prefijo opcional `sha256=`)
 * 
 * El byte-string firmado es el cuerpo tal como llegó por el cable, NO una
 * re-serialización (`json_encode(json_decode($body))` da otra firma y es
 * inválida). La firma tampoco se acepta dentro del payload.
 * 
 * FAIL CLOSED: sin secreto configurado, o sin firma, no se procesa nada —
 * 401 y `codi_payments.status` intacto.
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
    
    // El byte-string que se firma es el cuerpo TAL CUAL llegó.
    $rawBody = file_get_contents('php://input');
    if ($rawBody === false) {
        $rawBody = '';
    }
    
    $payload = json_decode($rawBody, true);
    if (!is_array($payload)) {
        Response::validationError(['body' => 'JSON inválido']);
    }
    
    // Firma SÓLO del header: la que venga en el payload no autentica nada.
    $signature = $_SERVER['HTTP_X_WEBHOOK_SIGNATURE'] 
        ?? $_SERVER['HTTP_X_SIGNATURE'] 
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
    $codi->handleWebhook($payload, $signature, $rawBody);
    
    Response::success(['processed' => true], 'Webhook procesado');
} catch (CodiWebhookException $e) {
    // Rechazo de la puerta de seguridad (firma/módulo/tienda): se responde el
    // código que corresponde y no se tocó estado.
    Response::error($e->getMessage(), $e->getHttpCode());
} catch (Exception $e) {
    // Para el resto de webhooks, siempre retornar 200 si es posible (para no
    // provocar reintentos), pero si es error de firma, sí retornar 401
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
