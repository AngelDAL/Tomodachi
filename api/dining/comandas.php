<?php
/**
 * Comandas — el tablero de preparación.
 *
 * Es la ronda que se manda a cocina/barra: folio del día, estación, estado y qué se
 * prepara. NO es la cuenta (esa es `api/dining/session.php`) ni el cobro (ese es el POS).
 *
 *   GET  ?estacion=N         Tablero (comandas vivas). Sin `estacion` las muestra todas.
 *   GET  ?historicas=1       Incluye las servidas y anuladas del día de negocio.
 *   GET  ?comanda=N          Una comanda con sus ítems.
 *   GET  ?catalogo=N         Los productos que se preparan en la estación N.
 *   POST {action:'start',   comanda_id}   sent      -> preparing
 *   POST {action:'ready',   comanda_id}   sent/prep -> ready
 *   POST {action:'served',  comanda_id}   hasta ready -> served
 *   POST {action:'cancel',  comanda_id, reason}  Anula la comanda con motivo
 *   POST {action:'print',   comanda_id}   Deja rastro de que salió por impresora
 *
 * Permisos: operar la preparación es trabajo de PISO (el mismo que abre una cuenta y
 * anota), así que basta ser personal autenticado con scope `write`. No se exige un rol
 * especial: la cocina no necesita ser administrador para marcar un platillo como listo.
 *
 * Los avisos al WebSocket son best-effort: si el relay no está, la comanda ya se guardó.
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
// El tablero cambia con cada platillo: nunca cachear.
header('Cache-Control: no-store, max-age=0');

$db = new Database();
$auth = new Auth($db);
$apiAuth = new ApiAuth($db);

try {
    $comandas = new ComandaService($db);
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        handleGet($db, $comandas, $apiAuth, $auth);
    } elseif ($method === 'POST') {
        handlePost($comandas, $apiAuth, $auth);
    } else {
        Response::error('Método no permitido', 405);
    }

} catch (Exception $e) {
    $codigo = (int)$e->getCode();
    if ($codigo < 400 || $codigo > 599) {
        $codigo = 500;
    }
    Response::error('No se pudo procesar la comanda: ' . $e->getMessage(), $codigo);
}

// ============================================================
// GET: el tablero de preparación
// ============================================================
function handleGet($db, $comandas, $apiAuth, $auth) {
    [$actor, $store_id] = actorDeTienda($apiAuth, $auth, 'read');

    // Una comanda concreta.
    $comanda_id = (int)($_GET['comanda'] ?? 0);
    if ($comanda_id > 0) {
        $comanda = $comandas->obtener($comanda_id, $store_id);
        if (!$comanda) {
            Response::notFound('Esa comanda no existe en esta tienda');
        }
        Response::success($comanda);
    }

    // Los productos que le tocan a una estación (para repartir el catálogo).
    $catalogo = (int)($_GET['catalogo'] ?? 0);
    if ($catalogo > 0) {
        Response::success([
            'station_id' => $catalogo,
            'productos'  => $comandas->productosDeEstacion($store_id, $catalogo),
        ]);
    }

    $tablero = $comandas->tablero($store_id, [
        'station_id' => (int)($_GET['estacion'] ?? 0),
        'historicas' => !empty($_GET['historicas']),
    ]);

    Response::success($tablero);
}

// ============================================================
// POST: avanzar, anular, imprimir
// ============================================================
function handlePost($comandas, $apiAuth, $auth) {
    [$actor, $store_id] = actorDeTienda($apiAuth, $auth, 'write');

    $data = json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) {
        $data = [];
    }

    $action = (string)($data['action'] ?? '');
    $comanda_id = (int)($data['comanda_id'] ?? 0);
    if ($comanda_id <= 0) {
        Response::validationError(['comanda_id' => 'Falta la comanda']);
    }

    $user_id = (int)($actor['user_id'] ?? 0);
    $user_id = $user_id > 0 ? $user_id : null;

    switch ($action) {
        case 'start':
        case 'ready':
        case 'served':
            $comanda = $comandas->avanzar($comanda_id, $store_id, $action, $user_id);
            Response::success($comanda, mensajeDeAvance($action));

        case 'print':
            Response::success($comandas->marcarImpreso($comanda_id, $store_id), 'Impresión registrada');

        case 'cancel':
            $motivo = trim((string)($data['reason'] ?? ''));
            if ($motivo === '') {
                // El motivo es obligatorio: un platillo que ya entró a la cocina se anula
                // dejando escrito por qué. Es dinero y es merma.
                Response::validationError(['reason' => 'Escribe por qué se anula la comanda']);
            }
            Response::success($comandas->anular($comanda_id, $store_id, $motivo, $user_id), 'Comanda anulada');

        default:
            Response::validationError(['action' => 'Acción no reconocida']);
    }
}

function mensajeDeAvance($action) {
    $mapa = [
        'start'  => 'La cocina empezó la comanda',
        'ready'  => 'Comanda lista',
        'served' => 'Comanda entregada',
    ];
    return $mapa[$action] ?? 'Comanda actualizada';
}

/**
 * Personal autenticado de una tienda.
 *
 * Devuelve [actor, store_id]. El `store_id` sale SIEMPRE del actor, nunca de la petición:
 * así nadie mira ni mueve comandas de otra tienda mandando un número.
 */
function actorDeTienda($apiAuth, $auth, $scope) {
    $actor = $apiAuth->requireActor($auth);
    $apiAuth->requireScope($actor, $scope);
    $store_id = (int)($actor['store_id'] ?? 0);
    if ($store_id <= 0) {
        Response::unauthorized('Tu usuario no tiene tienda asignada');
    }
    return [$actor, $store_id];
}
