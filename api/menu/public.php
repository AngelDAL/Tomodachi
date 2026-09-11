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
    // 1) La carta (solo activas)
    // ---------------------------------------------------------
    $stmt = $conn->prepare("
        SELECT menu_id, store_id, name, description, mode, welcome_message,
               allow_notes, show_promotions
        FROM menus
        WHERE public_token = :token AND is_active = 1
        LIMIT 1
    ");
    $stmt->execute([':token' => $token]);
    $menu = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$menu) {
        // Mismo mensaje si no existe o si está desactivada: no damos pistas.
        Response::notFound('Esta carta no está disponible');
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
            'image'       => $p['image_path'],
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
        ],
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
 * Productos que el comensal debe ver, ya filtrados.
 *
 * Filtros aplicados (importantes):
 *   - is_ingredient = 0   -> los insumos nunca se ofrecen al comensal
 *   - status = 'active'   -> productos descontinuados fuera
 *   - hidden_in_pos = 0   -> lo que no es vendible tampoco se ofrece aquí
 *   - menu_items.is_hidden = 1 -> exclusión puntual dentro de la carta
 */
function resolverProductos($conn, $menu_id, $store_id) {
    $sql = "
        SELECT DISTINCT
               p.product_id, p.product_name, p.description, p.price, p.image_path,
               p.category_id, p.tracking_type, p.current_stock,
               c.category_name,
               mi.section, mi.is_featured,
               CASE
                   WHEN p.tracking_type = 'none' THEN 1
                   WHEN p.current_stock > 0     THEN 1
                   ELSE 0
               END AS disponible
        FROM menu_items mi
        JOIN products p ON (
            (mi.kind = 'product'  AND p.product_id  = mi.product_id) OR
            (mi.kind = 'category' AND p.category_id = mi.category_id) OR
            (mi.kind = 'tag'      AND EXISTS (
                SELECT 1 FROM product_tag_assignments pta
                WHERE pta.product_id = p.product_id AND pta.tag_id = mi.tag_id
            ))
        )
        LEFT JOIN categories c ON p.category_id = c.category_id
        WHERE mi.menu_id = :menu_id
          AND p.store_id = :store_id
          AND p.status = 'active'
          AND p.is_ingredient = 0
          AND p.hidden_in_pos = 0
          AND mi.is_hidden = 0
          -- si un producto está excluido puntualmente en esta carta, no entra
          -- aunque lo incluya su categoría o su etiqueta
          AND NOT EXISTS (
              SELECT 1 FROM menu_items x
              WHERE x.menu_id = mi.menu_id
                AND x.kind = 'product'
                AND x.product_id = p.product_id
                AND x.is_hidden = 1
          )
        ORDER BY mi.display_order ASC, p.product_name ASC
    ";

    $stmt = $conn->prepare($sql);
    $stmt->execute([':menu_id' => $menu_id, ':store_id' => $store_id]);
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
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
                $tema[$k] = $cfg[$k];
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
