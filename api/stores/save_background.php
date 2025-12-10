<?php
require_once '../../includes/Response.class.php';
require_once 'config.php';

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

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
    
    // Mover a carpeta permanente (simulada por ahora en 'saved')
    // En un sistema real, usaríamos el ID de la tienda de la sesión
    $storeId = 1; // Placeholder
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
