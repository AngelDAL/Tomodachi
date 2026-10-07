<?php
/**
 * Seguimiento público de un pedido de mostrador.
 *
 *   GET ?t=<token>   -> { order: {number, customer_name, status, items, total, ...} }
 *
 * Es público (sin sesión), como la carta: el token es la llave (un UUID no adivinable) y
 * solo devuelve el pedido de ese token, sin exponer tienda ni nada interno. Sin cache para
 * no dejar un estado viejo en el teléfono del cliente.
 */

require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/CounterService.class.php';
require_once '../../includes/WebPush.class.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    Response::error('Método no permitido', 405);
}

$token = trim((string)($_GET['t'] ?? ''));
if ($token === '') {
    Response::notFound('Falta el identificador del pedido');
}

try {
    $db = new Database();
    $counter = new CounterService($db);
    $pedido = $counter->track($token);
    if (!$pedido) {
        Response::notFound('No encontramos ese pedido. Revisa el enlace o pide al personal uno nuevo.');
    }
    // La clave pública VAPID es pública por diseño: la página la necesita para suscribirse a
    // los avisos push. Si no está configurada, se manda vacía y la página ofrece solo el aviso
    // en vivo.
    Response::success([
        'order'            => $pedido,
        'vapid_public_key' => WebPush::habilitado() ? WebPush::clavePublica() : '',
    ]);
} catch (Exception $e) {
    Response::error('No se pudo leer el pedido: ' . $e->getMessage(), 500);
}
