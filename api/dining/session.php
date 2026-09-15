<?php
/**
 * Cuenta por mesa — estado público y acciones de la cuenta.
 *
 * PÚBLICO (comensal, sin login), autenticado por el `public_token` de la carta:
 *   GET  /api/dining/session.php?menu_token=<public_token>&code=<codigo>
 *        -> estado público de la cuenta abierta, o {session:null}.
 *   POST {"action":"open","menu_token":"..."}
 *        -> abre cuenta (SOLO si el menú es mode='order_and_pay').
 *   POST {"action":"join","menu_token":"...","code":"...","display_name":"..."}
 *        -> suma un comensal; devuelve su join_token.
 *
 * SOLO PERSONAL (requireActor + scope write):
 *   GET  /api/dining/session.php?abiertas=1
 *        -> cuentas abiertas de la tienda (lo que pinta el mapa de puntos de servicio)
 *   POST {"action":"open","table_id":N,"menu_id":N?,"customer_id":N?,"notes":"..."}
 *        -> abre la cuenta de un punto de servicio (el personal sí puede en cualquier modo)
 *   POST {"action":"add_point","session_id":N,"table_id":M}
 *        -> JUNTAR: suma otro punto de servicio a la misma cuenta (una cuenta, un cobro)
 *   POST {"action":"remove_point","session_id":N,"table_id":M}
 *        -> separa un punto juntado (el punto principal no se quita: se mueve la cuenta)
 *   POST {"action":"pause"|"resume","session_id":N}
 *   POST {"action":"close","session_id":N}
 *   POST {"action":"cancel","session_id":N,"reason":"..."}   (con motivo, queda registrado)
 *
 * Por qué 'open' se restringe a order_and_pay: en ese modo el comensal paga por
 * adelantado, así que no hay riesgo de abuso. En 'open_tab' la cuenta se cobra
 * al final y abrirla a ciegas por cualquiera sería un problema: la abre el
 * personal (que es quien controla la mesa).
 */

require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';
require_once '../../includes/Cors.class.php';
require_once '../../includes/DiningSession.class.php';
require_once '../../includes/UrlHelper.class.php';

Cors::apply();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

$db = new Database();
$auth = new Auth($db);
$apiAuth = new ApiAuth($db);

try {
    $dining = new DiningSession($db);
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        handleGet($db, $dining, $auth, $apiAuth);
    } elseif ($method === 'POST') {
        handlePost($db, $dining, $auth, $apiAuth);
    } else {
        Response::error('Método no permitido', 405);
    }

} catch (Exception $e) {
    Response::error('No se pudo procesar la cuenta: ' . $e->getMessage(), 500);
}

