<?php
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

$db = new Database();
$auth = new Auth($db);

if (!$auth->isLoggedIn()) {
    Response::unauthorized();
}

$data = json_decode(file_get_contents('php://input'), true);
$promotion_id = isset($data['promotion_id']) ? $data['promotion_id'] : null;

if (!$promotion_id) {
    Response::error('ID de promoción requerido', 400);
}

$store_id = $_SESSION['store_id'];

try {
    $conn = $db->getConnection();

    // Verificar que pertenezca a la tienda
    $stmt = $conn->prepare("DELETE FROM promotions WHERE promotion_id = :id AND store_id = :store_id");
    $stmt->execute([':id' => $promotion_id, ':store_id' => $store_id]);

    if ($stmt->rowCount() > 0) {
        Response::success(null, 'Promoción eliminada');
    } else {
        Response::error('Promoción no encontrada o no autorizada', 404);
    }

} catch (Exception $e) {
    Response::error('Error al eliminar: ' . $e->getMessage(), 500);
}
