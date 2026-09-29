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

        // ---- Activación del comensal (Fase 1: dos números o su QR) ----
        // El cliente pide activación y recibe un par; el mesero lo teclea o escanea el QR.
        case 'solicitar_activacion':
            actionSolicitarActivacion($db, $data);
            break;
        case 'estado_activacion':
            actionEstadoActivacion($db, $data);
            break;
        case 'activar':
            actionActivar($db, $apiAuth, $auth, $data);
            break;
        case 'rechazar':
            actionRechazar($db, $apiAuth, $auth, $data);
            break;
        case 'expulsar':
            actionExpulsar($db, $apiAuth, $auth, $data);
            break;
        case 'reiniciar_mesa':
            actionReiniciarMesa($db, $apiAuth, $auth, $data);
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
          -- Una cuenta VENCIDA no está abierta: si esta búsqueda la devolvía, `open`
          -- le decía al comensal que se uniera a la cuenta existente y `join` —que sí
          -- respeta el vencimiento— le contestaba que no existía. Resultado: el
          -- comensal no podía pedir desde la mesa hasta que el personal cerrara la
          -- cuenta vieja. Aquí se aplica el mismo criterio que en el resto del archivo.
          AND (s.expires_at IS NULL OR s.expires_at > NOW())
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
    $store_id = (int)$menu['store_id'];

    /**
     * El QR IMPRESO del punto de servicio trae `?punto=<qr_token>`, y este es el momento en
     * que ese dato sirve para algo: la cuenta nace sabiendo DÓNDE está el cliente.
     *
     * Antes se ignoraba, así que la cuenta del comensal nacía suelta y en el mapa del salón
     * aparecía como "(sin punto)": el mesero no podía saber qué mesa estaba pidiendo.
     *
     * Si el personal ya abrió la cuenta de ese punto, el comensal entra a ESA (una sola
     * cuenta por mesa, que es como se cobra) en vez de abrir una paralela en la misma mesa.
     */
    $punto = puntoDeQr($db, $store_id, trim($data['table_token'] ?? ''));

    if ($punto) {
        $existente = cuentaPorPunto($db->getConnection(), $store_id, (int)$punto['table_id']);
        if ($existente) {
            Response::success([
                'session_id' => (int)$existente['session_id'],
                'code'       => $existente['code'],
                'existente'  => true,
                'punto'      => $punto['label'],
            ], 'Ya hay una cuenta abierta en ' . $punto['label'] . ': únete a ella');
        }
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
    $session = $dining->openSession(
        $store_id,
        (int)$menu['menu_id'],
        $punto ? (int)$punto['table_id'] : null,
        null
    );

    Response::success(
        [
            'session_id' => (int)$session['session_id'],
            'code'       => $session['code'],
            'existente'  => false,
            'punto'      => $punto ? $punto['label'] : null,
        ],
        'Cuenta abierta',
        201
    );
}

/**
 * El punto de servicio dueño de un `qr_token`.
 *
 * El token es aleatorio de 32 caracteres hexadecimales, pero se valida el formato igual:
 * un token mal formado no tiene por qué llegar a la consulta.
 */
function puntoDeQr($db, $store_id, $token) {
    $token = trim((string)$token);
    if ($token === '' || !preg_match('/^[A-Za-z0-9_-]{4,64}$/', $token)) {
        return false;
    }
    $stmt = $db->getConnection()->prepare(
        "SELECT table_id, label, zone, qr_token
           FROM dining_tables
          WHERE qr_token = :token AND store_id = :store_id AND is_active = 1
          LIMIT 1"
    );
    $stmt->execute([':token' => $token, ':store_id' => (int)$store_id]);
    return $stmt->fetch(PDO::FETCH_ASSOC) ?: false;
}

