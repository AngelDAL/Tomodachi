<?php
/**
 * Estaciones — dónde se prepara, y cómo sale cada comanda.
 *
 * Una estación es "Cocina", "Barra", "Plancha"... y su SALIDA es cómo llega la comanda
 * ahí: pantalla, impresora, las dos, o ninguna.
 *
 * DECISIÓN DE PRODUCTO (modularidad, no adorno): un negocio sin preparación —una tienda,
 * una barbería, un local de servicios— NO tiene ninguna estación. Eso es un estado válido:
 * sus pedidos generan comandas en un solo montón (`station_id` NULL), el tablero de
 * preparación no filtra y nadie "prepara" nada. Por eso aquí no se siembra una "Cocina"
 * por defecto: inventársela a un negocio que no cocina es ruido en su pantalla.
 *
 *   GET                      Lista de estaciones con sus salidas y cuántos productos tiene
 *   GET  ?productos=N        Los productos que se preparan en la estación N
 *   POST {action:'guardar', station_id?, name, sort_order?, salidas?}
 *   POST {action:'activar', station_id, is_active}
 *   POST {action:'borrar',  station_id}          Solo si nunca se usó (si no, se apaga)
 *   POST {action:'asignar', station_id, product_ids:[], quitar_ids:[]}
 *
 * Permisos: los mismos que administrar puntos de servicio (ROLES_PUNTOS_SERVICIO): es
 * organizar el piso, no tocar dinero. Operar la preparación NO requiere esto: marcar una
 * comanda como lista lo puede hacer cualquier persona autenticada (ver comandas.php).
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';
require_once '../../includes/DiningSession.class.php';
require_once '../../includes/WsToken.class.php';
require_once '../../includes/ComandaService.class.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

$db = new Database();
$auth = new Auth($db);
$apiAuth = new ApiAuth($db);

/**
 * ¿Quién puede dar de alta estaciones y decidir qué se prepara dónde?
 *
 * Misma regla que los puntos de servicio (api/dining/tables.php): quien organiza el piso.
 * El mesero puede montar la barra que acaban de instalar sin ser administrador, y los
 * tokens de API pasan con scope `write` porque se emiten a propósito y con permisos
 * explícitos (exigirles además un rol de sesión rompería la automatización).
 */
function puedeAdministrarEstaciones($apiAuth, $actor) {
    if (!$actor) {
        return false;
    }
    if ($actor['via'] === 'token') {
        return $apiAuth->hasScope($actor, 'write');
    }
    $roles = explode(',', ROLES_PUNTOS_SERVICIO);
    return in_array((string)($actor['role'] ?? ''), $roles, true);
}

try {
    $comandas = new ComandaService($db);
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    $actor = $apiAuth->requireActor($auth);
    $store_id = (int)($actor['store_id'] ?? 0);
    if ($store_id <= 0) {
        Response::unauthorized('Tu usuario no tiene tienda asignada');
    }

    if ($method === 'GET') {
        $apiAuth->requireScope($actor, 'read');

        $productos_de = (int)($_GET['productos'] ?? 0);
        if ($productos_de > 0) {
            Response::success([
                'station_id' => $productos_de,
                'productos'  => $comandas->productosDeEstacion($store_id, $productos_de),
            ]);
        }

        Response::success([
            'estaciones'   => $comandas->estaciones($store_id, false),
            'sin_estacion' => $comandas->contarSinEstacion($store_id),
        ]);
    }

    if ($method !== 'POST') {
        Response::error('Método no permitido', 405);
    }

    $apiAuth->requireScope($actor, 'write');
    if (!puedeAdministrarEstaciones($apiAuth, $actor)) {
        Response::error('Tu rol no puede administrar las estaciones. Pídelo a un administrador', 403);
    }

    $data = json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) {
        $data = [];
    }
    $action = (string)($data['action'] ?? '');

    switch ($action) {
        case 'guardar':
            $r = $comandas->guardarEstacion($store_id, $data);
            $nombre = trim((string)($data['name'] ?? ''));
            Response::success($r, 'Estación guardada: ' . $nombre);

        case 'activar':
            $station_id = (int)($data['station_id'] ?? 0);
            if ($station_id <= 0) {
                Response::validationError(['station_id' => 'Falta la estación']);
            }
            $activa = !empty($data['is_active']);
            $r = $comandas->activarEstacion($station_id, $store_id, $activa);
            Response::success($r, $activa ? 'Estación activada' : 'Estación desactivada');

        case 'borrar':
            $station_id = (int)($data['station_id'] ?? 0);
            if ($station_id <= 0) {
                Response::validationError(['station_id' => 'Falta la estación']);
            }
            Response::success($comandas->borrarEstacion($station_id, $store_id), 'Estación borrada');

        case 'asignar':
            $station_id = (int)($data['station_id'] ?? 0);
            if ($station_id <= 0) {
                Response::validationError(['station_id' => 'Falta la estación']);
            }
            $r = $comandas->asignarProductos(
                $store_id,
                $station_id,
                is_array($data['product_ids'] ?? null) ? $data['product_ids'] : [],
                is_array($data['quitar_ids'] ?? null) ? $data['quitar_ids'] : []
            );
            Response::success($r, 'Productos actualizados');

        default:
            Response::validationError(['action' => 'Acción no reconocida']);
    }

} catch (Exception $e) {
    $codigo = (int)$e->getCode();
    if ($codigo < 400 || $codigo > 599) {
        $codigo = 500;
    }
    Response::error('No se pudo guardar la estación: ' . $e->getMessage(), $codigo);
}
