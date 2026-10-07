<?php
/**
 * Pedidos de mostrador — la cajera anota, la cocina ve, el cliente sigue por QR.
 *
 *   GET                       Pedidos del día (activos primero). Con ?historico=1 incluye cerrados.
 *   GET  ?orden=N             Un pedido con sus artículos.
 *   POST {action:'preview', items:[{product_id, quantity}]}
 *                             Solo calcula (aplica promociones) para la vista previa. Scope read.
 *   POST {action:'create', customer_name?, notes?, items:[{product_id, quantity, notes?}]}
 *   POST {action:'status',  counter_order_id, status:'ready'|'completed'|'cancelled', reason?}
 *   POST {action:'notify',  counter_order_id}   Avisa al cliente (deja el pedido en 'ready').
 *   POST {action:'payment', counter_order_id, payment_status:'unpaid'|'partial'|'paid', paid_amount?}
 *
 * Regla de oro: NO se puede pasar a 'completed' sin haber avisado antes (status 'ready'),
 * porque si no el cliente nunca se entera de que su pedido está hecho.
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
        // Para el LECTOR DE QR de la caja: se busca por el token que trae el código del
        // cliente. Se acepta el token suelto o la URL completa del seguimiento.
        $token = trim((string)($_GET['token'] ?? ''));
        if ($token !== '') {
            $pedido = $counter->obtenerPorToken(limpiarToken($token), $store_id);
            if (!$pedido) {
                Response::notFound('Ese código no es de un pedido de esta tienda');
            }
            Response::success($pedido);
        }
        Response::success($counter->listar($store_id, empty($_GET['historico'])));
    } elseif ($method === 'POST') {
        $data = json_decode(file_get_contents('php://input'), true);
        if (!is_array($data)) {
            $data = [];
        }
        $action = (string)($data['action'] ?? '');

        // Vista previa: solo calcula (aplica promociones), no guarda nada -> basta scope read.
        if ($action === 'preview') {
            [$actor, $store_id] = actorDeTienda($apiAuth, $auth, 'read');
            Response::success($counter->preview($store_id, $data['items'] ?? []));
        }

        [$actor, $store_id] = actorDeTienda($apiAuth, $auth, 'write');

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
            $mensaje = $pedido['status'] === 'ready' ? 'Cliente avisado: pedido listo'
                : ($pedido['status'] === 'completed' ? 'Pedido entregado' : 'Pedido cancelado');
            Response::success($pedido, $mensaje);
        }

        // Avisar que está listo (equivale a status:'ready', pero con su propia acción para que
        // el botón de la cajera se lea "Avisar").
        if ($action === 'notify') {
            $pedido = $counter->notificar((int)($data['counter_order_id'] ?? 0), $store_id);
            Response::success($pedido, 'Cliente avisado: pedido listo');
        }

        // Estado de pago: por cobrar / con adelanto / pagado completo.
        if ($action === 'payment') {
            $pedido = $counter->marcarPago(
                (int)($data['counter_order_id'] ?? 0),
                $store_id,
                $data['payment_status'] ?? '',
                $data['paid_amount'] ?? null
            );
            Response::success($pedido, 'Pago actualizado');
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

/** Acepta el token suelto o la URL completa del seguimiento y devuelve solo el token. */
function limpiarToken($valor) {
    $valor = trim((string)$valor);
    if (strpos($valor, 't=') !== false) {
        $q = parse_url($valor, PHP_URL_QUERY);
        if ($q) {
            parse_str($q, $params);
            if (!empty($params['t'])) {
                return trim((string)$params['t']);
            }
        }
    }
    return $valor;
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
