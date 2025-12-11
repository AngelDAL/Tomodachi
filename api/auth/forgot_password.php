<?php
/**
 * API: Solicitar restablecimiento de contraseña
 * POST /api/auth/forgot_password.php
 */

require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Mail.class.php';

header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

try {
    $data = json_decode(file_get_contents('php://input'), true);
    
    if (!isset($data['email'])) {
        Response::validationError(['email' => 'El correo electrónico es requerido']);
    }
    
    $email = Validator::sanitizeString($data['email']);
    
    if (!Validator::validateEmail($email)) {
        Response::validationError(['email' => 'Correo electrónico inválido']);
    }
    
    $db = new Database();
    
    // Verificar si el usuario existe
    $user = $db->selectOne('SELECT user_id, full_name FROM users WHERE email = ? AND status = ?', [$email, 'active']);
    
    if ($user) {
        // Generar token único
        $token = bin2hex(random_bytes(32));
        $expires = date('Y-m-d H:i:s', strtotime('+1 hour'));
        
        // Guardar token en la base de datos
        $db->update('UPDATE users SET reset_token_hash = ?, reset_token_expires_at = ? WHERE user_id = ?', [$token, $expires, $user['user_id']]);
        
        // Enviar correo
        $resetLink = "http://" . $_SERVER['HTTP_HOST'] . "/Tomodachi/public/reset_password.html?token=" . $token;
        
        try {
            $mailer = new Mail();
            $mailer->sendPasswordResetEmail($email, $user['full_name'], $resetLink);
        } catch (Exception $e) {
            error_log("Error enviando correo de recuperación: " . $e->getMessage());
            Response::error('Error al enviar el correo. Intente más tarde.', 500);
        }
    }
    
    // Siempre responder éxito por seguridad (para no revelar si el correo existe o no)
    Response::success([], 'Si el correo existe en nuestro sistema, recibirás un enlace para restablecer tu contraseña.');
    
} catch (Exception $e) {
    Response::error('Error en el servidor: ' . $e->getMessage(), 500);
}
