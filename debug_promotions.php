<?php
require_once 'config/database.php';
require_once 'includes/Database.class.php';

try {
    $db = new Database();
    $conn = $db->getConnection();
    
    echo "--- Checking Promotions Table ---\n";
    $stmt = $conn->query("SELECT * FROM promotions");
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    if (empty($rows)) {
        echo "Table 'promotions' is empty.\n";
    } else {
        echo "Found " . count($rows) . " records:\n";
        foreach ($rows as $row) {
            echo "ID: " . $row['promotion_id'] . 
                 " | StoreID: " . $row['store_id'] . 
                 " | Name: " . $row['name'] . 
                 " | Active: " . $row['is_active'] . 
                 " | Start: " . $row['start_date'] . 
                 " | End: " . $row['end_date'] . "\n";
        }
    }

    echo "\n--- Checking Users Table (for Store ID context) ---\n";
    $stmt = $conn->query("SELECT user_id, username, store_id FROM users LIMIT 5");
    $users = $stmt->fetchAll(PDO::FETCH_ASSOC);
    foreach ($users as $u) {
        echo "User: " . $u['username'] . " [ID: " . $u['user_id'] . "] -> Store: " . $u['store_id'] . "\n";
    }

} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
