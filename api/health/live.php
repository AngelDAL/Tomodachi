<?php
/**
 * GET /api/health/live.php — LIVENESS: "PHP responde".
 *
 * A propósito NO carga nada más (ni configuración, ni BD, ni clases): si este
 * endpoint falla, el problema es el proceso PHP-FPM, no la aplicación. Para
 * "puedo atender" está `api/health/ready.php`.
 *
 * - No abre sesión (nada de `session_start()`): el healthcheck corre cada 30 s
 *   y cada `Set-Cookie` sería un archivo más en el volumen `app_sessions`.
 * - No lee ni acepta `store_id`: no hay tienda en juego.
 * - Responde 200 con CUALQUIER método: la liveness no debe depender de nada.
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

http_response_code(200);
echo '{"status":"live"}';
