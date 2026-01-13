<?php
require_once 'config/database.php';
require_once 'includes/Database.class.php';

try {
    $db = new Database();
    $conn = $db->getConnection();
    
    // Check PDO Attribute
    echo "PDO Error Mode: " . $conn->getAttribute(PDO::ATTR_ERRMODE) . "\n";
    echo "(0=Silent, 1=Warning, 2=Exception)\n";

    // Attempt simple insert
    $conn->beginTransaction();
    $stmt = $conn->prepare("INSERT INTO promotions (store_id, name, start_date, end_date, type, discount_type, discount_value) 
                            VALUES (1, 'Test Debug', NOW(), NOW(), 'simple_discount', 'percentage', 10)");
    $stmt->execute();
    $id = $conn->lastInsertId();
    echo "Inserted Test ID: $id\n";
    $conn->commit();

} catch (Exception $e) {
    echo "Exception: " . $e->getMessage() . "\n";
}
