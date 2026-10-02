<?php
/**
 * Cart Sync API — UUID session-based
 * 
 * POST:   Save cart data for a session UUID
 * GET:    Retrieve cart data for a session UUID
 * DELETE: Remove a session
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/WsToken.class.php';

require_once __DIR__ . '/../../includes/Cors.class.php';
Cors::apply();
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$db = new Database();
$auth = new Auth($db);

$dir = __DIR__ . '/../../temp/sessions';
if (!is_dir($dir)) {
    mkdir($dir, 0755, true);
}

/**
 * Generate a UUID v4
 */
function generateUUID() {
    $data = random_bytes(16);
    $data[6] = chr(ord($data[6]) & 0x0f | 0x40);
    $data[8] = chr(ord($data[8]) & 0x3f | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

/**
 * Validate a UUID v4 format
 */
function isValidUUID($uuid) {
    return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $uuid) === 1;
}

/**
 * Get session file path
 */
function sessionPath($dir, $uuid) {
    return $dir . '/cart_' . $uuid . '.json';
}

/**
 * Tienda DUEÑA del carrito, leída del archivo (el origen), nunca del request.
 * 0 = archivo inexistente o sin tienda conocida.
 */
function storeIdDelCarrito($dir, $uuid) {
    $file = sessionPath($dir, $uuid);
    if (!file_exists($file)) {
        return 0;
    }
    $previo = json_decode((string)@file_get_contents($file), true);
    return is_array($previo) && isset($previo['store_id']) ? (int)$previo['store_id'] : 0;
}

// --- POST: save cart ---
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!$auth->isLoggedIn()) {
        Response::unauthorized();
    }

    $user = $auth->getCurrentUser();
    $store_id = $user['store_id'];

    $input = json_decode(file_get_contents('php://input'), true);
    if (!$input) {
        Response::error('Datos inválidos', 400);
    }

    // If no session UUID provided, generate one
    $session = isset($input['session']) ? $input['session'] : null;
    if ($session && !isValidUUID($session)) {
        Response::error('UUID inválido', 400);
    }
    // Aislamiento multi-tienda: todas las tiendas comparten temp/sessions. Si la UUID que
    // llega ya es de OTRA tienda, escribirla sería secuestrar el carrito (y el token) del
    // display ajeno, así que se emite una UUID nueva en vez de sobrescribir.
    $session = $session ?: generateUUID();
    $storePrevio = storeIdDelCarrito($dir, $session);
    if ($storePrevio > 0 && $storePrevio !== (int)$store_id) {
        $session = generateUUID();
    }

    $data = [
        'session' => $session,
        'store_id' => $store_id,
        'cart' => $input['cart'] ?? [],
        'totals' => $input['totals'] ?? [],
        'storeInfo' => $input['storeInfo'] ?? ['name' => 'Tomodachi', 'logo' => ''],
        'activeTab' => $input['activeTab'] ?? null,
        'updated_at' => time()
    ];

    file_put_contents(sessionPath($dir, $session), json_encode($data));

    // Token de LECTURA del carrito para el display (canal `cart:<uuid>`). Se emite aquí
    // porque este es el único método que exige sesión: el token sólo lo puede obtener la
    // tienda dueña del carrito. Sin WS_SECRET devuelve null (fail closed).
    $firma = WsToken::firmarCarrito($session);

    Response::success([
        'session' => $session,
        'saved' => true,
        'cart_token' => $firma ? ['token' => $firma['token'], 'exp' => $firma['exp']] : null
    ]);
}

