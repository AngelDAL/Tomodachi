<?php
/**
 * Puntos de servicio (mesas, barra, habitación, local...).
 *
 * Es "dónde se atiende" y su etiqueta es libre a propósito: el mismo módulo sirve para
 * un restaurante (Mesa 3), un bar (Barra 1) o un hotel (Habitación 12).
 *
 *   GET    ?menu_id=N        Lista los puntos con su URL de carta y, si están ocupados,
 *                            la cuenta abierta (código, total, minutos, personas)
 *   POST   {label, zone?, is_active?}                  Crea el punto (con su qr_token)
 *   PUT    {table_id, label?, zone?, is_active?, rotate_token?}
 *   DELETE ?table_id=N[&force=1]                       Desactiva; borra solo con force
 *                                                      y sin cuentas que lo referencien
 *
 * El QR no se genera aquí: la pantalla lo dibuja con public/lib/qrcodejs desde la URL
 * que devuelve este endpoint. Server-side no hay generador y no hace falta inventarlo.
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';

header('Content-Type: application/json; charset=utf-8');

$db = new Database();
$auth = new Auth($db);
$apiAuth = new ApiAuth($db);

/**
 * URL pública de la carta, con el punto de servicio incluido para que la cuenta nazca
 * sabiendo en qué punto se está atendiendo.
 */
function urlCartaPunto($menuToken, $tableToken) {
    $base = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https://' : 'http://';
    $base .= $_SERVER['HTTP_HOST'] ?? 'localhost';
    return $base . '/m/' . $menuToken . '?punto=' . $tableToken;
}

