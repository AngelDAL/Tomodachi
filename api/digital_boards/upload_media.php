<?php
/**
 * Subir imagen para digital signage
 * POST /api/digital_boards/upload_media.php
 * Acepta base64 o multipart/form-data
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';

try {
    $db = new Database();
    $auth = new Auth($db);
    $apiAuth = new ApiAuth($db);
    
    $actor = $apiAuth->requireActor($auth);
    $apiAuth->requireScope($actor, 'write');
    
    if ($actor['via'] === 'session' && !in_array($auth->getCurrentUser()['role'], [ROLE_ADMIN, ROLE_MANAGER])) {
        Response::error('Permisos insuficientes', 403);
    }
    
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        Response::error('Método no permitido', 405);
    }
    
    $store_id = (int)$actor['store_id'];
    $data = [];
    
    // Crear directorio de uploads si no existe
    $upload_dir = __DIR__ . '/../../uploads/digital_signage/';
    if (!is_dir($upload_dir)) {
        mkdir($upload_dir, 0755, true);
    }
    
    // Verificar si es multipart o JSON base64
    $is_multipart = !empty($_FILES['file']);
    
    if ($is_multipart) {
        // Multipart upload
        if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
            Response::validationError(['file' => 'Error al subir archivo']);
        }
        
        $file = $_FILES['file'];
        $original_name = basename($file['name']);
        $mime_type = mime_content_type($file['tmp_name']);
        $file_size = $file['size'];
        
        // Validar tipo
        $allowed_types = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!in_array($mime_type, $allowed_types)) {
            Response::validationError(['file' => 'Tipo de imagen no permitido']);
        }
        
        // Validar tamaño (max 5MB)
        if ($file_size > 5 * 1024 * 1024) {
            Response::validationError(['file' => 'Tamaño máximo: 5MB']);
        }
        
        // Generar nombre único
        $ext = pathinfo($original_name, PATHINFO_EXTENSION);
        $filename = 'ds_' . $store_id . '_' . time() . '_' . uniqid() . '.' . $ext;
        $filepath = $upload_dir . $filename;
        
        if (!move_uploaded_file($file['tmp_name'], $filepath)) {
            Response::error('Error al guardar archivo', 500);
        }
        
    } else {
        // JSON base64
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true);
        
        if (!$data || empty($data['image_base64'])) {
            Response::validationError(['image_base64' => 'Requerida']);
        }
        
        $img64 = $data['image_base64'];
        
        // Parse base64
        if (!preg_match('/^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/', $img64, $matches)) {
            Response::validationError(['image_base64' => 'Formato inválido']);
        }
        
        $mime_type = $matches[1];
        $ext = $matches[2] === 'jpeg' ? 'jpg' : $matches[2];
        $data_bin = base64_decode($matches[3]);
        
        if ($data_bin === false) {
            Response::validationError(['image_base64' => 'Base64 corrupto']);
        }
        
        // Validar tamaño (max 5MB)
        if (strlen($data_bin) > 5 * 1024 * 1024) {
            Response::validationError(['image_base64' => 'Tamaño máximo: 5MB']);
        }
        
        // Generar nombre único
        $filename = 'ds_' . $store_id . '_' . time() . '_' . uniqid() . '.' . $ext;
        $filepath = $upload_dir . $filename;
        $file_size = strlen($data_bin);
        
        if (file_put_contents($filepath, $data_bin) === false) {
            Response::error('Error al guardar archivo', 500);
        }
        
        $original_name = $data['original_name'] ?? $filename;
    }
    
    // Obtener dimensiones de imagen si GD está disponible
    $width = null;
    $height = null;
    if (extension_loaded('gd')) {
        $image_info = @getimagesize($filepath);
        if ($image_info) {
            $width = $image_info[0];
            $height = $image_info[1];
        }
    }
    
    // Tags opcionales
    $tags = isset($data['tags']) ? $data['tags'] : (isset($_POST['tags']) ? $_POST['tags'] : null);
    
    // Guardar en BD
    $media_id = $db->insert(
        'INSERT INTO digital_signage_media 
         (store_id, filename, original_name, mime_type, file_size, width, height, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
            $store_id,
            $filename,
            $original_name,
            $mime_type,
            $file_size,
            $width,
            $height,
            $tags
        ]
    );
    
    // URL relativa para acceder a la imagen
    $relative_url = '/uploads/digital_signage/' . $filename;
    
    Response::success([
        'media_id' => $media_id,
        'filename' => $filename,
        'original_name' => $original_name,
        'url' => $relative_url,
        'mime_type' => $mime_type,
        'file_size' => $file_size,
        'width' => $width,
        'height' => $height
    ], 'Imagen subida exitosamente', 201);
    
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}
