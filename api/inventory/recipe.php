<?php
/**
 * Recetas API — gestión de productos ensamblados (BOM)
 *
 * GET    /api/inventory/recipe.php?store_id=&product_id=N
 *        → metadatos + ingredientes de la receta + disponibilidad derivada.
 *
 * POST   /api/inventory/recipe.php
 *        Body: { store_id?, product_id, ingredients: [ {component_id, quantity} ] }
 *        Reemplaza la receta completa del producto y lo marca como 'recipe'.
 *        Valida pertenencia a la tienda, sin auto-referencia y sin ciclos
 *        (recetas anidadas permitidas, con guardia).
 *
 * DELETE /api/inventory/recipe.php
 *        Body: { store_id?, product_id }
 *        Elimina los ingredientes de la receta (deja el tipo como esté).
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
            $store_id = (int)$currentUser['store_id'];
            $product_id = isset($_GET['product_id']) ? (int)$_GET['product_id'] : 0;
            if ($product_id <= 0) { Response::validationError(['product_id' => 'Requerido']); }

            $product = $db->selectOne(
                'SELECT product_id, product_name, price, cost, current_stock, tracking_type, pieces_per_box, is_ingredient, min_stock
                 FROM products WHERE product_id = ? AND store_id = ?',
                [$product_id, $store_id]
            );
            if (!$product) { Response::notFound('Producto no existe o no pertenece a su tienda'); }

            $bom = new BomHelper($db);
            $type = $bom->normalizeType($product['tracking_type'] ?? 'stock');
            $product['tracking_type'] = $type;

            $ingredients = $db->select(
                'SELECT ri.recipe_id, ri.component_id, ri.quantity,
                        p.product_name AS name, p.current_stock AS available_pieces, p.tracking_type AS component_type, p.cost AS component_cost
                 FROM product_ingredients ri
                 JOIN products p ON p.product_id = ri.component_id AND p.store_id = ?
                 WHERE ri.product_id = ? ORDER BY ri.recipe_id ASC',
                [$store_id, $product_id]
            );

            $enriched = [];
            foreach ($ingredients as $ing) {
                $cType = $bom->normalizeType($ing['component_type'] ?? 'stock');
                $avail = (float)$ing['available_pieces'];
                if ($cType === TRACKING_COMPONENT) {
                    // Disponible de un componente = Σ de sus presentaciones.
                    $avail = $bom->blend($store_id, (int)$ing['component_id'])['total'];
                }
                $need = (float)$ing['quantity'];
                $units = ($cType === 'none')
                    ? PHP_INT_MAX
                    : (($need > 0) ? (int)floor($avail / $need) : PHP_INT_MAX);
                // Costo unitario real del componente (preciso incluso si el propio
                // componente es una composición anidada: se deriva de su propia receta).
                $unitCost = 0.0;
                try {
                    $unitCost = round($bom->unitCost($store_id, (int)$ing['component_id']), 2);
                } catch (Exception $ce) {
                    $unitCost = (float)($ing['component_cost'] ?? 0);
                }
                $enriched[] = [
                    'recipe_id' => (int)$ing['recipe_id'],
                    'component_id' => (int)$ing['component_id'],
                    'name' => $ing['name'],
                    'quantity' => $need,
                    'component_type' => $cType,
                    'unit_cost' => $unitCost,
                    'available_pieces' => $avail,
                    'units_possible' => $units,
                ];
            }

            try {
                $av = $bom->availability($store_id, $product_id);
                $product['available'] = $av['available'] === PHP_INT_MAX ? null : $av['available'];
                $product['limiting_ingredient'] = $av['limiting'];
                $product['derived_cost'] = round($av['unit_cost'], 2);
                $product['recipe_error'] = null;
                if (!$av['derived']) {
                    // No es composición (ni ensamblado ni servicio con insumos): sin
                    // disponibilidad derivada, se usa su stock/costo propio.
                    $product['available'] = null;
                    $product['derived_cost'] = (float)$product['cost'];
                }
            } catch (Exception $e) {
                $product['available'] = 0;
                $product['limiting_ingredient'] = null;
                $product['derived_cost'] = 0;
                $product['recipe_error'] = $e->getMessage();
            }

            Response::success(['product' => $product, 'ingredients' => $enriched], 'Receta del producto');
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
            $product_id = isset($data['product_id']) ? (int)$data['product_id'] : 0;
            $ingredients = isset($data['ingredients']) && is_array($data['ingredients']) ? $data['ingredients'] : [];

            if ($product_id <= 0) { Response::validationError(['product_id' => 'Requerido']); }
            if (!$ingredients) { Response::validationError(['ingredients' => 'La receta debe tener al menos un ingrediente']); }

            $product = $db->selectOne('SELECT product_id, product_name, tracking_type FROM products WHERE product_id = ? AND store_id = ?', [$product_id, $store_id]);
            if (!$product) { Response::notFound('Producto no existe o no pertenece a su tienda'); }
            $curType = in_array($product['tracking_type'] ?? '', ['stock', 'recipe', 'component', 'none'], true) ? $product['tracking_type'] : 'stock';

            $rows = [];
            $seen = [];
            foreach ($ingredients as $ing) {
                $cid = isset($ing['component_id']) ? (int)$ing['component_id'] : 0;
                $qty = isset($ing['quantity']) ? (float)$ing['quantity'] : 0.0;
                if ($cid <= 0 || $qty <= 0) { Response::validationError(['ingredients' => 'Ingrediente o cantidad inválida']); }
                if ($cid === $product_id) { Response::validationError(['ingredients' => 'Un producto no puede ser ingrediente de sí mismo']); }
                if (isset($seen[$cid])) { Response::validationError(['ingredients' => "Ingrediente duplicado (ID $cid)"]); }
                $seen[$cid] = true;
                $comp = $db->selectOne('SELECT product_id, tracking_type FROM products WHERE product_id = ? AND store_id = ?', [$cid, $store_id]);
                if (!$comp) { Response::validationError(['ingredients' => "Ingrediente (ID $cid) no existe o no pertenece a su tienda"]); }
                $rows[] = ['component_id' => $cid, 'quantity' => $qty];
            }

            $db->beginTransaction();
            try {
                // Solo un producto no-servicio se convierte en ensamblado; un SERVICIO con
                // composición conserva su tipo 'none' (consuma sus insumos por isAssembly).
                if ($curType !== TRACKING_NONE) {
                    $db->update('UPDATE products SET tracking_type = ?, updated_at = NOW() WHERE product_id = ? AND store_id = ?', [TRACKING_RECIPE, $product_id, $store_id]);
                }
                $db->delete('DELETE FROM product_ingredients WHERE product_id = ?', [$product_id]);
                foreach ($rows as $r) {
                    $db->insert(
                        'INSERT INTO product_ingredients (product_id, component_id, quantity) VALUES (?,?,?)',
                        [$product_id, $r['component_id'], $r['quantity']]
                    );
                }
                // Verificación de ciclos (recetas anidadas) antes de commit.
                $probeBom = new BomHelper($db);
                $probeBom->availability($store_id, $product_id); // lanza si hay ciclo o falta receta
                $db->commit();
            } catch (Exception $e) {
                $db->rollback();
                Response::error('Receta inválida: ' . $e->getMessage(), 400);
            }

            $bom = new BomHelper($db);
            $av = $bom->availability($store_id, $product_id);
            $resolvedType = ($curType === TRACKING_NONE) ? TRACKING_NONE : TRACKING_RECIPE;
            Response::success([
                'product_id' => $product_id,
                'tracking_type' => $resolvedType,
                'available' => $av['available'] === PHP_INT_MAX ? null : $av['available'],
                'derived_cost' => round($av['unit_cost'], 2),
            ], 'Receta guardada');
            break;

        case 'DELETE':
            if ($actor['via'] === 'session') {
                if (!$auth->hasRole([ROLE_ADMIN, ROLE_MANAGER])) { Response::error('Permisos insuficientes', 403); }
            } else {
                $apiAuth->requireScope($actor, 'write');
            }
            $data = json_decode(file_get_contents('php://input'), true);
            $product_id = isset($data['product_id']) ? (int)$data['product_id'] : 0;
            if ($product_id <= 0) { Response::validationError(['product_id' => 'Requerido']); }
            $store_id = (int)$currentUser['store_id'];
            $product = $db->selectOne('SELECT product_id FROM products WHERE product_id = ? AND store_id = ?', [$product_id, $store_id]);
            if (!$product) { Response::notFound('Producto no existe o no pertenece a su tienda'); }
            $db->delete('DELETE FROM product_ingredients WHERE product_id = ?', [$product_id]);
            Response::success(['product_id' => $product_id], 'Receta eliminada');
            break;

        default:
            Response::error('Método no permitido', 405);
    }
} catch (Exception $e) {
    Response::error('Error servidor: ' . $e->getMessage(), 500);
}