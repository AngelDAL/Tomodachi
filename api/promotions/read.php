<?php
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Método no permitido', 405);
}

$db = new Database();
$auth = new Auth($db);

$apiAuth = new ApiAuth($db);
$actor = $apiAuth->requireActor($auth);
$apiAuth->requireScope($actor, 'read');

$store_id = $actor['store_id'];
$only_active = isset($_GET['active']) && $_GET['active'] === 'true';

try {
    $conn = $db->getConnection();

    $sql = "SELECT * FROM promotions WHERE store_id = :store_id";
    
    if ($only_active) {
        $sql .= " AND is_active = 1 AND start_date <= NOW() AND end_date >= NOW()";
    }
    
    $sql .= " ORDER BY created_at DESC";

    $stmt = $conn->prepare($sql);
    $stmt->execute([':store_id' => $store_id]);
    $promotions = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Obtener targets y estadísticas inferidas para cada promoción
    foreach ($promotions as &$promo) {
        $stmtTargets = $conn->prepare("
            SELECT pt.*, p.product_name, p.image_path, c.category_name, ptg.name AS tag_name
            FROM promotion_targets pt
            LEFT JOIN products p ON pt.product_id = p.product_id
            LEFT JOIN categories c ON pt.category_id = c.category_id
            LEFT JOIN product_tags ptg ON pt.tag_id = ptg.tag_id
            WHERE pt.promotion_id = :promotion_id
        ");
        $stmtTargets->execute([':promotion_id' => $promo['promotion_id']]);
        $promo['targets'] = $stmtTargets->fetchAll(PDO::FETCH_ASSOC);

        // Calcular estadísticas de ventas inferidas por productos objetivo
        $productIds = array_values(array_filter(array_column($promo['targets'], 'product_id'), fn($v) => $v !== null));
        $categoryIds = array_values(array_filter(array_column($promo['targets'], 'category_id'), fn($v) => $v !== null));

        if (empty($productIds) && empty($categoryIds)) {
            $promo['stats'] = [
                'units_sold' => 0,
                'sales_count' => 0,
                'revenue' => 0.00
            ];
        } else {
            $conditions = [];
            $params = [$store_id, $promo['start_date'], $promo['end_date']];

            if (!empty($productIds)) {
                $placeholders = implode(',', array_fill(0, count($productIds), '?'));
                $conditions[] = "sd.product_id IN ($placeholders)";
                $params = array_merge($params, $productIds);
            }

            if (!empty($categoryIds)) {
                $placeholders = implode(',', array_fill(0, count($categoryIds), '?'));
                $conditions[] = "sd.product_id IN (SELECT product_id FROM products WHERE category_id IN ($placeholders))";
                $params = array_merge($params, $categoryIds);
            }

            $where = implode(' OR ', $conditions);
            $sqlStats = "
                SELECT 
                    COALESCE(SUM(sd.quantity), 0) as units_sold,
                    COUNT(DISTINCT sd.sale_id) as sales_count,
                    COALESCE(SUM(sd.total), 0) as revenue
                FROM sale_details sd
                JOIN sales s ON sd.sale_id = s.sale_id
                WHERE s.store_id = ?
                  AND s.status = 'completed'
                  AND s.sale_date BETWEEN ? AND ?
                  AND ($where)
            ";

            $stmtStats = $conn->prepare($sqlStats);
            $stmtStats->execute($params);
            $promo['stats'] = $stmtStats->fetch(PDO::FETCH_ASSOC);
        }
    }

    Response::success($promotions);

} catch (Exception $e) {
    Response::error('Error al obtener promociones: ' . $e->getMessage(), 500);
}
