<?php
/**
 * API: Marcar onboarding como completado
 * POST /api/users/complete_onboarding.php
 */

require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';

header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST');

try {
    $db = new Database();
    $auth = new Auth($db);
    
    if (!$auth->isLoggedIn()) {
        Response::unauthorized();
    }
    
    $user_id = $auth->getCurrentUser()['user_id'];
    
    // Actualizar en base de datos
    $sql = "UPDATE users SET show_onboarding = 0 WHERE user_id = ?";
    $updated = $db->update($sql, [$user_id]);
    
    if ($updated) {
        // Actualizar sesión para reflejar el cambio inmediatamente
        $_SESSION['show_onboarding'] = false;
        
        Response::success(null, 'Onboarding completado y desactivado.');
    } else {
        // Puede que ya estuviera en 0, pero igual retornamos éxito
        Response::success(null, 'Onboarding ya estaba desactivado.');
    }
    
} catch (Exception $e) {
    Response::error('Error en el servidor: ' . $e->getMessage(), 500);
}
