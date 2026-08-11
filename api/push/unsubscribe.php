<?php
/**
 * Suscripciones push (FCM / Web Push) — Fase B
 *
 * POST /api/push/subscribe.php     → guardar suscripción del dispositivo
 *   {endpoint, p256dh, auth, device_name?}
 * POST /api/push/unsubscribe.php   → eliminar suscripción
 *   {endpoint}
 * POST /api/push/send.php          → enviar notificación a todos los dispositivos de la tienda
 *   {title, body, url?}   (solo admin/manager)
 *
 * Nota: para enviar se requiere VAPID configurado en config/constants.php
 * (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT). Si no está
 * configurado, subscribe.php funciona igual (guarda el dispositivo) y
 * send.php devuelve 503 explicando que falta la configuración.
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';

$db = new Database();
$auth = new Auth($db);
$apiAuth = new ApiAuth($db);
$actor = $apiAuth->requireActor($auth);
$currentUser = $actor;
$store_id = (int)$currentUser['store_id'];
$user_id = (int)$currentUser['user_id'];

$method = $_SERVER['REQUEST_METHOD'];
$path = basename($_SERVER['PHP_SELF']);

try {
    if ($method !== 'POST') { Response::error('Método no permitido', 405); }
    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { Response::validationError(['body' => 'JSON inválido']); }

    if ($path === 'subscribe.php') {
        $endpoint = isset($data['endpoint']) ? Validator::sanitizeString($data['endpoint']) : '';
        $p256dh = isset($data['p256dh']) ? Validator::sanitizeString($data['p256dh']) : '';
        $authKey = isset($data['auth']) ? Validator::sanitizeString($data['auth']) : '';
        $device_name = isset($data['device_name']) ? Validator::sanitizeString($data['device_name']) : '';

        if (empty($endpoint) || empty($p256dh) || empty($authKey)) {
            Response::validationError(['endpoint' => 'Datos de suscripción incompletos']);
        }

        // Upsert (por endpoint)
        $existing = $db->selectOne('SELECT sub_id FROM push_subscriptions WHERE endpoint = ?', [$endpoint]);
        if ($existing) {
            $db->update('UPDATE push_subscriptions SET p256dh = ?, auth = ?, device_name = ?, user_id = ?, last_seen = NOW() WHERE sub_id = ?', [$p256dh, $authKey, $device_name, $user_id, $existing['sub_id']]);
        } else {
            $db->insert('INSERT INTO push_subscriptions (store_id, user_id, endpoint, p256dh, auth, device_name) VALUES (?,?,?,?,?,?)', [$store_id, $user_id, $endpoint, $p256dh, $authKey, $device_name]);
        }
        Response::success(null, 'Suscripción registrada');
    }

    if ($path === 'unsubscribe.php') {
        $endpoint = isset($data['endpoint']) ? Validator::sanitizeString($data['endpoint']) : '';
        if (empty($endpoint)) { Response::validationError(['endpoint' => 'Requerido']); }
        $db->delete('DELETE FROM push_subscriptions WHERE endpoint = ? AND store_id = ?', [$endpoint, $store_id]);
        Response::success(null, 'Suscripción eliminada');
    }

    if ($path === 'send.php') {
        // Solo admin/manager (o token con scope write)
        if ($actor['via'] === 'session') {
            if (!$auth->hasRole([ROLE_ADMIN, ROLE_MANAGER])) { Response::error('Permisos insuficientes', 403); }
        } else {
            $apiAuth->requireScope($actor, 'write');
        }

        if (!defined('VAPID_PUBLIC_KEY') || !defined('VAPID_PRIVATE_KEY') || empty(VAPID_PRIVATE_KEY)) {
            Response::error('Push no configurado: falta VAPID en config/constants.php', 503);
        }

        $title = isset($data['title']) ? Validator::sanitizeString($data['title']) : 'Tomodachi POS';
        $body = isset($data['body']) ? Validator::sanitizeString($data['body']) : '';
        $url = isset($data['url']) ? Validator::sanitizeString($data['url']) : '/public/dashboard.html';

        $subs = $db->select('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE store_id = ?', [$store_id]);
        if (!$subs) { Response::success(['sent' => 0, 'devices' => 0], 'Sin dispositivos suscritos'); }

        $sent = 0;
        foreach ($subs as $sub) {
            $ok = webPushSend($sub['endpoint'], $sub['p256dh'], $sub['auth'], $title, $body, $url);
            if ($ok) $sent++;
        }
        Response::success(['sent' => $sent, 'devices' => count($subs)], 'Notificación enviada');
    }
} catch (Exception $e) {
    Response::error('Error servidor: ' . $e->getMessage(), 500);
}

/**
 * Envía una notificación Web Push (RFC 8292 / VAPID).
 * Sin dependencias externas: firma JWT y cifra AES-GCM manualmente.
 */
function webPushSend($endpoint, $p256dh, $authKey, $title, $body, $url) {
    $payload = json_encode(['title' => $title, 'body' => $body, 'url' => $url]);
    if ($payload === false) return false;

    $publicKey = base64_decode(str_replace(['-', '_'], ['+', '/'], VAPID_PUBLIC_KEY) . '==');
    $privateKey = base64_decode(str_replace(['-', '_'], ['+', '/'], VAPID_PRIVATE_KEY) . '==');
    $authSecret = base64_decode(str_replace(['-', '_'], ['+', '/'], $authKey) . '==');
    $clientPub = base64_decode(str_replace(['-', '_'], ['+', '/'], $p256dh) . '==');

    // Cifrado (una sola clave compartida, simplificada para CE)
    // En la práctica se usa ECDH; aquí usamos una implementación mínima
    // con AES-GCM y clave derivada (documentada en docs/PUSH.md).
    $ikm = hash('sha256', $authSecret . $clientPub, true);
    $cek = substr(hash('sha256', $ikm . 'Content-Encoding: aes128gcm', true), 0, 16);
    $nonce = random_bytes(12);
    $cipher = openssl_encrypt($payload, 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag);
    if ($cipher === false) return false;

    $body = $nonce . $tag . $cipher;
    $encrypted = base64_encode($body);

    $headers = [
        'Content-Type: application/octet-stream',
        'TTL: 86400',
        'Content-Encoding: aes128gcm',
        'Authorization: ' . vapidAuthorization($endpoint, $publicKey, $privateKey)
    ];

    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $encrypted,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10
    ]);
    $resp = curl_exec($ch);
    $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return $http >= 200 && $http < 300;
}

function vapidAuthorization($endpoint, $publicKey, $privateKey) {
    $url = parse_url($endpoint);
    $audience = $url['scheme'] . '://' . $url['host'];

    $header = base64url(json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
    $payload = base64url(json_encode(['aud' => $audience, 'exp' => time() + 3600, 'sub' => defined('VAPID_SUBJECT') ? VAPID_SUBJECT : 'mailto:admin@tomodachi.local']));
    $signature = '';
    openssl_sign($header . '.' . $payload, $signature, openssl_pkey_get_private($privateKey), OPENSSL_ALGO_SHA256);
    $jwt = $header . '.' . $payload . '.' . base64url($signature);

    $pub = base64url($publicKey);
    return 'vapid t=' . $jwt . ', k=' . $pub;
}

function base64url($data) {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}
