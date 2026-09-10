<?php
/**
 * Registro de nueva empresa y usuario administrador
 * POST /api/auth/register.php
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/Mail.class.php';
require_once '../../includes/ImageUpload.class.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

try {
    $db = new Database();
    
    // Detectar si es JSON o Form Data
    $contentType = isset($_SERVER["CONTENT_TYPE"]) ? trim($_SERVER["CONTENT_TYPE"]) : '';
    
    if (strpos($contentType, 'application/json') !== false) {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true);
        if (!$data) {
            Response::validationError(['body' => 'JSON inválido']);
        }
    } else {
        // Asumimos Form Data (multipart/form-data o x-www-form-urlencoded)
        $data = $_POST;
    }

    $errors = [];
    
    // Datos de la empresa
    $store_name = isset($data['store_name']) ? Validator::sanitizeString($data['store_name']) : '';
    $store_phone = isset($data['store_phone']) ? Validator::sanitizeString($data['store_phone']) : '';
    
    // Datos del usuario admin
    $full_name = isset($data['full_name']) ? Validator::sanitizeString($data['full_name']) : '';
    $username = isset($data['username']) ? Validator::sanitizeString($data['username']) : '';
    $email = isset($data['email']) ? Validator::sanitizeString($data['email']) : '';
    $password = isset($data['password']) ? $data['password'] : '';
    $user_phone = isset($data['user_phone']) ? Validator::sanitizeString($data['user_phone']) : '';

    // Validaciones
    if (!Validator::required($store_name)) { $errors['store_name'] = 'Nombre de empresa requerido'; }
    if (!Validator::required($full_name)) { $errors['full_name'] = 'Nombre requerido'; }
    if (!Validator::required($username)) { $errors['username'] = 'Usuario requerido'; }
    // El correo electrónico es OPCIONAL: solo se valida si viene relleno
    if (!empty($email) && !Validator::validateEmail($email)) { $errors['email'] = 'Email inválido'; }
    if (!Validator::required($password)) { $errors['password'] = 'Contraseña requerida'; }
    if (strlen($password) < 6) { $errors['password'] = 'Mínimo 6 caracteres'; }

    // Límites de longitud (evitan errores de BD y entradas abusivas)
    if (mb_strlen($store_name) > 100) { $errors['store_name'] = 'Máximo 100 caracteres'; }
    if (mb_strlen($full_name) > 100) { $errors['full_name'] = 'Máximo 100 caracteres'; }
    if (mb_strlen($username) > 50) { $errors['username'] = 'Máximo 50 caracteres'; }
    if (mb_strlen($email) > 100) { $errors['email'] = 'Máximo 100 caracteres'; }
    if (mb_strlen($store_phone) > 20) { $errors['store_phone'] = 'Máximo 20 caracteres'; }
    if (mb_strlen($user_phone) > 20) { $errors['user_phone'] = 'Máximo 20 caracteres'; }

    if ($errors) {
        Response::validationError($errors);
    }

    // Verificar duplicados: usuario siempre; email solo si fue proporcionado
    // Mensaje genérico: no revelar si el conflicto es por usuario o por correo
    $existsUser = $db->selectOne('SELECT user_id FROM users WHERE username = ?', [$username]);
    if ($existsUser) {
        Response::error('El usuario o el correo ya están registrados', 409);
    }
    if (!empty($email)) {
        $existsEmail = $db->selectOne('SELECT user_id FROM users WHERE email = ?', [$email]);
        if ($existsEmail) {
            Response::error('El usuario o el correo ya están registrados', 409);
        }
    }

    $db->beginTransaction();

    try {
        // 1. Crear Tienda
        $sqlStore = "INSERT INTO stores (store_name, phone, status, created_at) VALUES (?, ?, 'active', NOW())";
        $store_id = $db->insert($sqlStore, [$store_name, $store_phone]);

        // 1.1 Subir Logo si existe (validación de contenido + re-encode con ImageUpload)
        if (isset($_FILES['logo']) && $_FILES['logo']['error'] === UPLOAD_ERR_OK) {
            try {
                $saved = ImageUpload::saveUploadedFile(
                    $_FILES['logo'],
                    __DIR__ . '/../../public/assets/images/logos',
                    'store_' . $store_id,
                    2 * 1024 * 1024,   // resultado máx. 2MB
                    20 * 1024 * 1024,  // entrada máx. 20MB
                    1920
                );
                $logoUrl = 'assets/images/logos/' . $saved['filename'];
                $db->update('UPDATE stores SET logo_url = ? WHERE store_id = ?', [$logoUrl, $store_id]);
            } catch (Exception $e) {
                // Un logo inválido no debe interrumpir el registro
                error_log('Logo rechazado en registro: ' . $e->getMessage());
            }
        }

        // 2. Crear Usuario Admin
        $hash = Auth::hashPassword($password);
        $sqlUser = "INSERT INTO users (store_id, username, password_hash, full_name, email, phone, role, status, created_at) 
                    VALUES (?, ?, ?, ?, ?, ?, 'admin', 'active', NOW())";
        $user_id = $db->insert($sqlUser, [$store_id, $username, $hash, $full_name, $email, $user_phone]);

        $db->commit();

        // Enviar correo de bienvenida (solo si el usuario dio un correo)
        if (!empty($email)) {
            try {
                $mailer = new Mail();
                $mailer->sendWelcomeEmail($email, $full_name, $store_name, $username);
            } catch (Throwable $e) {
                // No interrumpir el flujo si falla el correo o la librería no está instalada
                error_log("Error enviando correo de bienvenida: " . $e->getMessage());
            }
        }

        // Iniciar sesión automáticamente
        $auth = new Auth($db);
        $user = $auth->login($username, $password);

        // Establecer cookie persistente (Remember Me, máx. 30 días)
        if ($user) {
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
            'store_id' => $store_id,
            'user_id' => $user_id,
            'user' => $user,
            'session' => $auth->getCurrentUser(),
            'message' => 'Registro exitoso. Bienvenido.'
        ], 'Registro exitoso', 201);

    } catch (Exception $e) {
        $db->rollback();
        throw $e;
    }

} catch (Exception $e) {
    error_log('Error en registro: ' . $e->getMessage());
    Response::error('Error interno del servidor', 500);
}
