<?php
/**
 * API: Login de usuario
 * POST /api/auth/login.php
 */

require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/LoginRateLimiter.class.php';

require_once __DIR__ . '/../../includes/Cors.class.php';
Cors::apply();
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

// Solo permitir método POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

try {
    // Obtener datos del body
    $data = json_decode(file_get_contents('php://input'), true);
    
    // Validar datos requeridos
    if (!isset($data['username']) || !isset($data['password'])) {
        Response::validationError(['username' => 'Usuario y contraseña son requeridos']);
    }
    
    $username = Validator::sanitizeString($data['username']);
    $password = $data['password'];
    
    // Validar campos
    if (!Validator::required($username)) {
        Response::validationError(['username' => 'El usuario es requerido']);
    }
    
    if (!Validator::required($password)) {
        Response::validationError(['password' => 'La contraseña es requerida']);
    }
    
    // Autenticar usuario
    $db = new Database();
    $auth = new Auth($db);

    // === Anti fuerza bruta: comprobar bloqueo de la IP y de la cuenta ===
    $rateLimiter = new LoginRateLimiter($db);
    $rlCheck = $rateLimiter->check($username);
    if (!$rlCheck['allowed']) {
        http_response_code(429);
        header('Content-Type: application/json; charset=utf-8');
        header('Retry-After: ' . (int)$rlCheck['retry_after']);
        echo json_encode([
            'success'    => false,
            'message'    => $rlCheck['message'],
            'data'       => null,
            'error'      => 'rate_limited',
            'retry_after'=> (int)$rlCheck['retry_after']
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $user = $auth->login($username, $password);
    
    if ($user) {
        // Login exitoso: limpiar los contadores de la IP y de la cuenta
        $rateLimiter->recordSuccess($username);

        // Handle Remember Me (cookie persistente de 30 días máximo)
        if (isset($data['remember']) && $data['remember'] === true) {
            $params = session_get_cookie_params();
            setcookie(session_name(), session_id(), [
                'expires'  => time() + (30 * 24 * 60 * 60),
                'path'     => $params['path'],
                'domain'   => $params['domain'],
                'secure'   => !empty($params['secure']),
                'httponly' => true,
                'samesite' => 'Lax',
            ]);
        }

        Response::success([
            'user' => $user,
            'session' => $auth->getCurrentUser()
        ], 'Inicio de sesión exitoso');
    } else {
        // Credenciales incorrectas: registrar el fallo para el rate limiter
        $rateLimiter->recordFailure($username);
        Response::error('Usuario o contraseña incorrectos', 401);
    }
    
} catch (Exception $e) {
    error_log('Error en login: ' . $e->getMessage());
    Response::error('Error interno del servidor', 500);
}