// --- GET: read cart ---
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $session = isset($_GET['session']) ? $_GET['session'] : null;

    if (!$session || !isValidUUID($session)) {
        Response::error('session UUID requerido y debe ser válido', 400);
    }

    // La UUID ya NO es credencial: sin sesión de navegador hace falta el token firmado del
    // carrito (canal `cart:<uuid>`), que emite el POST autenticado. Sin WS_SECRET no hay
    // lectura por token (fail closed, mismo criterio que api/ws/token.php).
    $actor = $auth->isLoggedIn() ? $auth->getCurrentUser() : null;
    if (!$actor && !WsToken::validar(WsToken::canalCarrito($session), $_GET['token'] ?? '', $_GET['exp'] ?? '')) {
        Response::unauthorized('Se requiere sesión o token del carrito');
    }

    $file = sessionPath($dir, $session);

    if (!file_exists($file)) {
        // Clean empty response — no data yet
        Response::success([
            'session' => $session,
            'cart' => [],
            'totals' => ['subtotal' => 0, 'discount' => 0, 'tax' => 0, 'total' => 0],
            'storeInfo' => ['name' => '', 'logo' => ''],
            'activeTab' => null,
            'updated_at' => null
        ]);
        exit;
    }

    // Expire after 2 hours of inactivity
    if (time() - filemtime($file) > 7200) {
        unlink($file);
        Response::success([
            'session' => $session,
            'cart' => [],
            'totals' => ['subtotal' => 0, 'discount' => 0, 'tax' => 0, 'total' => 0],
            'storeInfo' => ['name' => '', 'logo' => ''],
            'activeTab' => null,
            'updated_at' => null
        ]);
        exit;
    }

    $data = json_decode(file_get_contents($file), true);
    // Aislamiento multi-tienda: la sesión de una tienda no lee el carrito de otra. La
    // tienda dueña sale del ORIGEN (el archivo), nunca de un store_id del request.
    $syncStoreId = isset($data['store_id']) ? (int)$data['store_id'] : 0;
    if ($actor && $syncStoreId > 0 && $syncStoreId !== (int)$actor['store_id']) {
        Response::error('Ese carrito es de otra tienda', 403);
    }
    // El display puede abrirse en otra tablet y no comparte localStorage con
    // el POS. Enriquecer con tema real de la tienda, sin exponer store_id.
    if ($syncStoreId > 0) {
        $stmtStore = $db->getConnection()->prepare('SELECT store_name, logo_url, theme_config, theme_config_dark FROM stores WHERE store_id = ? LIMIT 1');
        $stmtStore->execute([$syncStoreId]);
        $store = $stmtStore->fetch(PDO::FETCH_ASSOC);
        if ($store) {
            $storeInfo = is_array($data['storeInfo'] ?? null) ? $data['storeInfo'] : [];
            if (empty($storeInfo['name'])) $storeInfo['name'] = $store['store_name'];
            if (empty($storeInfo['logo']) && !empty($store['logo_url'])) $storeInfo['logo'] = $store['logo_url'];
            $storeInfo['theme_config'] = $store['theme_config'] ? json_decode($store['theme_config'], true) : [];
            $storeInfo['theme_config_dark'] = $store['theme_config_dark'] ? json_decode($store['theme_config_dark'], true) : null;
            $data['storeInfo'] = $storeInfo;
        }
    }
    // Strip store_id from response for security
    unset($data['store_id']);

    Response::success($data);
}

// --- DELETE: remove session ---
if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    // Operación destructiva: SOLO sesión de navegador (el display nunca borra, así que no
    // se le da canal para hacerlo).
    if (!$auth->isLoggedIn()) {
        Response::unauthorized('Se requiere sesión');
    }
    $user = $auth->getCurrentUser();

    $session = isset($_GET['session']) ? $_GET['session'] : null;
    if (!$session || !isValidUUID($session)) {
        Response::error('session UUID requerido', 400);
    }

    $file = sessionPath($dir, $session);
    if (file_exists($file)) {
        // Aislamiento multi-tienda: no se borra el carrito de otra tienda.
        $storePrevio = storeIdDelCarrito($dir, $session);
        if ($storePrevio > 0 && $storePrevio !== (int)$user['store_id']) {
            Response::error('Ese carrito es de otra tienda', 403);
        }
        unlink($file);
    }
    Response::success(['cleared' => true]);
}
