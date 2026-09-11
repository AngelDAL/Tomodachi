<?php
/**
 * API de menús de clientes (carta digital).
 *
 * GET    ?menu_id=X          -> una carta con sus ítems
 * GET                        -> todas las cartas de la tienda
 * POST   {name, description, mode, ...}      -> crear
 * PUT    {menu_id, ...}                       -> actualizar
 * DELETE ?menu_id=X                           -> eliminar
 *
 * Requiere sesión con scope 'write' (o 'read' para GET).
 */

require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';
require_once '../../includes/Validator.class.php';

header('Content-Type: application/json; charset=utf-8');

$db = new Database();
$auth = new Auth($db);
$apiAuth = new ApiAuth($db);

$method = $_SERVER['REQUEST_METHOD'];

try {
    $actor = $apiAuth->requireActor($auth);
    $store_id = (int)$actor['store_id'];

    // Alcance: leer requiere 'read', modificar requiere 'write'
    if ($method === 'GET') {
        $apiAuth->requireScope($actor, 'read');
    } else {
        $apiAuth->requireScope($actor, 'write');
    }

    $conn = $db->getConnection();

    switch ($method) {

        case 'GET':
            $menu_id = isset($_GET['menu_id']) ? (int)$_GET['menu_id'] : 0;

            if ($menu_id > 0) {
                $menu = obtenerMenu($conn, $store_id, $menu_id);
                if (!$menu) {
                    Response::notFound('Menú no encontrado');
                }
                $menu['items'] = obtenerItems($conn, $menu_id);
                $menu['url_publica'] = urlPublica($menu['public_token']);
                Response::success($menu);
            }

            $stmt = $conn->prepare("
                SELECT m.*,
                       (SELECT COUNT(*) FROM menu_items mi WHERE mi.menu_id = m.menu_id) AS items_count
                FROM menus m
                WHERE m.store_id = :store_id
                ORDER BY m.is_active DESC, m.created_at DESC
            ");
            $stmt->execute([':store_id' => $store_id]);
            $menus = $stmt->fetchAll(PDO::FETCH_ASSOC);
            foreach ($menus as &$m) {
                $m['url_publica'] = urlPublica($m['public_token']);
            }
            Response::success($menus);
            break;

        case 'POST':
            $data = leerCuerpo();

            $errores = [];
            if (empty(trim($data['name'] ?? ''))) {
                $errores['name'] = 'El nombre es obligatorio';
            }
            if (!empty($errores)) {
                Response::validationError($errores);
            }

            $menu_id = crearMenu($conn, $store_id, $data);

            // Opcional: arrancar con los ítems que vengan en el mismo cuerpo
            if (!empty($data['items']) && is_array($data['items'])) {
                guardarItems($conn, $menu_id, $data['items']);
            }

            $menu = obtenerMenu($conn, $store_id, $menu_id);
            $menu['items'] = obtenerItems($conn, $menu_id);
            $menu['url_publica'] = urlPublica($menu['public_token']);
            Response::success($menu, 'Menú creado', 201);
            break;

        case 'PUT':
            $data = leerCuerpo();
            $menu_id = (int)($data['menu_id'] ?? 0);

            $menu = obtenerMenu($conn, $store_id, $menu_id);
            if (!$menu) {
                Response::notFound('Menú no encontrado');
            }

            actualizarMenu($conn, $store_id, $menu_id, $data);

            // Si mandan ítems, se reemplaza la lista completa (así el frontend
            // manda el estado final y no hay que calcular diferencias)
            if (isset($data['items']) && is_array($data['items'])) {
                guardarItems($conn, $menu_id, $data['items']);
            }

            $menu = obtenerMenu($conn, $store_id, $menu_id);
            $menu['items'] = obtenerItems($conn, $menu_id);
            $menu['url_publica'] = urlPublica($menu['public_token']);
            Response::success($menu, 'Menú actualizado');
            break;

        case 'DELETE':
            $menu_id = isset($_GET['menu_id']) ? (int)$_GET['menu_id'] : 0;
            if ($menu_id <= 0) {
                $data = leerCuerpo();
                $menu_id = (int)($data['menu_id'] ?? 0);
            }

            $menu = obtenerMenu($conn, $store_id, $menu_id);
            if (!$menu) {
                Response::notFound('Menú no encontrado');
            }

            // Los menu_items caen por ON DELETE CASCADE
            $stmt = $conn->prepare("DELETE FROM menus WHERE menu_id = :id AND store_id = :store_id");
            $stmt->execute([':id' => $menu_id, ':store_id' => $store_id]);

            Response::success(['menu_id' => $menu_id], 'Menú eliminado');
            break;

        default:
            Response::error('Método no permitido', 405);
    }

} catch (Exception $e) {
    Response::error('Error en menús: ' . $e->getMessage(), 500);
}

// ============================================================
// Helpers
// ============================================================

function leerCuerpo() {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function urlPublica($token) {
    // El QR apunta aquí. URL corta /m/<token> (rewrite en Apache).
    $base = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https://' : 'http://';
    $base .= $_SERVER['HTTP_HOST'] ?? 'localhost';
    return $base . '/m/' . $token;
}

function obtenerMenu($conn, $store_id, $menu_id) {
    $stmt = $conn->prepare("SELECT * FROM menus WHERE menu_id = :id AND store_id = :store_id");
    $stmt->execute([':id' => $menu_id, ':store_id' => $store_id]);
    $menu = $stmt->fetch(PDO::FETCH_ASSOC);
    return $menu ?: null;
}

/**
 * Ítems de la carta, resueltos: si el ítem incluye una categoría o etiqueta
 * completa, se devuelve también el grupo para que la UI lo muestre como tal.
 */
function obtenerItems($conn, $menu_id) {
    $stmt = $conn->prepare("
        SELECT mi.*,
               p.product_name, p.price AS product_price, p.image_path,
               p.status AS product_status, p.is_ingredient,
               c.category_name,
               pt.name AS tag_name
        FROM menu_items mi
        LEFT JOIN products p    ON mi.product_id = p.product_id
        LEFT JOIN categories c  ON mi.category_id = c.category_id
        LEFT JOIN product_tags pt ON mi.tag_id = pt.tag_id
        WHERE mi.menu_id = :menu_id
        ORDER BY mi.display_order ASC, mi.item_id ASC
    ");
    $stmt->execute([':menu_id' => $menu_id]);
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

function crearMenu($conn, $store_id, $data) {
    // Token público: identifica la carta en el QR. No autoriza nada por sí solo.
    $token = bin2hex(random_bytes(16));

    $stmt = $conn->prepare("
        INSERT INTO menus
            (store_id, name, description, mode, is_active, public_token,
             require_staff_unlock, allow_notes, max_open_minutes,
             welcome_message, show_promotions)
        VALUES
            (:store_id, :name, :description, :mode, :is_active, :token,
             :require_staff_unlock, :allow_notes, :max_open_minutes,
             :welcome_message, :show_promotions)
    ");
    $stmt->execute([
        ':store_id'             => $store_id,
        ':name'                 => trim($data['name']),
        ':description'          => trim($data['description'] ?? '') ?: null,
        ':mode'                 => modoValido($data['mode'] ?? 'menu_only'),
        ':is_active'            => !empty($data['is_active']) ? 1 : 0,
        ':token'                => $token,
        ':require_staff_unlock' => !empty($data['require_staff_unlock']) ? 1 : 0,
        ':allow_notes'          => !isset($data['allow_notes']) || !empty($data['allow_notes']) ? 1 : 0,
        ':max_open_minutes'     => max(15, (int)($data['max_open_minutes'] ?? 180)),
        ':welcome_message'      => trim($data['welcome_message'] ?? '') ?: null,
        ':show_promotions'      => !isset($data['show_promotions']) || !empty($data['show_promotions']) ? 1 : 0,
    ]);

    return (int)$conn->lastInsertId();
}

function actualizarMenu($conn, $store_id, $menu_id, $data) {
    $campos = [];
    $params = [':id' => $menu_id, ':store_id' => $store_id];

    if (isset($data['name']))          { $campos[] = 'name = :name';                     $params[':name'] = trim($data['name']); }
    if (isset($data['description']))   { $campos[] = 'description = :description';        $params[':description'] = trim($data['description']) ?: null; }
    if (isset($data['mode']))          { $campos[] = 'mode = :mode';                      $params[':mode'] = modoValido($data['mode']); }
    if (isset($data['is_active']))     { $campos[] = 'is_active = :is_active';            $params[':is_active'] = !empty($data['is_active']) ? 1 : 0; }
    if (isset($data['require_staff_unlock'])) { $campos[] = 'require_staff_unlock = :rsu'; $params[':rsu'] = !empty($data['require_staff_unlock']) ? 1 : 0; }
    if (isset($data['allow_notes']))   { $campos[] = 'allow_notes = :allow_notes';        $params[':allow_notes'] = !empty($data['allow_notes']) ? 1 : 0; }
    if (isset($data['max_open_minutes'])) { $campos[] = 'max_open_minutes = :mom';        $params[':mom'] = max(15, (int)$data['max_open_minutes']); }
    if (isset($data['welcome_message'])) { $campos[] = 'welcome_message = :wm';           $params[':wm'] = trim($data['welcome_message']) ?: null; }
    if (isset($data['show_promotions'])) { $campos[] = 'show_promotions = :sp';           $params[':sp'] = !empty($data['show_promotions']) ? 1 : 0; }

    if (empty($campos)) {
        return;   // nada que actualizar
    }

    // El store_id va SIEMPRE en el WHERE: un menú de otra tienda no se toca,
    // aunque adivinen el menu_id.
    $sql = "UPDATE menus SET " . implode(', ', $campos) . " WHERE menu_id = :id AND store_id = :store_id";
    $stmt = $conn->prepare($sql);
    $stmt->execute($params);
}

function modoValido($modo) {
    $validos = ['menu_only', 'order_and_pay', 'open_tab'];
    return in_array($modo, $validos, true) ? $modo : 'menu_only';
}

/**
 * Reemplaza los ítems de la carta. Cada ítem es:
 *   { kind: 'product'|'category'|'tag', product_id|category_id|tag_id,
 *     section, display_order, is_featured, is_hidden, notes }
 */
function guardarItems($conn, $menu_id, $items) {
    $conn->prepare("DELETE FROM menu_items WHERE menu_id = :menu_id")
         ->execute([':menu_id' => $menu_id]);

    if (empty($items)) {
        return;
    }

    $stmt = $conn->prepare("
        INSERT INTO menu_items
            (menu_id, kind, product_id, category_id, tag_id, section,
             display_order, is_featured, is_hidden, notes)
        VALUES
            (:menu_id, :kind, :product_id, :category_id, :tag_id, :section,
             :display_order, :is_featured, :is_hidden, :notes)
    ");

    $orden = 0;
    foreach ($items as $it) {
        $kind = in_array($it['kind'] ?? 'product', ['product', 'category', 'tag'], true)
            ? $it['kind'] : 'product';

        // Solo el id que corresponde al tipo; el resto queda NULL
        $product_id  = $kind === 'product'  ? (int)($it['product_id'] ?? 0) ?: null : null;
        $category_id = $kind === 'category' ? (int)($it['category_id'] ?? 0) ?: null : null;
        $tag_id      = $kind === 'tag'      ? (int)($it['tag_id'] ?? 0) ?: null : null;

        // Sin referencia no hay ítem: se ignora
        if (!$product_id && !$category_id && !$tag_id) {
            continue;
        }

        $stmt->execute([
            ':menu_id'       => $menu_id,
            ':kind'          => $kind,
            ':product_id'    => $product_id,
            ':category_id'   => $category_id,
            ':tag_id'        => $tag_id,
            ':section'       => trim($it['section'] ?? '') ?: null,
            ':display_order' => isset($it['display_order']) ? (int)$it['display_order'] : $orden,
            ':is_featured'   => !empty($it['is_featured']) ? 1 : 0,
            ':is_hidden'     => !empty($it['is_hidden']) ? 1 : 0,
            ':notes'         => trim($it['notes'] ?? '') ?: null,
        ]);
        $orden++;
    }
}
