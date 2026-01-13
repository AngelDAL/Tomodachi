<?php
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';

// Verificar método
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

$db = new Database();
$auth = new Auth($db);

if (!$auth->isLoggedIn()) {
    Response::unauthorized();
}

// Obtener datos
$data = json_decode(file_get_contents('php://input'), true);

if (!isset($data['promotion_id'])) {
    Response::error('ID de promoción no especificado', 400);
}

// Validaciones básicas requeridas
if (!isset($data['name']) || empty($data['name'])) {
    Response::error('El nombre de la promoción es requerido', 400);
}
if (!isset($data['start_date']) || !isset($data['end_date'])) {
    Response::error('Las fechas de inicio y fin son requeridas', 400);
}
if (!isset($data['type'])) {
    Response::error('El tipo de promoción es requerido', 400);
}

$promotion_id = (int)$data['promotion_id'];
$store_id = $auth->getCurrentUser()['store_id'];
$name = Validator::sanitizeString($data['name']);
$description = isset($data['description']) ? Validator::sanitizeString($data['description']) : '';

// Validar fechas
try {
    $start_date = date('Y-m-d H:i:s', strtotime($data['start_date']));
    $end_date = date('Y-m-d H:i:s', strtotime($data['end_date']));
} catch (Exception $e) {
    Response::error('Formato de fecha inválido', 400);
}

$type = $data['type'];

// Lógica específica por tipo de promoción - Copiada de create.php
$discount_type = isset($data['discount_type']) ? $data['discount_type'] : 'percentage';
$discount_value = isset($data['discount_value']) ? $data['discount_value'] : 0;

if ($type === 'bundle') {
    if (isset($data['bundle_price']) && is_numeric($data['bundle_price'])) {
        $discount_value = $data['bundle_price'];
        $discount_type = 'fixed_price';
    } else {
        Response::error("El precio del paquete (bundle_price) es requerido", 400);
    }
} else {
    if ((!isset($data['discount_value']) || $data['discount_value'] === '')) {
        Response::error("El valor del descuento es requerido", 400);
    }
}

$discount_value = floatval($discount_value);
$min_purchase_amount = isset($data['min_purchase_amount']) ? $data['min_purchase_amount'] : 0;
$min_quantity = isset($data['min_quantity']) ? $data['min_quantity'] : 1;
$targets = isset($data['targets']) ? $data['targets'] : [];
$is_active = isset($data['is_active']) ? (int)$data['is_active'] : 1;

try {
    $conn = $db->getConnection();
    $conn->beginTransaction();

    // 1. Verificar propiedad y existencia
    $checkStmt = $conn->prepare("SELECT promotion_id FROM promotions WHERE promotion_id = :id AND store_id = :store_id");
    $checkStmt->execute([':id' => $promotion_id, ':store_id' => $store_id]);
    if (!$checkStmt->fetch()) {
        throw new Exception("Promoción no encontrada o acceso denegado");
    }

    // 2. Actualizar tabla principal
    $stmt = $conn->prepare("
        UPDATE promotions SET
            name = :name,
            description = :description,
            start_date = :start_date,
            end_date = :end_date,
            type = :type,
            discount_type = :discount_type,
            discount_value = :discount_value,
            min_purchase_amount = :min_purchase_amount,
            min_quantity = :min_quantity,
            is_active = :is_active
        WHERE promotion_id = :promotion_id AND store_id = :store_id
    ");

    $stmt->execute([
        ':name' => $name,
        ':description' => $description,
        ':start_date' => $start_date,
        ':end_date' => $end_date,
        ':type' => $type,
        ':discount_type' => $discount_type,
        ':discount_value' => $discount_value,
        ':min_purchase_amount' => $min_purchase_amount,
        ':min_quantity' => $min_quantity,
        ':is_active' => $is_active,
        ':promotion_id' => $promotion_id,
        ':store_id' => $store_id
    ]);

    // 3. Actualizar Targets (Borrar e Insertar de nuevo)
    // Primero, borrar existentes
    $delTargets = $conn->prepare("DELETE FROM promotion_targets WHERE promotion_id = :promotion_id");
    $delTargets->execute([':promotion_id' => $promotion_id]);

    // Insertar nuevos targets
    if (!empty($targets)) {
        $stmtTarget = $conn->prepare("
            INSERT INTO promotion_targets (promotion_id, product_id, category_id)
            VALUES (:promotion_id, :product_id, :category_id)
        ");

        foreach ($targets as $target) {
            // Manejar tanto el formato del UI (id, type) como el formato raw si viniera de DB
            $tType = isset($target['type']) ? $target['type'] : null;
            $tId = isset($target['id']) ? $target['id'] : null;

            if (!$tType || !$tId) continue;

            $product_id = ($tType === 'product') ? $tId : null;
            $category_id = ($tType === 'category') ? $tId : null;
            
            if ($product_id === null && $category_id === null) continue;

            $stmtTarget->execute([
                ':promotion_id' => $promotion_id,
                ':product_id' => $product_id,
                ':category_id' => $category_id
            ]);
        }
    }

    $conn->commit();
    Response::success(['message' => 'Promoción actualizada correctamente', 'id' => $promotion_id]);

} catch (Exception $e) {
    if (isset($conn)) $conn->rollBack();
    Response::error('Error al actualizar: ' . $e->getMessage(), 500);
}
