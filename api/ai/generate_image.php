<?php
require_once '../../includes/Response.class.php';
require_once 'config.php';

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

if (!isset($_FILES['image']) || !isset($_POST['prompt'])) {
    Response::error('Faltan datos (imagen o prompt)');
}

$apiKey = STABILITY_AI_API_KEY;

if ($apiKey === 'TU_API_KEY_DE_STABILITY_AQUI') {
    Response::error('API Key de Stability AI no configurada. Revisa api/ai/config.php');
}

try {
    $prompt = $_POST['prompt'];
    $imagePath = $_FILES['image']['tmp_name'];

    // Dimensiones permitidas estrictas para SDXL 1.0
    list($width, $height) = getimagesize($imagePath);
    
    $allowedDimensions = [
        [1024, 1024], // 1:1 Square
        [1152, 896],  // 9:7 Landscape
        [1216, 832],  // 19:13 Landscape
        [1344, 768],  // 7:4 Landscape
        [1536, 640],  // 12:5 Landscape
        [640, 1536],  // 5:12 Portrait
        [768, 1344],  // 4:7 Portrait
        [832, 1216],  // 13:19 Portrait
        [896, 1152]   // 7:9 Portrait
    ];

    $currentRatio = $width / $height;
    $finalWidth = 1024;
    $finalHeight = 1024;
    $minDiff = 9999;

    // Encontrar la dimensión permitida que mejor se ajuste al aspect ratio original
    foreach ($allowedDimensions as $dim) {
        $ratio = $dim[0] / $dim[1];
        $diff = abs($currentRatio - $ratio);
        if ($diff < $minDiff) {
            $minDiff = $diff;
            $finalWidth = $dim[0];
            $finalHeight = $dim[1];
        }
    }

    // Siempre forzamos el redimensionado para cumplir con los requisitos exactos de SDXL
    $needsResize = true;

    if ($needsResize) {
        $src = imagecreatefromstring(file_get_contents($imagePath));
        if ($src) {
            $dst = imagecreatetruecolor($finalWidth, $finalHeight);
            
            // Preservar transparencia
            imagealphablending($dst, false);
            imagesavealpha($dst, true);
            
            imagecopyresampled($dst, $src, 0, 0, 0, 0, $finalWidth, $finalHeight, $width, $height);
            
            $newPath = sys_get_temp_dir() . '/ai_resized_' . uniqid() . '.png';
            imagepng($dst, $newPath);
            
            imagedestroy($src);
            imagedestroy($dst);
            
            $imagePath = $newPath; // Usar la imagen redimensionada
        }
    }
    
    // Parámetros opcionales
    $strength = isset($_POST['strength']) ? floatval($_POST['strength']) : 0.35;
    
    // Llamada a Stability AI (Image-to-Image)
    $ch = curl_init();

    $postFields = [
        'init_image' => new \CURLFile($imagePath),
        'init_image_mode' => 'IMAGE_STRENGTH',
        'text_prompts[0][text]' => $prompt,
        'text_prompts[0][weight]' => 1,
        'cfg_scale' => 7,
        'image_strength' => $strength,
        'samples' => 1,
        'steps' => 30,
    ];

    curl_setopt_array($ch, [
        CURLOPT_URL => "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/image-to-image",
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            "Content-Type: multipart/form-data",
            "Accept: application/json",
            "Authorization: Bearer {$apiKey}"
        ],
        CURLOPT_POSTFIELDS => $postFields,
        // Deshabilitar verificación SSL para entorno local WAMP
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    
    if (curl_errno($ch)) {
        throw new Exception(curl_error($ch));
    }
    
    curl_close($ch);

    if ($httpCode === 200) {
        $data = json_decode($response, true);
        $base64Image = $data['artifacts'][0]['base64'];
        
        // Guardar imagen temporalmente en public/uploads/temp/
        $uploadDir = '../../public/assets/images/products/temp/';
        if (!file_exists($uploadDir)) {
            mkdir($uploadDir, 0777, true);
        }
        
        $fileName = 'ai_' . time() . '_' . uniqid() . '.png';
        $filePath = $uploadDir . $fileName;
        
        file_put_contents($filePath, base64_decode($base64Image));
        
        // URL relativa para el frontend
        $publicUrl = 'assets/images/products/temp/' . $fileName;

        echo json_encode([
            'status' => 'success', 
            'image_url' => $publicUrl,
            'message' => 'Imagen mejorada con éxito'
        ]);
    } else {
        $errorData = json_decode($response, true);
        $message = isset($errorData['message']) ? $errorData['message'] : 'Error desconocido de Stability AI';
        Response::error('Error API Externa: ' . $message, $httpCode);
    }

} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
