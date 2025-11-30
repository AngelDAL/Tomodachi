<?php
/**
 * API: Importar productos desde JSON (procesado de Excel en frontend)
 * POST /api/stores/import_data.php
 */

require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';

header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST');

try {
    $db = new Database();
    $auth = new Auth($db);
    
    if (!$auth->isLoggedIn()) {
        Response::error('No autorizado', 401);
    }
    
    $currentUser = $auth->getCurrentUser();
    $store_id = $currentUser['store_id'];
    
    // Obtener datos del cuerpo de la solicitud
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!isset($input['products']) || !is_array($input['products'])) {
        Response::error('Datos inválidos. Se espera un array de productos.', 400);
    }
    
    $products = $input['products'];
    $stats = [
        'processed' => 0,
        'inserted' => 0,
        'updated' => 0,
        'errors' => 0
    ];
    
    $conn = $db->getConnection();
    $conn->beginTransaction();
    
    try {
        // Preparar sentencias
        // Verificar existencia por store_id para evitar conflictos entre tiendas
        $checkStmt = $conn->prepare("SELECT product_id FROM products WHERE store_id = ? AND (barcode = ? OR product_name = ?) LIMIT 1");
        
        $insertProductStmt = $conn->prepare("
            INSERT INTO products (store_id, category_id, product_name, description, barcode, price, cost, min_stock, status) 
            VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'active')
        ");
        
        $updateProductStmt = $conn->prepare("
            UPDATE products SET price = ?, cost = ?, updated_at = NOW() WHERE product_id = ?
        ");
        
        $checkInventoryStmt = $conn->prepare("SELECT inventory_id FROM inventory WHERE store_id = ? AND product_id = ?");
        
        $insertInventoryStmt = $conn->prepare("
            INSERT INTO inventory (store_id, product_id, current_stock) VALUES (?, ?, ?)
        ");
        
        $updateInventoryStmt = $conn->prepare("
            UPDATE inventory SET current_stock = current_stock + ? WHERE inventory_id = ?
        ");
        
        $logMovementStmt = $conn->prepare("
            INSERT INTO inventory_movements (store_id, product_id, user_id, movement_type, quantity, previous_stock, new_stock, notes)
            VALUES (?, ?, ?, 'entry', ?, ?, ?, 'Importación masiva')
        ");

        foreach ($products as $p) {
            $stats['processed']++;
            
            $name = trim($p['name'] ?? '');
            $barcode = trim($p['barcode'] ?? '');
            $price = floatval($p['price'] ?? 0);
            $cost = floatval($p['cost'] ?? 0);
            $stock = intval($p['stock'] ?? 0);
            $description = trim($p['description'] ?? 'Importado');
            
            if (empty($name)) {
                $stats['errors']++;
                continue;
            }
            
            // Manejo de código de barras: NULL si está vacío
            if ($barcode === '') {
                $barcode = null;
            }

            // Verificar si existe en la tienda actual
            $checkStmt->execute([$store_id, $barcode, $name]);
            $existing = $checkStmt->fetch(PDO::FETCH_ASSOC);
            
            $productId = null;
            $isNew = false;
            
            if ($existing) {
                // Actualizar producto existente
                $productId = $existing['product_id'];
                $updateProductStmt->execute([$price, $cost, $productId]);
                $stats['updated']++;
            } else {
                // Insertar nuevo producto con store_id
                $insertProductStmt->execute([$store_id, $name, $description, $barcode, $price, $cost, 0]);
                $productId = $conn->lastInsertId();
                $isNew = true;
                $stats['inserted']++;
            }
            
            // Gestionar Inventario
            $checkInventoryStmt->execute([$store_id, $productId]);
            $inventory = $checkInventoryStmt->fetch(PDO::FETCH_ASSOC);
            
            $currentStock = 0;
            $newStock = 0;
            
            if ($inventory) {
                // Ya existe en inventario de esta tienda
                // Si es importación, ¿sumamos o reemplazamos? 
                // Generalmente en migraciones se asume que es el stock inicial o un añadido.
                // Vamos a sumar para ser seguros.
                
                // To log movement correctly we need previous stock.
                $stmtStock = $conn->prepare("SELECT current_stock FROM inventory WHERE inventory_id = ?");
                $stmtStock->execute([$inventory['inventory_id']]);
                $currentStock = $stmtStock->fetchColumn();
                
                if ($stock > 0) {
                    $updateInventoryStmt->execute([$stock, $inventory['inventory_id']]);
                    $newStock = $currentStock + $stock;
                } else {
                    $newStock = $currentStock;
                }
            } else {
                // No existe en inventario, crear registro
                $insertInventoryStmt->execute([$store_id, $productId, $stock]);
                $currentStock = 0;
                $newStock = $stock;
            }
            
            // Registrar movimiento si hubo cambio de stock
            if ($stock > 0) {
                $logMovementStmt->execute([$store_id, $productId, $currentUser['user_id'], $stock, $currentStock, $newStock]);
            }
        }
        
        $conn->commit();
        Response::success($stats, 'Importación completada');
        
    } catch (Exception $e) {
        $conn->rollBack();
        Response::error('Error durante la importación: ' . $e->getMessage(), 500);
    }
    
} catch (Exception $e) {
    Response::error('Error en el servidor: ' . $e->getMessage(), 500);
}
