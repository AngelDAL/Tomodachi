<?php
/**
 * API de EGRESOS DE INVENTARIO (salidas)
 *
 * El espejo de las compras: la compra mete mercancía y saca dinero; el egreso SOLO saca
 * mercancía. Sirve para lo que no es una venta: traspaso a otra empresa, pérdida, siniestro,
 * caducidad, consumo interno.
 *
 * Lo que define este módulo (y lo diferencia del ingreso):
 *   · NO hay precio: ni costo unitario, ni total, ni movimiento de caja.
 *   · NO hay confirmación: no existen borradores ni "ejecutar". Cuando esta llamada responde
 *     200, el stock YA bajó, dentro de UNA sola transacción (si algo falla no se movió nada).
 *   · El motivo es OPCIONAL: preguntar por qué sale no puede ser el candado para sacarlo.
 *   · El destino de un traspaso es información; cada empresa registra su propia entrada.
 *
 * Rutas:
 *   GET    ?exit_id=12            → un egreso con su detalle
 *   GET    ?reason=&from=&to=&product_id=&limit=  → lista
 *   POST   {reason, reason_note, destination_store_id, destination_note, notes, items:[{product_id,quantity,notes}]}
 *   DELETE ?exit_id=12            → deshacer: devuelve la mercancía y borra el egreso
 *
 * Las existencias se consumen con BomHelper::consumeForSale, la MISMA maquinaria que una
 * venta: una receta explota en sus ingredientes, un componente consume sus presentaciones
 * (FIFO/LIFO/manual según su configuración) y una existencia negativa solo ocurre si la
 * empresa activó "aceptar existencias negativas".
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';
require_once '../../includes/BomHelper.class.php';

$method = $_SERVER['REQUEST_METHOD'];

/** Los motivos válidos. El motivo es opcional: NULL = sin especificar. */
const EXIT_REASONS = [
    'transfer' => 'Traspaso a otra empresa',
    'loss'     => 'Pérdida',
    'damage'   => 'Siniestro',
    'expiry'   => 'Caducidad',
    'internal' => 'Consumo interno',
    'other'    => 'Otro',
];

/**
 * Qué se escribe en el libro de movimientos según el motivo.
 * Un traspaso no es lo mismo que una pérdida, y la pantalla de Pérdidas ya lee
 * movement_type='loss': si un siniestro se registrara como 'exit' se perdería de ahí.
 */
function motivoAMovimiento($reason) {
    if ($reason === EXIT_REASON_TRANSFER) return MOVEMENT_TRANSFER;
    if (in_array($reason, [EXIT_REASON_LOSS, EXIT_REASON_DAMAGE, EXIT_REASON_EXPIRY], true)) return MOVEMENT_LOSS;
    return MOVEMENT_EXIT;
}

