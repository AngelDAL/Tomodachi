<?php
/**
 * Actualizar usuario
 * PUT /api/users/update.php
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: PUT');

$db = new Database();
$auth = new Auth($db);

if (!$auth->isLoggedIn()) { Response::unauthorized(); }

if ($_SERVER['REQUEST_METHOD'] !== 'PUT') { Response::error('Método no permitido',405); }

try {
    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { Response::validationError(['body'=>'JSON inválido']); }

    $user_id = isset($data['user_id']) ? (int)$data['user_id'] : 0;
    if ($user_id <= 0) { Response::validationError(['user_id'=>'Requerido']); }

    $currentUser = $auth->getCurrentUser();

    // Solo admin, super_admin o el mismo usuario puede actualizar
    if (!$auth->hasRole([ROLE_ADMIN, ROLE_SUPER_ADMIN]) && $currentUser['user_id'] != $user_id) { Response::error('Permisos insuficientes',403); }

    $user = $db->selectOne('SELECT user_id, store_id FROM users WHERE user_id = ?',[$user_id]);
    if (!$user) { Response::notFound('Usuario no existe'); }

    // Si es admin intentando editar otro usuario, verificar que sea de su tienda. Super Admin puede todo.
    if ($currentUser['role'] !== ROLE_SUPER_ADMIN && $currentUser['user_id'] != $user_id && $user['store_id'] != $currentUser['store_id']) {
        Response::error('No tiene permiso para modificar usuarios de otra tienda', 403);
    }

    $fields = [];
    $params = [];

    if (isset($data['full_name'])) {
        $fields[] = 'full_name = ?';
        $params[] = Validator::sanitizeString($data['full_name']);
    }
    if (isset($data['email'])) {
        $email = Validator::sanitizeString($data['email']);
        if ($email && !Validator::validateEmail($email)) { Response::validationError(['email'=>'Formato inválido']); }
        $fields[] = 'email = ?';
        $params[] = $email;
    }
    if (isset($data['password']) && strlen(trim($data['password']))>0) {
        // Cambio de la propia contraseña: exigir la contraseña actual
        if ($currentUser['user_id'] == $user_id) {
            $current_password = isset($data['current_password']) ? (string)$data['current_password'] : '';
            if ($current_password === '') {
                Response::validationError(['current_password' => 'Requerida para cambiar tu contraseña']);
            }
            $own = $db->selectOne('SELECT password_hash FROM users WHERE user_id = ?', [$user_id]);
            if (!$own || !password_verify($current_password, $own['password_hash'])) {
                Response::error('Contraseña actual incorrecta', 401);
            }
        }
        $fields[] = 'password_hash = ?';
        $params[] = Auth::hashPassword($data['password']);
        // La contraseña se asignó explícitamente: no forzar cambio
        $fields[] = 'must_change_password = 0';
    }
    if (isset($data['status'])) {
        if (!in_array($data['status'],[STATUS_ACTIVE,STATUS_INACTIVE])) { Response::validationError(['status'=>'Estado inválido']); }
        $fields[] = 'status = ?';
        $params[] = $data['status'];
    }
    if (isset($data['role']) && $auth->hasRole([ROLE_ADMIN, ROLE_SUPER_ADMIN])) {
        $allowed_roles = [ROLE_ADMIN, ROLE_MANAGER, ROLE_CASHIER, ROLE_WAITER];
        if ($auth->hasRole(ROLE_SUPER_ADMIN)) {
            $allowed_roles[] = ROLE_SUPER_ADMIN;
        }
        if (!in_array($data['role'], $allowed_roles)) { Response::validationError(['role'=>'Rol inválido']); }
        $fields[] = 'role = ?';
        $params[] = $data['role'];
    }
    if (isset($data['show_onboarding'])) {
        $fields[] = 'show_onboarding = ?';
        $params[] = $data['show_onboarding'] ? 1 : 0;
        
        // Update session if updating self
        if ($currentUser['user_id'] == $user_id) {
            $_SESSION['show_onboarding'] = (bool)$data['show_onboarding'];
        }
    }

    if (!$fields) { Response::error('Nada para actualizar',400); }

    $params[] = $user_id;
    $sql = 'UPDATE users SET '.implode(', ',$fields).' WHERE user_id = ?';
    $db->update($sql,$params);

    $updated = $db->selectOne('SELECT user_id, username, full_name, email, role, store_id, status FROM users WHERE user_id = ?',[$user_id]);
    Response::success($updated,'Usuario actualizado');
} catch (Exception $e) {
    error_log('Error en users/update: '.$e->getMessage());
    Response::error('Error interno del servidor',500);
}
