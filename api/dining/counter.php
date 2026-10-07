<?php
/**
 * Pedidos de mostrador — la cajera anota, la cocina ve, el cliente sigue por QR.
 *
 *   GET                       Pedidos del día (pendientes primero, luego cerrados).
 *   GET  ?orden=N             Un pedido con sus artículos.
 *   POST {action:'create', customer_name?, notes?, items:[{product_id, quantity, notes?}]}
 *   POST {action:'status',  counter_order_id, status:'completed'|'cancelled', reason?}
 *
 * El estado lo cambia la CAJERA (scope write): los cocineros no tocan pantalla. El
 * seguimiento del cliente es público y va por api/counter/track.php (sin sesión).
 */

require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';
require_once '../../includes/CounterService.class.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

$db = new Database();
$auth = new Auth($db);
$apiAuth = new ApiAuth($db);

try {
    $counter = new CounterService($db);
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        [$actor, $store_id] = actorDeTienda($apiAuth, $auth, 'read');
        $orden = (int)($_GET['orden'] ?? 0);
        if ($orden > 0) {
            $pedido = $counter->obtener($orden, $store_id);
            if (!$pedido) {
                Response::notFound('Ese pedido no existe en esta tienda');
            }
            Response::success($pedido);
        }
        Response::success($counter->listar($store_id, empty($_GET['historico'])));
    } elseif ($method === 'POST') {
        [$actor, $store_id] = actorDeTienda($apiAuth, $auth, 'write');
        $data = json_decode(file_get_contents('php://input'), true);
        if (!is_array($data)) {
            $data = [];
        }
        $action = (string)($data['action'] ?? '');

        if ($action === 'create') {
            $pedido = $counter->crear(
                $store_id,
                $data['customer_name'] ?? null,
                $data['items'] ?? [],
                $data['notes'] ?? null,
                (int)($actor['user_id'] ?? 0)
            );
            Response::success($pedido, 'Pedido registrado');
        }

        if ($action === 'status') {
            $pedido = $counter->cambiarEstado(
                (int)($data['counter_order_id'] ?? 0),
                $store_id,
                $data['status'] ?? '',
                $data['reason'] ?? null,
                (int)($actor['user_id'] ?? 0)
            );
            Response::success($pedido, $pedido['status'] === 'completed' ? 'Pedido completado' : 'Pedido cancelado');
        }

        Response::validationError(['action' => 'Acción no reconocida']);
    } else {
        Response::error('Método no permitido', 405);
    }
} catch (Exception $e) {
    $codigo = (int)$e->getCode();
    if ($codigo < 400 || $codigo > 599) {
        $codigo = 500;
    }
    Response::error('No se pudo procesar el pedido: ' . $e->getMessage(), $codigo);
}

/** Actor autenticado con su tienda y el scope pedido. */
function actorDeTienda($apiAuth, $auth, $scope) {
    $actor = $apiAuth->requireActor($auth);
    $apiAuth->requireScope($actor, $scope);
    $store_id = (int)($actor['store_id'] ?? 0);
    if ($store_id <= 0) {
        Response::unauthorized('Tu usuario no tiene tienda asignada');
    }
    return [$actor, $store_id];
}
