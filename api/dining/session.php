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
 *   POST {"action":"pause","session_id":N}   / {"action":"resume","session_id":N}
 *   POST {"action":"close","session_id":N}
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
        handleGet($db, $dining);
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
function handleGet($db, $dining) {
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

        default:
            Response::error('Acción inválida', 422);
    }
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