// ============================================================
// GET: estado público de la cuenta
// ============================================================
function handleGet($db, $dining, $auth = null, $apiAuth = null) {
    // El mapa de puntos de servicio pide la lista de cuentas abiertas. Es personal.
    if (!empty($_GET['abiertas'])) {
        $actor = $apiAuth->requireActor($auth);
        $apiAuth->requireScope($actor, 'read');
        $store_id = (int)$actor['store_id'];
        $checks = listOpenChecks($db, $store_id);
        Response::success([
            'checks' => $checks,
            'totales' => [
                'abiertas' => count($checks),
                'personas' => array_sum(array_map(fn($c) => (int)$c['personas'], $checks)),
                'importe'   => round(array_sum(array_map(fn($c) => (float)$c['total'], $checks)), 2),
            ],
        ]);
    }

    // Detalle de UNA cuenta para el personal: ítems y personas, para el modal del mapa.
    if (!empty($_GET['cuenta'])) {
        $actor = $apiAuth->requireActor($auth);
        $apiAuth->requireScope($actor, 'read');
        $store_id = (int)$actor['store_id'];
        $session_id = (int)$_GET['cuenta'];

        $session = fetchStoreSession($db, $session_id, $store_id);
        if (!$session) {
            Response::notFound('Cuenta no encontrada');
        }
        $full = $dining->listSession($session_id);
        $conn = $db->getConnection();

        // listSession entrega la fila de la sesión ANIDADA (`session`) porque el cliente del
        // comensal lee `cuenta.session.ordering_enabled`. Aquí se aplana a un solo nivel: la
        // pantalla del personal lee `session.code`, `session.ordering_enabled` y compañía.
        $cabecera = $full['session'];
        $cabecera['participants'] = $full['participants'];
        $cabecera['items'] = $full['items'];
        $cabecera['totals'] = $full['totals'];
        $cabecera['ordering_enabled'] = $cabecera['ordering_enabled'] ? 1 : 0;

        // Los minutos se calculan en la BASE: el reloj del navegador va en otra zona que la
        // base y restarlos daba cuentas abiertas "hace 0 minutos".
        $stmt = $conn->prepare("SELECT TIMESTAMPDIFF(MINUTE, opened_at, NOW()) FROM dining_sessions
                                WHERE session_id = :sid AND store_id = :store_id");
        $stmt->execute([':sid' => $session_id, ':store_id' => $store_id]);
        $minutos = (int)$stmt->fetchColumn();

        Response::success([
            'session'         => $cabecera,
            'puntos'          => puntosDeCuenta($conn, $session_id),
            'minutos_abierta' => $minutos,
            'notas'           => $session['notes'],
            'split_mode'      => $session['split_mode'],
            'customer_id'     => $session['customer_id'] !== null ? (int)$session['customer_id'] : null,
            // El enlace "ya autorizado": la carta de la tienda con el código de ESTA cuenta.
            // El mesero lo muestra como QR y el cliente entra directo a pedir a su mesa, sin
            // escribir nada; la otra opción es el QR impreso de la mesa y que el personal
            // autorice el código a mano.
            'url_cuenta'      => urlCuentaDeCliente($conn, $store_id, (int)$cabecera['menu_id'], (string)$cabecera['code']),
        ]);
    }

    $menu = resolvePublicMenu($db, trim($_GET['menu_token'] ?? ''));
    if (!$menu) {
        Response::notFound('Esta carta no está disponible');
    }

    $code = strtoupper(trim($_GET['code'] ?? ''));
    if ($code === '') {
        // Sin código no hay cuenta que mostrar: el frontend decide qué hacer.
        Response::success(['session' => null]);
    }

    $session = $dining->getOrFindSession((int)$menu['store_id'], (int)$menu['menu_id'], $code);
    if (!$session) {
        // No es un error: el comensal aún no se ha unido o la cuenta no existe.
        Response::success(['session' => null]);
    }

    $full = $dining->listSession((int)$session['session_id']);
    Response::success(['session' => publicSession($full)]);
}

// ============================================================
// POST: open / join (público) y pause / resume / close (personal)
// ============================================================
function handlePost($db, $dining, $auth, $apiAuth) {
    $data = json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) {
        $data = [];
    }
    $action = $data['action'] ?? '';

    switch ($action) {
        case 'open':
            actionOpen($db, $dining, $data);
            break;

        case 'join':
            actionJoin($db, $dining, $data);
            break;

        case 'pause':
        case 'resume':
            actionPauseResume($db, $apiAuth, $auth, $action, $data);
            break;

        case 'close':
            actionClose($db, $dining, $apiAuth, $auth, $data);
            break;

        // Acción aparte de 'open' a propósito: 'open' es del comensal y solo vale en
        // cartas order_and_pay. Si aceptara table_id, un comensal podría abrirse una
        // cuenta con mesa sin pasar por el personal.
        case 'open_table':
            actionOpenTable($db, $dining, $apiAuth, $auth, $data);
            break;

        case 'add_point':
            actionPointJuntar($db, $apiAuth, $auth, $data, true);
            break;

        case 'remove_point':
            actionPointJuntar($db, $apiAuth, $auth, $data, false);
            break;

        case 'cancel':
            actionCancel($db, $dining, $apiAuth, $auth, $data);
            break;

        default:
            Response::error('Acción inválida', 422);
    }
}