/**
 * TOPE de dispositivos por cuenta (Fase 3).
 *
 * El orden manda el sentido común: si la empresa fijó `max_devices_per_check`, ese número
 * vale. Si no lo fijó, manda el TAMAÑO DE LA MESA (`dining_tables.seats`): una mesa de 4
 * asientos no necesita nueve celulares pidiendo. Si tampoco hay asientos declarados, no hay
 * tope —el comportamiento de siempre—, porque inventarse un límite rompería instalaciones
 * que ya funcionan.
 *
 * @return int 0 = sin tope
 */
function topeDeDispositivos($db, $store_id, $table_id) {
    $conn = $db->getConnection();

    $stmt = $conn->prepare("SELECT settings FROM stores WHERE store_id = :sid");
    $stmt->execute([':sid' => $store_id]);
    $cfg = json_decode((string)$stmt->fetchColumn(), true) ?: [];
    $dining = (isset($cfg['dining']) && is_array($cfg['dining'])) ? $cfg['dining'] : [];

    $explicito = (int)($dining['max_devices_per_check'] ?? 0);
    if ($explicito > 0) {
        return $explicito;
    }
    if ($table_id) {
        $st = $conn->prepare("SELECT seats FROM dining_tables WHERE table_id = :id");
        $st->execute([':id' => (int)$table_id]);
        return (int)$st->fetchColumn();
    }
    return 0;
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

    // El TOPE de dispositivos por cuenta. Se revisa ANTES de crear el participante: si ya no
    // cabe, mejor decirlo que dejar una fila de más y que el mesero tenga que expulsar.
    $tope = topeDeDispositivos($db, (int)$session['store_id'], $session['table_id'] ?? null);
    if ($tope > 0) {
        $conn = $db->getConnection();
        $cuenta = $conn->prepare("SELECT COUNT(*) FROM dining_participants
                                   WHERE session_id = :sid AND is_active = 1");
        $cuenta->execute([':sid' => (int)$session['session_id']]);
        if ((int)$cuenta->fetchColumn() >= $tope) {
            Response::error(
                'Esta cuenta ya tiene ' . $tope . ($tope === 1 ? ' dispositivo' : ' dispositivos')
                . ' conectados, que es el tope para esta mesa. Pide a quien te atiende que libere un lugar.',
                409
            );
        }
    }

    $participant = $dining->joinParticipant(
        (int)$session['session_id'],
        $data['display_name'] ?? null,
        $data['device_hash'] ?? null
    );

    // Verificación de presencia: si la empresa la pidió, este dispositivo NO puede pedir hasta
    // que el mesero teclee (o escanee) el par de números que se le muestra al comensal.
    $activacion = activacionDeTienda($db, (int)$session['store_id'], (int)$participant['participant_id']);

    DiningSession::broadcast((int)$session['session_id'], 'participant_joined');

    Response::success([
        'join_token'     => $participant['join_token'],
        'participant_id' => $participant['participant_id'],
        'session_id'     => (int)$session['session_id'],
        'code'           => $session['code'],
        'activacion'     => $activacion,
    ], 'Te uniste a la cuenta', 201);
}

// ============================================================
// Activación del comensal: un par de números (o su QR) por DISPOSITIVO
// ============================================================
/**
 * ¿Esta tienda pide verificación, y este dispositivo ya está activado?
 *
 * Devuelve null cuando no hay verificación (comportamiento de siempre), o el estado del
 * dispositivo: `pendiente` con su par y su caducidad, o `activo`.
 */
function activacionDeTienda($db, $store_id, $participant_id, $regenerar = false) {
    $conn = $db->getConnection();

    // Los ajustes de la tienda son su JSON `settings.dining`, igual que CoDi: no hay tabla de
    // ajustes aparte. Ver database/migrations/046_activacion_comensal.sql
    $cfg = $conn->prepare("SELECT settings FROM stores WHERE store_id = :sid");
    $cfg->execute([':sid' => $store_id]);
    $deTienda = json_decode((string)$cfg->fetchColumn(), true) ?: [];
    $dining = (isset($deTienda['dining']) && is_array($deTienda['dining'])) ? $deTienda['dining'] : [];
    if (empty($dining['require_activation'])) {
        return null;   // la empresa no pide verificación: se pide directo
    }
    $minutos = max(1, (int)($dining['activation_minutes'] ?? 10));

    $stmt = $conn->prepare("SELECT participant_id, activation_code, activation_expires, activated_at
                            FROM dining_participants WHERE participant_id = :pid");
    $stmt->execute([':pid' => $participant_id]);
    $p = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$p) {
        Response::notFound('Dispositivo no encontrado');
    }
    if ($p['activated_at'] !== null && !$regenerar) {
        return ['requiere' => true, 'estado' => 'activo', 'activated_at' => $p['activated_at']];
    }

    // El par caduca y se puede regenerar; se guarda su caducidad para poder limpiar solos.
    $codigo = parDeActivacionLibre($conn, $store_id);
    $conn->prepare("UPDATE dining_participants
                       SET activation_code = :codigo,
                           activation_expires = DATE_ADD(NOW(), INTERVAL :min MINUTE),
                           rejected_at = NULL
                     WHERE participant_id = :pid")
         ->execute([':codigo' => $codigo, ':min' => $minutos, ':pid' => $participant_id]);

    return ['requiere' => true, 'estado' => 'pendiente', 'codigo' => $codigo, 'minutos' => $minutos];
}

/**
 * Un par de dos dígitos LIBRE en toda la tienda entre solicitudes vivas.
 *
 * Único a propósito: dos mesas con el "47" al mismo tiempo es un error garantizado en el
 * mostrador. Con 90 combinaciones y pocas solicitudes vivas siempre hay hueco; si el azar cae
 * en uno ocupado se reintenta (no se calcula "el siguiente libre", que sería adivinable).
 */
function parDeActivacionLibre($conn, $store_id) {
    $busca = $conn->prepare("
        SELECT 1 FROM dining_participants p
        JOIN dining_sessions s ON s.session_id = p.session_id
        WHERE s.store_id = :sid
          AND p.activation_code = :codigo
          AND p.activation_expires > NOW()
          AND p.is_active = 1
        LIMIT 1
    ");
    for ($i = 0; $i < 40; $i++) {
        $codigo = str_pad((string)random_int(0, 99), 2, '0', STR_PAD_LEFT);
        $busca->execute([':sid' => $store_id, ':codigo' => $codigo]);
        if (!$busca->fetch()) {
            return $codigo;
        }
    }
    Response::error('No se pudo generar el código de activación. Intenta de nuevo', 503);
}

/** POST {join_token} — el comensal pregunta en qué va su solicitud (sin regenerar el par). */
function actionEstadoActivacion($db, array $data) {
    $conn = $db->getConnection();
    $token = trim((string)($data['join_token'] ?? ''));
    if (strlen($token) < 8) {
        Response::validationError(['join_token' => 'Falta la identificación del dispositivo']);
    }

    $stmt = $conn->prepare("SELECT p.participant_id, p.activation_code, p.activation_expires,
                                   p.activated_at, p.rejected_at, s.store_id, s.status
                            FROM dining_participants p
                            JOIN dining_sessions s ON s.session_id = p.session_id
                            WHERE p.join_token = :token AND p.is_active = 1");
    $stmt->execute([':token' => $token]);
    $fila = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$fila) {
        Response::notFound('Tu pedido ya no está activo. Vuelve a unirte a la cuenta');
    }

    // Ajustes de la tienda (JSON `settings.dining`), igual que en activacionDeTienda().
    $cfg = $conn->prepare("SELECT settings FROM stores WHERE store_id = :sid");
    $cfg->execute([':sid' => (int)$fila['store_id']]);
    $deTienda = json_decode((string)$cfg->fetchColumn(), true) ?: [];
    $ajustes = (isset($deTienda['dining']) && is_array($deTienda['dining'])) ? $deTienda['dining'] : [];
    if (empty($ajustes['require_activation'])) {
        Response::success(['requiere' => false, 'estado' => 'activo']);
    }

    if ($fila['activated_at'] !== null) {
        Response::success(['requiere' => true, 'estado' => 'activo', 'activated_at' => $fila['activated_at']]);
    }
    if ($fila['rejected_at'] !== null) {
        Response::success(['requiere' => true, 'estado' => 'rechazado']);
    }

    $vencido = $fila['activation_expires'] !== null && strtotime($fila['activation_expires']) <= time();
    Response::success([
        'requiere' => true,
        'estado'   => 'pendiente',
        'codigo'   => $vencido ? null : $fila['activation_code'],
        'vencido'  => $vencido,
        'minutos'  => (int)($ajustes['activation_minutes'] ?? 10),
    ]);
}

/** POST {join_token} — el comensal pide (o vuelve a pedir) su par de números. */
function actionSolicitarActivacion($db, array $data) {
    $conn = $db->getConnection();
    $token = trim((string)($data['join_token'] ?? ''));
    if (strlen($token) < 8) {
        Response::validationError(['join_token' => 'Falta la identificación del dispositivo']);
    }

    $stmt = $conn->prepare("SELECT p.participant_id, s.store_id, s.session_id, s.status
                            FROM dining_participants p
                            JOIN dining_sessions s ON s.session_id = p.session_id
                            WHERE p.join_token = :token AND p.is_active = 1");
    $stmt->execute([':token' => $token]);
    $fila = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$fila) {
        Response::notFound('Tu pedido ya no está activo. Vuelve a unirte a la cuenta');
    }
    if (!in_array($fila['status'], ['open', 'awaiting_payment'], true)) {
        Response::error('La cuenta ya se cerró', 409);
    }

    $activacion = activacionDeTienda($db, (int)$fila['store_id'], (int)$fila['participant_id'], true);
    if ($activacion === null) {
        // La empresa no pide verificación: nada que solicitar, el dispositivo ya puede pedir.
        Response::success(['requiere' => false], 'No hace falta activación: ya puedes pedir');
    }
    Response::success($activacion, 'Muéstrale estos números a quien te atiende');
}

/**
 * POST {code} o {participant_id} — el MESERO activa un dispositivo.
 *
 * Acepta el par tecleado o el participante concreto (cuando el QR del comensal se escanea o
 * cuando es la única persona esperando en la mesa y no hay ambigüedad).
 */
function actionActivar($db, $apiAuth, $auth, array $data) {
    $actor = $apiAuth->requireActor($auth);
    $apiAuth->requireScope($actor, 'write');
    $store_id = (int)$actor['store_id'];
    $conn = $db->getConnection();

    $participant_id = (int)($data['participant_id'] ?? 0);
    $codigo = trim((string)($data['code'] ?? ''));

    if ($participant_id <= 0) {
        if (!preg_match('/^\d{1,2}$/', $codigo)) {
            Response::validationError(['code' => 'Escribe los dos números que te dicen']);
        }
        $codigo = str_pad($codigo, 2, '0', STR_PAD_LEFT);
        $stmt = $conn->prepare("
            SELECT p.participant_id
            FROM dining_participants p
            JOIN dining_sessions s ON s.session_id = p.session_id
            WHERE s.store_id = :sid
              AND p.activation_code = :codigo
              AND p.is_active = 1
              AND p.activated_at IS NULL
              AND p.rejected_at IS NULL
              AND p.activation_expires > NOW()
            ORDER BY p.joined_at ASC
            LIMIT 1
        ");
        $stmt->execute([':sid' => $store_id, ':codigo' => $codigo]);
        $participant_id = (int)$stmt->fetchColumn();
        if ($participant_id <= 0) {
            Response::error('Ese código no está esperando. Los códigos vencen: pídele al cliente que genere otros', 404);
        }
    }

    $stmt = $conn->prepare("
        SELECT p.participant_id, p.session_id, p.display_name, s.code, s.status,
               (SELECT GROUP_CONCAT(t.label SEPARATOR ' + ')
                  FROM check_service_points csp
                  JOIN dining_tables t ON t.table_id = csp.table_id
                 WHERE csp.session_id = s.session_id) AS puntos,
               (SELECT t.label FROM dining_tables t WHERE t.table_id = s.table_id) AS punto_directo
        FROM dining_participants p
        JOIN dining_sessions s ON s.session_id = p.session_id
        WHERE p.participant_id = :pid AND s.store_id = :sid
    ");
    $stmt->execute([':pid' => $participant_id, ':sid' => $store_id]);
    $p = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$p) {
        Response::notFound('Ese dispositivo no pertenece a una cuenta de esta tienda');
    }
    if (!in_array($p['status'], ['open', 'awaiting_payment'], true)) {
        Response::error('Esa cuenta ya se cerró', 409);
    }

    $conn->prepare("UPDATE dining_participants
                       SET activated_at = NOW(), activated_by = :uid,
                           activation_expires = NULL, rejected_at = NULL
                     WHERE participant_id = :pid")
         ->execute([':uid' => (int)$actor['user_id'], ':pid' => $participant_id]);

    DiningSession::broadcast((int)$p['session_id'], 'participant_activated');

    Response::success([
        'participant_id' => $participant_id,
        'session_id'     => (int)$p['session_id'],
        'code'           => $p['code'],
        'punto'          => $p['puntos'] ?: ($p['punto_directo'] ?: null),
        'display_name'   => $p['display_name'],
    ], 'Listo: ese dispositivo ya puede pedir');
}

/** POST {participant_id} — el mesero dice que no (el dispositivo vuelve a la carta). */
function actionRechazar($db, $apiAuth, $auth, array $data) {
    $actor = $apiAuth->requireActor($auth);
    $apiAuth->requireScope($actor, 'write');
    $conn = $db->getConnection();
    $participant_id = (int)($data['participant_id'] ?? 0);
    if ($participant_id <= 0) {
        Response::validationError(['participant_id' => 'Falta el dispositivo']);
    }

    $stmt = $conn->prepare("SELECT p.session_id FROM dining_participants p
                            JOIN dining_sessions s ON s.session_id = p.session_id
                            WHERE p.participant_id = :pid AND s.store_id = :sid");
    $stmt->execute([':pid' => $participant_id, ':sid' => (int)$actor['store_id']]);
    $session_id = (int)$stmt->fetchColumn();
    if ($session_id <= 0) {
        Response::notFound('Ese dispositivo no pertenece a una cuenta de esta tienda');
    }

    $conn->prepare("UPDATE dining_participants
                       SET rejected_at = NOW(), activation_expires = NULL
                     WHERE participant_id = :pid")
         ->execute([':pid' => $participant_id]);

    DiningSession::broadcast($session_id, 'participant_rejected');
    Response::success(['participant_id' => $participant_id], 'Solicitud rechazada');
}

/** POST {participant_id} — fuera el dispositivo (el que se fue, el que molesta). */
function actionExpulsar($db, $apiAuth, $auth, array $data) {
    $actor = $apiAuth->requireActor($auth);
    $apiAuth->requireScope($actor, 'write');
    $conn = $db->getConnection();
    $participant_id = (int)($data['participant_id'] ?? 0);
    if ($participant_id <= 0) {
        Response::validationError(['participant_id' => 'Falta el dispositivo']);
    }

    $stmt = $conn->prepare("SELECT p.session_id FROM dining_participants p
                            JOIN dining_sessions s ON s.session_id = p.session_id
                            WHERE p.participant_id = :pid AND s.store_id = :sid");
    $stmt->execute([':pid' => $participant_id, ':sid' => (int)$actor['store_id']]);
    $session_id = (int)$stmt->fetchColumn();
    if ($session_id <= 0) {
        Response::notFound('Ese dispositivo no pertenece a una cuenta de esta tienda');
    }

    $conn->prepare("UPDATE dining_participants
                       SET is_active = 0, activated_at = NULL, activation_code = NULL,
                           activation_expires = NULL
                     WHERE participant_id = :pid")
         ->execute([':pid' => $participant_id]);

    DiningSession::broadcast($session_id, 'participant_removed');
    Response::success(['participant_id' => $participant_id], 'Dispositivo expulsado');
}

/**
 * POST {table_id} — "Reiniciar la mesa": fuera TODOS los dispositivos de esa cuenta, sin cerrarla.
 *
 * El caso real: la mesa cambió de gente y los que se fueron dejaron la carta abierta en su
 * teléfono. El consumo sigue, así que cerrar la cuenta no sirve; lo que hay que limpiar son los
 * permisos. Los que ahora están sentados vuelven a pedir su activación en dos toques.
 */
function actionReiniciarMesa($db, $apiAuth, $auth, array $data) {
    $actor = $apiAuth->requireActor($auth);
    $apiAuth->requireScope($actor, 'write');
    $store_id = (int)$actor['store_id'];
    $conn = $db->getConnection();
    $table_id = (int)($data['table_id'] ?? 0);
    if ($table_id <= 0) {
        Response::validationError(['table_id' => 'Falta el punto de servicio']);
    }

    // Las cuentas abiertas de ese punto: la directa y las que lo juntaron.
    $stmt = $conn->prepare("
        SELECT DISTINCT s.session_id
        FROM dining_sessions s
        LEFT JOIN check_service_points csp ON csp.session_id = s.session_id
        WHERE s.store_id = :sid
          AND s.status IN ('open','awaiting_payment')
          AND (s.table_id = :tabla_directa OR csp.table_id = :tabla_juntada)
    ");
    $stmt->execute([':sid' => $store_id, ':tabla_directa' => $table_id, ':tabla_juntada' => $table_id]);
    $sesiones = array_map('intval', array_column($stmt->fetchAll(PDO::FETCH_ASSOC), 'session_id'));
    if (!$sesiones) {
        Response::notFound('Ese punto no tiene una cuenta abierta');
    }

    $marcadores = implode(',', array_fill(0, count($sesiones), '?'));
    $upd = $conn->prepare("UPDATE dining_participants
                              SET is_active = 0, activated_at = NULL, activation_code = NULL,
                                  activation_expires = NULL
                            WHERE session_id IN ($marcadores) AND is_active = 1");
    $upd->execute($sesiones);
    $cuantos = $upd->rowCount();

    foreach ($sesiones as $sid) {
        DiningSession::broadcast($sid, 'participants_reset');
    }
    Response::success(['sessiones' => $sesiones, 'dispositivos' => $cuantos],
        'Mesa reiniciada: ' . $cuantos . ' dispositivo(s) tendrán que pedir activación otra vez');
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

    // Una cuenta CON CONSUMO no se cierra en silencio.
    //
    // Antes de que existiera el cobro, cerrar era la única forma de terminar una cuenta, así
    // que esta acción cerraba cualquier cosa. Hoy sería un hoyo por donde se va el dinero:
    // lo servido quedaría sin venta, sin pago y sin movimiento de caja, y el corte del día
    // no cuadraría con lo que salió de la cocina.
    // Regla: o se cobra (api/dining/charge.php), o se cancela con un motivo que quede
    // registrado. Cerrar solo se permite si de verdad no hay consumo.
    $totales = $dining->recalcTotals($session_id);
    if ((float)$totales['total'] > 0) {
        Response::error(
            'La cuenta tiene consumo por ' . number_format((float)$totales['total'], 2) .
            '. Cóbrela desde el botón Cobrar; si nadie consumió, cancélela con un motivo.',
            409
        );
    }

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
