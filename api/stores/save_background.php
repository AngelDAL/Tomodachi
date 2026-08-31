<?php
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

// Seguridad: requiere sesión iniciada
$db = new Database();
$auth = new Auth($db);
if (!$auth->isLoggedIn()) { Response::unauthorized(); }
$currentUser = $auth->getCurrentUser();
$storeId = (int)$currentUser['store_id'];
if ($storeId <= 0) { Response::error('Tienda no identificada', 400); }

if (!isset($_POST['image_url'])) {
    Response::error('Falta la URL de la imagen');
}

try {
    $tempUrl = $_POST['image_url'];
    // $tempUrl viene como 'assets/images/backgrounds/temp/bg_....png'
    
    // Validar path traversal
    if (strpos($tempUrl, '..') !== false) {
        Response::error('URL inválida');
    }
    
    $sourcePath = '../../public/' . $tempUrl;
    
    if (!file_exists($sourcePath)) {
        Response::error('El archivo temporal no existe');
    }
    
    // Mover a carpeta permanente de la tienda del usuario
    $targetDir = "../../public/assets/images/backgrounds/store_{$storeId}/";
    
    if (!file_exists($targetDir)) mkdir($targetDir, 0777, true);
    
    $fileName = basename($sourcePath);
    $targetPath = $targetDir . $fileName;
    
    if (rename($sourcePath, $targetPath)) {
        echo json_encode([
            'status' => 'success',
            'message' => 'Fondo guardado en la biblioteca de la tienda',
            'new_url' => "assets/images/backgrounds/store_{$storeId}/{$fileName}"
        ]);
    } else {
        Response::error('Error al mover el archivo');
    }

} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
