<?php
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';
$db = new Database(); $auth = new Auth($db); $apiAuth = new ApiAuth($db);
$actor = $apiAuth->requireActor($auth); $storeId = (int)$actor['store_id'];
$conn = $db->getConnection();
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $stmt = $conn->prepare('SELECT tag_id, name FROM product_tags WHERE store_id = ? ORDER BY name');
    $stmt->execute([$storeId]); Response::success($stmt->fetchAll(PDO::FETCH_ASSOC));
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') Response::error('Método no permitido', 405);
if ($actor['via'] === 'token') $apiAuth->requireScope($actor, 'write');
$data = json_decode(file_get_contents('php://input'), true) ?: [];
$action = $data['action'] ?? '';
try {
    if ($action === 'create') {
        $name = trim((string)($data['name'] ?? ''));
        if ($name === '' || mb_strlen($name) > 80) Response::error('La etiqueta debe tener entre 1 y 80 caracteres', 422);
        $stmt = $conn->prepare('INSERT INTO product_tags (store_id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE tag_id = LAST_INSERT_ID(tag_id)');
        $stmt->execute([$storeId, $name]); Response::success(['tag_id' => (int)$conn->lastInsertId(), 'name' => $name], 'Etiqueta lista', 201);
    }
    if ($action === 'assign') {
        $tagId = (int)($data['tag_id'] ?? 0); $productIds = array_unique(array_map('intval', (array)($data['product_ids'] ?? [])));
        if (!$tagId || !$productIds) Response::error('Selecciona una etiqueta y al menos un producto', 422);
        $own = $conn->prepare('SELECT 1 FROM product_tags WHERE tag_id=? AND store_id=?'); $own->execute([$tagId, $storeId]);
        if (!$own->fetchColumn()) Response::error('Etiqueta no encontrada', 404);
        $check = $conn->prepare('SELECT 1 FROM products WHERE product_id=? AND store_id=?');
        $insert = $conn->prepare('INSERT IGNORE INTO product_tag_assignments (product_id, tag_id) VALUES (?, ?)');
        $conn->beginTransaction();
        foreach ($productIds as $id) { $check->execute([$id, $storeId]); if (!$check->fetchColumn()) throw new Exception('Producto inválido'); $insert->execute([$id, $tagId]); }
        $conn->commit(); Response::success([], 'Etiqueta asignada a los productos seleccionados');
    }
    Response::error('Acción inválida', 422);
} catch (Throwable $e) { if ($conn->inTransaction()) $conn->rollBack(); Response::error('No se pudo guardar la etiqueta', 500); }
