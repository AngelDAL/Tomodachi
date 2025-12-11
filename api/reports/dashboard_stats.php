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
    
    $type = $_GET['type'] ?? 'dashboard';
    $start_date = $_GET['start_date'] ?? date('Y-m-01');
    $end_date = $_GET['end_date'] ?? date('Y-m-t');

    if ($type === 'sales') {
        // Sales Report
        $stmt = $conn->prepare("
            SELECT 
                s.sale_id, 
                s.sale_date, 
                u.username, 
                s.payment_method, 
                s.total, 
                (s.total - SUM(sd.quantity * IFNULL(p.cost, 0))) as profit
            FROM sales s
            JOIN users u ON s.user_id = u.user_id
            JOIN sale_details sd ON s.sale_id = sd.sale_id
            LEFT JOIN products p ON sd.product_id = p.product_id
            WHERE s.store_id = ? 
            AND DATE(s.sale_date) BETWEEN ? AND ?
            AND s.status = 'completed'
            GROUP BY s.sale_id
            ORDER BY s.sale_date DESC
        ");
        $stmt->execute([$store_id, $start_date, $end_date]);
        $data = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['success' => true, 'data' => $data]);
        exit;
    }
    
    if ($type === 'inventory') {
        // Inventory Report
        $stmt = $conn->prepare("
            SELECT 
                p.product_name, 
                p.barcode, 
                p.image_path,
                p.current_stock, 
                p.cost, 
                p.price, 
                (p.current_stock * p.cost) as total_cost_value, 
                (p.current_stock * p.price) as total_price_value
            FROM products p
            WHERE p.store_id = ?
            ORDER BY p.product_name ASC
        ");
        $stmt->execute([$store_id]);
        $data = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['success' => true, 'data' => $data]);
        exit;
    }

    if ($type === 'top_products') {
        // Top Products Report
        $stmt = $conn->prepare("
            SELECT 
                p.product_name,
                p.barcode,
                p.image_path,
                SUM(sd.quantity) as total_sold,
                SUM(sd.total) as revenue,
                (SUM(sd.total) - SUM(sd.quantity * IFNULL(p.cost, 0))) as profit
            FROM sale_details sd
            JOIN sales s ON sd.sale_id = s.sale_id
            JOIN products p ON sd.product_id = p.product_id
            WHERE s.store_id = ?
            AND DATE(s.sale_date) BETWEEN ? AND ?
            AND s.status = 'completed'
            GROUP BY p.product_id
            ORDER BY total_sold DESC
        ");
        $stmt->execute([$store_id, $start_date, $end_date]);
        $data = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['success' => true, 'data' => $data]);
        exit;
    }

    if ($type === 'inventory_movements') {
        // Inventory Movements Report
        $stmt = $conn->prepare("
            SELECT 
                im.movement_id,
                im.created_at,
                p.product_name,
                p.barcode,
                p.image_path,
                u.username,
                im.movement_type,
                im.quantity,
                im.previous_stock,
                im.new_stock,
                im.notes
            FROM inventory_movements im
            JOIN products p ON im.product_id = p.product_id
            JOIN users u ON im.user_id = u.user_id
            WHERE im.store_id = ?
            AND DATE(im.created_at) BETWEEN ? AND ?
            ORDER BY im.created_at DESC
        ");
        $stmt->execute([$store_id, $start_date, $end_date]);
        $data = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['success' => true, 'data' => $data]);
        exit;
    }

    if ($type === 'cash_registers') {
        // Cash Registers History Report
        $stmt = $conn->prepare("
            SELECT 
                cr.register_id,
                cr.opening_date,
                cr.closing_date,
                u.username,
                t.terminal_name,
                cr.initial_amount,
                cr.final_amount,
                cr.expected_amount,
                cr.difference,
                cr.status,
                cr.notes
            FROM cash_registers cr
            JOIN users u ON cr.user_id = u.user_id
            LEFT JOIN terminals t ON cr.terminal_id = t.terminal_id
            WHERE cr.store_id = ?
            AND DATE(cr.opening_date) BETWEEN ? AND ?
            ORDER BY cr.opening_date DESC
        ");
        $stmt->execute([$store_id, $start_date, $end_date]);
        $data = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['success' => true, 'data' => $data]);
        exit;
    }

    if ($type === 'cash_movements') {
        // Cash Movements Report (Entries/Withdrawals)
        $stmt = $conn->prepare("
            SELECT 
                cm.movement_id,
                cm.created_at,
                u.username,
                t.terminal_name,
                cm.movement_type,
                cm.amount,
                cm.description
            FROM cash_movements cm
            JOIN cash_registers cr ON cm.register_id = cr.register_id
            JOIN users u ON cm.user_id = u.user_id
            LEFT JOIN terminals t ON cr.terminal_id = t.terminal_id
            WHERE cr.store_id = ?
            AND DATE(cm.created_at) BETWEEN ? AND ?
            ORDER BY cm.created_at DESC
        ");
        $stmt->execute([$store_id, $start_date, $end_date]);
        $data = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['success' => true, 'data' => $data]);
        exit;
    }
    
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
        SELECT p.product_name, p.current_stock, p.min_stock
        FROM products p
        WHERE p.store_id = ? 
        AND p.current_stock <= p.min_stock
        AND p.status = 'active'
        ORDER BY p.current_stock ASC
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
    
    // 7. Inventory Value
    $stmt = $conn->prepare("
        SELECT SUM(current_stock * cost) as inventory_value
        FROM products
        WHERE store_id = ? AND status = 'active'
    ");
    $stmt->execute([$store_id]);
    $inventoryValue = $stmt->fetchColumn() ?: 0;

    // 8. Low Stock Count
    $stmt = $conn->prepare("
        SELECT COUNT(*) 
        FROM products 
        WHERE store_id = ? 
        AND status = 'active' 
        AND current_stock <= min_stock
    ");
    $stmt->execute([$store_id]);
    $lowStockCount = $stmt->fetchColumn() ?: 0;

    // 9. Top Category (Last 30 days)
    $stmt = $conn->prepare("
        SELECT c.category_name
        FROM sale_details sd
        JOIN sales s ON sd.sale_id = s.sale_id
        JOIN products p ON sd.product_id = p.product_id
        JOIN categories c ON p.category_id = c.category_id
        WHERE s.store_id = ?
        AND s.sale_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        AND s.status = 'completed'
        GROUP BY c.category_id
        ORDER BY SUM(sd.total) DESC
        LIMIT 1
    ");
    $stmt->execute([$store_id]);
    $topCategory = $stmt->fetchColumn() ?: '-';

    echo json_encode([
        'success' => true,
        'data' => [
            'dailySales' => (float)$dailySales,
            'dailyProfit' => (float)$dailyProfit,
            'transactions' => (int)$transactions,
            'inventoryValue' => (float)$inventoryValue,
            'lowStockCount' => (int)$lowStockCount,
            'topCategory' => $topCategory,
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