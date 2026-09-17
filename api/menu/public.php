<?php
/**
 * Carta pública del menú de clientes.
 *
 * GET /api/menu/public.php?t=<public_token>
 *
 * PÚBLICO (sin login): es lo que abre el comensal al escanear el QR.
 * Solo devuelve cartas ACTIVAS y únicamente datos publicables.
 *
 * Lo que NUNCA sale de aquí:
 *   - costo de los productos
 *   - stock exacto (solo se dice si está disponible o agotado)
 *   - datos internos de la tienda, ventas, clientes
 *
 * Este endpoint es de solo lectura. Poder ver la carta no autoriza a pedir:
 * el flujo de pedido tiene su propio control (fases posteriores).
 */

require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Cors.class.php';

Cors::apply();
header('Content-Type: application/json; charset=utf-8');
// La carta puede cambiar en cualquier momento (precios, promos, agotados):
// se pide no cachear para que el comensal nunca vea una versión vieja.
header('Cache-Control: no-store, max-age=0');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Método no permitido', 405);
}

$token = trim($_GET['t'] ?? '');
if ($token === '' || !preg_match('/^[a-f0-9]{8,64}$/', $token)) {
    Response::error('Carta no especificada', 400);
}

try {
    $db = new Database();
    $conn = $db->getConnection();

    // ---------------------------------------------------------
    // 1) La carta (solo activas).
    //
    // El token del enlace puede ser el de la CARTA (`menus.public_token`) o el
    // del PUNTO DE SERVICIO (`dining_tables.qr_token`): el QR impreso de una mesa
    // trae el suyo, y si el enlace se reenvía tal cual la carta debe abrir igual.
    // Con un token de mesa se resuelve la primera carta activa de esa tienda.
    // ---------------------------------------------------------
    $resuelto = resolverCarta($conn, $token);
    $menu = $resuelto['menu'];

    if (!$menu) {
        // Mismo mensaje si no existe o si está desactivada: no damos pistas.
        Response::notFound('Esta carta no está disponible. Pídele al personal el enlace o el código QR correcto.');
    }

    $menu_id  = (int)$menu['menu_id'];
    $store_id = (int)$menu['store_id'];

    registrarVisita($conn, $menu_id);

    // ---------------------------------------------------------
    // 2) Productos incluidos: por producto suelto, por categoría o por etiqueta
    // ---------------------------------------------------------
    $productos = resolverProductos($conn, $menu_id, $store_id);

    // ---------------------------------------------------------
    // 3) Promociones vigentes (para mostrarlas en la carta)
    // ---------------------------------------------------------
    $promociones = [];
    if ((int)$menu['show_promotions'] === 1) {
        $promociones = promocionesVigentes($conn, $store_id);
    }

    // ---------------------------------------------------------
    // 4) Marca del negocio, para que la carta salga con sus colores.
    //    Son datos que el comensal ya ve (nombre y colores), no configuración
    //    interna: no se incluye nada más de store_settings.
    // ---------------------------------------------------------
    $marca = marcaDeTienda($conn, $store_id);

    // ---------------------------------------------------------
    // 5) Armar secciones
    // ---------------------------------------------------------
    $secciones = [];
    foreach ($productos as $p) {
        $seccion = $p['section'] ?: ($p['category_name'] ?: 'Carta');
        if (!isset($secciones[$seccion])) {
            $secciones[$seccion] = ['name' => $seccion, 'items' => []];
        }
        $secciones[$seccion]['items'][] = [
            'product_id'  => (int)$p['product_id'],
            'name'        => $p['product_name'],
            'description' => $p['description'],
            'price'       => (float)$p['price'],
            'image'       => urlImagen($p['image_path']),
            'featured'    => (int)$p['is_featured'] === 1,
            'available'   => (bool)$p['disponible'],
            'sold_out'    => !$p['disponible'],
            'promotion'   => promoDeProducto($p['product_id'], (int)$p['category_id'], $promociones),
        ];
    }

    $secciones = array_values($secciones);

    // Las secciones y los ítems de cada una salen ordenados: la carta no debe
    // reacomodarse cada vez que el comensal recarga.
    usort($secciones, fn($a, $b) => strcoll($a['name'], $b['name']));

    Response::success([
        'store'      => $marca,
        'menu' => [
            'name'            => $menu['name'],
            'description'     => $menu['description'],
            'mode'            => $menu['mode'],
            'welcome_message' => $menu['welcome_message'],
            'allow_notes'     => (int)$menu['allow_notes'] === 1,
            'show_promotions' => (int)$menu['show_promotions'] === 1,
        ],
        // Marca de depuración: con qué se resolvió el token que llegó.
        //   token     -> el enlace traía el token de la carta
        //   table     -> el enlace traía el token de una mesa; se resolvió la carta
        'resolved_by' => $resuelto['via'],
        'menu_id'     => $menu_id,
        'sections'   => $secciones,
        'promotions' => $promociones,
    ]);

} catch (Exception $e) {
    Response::error('No se pudo cargar la carta', 500);
}

