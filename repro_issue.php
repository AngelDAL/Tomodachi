<?php
// Mock Session
session_start();
$_SESSION['store_id'] = 1;

require_once 'config/database.php';
require_once 'includes/Database.class.php';
require_once 'includes/Response.class.php';
require_once 'includes/Validator.class.php';

// Mock Input Data
$json = '{"name":"Make the ship real!","start_date":"2026-01-09T14:04","end_date":"2026-02-09T14:04","type":"bundle","discount_type":"percentage","discount_value":"","bundle_price":"50","targets":[{"type":"product","id":2,"name":"Agua Natural 1L","price":"10.00","cost":"6.00","image":"public/assets/images/products/p_2_1767380911.webp"},{"type":"product","id":7,"name":"Aceite Vegetal 1-2-3 1L","price":"38.50","cost":"32.00","image":"public/assets/images/products/p_7_1767380253.jpg"}]}';
$data = json_decode($json, true);

echo "--- Debugging Logic ---\n";

$store_id = $_SESSION['store_id'];
$name = Validator::sanitizeString($data['name']);
$description = isset($data['description']) ? Validator::sanitizeString($data['description']) : '';
$start_date = str_replace('T', ' ', $data['start_date']);
$end_date = str_replace('T', ' ', $data['end_date']);

$type = $data['type'];

// Logic Check
$discount_type = isset($data['discount_type']) ? $data['discount_type'] : 'percentage';
$discount_value = isset($data['discount_value']) ? $data['discount_value'] : 0;

echo "Initial discount_value: '$discount_value' (Type: " . gettype($discount_value) . ")\n";
echo "Initial discount_type: '$discount_type'\n";

if ($type === 'bundle') {
    echo "Is Bundle\n";
    if (isset($data['bundle_price']) && is_numeric($data['bundle_price'])) {
        $discount_value = $data['bundle_price'];
        $discount_type = 'fixed_price';
        echo "Overrode discount_value to bundle_price: '$discount_value'\n";
    } else {
        echo "Bundle Price invalid\n";
    }
} else {
    if ((!isset($data['discount_value']) || $data['discount_value'] === '')) {
        echo "Error: Discount value required\n";
    }
}

$discount_value = floatval($discount_value);
echo "Final discount_value: $discount_value\n";
echo "Final discount_type: $discount_type\n";

try {
    $db = new Database();
    $conn = $db->getConnection();
    $conn->beginTransaction();

    echo "Preparing Insert...\n";
    $stmt = $conn->prepare("
        INSERT INTO promotions (
            store_id, name, description, start_date, end_date, 
            type, discount_type, discount_value, 
            min_purchase_amount, min_quantity
        ) VALUES (
            :store_id, :name, :description, :start_date, :end_date,
            :type, :discount_type, :discount_value,
            :min_purchase_amount, :min_quantity
        )
    ");

    $params = [
        ':store_id' => $store_id,
        ':name' => $name,
        ':description' => $description,
        ':start_date' => $start_date,
        ':end_date' => $end_date,
        ':type' => $type,
        ':discount_type' => $discount_type,
        ':discount_value' => $discount_value,
        ':min_purchase_amount' => 0,
        ':min_quantity' => 1
    ];
    
    echo "Params:\n";
    print_r($params);

    $stmt->execute($params);
    echo "Insert Success! ID: " . $conn->lastInsertId() . "\n";
    $conn->rollBack(); // Rollback test

} catch (Throwable $e) {
    echo "Caught Error: " . $e->getMessage() . "\n";
    echo $e->getTraceAsString();
}
