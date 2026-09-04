<?php
/**
 * Productos API
 * GET  /api/inventory/products.php?store_id=1&search=texto&context=pos&all=1&archived=1
 * POST /api/inventory/products.php
 * PUT  /api/inventory/products.php
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

try {
    $db = new Database();
    $auth = new Auth($db);
    $apiAuth = new ApiAuth($db);
    $actor = $apiAuth->requireActor($auth);
    $currentUser = $actor;

    switch ($method) {
        case 'GET':
            $apiAuth->requireScope($actor, 'read');
            $requested_store_id = isset($_GET['store_id']) ? (int)$_GET['store_id'] : 0;
            $session_store_id = (int)$currentUser['store_id'];

            if ($requested_store_id > 0 && $requested_store_id !== $session_store_id) {
                Response::error('No autorizado para ver inventario de otra tienda', 403);
            }

            $store_id = ($requested_store_id > 0) ? $requested_store_id : $session_store_id;
            if ($store_id <= 0) {
                Response::success([], 'No se identificó tienda activa');
            }

            $search = isset($_GET['search']) ? trim($_GET['search']) : '';
            $context = isset($_GET['context']) ? trim($_GET['context']) : '';
            $all = isset($_GET['all']) && $_GET['all'] === '1';
            $archivedOnly = isset($_GET['archived']) && $_GET['archived'] === '1';

            $params = [];
            $sql = 'SELECT p.product_id, p.product_name, p.description, p.image_path, p.barcode, p.qr_code, p.price, p.cost, p.min_stock, p.status, p.category_id, c.category_name, p.current_stock, p.is_bulk, p.bulk_unit, p.tracking_type, p.consume_mode, p.pieces_per_box, p.is_ingredient, p.hidden_in_pos, p.discontinued_at';
            $sql .= ' FROM products p LEFT JOIN categories c ON p.category_id = c.category_id';
            $conditions = [];

            // Store filter (always required)
            if ($store_id > 0) {
                $conditions[] = 'p.store_id = ?';
                $params[] = $store_id;
            }

            // POS context: only active, not hidden
            if ($context === 'pos') {
                $conditions[] = "p.status = 'active'";
                $conditions[] = 'p.hidden_in_pos = 0';
            }

            // Archived-only view (admin inventory)
            if ($archivedOnly) {
                $conditions[] = 'p.hidden_in_pos = 1';
            } elseif (!$all && $context !== 'pos') {
                // Default: exclude discontinued items from the main inventory list
                // unless explicitly requesting all or POS context
                // Keep everything visible for admin management unless archived-only
            }

            // Search by name, barcode, or QR
            if ($search !== '') {
                $conditions[] = '(p.product_name LIKE ? OR p.barcode LIKE ? OR p.qr_code LIKE ?)';
                $pattern = '%' . $search . '%';
                $params[] = $pattern;
                $params[] = $pattern;
                $params[] = $pattern;
            }

            if ($conditions) { $sql .= ' WHERE ' . implode(' AND ', $conditions); }
            $sql .= ' ORDER BY p.product_name ASC LIMIT 200';
            $products = $db->select($sql, $params);

            // Enrich with availability and lot data
            if ($products) {
                $bom = new BomHelper($db);
                foreach ($products as &$pr) {
                    $type = $bom->normalizeType($pr['tracking_type'] ?? 'stock');
                    $pr['tracking_type'] = $type;
                    $pr['consume_mode'] = $bom->normalizeConsume($pr['consume_mode'] ?? null);
                    $ppb = (int)($pr['pieces_per_box'] ?? 0);
                    $pr['pieces_per_box'] = $ppb > 0 ? $ppb : null;
                    if ($type === TRACKING_RECIPE) {
                        try {
                            $av = $bom->availability($store_id, (int)$pr['product_id']);
                            $pr['available'] = $av['available'] === PHP_INT_MAX ? null : $av['available'];
                            $pr['limiting_ingredient'] = $av['limiting'];
                            $pr['derived_cost'] = round($av['unit_cost'], 2);
                            $pr['recipe_ingredients'] = $av['ingredients'];
                            $pr['is_stock_controlled'] = ($av['available'] !== PHP_INT_MAX);
                            unset($pr['stock_quantity']);
                            if ($av['available'] !== PHP_INT_MAX) {
                                $pr['stock_quantity'] = $av['available'];
                            }
                        } catch (Exception $e) {
                            $pr['available'] = 0;
                            $pr['limiting_ingredient'] = null;
                            $pr['recipe_error'] = $e->getMessage();
                            $pr['recipe_ingredients'] = [];
                            $pr['is_stock_controlled'] = true;
                            $pr['stock_quantity'] = 0;
                        }
                    } elseif ($type === TRACKING_COMPONENT) {
                        try {
                            $cav = $bom->availability($store_id, (int)$pr['product_id']);
                            $pr['available'] = $cav['available'];
                            $pr['presentations'] = $cav['lots'];
                            $pr['derived_cost'] = round($cav['unit_cost'], 2);
                            $pr['is_stock_controlled'] = true;
                            $pr['stock_quantity'] = $cav['available'];
                        } catch (Exception $e) {
                            $pr['available'] = 0;
                            $pr['presentations'] = [];
                            $pr['is_stock_controlled'] = true;
                            $pr['stock_quantity'] = 0;
                        }
                    } else {
                        $pr['is_stock_controlled'] = false;
                        $pr['lots'] = $bom->deriveLots($pr['current_stock'], $ppb);
                    }
                }
                unset($pr);
            }

            Response::success($products, 'Listado productos');
            break;

        case 'POST':
            if ($actor['via'] === 'session') {
                if (!$auth->hasRole([ROLE_ADMIN, ROLE_MANAGER])) { Response::error('Permisos insuficientes', 403); }
            } else {
                $apiAuth->requireScope($actor, 'write');
            }
            $data = json_decode(file_get_contents('php://input'), true);
            if (!$data) { Response::validationError(['body' => 'JSON inválido']); }

            $store_id = (int)$currentUser['store_id'];
            if ($store_id <= 0) { Response::error('Error de sesión: Tienda no identificada', 400); }

            $errors = [];
            $product_name = isset($data['product_name']) ? Validator::sanitizeString($data['product_name']) : '';
            $category_id = isset($data['category_id']) && is_numeric($data['category_id']) && (int)$data['category_id'] > 0 ? (int)$data['category_id'] : null;

            $barcode = isset($data['barcode']) && trim($data['barcode']) !== '' ? Validator::sanitizeString($data['barcode']) : null;
            $qr_code = isset($data['qr_code']) && trim($data['qr_code']) !== '' ? Validator::sanitizeString($data['qr_code']) : null;
            $price = isset($data['price']) ? $data['price'] : null;
            $cost = isset($data['cost']) ? $data['cost'] : 0;
            $min_stock = isset($data['min_stock']) ? (int)$data['min_stock'] : 0;
            $initial_stock = isset($data['stock']) ? (int)$data['stock'] : 0;
            $description = isset($data['description']) ? Validator::sanitizeString($data['description']) : '';
            $is_bulk = isset($data['is_bulk']) ? (int)$data['is_bulk'] : 0;
            $bulk_unit = isset($data['bulk_unit']) ? Validator::sanitizeString($data['bulk_unit']) : 'kg';
            $tracking_type = isset($data['tracking_type']) ? Validator::sanitizeString($data['tracking_type']) : 'stock';
            if (!in_array($tracking_type, [TRACKING_STOCK, TRACKING_RECIPE, TRACKING_COMPONENT, TRACKING_NONE], true)) { $tracking_type = TRACKING_STOCK; }
            $pieces_per_box = (isset($data['pieces_per_box']) && is_numeric($data['pieces_per_box']) && (int)$data['pieces_per_box'] > 0)
                ? (int)$data['pieces_per_box'] : null;
            $is_ingredient = isset($data['is_ingredient']) ? (int)$data['is_ingredient'] : 0;
            $consume_mode = isset($data['consume_mode']) ? Validator::sanitizeString($data['consume_mode']) : CONSUME_FIFO;
            if (!in_array($consume_mode, [CONSUME_FIFO, CONSUME_LIFO, CONSUME_MANUAL], true)) { $consume_mode = CONSUME_FIFO; }
            $cost_per_box = (isset($data['cost_per_box']) && is_numeric($data['cost_per_box'])) ? (float)$data['cost_per_box'] : null;
            if ($tracking_type === TRACKING_RECIPE) { $initial_stock = 0; }
            if ($pieces_per_box > 0 && $cost_per_box !== null) { $cost = $cost_per_box / $pieces_per_box; }

            if (!Validator::required($product_name)) { $errors['product_name'] = 'Requerido'; }

            if ($category_id) {
                $catExists = $db->selectOne('SELECT category_id FROM categories WHERE category_id = ?', [$category_id]);
                if (!$catExists) { $category_id = null; }
            } else {
                $category_id = null;
            }

            if ($barcode && $db->selectOne('SELECT product_id FROM products WHERE barcode = ? AND store_id = ?', [$barcode, $store_id])) { $errors['barcode'] = 'Duplicado en esta tienda'; }
            if ($qr_code && $db->selectOne('SELECT product_id FROM products WHERE qr_code = ? AND store_id = ?', [$qr_code, $store_id])) { $errors['qr_code'] = 'Duplicado en esta tienda'; }

            if (!Validator::validatePrice($price)) { $errors['price'] = 'Precio inválido'; }
            if (!Validator::validatePrice($cost)) { $errors['cost'] = 'Costo inválido'; }
            if ($errors) { Response::validationError($errors); }

            $id = $db->insert('INSERT INTO products (store_id, category_id, product_name, description, barcode, qr_code, price, cost, current_stock, min_stock, status, is_bulk, bulk_unit, tracking_type, consume_mode, pieces_per_box, is_ingredient, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())', [
                $store_id, $category_id, $product_name, $description, $barcode, $qr_code, $price, $cost, $initial_stock, $min_stock, STATUS_ACTIVE, $is_bulk, $bulk_unit, $tracking_type, $consume_mode, $pieces_per_box, $is_ingredient
            ]);

            if ($initial_stock > 0) {
                $user_id = (int)$currentUser['user_id'];
                $db->insert('INSERT INTO inventory_movements (store_id, product_id, user_id, movement_type, quantity, previous_stock, new_stock, notes, created_at) VALUES (?, ?, ?, "adjustment", ?, 0, ?, "Stock inicial", NOW())',
                    [$store_id, $id, $user_id, $initial_stock, $initial_stock]);
            }

            $product = $db->selectOne('SELECT product_id, product_name, image_path, barcode, qr_code, price, cost, current_stock, min_stock, status, is_bulk, bulk_unit, tracking_type, consume_mode, pieces_per_box, is_ingredient, hidden_in_pos, discontinued_at FROM products WHERE product_id = ?', [$id]);
            Response::success($product, 'Producto creado');
            break;

        case 'PUT':
            if ($actor['via'] === 'session') {
                if (!$auth->hasRole([ROLE_ADMIN, ROLE_MANAGER])) { Response::error('Permisos insuficientes', 403); }
            } else {
                $apiAuth->requireScope($actor, 'write');
            }
            $data = json_decode(file_get_contents('php://input'), true);
            if (!$data) { Response::validationError(['body' => 'JSON inválido']); }

            $store_id = (int)$currentUser['store_id'];
            $product_id = isset($data['product_id']) ? (int)$data['product_id'] : 0;

            if ($product_id <= 0) { Response::validationError(['product_id' => 'Requerido']); }

            $exists = $db->selectOne('SELECT product_id FROM products WHERE product_id = ? AND store_id = ?', [$product_id, $store_id]);
            if (!$exists) { Response::notFound('Producto no existe o no pertenece a su tienda'); }

            // Handle archive action (set discontinued + hide from POS)
            if (!empty($data['archive'])) {
                $db->update(
                    'UPDATE products SET hidden_in_pos = 1, discontinued_at = NOW(), status = ?, updated_at = NOW() WHERE product_id = ? AND store_id = ?',
                    [STATUS_INACTIVE, $product_id, $store_id]
                );
                $product = $db->selectOne('SELECT product_id, product_name, image_path, barcode, qr_code, price, cost, current_stock, min_stock, status, is_bulk, bulk_unit, tracking_type, consume_mode, pieces_per_box, is_ingredient, hidden_in_pos, discontinued_at FROM products WHERE product_id = ?', [$product_id]);
                Response::success($product, 'Producto retirado');
                break;
            }

            // Handle restore action (clear discontinued + make visible in POS)
            if (!empty($data['restore'])) {
                $newHidden = isset($data['hidden_in_pos']) ? (int)$data['hidden_in_pos'] : 0;
                $db->update(
                    'UPDATE products SET discontinued_at = NULL, hidden_in_pos = ?, status = ?, updated_at = NOW() WHERE product_id = ? AND store_id = ?',
                    [$newHidden, STATUS_ACTIVE, $product_id, $store_id]
                );
                $product = $db->selectOne('SELECT product_id, product_name, image_path, barcode, qr_code, price, cost, current_stock, min_stock, status, is_bulk, bulk_unit, tracking_type, consume_mode, pieces_per_box, is_ingredient, hidden_in_pos, discontinued_at FROM products WHERE product_id = ?', [$product_id]);
                Response::success($product, 'Producto restaurado');
                break;
            }

            $fields = [];
            $params = [];
            if (isset($data['product_name'])) { $fields[] = 'product_name = ?'; $params[] = Validator::sanitizeString($data['product_name']); }
            if (isset($data['description'])) { $fields[] = 'description = ?'; $params[] = Validator::sanitizeString($data['description']); }

            if (isset($data['barcode'])) {
                $val = Validator::sanitizeString($data['barcode']);
                $barcode = ($val !== '') ? $val : null;
                if ($barcode && $db->selectOne('SELECT product_id FROM products WHERE barcode = ? AND store_id = ? AND product_id <> ?', [$barcode, $store_id, $product_id])) {
                    Response::validationError(['barcode' => 'Duplicado en esta tienda']);
                }
                $fields[] = 'barcode = ?';
                $params[] = $barcode;
            }

            if (isset($data['qr_code'])) {
                $val = Validator::sanitizeString($data['qr_code']);
                $qr = ($val !== '') ? $val : null;
                if ($qr && $db->selectOne('SELECT product_id FROM products WHERE qr_code = ? AND store_id = ? AND product_id <> ?', [$qr, $store_id, $product_id])) {
                    Response::validationError(['qr_code' => 'Duplicado en esta tienda']);
                }
                $fields[] = 'qr_code = ?';
                $params[] = $qr;
            }

            if (isset($data['price'])) { if (!Validator::validatePrice($data['price'])) { Response::validationError(['price' => 'Inválido']); } $fields[] = 'price = ?'; $params[] = $data['price']; }
            if (isset($data['cost'])) { if (!Validator::validatePrice($data['cost'])) { Response::validationError(['cost' => 'Inválido']); } $fields[] = 'cost = ?'; $params[] = $data['cost']; }
            if (isset($data['min_stock'])) { $fields[] = 'min_stock = ?'; $params[] = (int)$data['min_stock']; }
            if (isset($data['status'])) { if (!in_array($data['status'], [STATUS_ACTIVE, STATUS_INACTIVE])) { Response::validationError(['status' => 'Inválido']); } $fields[] = 'status = ?'; $params[] = $data['status']; }
            if (isset($data['category_id'])) { $cid = (int)$data['category_id']; if ($cid && !$db->selectOne('SELECT category_id FROM categories WHERE category_id = ?', [$cid])) { Response::validationError(['category_id' => 'No existe']); } $fields[] = 'category_id = ?'; $params[] = $cid; }
            if (isset($data['is_bulk'])) { $fields[] = 'is_bulk = ?'; $params[] = (int)$data['is_bulk']; }
            if (isset($data['bulk_unit'])) { $fields[] = 'bulk_unit = ?'; $params[] = Validator::sanitizeString($data['bulk_unit']); }

            // POS visibility
            if (array_key_exists('hidden_in_pos', $data)) {
                $val = (int)$data['hidden_in_pos'];
                $fields[] = 'hidden_in_pos = ?';
                $params[] = $val;
                // If hiding from POS, do not automatically archive
            }

            // --- BOM fields ---
            if (isset($data['tracking_type'])) {
                $tt = Validator::sanitizeString($data['tracking_type']);
                if (!in_array($tt, [TRACKING_STOCK, TRACKING_RECIPE, TRACKING_COMPONENT, TRACKING_NONE], true)) { Response::validationError(['tracking_type' => 'Inválido']); }
                $fields[] = 'tracking_type = ?';
                $params[] = $tt;
            }
            if (isset($data['consume_mode'])) {
                $cm = Validator::sanitizeString($data['consume_mode']);
                if (!in_array($cm, [CONSUME_FIFO, CONSUME_LIFO, CONSUME_MANUAL], true)) { Response::validationError(['consume_mode' => 'Inválido']); }
                $fields[] = 'consume_mode = ?';
                $params[] = $cm;
            }
            if (isset($data['is_ingredient'])) { $fields[] = 'is_ingredient = ?'; $params[] = (int)$data['is_ingredient']; }
            if (array_key_exists('pieces_per_box', $data)) {
                $ppb = (isset($data['pieces_per_box']) && is_numeric($data['pieces_per_box']) && (int)$data['pieces_per_box'] > 0) ? (int)$data['pieces_per_box'] : null;
                $fields[] = 'pieces_per_box = ?';
                $params[] = $ppb;
            }
            if (isset($data['cost_per_box']) && is_numeric($data['cost_per_box'])) {
                $cpr = (float)$data['cost_per_box'];
                $ppb = null;
                if (array_key_exists('pieces_per_box', $data) && isset($data['pieces_per_box']) && (int)$data['pieces_per_box'] > 0) {
                    $ppb = (int)$data['pieces_per_box'];
                } else {
                    $cur = $db->selectOne('SELECT pieces_per_box FROM products WHERE product_id = ? AND store_id = ?', [$product_id, $store_id]);
                    $ppb = $cur ? (int)($cur['pieces_per_box'] ?? 0) : 0;
                }
                if ($ppb > 0) {
                    $fields[] = 'cost = ?';
                    $params[] = $cpr / $ppb;
                }
            }

            if (!$fields) { Response::error('Nada para actualizar', 400); }
            $fields[] = 'updated_at = NOW()';
            $params[] = $product_id;

            $sql = 'UPDATE products SET ' . implode(', ', $fields) . ' WHERE product_id = ? AND store_id = ?';
            $params[] = $store_id;

            $db->update($sql, $params);
            $product = $db->selectOne('SELECT product_id, product_name, image_path, barcode, qr_code, price, cost, current_stock, min_stock, status, is_bulk, bulk_unit, tracking_type, consume_mode, pieces_per_box, is_ingredient, hidden_in_pos, discontinued_at FROM products WHERE product_id = ?', [$product_id]);
            Response::success($product, 'Producto actualizado');
            break;

        default:
            Response::error('Método no permitido', 405);
    }
} catch (Exception $e) {
    Response::error('Error servidor: ' . $e->getMessage(), 500);
}
