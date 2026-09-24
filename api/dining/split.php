<?php
/**
 * División de la cuenta.
 *
 *   GET  ?cuenta=N   El desglose guardado (y lo que hay que cobrar ahora).
 *   POST {session_id, mode, partes:[...] | partes:N | resto_partes:N}
 *
 * Formas de dividir (decisión del dueño, 15-sep-2026: "una ventana con desglose y una
 * persona decide cómo"):
 *
 *   by_person  cada quien paga lo que pidió desde su celular
 *   equal      partes iguales entre los comensales (los centavos se reparten, no se pierden)
 *   by_items   manual por platillos: se dice qué ítems paga cada parte y queda el rastro
 *   by_amount  "yo pongo 200 y ustedes el resto"
 *   manual     montos a mano; tienen que sumar exacto el total
 *
 * La división se GUARDA (no se recalcula al vuelo): el desglose que se le muestra al
 * cliente es el que se cobra. La suma de las partes tiene que cuadrar con el total o el
 * servidor la rechaza.
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

Cors::apply();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

$db = new Database();
$auth = new Auth($db);
$apiAuth = new ApiAuth($db);

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
        if (($actor['via'] ?? '') === 'session') {
            $permitidos = [ROLE_SUPER_ADMIN, ROLE_ADMIN, ROLE_MANAGER, ROLE_CASHIER, ROLE_WAITER];
            if (!in_array($actor['role'], $permitidos, true)) {
                Response::error('Permisos insuficientes para dividir la cuenta', 403);
            }
        } else {
            $apiAuth->requireScope($actor, 'write');
        }

        $data = json_decode(file_get_contents('php://input'), true);
        if (!$data) { Response::validationError(['body' => 'JSON inválido']); }

        $session_id = (int)($data['session_id'] ?? 0);
        if ($session_id <= 0) { Response::validationError(['session_id' => 'Requerido']); }

        $mode = isset($data['mode']) ? (string)$data['mode'] : '';
        $opciones = [];
        if (isset($data['partes'])) {
            // 'partes' puede ser el número de partes (iguales) o la lista de partes.
            $opciones['partes'] = is_numeric($data['partes']) ? (int)$data['partes'] : $data['partes'];
        }
        if (isset($data['resto_partes'])) { $opciones['resto_partes'] = (int)$data['resto_partes']; }
        if (isset($data['etiquetas'])) { $opciones['etiquetas'] = $data['etiquetas']; }

        $resultado = $service->dividir(
            (int)$actor['store_id'],
            $session_id,
            $mode,
            $opciones,
            (int)$actor['user_id']
        );
        Response::success($resultado, 'Cuenta dividida');

    } else {
        Response::error('Método no permitido', 405);
    }

} catch (SaleValidationException $e) {
    Response::validationError($e->getErrors());
} catch (Exception $e) {
    $codigo = (int)$e->getCode();
    if ($codigo < 400 || $codigo > 599) { $codigo = 500; }
    Response::error('No se pudo dividir la cuenta: ' . $e->getMessage(), $codigo);
}
