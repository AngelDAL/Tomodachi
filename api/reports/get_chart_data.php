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
    $store_id = $_SESSION['store_id'] ?? 1;
    
    $startDate = $_GET['start_date'] ?? date('Y-m-d', strtotime('-6 days'));
    $endDate = $_GET['end_date'] ?? date('Y-m-d');
    
    $stmt = $conn->prepare("
        SELECT 
            DATE(s.sale_date) as date, 
            SUM(s.total) as revenue,
            SUM(sd.quantity * COALESCE(p.cost, 0)) as total_cost
        FROM sales s
        LEFT JOIN sale_details sd ON s.sale_id = sd.sale_id
        LEFT JOIN products p ON sd.product_id = p.product_id
        WHERE s.store_id = ?
        AND DATE(s.sale_date) BETWEEN ? AND ?
        AND s.status = 'completed'
        GROUP BY DATE(s.sale_date)
        ORDER BY date ASC
    ");
    $stmt->execute([$store_id, $startDate, $endDate]);
    $data = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    // Fill gaps
    $labels = [];
    $revenue = [];
    $profit = [];
    
    $current = strtotime($startDate);
    $end = strtotime($endDate);
    
    while ($current <= $end) {
        $dateStr = date('Y-m-d', $current);
        $dayData = null;
        foreach ($data as $row) {
            if ($row['date'] === $dateStr) {
                $dayData = $row;
                break;
            }
        }
        
        $labels[] = date('d/m', $current);
        $rev = $dayData ? (float)$dayData['revenue'] : 0;
        $cost = $dayData ? (float)$dayData['total_cost'] : 0;
        
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
