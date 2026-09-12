<?php
/**
 * Cuenta por mesa — lectura y pedido del comensal.
 *
 * El `join_token` ES la autorización del comensal: con él solo se puede ver y
 * pedir en SU cuenta, nunca en otra. No se expone nada de otras cuentas.
 *
 *   GET  /api/dining/order.php?join_token=<token>
 *        -> la cuenta completa (mismo formato que DiningSession::listSession).
 *   POST {"join_token":"...","items":[{"product_id":N,"quantity":1.5,"notes":"..."}]}
 *        -> agrega ítems (una transacción); devuelve la cuenta actualizada.
 *   POST {"join_token":"...","action":"send"}
 *        -> manda a la comanda los ítems 'pending'; devuelve enviados + cuenta.
 *   POST {"action":"cancel","order_item_id":N,"reason":"..."}
 *        -> SOLO personal autenticado; cancela una línea.
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
// El estado de la cuenta cambia con cada pedido: nunca cachear.
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
    Response::error('No se pudo procesar el pedido: ' . $e->getMessage(), 500);
}

// ============================================================
// GET: la cuenta del comensal
// ============================================================
function handleGet($db, $dining) {
    $token = trim($_GET['join_token'] ?? '');
    if ($token === '') {
        Response::validationError(['join_token' => 'Falta el acceso de la cuenta']);
    }

    $session = $dining->findSessionByJoinToken($token);
    if (!$session) {
        Response::notFound('La cuenta no existe, ya se cerró o el acceso no es válido');
    }

    Response::success($dining->listSession((int)$session['session_id']));
}

// ============================================================
// POST: pedir / enviar (comensal) y cancelar (personal)
// ============================================================
function handlePost($db, $dining, $auth, $apiAuth) {
    $data = json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) {
        $data = [];
    }
    $action = $data['action'] ?? '';

    if ($action === 'cancel') {
        actionCancel($db, $dining, $apiAuth, $auth, $data);
        return;
    }

    $token = trim($data['join_token'] ?? '');
    if ($token === '') {
        Response::validationError(['join_token' => 'Falta el acceso de la cuenta']);
    }

    $session = $dining->findSessionByJoinToken($token);
    if (!$session) {
        Response::notFound('La cuenta no existe, ya se cerró o el acceso no es válido');
    }
    $session_id = (int)$session['session_id'];

    if ((int)$session['ordering_enabled'] !== 1) {
        Response::error('Los pedidos están en pausa. Pide al personal que los reactive', 409);
    }

    if ($action === 'send') {
        actionSend($dining, $session_id);
        return;
    }

    actionAddItems($db, $dining, $session, $data);
}

/** Agrega ítems a la cuenta del comensal. */
function actionAddItems($db, $dining, $session, array $data) {
    $session_id = (int)$session['session_id'];
    $participant_id = isset($session['token_participant_id']) ? (int)$session['token_participant_id'] : null;

    $items = $data['items'] ?? null;
    if (!is_array($items) || count($items) === 0) {
        Response::validationError(['items' => 'No hay productos en el pedido']);
    }

    // ¿La carta permite notas?
    $allow_notes = true;
    if (!empty($session['menu_id'])) {
        $stmt = $db->getConnection()->prepare("SELECT allow_notes FROM menus WHERE menu_id = :mid LIMIT 1");
        $stmt->execute([':mid' => (int)$session['menu_id']]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            $allow_notes = ((int)$row['allow_notes'] === 1);
        }
    }

    $errors = [];
    $clean = [];
    foreach ($items as $i => $it) {
        if (!is_array($it)) {
            $errors["items.$i"] = 'Línea inválida';
            continue;
        }
        $pid = (int)($it['product_id'] ?? 0);
        $qty = $it['quantity'] ?? null;

        if ($pid <= 0) {
            $errors["items.$i.product_id"] = 'Producto inválido';
        }
        if (!is_numeric($qty) || (float)$qty <= 0) {
            $errors["items.$i.quantity"] = 'La cantidad debe ser un número mayor que cero';
        } elseif ((float)$qty > DiningSession::MAX_LINE_QUANTITY) {
            $errors["items.$i.quantity"] = 'La cantidad máxima por línea es ' . DiningSession::MAX_LINE_QUANTITY;
        }
        if (isset($errors["items.$i.product_id"]) || isset($errors["items.$i.quantity"])) {
            continue;
        }

        $line = ['product_id' => $pid, 'quantity' => (float)$qty];
        $notes = isset($it['notes']) ? trim((string)$it['notes']) : '';
        if ($notes !== '' && $allow_notes) {
            $line['notes'] = $notes;
        }
        $clean[] = $line;
    }

    if ($errors) {
        Response::validationError($errors);
    }

    $conn = $db->getConnection();
    $conn->beginTransaction();
    try {
        $created = $dining->addItems($session_id, $participant_id, $clean, 'customer');
        $dining->recalcTotals($session_id);
        $conn->commit();
    } catch (Exception $e) {
        if ($conn->inTransaction()) {
            $conn->rollBack();
        }
        Response::error('No se pudo agregar el pedido: ' . $e->getMessage(), 422);
    }

    DiningSession::broadcast($session_id, 'items_added');

    // Deja que el comensal (o el endpoint de comanda) sepa qué entró.
    Response::success($dining->listSession($session_id), 'Productos agregados a la cuenta', 201);
}

