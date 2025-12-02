<?php
/**
 * Perfil de usuario (Leer y Actualizar)
 * GET /api/users/profile.php
 * POST /api/users/profile.php
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';

header('Content-Type: application/json; charset=utf-8');

$db = new Database();
$auth = new Auth($db);

if (!$auth->isLoggedIn()) {
    Response::unauthorized();
}

$user_id = $auth->getCurrentUser()['user_id'];

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    try {
        $user = $db->selectOne(
            'SELECT user_id, username, full_name, email, phone, role, store_id, status, show_onboarding, created_at 
             FROM users WHERE user_id = ?', 
            [$user_id]
        );
        if (!$user) {
            Response::notFound('Usuario no encontrado');
        }
        Response::success($user, 'Perfil de usuario');
    } catch (Exception $e) {
        Response::error('Error servidor: ' . $e->getMessage(), 500);
    }
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true);
        if (!$data) {
            Response::validationError(['body' => 'JSON inválido']);
        }

        $full_name = isset($data['full_name']) ? Validator::sanitizeString($data['full_name']) : '';
        $email = isset($data['email']) ? Validator::sanitizeString($data['email']) : '';
        $phone = isset($data['phone']) ? Validator::sanitizeString($data['phone']) : '';
        $password = isset($data['password']) ? $data['password'] : '';
        $current_password = isset($data['current_password']) ? $data['current_password'] : '';

        $errors = [];
        if (!Validator::required($full_name)) { $errors['full_name'] = 'Requerido'; }
        if (!Validator::required($email)) { $errors['email'] = 'Requerido'; }
        if (!Validator::validateEmail($email)) { $errors['email'] = 'Email inválido'; }

        // Si quiere cambiar contraseña, debe proveer la actual
        if (!empty($password)) {
            if (empty($current_password)) {
                $errors['current_password'] = 'Requerida para cambiar contraseña';
            } elseif (strlen($password) < 6) {
                $errors['password'] = 'Mínimo 6 caracteres';
            }
        }

        if ($errors) {
            Response::validationError($errors);
        }

        // Verificar email duplicado (si cambió)
        $currentUser = $db->selectOne('SELECT email, password_hash FROM users WHERE user_id = ?', [$user_id]);
        if ($email !== $currentUser['email']) {
            $exists = $db->selectOne('SELECT user_id FROM users WHERE email = ? AND user_id != ?', [$email, $user_id]);
            if ($exists) {
                Response::error('El email ya está en uso', 409);
            }
        }

        $show_onboarding = isset($data['show_onboarding']) ? (int)$data['show_onboarding'] : 1;

        // Verificar contraseña actual si se va a cambiar
        if (!empty($password)) {
            if (!password_verify($current_password, $currentUser['password_hash'])) {
                Response::error('Contraseña actual incorrecta', 401);
            }
            $newHash = Auth::hashPassword($password);
            $db->update(
                'UPDATE users SET full_name = ?, email = ?, phone = ?, password_hash = ?, show_onboarding = ? WHERE user_id = ?',
                [$full_name, $email, $phone, $newHash, $show_onboarding, $user_id]
            );
        } else {
            $db->update(
                'UPDATE users SET full_name = ?, email = ?, phone = ?, show_onboarding = ? WHERE user_id = ?',
                [$full_name, $email, $phone, $show_onboarding, $user_id]
            );
        }

        // Actualizar sesión si es necesario (nombre y onboarding)
        $_SESSION['full_name'] = $full_name;
        $_SESSION['show_onboarding'] = (bool)$show_onboarding;

        Response::success(null, 'Perfil actualizado correctamente');

    } catch (Exception $e) {
        Response::error('Error servidor: ' . $e->getMessage(), 500);
    }
} else {
    Response::error('Método no permitido', 405);
}
