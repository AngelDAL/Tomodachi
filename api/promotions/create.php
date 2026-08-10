<?php
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';

// Verificar método
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

$db = new Database();
$auth = new Auth($db);

$apiAuth = new ApiAuth($db);
$actor = $apiAuth->requireActor($auth);
if ($actor['via'] === 'token') { $apiAuth->requireScope($actor, 'write'); }

// Obtener datos
$data = json_decode(file_get_contents('php://input'), true);

if (!$data) {
    Response::error('Datos inválidos', 400);
}

// Validar campos requeridos
$required = ['name', 'start_date', 'end_date', 'type'];
foreach ($required as $field) {
    if (!isset($data[$field]) || $data[$field] === '') {
        Response::error("El campo $field es requerido", 400);
    }
}

$store_id = $actor['store_id'];
$name = Validator::sanitizeString($data['name']);
$description = isset($data['description']) ? Validator::sanitizeString($data['description']) : '';
// Fix Date Format (Convert to valid Y-m-d H:i:s)
try {
    $start_date = date('Y-m-d H:i:s', strtotime($data['start_date']));
    $end_date = date('Y-m-d H:i:s', strtotime($data['end_date']));
} catch (Exception $e) {
    Response::error('Formato de fecha inválido', 400);
}

$type = $data['type'];

// Lógica específica por tipo de promoción
$discount_type = isset($data['discount_type']) ? $data['discount_type'] : 'percentage';
$discount_value = isset($data['discount_value']) ? $data['discount_value'] : 0;

if ($type === 'bundle') {
    // Para bundles, el valor viene en bundle_price y el tipo es fixed_price
    if (isset($data['bundle_price']) && is_numeric($data['bundle_price'])) {
        $discount_value = $data['bundle_price'];
        $discount_type = 'fixed_price';
    } else {
        Response::error("El precio del paquete (bundle_price) es requerido", 400);
    }
} else {
    // Para otros tipos, validar que discount_value exista y sea válido
    if ((!isset($data['discount_value']) || $data['discount_value'] === '')) {
        Response::error("El valor del descuento es requerido", 400);
    }
}

// Asegurar que sean numéricos para la BD
$discount_value = floatval($discount_value);

$min_purchase_amount = isset($data['min_purchase_amount']) ? $data['min_purchase_amount'] : 0;
$min_quantity = isset($data['min_quantity']) ? $data['min_quantity'] : 1;
$targets = isset($data['targets']) ? $data['targets'] : [];

try {
    // Reutilizar $db existente si es posible, pero Auth usa su propia instancia privada.
    // Creamos una nueva conexión para la transacción de inserción.
    $conn = $db->getConnection();
    $conn->beginTransaction();

    // Insertar promoción
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

    $stmt->execute([
        ':store_id' => $store_id,
        ':name' => $name,
        ':description' => $description,
        ':start_date' => $start_date,
        ':end_date' => $end_date,
        ':type' => $type,
        ':discount_type' => $discount_type,
        ':discount_value' => $discount_value,
        ':min_purchase_amount' => $min_purchase_amount,
        ':min_quantity' => $min_quantity
    ]);

    $promotion_id = $conn->lastInsertId();

    // Insertar targets
    if (!empty($targets)) {
        $stmtTarget = $conn->prepare("
            INSERT INTO promotion_targets (promotion_id, product_id, category_id)
            VALUES (:promotion_id, :product_id, :category_id)
        ");

        foreach ($targets as $target) {
            $product_id = ($target['type'] === 'product') ? $target['id'] : null;
            $category_id = ($target['type'] === 'category') ? $target['id'] : null;
            
            // Validar que al menos uno no sea null
            if (!$product_id && !$category_id) continue;

            $stmtTarget->execute([
                ':promotion_id' => $promotion_id,
                ':product_id' => $product_id,
                ':category_id' => $category_id
            ]);
        }
    }

    $conn->commit();
    Response::success(['promotion_id' => $promotion_id], 'Promoción creada exitosamente', 201);

} catch (Throwable $e) { 
    if (isset($conn) && $conn->inTransaction()) {
        $conn->rollBack();
    }
    
    // Use absolute path for logs to avoid resolution issues
    $logPath = __DIR__ . '/../../logs/promotions_error.log';
    $errorMsg = date('Y-m-d H:i:s') . " Error: " . $e->getMessage() . "\n" . $e->getTraceAsString() . "\n";
    @file_put_contents($logPath, $errorMsg, FILE_APPEND);
    
    Response::error('Error del servidor: ' . $e->getMessage(), 500, ['trace' => $e->getTraceAsString()]);
}