// ============================================================
// Cuentas por punto de servicio (personal)
// ============================================================

/**
 * Abre la cuenta de un punto de servicio. El personal sí puede en cualquier modo de carta:
 * es quien manda en el salón.
 */
function actionOpenTable($db, $dining, $apiAuth, $auth, array $data) {
    $actor = $apiAuth->requireActor($auth);
    $apiAuth->requireScope($actor, 'write');
    $store_id = (int)$actor['store_id'];
    $user_id  = (int)($actor['user_id'] ?? 0);
    $conn = $db->getConnection();

    $table_id = (int)($data['table_id'] ?? 0);
    if ($table_id <= 0) Response::validationError(['table_id' => 'Falta el punto de servicio']);

    $punto = fetchPunto($conn, $table_id, $store_id);
    if (!$punto) Response::notFound('Punto de servicio no encontrado');
    if ((int)$punto['is_active'] !== 1) Response::error('Ese punto está desactivado', 409);

    $ocupada = cuentaPorPunto($conn, $store_id, $table_id);
    if ($ocupada) {
        Response::error('Ese punto ya tiene la cuenta ' . $ocupada['code'] . ' abierta', 409);
    }

    // Carta de la cuenta: la que elija el personal o, si no, la primera activa que acepte
    // pedidos. Puede quedar sin carta: la cuenta existe igual y el comensal solo no podrá
    // pedir desde su celular.
    $menu_id = (int)($data['menu_id'] ?? 0);
    if ($menu_id <= 0) {
        $stmt = $conn->prepare(
            "SELECT menu_id FROM menus
             WHERE store_id = :store_id AND is_active = 1 AND mode IN ('open_tab','order_and_pay')
             ORDER BY menu_id ASC LIMIT 1"
        );
        $stmt->execute([':store_id' => $store_id]);
        $menu_id = (int)($stmt->fetchColumn() ?: 0);
    }

    $customer_id = (int)($data['customer_id'] ?? 0);
    $notas = isset($data['notes']) ? trim((string)$data['notes']) : '';

    $session = $dining->openSession($store_id, $menu_id, $table_id, $user_id);
    $session_id = (int)$session['session_id'];

    // El punto principal también entra en la tabla puente: así "juntar una mesa" es un
    // INSERT más, y el número de puntos de la cuenta sale siempre de la misma consulta.
    $stmt = $conn->prepare("INSERT IGNORE INTO check_service_points (session_id, table_id)
                            VALUES (:sid, :tid)");
    $stmt->execute([':sid' => $session_id, ':tid' => $table_id]);

    if ($customer_id > 0 || $notas !== '') {
        $campos = [];
        $params = [':sid' => $session_id, ':store_id' => $store_id];
        if ($customer_id > 0) { $campos[] = 'customer_id = :cid'; $params[':cid'] = $customer_id; }
        if ($notas !== '')    { $campos[] = 'notes = :notas';      $params[':notas'] = $notas; }
        $conn->prepare("UPDATE dining_sessions SET " . implode(', ', $campos) .
                       " WHERE session_id = :sid AND store_id = :store_id")->execute($params);
    }

    DiningSession::broadcast($session_id, 'session_opened');

    Response::success([
        'session_id' => $session_id,
        'code'       => $session['code'],
        'table_id'   => $table_id,
        'label'      => $punto['label'],
        'menu_id'    => $menu_id > 0 ? $menu_id : null,
        'expires_at' => $session['expires_at'] ?? null,
    ], 'Cuenta abierta en ' . $punto['label'], 201);
}

/**
 * Junta o separa un punto de servicio de una cuenta.
 * Un solo camino para las dos cosas porque comparten todas las validaciones.
 */
function actionPointJuntar($db, $apiAuth, $auth, array $data, $sumar) {
    $actor = $apiAuth->requireActor($auth);
    $apiAuth->requireScope($actor, 'write');
    $store_id = (int)$actor['store_id'];
    $conn = $db->getConnection();

    $session_id = (int)($data['session_id'] ?? 0);
    $table_id   = (int)($data['table_id'] ?? 0);
    if ($session_id <= 0) Response::validationError(['session_id' => 'Falta la cuenta']);
    if ($table_id <= 0)   Response::validationError(['table_id' => 'Falta el punto de servicio']);

    $session = fetchStoreSession($db, $session_id, $store_id);
    if (!$session) Response::notFound('Cuenta no encontrada');
    if (!in_array($session['status'], ['open', 'awaiting_payment'], true)) {
        Response::error('La cuenta ya está cerrada', 409);
    }

    $punto = fetchPunto($conn, $table_id, $store_id);
    if (!$punto) Response::notFound('Punto de servicio no encontrado');
    if ((int)$punto['is_active'] !== 1) Response::error('Ese punto está desactivado', 409);

    // ¿Ya está en ESTA cuenta? Se mira la tabla puente y el punto principal, porque una
    // cuenta vieja puede tener el principal sin fila en la puente.
    $stmt = $conn->prepare("SELECT 1 FROM check_service_points WHERE session_id = :sid AND table_id = :tid");
    $stmt->execute([':sid' => $session_id, ':tid' => $table_id]);
    $en_puente = (bool)$stmt->fetchColumn();
    $es_principal = ((int)$session['table_id'] === $table_id);

    if ($sumar) {
        $otra = cuentaPorPunto($conn, $store_id, $table_id);
        if ($otra && (int)$otra['session_id'] !== $session_id) {
            Response::error('Ese punto ya está en la cuenta ' . $otra['code'], 409);
        }
        if ($en_puente || $es_principal) {
            // Ya estaba: no se duplica, y se dice tal cual en vez de fingir que se juntó.
            Response::success([
                'session_id' => $session_id,
                'puntos'     => puntosDeCuenta($conn, $session_id),
                'cambio'     => false,
            ], $punto['label'] . ' ya estaba en la cuenta ' . $session['code']);
        }
        $stmt = $conn->prepare("INSERT IGNORE INTO check_service_points (session_id, table_id)
                                VALUES (:sid, :tid)");
        $stmt->execute([':sid' => $session_id, ':tid' => $table_id]);
    } else {
        if ($es_principal) {
            Response::error('Ese es el punto principal de la cuenta: no se separa. Mueve la cuenta a otro punto o ciérrala.', 409);
        }
        if (!$en_puente) {
            // Sin esto, separar un punto que no estaba respondía "se separó" sin tocar nada:
            // una operación que no ocurrió no puede reportarse como éxito.
            Response::error('Ese punto no está en esa cuenta', 409);
        }
        $stmt = $conn->prepare("DELETE FROM check_service_points
                                WHERE session_id = :sid AND table_id = :tid");
        $stmt->execute([':sid' => $session_id, ':tid' => $table_id]);
    }

    DiningSession::broadcast($session_id, $sumar ? 'point_joined' : 'point_left');

    $puntos = puntosDeCuenta($conn, $session_id);
    Response::success([
        'session_id' => $session_id,
        'puntos'     => $puntos,
        'cambio'     => true,
    ], $sumar
        ? $punto['label'] . ' se juntó a la cuenta ' . $session['code']
        : $punto['label'] . ' se separó de la cuenta ' . $session['code']);
}

/** Cancela la cuenta con motivo. Queda registrado quién y por qué. */
function actionCancel($db, $dining, $apiAuth, $auth, array $data) {
    $actor = $apiAuth->requireActor($auth);
    $apiAuth->requireScope($actor, 'write');
    $store_id = (int)$actor['store_id'];

    $session_id = (int)($data['session_id'] ?? 0);
    if ($session_id <= 0) Response::validationError(['session_id' => 'Falta la cuenta']);

    $motivo = trim((string)($data['reason'] ?? ''));
    if ($motivo === '') {
        // Sin motivo no se cancela: una cuenta cancelada sin explicación es dinero que
        // nadie puede auditar después.
        Response::validationError(['reason' => 'Escribe por qué se cancela']);
    }

    $session = fetchStoreSession($db, $session_id, $store_id);
    if (!$session) Response::notFound('Cuenta no encontrada');
    if (!in_array($session['status'], ['open', 'awaiting_payment'], true)) {
        Response::error('La cuenta ya está cerrada', 409);
    }

    $closed_by = isset($actor['user_id']) ? (int)$actor['user_id'] : null;
    $nota = ($session['notes'] ? $session['notes'] . ' | ' : '') . 'Cancelada: ' . $motivo;

    $stmt = $db->getConnection()->prepare(
        "UPDATE dining_sessions
         SET status = 'cancelled', closed_at = NOW(), closed_by = :closed_by, notes = :notas
         WHERE session_id = :sid AND store_id = :store_id
           AND status IN ('open','awaiting_payment')"
    );
    $stmt->execute([':closed_by' => $closed_by, ':notas' => $nota,
                    ':sid' => $session_id, ':store_id' => $store_id]);

    DiningSession::broadcast($session_id, 'session_cancelled');

    Response::success(['session_id' => $session_id, 'status' => 'cancelled'], 'Cuenta cancelada');
}

/**
 * Lo que pinta el mapa: las cuentas abiertas de la tienda, con sus puntos de servicio.
 * Los puntos pueden ser varios (mesas juntadas), así que van como lista.
 */
function listOpenChecks($db, $store_id) {
    $stmt = $db->getConnection()->prepare("
        SELECT s.session_id, s.code, s.status, s.ordering_enabled, s.subtotal, s.discount, s.total,
               s.opened_at, s.expires_at, s.notes, s.table_id, s.menu_id, s.customer_id, s.split_mode,
               TIMESTAMPDIFF(MINUTE, s.opened_at, NOW()) AS minutos_abierta,
               (SELECT COUNT(*) FROM dining_participants p
                 WHERE p.session_id = s.session_id AND p.is_active = 1) AS personas,
               (SELECT COUNT(*) FROM dining_order_items i
                 WHERE i.session_id = s.session_id AND i.status <> 'cancelled') AS items,
               (SELECT COUNT(*) FROM dining_order_items i
                 WHERE i.session_id = s.session_id AND i.status = 'pending') AS pendientes_de_enviar
        FROM dining_sessions s
        WHERE s.store_id = :store_id
          AND s.status IN ('open','awaiting_payment')
        ORDER BY s.opened_at ASC
    ");
    $stmt->execute([':store_id' => (int)$store_id]);
    $checks = $stmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($checks as &$c) {
        $puntos = puntosDeCuenta($db->getConnection(), (int)$c['session_id']);
        $c['puntos'] = $puntos;
        $c['puntos_texto'] = implode(', ', array_column($puntos, 'label'));
        $c['minutos_abierta'] = (int)$c['minutos_abierta'];
        $c['personas'] = (int)$c['personas'];
        $c['items'] = (int)$c['items'];
        $c['pendientes_de_enviar'] = (int)$c['pendientes_de_enviar'];
        $c['total'] = (float)$c['total'];
    }
    unset($c);

    return $checks;
}

/**
 * Puntos de servicio de una cuenta, el principal primero.
 *
 * Se leen las DOS fuentes: el punto principal (`dining_sessions.table_id`) y la tabla
 * puente de los juntados. Las cuentas creadas por esta API dejan el principal también en
 * la puente, pero las viejas (o las que abre el comensal) no, y una cuenta no puede
 * perder su punto por eso.
 */
function puntosDeCuenta($conn, $session_id) {
    $stmt = $conn->prepare("
        SELECT t.table_id, t.label, t.zone, t.qr_token,
               (t.table_id = (SELECT table_id FROM dining_sessions WHERE session_id = :sid_uno)) AS es_principal
        FROM dining_tables t
        WHERE t.table_id = (SELECT table_id FROM dining_sessions WHERE session_id = :sid_dos)
           OR t.table_id IN (SELECT csp.table_id FROM check_service_points csp WHERE csp.session_id = :sid_tres)
        ORDER BY es_principal DESC, t.label ASC
    ");
    // Tres marcadores distintos para el mismo valor: PDO con prepares nativos no permite
    // reutilizar un marcador nombrado en la misma consulta (SQLSTATE[HY093]).
    $stmt->execute([':sid_uno' => (int)$session_id, ':sid_dos' => (int)$session_id, ':sid_tres' => (int)$session_id]);
    $puntos = $stmt->fetchAll(PDO::FETCH_ASSOC);
    foreach ($puntos as &$p) {
        $p['es_principal'] = (int)$p['es_principal'];
        $p['table_id'] = (int)$p['table_id'];
    }
    unset($p);
    return $puntos;
}

/** El punto de servicio, solo si es de esta tienda. */
function fetchPunto($conn, $table_id, $store_id) {
    $stmt = $conn->prepare("SELECT * FROM dining_tables
                            WHERE table_id = :tid AND store_id = :store_id LIMIT 1");
    $stmt->execute([':tid' => (int)$table_id, ':store_id' => (int)$store_id]);
    return $stmt->fetch(PDO::FETCH_ASSOC) ?: false;
}

/** Cuenta abierta de un punto: por su `table_id` o porque se juntó a otra cuenta. */
function cuentaPorPunto($conn, $store_id, $table_id) {
    $stmt = $conn->prepare("
        SELECT s.session_id, s.code, s.status
        FROM dining_sessions s
        LEFT JOIN check_service_points csp ON csp.session_id = s.session_id
        WHERE s.store_id = :store_id
          AND s.status IN ('open','awaiting_payment')
          AND (s.table_id = :tabla_directa OR csp.table_id = :tabla_juntada)
        ORDER BY s.opened_at ASC
        LIMIT 1
    ");
    // Dos marcadores distintos para el mismo valor: PDO con prepares nativos no permite
    // reutilizar un marcador nombrado en la misma consulta (SQLSTATE[HY093]).
    $stmt->execute([
        ':store_id' => (int)$store_id,
        ':tabla_directa' => (int)$table_id,
        ':tabla_juntada' => (int)$table_id,
    ]);
    return $stmt->fetch(PDO::FETCH_ASSOC) ?: false;
}

/** Abre una cuenta pública (solo menús order_and_pay). */
function actionOpen($db, $dining, array $data) {
    $menu = resolvePublicMenu($db, trim($data['menu_token'] ?? ''));
    if (!$menu) {
        Response::notFound('Esta carta no está disponible');
    }

    if ($menu['mode'] !== 'order_and_pay') {
        // 'open_tab' (y 'menu_only') exigen que abra el personal.
        Response::error(
            'Esta carta cobra al final: pide al personal que abra la mesa para tu cuenta',
            403
        );
    }

    // opened_by: un comensal no tiene usuario; la clase lo atribuye al admin de
    // la tienda (columna NOT NULL con FK a users).
    $session = $dining->openSession((int)$menu['store_id'], (int)$menu['menu_id'], null, null);

    Response::success(
        ['session_id' => (int)$session['session_id'], 'code' => $session['code']],
        'Cuenta abierta',
        201
    );
}

/** Suma un comensal a una cuenta abierta. */
function actionJoin($db, $dining, array $data) {
    $code = strtoupper(trim($data['code'] ?? ''));
    $menu = resolvePublicMenu($db, trim($data['menu_token'] ?? ''));

    if ($code !== '') {
        // El código identifica la cuenta abierta por sí solo: exigir además el
        // token de la carta rompía el caso real, porque el segundo comensal solo
        // teclea el código que le dictaron.
        // Si además llega el token, se usa para acotar a esa tienda.
        if ($menu) {
            $session = $dining->getOrFindSession((int)$menu['store_id'], (int)$menu['menu_id'], $code);
        } else {
            $conn = $db->getConnection();
            $stmt = $conn->prepare("
                SELECT * FROM dining_sessions
                WHERE code = :code
                  AND status = 'open'
                  AND (expires_at IS NULL OR expires_at > NOW())
                ORDER BY session_id DESC
                LIMIT 1
            ");
            $stmt->execute([':code' => $code]);
            $session = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
        }
    } else {
        // Sin código: la cuenta abierta más reciente de esta carta. Se usa cuando
        // el QR solo trae el menú y hay una sola mesa abierta para esa carta.
        if (!$menu) {
            Response::notFound('Esta carta no está disponible');
        }
        $session = latestOpenSessionForMenu($db, (int)$menu['store_id'], (int)$menu['menu_id']);
    }

    if (!$session) {
        Response::notFound('No encontramos una cuenta abierta. Pide al personal que abra la mesa');
    }

    $participant = $dining->joinParticipant(
        (int)$session['session_id'],
        $data['display_name'] ?? null,
        $data['device_hash'] ?? null
    );

    DiningSession::broadcast((int)$session['session_id'], 'participant_joined');

    Response::success([
        'join_token'     => $participant['join_token'],
        'participant_id' => $participant['participant_id'],
        'session_id'     => (int)$session['session_id'],
        'code'           => $session['code'],
    ], 'Te uniste a la cuenta', 201);
}

/** Pausa o reanuda los pedidos de una cuenta. SOLO personal. */
function actionPauseResume($db, $apiAuth, $auth, $action, array $data) {
    $actor = $apiAuth->requireActor($auth);
    $apiAuth->requireScope($actor, 'write');
    $store_id = (int)$actor['store_id'];

    $session_id = (int)($data['session_id'] ?? 0);
    if ($session_id <= 0) {
        Response::validationError(['session_id' => 'Falta la cuenta']);
    }

    $session = fetchStoreSession($db, $session_id, $store_id);
    if (!$session) {
        Response::notFound('Cuenta no encontrada');
    }
    if (!in_array($session['status'], ['open', 'awaiting_payment'], true)) {
        Response::error('La cuenta ya está cerrada', 409);
    }

    $enabled = ($action === 'resume') ? 1 : 0;
    $stmt = $db->getConnection()->prepare(
        "UPDATE dining_sessions SET ordering_enabled = :enabled
         WHERE session_id = :sid AND store_id = :store_id"
    );
    $stmt->execute([':enabled' => $enabled, ':sid' => $session_id, ':store_id' => $store_id]);

    DiningSession::broadcast($session_id, $action === 'resume' ? 'ordering_resumed' : 'ordering_paused');

    Response::success(
        ['session_id' => $session_id, 'ordering_enabled' => $enabled === 1],
        $action === 'resume' ? 'Pedidos reanudados' : 'Pedidos en pausa'
    );
}

/** Cierra la cuenta. SOLO personal. La venta real se genera aparte. */
function actionClose($db, $dining, $apiAuth, $auth, array $data) {
    $actor = $apiAuth->requireActor($auth);
    $apiAuth->requireScope($actor, 'write');
    $store_id = (int)$actor['store_id'];

    $session_id = (int)($data['session_id'] ?? 0);
    if ($session_id <= 0) {
        Response::validationError(['session_id' => 'Falta la cuenta']);
    }

    $session = fetchStoreSession($db, $session_id, $store_id);
    if (!$session) {
        Response::notFound('Cuenta no encontrada');
    }
    if (!in_array($session['status'], ['open', 'awaiting_payment'], true)) {
        Response::error('La cuenta ya está cerrada', 409);
    }

    $closed_by = isset($actor['user_id']) ? (int)$actor['user_id'] : null;

    $stmt = $db->getConnection()->prepare(
        "UPDATE dining_sessions
         SET status = 'closed', closed_at = NOW(), closed_by = :closed_by
         WHERE session_id = :sid AND store_id = :store_id
           AND status IN ('open','awaiting_payment')"
    );
    $stmt->execute([':closed_by' => $closed_by, ':sid' => $session_id, ':store_id' => $store_id]);

    // Total final guardado (por si el cierre se lee desde reportes).
    $dining->recalcTotals($session_id);

    DiningSession::broadcast($session_id, 'session_closed');

    Response::success(['session_id' => $session_id, 'status' => 'closed'], 'Cuenta cerrada');
}

// ============================================================
// Helpers
// ============================================================

/**
 * Enlace para que el cliente entre a pedir a ESTA cuenta desde su celular.
 *
 * Es la carta pública de la tienda con el código de la cuenta: al abrirlo, el cliente ya
 * está dentro y solo pone su nombre. El mesero lo muestra como QR cuando quiere que el
 * comensal pida por su cuenta (la otra vía es el QR impreso del punto y que el personal
 * autorice el código a mano).
 */
function urlCuentaDeCliente($conn, $store_id, $menu_id, $code) {
    if ($menu_id <= 0 || $code === '') {
        return null;
    }
    $stmt = $conn->prepare(
        "SELECT public_token FROM menus
          WHERE menu_id = :mid AND store_id = :sid AND is_active = 1 AND public_token IS NOT NULL
          LIMIT 1"
    );
    $stmt->execute([':mid' => $menu_id, ':sid' => $store_id]);
    $token = $stmt->fetchColumn();
    if (!$token) {
        // Sin carta activa no hay a dónde mandar al cliente. No es un error: la cuenta existe.
        return null;
    }
    return rtrim(UrlHelper::base(), '/') . '/m/' . rawurlencode((string)$token)
        . '?code=' . rawurlencode(strtoupper($code));
}

/**
 * Resuelve la carta activa por su token público.
 * Mismo criterio que api/menu/public.php: regex del token y solo cartas activas.
 */
function resolvePublicMenu($db, $token) {
    if ($token === '' || !preg_match('/^[a-f0-9]{8,64}$/', $token)) {
        return false;
    }
    $stmt = $db->getConnection()->prepare(
        "SELECT menu_id, store_id, name, mode, allow_notes
         FROM menus
         WHERE public_token = :token AND is_active = 1
         LIMIT 1"
    );
    $stmt->execute([':token' => $token]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: false;
}

/** Cuenta abierta más reciente de una carta (para join sin código). */
function latestOpenSessionForMenu($db, $store_id, $menu_id) {
    $stmt = $db->getConnection()->prepare(
        "SELECT * FROM dining_sessions
         WHERE store_id = :store_id AND menu_id = :menu_id
           AND status IN ('open','awaiting_payment')
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY opened_at DESC, session_id DESC
         LIMIT 1"
    );
    $stmt->execute([':store_id' => $store_id, ':menu_id' => $menu_id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: false;
}

/** Cuenta de la tienda del actor (para acciones de personal). */
function fetchStoreSession($db, $session_id, $store_id) {
    $stmt = $db->getConnection()->prepare(
        "SELECT * FROM dining_sessions WHERE session_id = :sid AND store_id = :store_id LIMIT 1"
    );
    $stmt->execute([':sid' => (int)$session_id, ':store_id' => (int)$store_id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: false;
}

/**
 * Proyección pública de la cuenta: exactamente lo que el comensal puede ver.
 * Nada de costos, store_id ni datos internos.
 */
function publicSession($full) {
    if (!$full) {
        return null;
    }
    $items = [];
    foreach ($full['items'] as $it) {
        $items[] = [
            'order_item_id'    => $it['order_item_id'],
            'participant_id'   => $it['participant_id'],
            'participant_name' => $it['participant_name'],
            'product_id'       => $it['product_id'],
            'product_name'     => $it['product_name'],
            'quantity'         => $it['quantity'],
            'unit_price'       => $it['unit_price'],
            'line_total'       => $it['line_total'],
            'notes'            => $it['notes'],
            'status'           => $it['status'],
        ];
    }

    return [
        'session_id'       => $full['session_id'],
        'code'             => $full['code'],
        'status'           => $full['status'],
        'ordering_enabled' => $full['ordering_enabled'],
        'participants'     => $full['participants'],
        'items'            => $items,
        'totals'           => [
            'subtotal' => $full['totals']['subtotal'],
            'total'    => $full['totals']['total'],
        ],
        'mode'             => $full['mode'],
    ];
}
