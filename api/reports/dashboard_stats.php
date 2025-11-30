<?php
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Auth.class.php';

header('Content-Type: application/json');

try {
    $db = new Database();
    $auth = new Auth($db);
    
    if (!$auth->isLoggedIn()) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Unauthorized']);
        exit;
    }
    
    $conn = $db->getConnection();
    $currentUser = $auth->getCurrentUser();
    
    $store_id = $currentUser['store_id'] ?? 1; // Default to store 1 if not set
    
    // 1. Daily Sales
    $stmt = $conn->prepare("
        SELECT COALESCE(SUM(total), 0) as total_sales
        FROM sales
        WHERE store_id = ? 
        AND DATE(sale_date) = CURDATE() 
        AND status = 'completed'
    ");
    $stmt->execute([$store_id]);
    $dailySales = $stmt->fetch(PDO::FETCH_ASSOC)['total_sales'];

    // 1.1 Daily Cost (for Profit)
    $stmt = $conn->prepare("
        SELECT COALESCE(SUM(sd.quantity * COALESCE(p.cost, 0)), 0) as total_cost
        FROM sales s
        JOIN sale_details sd ON s.sale_id = sd.sale_id
        JOIN products p ON sd.product_id = p.product_id
        WHERE s.store_id = ? 
        AND DATE(s.sale_date) = CURDATE() 
        AND s.status = 'completed'
    ");
    $stmt->execute([$store_id]);
    $totalCost = $stmt->fetch(PDO::FETCH_ASSOC)['total_cost'];
    
    $dailyProfit = $dailySales - $totalCost;
    
    // 2. Transactions
    $stmt = $conn->prepare("
        SELECT COUNT(*) as count 
        FROM sales 
        WHERE store_id = ? 
        AND DATE(sale_date) = CURDATE() 
        AND status = 'completed'
    ");
    $stmt->execute([$store_id]);
    $transactions = $stmt->fetch()['count'];
    
    // 3. Low Stock List
    $stmt = $conn->prepare("
        SELECT p.product_name, i.current_stock, p.min_stock
        FROM inventory i
        JOIN products p ON i.product_id = p.product_id
        WHERE i.store_id = ? 
        AND i.current_stock <= p.min_stock
        AND p.status = 'active'
        ORDER BY i.current_stock ASC
        LIMIT 10
    ");
    $stmt->execute([$store_id]);
    $lowStockList = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // 4. Top Selling Products
    $stmt = $conn->prepare("
        SELECT 
            p.product_name,
            p.image_path,
            SUM(sd.quantity) as total_sold,
            SUM(sd.total) as revenue
        FROM sale_details sd
        JOIN sales s ON sd.sale_id = s.sale_id
        JOIN products p ON sd.product_id = p.product_id
        WHERE s.store_id = ?
        AND s.status = 'completed'
        GROUP BY p.product_id
        ORDER BY total_sold DESC
        LIMIT 5
    ");
    $stmt->execute([$store_id]);
    $topProducts = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    // 5. Recent Sales History
    $stmt = $conn->prepare("
        SELECT 
            s.sale_id, 
            s.sale_date, 
            s.total,
            (s.total - SUM(sd.quantity * COALESCE(p.cost, 0))) as profit,
            GROUP_CONCAT(CONCAT(COALESCE(p.image_path, ''), ':::', p.product_name) SEPARATOR '|||') as products_info
        FROM sales s
        JOIN sale_details sd ON s.sale_id = sd.sale_id
        JOIN products p ON sd.product_id = p.product_id
        WHERE s.store_id = ?
        AND s.status = 'completed'
        GROUP BY s.sale_id
        ORDER BY s.sale_date DESC
        LIMIT 10
    ");
    $stmt->execute([$store_id]);
    $recentSales = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Process products_info for easier consumption
    foreach ($recentSales as &$sale) {
        $products = [];
        if (!empty($sale['products_info'])) {
            $items = explode('|||', $sale['products_info']);
            foreach ($items as $item) {
                $parts = explode(':::', $item);
                $products[] = [
                    'image' => $parts[0] ?: null,
                    'name' => $parts[1] ?? 'Producto'
                ];
            }
        }
        $sale['products'] = $products;
        unset($sale['products_info']);
    }
    unset($sale); // Break reference

    // 6. Sales & Profit Chart Data (Last 7 days)
    
    // 6.1 Get Revenue per day (from sales table only)
    $stmt = $conn->prepare("
        SELECT 
            DATE(sale_date) as date, 
            SUM(total) as revenue
        FROM sales
        WHERE store_id = ?
        AND sale_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
        AND status = 'completed'
        GROUP BY DATE(sale_date)
    ");
    $stmt->execute([$store_id]);
    $revenueData = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);

    // 6.2 Get Cost per day
    $stmt = $conn->prepare("
        SELECT 
            DATE(s.sale_date) as date, 
            SUM(sd.quantity * COALESCE(p.cost, 0)) as total_cost
        FROM sales s
        JOIN sale_details sd ON s.sale_id = sd.sale_id
        JOIN products p ON sd.product_id = p.product_id
        WHERE s.store_id = ?
        AND s.sale_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
        AND s.status = 'completed'
        GROUP BY DATE(s.sale_date)
    ");
    $stmt->execute([$store_id]);
    $costData = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
    
    // Fill in missing dates with 0
    $labels = [];
    $revenueValues = [];
    $profitValues = [];
    
    for ($i = 6; $i >= 0; $i--) {
        $date = date('Y-m-d', strtotime("-$i days"));
        
        $revenue = isset($revenueData[$date]) ? (float)$revenueData[$date] : 0;
        $cost = isset($costData[$date]) ? (float)$costData[$date] : 0;
        $profit = $revenue - $cost;
        
        $labels[] = date('d/m', strtotime($date));
        $revenueValues[] = $revenue;
        $profitValues[] = $profit;
    }
    
    echo json_encode([
        'success' => true,
        'data' => [
            'dailySales' => (float)$dailySales,
            'dailyProfit' => (float)$dailyProfit,
            'transactions' => (int)$transactions,
            'lowStockList' => $lowStockList,
            'topProducts' => $topProducts,
            'recentSales' => $recentSales,
            'chart' => [
                'labels' => $labels,
                'revenue' => $revenueValues,
                'profit' => $profitValues
            ]
        ]
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => $e->getMessage()]);
}
?>