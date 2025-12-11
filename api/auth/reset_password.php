<?php
/**
 * API: Restablecer contraseña con token
 * POST /api/auth/reset_password.php
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

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

try {
    $data = json_decode(file_get_contents('php://input'), true);
    
    if (!isset($data['token']) || !isset($data['password'])) {
        Response::validationError(['message' => 'Token y contraseña son requeridos']);
    }
    
    $token = $data['token'];
    $password = $data['password'];
    
    if (strlen($password) < 6) {
        Response::validationError(['password' => 'La contraseña debe tener al menos 6 caracteres']);
    }
    
    $db = new Database();
    
    // Verificar token y expiración
    $user = $db->selectOne('SELECT user_id FROM users WHERE reset_token_hash = ? AND reset_token_expires_at > NOW()', [$token]);
    
    if (!$user) {
        Response::error('El enlace de recuperación es inválido o ha expirado.', 400);
    }
    
    // Actualizar contraseña y limpiar token
    $hash = Auth::hashPassword($password);
    
    $db->update('UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_token_expires_at = NULL WHERE user_id = ?', [$hash, $user['user_id']]);
    
    Response::success([], 'Contraseña actualizada correctamente. Ahora puedes iniciar sesión.');
    
} catch (Exception $e) {
    Response::error('Error en el servidor: ' . $e->getMessage(), 500);
}
