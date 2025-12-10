<?php
require_once '../../includes/Response.class.php';
require_once 'config.php';

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

if (!isset($_FILES['image'])) {
    Response::error('Faltan datos (imagen)');
}

$apiKey = STABILITY_AI_API_KEY;

try {
    $imagePath = $_FILES['image']['tmp_name'];
    
    // 1. Llamar a Stability AI Remove Background
    $ch = curl_init();

    $postFields = [
        'image' => new \CURLFile($imagePath),
        'output_format' => 'png'
    ];

    curl_setopt_array($ch, [
        CURLOPT_URL => "https://api.stability.ai/v2beta/stable-image/edit/remove-background",
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            "Authorization: Bearer {$apiKey}",
            "Accept: image/*" 
        ],
        CURLOPT_POSTFIELDS => $postFields,
        CURLOPT_SSL_VERIFYPEER => false
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    
    if (curl_errno($ch)) {
        throw new Exception(curl_error($ch));
    }
    curl_close($ch);

    if ($httpCode === 200) {
        // $response es el binario de la imagen PNG transparente
        $transparentImage = imagecreatefromstring($response);
        
        // 2. Crear lienzo blanco
        $width = imagesx($transparentImage);
        $height = imagesy($transparentImage);
        
        $whiteBg = imagecreatetruecolor($width, $height);
        $white = imagecolorallocate($whiteBg, 255, 255, 255);
        imagefill($whiteBg, 0, 0, $white);
        
        // 3. Componer
        imagealphablending($whiteBg, true);
        imagecopy($whiteBg, $transparentImage, 0, 0, 0, 0, $width, $height);
        
        // 4. Guardar
        $uploadDir = '../../public/assets/images/products/temp/';
        if (!file_exists($uploadDir)) mkdir($uploadDir, 0777, true);
        
        $fileName = 'ai_white_' . time() . '_' . uniqid() . '.png';
        $filePath = $uploadDir . $fileName;
        
        imagepng($whiteBg, $filePath);
        
        imagedestroy($transparentImage);
        imagedestroy($whiteBg);
        
        $publicUrl = 'assets/images/products/temp/' . $fileName;

        echo json_encode([
            'status' => 'success', 
            'image_url' => $publicUrl,
            'message' => 'Fondo eliminado correctamente'
        ]);

    } else {
        $errorData = json_decode($response, true);
        $message = isset($errorData['errors']) ? json_encode($errorData['errors']) : 'Error desconocido';
        Response::error('Error Stability AI: ' . $message, $httpCode);
    }

} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
