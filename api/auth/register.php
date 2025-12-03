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
    if (!Validator::required($email)) { $errors['email'] = 'Email requerido'; }
    if (!Validator::validateEmail($email)) { $errors['email'] = 'Email inválido'; }
    if (!Validator::required($password)) { $errors['password'] = 'Contraseña requerida'; }
    if (strlen($password) < 6) { $errors['password'] = 'Mínimo 6 caracteres'; }

    if ($errors) {
        Response::validationError($errors);
    }

    // Verificar duplicados
    $existsUser = $db->selectOne('SELECT user_id FROM users WHERE username = ? OR email = ?', [$username, $email]);
    if ($existsUser) {
        Response::error('El usuario o email ya está registrado', 409);
    }

    $db->beginTransaction();

    try {
        // 1. Crear Tienda
        $sqlStore = "INSERT INTO stores (store_name, phone, status, created_at) VALUES (?, ?, 'active', NOW())";
        $store_id = $db->insert($sqlStore, [$store_name, $store_phone]);

        // 1.1 Subir Logo si existe
        if (isset($_FILES['logo']) && $_FILES['logo']['error'] === UPLOAD_ERR_OK) {
            $file = $_FILES['logo'];
            $allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
            $finfo = new finfo(FILEINFO_MIME_TYPE);
            $mime = $finfo->file($file['tmp_name']);

            if (in_array($mime, $allowedTypes) && $file['size'] <= 2 * 1024 * 1024) {
                $ext = pathinfo($file['name'], PATHINFO_EXTENSION);
                $filename = 'store_' . $store_id . '_' . time() . '.' . $ext;
                $targetDir = __DIR__ . '/../../public/assets/images/logos';
                
                if (!is_dir($targetDir)) {
                    mkdir($targetDir, 0777, true);
                }
                
                if (move_uploaded_file($file['tmp_name'], $targetDir . '/' . $filename)) {
                    $logoUrl = 'assets/images/logos/' . $filename;
                    $db->update('UPDATE stores SET logo_url = ? WHERE store_id = ?', [$logoUrl, $store_id]);
                }
            }
        }

        // 2. Crear Usuario Admin
        $hash = Auth::hashPassword($password);
        $sqlUser = "INSERT INTO users (store_id, username, password_hash, full_name, email, phone, role, status, created_at) 
                    VALUES (?, ?, ?, ?, ?, ?, 'admin', 'active', NOW())";
        $user_id = $db->insert($sqlUser, [$store_id, $username, $hash, $full_name, $email, $user_phone]);

        $db->commit();

        Response::success([
            'store_id' => $store_id,
            'user_id' => $user_id,
            'message' => 'Registro exitoso. Ahora puedes iniciar sesión.'
        ], 'Registro exitoso', 201);

    } catch (Exception $e) {
        $db->rollback();
        throw $e;
    }

} catch (Exception $e) {
    Response::error('Error servidor: ' . $e->getMessage(), 500);
}
