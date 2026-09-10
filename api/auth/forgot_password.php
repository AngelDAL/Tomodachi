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
require_once '../../includes/LoginRateLimiter.class.php';

require_once __DIR__ . '/../../includes/Cors.class.php';
Cors::apply();
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

    // Anti-abuso: limitar solicitudes por IP y por correo objetivo, en un
    // espacio de claves propio para no interferir con el bloqueo de login.
    $rateLimiter = new LoginRateLimiter($db, 'password_reset');
    $rlCheck = $rateLimiter->check($email);
    if (!$rlCheck['allowed']) {
        header('Retry-After: ' . (int)$rlCheck['retry_after']);
        Response::error($rlCheck['message'], 429);
    }
    // Cada solicitud consume un intento (el bloqueo expira por sí solo)
    $rateLimiter->recordFailure($email);
    
    // Verificar si el usuario existe
    $user = $db->selectOne('SELECT user_id, full_name FROM users WHERE email = ? AND status = ?', [$email, 'active']);
    
    if ($user) {
        // Generar token único
        $token = bin2hex(random_bytes(32));
        $expires = date('Y-m-d H:i:s', strtotime('+1 hour'));
        
        // Guardar SOLO el hash del token: si la base de datos se filtra, los
        // enlaces de recuperación pendientes no son utilizables.
        $db->update('UPDATE users SET reset_token_hash = ?, reset_token_expires_at = ? WHERE user_id = ?', [hash('sha256', $token), $expires, $user['user_id']]);
        
        // URL pública de la app: definir APP_URL (p. ej.
        // https://tu-dominio) para no depender del header Host de la petición.
        $baseUrl = getenv('APP_URL');
        if (!$baseUrl) {
            $isHttps = (!empty($_SERVER['HTTPS']) && strtolower($_SERVER['HTTPS']) !== 'off')
                || ((int)($_SERVER['SERVER_PORT'] ?? 0) === 443)
                || (getenv('TRUSTED_PROXY_HEADER') && strtolower(trim(explode(',', $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')[0])) === 'https');
            $baseUrl = ($isHttps ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? 'localhost');
        }
        $resetLink = rtrim($baseUrl, '/') . '/public/reset_password.html?token=' . urlencode($token);
        
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
    error_log('Error en forgot_password: ' . $e->getMessage());
    Response::error('Error interno del servidor', 500);
}
