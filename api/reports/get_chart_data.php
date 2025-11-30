<?php
require_once '../../config/constants.php';
require_once '../../config/database.php';
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
    $store_id = $currentUser['store_id'] ?? 1;
    
    $startDate = $_GET['start_date'] ?? date('Y-m-d', strtotime('-6 days'));
    $endDate = $_GET['end_date'] ?? date('Y-m-d');
    
    // 1. Get Revenue per day (sales table only)
    $stmt = $conn->prepare("
        SELECT 
            DATE(sale_date) as date, 
            SUM(total) as revenue
        FROM sales
        WHERE store_id = ?
        AND DATE(sale_date) BETWEEN ? AND ?
        AND status = 'completed'
        GROUP BY DATE(sale_date)
    ");
    $stmt->execute([$store_id, $startDate, $endDate]);
    $revenueData = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);

    // 2. Get Cost per day
    $stmt = $conn->prepare("
        SELECT 
            DATE(s.sale_date) as date, 
            SUM(sd.quantity * COALESCE(p.cost, 0)) as total_cost
        FROM sales s
        JOIN sale_details sd ON s.sale_id = sd.sale_id
        JOIN products p ON sd.product_id = p.product_id
        WHERE s.store_id = ?
        AND DATE(s.sale_date) BETWEEN ? AND ?
        AND s.status = 'completed'
        GROUP BY DATE(s.sale_date)
    ");
    $stmt->execute([$store_id, $startDate, $endDate]);
    $costData = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
    
    // Fill gaps
    $labels = [];
    $revenue = [];
    $profit = [];
    
    $current = strtotime($startDate);
    $end = strtotime($endDate);
    
    while ($current <= $end) {
        $dateStr = date('Y-m-d', $current);
        
        $rev = isset($revenueData[$dateStr]) ? (float)$revenueData[$dateStr] : 0;
        $cost = isset($costData[$dateStr]) ? (float)$costData[$dateStr] : 0;
        
        $labels[] = date('d/m', $current);
        $revenue[] = $rev;
        $profit[] = $rev - $cost;
        
        $current = strtotime('+1 day', $current);
    }
    
    echo json_encode([
        'success' => true,
        'data' => [
            'labels' => $labels,
            'revenue' => $revenue,
            'profit' => $profit
        ]
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => $e->getMessage()]);
}