/** Carta con la que se imprime el QR: la elegida, o la primera activa de la tienda. */
function cartaParaQr($conn, $store_id, $menu_id) {
    if ($menu_id > 0) {
        $stmt = $conn->prepare("SELECT menu_id, name, public_token, mode FROM menus
                                WHERE menu_id = :id AND store_id = :store_id AND is_active = 1");
        $stmt->execute([':id' => $menu_id, ':store_id' => $store_id]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }
    $stmt = $conn->prepare("SELECT menu_id, name, public_token, mode FROM menus
                            WHERE store_id = :store_id AND is_active = 1
                            ORDER BY menu_id ASC LIMIT 1");
    $stmt->execute([':store_id' => $store_id]);
    return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
}

/** Cuenta abierta de un punto: puede estar ligada al punto, o a la cuenta que lo juntó. */
function cuentaAbierta($conn, $store_id, $table_id) {
    // OJO: dos marcadores distintos para el mismo valor. PDO con prepares nativos NO
    // permite reutilizar un marcador nombrado en la misma consulta — da
    // "SQLSTATE[HY093]: Invalid parameter number" y solo se ve cuando hay filas que
    // recorrer, así que una lista vacía lo esconde.
    $stmt = $conn->prepare("
        SELECT s.session_id, s.code, s.status, s.total, s.opened_at, s.ordering_enabled,
               TIMESTAMPDIFF(MINUTE, s.opened_at, NOW()) AS minutos_abierta,
               (SELECT COUNT(*) FROM dining_participants p
                 WHERE p.session_id = s.session_id AND p.is_active = 1) AS personas,
               (SELECT COUNT(*) FROM check_service_points c
                 WHERE c.session_id = s.session_id) AS puntos_en_la_cuenta
        FROM dining_sessions s
        LEFT JOIN check_service_points csp ON csp.session_id = s.session_id
        WHERE s.store_id = :store_id
          AND s.status IN ('open','awaiting_payment')
          AND (s.table_id = :tabla_directa OR csp.table_id = :tabla_juntada)
        ORDER BY s.opened_at ASC
        LIMIT 1
    ");
    $stmt->execute([
        ':store_id' => $store_id,
        ':tabla_directa' => $table_id,
        ':tabla_juntada' => $table_id,
    ]);
    return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
}

try {
    $actor = $apiAuth->requireActor($auth);
    $store_id = (int)$actor['store_id'];
    $conn = $db->getConnection();
    $metodo = $_SERVER['REQUEST_METHOD'];

    // ─────────────────────────── LISTAR ───────────────────────────
    if ($metodo === 'GET') {
        $apiAuth->requireScope($actor, 'read');
        $menu_id = isset($_GET['menu_id']) ? (int)$_GET['menu_id'] : 0;
        $solo_activos = !isset($_GET['todas']) || $_GET['todas'] !== '1';

        $sql = "SELECT table_id, label, zone, qr_token, is_active, created_at
                FROM dining_tables WHERE store_id = :store_id";
        if ($solo_activos) $sql .= " AND is_active = 1";
        $sql .= " ORDER BY zone IS NULL, zone ASC, label ASC";
        $stmt = $conn->prepare($sql);
        $stmt->execute([':store_id' => $store_id]);
        $puntos = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $carta = cartaParaQr($conn, $store_id, $menu_id);
        $ocupados = 0;
        foreach ($puntos as &$p) {
            $cuenta = cuentaAbierta($conn, $store_id, (int)$p['table_id']);
            $p['cuenta_abierta'] = $cuenta;
            $p['url'] = $carta ? urlCartaPunto($carta['public_token'], $p['qr_token']) : null;
            if ($cuenta) $ocupados++;
        }
        unset($p);

        Response::success([
            'tables' => $puntos,
            'totales' => ['puntos' => count($puntos), 'ocupados' => $ocupados, 'libres' => count($puntos) - $ocupados],
            'menu' => $carta,
            'sin_carta' => $carta === null,
        ]);
    }

    // ─────────────────────────── CREAR ───────────────────────────
    if ($metodo === 'POST') {
        $apiAuth->requireScope($actor, 'write');
        $data = json_decode(file_get_contents('php://input'), true) ?: [];

        $label = trim((string)($data['label'] ?? ''));
        $zone  = isset($data['zone']) ? trim((string)$data['zone']) : null;
        if ($zone === '') $zone = null;

        $errores = [];
        if ($label === '') $errores['label'] = 'Escribe cómo se llama este punto (Mesa 1, Barra, Habitación 12)';
        elseif (mb_strlen($label) > 50) $errores['label'] = 'Máximo 50 caracteres';
        if ($zone !== null && mb_strlen($zone) > 50) $errores['zone'] = 'Máximo 50 caracteres';
        if (empty($errores)) {
            $dup = $conn->prepare("SELECT table_id FROM dining_tables
                                   WHERE store_id = :store_id AND label = :label AND is_active = 1");
            $dup->execute([':store_id' => $store_id, ':label' => $label]);
            if ($dup->fetch()) $errores['label'] = 'Ya existe un punto con ese nombre';
        }
        if (!empty($errores)) Response::validationError($errores);

        $token = bin2hex(random_bytes(16));
        $stmt = $conn->prepare("INSERT INTO dining_tables (store_id, label, zone, qr_token, is_active)
                                VALUES (:store_id, :label, :zone, :token, 1)");
        $stmt->execute([':store_id' => $store_id, ':label' => $label, ':zone' => $zone, ':token' => $token]);
        $nuevo_id = (int)$conn->lastInsertId();

        $carta = cartaParaQr($conn, $store_id, 0);
        Response::success([
            'table_id' => $nuevo_id,
            'label' => $label,
            'zone' => $zone,
            'qr_token' => $token,
            'url' => $carta ? urlCartaPunto($carta['public_token'], $token) : null,
            'sin_carta' => $carta === null,
        ], 'Punto de servicio creado', 201);
    }

    // ─────────────────────────── EDITAR ───────────────────────────
    if ($metodo === 'PUT') {
        $apiAuth->requireScope($actor, 'write');
        $data = json_decode(file_get_contents('php://input'), true) ?: [];
        $table_id = (int)($data['table_id'] ?? 0);
        if ($table_id <= 0) Response::validationError(['table_id' => 'Requerido']);

        $actual = $conn->prepare("SELECT * FROM dining_tables WHERE table_id = :id AND store_id = :store_id");
        $actual->execute([':id' => $table_id, ':store_id' => $store_id]);
        $punto = $actual->fetch(PDO::FETCH_ASSOC);
        if (!$punto) Response::notFound('Punto de servicio no encontrado');

        $campos = [];
        $params = [':id' => $table_id, ':store_id' => $store_id];

        if (array_key_exists('label', $data)) {
            $label = trim((string)$data['label']);
            if ($label === '') Response::validationError(['label' => 'No puede quedar vacío']);
            if (mb_strlen($label) > 50) Response::validationError(['label' => 'Máximo 50 caracteres']);
            $dup = $conn->prepare("SELECT table_id FROM dining_tables
                                   WHERE store_id = :store_id AND label = :label AND is_active = 1 AND table_id <> :id");
            $dup->execute([':store_id' => $store_id, ':label' => $label, ':id' => $table_id]);
            if ($dup->fetch()) Response::validationError(['label' => 'Ya existe un punto con ese nombre']);
            $campos[] = 'label = :label';
            $params[':label'] = $label;
        }
        if (array_key_exists('zone', $data)) {
            $zone = trim((string)$data['zone']);
            if (mb_strlen($zone) > 50) Response::validationError(['zone' => 'Máximo 50 caracteres']);
            $campos[] = 'zone = :zone';
            $params[':zone'] = ($zone === '' ? null : $zone);
        }
        if (array_key_exists('is_active', $data)) {
            $campos[] = 'is_active = :activo';
            $params[':activo'] = ((int)$data['is_active'] === 1) ? 1 : 0;
        }
        // Rotar el token invalida los QR ya impresos de ese punto (por si se filtró).
        $token_nuevo = null;
        if (!empty($data['rotate_token'])) {
            $token_nuevo = bin2hex(random_bytes(16));
            $campos[] = 'qr_token = :token';
            $params[':token'] = $token_nuevo;
        }
        if (empty($campos)) Response::validationError(['cambios' => 'No enviaste nada que cambiar']);

        $stmt = $conn->prepare("UPDATE dining_tables SET " . implode(', ', $campos) .
                               " WHERE table_id = :id AND store_id = :store_id");
        $stmt->execute($params);

        $carta = cartaParaQr($conn, $store_id, 0);
        $token_final = $token_nuevo ?: $punto['qr_token'];
        Response::success([
            'table_id' => $table_id,
            'qr_token' => $token_final,
            'url' => $carta ? urlCartaPunto($carta['public_token'], $token_final) : null,
        ], 'Punto de servicio actualizado');
    }

    // ─────────────────────────── ELIMINAR / DESACTIVAR ───────────────────────────
    if ($metodo === 'DELETE') {
        $apiAuth->requireScope($actor, 'write');
        $table_id = isset($_GET['table_id']) ? (int)$_GET['table_id'] : 0;
        if ($table_id <= 0) Response::validationError(['table_id' => 'Requerido']);

        $stmt = $conn->prepare("SELECT * FROM dining_tables WHERE table_id = :id AND store_id = :store_id");
        $stmt->execute([':id' => $table_id, ':store_id' => $store_id]);
        $punto = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$punto) Response::notFound('Punto de servicio no encontrado');

        $cuenta = cuentaAbierta($conn, $store_id, $table_id);
        $force = isset($_GET['force']) && $_GET['force'] === '1';

        if (!$force || $cuenta) {
            $stmt = $conn->prepare("UPDATE dining_tables SET is_active = 0 WHERE table_id = :id AND store_id = :store_id");
            $stmt->execute([':id' => $table_id, ':store_id' => $store_id]);
            $motivo = $cuenta
                ? 'Tenía una cuenta abierta: se desactivó. Ciérrala y podrás borrarlo.'
                : 'Desactivado. Los QRs impresos dejan de funcionar.';
            Response::success(['table_id' => $table_id, 'borrado' => false], $motivo);
        }

        // Borrado real: solo sin cuentas (la FK de dining_sessions lo pondría en NULL y se
        // perdería de qué punto era la cuenta).
        $stmt = $conn->prepare("DELETE FROM dining_tables WHERE table_id = :id AND store_id = :store_id");
        $stmt->execute([':id' => $table_id, ':store_id' => $store_id]);
        Response::success(['table_id' => $table_id, 'borrado' => true], 'Punto de servicio eliminado');
    }

    Response::error('Método no permitido', 405);
} catch (Exception $e) {
    Response::error('Error en puntos de servicio: ' . $e->getMessage(), 500);
}
