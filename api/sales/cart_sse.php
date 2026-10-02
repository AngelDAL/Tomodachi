<?php
/**
 * Server-Sent Events endpoint for cart display
 *
 * Usage: cart_sse.php?session=UUID&exp=<caducidad>&token=<firma>
 * Keeps connection open and pushes cart data when it changes.
 *
 * AUTORIZACIÓN (TAB-25-X3): la UUID ya no es credencial. Exige sesión de navegador O el
 * token firmado del carrito (canal `cart:<uuid>`), que emite el POST autenticado de
 * cart_sync.php. Sin `WS_SECRET` no hay lectura por token (fail closed, mismo criterio que
 * api/ws/token.php).
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/WsToken.class.php';

require_once __DIR__ . '/../../includes/Cors.class.php';
Cors::apply();

$db = new Database();
$auth = new Auth($db);

$session = isset($_GET['session']) ? $_GET['session'] : null;

if (!$session || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $session)) {
    Response::error('session UUID requerido y debe ser válido', 400);
}

// Autorizar ANTES de abrir el stream: quien no tiene credencial recibe un 401 JSON.
$actor = $auth->isLoggedIn() ? $auth->getCurrentUser() : null;
if (!$actor && !WsToken::validar(WsToken::canalCarrito($session), $_GET['token'] ?? '', $_GET['exp'] ?? '')) {
    Response::unauthorized('Se requiere sesión o token del carrito');
}

$dir = __DIR__ . '/../../temp/sessions';
$file = $dir . '/cart_' . $session . '.json';

// Aislamiento multi-tienda: la tienda dueña sale del archivo (el origen), nunca de un
// store_id del request; la sesión de otra tienda no lee este carrito.
$storeCarrito = 0;
if (file_exists($file)) {
    $previo = json_decode((string)@file_get_contents($file), true);
    if (is_array($previo) && isset($previo['store_id'])) {
        $storeCarrito = (int)$previo['store_id'];
    }
}
if ($actor && $storeCarrito > 0 && $storeCarrito !== (int)$actor['store_id']) {
    Response::error('Ese carrito es de otra tienda', 403);
}

header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
header('Connection: keep-alive');
header('X-Accel-Buffering: no');

/** Empuja un trozo del stream al cliente (sin buffer intermedio). */
function sse($texto) {
    echo $texto;
    if (ob_get_level() > 0) {
        @ob_flush();
    }
    @flush();
}

$lastTimestamp = 0;

// Send initial connection event
sse("event: connected\n" . "data: " . json_encode(['session' => $session]) . "\n\n");

// Corte deliberado a los 60 s. El display de cliente NO usa SSE: su tiempo real es el
// WebSocket (`connectRealtime`, reconecta cada 3 s) y recupera el estado con cart_sync.php
// (`pollOnce`, cada 15 s); además EventSource reconecta solo. Un ciclo corto evita que un
// worker de php-fpm quede tomado por una pantalla olvidada durante 2 h.
$maxLifetime = 60;
// Latido: obliga a un intento de escritura para que `connection_aborted()` se actualice
// aunque el carrito no cambie. Sin esto, un cliente que se fue deja el worker ocupado hasta
// el corte de nginx; con esto se libera en ~5 s.
$heartbeatEvery = 5;
$lastHeartbeat = time();
$startTime = time();

while (true) {
    // Check for max lifetime
    if (time() - $startTime > $maxLifetime) {
        sse("event: expired\ndata: {}\n\n");
        break;
    }

    $currentData = null;
    $currentTimestamp = 0;

    if (file_exists($file)) {
        $raw = file_get_contents($file);
        $parsed = json_decode($raw, true);
        if ($parsed) {
            $currentTimestamp = isset($parsed['updated_at']) ? $parsed['updated_at'] : 0;
            $currentData = $parsed;
        }
    }

    if ($currentTimestamp > $lastTimestamp) {
        $lastTimestamp = $currentTimestamp;

        // Strip store_id from response
        if ($currentData) {
            unset($currentData['store_id']);
        }

        sse("event: cart_update\n" . "data: " . json_encode($currentData) . "\n\n");
    }

    // If no file exists (session deleted)
    if (!file_exists($file) && $lastTimestamp > 0) {
        $lastTimestamp = 0;
        sse("event: cart_update\n" . "data: " . json_encode([
            'session' => $session,
            'cart' => [],
            'totals' => ['subtotal' => 0, 'discount' => 0, 'tax' => 0, 'total' => 0],
            'storeInfo' => ['name' => '', 'logo' => ''],
            'activeTab' => null,
            'updated_at' => null
        ]) . "\n\n");
        break;
    }

    // Sleep 1 second between checks (lightweight — just filemtime)
    sleep(1);

    // Latido + corte si el cliente se fue. El latido es un comentario SSE (`:`), así que
    // no dispara `onmessage` en el cliente: sólo refresca la detección de desconexión.
    if (time() - $lastHeartbeat >= $heartbeatEvery) {
        sse(": latido\n\n");
        $lastHeartbeat = time();
    }
    if (connection_aborted()) {
        break;
    }
}
