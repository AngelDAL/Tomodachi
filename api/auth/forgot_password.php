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
require_once '../../includes/UrlHelper.class.php';
require_once '../../includes/LoginRateLimiter.class.php';

require_once __DIR__ . '/../../includes/Cors.class.php';
require_once __DIR__ . '/../../includes/RequestContext.class.php';
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

    // El enlace de recuperación se ENVÍA POR CORREO y lleva el token en claro: su
    // base no puede salir de la petición. `UrlHelper::base()` prefiere APP_URL y
    // sólo cae a HTTP_HOST cuando APP_URL está vacía — y HTTP_HOST lo elige el
    // cliente, así que con `Host: evil.com` el token acabaría en el servidor del
    // atacante. Sin APP_URL no hay forma de firmar un enlace confiable, así que
    // aquí se FALLA CERRADO: ni token ni correo.
    //
    // Va ANTES de buscar al usuario (y del rate limiter) para que la respuesta sea
    // idéntica exista o no el correo: si dependiera de eso, añadiría enumeración.
    if (trim((string)getenv('APP_URL')) === '') {
        RequestContext::error('forgot_password: APP_URL no está definida; no se emite enlace de recuperación (configuración incompleta)');
        Response::error(
            'La recuperación de contraseña no está disponible en este servidor: falta configurar APP_URL.',
            500,
            ['code' => 'app_url_missing']
        );
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
        
        // Guardar SOLO el hash del token: si la base de datos se filtra, los
        // enlaces de recuperación pendientes no son utilizables.
        //
        // La caducidad la calcula SQL (NOW() + 1 hora), NO PHP: el contenedor va en
        // hora de México y MariaDB en UTC, así que un `date('Y-m-d H:i:s')` de PHP se
        // guardaba 6 h en el futuro y `reset_password.php` (que compara contra
        // NOW()) lo veía vencido desde el primer segundo. Ver AGENTS.md, sección de
        // tiempo y fechas: nada temporal calculado en PHP que después se compare
        // contra la base.
        $db->update(
            'UPDATE users SET reset_token_hash = ?, reset_token_expires_at = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE user_id = ?',
            [hash('sha256', $token), $user['user_id']]
        );
        
        // Base URL confiable: la de APP_URL (garantizada más arriba), nunca
        // HTTP_HOST. Es la misma política que documenta includes/UrlHelper.class.php.
        $resetLink = UrlHelper::base() . '/public/reset_password.html?token=' . urlencode($token);
        
        try {
            $mailer = new Mail();
            $mailer->sendPasswordResetEmail($email, $user['full_name'], $resetLink);
        } catch (Exception $e) {
            RequestContext::error("Error enviando correo de recuperación: " . $e->getMessage());
            Response::error('Error al enviar el correo. Intente más tarde.', 500);
        }
    }
    
    // Siempre responder éxito por seguridad (para no revelar si el correo existe o no)
    Response::success([], 'Si el correo existe en nuestro sistema, recibirás un enlace para restablecer tu contraseña.');
    
} catch (Exception $e) {
    RequestContext::error('Error en forgot_password: ' . $e->getMessage());
    Response::error('Error interno del servidor', 500);
}
