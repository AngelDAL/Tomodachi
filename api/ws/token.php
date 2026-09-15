<?php
/**
 * Token para suscribirse al relay de WebSocket.
 *
 * El relay ya no acepta canales de cuenta ni de tienda sin token firmado: el canal de una
 * cuenta es su `session_id` (un entero corto) y con él se podía escuchar el pedido de una
 * mesa ajena. El UUID del carrito del display de cliente sigue sin token, porque es
 * aleatorio de 128 bits.
 *
 *   GET ?canal=store:<id>                     personal -> canal de la tienda
 *   GET ?canal=store:<id>:station:<n>         personal -> canal de una estación
 *   GET ?canal=<session_id>&join_token=<...>  comensal -> canal de SU cuenta
 *
 * Para los canales de tienda solo el personal de ESA tienda. Para el canal de una cuenta,
 * el `join_token` del comensal o el personal de la tienda dueña de la cuenta.
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';
require_once '../../includes/WsToken.class.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

$db = new Database();
$auth = new Auth($db);
$apiAuth = new ApiAuth($db);

/** Personal autenticado, o null si la petición es de un comensal. */
function actorOpcional($apiAuth, $auth) {
    try {
        $actor = $apiAuth->requireActor($auth);
        return is_array($actor) ? $actor : null;
    } catch (Throwable $e) {
        return null;
    }
}

try {
    if ((int)(WsToken::secreto() === '' ? 0 : 1) === 0) {
        // Sin secreto no hay token posible. Se dice claro en vez de devolver algo inservible.
        Response::error('El tiempo real no está configurado en esta instalación (falta WS_SECRET)', 503);
    }

    $canal = trim((string)($_GET['canal'] ?? ''));
    if ($canal === '') {
        Response::validationError(['canal' => 'Falta el canal']);
    }

    $actor = actorOpcional($apiAuth, $auth);

    // ── Canales del personal ────────────────────────────────────────────────
    // `store` a secas = la tienda del propio actor. La pantalla no necesita saber su
    // número de tienda: el servidor la resuelve, y así nadie suscribe la tienda ajena.
    if ($canal === 'store') {
        if (!$actor) {
            Response::unauthorized('Solo el personal puede suscribirse a este canal');
        }
        $canal = 'store:' . (int)$actor['store_id'];
    }

    if (preg_match('/^store:(\d+)(?::station:(\d+))?$/', $canal, $m)) {
        if (!$actor) {
            Response::unauthorized('Solo el personal puede suscribirse a este canal');
        }
        $store_canal = (int)$m[1];
        $store_actor = (int)$actor['store_id'];
        if ($store_canal !== $store_actor) {
            Response::error('Ese canal es de otra tienda', 403);
        }
        // La estación, si viene, tiene que ser de la tienda (evita suscribirse a una
        // estación ajena inventando el número).
        if (!empty($m[2])) {
            $stmt = $db->getConnection()->prepare(
                "SELECT station_id FROM stations WHERE station_id = :sid AND store_id = :store_id AND is_active = 1"
            );
            $stmt->execute([':sid' => (int)$m[2], ':store_id' => $store_actor]);
            if (!$stmt->fetchColumn()) {
                Response::notFound('Estación no encontrada en esta tienda');
            }
        }
    }
    // ── Canal de una cuenta (comensal o personal) ───────────────────────────
    elseif (preg_match('/^\d{1,20}$/', $canal)) {
        $session_id = (int)$canal;
        $join_token = trim((string)($_GET['join_token'] ?? ''));

        $autorizado = false;
        if ($join_token !== '' && preg_match('/^[a-f0-9]{16,64}$/i', $join_token)) {
            $stmt = $db->getConnection()->prepare(
                "SELECT 1 FROM dining_participants
                  WHERE join_token = :token AND session_id = :sid AND is_active = 1 LIMIT 1"
            );
            $stmt->execute([':token' => $join_token, ':sid' => $session_id]);
            $autorizado = (bool)$stmt->fetchColumn();
        }
        if (!$autorizado && $actor) {
            $stmt = $db->getConnection()->prepare(
                "SELECT 1 FROM dining_sessions WHERE session_id = :sid AND store_id = :store_id LIMIT 1"
            );
            $stmt->execute([':sid' => $session_id, ':store_id' => (int)$actor['store_id']]);
            $autorizado = (bool)$stmt->fetchColumn();
        }
        if (!$autorizado) {
            Response::unauthorized('No autorizado para esa cuenta');
        }
    } else {
        Response::validationError(['canal' => 'Canal no válido']);
    }

    $firma = WsToken::firmar($canal);
    Response::success([
        'canal' => $firma['canal'],
        'token' => $firma['token'],
        'exp'   => $firma['exp'],
    ]);
} catch (Exception $e) {
    Response::error('No se pudo firmar el canal: ' . $e->getMessage(), 500);
}
