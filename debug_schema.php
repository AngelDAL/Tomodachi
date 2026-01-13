<?php
require_once 'config/database.php';
require_once 'includes/Database.class.php';

try {
    $db = new Database();
    $conn = $db->getConnection();
    
    echo "--- Promotions Table Columns ---\n";
    $stmt = $conn->query("DESCRIBE promotions");
    $columns = $stmt->fetchAll(PDO::FETCH_ASSOC);
    foreach ($columns as $col) {
        echo $col['Field'] . " | " . $col['Type'] . "\n";
    }

} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
