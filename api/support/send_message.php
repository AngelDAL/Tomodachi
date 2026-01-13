<?php
require_once '../../includes/Mail.class.php';
require_once '../../includes/Response.class.php'; 

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

// Get JSON input
$input = json_decode(file_get_contents('php://input'), true);

// Fallback to POST if not JSON
if (!$input) {
    $input = $_POST;
}

$name = $input['name'] ?? '';
$email = $input['email'] ?? '';
$type = $input['type'] ?? 'Consulta';
$subject = $input['subject'] ?? 'Sin asunto';
$message = $input['message'] ?? '';

// Basic Validation
if (empty($name) || empty($email) || empty($message)) {
    Response::error('Por favor complete todos los campos requeridos (Nombre, Correo, Mensaje)', 400);
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    Response::error('El correo electrónico no es válido', 400);
}

try {
    $mail = new Mail();
    $result = $mail->sendSupportMessage($email, $name, $subject, $message, $type);

    if ($result) {
        Response::success(null, 'Mensaje enviado correctamente. Gracias por contactarnos.');
    } else {
        Response::error('Hubo un error al enviar el mensaje. Por favor intente más tarde.', 500);
    }
} catch (Exception $e) {
    Response::error('Error interno del servidor: ' . $e->getMessage(), 500);
}