/** Manda los ítems pendientes a la comanda. */
function actionSend($dining, $session_id) {
    $sent = $dining->sendToKitchen($session_id);
    $dining->recalcTotals($session_id);

    if ($sent) {
        DiningSession::broadcast($session_id, 'sent_to_kitchen');
    }

    Response::success([
        'sent'    => $sent,
        'session' => $dining->listSession($session_id),
    ], $sent ? 'Pedido enviado a cocina' : 'No había productos pendientes');
}

/** Cancela una línea. SOLO personal autenticado. */
function actionCancel($db, $dining, $apiAuth, $auth, array $data) {
    $actor = $apiAuth->requireActor($auth);
    $apiAuth->requireScope($actor, 'write');
    $store_id = (int)$actor['store_id'];

    $order_item_id = (int)($data['order_item_id'] ?? 0);
    if ($order_item_id <= 0) {
        Response::validationError(['order_item_id' => 'Falta la línea a cancelar']);
    }
    $reason = trim((string)($data['reason'] ?? ''));
    if ($reason === '') {
        $reason = 'Cancelado por el personal';
    }

    // La línea debe pertenecer a una cuenta de la tienda del actor.
    $stmt = $db->getConnection()->prepare(
        "SELECT oi.order_item_id, oi.session_id
         FROM dining_order_items oi
         JOIN dining_sessions s ON s.session_id = oi.session_id
         WHERE oi.order_item_id = :oid AND s.store_id = :store_id
         LIMIT 1"
    );
    $stmt->execute([':oid' => $order_item_id, ':store_id' => $store_id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        Response::notFound('Línea no encontrada');
    }
    $session_id = (int)$row['session_id'];

    $reason_db = function_exists('mb_substr') ? mb_substr($reason, 0, 255) : substr($reason, 0, 255);
    $stmt = $db->getConnection()->prepare(
        "UPDATE dining_order_items
         SET status = 'cancelled', cancel_reason = :reason
         WHERE order_item_id = :oid AND status <> 'cancelled'"
    );
    $stmt->execute([':reason' => $reason_db, ':oid' => $order_item_id]);

    if ($stmt->rowCount() === 0) {
        Response::error('La línea ya estaba cancelada', 409);
    }

    $dining->recalcTotals($session_id);
    DiningSession::broadcast($session_id, 'item_cancelled');

    Response::success($dining->listSession($session_id), 'Línea cancelada');
}
