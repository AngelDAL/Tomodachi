<?php
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';

header('Content-Type: application/json');

// Funciones de IA deshabilitadas en Community Edition (OPEN_SOURCE)
// (check antes de cargar config.php para no depender de API keys en CE)
if (APP_MODE === 'OPEN_SOURCE') {
    Response::error('Funciones de IA no incluidas en Community Edition', 403);
}
require_once 'config.php';

// Seguridad: requiere sesión iniciada
$db = new Database();
$auth = new Auth($db);
if (!$auth->isLoggedIn()) {
    Response::error('No autorizado', 401);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

if (!isset($_POST['prompt'])) {
    Response::error('Falta el prompt');
}

$apiKey = STABILITY_AI_API_KEY;

try {
    $prompt = $_POST['prompt'];
    
    // Usamos SDXL para generar el fondo (Text-to-Image)
    // Generamos una imagen cuadrada 1024x1024 por defecto
    
    $ch = curl_init();

    $postFields = json_encode([
        'text_prompts' => [
            ['text' => $prompt . ", background texture, professional photography, 8k, high quality, no text, no people, blurred background style"]
        ],
        'cfg_scale' => 7,
        'height' => 1024,
        'width' => 1024,
        'samples' => 1,
        'steps' => 30,
    ]);

    curl_setopt_array($ch, [
        CURLOPT_URL => "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image",
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            "Content-Type: application/json",
            "Accept: application/json",
            "Authorization: Bearer {$apiKey}"
        ],
        CURLOPT_POSTFIELDS => $postFields,
        CURLOPT_SSL_VERIFYPEER => false
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200) {
        $data = json_decode($response, true);
        $base64Image = $data['artifacts'][0]['base64'];
        
        $uploadDir = '../../public/assets/images/backgrounds/temp/';
        if (!file_exists($uploadDir)) mkdir($uploadDir, 0777, true);
        
        $fileName = 'bg_' . time() . '_' . uniqid() . '.png';
        $filePath = $uploadDir . $fileName;
        
        file_put_contents($filePath, base64_decode($base64Image));
        
        $publicUrl = 'assets/images/backgrounds/temp/' . $fileName;

        echo json_encode([
            'status' => 'success', 
            'image_url' => $publicUrl,
            'full_path' => $filePath // Para uso interno
        ]);
    } else {
        $errorData = json_decode($response, true);
        Response::error('Error generando fondo: ' . json_encode($errorData), $httpCode);
    }

} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
