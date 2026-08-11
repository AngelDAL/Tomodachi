<?php
/**
 * Devuelve la clave pública VAPID para suscripciones push.
 * GET /api/push/public_key.php → {"key": "B..." | null}
 */
require_once '../../config/constants.php';
header('Content-Type: application/json');

$key = defined('VAPID_PUBLIC_KEY') && !empty(VAPID_PUBLIC_KEY) ? VAPID_PUBLIC_KEY : null;
echo json_encode(['success' => true, 'key' => $key]);
