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

header('Access-Control-Allow-Origin: *');
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
    
    $user = $auth->login($username, $password);
    
    if ($user) {
        Response::success([
            'user' => $user,
            'session' => $auth->getCurrentUser()
        ], 'Inicio de sesión exitoso');
    } else {
        Response::error('Usuario o contraseña incorrectos', 401);
    }
    
} catch (Exception $e) {
    Response::error('Error en el servidor: ' . $e->getMessage(), 500);
}
