<?php
/**
 * API: Verificar sesión activa
 * GET /api/auth/verify_session.php
 */

require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';

header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET');

try {
    $db = new Database();
    $auth = new Auth($db);
    
    if ($auth->isLoggedIn()) {
        Response::success([
            'logged_in' => true,
            'user' => $auth->getCurrentUser()
        ], 'Sesión activa');
    } else {
        Response::success([
            'logged_in' => false,
            'user' => null
        ], 'No hay sesión activa');
    }
    
} catch (Exception $e) {
    Response::error('Error en el servidor: ' . $e->getMessage(), 500);
}
