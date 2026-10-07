<?php
/**
 * Presencia y suscripción push del CLIENTE de un pedido de mostrador.
 *
 *   POST {token}                                  -> señal de vida ("estoy viendo mi pedido")
 *   POST {token, notify_granted:true|false}       -> además informa si activó los avisos
 *   POST {subscribe:true, token, endpoint, p256dh, auth} -> guarda la suscripción push
 *
 * Público (sin sesión): el token del pedido es la llave. No devuelve datos del pedido.
 */

require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/CounterService.class.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    Response::error('Método no permitido', 405);
}

$data = json_decode(file_get_contents('php://input'), true);
if (!is_array($data)) {
    $data = [];
}
$token = trim((string)($data['token'] ?? ''));
if ($token === '') {
    Response::validationError(['token' => 'Falta el identificador del pedido']);
}

try {
    $db = new Database();
    $counter = new CounterService($db);

    if (!empty($data['subscribe'])) {
        $r = $counter->suscribir(
            $token,
            $data['endpoint'] ?? '',
            $data['p256dh'] ?? '',
            $data['auth'] ?? ''
        );
        Response::success($r, 'Avisos activados');
    }

    // Señal de vida (con o sin el dato de los avisos).
    $notifyGranted = array_key_exists('notify_granted', $data) ? (bool)$data['notify_granted'] : null;
    $r = $counter->presencia($token, $notifyGranted);
    if ($r === null) {
        Response::notFound('No encontramos ese pedido');
    }
    Response::success($r, 'ok');
} catch (Exception $e) {
    $codigo = (int)$e->getCode();
    if ($codigo < 400 || $codigo > 599) {
        $codigo = 500;
    }
    Response::error($e->getMessage(), $codigo);
}
