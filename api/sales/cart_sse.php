<?php
/**
 * Server-Sent Events endpoint for cart display
 * 
 * Usage: cart_sse.php?session=UUID
 * Keeps connection open and pushes cart data when it changes.
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';

require_once __DIR__ . '/../../includes/Cors.class.php';
Cors::apply();
header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
header('Connection: keep-alive');
header('X-Accel-Buffering: no');

$session = isset($_GET['session']) ? $_GET['session'] : null;

if (!$session || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $session)) {
    echo "event: error\n";
    echo "data: " . json_encode(['error' => 'UUID inválido']) . "\n\n";
    ob_flush();
    flush();
    exit;
}

$dir = __DIR__ . '/../../temp/sessions';
$file = $dir . '/cart_' . $session . '.json';

$lastTimestamp = 0;

// Send initial connection event
echo "event: connected\n";
echo "data: " . json_encode(['session' => $session]) . "\n\n";
ob_flush();
flush();

// Expire check
$maxLifetime = 7200; // 2 hours
$startTime = time();

while (true) {
    // Check for max lifetime
    if (time() - $startTime > $maxLifetime) {
        echo "event: expired\n";
        echo "data: {}\n\n";
        ob_flush();
        flush();
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

        echo "event: cart_update\n";
        echo "data: " . json_encode($currentData) . "\n\n";
        ob_flush();
        flush();
    }

    // If no file exists (session deleted)
    if (!file_exists($file) && $lastTimestamp > 0) {
        $lastTimestamp = 0;
        echo "event: cart_update\n";
        echo "data: " . json_encode([
            'session' => $session,
            'cart' => [],
            'totals' => ['subtotal' => 0, 'discount' => 0, 'tax' => 0, 'total' => 0],
            'storeInfo' => ['name' => '', 'logo' => ''],
            'activeTab' => null,
            'updated_at' => null
        ]) . "\n\n";
        ob_flush();
        flush();
        break;
    }

    // Sleep 1.5 seconds between checks (lightweight — just filemtime)
    sleep(1);

    // Client disconnected check
    if (connection_aborted()) {
        break;
    }
}
