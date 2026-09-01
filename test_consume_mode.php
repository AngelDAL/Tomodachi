<?php
/**
 * test_consume_mode.php — Validación del consume_mode por producto (fifo|lifo|manual).
 * Se ejecuta manualmente dentro del contenedor:
 *   docker exec tomodachi-test-app-1 php /var/www/html/test_consume_mode.php
 */
require __DIR__ . '/config/database.php';
require __DIR__ . '/config/constants.php';
require __DIR__ . '/includes/Database.class.php';
require __DIR__ . '/includes/BomHelper.class.php';

error_reporting(E_ALL);
ini_set('display_errors', '1');
ini_set('log_errors', '0');

$db = new Database();
$bom = new BomHelper($db);

$pass = 0; $fail = 0;
function check($label, $cond, $detail = '') {
    global $pass, $fail;
    if ($cond) { $pass++; echo "  [PASS] $label\n"; }
    else { $fail++; echo "  [FAIL] $label  " . ($detail !== '' ? json_encode($detail) : '') . "\n"; }
}

$store = $db->selectOne('SELECT store_id FROM stores WHERE status="active" ORDER BY store_id ASC LIMIT 1');
if (!$store) { echo "No hay tienda activa\n"; exit(1); }
$sid = (int)$store['store_id'];
echo "== Tienda: $sid ==\n";

// Limpiar previos
foreach ($db->select("SELECT product_id FROM products WHERE product_name LIKE 'TEST\\_CM%'") as $r) {
    $id = (int)$r['product_id'];
    $db->delete('DELETE FROM inventory_movements WHERE product_id=?', [$id]);
    $db->delete('DELETE FROM product_lots WHERE product_id=?', [$id]);
    $db->delete('DELETE FROM product_ingredients WHERE product_id=? OR component_id=?', [$id, $id]);
    $db->delete('DELETE FROM products WHERE product_id=?', [$id]);
}

function mkComponent($db, $sid, $name, $mode) {
    return $db->insert(
        'INSERT INTO products (store_id, category_id, product_name, description, current_stock, price, cost, tracking_type, consume_mode, is_ingredient, status) VALUES (?,NULL,?,?,0,0,0,?,?,1,"active")',
        [$sid, $name, 'test', 'component', $mode]
    );
}
function resetLots($db, $pid) {
    global $sid;
    $db->delete('DELETE FROM product_lots WHERE product_id=?', [$pid]);
    $db->insert('INSERT INTO product_lots (store_id, product_id, label, quantity, unit_cost) VALUES (?,?,?,?,?)', [$sid, $pid, 'Lote A (viejo)', 10, 1]);
    $db->insert('INSERT INTO product_lots (store_id, product_id, label, quantity, unit_cost) VALUES (?,?,?,?,?)', [$sid, $pid, 'Lote B', 20, 2]);
    $db->insert('INSERT INTO product_lots (store_id, product_id, label, quantity, unit_cost) VALUES (?,?,?,?,?)', [$sid, $pid, 'Lote C (nuevo)', 30, 3]);
}
function setMode($db, $pid, $mode) {
    $db->update('UPDATE products SET consume_mode=? WHERE product_id=?', [$mode, $pid]);
}
function lotQty($db, $pid) {
    $out = [];
    foreach ($db->select('SELECT lot_id, quantity FROM product_lots WHERE product_id=? ORDER BY lot_id ASC', [$pid]) as $l) {
        $out[] = (float)$l['quantity'];
    }
    return $out;
}

/* ================= FIFO (default) ================= */
echo "\n== FIFO: se agota el lote más antiguo primero ==\n";
$pid = mkComponent($db, $sid, 'TEST_CM_FIFO', 'fifo');
resetLots($db, $pid);
$bom->consumeForSale($db, $sid, 1, 9001, $pid, 25); // 10 + 20 → consume 25: lotA 0, lotB 5, lotC 30
check('FIFO vec 25: [0,5,30]', lotQty($db, $pid) === [0.0, 5.0, 30.0], lotQty($db, $pid));
$bom->restoreForSale($db, $sid, 1, 9001, $pid, 5, 'Reintegro'); // devuelve al m�s antiguo (lotA)
check('FIFO restore 5 → lotA (viejo) sube', lotQty($db, $pid) === [5.0, 5.0, 30.0], lotQty($db, $pid));
$av = $bom->availability($sid, $pid);
check('FIFO disponible = Σ [40]', (float)$av['available'] === 40.0, $av['available']);