try {
    $db = new Database();
    $auth = new Auth($db);
    $apiAuth = new ApiAuth($db);
    $actor = $apiAuth->requireActor($auth);
    $currentUser = $actor;
    $store_id = (int)$currentUser['store_id'];

    // ── READ ────────────────────────────────────────────────────────────────
    if ($method === 'GET') {
        $apiAuth->requireScope($actor, 'read');
        $exit_id = isset($_GET['exit_id']) ? (int)$_GET['exit_id'] : 0;

        if ($exit_id > 0) {
            $ex = $db->selectOne(
                'SELECT e.*, u.full_name AS user_name, d.store_name AS destination_store_name
                 FROM inventory_exits e
                 JOIN users u ON e.user_id = u.user_id
                 LEFT JOIN stores d ON e.destination_store_id = d.store_id
                 WHERE e.exit_id = ? AND e.store_id = ?',
                [$exit_id, $store_id]
            );
            if (!$ex) { Response::notFound('No encontramos ese egreso'); }

            $items = $db->select(
                'SELECT i.*, p.product_name, p.tracking_type, p.image_path
                 FROM inventory_exit_items i
                 JOIN products p ON i.product_id = p.product_id
                 WHERE i.exit_id = ?
                 ORDER BY i.item_id ASC',
                [$exit_id]
            );
            foreach ($items as &$it) {
                $it['quantity'] = (float)$it['quantity'];
                $it['previous_stock'] = (float)$it['previous_stock'];
                $it['new_stock'] = (float)$it['new_stock'];
            }
            unset($it);

            $ex['item_count'] = (int)$ex['item_count'];
            $ex['total_quantity'] = (float)$ex['total_quantity'];
            $ex['reason_label'] = $ex['reason'] ? EXIT_REASONS[$ex['reason']] : null;
            $ex['items'] = $items;
            Response::success($ex, 'Egreso de inventario');
        }

        // Lista. El tope es un seguro de vida: 200 egresos es más de lo que nadie revisa.
        $conditions = ['e.store_id = ?'];
        $params = [$store_id];

        if (isset($_GET['reason']) && $_GET['reason'] !== '') {
            $conditions[] = 'e.reason = ?';
            $params[] = Validator::sanitizeString($_GET['reason']);
        }
        if (!empty($_GET['from'])) {
            $conditions[] = 'e.created_at >= ?';
            $params[] = $_GET['from'] . ' 00:00:00';
        }
        if (!empty($_GET['to'])) {
            $conditions[] = 'e.created_at <= ?';
            $params[] = $_GET['to'] . ' 23:59:59';
        }
        if (!empty($_GET['product_id'])) {
            $conditions[] = 'EXISTS (SELECT 1 FROM inventory_exit_items x WHERE x.exit_id = e.exit_id AND x.product_id = ?)';
            $params[] = (int)$_GET['product_id'];
        }

        $limit = isset($_GET['limit']) ? max(1, min(200, (int)$_GET['limit'])) : 60;

        $exits = $db->select(
            'SELECT e.*, u.full_name AS user_name, d.store_name AS destination_store_name,
                    (SELECT COUNT(*) FROM inventory_exit_items x WHERE x.exit_id = e.exit_id) AS `lines`,
                    (SELECT GROUP_CONCAT(p.product_name ORDER BY i.item_id SEPARATOR ", ")
                       FROM inventory_exit_items i JOIN products p ON i.product_id = p.product_id
                      WHERE i.exit_id = e.exit_id) AS products_text
             FROM inventory_exits e
             JOIN users u ON e.user_id = u.user_id
             LEFT JOIN stores d ON e.destination_store_id = d.store_id
             WHERE ' . implode(' AND ', $conditions) . '
             ORDER BY e.exit_id DESC
             LIMIT ' . $limit,
            $params
        );

        $hoy = date('Y-m-d');
        $resumen = ['total' => 0, 'hoy' => 0];
        foreach ($exits as &$ex) {
            $ex['item_count'] = (int)$ex['item_count'];
            $ex['lines'] = (int)$ex['lines'];
            $ex['total_quantity'] = (float)$ex['total_quantity'];
            $ex['reason_label'] = $ex['reason'] ? EXIT_REASONS[$ex['reason']] : null;
            $resumen['total']++;
            if (strpos((string)$ex['created_at'], $hoy) === 0) { $resumen['hoy']++; }
        }
        unset($ex);

        Response::success(['exits' => $exits, 'resumen' => $resumen, 'motivos' => EXIT_REASONS], 'Egresos de inventario');
    }

    // ── CREATE (registrar y ejecutar de inmediato) ───────────────────────────
    if ($method === 'POST') {
        if ($currentUser['via'] === 'session') {
            if (!$auth->hasRole([ROLE_ADMIN, ROLE_MANAGER])) { Response::error('Permisos insuficientes', 403); }
        } else {
            $apiAuth->requireScope($actor, 'write');
        }

        $data = json_decode(file_get_contents('php://input'), true);
        if (!$data) { Response::validationError(['body' => 'JSON inválido']); }

        // ── El motivo: opcional de verdad. Vacío, null o basura desconocida → sin especificar.
        $reason = isset($data['reason']) ? trim((string)$data['reason']) : '';
        if ($reason !== '' && !isset(EXIT_REASONS[$reason])) {
            Response::validationError(['reason' => 'Motivo desconocido']);
        }
        $reason = ($reason === '') ? null : $reason;

        $reason_note = isset($data['reason_note']) ? mb_substr(Validator::sanitizeString($data['reason_note']), 0, 255) : '';
        $destination_note = isset($data['destination_note']) ? mb_substr(Validator::sanitizeString($data['destination_note']), 0, 150) : '';
        $notes = isset($data['notes']) ? mb_substr(Validator::sanitizeString($data['notes']), 0, 1000) : '';

        // ── El destino: informativo. Si viene, tiene que existir y no ser la misma empresa.
        $destination_store_id = null;
        if (!empty($data['destination_store_id'])) {
            $dest = (int)$data['destination_store_id'];
            if ($dest === $store_id) {
                Response::validationError(['destination_store_id' => 'El destino no puede ser la misma empresa']);
            }
            $existe = $db->selectOne('SELECT store_id FROM stores WHERE store_id = ?', [$dest]);
            if (!$existe) {
                Response::validationError(['destination_store_id' => 'Esa empresa no existe']);
            }
            $destination_store_id = $dest;
        }

        // ── Los renglones. Se JUNTAN los repetidos: dos veces "5 de harina" contra una
        // existencia de 8 tiene que fallar, y fallaba si se revisaba renglón por renglón.
        $items_in = isset($data['items']) && is_array($data['items']) ? $data['items'] : [];
        $por_producto = [];
        foreach ($items_in as $it) {
            $pid = isset($it['product_id']) ? (int)$it['product_id'] : 0;
            $qty = isset($it['quantity']) ? (float)$it['quantity'] : 0;
            if ($pid <= 0) { Response::validationError(['items' => 'Hay un renglón sin producto']); }
            if ($qty <= 0) { Response::validationError(['items' => 'Las cantidades tienen que ser mayores a cero']); }
            if (!isset($por_producto[$pid])) {
                $por_producto[$pid] = ['quantity' => 0.0, 'notes' => isset($it['notes']) ? mb_substr(Validator::sanitizeString($it['notes']), 0, 255) : null];
            }
            $por_producto[$pid]['quantity'] += $qty;
            if (!empty($it['notes']) && empty($por_producto[$pid]['notes'])) {
                $por_producto[$pid]['notes'] = mb_substr(Validator::sanitizeString($it['notes']), 0, 255);
            }
        }
        if (!$por_producto) { Response::validationError(['items' => 'Agrega al menos un producto']); }

        // Aceptar existencias negativas es un ajuste de la empresa: sin él, sacar más de lo
        // que hay se rechaza con el número exacto (y no se mueve nada).
        $ajustes = $db->selectOne('SELECT settings FROM stores WHERE store_id = ?', [$store_id]);
        $allowNegative = false;
        if ($ajustes && !empty($ajustes['settings'])) {
            $cfg = json_decode($ajustes['settings'], true) ?: [];
            $allowNegative = !empty($cfg['allow_negative_stock']);
        }

        // ── Validación previa: producto de ESTA empresa, con inventario y con existencia.
        $bom = new BomHelper($db);
        $previos = [];
        foreach ($por_producto as $pid => $linea) {
            $p = $db->selectOne(
                'SELECT product_id, product_name, tracking_type, status FROM products WHERE product_id = ? AND store_id = ?',
                [$pid, $store_id]
            );
            if (!$p) {
                Response::error('Uno de los productos no es de esta empresa', 403);
            }
            if ($p['status'] !== STATUS_ACTIVE) {
                Response::validationError(['items' => '"' . $p['product_name'] . '" está dado de baja: no se le puede mover el inventario']);
            }
            if ($p['tracking_type'] === 'none') {
                Response::validationError(['items' => '"' . $p['product_name'] . '" no lleva inventario']);
            }
            $ref = $bom->availability($store_id, (int)$pid);
            $disp = $ref['available'];
            $disponible = ($disp === PHP_INT_MAX) ? null : (float)$disp;
            if (!$allowNegative && $disponible !== null && $linea['quantity'] > $disponible + 0.0001) {
                $faltan = round($linea['quantity'] - $disponible, 3);
                Response::error(
                    'No hay suficiente "' . $p['product_name'] . '": hay ' . rtrim(rtrim(number_format($disponible, 3, '.', ''), '0'), '.')
                    . ' y quieres sacar ' . rtrim(rtrim(number_format($linea['quantity'], 3, '.', ''), '0'), '.')
                    . ' (faltan ' . rtrim(rtrim(number_format($faltan, 3, '.', ''), '0'), '.') . ')',
                    422
                );
            }
            $previos[$pid] = ['available' => $disponible, 'name' => $p['product_name']];
        }

        $movType = motivoAMovimiento($reason);
        $db->beginTransaction();
        try {
            $exit_id = (int)$db->insert(
                'INSERT INTO inventory_exits
                    (store_id, user_id, reason, reason_note, destination_store_id, destination_note, notes, item_count, total_quantity, created_at)
                 VALUES (?,?,?,?,?,?,?,?,?,NOW())',
                [
                    $store_id, (int)$currentUser['user_id'], $reason,
                    ($reason_note !== '' ? $reason_note : null),
                    $destination_store_id,
                    ($destination_note !== '' ? $destination_note : null),
                    ($notes !== '' ? $notes : null),
                    count($por_producto), 0,
                ]
            );

            $total_qty = 0.0;
            foreach ($por_producto as $pid => $linea) {
                // La maquinaria de siempre (la de las ventas): recetas que explotan,
                // componentes que consumen presentaciones, negativos solo si se permite.
                $bom->consumeForSale(
                    $db, $store_id, (int)$currentUser['user_id'], $exit_id, (int)$pid,
                    $linea['quantity'], [], $allowNegative, 'salida', 'exit', $movType
                );

                $despues = $bom->availability($store_id, (int)$pid);
                $nuevo = ($despues['available'] === PHP_INT_MAX) ? 0 : (float)$despues['available'];
                $antes = $previos[$pid]['available'];
                if ($antes === null) { $antes = $nuevo + $linea['quantity']; }

                $db->insert(
                    'INSERT INTO inventory_exit_items (exit_id, product_id, quantity, previous_stock, new_stock, notes) VALUES (?,?,?,?,?,?)',
                    [$exit_id, (int)$pid, $linea['quantity'], $antes, $nuevo, $linea['notes']]
                );
                $total_qty += $linea['quantity'];
            }

            $db->update('UPDATE inventory_exits SET total_quantity = ? WHERE exit_id = ?', [$total_qty, $exit_id]);
            $db->commit();
        } catch (Exception $e) {
            $db->rollback();
            throw $e;
        }

        Response::success([
            'exit_id' => $exit_id,
            'reason' => $reason,
            'reason_label' => $reason ? EXIT_REASONS[$reason] : null,
            'items' => count($por_producto),
            'total_quantity' => $total_qty,
        ], 'Egreso registrado: el inventario ya bajó');
    }

    // ── DESHACER (un egreso equivocado tiene que poder volver) ───────────────
    if ($method === 'DELETE') {
        if ($currentUser['via'] === 'session') {
            if (!$auth->hasRole([ROLE_ADMIN, ROLE_MANAGER])) { Response::error('Permisos insuficientes', 403); }
        } else {
            $apiAuth->requireScope($actor, 'write');
        }

        parse_str(file_get_contents('php://input'), $body);
        $exit_id = isset($_GET['exit_id']) ? (int)$_GET['exit_id'] : (int)($body['exit_id'] ?? 0);
        if ($exit_id <= 0) { Response::validationError(['exit_id' => 'Requerido']); }

        $ex = $db->selectOne('SELECT * FROM inventory_exits WHERE exit_id = ? AND store_id = ?', [$exit_id, $store_id]);
        if (!$ex) { Response::notFound('No encontramos ese egreso'); }

        $items = $db->select('SELECT product_id, quantity FROM inventory_exit_items WHERE exit_id = ?', [$exit_id]);
        if (!$items) { Response::error('Ese egreso no tiene renglones que devolver', 409); }

        $bom = new BomHelper($db);
        $devuelto = 0.0;
        $db->beginTransaction();
        try {
            foreach ($items as $it) {
                $qty = (float)$it['quantity'];
                // Reintegro por la misma maquinaria (restoreForSale): si el egreso sacó
                // ingredientes de una receta, vuelven los ingredientes.
                $bom->restoreForSale($db, $store_id, (int)$currentUser['user_id'], $exit_id, (int)$it['product_id'], $qty, 'Reintegro', 'salida', 'exit');
                $devuelto += $qty;
            }
            // Los renglones se van con el egreso (ON DELETE CASCADE); el libro de movimientos
            // NO se toca: queda el 'exit' y el 'return' que lo compensa. Borrar la historia
            // sería mentir sobre lo que pasó.
            $db->delete('DELETE FROM inventory_exits WHERE exit_id = ? AND store_id = ?', [$exit_id, $store_id]);
            $db->commit();
        } catch (Exception $e) {
            $db->rollback();
            throw $e;
        }

        Response::success(['exit_id' => $exit_id, 'devuelto' => $devuelto], 'Egreso deshecho: la mercancía volvió al inventario');
    }

    Response::error('Método no permitido', 405);
} catch (Exception $e) {
    Response::error('Error servidor: ' . $e->getMessage(), 500);
}
