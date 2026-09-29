<?php
/**
 * GET /api/health/ready.php — READINESS REAL del contenedor.
 *
 * Reemplaza a `api/auth/permissions.php` como salud del HEALTHCHECK: aquel es
 * estático (no toca la BD) y respondía 200 con la base de datos caída, así que
 * Docker declaraba `healthy` un contenedor que no podía atender nada.
 *
 * Estados (ver `includes/HealthCheck.class.php`):
 *   200 ok         · 200 degraded (migración fallida)
 *   503 not_ready  (esquema sin inicializar / migraciones pendientes)
 *   503 down       (BD, disco o configuración)
 *
 * El cuerpo SIEMPRE trae `status`. El detalle (`checks`, `version`, `time`) solo
 * se expone si la petición viene de loopback o si `X-Health-Token` coincide con
 * `HEALTH_TOKEN`; desde fuera el cuerpo es `{"status":"…"}` y nada más (no se
 * filtra si la BD está caída, ni rutas, ni versiones).
 *
 * INVARIANTES
 * - NO abre sesión: este endpoint lo llama el HEALTHCHECK cada 30 s y el
 *   `session_start()` de permissions.php creaba 2,880 archivos/día.
 * - NO lee, ni valida, ni acepta `store_id` (invariante multi-tienda intacto).
 * - Solo lee: ninguna escritura, ningún DDL.
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET' && $method !== 'HEAD') {
    http_response_code(405);
    echo '{"status":"method_not_allowed"}';
    exit;
}

$raiz = dirname(__DIR__, 2);

// Si falta config/database.php (p. ej. contenedor sin entrypoint) NO queremos un
// fatal error en blanco: el check `config` lo reporta como 503 down.
require_once $raiz . '/config/constants.php';
if (is_file($raiz . '/config/database.php')) {
    require_once $raiz . '/config/database.php';
}
require_once $raiz . '/includes/HealthCheck.class.php';

$expectedToken = defined('HEALTH_TOKEN') ? (string) HEALTH_TOKEN : '';
$showDetail = HealthCheck::detailAllowed(
    $_SERVER['REMOTE_ADDR'] ?? null,
    $_SERVER['HTTP_X_HEALTH_TOKEN'] ?? null,
    $expectedToken
);

$result = HealthCheck::evaluate([
    'min_free_mb' => defined('HEALTH_MIN_FREE_MB') ? (int) HEALTH_MIN_FREE_MB : null,
]);

http_response_code($result['http_code']);

$body = ['status' => $result['status']];
if ($showDetail) {
    $body['checks'] = $result['checks'];
    $body['version'] = defined('APP_VERSION') ? APP_VERSION : null;
    $body['time'] = date('c');
}

echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