// ============================================================
// Helpers
// ============================================================

/**
 * Resuelve la carta activa a partir del token del enlace.
 *
 * Acepta dos tokens, porque los dos acaban en la misma URL:
 *   - `menus.public_token`      -> la carta elegida. Es el caso normal.
 *   - `dining_tables.qr_token`  -> el QR impreso del punto de servicio. Si el
 *     comensal (o el dueño, reenviándose el enlace) abre con ese token donde se
 *     esperaba uno de carta, antes moría con "No se pudo abrir la carta". Ahora
 *     se resuelve la primera carta activa de la tienda y el flujo continúa.
 *
 * @return array ['menu' => fila|false, 'via' => 'token'|'table'|null]
 */
function resolverCarta($conn, $token) {
    $stmt = $conn->prepare("
        SELECT menu_id, store_id, name, description, mode, welcome_message,
               allow_notes, show_promotions
        FROM menus
        WHERE public_token = :token AND is_active = 1
        LIMIT 1
    ");
    $stmt->execute([':token' => $token]);
    $menu = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($menu) {
        return ['menu' => $menu, 'via' => 'token'];
    }

    // ¿Es el token de un punto de servicio activo?
    $stmt = $conn->prepare("
        SELECT store_id FROM dining_tables
        WHERE qr_token = :token AND is_active = 1
        LIMIT 1
    ");
    $stmt->execute([':token' => $token]);
    $table = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$table) {
        return ['menu' => false, 'via' => null];
    }

    // La primera carta activa de esa tienda (mismo criterio que el QR de los puntos).
    $stmt = $conn->prepare("
        SELECT menu_id, store_id, name, description, mode, welcome_message,
               allow_notes, show_promotions
        FROM menus
        WHERE store_id = :store_id AND is_active = 1
        ORDER BY menu_id ASC
        LIMIT 1
    ");
    $stmt->execute([':store_id' => (int)$table['store_id']]);
    $menu = $stmt->fetch(PDO::FETCH_ASSOC);

    return ['menu' => $menu ?: false, 'via' => 'table'];
}

/**
 * Productos que el comensal debe ver, ya filtrados.
 *
 * DOS FUENTES, una sola carta:
 *
 *   1. TODO el catálogo servible de la tienda (el criterio de siempre):
 *      - is_ingredient = 0   -> los insumos nunca se ofrecen al comensal
 *      - status = 'active'   -> productos descontinuados fuera
 *      - hidden_in_pos = 0   -> lo que no es vendible tampoco se ofrece aquí
 *
 *   2. Lo que manda `menu_items` para curar la carta:
 *      - section       -> sección donde aparece (si no, su categoría)
 *      - display_order -> orden dentro de la sección
 *      - is_featured   -> destacado
 *      - is_hidden = 1 -> se OCULTA (producto puntual o categoría completa)
 *
 * Antes la lista salía SOLO de menu_items, así que una carta con 2 filas
 * (Botanas y Bebidas) mostraba 5 productos y no los 31 servibles: el dueño veía
 * su carta incompleta. Sin asignaciones, ahora se muestra todo lo servible.
 */
function resolverProductos($conn, $menu_id, $store_id) {
    $sql = "
        SELECT
               p.product_id, p.product_name, p.description, p.price, p.image_path,
               p.category_id, p.tracking_type, p.current_stock,
               c.category_name,
               mi.section, mi.display_order, mi.is_featured,
               CASE
                   WHEN p.tracking_type = 'none' THEN 1
                   WHEN p.current_stock > 0     THEN 1
                   ELSE 0
               END AS disponible
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.category_id
        -- La asignación de la carta (a lo más una por producto, la última guardada)
        LEFT JOIN menu_items mi
               ON mi.menu_id = :mi_asignado
              AND mi.kind = 'product'
              AND mi.product_id = p.product_id
        WHERE p.store_id = :store_id
          AND p.status = 'active'
          AND p.is_ingredient = 0
          AND p.hidden_in_pos = 0
          AND NOT EXISTS (
              SELECT 1 FROM menu_items x
              WHERE x.menu_id = :mi_producto_oculto
                AND x.kind = 'product'
                AND x.product_id = p.product_id
                AND x.is_hidden = 1
          )
          AND NOT EXISTS (
              SELECT 1 FROM menu_items x
              JOIN categories xc ON xc.category_id = x.category_id
              WHERE x.menu_id = :mi_categoria_oculta
                AND x.kind = 'category'
                AND x.is_hidden = 1
                AND xc.category_id = p.category_id
          )
        ORDER BY COALESCE(mi.display_order, 100000) ASC, p.product_name ASC
    ";

    // PDO con prepares nativos no permite reutilizar un marcador nombrado en la
    // misma consulta (SQLSTATE[HY093]); por eso cada aparición lleva su nombre.
    $stmt = $conn->prepare($sql);
    $stmt->execute([
        ':mi_asignado'          => $menu_id,
        ':mi_producto_oculto'   => $menu_id,
        ':mi_categoria_oculta'  => $menu_id,
        ':store_id'             => $store_id,
    ]);
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

/**
 * Convierte lo guardado en `image_path` a una URL utilizable desde la carta.
 *
 * La BD guarda rutas tipo `public/assets/images/products/x.jpg`. La carta vive en
 * `/m/<token>`, así que una ruta relativa resolvería contra `/m/` y daría 404 —
 * el mismo problema que tuvo el JS. Por eso aquí SIEMPRE se devuelve absoluta.
 *
 *   - data:...     -> base64, se deja igual
 *   - http(s)...   -> externa, se deja igual
 *   - public/...   -> se antepone '/'            -> /public/assets/...
 *   - otra ruta    -> se asume relativa a public -> /public/<ruta>
 */
function urlImagen($ruta) {
    if (empty($ruta) || !is_string($ruta)) {
        return null;
    }
    $ruta = trim($ruta);
    if ($ruta === '') {
        return null;
    }
    if (strpos($ruta, 'data:image') === 0 || strpos($ruta, 'http') === 0) {
        return $ruta;
    }

    $limpia = ltrim(str_replace('\\', '/', $ruta), '/');

    return strpos($limpia, 'public/') === 0 ? '/' . $limpia : '/public/' . $limpia;
}

/**
 * Nombre y colores del negocio para pintar la carta.
 * Se lee solo lo publicable: el tema es lo que el comensal ve en pantalla.
 */
function marcaDeTienda($conn, $store_id) {
    $marca = ['name' => '', 'theme' => null];

    $stmt = $conn->prepare("SELECT store_name, theme_config FROM stores WHERE store_id = :store_id");
    $stmt->execute([':store_id' => $store_id]);
    $store = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$store) {
        return $marca;
    }
    $marca['name'] = $store['store_name'];

    $cfg = json_decode($store['theme_config'] ?? '{}', true);
    if (is_array($cfg)) {
        // Solo los colores con los que se pinta la carta
        $permitidos = ['primary_color', 'secondary_color', 'logo_path'];
        $tema = [];
        foreach ($permitidos as $k) {
            if (!empty($cfg[$k])) {
                // El logo se guarda igual que las fotos de producto: hay que
                // convertirlo a URL o la carta lo pediría en /m/public/... y 404
                $tema[$k] = ($k === 'logo_path') ? urlImagen($cfg[$k]) : $cfg[$k];
            }
        }
        $marca['theme'] = $tema ?: null;
    }

    return $marca;
}

/** Promociones vigentes con sus objetivos, para pintarlas en la carta. */
function promocionesVigentes($conn, $store_id) {
    $stmt = $conn->prepare("
        SELECT promotion_id, name, description, type, discount_type, discount_value,
               min_quantity, min_purchase_amount, bulk_pay_quantity,
               start_date, end_date
        FROM promotions
        WHERE store_id = :store_id
          AND is_active = 1
          AND start_date <= NOW()
          AND end_date >= NOW()
        ORDER BY created_at DESC
    ");
    $stmt->execute([':store_id' => $store_id]);
    $promos = $stmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($promos as &$promo) {
        $stmtT = $conn->prepare("
            SELECT product_id, category_id, tag_id, required_quantity
            FROM promotion_targets WHERE promotion_id = :pid
        ");
        $stmtT->execute([':pid' => $promo['promotion_id']]);
        $promo['targets'] = $stmtT->fetchAll(PDO::FETCH_ASSOC);
        $promo['discount_value'] = (float)$promo['discount_value'];
    }

    return $promos;
}

/**
 * ¿Qué promoción aplica a este producto? Solo para MOSTRAR la etiqueta en la
 * carta; el cálculo real del precio lo hace Pricing::calculate al cobrar, que es
 * la única fuente de verdad.
 */
function promoDeProducto($product_id, $category_id, array $promociones) {
    foreach ($promociones as $promo) {
        foreach ($promo['targets'] as $t) {
            if ($t['product_id'] !== null && (int)$t['product_id'] === (int)$product_id) {
                return resumenPromo($promo);
            }
            if ($t['category_id'] !== null && (int)$t['category_id'] === (int)$category_id) {
                return resumenPromo($promo);
            }
        }
    }
    return null;
}

function resumenPromo(array $promo) {
    return [
        'name'            => $promo['name'],
        'description'     => $promo['description'],
        'type'            => $promo['type'],
        'discount_type'   => $promo['discount_type'],
        'discount_value'  => (float)$promo['discount_value'],
        'min_quantity'    => (int)$promo['min_quantity'],
    ];
}

/**
 * Registro de accesos, para que el dueño sepa si la carta se usa.
 * Se guarda un hash del origen, no la IP en claro (privacidad del comensal).
 * Si falla, no rompe la carta: es solo estadística.
 */
function registrarVisita($conn, $menu_id) {
    try {
        $origen = $_SERVER['REMOTE_ADDR'] ?? '';
        $hash = $origen !== '' ? substr(hash('sha256', $origen . date('Y-m-d')), 0, 32) : null;
        $ua = substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255);

        $stmt = $conn->prepare("
            INSERT INTO menu_visits (menu_id, origin_hash, user_agent)
            VALUES (:menu_id, :hash, :ua)
        ");
        $stmt->execute([':menu_id' => $menu_id, ':hash' => $hash, ':ua' => $ua ?: null]);
    } catch (Exception $e) {
        // silencio a propósito
    }
}
