<?php
/**
 * Cobro de la cuenta — el cierre del servicio.
 *
 * Aquí termina el ciclo del salón: la cuenta que se abrió, se pidió y se sirvió se
 * convierte en UNA venta con N pagos, y el dinero entra a la caja por el mismo camino
 * que el POS (SaleService). Antes de esto no había forma de cobrar una cuenta.
 *
 *   GET  ?cuenta=N   Lo que hay que cobrar AHORA: líneas, total, propina, partes.
 *                    Lo usa la pantalla del piso para mostrar el desglose antes de cobrar.
 *   POST {session_id, payments:[{method, amount, reference?, share_id?}], tip_amount?,
 *         tip_method?, customer_id?, discount?, register_id?, notes?}
 *
 * Reglas que aplica el servidor (no el navegador):
 *   - El importe sale de la cuenta, no de la petición: si el total cambió, se rechaza.
 *   - La suma de los pagos tiene que cuadrar con el total. No se cierra con dinero faltante:
 *     si algo queda pendiente, el personal le asigna método (efectivo, transferencia o fiado).
 *   - La propina es OPCIONAL y va aparte del consumo. Nunca puede quedar fiada.
 *   - El cobro es idempotente: dos meseros cobrando a la vez producen UNA venta; el segundo
 *     recibe un error claro.
 *
 * Permisos: es trabajo de piso (el mesero cobra en la mesa), pero toca dinero, así que se
 * exige personal autenticado con scope `write` y uno de los roles que manejan caja.
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Cors.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';
require_once '../../includes/DiningSession.class.php';
require_once '../../includes/ChargeService.class.php';
require_once '../../includes/WsToken.class.php';

Cors::apply();
header('Content-Type: application/json; charset=utf-8');
// El dinero nunca se cachea.
header('Cache-Control: no-store, max-age=0');

$db = new Database();
$auth = new Auth($db);
$apiAuth = new ApiAuth($db);

/** Roles que pueden cobrar una cuenta. El mesero cobra en la mesa: es su trabajo. */
function exigirPermisoDeCobro($actor, $apiAuth) {
    if (($actor['via'] ?? '') === 'session') {
        $permitidos = [ROLE_SUPER_ADMIN, ROLE_ADMIN, ROLE_MANAGER, ROLE_CASHIER, ROLE_WAITER];
        if (!in_array($actor['role'], $permitidos, true)) {
            Response::error('Permisos insuficientes para cobrar', 403);
        }
        return;
    }
    $apiAuth->requireScope($actor, 'write');
}

try {
    $service = new ChargeService($db, new DiningSession($db));
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        $actor = $apiAuth->requireActor($auth);
        $apiAuth->requireScope($actor, 'read');
        $cuenta = (int)($_GET['cuenta'] ?? 0);
        if ($cuenta <= 0) { Response::validationError(['cuenta' => 'Requerido']); }
        Response::success($service->resumen((int)$actor['store_id'], $cuenta));

    } elseif ($method === 'POST') {
        $actor = $apiAuth->requireActor($auth);
        exigirPermisoDeCobro($actor, $apiAuth);

        $data = json_decode(file_get_contents('php://input'), true);
        if (!$data) { Response::validationError(['body' => 'JSON inválido']); }

        $session_id = (int)($data['session_id'] ?? 0);
        if ($session_id <= 0) { Response::validationError(['session_id' => 'Requerido']); }

        $payments = [];
        if (isset($data['payments']) && is_array($data['payments'])) {
            foreach ($data['payments'] as $p) {
                $payments[] = [
                    'method'    => isset($p['method']) ? (string)$p['method'] : '',
                    'amount'    => isset($p['amount']) ? (float)$p['amount'] : 0.0,
                    'reference' => $p['reference'] ?? null,
                    'is_tip'    => !empty($p['is_tip']),
                    'share_id'  => isset($p['share_id']) ? (int)$p['share_id'] : null,
                ];
            }
        }
        // Un pago suelto (payment_method + amount) también es válido: es lo que hace la
        // pantalla cuando el cobro es de un solo método y sin divisiones.
        if (!$payments && !empty($data['payment_method'])) {
            $payments[] = [
                'method' => (string)$data['payment_method'],
                'amount' => isset($data['amount']) ? (float)$data['amount'] : null,
                'reference' => $data['reference'] ?? null,
            ];
            // Sin monto explícito se completa con el total de la cuenta (una sola forma).
            if ($payments[0]['amount'] === null) {
                $resumen = $service->resumen((int)$actor['store_id'], $session_id);
                $payments[0]['amount'] = round($resumen['total'] + (float)($data['tip_amount'] ?? 0), 2);
                $payments[0]['is_tip'] = false;
            }
        }
        if (!$payments) { Response::validationError(['payments' => 'Falta la forma de pago']); }

        $resultado = $service->cobrar((int)$actor['store_id'], $session_id, [
            'payments'      => $payments,
            'tip_amount'    => isset($data['tip_amount']) ? (float)$data['tip_amount'] : 0.0,
            'tip_method'    => $data['tip_method'] ?? null,
            'customer_id'   => isset($data['customer_id']) ? (int)$data['customer_id'] : 0,
            'discount'      => isset($data['discount']) ? (float)$data['discount'] : null,
            'register_id'   => isset($data['register_id']) ? (int)$data['register_id'] : 0,
            'notes'         => $data['notes'] ?? null,
            // Efectivo que entregó el cliente: de ahí salen el cambio y el desglose
            // (consumo por un lado, propina por otro).
            'cash_received' => isset($data['cash_received']) ? (float)$data['cash_received'] : 0.0,
        ], $actor);

        Response::success([
            'sale_id'        => $resultado['sale_id'],
            'session_id'     => $resultado['session_id'],
            'total'          => $resultado['total'],
            'tip_amount'     => $resultado['tip_amount'],
            'amount_paid'    => $resultado['amount_paid'],
            'debt'           => $resultado['debt'],
            'change'         => $resultado['change'],
            'payment_method' => $resultado['payment_method'],
            'payments'       => $resultado['payments'],
        ], 'Cuenta cobrada');

    } else {
        Response::error('Método no permitido', 405);
    }

} catch (SaleValidationException $e) {
    Response::validationError($e->getErrors());
} catch (Exception $e) {
    $codigo = (int)$e->getCode();
    if ($codigo < 400 || $codigo > 599) { $codigo = 500; }
    Response::error('No se pudo cobrar la cuenta: ' . $e->getMessage(), $codigo);
}