/* ================= LIFO ================= */
echo "\n== LIFO: se agota la presentación más reciente primero ==\n";
$pid2 = mkComponent($db, $sid, 'TEST_CM_LIFO', 'lifo');
resetLots($db, $pid2);
$bom->consumeForSale($db, $sid, 1, 9002, $pid2, 45); // 30 + 15 → lotC 0, lotB 5, lotA 10
check('LIFO vec 45: [10,5,0]', lotQty($db, $pid2) === [10.0, 5.0, 0.0], lotQty($db, $pid2));
$bom->restoreForSale($db, $sid, 1, 9002, $pid2, 10, 'Reintegro'); // devuelve al m�s reciente (lotC)
check('LIFO restore 10 → lotC (nuevo) sube', lotQty($db, $pid2) === [10.0, 5.0, 10.0], lotQty($db, $pid2));

/* ================= MANUAL ================= */
echo "\n== MANUAL: solo consume la presentación indicada; sin lote cae a FIFO ==\n";
$pid3 = mkComponent($db, $sid, 'TEST_CM_MANUAL', 'manual');
resetLots($db, $pid3);
// Selección manual: solo el lote B (2º). 1-based index → lot_id del 2º lote.
$all = $db->select('SELECT lot_id FROM product_lots WHERE product_id=? ORDER BY lot_id ASC', [$pid3]);
$lotB = (int)$all[1]['lot_id'];
$bom->consumeForSale($db, $sid, 1, 9003, $pid3, 7, [$pid3 => $lotB]); // solo lotB 20→13
check('MANUAL lote B vec 7 → lotB 13, resto intacto', lotQty($db, $pid3) === [10.0, 13.0, 30.0], lotQty($db, $pid3));
// Sin override (fallback FIFO): consume al lote A viejo
$bom->consumeForSale($db, $sid, 1, 9004, $pid3, 3); // lotA 10→7
check('MANUAL sin lote → FIFO lotA 7', lotQty($db, $pid3) === [7.0, 13.0, 30.0], lotQty($db, $pid3));

/* ================= SERVICIO con composición (consumo de insumos) ================= */
echo "\n== SERVICIO con composición (p. ej. pulido consume cera) ==\n";
$pidSer = $db->insert('INSERT INTO products (store_id, product_name, description, current_stock, price, cost, tracking_type, status) VALUES (?,?,?,0,50,0,"none","active")', [$sid, 'TEST_CM_SERVICIO_PULIDO', 'test']);
$cera = $db->insert('INSERT INTO products (store_id, product_name, current_stock, price, cost, tracking_type, consume_mode, is_ingredient, status) VALUES (?,?,0,0,?,?,?,1,"active")', [$sid, 'TEST_CM_CERA', 8, 'component', 'fifo']);
$db->insert('INSERT INTO product_lots (store_id, product_id, label, quantity, unit_cost) VALUES (?,?,?,?,?)', [$sid, $cera, 'Cera caja', 5, 8]);
$db->insert('INSERT INTO product_ingredients (product_id, component_id, quantity) VALUES (?,?,?)', [$pidSer, $cera, 2]); // 1 pulido = 2 cera
$avSer = $bom->availability($sid, $pidSer);
check('Servicio con comp: disponible = 2 (5/2), tipo none', (float)$avSer['available'] === 2.0 && $avSer['tracking_type'] === 'none', $avSer);
check('Servicio costo = 16 (2×8)', abs((float)$avSer['unit_cost'] - 16.0) < 1e-9, $avSer['unit_cost']);
$bom->consumeForSale($db, $sid, 1, 9005, $pidSer, 2); // 2 pulidos → cera 5→1
check('Vender 2 servicios consume cera 5→1', lotQty($db, $cera) === [1.0], lotQty($db, $cera));
$bom->restoreForSale($db, $sid, 1, 9005, $pidSer, 1, 'Reintegro servicio');
check('Cancelar 1 servicio restituye cera 1→3', lotQty($db, $cera) === [3.0], lotQty($db, $cera));

echo "\n== Resumen: $pass PASS, $fail FAIL ==\n";
exit($fail === 0 ? 0 : 1);