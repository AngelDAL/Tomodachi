<?php
require_once '../../includes/Response.class.php';
require_once 'config.php';

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

if (!isset($_FILES['image'])) {
    Response::error('No se proporcionó ninguna imagen');
}

$apiKey = GOOGLE_GEMINI_API_KEY;

if ($apiKey === 'TU_API_KEY_DE_GOOGLE_AQUI') {
    Response::error('API Key de Google no configurada. Revisa api/ai/config.php');
}

try {
    $imagePath = $_FILES['image']['tmp_name'];
    $imageData = base64_encode(file_get_contents($imagePath));
    $mimeType = mime_content_type($imagePath);

    // Prompt para Gemini
    $promptText = "Eres un experto fotógrafo de alimentos y productos, y redactor de marketing. 
    Analiza esta imagen. 
    1. Identifica qué platillo o producto es.
    2. Sugiere mejoras visuales específicas para que se vea como una foto de producto de alta gama (iluminación, fondo, composición).
    3. Escribe un 'prompt' en INGLÉS optimizado para Stable Diffusion (Image-to-Image) que incorpore estas mejoras. El prompt debe describir la imagen ideal final, manteniendo la esencia del producto original pero elevando su calidad visual (8k, professional lighting, appetizing, clean background).
    4. Escribe una descripción corta y vendedora en ESPAÑOL para el menú o catálogo.
    
    Devuelve SOLO un JSON válido con este formato, sin bloques de código markdown:
    {
        \"product_name\": \"Nombre del producto\",
        \"ai_prompt\": \"El prompt en inglés...\",
        \"improvement_suggestions\": \"Sugerencias de mejora en español...\",
        \"menu_description\": \"La descripción en español...\"
    }";

    // Usamos gemini-1.5-pro que es el modelo más capaz y estable para análisis multimodal
    $url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=" . $apiKey;

    $data = [
        "contents" => [
            [
                "parts" => [
                    ["text" => $promptText],
                    [
                        "inline_data" => [
                            "mime_type" => $mimeType,
                            "data" => $imageData
                        ]
                    ]
                ]
            ]
        ],
        "generationConfig" => [
            "response_mime_type" => "application/json"
        ]
    ];

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    // Deshabilitar verificación SSL para entorno local WAMP
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);

    $response = curl_exec($ch);
    
    if (curl_errno($ch)) {
        throw new Exception(curl_error($ch));
    }
    
    curl_close($ch);

    $result = json_decode($response, true);
    
    if (isset($result['candidates'][0]['content']['parts'][0]['text'])) {
        $jsonText = $result['candidates'][0]['content']['parts'][0]['text'];
        // Limpiar posibles bloques de código markdown si Gemini los incluye a pesar de la instrucción
        $jsonText = str_replace(['```json', '```'], '', $jsonText);
        echo $jsonText;
    } else {
        // Log error for debugging
        error_log("Gemini Error: " . print_r($result, true));
        
        // Intentar extraer mensaje de error legible de Gemini
        $errorMessage = 'No se pudo analizar la imagen con IA';
        $errorData = $result;
        
        if (isset($result['error']['message'])) {
            $errorMessage = 'Gemini: ' . $result['error']['message'];
        }
        
        Response::error($errorMessage, 500, $errorData);
    }

} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
