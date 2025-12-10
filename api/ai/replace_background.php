<?php
require_once '../../includes/Response.class.php';
require_once 'config.php';

header('Content-Type: application/json');
set_time_limit(300); // Aumentar tiempo de ejecución (5 min)

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

if (!isset($_FILES['image'])) {
    Response::error('Falta la imagen del producto');
}

$apiKey = STABILITY_AI_API_KEY;

try {
    $imagePath = $_FILES['image']['tmp_name'];
    
    // Preparar campos POST
    $postFields = [
        'subject_image' => new \CURLFile($imagePath),
        'output_format' => 'png'
    ];

    // Opción 1: Usar imagen de fondo (Referencia)
    if (isset($_POST['background_image_url'])) {
        // Si viene una URL relativa del servidor, obtener path absoluto
        $bgUrl = $_POST['background_image_url'];
        // Limpiar URL para evitar path traversal básico
        $bgUrl = str_replace('..', '', $bgUrl);
        
        // Asumimos que la URL es relativa a public/
        $bgPath = realpath('../../public/' . $bgUrl);
        
        if ($bgPath && file_exists($bgPath)) {
            $postFields['background_reference'] = new \CURLFile($bgPath);
            // También podemos añadir un prompt para ayudar al relighting
            $postFields['background_prompt'] = "professional product photography lighting";
        } else {
            // Si no es local, tal vez es una URL externa (no soportado por ahora por seguridad)
            // O fallback a prompt
            $postFields['background_prompt'] = isset($_POST['prompt']) ? $_POST['prompt'] : "clean professional background";
        }
    } 
    // Opción 2: Usar Prompt para generar fondo
    elseif (isset($_POST['prompt'])) {
        $postFields['background_prompt'] = $_POST['prompt'];
    } else {
        $postFields['background_prompt'] = "professional studio background, clean, high quality";
    }

    // 1. Iniciar Job Async
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => "https://api.stability.ai/v2beta/stable-image/edit/replace-background-and-relight",
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            "Authorization: Bearer {$apiKey}",
            "Accept: application/json" 
        ],
        CURLOPT_POSTFIELDS => $postFields,
        CURLOPT_SSL_VERIFYPEER => false
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) {
        $errorData = json_decode($response, true);
        Response::error('Error iniciando trabajo: ' . json_encode($errorData), $httpCode);
    }

    $data = json_decode($response, true);
    $id = $data['id'];

    // 2. Polling (Esperar resultado)
    $attempts = 0;
    $maxAttempts = 60; // Aumentar intentos (aprox 2-3 min)
    $resultImage = null;

    while ($attempts < $maxAttempts) {
        sleep(2);
        
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => "https://api.stability.ai/v2beta/results/{$id}",
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [
                "Authorization: Bearer {$apiKey}",
                "Accept: application/json" 
            ],
            CURLOPT_SSL_VERIFYPEER => false
        ]);
        
        $pollResponse = curl_exec($ch);
        $pollCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($pollCode === 200) {
            $data = json_decode($pollResponse, true);
            if (isset($data['image'])) {
                $resultImage = base64_decode($data['image']);
                break;
            }
        } elseif ($pollCode === 202) {
            // Aún procesando
            $attempts++;
            continue;
        } else {
            // Error
            Response::error('Error en proceso: ' . $pollResponse, $pollCode);
        }
    }

    if ($resultImage) {
        $uploadDir = '../../public/assets/images/products/temp/';
        if (!file_exists($uploadDir)) mkdir($uploadDir, 0777, true);
        
        $fileName = 'ai_pro_' . time() . '_' . uniqid() . '.png';
        $filePath = $uploadDir . $fileName;
        
        file_put_contents($filePath, $resultImage);
        
        $publicUrl = 'assets/images/products/temp/' . $fileName;

        echo json_encode([
            'status' => 'success', 
            'image_url' => $publicUrl,
            'message' => 'Imagen profesional generada'
        ]);
    } else {
        Response::error('Tiempo de espera agotado. Intenta de nuevo.', 408);
    }

} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
